/** One inventory policy for working files, edit fingerprints, and committed sources. */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { parseConfig } from './config.ts'
import { MAX_FIXTURES, MAX_FIXTURE_FILE_BYTES } from './fixtures.ts'
import { MAX_PREVIEW_METADATA_BYTES, PREVIEW_METADATA_FILE } from './preview.ts'
import type { Diagnostic } from './types.ts'

export const MAX_SOURCE_FILE_BYTES = 512 * 1024
const MAX_SOURCE_DIRECTORY_ENTRIES = 4096
const MAX_TOTAL_SOURCE_BYTES = 16 * 1024 * 1024

export const SOURCE_DIRECTORIES = {
  screens: { extension: '.dsx', limit: 128, bytes: MAX_SOURCE_FILE_BYTES },
  layouts: { extension: '.dsx', limit: 64, bytes: 128 * 1024 },
  fixtures: { extension: '.json', limit: MAX_FIXTURES, bytes: MAX_FIXTURE_FILE_BYTES },
  journeys: { extension: '.dsx', limit: 64, bytes: 128 * 1024 },
} as const

type Directory = keyof typeof SOURCE_DIRECTORIES
export type SourceReadResult =
  | { readonly kind: 'file'; readonly bytes: Uint8Array; readonly mtimeMs?: number }
  | { readonly kind: 'missing' | 'unsupported' | 'oversized' | 'unreadable' }
export type SourceDirectoryResult =
  | { readonly kind: 'entries'; readonly names: readonly string[] }
  | { readonly kind: 'missing' | 'unsupported' | 'oversized' | 'unreadable' }

/** Adapters supply plain, confined files from one filesystem or one commit. */
export interface ProjectSourceReader {
  read(file: string, maxBytes: number): Promise<SourceReadResult>
  list(directory: Directory, maxEntries: number): Promise<SourceDirectoryResult>
}

export interface SourceEntry {
  readonly source?: string
  readonly fingerprint: string
  readonly mtimeMs?: number
  readonly size?: number
  readonly issue?: Diagnostic
}

function accessIssue(error: unknown): 'missing' | 'unsupported' | 'unreadable' {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return 'missing'
  if (code === 'ELOOP' || code === 'ENOTDIR') return 'unsupported'
  return 'unreadable'
}

/** Refuse linked files and directories, even if a link points inside the project. */
export function localProjectSourceReader(folder: string): ProjectSourceReader {
  const root = (async () => {
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) return { kind: 'unsupported' } as const
    return { path: await realpath(folder) }
  })().catch((error: unknown) => ({ kind: accessIssue(error) }))
  async function pathFor(file: string): Promise<string | undefined> {
    const canonicalRoot = await root
    if ('kind' in canonicalRoot) {
      if (canonicalRoot.kind === 'missing')
        throw Object.assign(new Error('Design folder is missing.'), { code: 'ENOENT' })
      return undefined
    }
    let path = canonicalRoot.path
    for (const part of file.split('/')) {
      if (part === '' || part === '.' || part === '..' || part.includes('\\') || part.includes('\x00')) return undefined
      path = join(path, part)
      if ((await lstat(path)).isSymbolicLink()) return undefined
    }
    return (await realpath(path)) === path ? path : undefined
  }
  return {
    async read(file, maxBytes) {
      try {
        const path = await pathFor(file)
        if (path === undefined) return { kind: 'unsupported' }
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        try {
          const info = await handle.stat()
          const verified = await pathFor(file)
          if (verified === undefined || !info.isFile()) return { kind: 'unsupported' }
          const current = await lstat(verified)
          if (current.dev !== info.dev || current.ino !== info.ino) return { kind: 'unreadable' }
          if (info.size > maxBytes) return { kind: 'oversized' }
          const buffer = Buffer.alloc(Math.min(info.size, maxBytes) + 1)
          let used = 0
          while (used < buffer.length) {
            const { bytesRead } = await handle.read(buffer, used, buffer.length - used, used)
            if (bytesRead === 0) break
            used += bytesRead
          }
          if (used > maxBytes) return { kind: 'oversized' }
          if (used !== info.size || (await handle.stat()).ctimeMs !== info.ctimeMs) return { kind: 'unreadable' }
          return { kind: 'file', bytes: buffer.subarray(0, used), mtimeMs: info.mtimeMs }
        } finally {
          await handle.close()
        }
      } catch (error) {
        return { kind: accessIssue(error) }
      }
    },
    async list(directory, maxEntries) {
      try {
        const path = await pathFor(directory)
        if (path === undefined || !(await lstat(path)).isDirectory()) return { kind: 'unsupported' }
        const names: string[] = []
        for await (const entry of await opendir(path)) {
          if (names.length >= maxEntries) return { kind: 'oversized' }
          names.push(entry.name)
        }
        return { kind: 'entries', names }
      } catch (error) {
        return { kind: accessIssue(error) }
      }
    },
  }
}

export interface SourceInventory {
  readonly config: ReturnType<typeof parseConfig>
  readonly entries: ReadonlyMap<string, SourceEntry>
  readonly directories: Readonly<Record<Directory, readonly string[]>>
  readonly diagnostics: readonly Diagnostic[]
  readonly sourceIdentity: string
}

function sourceIssue(file: string, code: string, message: string): Diagnostic {
  return { file, code, message, severity: 'error', line: 1, column: 1 }
}

/** Resolve candidate paths before reading bytes; declarations come from this inventory's config only. */
export async function readProjectSources(reader: ProjectSourceReader): Promise<SourceInventory> {
  const entries = new Map<string, SourceEntry>()
  const directories = { screens: [], layouts: [], fixtures: [], journeys: [] } as Record<Directory, string[]>
  const diagnostics: Diagnostic[] = []
  let remaining = MAX_TOTAL_SOURCE_BYTES
  async function read(file: string, limit: number, required = true): Promise<void> {
    if (entries.has(file)) return
    const max = Math.min(limit, remaining)
    const result = await reader.read(file, max)
    if (result.kind === 'file' && result.bytes.byteLength <= max) {
      remaining -= result.bytes.byteLength
      const fingerprint = createHash('sha256').update(result.bytes).digest('hex')
      try {
        const source = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)
        entries.set(file, { source, fingerprint, size: result.bytes.byteLength, mtimeMs: result.mtimeMs })
        return
      } catch {
        const issue = sourceIssue(
          file,
          file === PREVIEW_METADATA_FILE ? 'preview-read' : 'source-encoding',
          file + ' must be valid UTF-8.',
        )
        entries.set(file, { fingerprint, issue })
        diagnostics.push(issue)
        return
      }
    }
    const kind = result.kind === 'file' ? 'oversized' : result.kind
    const message =
      kind === 'missing'
        ? ' is missing.'
        : kind === 'oversized'
          ? ' exceeds the ' + max + '-byte source budget.'
          : ' must be a readable regular file under the design folder, not a symbolic link.'
    const code =
      file === PREVIEW_METADATA_FILE
        ? kind === 'oversized'
          ? 'preview-limit'
          : 'preview-read'
        : kind === 'missing' && file === 'tokens.json'
          ? 'tokens-missing'
          : 'source-' + kind
    const issue = kind === 'missing' && !required ? undefined : sourceIssue(file, code, file + message)
    entries.set(file, { fingerprint: kind, issue })
    if (issue !== undefined) diagnostics.push(issue)
  }

  await read('design.json', 64 * 1024, false)
  const config = parseConfig(entries.get('design.json')?.source ?? '{}', 'design.json')
  await read('tokens.json', MAX_SOURCE_FILE_BYTES)
  await read(PREVIEW_METADATA_FILE, MAX_PREVIEW_METADATA_BYTES, false)
  for (const file of new Set(Object.values(config.config.themes ?? {}))) await read(file, 128 * 1024)
  for (const file of config.config.stylesheets ?? []) await read(file, 64 * 1024)
  for (const directory of Object.keys(SOURCE_DIRECTORIES) as Directory[]) {
    const { extension, limit, bytes } = SOURCE_DIRECTORIES[directory]
    const listing = await reader.list(directory, MAX_SOURCE_DIRECTORY_ENTRIES)
    if (listing.kind === 'missing') continue
    if (listing.kind !== 'entries') {
      const issue = sourceIssue(
        directory,
        'source-' + listing.kind,
        directory + '/ must be a plain local directory with at most ' + MAX_SOURCE_DIRECTORY_ENTRIES + ' entries.',
      )
      entries.set(directory, { fingerprint: listing.kind, issue })
      diagnostics.push(issue)
      continue
    }
    const names = listing.names
      .filter(
        (name) => name.endsWith(extension) && !name.includes('/') && !name.includes('\\') && !name.includes('\x00'),
      )
      .sort((left, right) => left.localeCompare(right, 'en'))
    if (names.length > limit) {
      const issue = sourceIssue(
        directory,
        'source-limit',
        directory + '/ allows at most ' + limit + ' ' + extension + ' sources.',
      )
      entries.set(directory, { fingerprint: 'limit:' + names.length, issue })
      diagnostics.push(issue)
    }
    for (const name of names.slice(0, limit)) {
      const file = directory + '/' + name
      directories[directory].push(file)
      await read(file, bytes)
    }
  }
  const identity = createHash('sha256')
  for (const [file, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    identity.update(JSON.stringify([file, entry.fingerprint]))
  }
  return { config, entries, directories, diagnostics, sourceIdentity: identity.digest('hex') }
}
