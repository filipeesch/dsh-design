/** Self-contained deterministic preview document: no subsequent network requests. */
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  resolveResponsive,
  type Breakpoint,
  type DesignChild,
  type DesignProject,
  type DesignScreenNode,
} from '@filipeesch/dsh-design-core'
import type { PreviewPayload } from './payload.ts'
import {
  MAX_DETERMINISTIC_FILE_BYTES,
  MAX_DETERMINISTIC_MEDIA_BYTES,
  RASTER_TYPES,
  rasterDataUri,
  sniffRaster,
} from './media.ts'

const URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi

/** Normalize a project-relative raster path. */
function assetPath(value: string): string | undefined {
  const path = value.trim().replace(/^\.\//, '')
  if (path === '' || path.startsWith('/') || path.includes('\\')) return undefined
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return undefined
  const segments = path.split('/')
  if (segments.includes('..') || segments.includes('.cache') || segments.includes('.')) return undefined
  if (!RASTER_TYPES[extname(path).toLowerCase()]) return undefined
  return path
}

/** Collect paths from all roots and validated history. */
function collectPaths(node: DesignChild | undefined, paths: Set<string>): void {
  if (node === undefined || node.kind !== 'element') return
  for (const value of Object.values(node.props)) {
    if (typeof value !== 'string') continue
    if (value.startsWith('placeholder:')) continue
    const image = assetPath(value)
    if (image !== undefined) paths.add(image)
    for (const match of value.matchAll(URL_PATTERN)) {
      const target = match[1] ?? match[2] ?? match[3] ?? ''
      const asset = assetPath(target)
      if (asset !== undefined) paths.add(asset)
    }
  }
  // Responsive src values may be chosen by the renderer later (e.g. in a journey).
  const src = node.props.src
  if ((node.type === 'Image' || node.type === 'Avatar') && src !== null && typeof src === 'object') {
    for (const value of Object.values(src)) {
      if (typeof value !== 'string' || value.startsWith('placeholder:')) continue
      const path = assetPath(value)
      if (path !== undefined) paths.add(path)
    }
  }
  for (const child of node.children) collectPaths(child, paths)
}

/** Sorted local raster paths referenced by the supplied roots. */
export function referencedAssetPaths(roots: readonly (DesignChild | DesignScreenNode | undefined)[]): string[] {
  const paths = new Set<string>()
  for (const root of roots) collectPaths(root, paths)
  return [...paths].sort((left, right) => left.localeCompare(right))
}

type MediaFailure = 'missing' | 'unsupported' | 'undecodable'

/** Source-linked media availability, independent of measured geometry. */
export interface MediaDiagnostic {
  readonly code: MediaFailure
  readonly breakpoint: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly node?: string
  readonly reference: string
  readonly remediation: string
}

interface MediaReference {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly node?: string
  readonly reference: string
}

async function readRasterAssets(folder: string, paths: readonly string[]) {
  const root = await realpath(folder).catch(() => undefined)
  const assets: Record<string, string> = {}
  const failures = new Map<string, MediaFailure>()
  let total = 0
  for (const path of paths) {
    const real = root === undefined ? undefined : await realpath(resolve(root, path)).catch(() => undefined)
    if (real === undefined) {
      failures.set(path, 'missing')
      continue
    }
    if (real === root || !real.startsWith(root + sep)) {
      failures.set(path, 'unsupported')
      continue
    }
    const info = await stat(real).catch(() => undefined)
    if (info === undefined) {
      failures.set(path, 'missing')
      continue
    }
    if (
      !info.isFile() ||
      info.size > MAX_DETERMINISTIC_FILE_BYTES ||
      total + info.size > MAX_DETERMINISTIC_MEDIA_BYTES
    ) {
      failures.set(path, 'unsupported')
      continue
    }
    const buffer = await readFile(real).catch(() => undefined)
    if (
      buffer !== undefined &&
      (buffer.length > MAX_DETERMINISTIC_FILE_BYTES || total + buffer.length > MAX_DETERMINISTIC_MEDIA_BYTES)
    ) {
      failures.set(path, 'unsupported')
      continue
    }
    if (buffer === undefined || sniffRaster(buffer) === undefined) {
      failures.set(path, 'undecodable')
      continue
    }
    if (RASTER_TYPES[extname(path).toLowerCase()] !== sniffRaster(buffer)) {
      failures.set(path, 'unsupported')
      continue
    }
    const data = rasterDataUri(buffer)
    if (data === undefined) {
      failures.set(path, 'undecodable')
      continue
    }
    assets[path] = data
    total += buffer.length
  }
  return { assets, failures }
}

/** Inline bounded, validated local raster bytes referenced by selected roots. */
export async function collectAssetsForRoots(
  folder: string,
  roots: readonly (DesignChild | DesignScreenNode | undefined)[],
): Promise<Record<string, string>> {
  return (await readRasterAssets(folder, referencedAssetPaths(roots))).assets
}

/** Media references selected by one resolved breakpoint. */
function selectedReferences(
  root: DesignScreenNode,
  file: string,
  breakpoints: readonly Breakpoint[],
  breakpoint: string,
) {
  const references: MediaReference[] = []
  function visit(node: DesignChild): void {
    if (node.kind !== 'element') return
    const identity = node.id ?? node.address?.label
    const remember = (value: string): void => {
      if (value.startsWith('placeholder:')) return
      const reference = value.trim().replace(/^\.\//, '')
      // Do not echo forbidden absolute paths, traversals, or external URLs.
      const local =
        reference !== '' &&
        !reference.startsWith('/') &&
        !reference.includes('\\') &&
        !/^[a-z][a-z0-9+.-]*:/i.test(reference) &&
        !reference.split('/').some((part) => part === '..' || part === '.cache')
      references.push({
        file: node.source.file ?? file,
        line: node.source.line,
        column: node.source.column,
        ...(identity === undefined ? {} : { node: identity }),
        reference: local ? reference : '(invalid local path)',
      })
    }
    if (node.type === 'Image' || node.type === 'Avatar') {
      const source = resolveResponsive(node.props.src, breakpoints, breakpoint)
      if (typeof source === 'string') remember(source)
    }
    if (typeof node.props.css === 'string') {
      for (const match of node.props.css.matchAll(URL_PATTERN)) remember(match[1] ?? match[2] ?? match[3] ?? '')
    }
    for (const child of node.children) visit(child)
  }
  visit(root)
  return references
}

/** Capture all requested breakpoint assets once, then reuse those exact bytes. */
export async function collectMediaSnapshot(
  folder: string,
  root: DesignScreenNode,
  file: string,
  breakpoints: readonly Breakpoint[],
  names: readonly string[],
) {
  const byBreakpoint = new Map(
    [...new Set(names)].map((name) => [name, selectedReferences(root, file, breakpoints, name)]),
  )
  const paths = new Set<string>()
  for (const references of byBreakpoint.values()) {
    for (const { reference } of references) {
      const path = assetPath(reference)
      if (path !== undefined) paths.add(path)
    }
  }
  const snapshot = await readRasterAssets(
    folder,
    [...paths].sort((a, b) => a.localeCompare(b)),
  )
  return {
    assets: snapshot.assets,
    at(breakpoint: string) {
      const references = byBreakpoint.get(breakpoint)
      if (references === undefined) throw new Error('Breakpoint was not captured: ' + breakpoint)
      return { ...snapshot, references, breakpoint }
    },
  }
}

/** Media used by one resolved tree and breakpoint. */
export async function collectSelectedMedia(
  folder: string,
  root: DesignScreenNode,
  file: string,
  breakpoints: readonly Breakpoint[],
  breakpoint: string,
) {
  return (await collectMediaSnapshot(folder, root, file, breakpoints, [breakpoint])).at(breakpoint)
}

type SelectedMedia = Awaited<ReturnType<typeof collectSelectedMedia>>

/** Confirm actual browser decoding of passive, already inlined data only. */
export async function diagnoseMedia(
  page: import('playwright-core').Page,
  media: SelectedMedia,
): Promise<MediaDiagnostic[]> {
  const known = [...new Set(media.references.map(({ reference }) => reference))]
  const inlined = known.flatMap((path) =>
    media.assets[path] === undefined ? [] : [{ path, data: media.assets[path] }],
  )
  const invalid = new Set(
    inlined.length === 0
      ? []
      : await page.evaluate(async (items) => {
          const failed = await Promise.all(
            items.map(async ({ path, data }) => {
              const image = document.createElement('img')
              image.src = data
              return image.decode().then(
                () => undefined,
                () => path,
              )
            }),
          )
          return failed.filter((path): path is string => path !== undefined)
        }, inlined),
  )
  return media.references.flatMap((entry) => {
    const path = assetPath(entry.reference)
    const code = path === undefined ? 'unsupported' : invalid.has(path) ? 'undecodable' : media.failures.get(path)
    if (code === undefined) return []
    const remediation =
      code === 'missing'
        ? 'Add the file inside the design folder or correct its relative path.'
        : code === 'undecodable'
          ? 'Re-export the file as a valid PNG, JPEG, WebP or GIF.'
          : 'Use a local PNG, JPEG, WebP or GIF within the deterministic media limits (2 MiB/file, 8 MiB total).'
    return [{ ...entry, code, breakpoint: media.breakpoint, remediation }]
  })
}

/** Inline bounded, validated local raster bytes referenced by the project. */
export async function collectDeterministicAssets(project: DesignProject): Promise<Record<string, string>> {
  const roots: (DesignChild | DesignScreenNode | undefined)[] = []
  for (const screen of project.screens) {
    roots.push(screen.root, screen.lastValidRoot)
  }
  return collectAssetsForRoots(project.folder, roots)
}

/** Escape JSON for an inline script. */
function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

/** Escape closing script tags in bundled JavaScript. */
function inlineScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script')
}

/** Inline every bundled font referenced by the built stylesheet. */
async function inlineFonts(assetsDir: string, css: string): Promise<string> {
  const names = new Set<string>()
  for (const match of css.matchAll(/url\((?:["']?)(?:\.\/)?fonts\/([^)"']+)(?:["']?)\)/g)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  let result = css
  for (const name of names) {
    const buffer = await readFile(resolve(assetsDir, 'fonts', name))
    result = result.replace(
      new RegExp(
        'url\\((?:["\']?)(?:\\.\\/)?fonts/' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:["\']?)\\)',
        'g',
      ),
      'url(data:font/woff2;base64,' + buffer.toString('base64') + ')',
    )
  }
  return result
}

/** Build the complete deterministic document and its CSP. */
export async function deterministicDocument(
  assetsDir: string,
  payload: PreviewPayload,
): Promise<{ html: string; csp: string }> {
  const [appJs, rawCss] = await Promise.all([
    readFile(resolve(assetsDir, 'app.js'), 'utf8'),
    readFile(resolve(assetsDir, 'app.css'), 'utf8'),
  ])
  const css = await inlineFonts(assetsDir, rawCss)
  const nonce = randomBytes(16).toString('base64')
  const csp =
    "default-src 'none'; script-src 'nonce-" +
    nonce +
    "'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Design preview</title><link rel="icon" href="data:,"><style>' +
    css +
    '</style></head><body><div id="root"></div><script nonce="' +
    nonce +
    '">window.__DSX_PROJECT__=' +
    inlineJson(payload) +
    ';window.__DSX_DETERMINISTIC__=true;</script><script nonce="' +
    nonce +
    '">' +
    inlineScript(appJs) +
    '</script></body></html>'
  return { html, csp }
}
