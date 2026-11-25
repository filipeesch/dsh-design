/** HTML helpers for shell, not-found pages, and safe text. */
import { readFile } from 'node:fs/promises'

/** Escape text for HTML content and attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Build a minimal standalone not-found page with no external resources. */
export function notFoundPage(title: string, detail: string, screens: readonly string[] = []): string {
  const list =
    screens.length === 0
      ? ''
      : '<ul>' + screens.map((screen) => '<li><code>' + escapeHtml(screen) + '</code></li>').join('') + '</ul>'
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' +
    escapeHtml(title) +
    '</title>' +
    '<style>body{font:15px system-ui,sans-serif;margin:0;padding:32px;color:#0f172a;background:#f8fafc}' +
    'main{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px}' +
    'h1{font-size:20px;margin:0 0 8px}p{color:#475569}code{background:#f1f5f9;padding:1px 5px;border-radius:4px}</style></head>' +
    '<body><main><h1>' +
    escapeHtml(title) +
    '</h1><p>' +
    escapeHtml(detail) +
    '</p>' +
    list +
    '</main></body></html>'
  )
}

/** Read the renderer shell and point its assets at the per-session asset route. */
export async function renderShell(assetsDir: string, sessionId: string): Promise<string> {
  const template = await readFile(assetsDir + '/index.html', 'utf8')
  const assetBase = '/design/' + encodeURIComponent(sessionId) + '/_/assets/'
  return template
    .replace('<head>', '<head><base href="' + assetBase + '">')
    .replaceAll('./assets/', assetBase)
    .replaceAll('./app.', assetBase + 'app.')
    .replaceAll('href="assets/', 'href="' + assetBase)
    .replaceAll('src="assets/', 'src="' + assetBase)
}
