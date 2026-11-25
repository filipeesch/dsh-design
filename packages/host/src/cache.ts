/**
 * Confined, content-addressed handoff cache publication.
 *
 * Every component is checked as a plain directory below the canonical design
 * folder, packages are written to a private staging directory, and a completed
 * package is exposed by one rename only after its manifest and every file digest
 * verify. A verified package is immutable to this helper: reuse verifies it,
 * while an invalid or partial existing package fails explicitly.
 */
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** One manifest file entry, in sorted path order. */
export interface PackageFileEntry {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

/** Minimal shape shared by handoff manifests. */
export interface PackageManifest {
  readonly id: string
  readonly format: string
  readonly files: readonly PackageFileEntry[]
  readonly [key: string]: unknown
}

/** Explicit cache or package failure. */
export class PackageError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PackageError'
    this.code = code
  }
}

const AREA_PATTERN = /^[a-z][a-z0-9-]*$/
const ID_PATTERN = /^[a-f0-9]{64}$/

/** Whether a relative package path is safe and normal. */
export function safePackagePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || isAbsolute(path)) return false
  const segments = path.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** Canonical JSON: object keys sorted recursively, array order preserved. */
export function canonicalJson(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical)
    if (input !== null && typeof input === 'object') {
      const record = input as Record<string, unknown>
      const ordered: Record<string, unknown> = {}
      for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
        ordered[key] = canonical(record[key])
      }
      return ordered
    }
    return input
  }
  return JSON.stringify(canonical(value))
}

/** SHA-256 of bytes or UTF-8 text. */
export function sha256Bytes(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** The package identity is the digest of its manifest without the id field. */
export function packageIdentity(manifestWithoutId: Record<string, unknown>): string {
  return sha256Bytes(canonicalJson(manifestWithoutId))
}

/** Build sorted file entries and the sealed manifest for in-memory outputs. */
export function sealManifest<T extends Record<string, unknown>>(
  base: T,
  files: Readonly<Record<string, Buffer | string>>,
): T & { id: string; files: PackageFileEntry[] } {
  const entries = Object.keys(files)
    .sort((left, right) => left.localeCompare(right))
    .map((path) => {
      if (!safePackagePath(path)) throw new PackageError('unsafe-path', 'Unsafe package path "' + path + '".')
      const data = files[path] as Buffer | string
      const bytes = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data)
      return { path, bytes, sha256: sha256Bytes(data) }
    })
  const identity = packageIdentity({ ...base, files: entries })
  return { ...base, id: identity, files: entries }
}

/** Validate one cache component, creating it as a plain directory when absent. */
export async function ensureCacheComponent(path: string, expected: string): Promise<string> {
  let info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (info === undefined) {
    try {
      await mkdir(path, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    info = await lstat(path)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new PackageError(
      'unsafe-cache',
      'The design cache component "' + path + '" must be a plain directory; refusing to write.',
    )
  }
  const real = await realpath(path)
  if (real !== expected) {
    throw new PackageError(
      'unsafe-cache',
      'The design cache resolves outside its canonical location; refusing to write.',
    )
  }
  return real
}

/** Canonical cache area such as cache/handoff. */
export async function cacheAreaDirectory(folder: string, area: string): Promise<string> {
  if (!AREA_PATTERN.test(area)) throw new PackageError('invalid-area', 'Invalid design cache area "' + area + '".')
  const realFolder = await realpath(folder)
  const cache = resolve(realFolder, '.cache')
  await ensureCacheComponent(cache, cache)
  const directory = resolve(cache, area)
  await ensureCacheComponent(directory, directory)
  return directory
}

/** Revalidate a canonical cache area immediately before publication. */
export async function revalidateCacheArea(folder: string, area: string, directory: string): Promise<string> {
  const realFolder = await realpath(folder)
  const expected = resolve(realFolder, '.cache', area)
  if (directory !== expected)
    throw new PackageError('unsafe-cache', 'The cache path is not canonical; refusing to write.')
  const info = await lstat(directory).catch(() => undefined)
  if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) {
    throw new PackageError('unsafe-cache', 'The cache area is no longer a plain directory; refusing to write.')
  }
  const real = await realpath(directory)
  if (real !== expected) {
    throw new PackageError('unsafe-cache', 'The cache area resolves outside its canonical location; refusing to write.')
  }
  return real
}

/** Read one manifest and reject an unexpected shape without echoing content. */
async function readManifest(directory: string): Promise<PackageManifest> {
  let source: string
  try {
    source = await readFile(join(directory, 'manifest.json'), 'utf8')
  } catch {
    throw new PackageError('package-invalid', 'The package has no readable manifest.')
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new PackageError('package-invalid', 'The package manifest is not valid JSON.')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PackageError('package-invalid', 'The package manifest is not an object.')
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !ID_PATTERN.test(record.id)) {
    throw new PackageError('package-invalid', 'The package manifest has no content-addressed id.')
  }
  if (typeof record.format !== 'string' || record.format === '') {
    throw new PackageError('package-invalid', 'The package manifest has no format.')
  }
  if (!Array.isArray(record.files)) {
    throw new PackageError('package-invalid', 'The package manifest has no file list.')
  }
  const seen = new Set<string>()
  for (const entry of record.files) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new PackageError('package-invalid', 'A package file entry is not an object.')
    }
    const file = entry as Record<string, unknown>
    if (typeof file.path !== 'string' || !safePackagePath(file.path) || file.path === 'manifest.json') {
      throw new PackageError('package-invalid', 'A package file entry has an unsafe path.')
    }
    if (seen.has(file.path)) throw new PackageError('package-invalid', 'The package manifest repeats a file path.')
    seen.add(file.path)
    if (typeof file.bytes !== 'number' || !Number.isInteger(file.bytes) || file.bytes < 0) {
      throw new PackageError('package-invalid', 'A package file entry has an invalid byte count.')
    }
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new PackageError('package-invalid', 'A package file entry has an invalid digest.')
    }
  }
  const { id: _id, ...withoutId } = record
  if (packageIdentity(withoutId) !== record.id) {
    throw new PackageError('package-invalid', 'The package id does not match its manifest content.')
  }
  return record as unknown as PackageManifest
}

/** Recursively list regular files below a package root, refusing symlinks. */
async function listPackageFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true })
  const result: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix === '' ? entry.name : prefix + '/' + entry.name
    if (entry.isSymbolicLink()) throw new PackageError('package-invalid', 'The package contains a symbolic link.')
    if (entry.isDirectory()) {
      result.push(...(await listPackageFiles(directory, path)))
      continue
    }
    if (!entry.isFile()) throw new PackageError('package-invalid', 'The package contains a non-regular file.')
    result.push(path)
  }
  return result
}

/**
 * Verify a completed package: directory shape, manifest identity, exact file
 * set, sizes, and SHA-256 digests. Returns the verified manifest.
 */
export async function verifyPackage(directory: string): Promise<PackageManifest> {
  const info = await lstat(directory).catch(() => undefined)
  if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) {
    throw new PackageError('package-invalid', 'The package target is not a plain directory.')
  }
  const manifest = await readManifest(directory)
  const files = (manifest.files as PackageFileEntry[]).slice()
  const actual = (await listPackageFiles(directory)).filter((path) => path !== 'manifest.json')
  const expected = files.map((entry) => entry.path)
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
    throw new PackageError('package-invalid', 'The package file set does not match its manifest.')
  }
  for (const entry of files) {
    const target = resolve(directory, entry.path)
    const relativePath = relative(directory, target)
    if (!safePackagePath(relativePath.split(sep).join('/'))) {
      throw new PackageError('package-invalid', 'A package file path escapes the package.')
    }
    const buffer = await readFile(target)
    if (buffer.length !== entry.bytes || sha256Bytes(buffer) !== entry.sha256) {
      throw new PackageError('package-invalid', 'Package file "' + entry.path + '" does not match its digest.')
    }
  }
  return manifest
}

/** Write one package file below a validated root. */
async function writePackageFile(root: string, path: string, data: Buffer | string): Promise<void> {
  if (!safePackagePath(path)) throw new PackageError('unsafe-path', 'Unsafe package path "' + path + '".')
  const target = resolve(root, path)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new PackageError('unsafe-path', 'A package file path escapes its directory.')
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(target, data, { mode: 0o600 })
}

/** Options for one package publication. */
export interface PublishPackageOptions {
  readonly folder: string
  readonly area: string
  readonly id: string
  readonly manifest: Record<string, unknown> & { id: string; files: PackageFileEntry[] }
  readonly files: Readonly<Record<string, Buffer | string>>
  /** Cancellation observed before the atomic rename that publishes the package. */
  readonly signal?: AbortSignal
}

/** Read an abort signal without narrowing the caller's variable. */
function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function cancelled(): PackageError {
  return new PackageError('cancelled', 'Package publication was cancelled before its atomic commit.')
}

/**
 * Publish one complete package under the ignored cache.
 * @returns the absolute package directory and whether a verified copy was reused.
 */
export async function publishPackage(options: PublishPackageOptions): Promise<{ path: string; reused: boolean }> {
  if (!ID_PATTERN.test(options.id)) throw new PackageError('invalid-id', 'A package id must be a SHA-256 digest.')
  if (options.manifest.id !== options.id) throw new PackageError('invalid-id', 'The manifest id does not match.')
  if (aborted(options.signal)) throw cancelled()
  const area = await cacheAreaDirectory(options.folder, options.area)
  const target = resolve(area, options.id)
  if (dirname(target) !== area) throw new PackageError('unsafe-path', 'The package target is outside its cache area.')

  const existing = await lstat(target).catch(() => undefined)
  if (existing !== undefined) {
    const manifest = await verifyPackage(target)
    if (manifest.id !== options.id) throw new PackageError('package-invalid', 'The cached package id differs.')
    if (aborted(options.signal)) throw cancelled()
    return { path: target, reused: true }
  }

  const stagingRoot = resolve(area, '.staging')
  await ensureCacheComponent(stagingRoot, stagingRoot)
  const staging = await mkdtemp(join(stagingRoot, 'build-'))
  let published = false
  try {
    for (const path of Object.keys(options.files).sort((left, right) => left.localeCompare(right))) {
      if (aborted(options.signal)) throw cancelled()
      await writePackageFile(staging, path, options.files[path] as Buffer | string)
      if (aborted(options.signal)) throw cancelled()
    }
    if (aborted(options.signal)) throw cancelled()
    await writePackageFile(staging, 'manifest.json', JSON.stringify(options.manifest, null, 2) + '\n')
    if (aborted(options.signal)) throw cancelled()
    await verifyPackage(staging)
    if (aborted(options.signal)) throw cancelled()
    await revalidateCacheArea(options.folder, options.area, area)
    if (aborted(options.signal)) throw cancelled()
    const raced = await lstat(target).catch(() => undefined)
    if (raced !== undefined) {
      const manifest = await verifyPackage(target)
      if (manifest.id !== options.id) throw new PackageError('package-invalid', 'A concurrent package differs.')
      if (aborted(options.signal)) throw cancelled()
      await rm(staging, { recursive: true, force: true })
      published = true
      return { path: target, reused: true }
    }
    if (aborted(options.signal)) throw cancelled()
    try {
      await rename(staging, target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EISDIR') {
        const manifest = await verifyPackage(target)
        if (manifest.id !== options.id) throw new PackageError('package-invalid', 'A concurrent package differs.')
        await rm(staging, { recursive: true, force: true })
        published = true
        return { path: target, reused: true }
      }
      throw error
    }
    published = true
    return { path: target, reused: false }
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}
