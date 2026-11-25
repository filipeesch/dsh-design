/** Self-contained deterministic preview document: no subsequent network requests. */
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { DesignChild, DesignProject } from '@filipeesch/dsh-design-core'
import type { PreviewPayload } from './payload.ts'
import { MAX_DETERMINISTIC_FILE_BYTES, MAX_DETERMINISTIC_MEDIA_BYTES, RASTER_TYPES, rasterDataUri } from './media.ts'

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
  for (const child of node.children) collectPaths(child, paths)
}

/** Inline bounded, validated local raster bytes referenced by the project. */
export async function collectDeterministicAssets(project: DesignProject): Promise<Record<string, string>> {
  const paths = new Set<string>()
  for (const screen of project.screens) {
    collectPaths(screen.root, paths)
    collectPaths(screen.lastValidRoot, paths)
  }
  const root = await realpath(project.folder).catch(() => undefined)
  if (root === undefined) return {}
  const assets: Record<string, string> = {}
  let total = 0
  for (const path of [...paths].sort()) {
    const target = resolve(root, path)
    const real = await realpath(target).catch(() => undefined)
    if (real === undefined || (real !== root && !real.startsWith(root + sep))) continue
    const info = await stat(real).catch(() => undefined)
    if (info === undefined || !info.isFile() || info.size === 0 || info.size > MAX_DETERMINISTIC_FILE_BYTES) continue
    if (total + info.size > MAX_DETERMINISTIC_MEDIA_BYTES) continue
    const buffer = await readFile(real)
    const data = rasterDataUri(buffer)
    if (data === undefined) continue
    assets[path] = data
    total += buffer.length
  }
  return assets
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
