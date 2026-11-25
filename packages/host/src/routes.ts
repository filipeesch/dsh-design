/** HTTP routes for previews: shell, trusted assets, project, events, and passive media. */
import { createReadStream } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COMMENT_BODY_MAX,
  parseCommentCreate,
  parseCommentRemove,
  parseCommentSubmit,
  parseCommentUpdate,
} from '@filipeesch/dsh-design-core'
import { CommentStore, CommentStoreError } from './comments.ts'
import { collectDeterministicAssets, deterministicDocument } from './deterministic.ts'
import { notFoundPage, renderShell } from './html.ts'
import { MAX_MEDIA_BYTES, RASTER_TYPES, sniffRaster } from './media.ts'
import { buildPayload } from './payload.ts'
import type { ProjectRegistry } from './registry.ts'

const TEXT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}
const TRUSTED_ASSET_EXTENSIONS = new Set([
  ...Object.keys(TEXT_TYPES),
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.ico',
])
/** Hard cap for one trusted bundle asset. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024

/** Absolute directory of the built renderer assets shipped in this package. */
export function defaultAssetsDir(): string {
  return fileURLToPath(new URL('./assets/', import.meta.url))
}

/** One owner-gated request denied before any content is read. */
function forbidden(res: ServerResponse, head: boolean): void {
  const body = Buffer.from('owner access required')
  res.writeHead(403, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  if (head) res.end()
  else res.end(body)
}

/** Send a plain response. */
function send(
  res: ServerResponse,
  status: number,
  body: string,
  type = 'text/html; charset=utf-8',
  head = false,
  extra: Record<string, string> = {},
): void {
  const bytes = Buffer.from(body)
  res.writeHead(status, {
    'content-type': type,
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'SAMEORIGIN',
    ...extra,
  })
  if (head) res.end()
  else res.end(bytes)
}

/** Request body exceeded the bounded JSON limit. */
class BodyLimitError extends Error {}

/** Request body was not valid JSON. */
class InvalidJsonError extends Error {}

/** Header that proves a comment mutation used a deliberate script request. */
const COMMENT_INTENT_HEADER = 'x-dsh-design-comments'

/** Send a JSON response with the same no-store policy as the rest of the route. */
function sendJson(res: ServerResponse, status: number, value: unknown, head = false): void {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  if (head) res.end()
  else res.end(body)
}

/** Read a bounded JSON object from a mutation request. */
async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const declared = req.headers['content-length']
  if (typeof declared === 'string' && Number(declared) > limit) throw new BodyLimitError()
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (total > limit) throw new BodyLimitError()
    chunks.push(buffer)
  }
  if (total === 0) throw new InvalidJsonError()
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new InvalidJsonError()
  }
}

/** Whether a mutation carries deliberate same-origin JSON intent. */
function deliberateMutation(req: IncomingMessage): 'ok' | 'intent' | 'origin' | 'type' {
  if (req.headers[COMMENT_INTENT_HEADER] !== '1') return 'intent'
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== '' && site !== 'same-origin') return 'origin'
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      if (new URL(origin).host !== req.headers.host) return 'origin'
    } catch {
      return 'origin'
    }
  }
  const type = req.headers['content-type']
  if (typeof type !== 'string' || type.split(';')[0]?.trim().toLowerCase() !== 'application/json') return 'type'
  return 'ok'
}

/** Answer one comment store failure as a bounded JSON error. */
function sendCommentError(res: ServerResponse, error: unknown, head: boolean): void {
  if (!(error instanceof CommentStoreError)) {
    sendJson(res, 500, { error: 'internal', message: 'comment service failed' }, head)
    return
  }
  const status =
    error.code === 'not-found'
      ? 404
      : error.code === 'stale' || error.code === 'limit'
        ? 409
        : error.code === 'delivery-unavailable'
          ? 503
          : 502
  sendJson(res, status, { error: error.code, message: error.message, retryable: error.retryable }, head)
}

/**
 * Serve the owner-only comment surface for one authorized session.
 *
 * The session identity always comes from the route. Reads are plain GET; every
 * mutation requires a JSON body, a deliberate custom header (which a cross-site
 * form cannot set without a CORS preflight), and same-origin request metadata
 * when the browser supplies it.
 */
async function handleComments(
  req: IncomingMessage,
  res: ServerResponse,
  head: boolean,
  session: string,
  store: CommentStore,
  rest: readonly string[],
): Promise<void> {
  const method = req.method ?? 'GET'
  if (rest.length === 1) {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'method-not-allowed', message: 'use GET to list comments' }, head)
      return
    }
    sendJson(res, 200, store.snapshot(session), head)
    return
  }
  if (rest.length !== 2 || method !== 'POST') {
    sendJson(res, 404, { error: 'not-found', message: 'unknown comment endpoint' }, head)
    return
  }
  const action = rest[1]
  if (action !== 'create' && action !== 'update' && action !== 'remove' && action !== 'submit') {
    sendJson(res, 404, { error: 'not-found', message: 'unknown comment endpoint' }, head)
    return
  }
  const intent = deliberateMutation(req)
  if (intent === 'intent') {
    sendJson(res, 403, { error: 'intent-required', message: 'comment mutations need an explicit review request' }, head)
    return
  }
  if (intent === 'origin') {
    sendJson(res, 403, { error: 'cross-origin', message: 'comment mutations must come from this origin' }, head)
    return
  }
  if (intent === 'type') {
    sendJson(res, 415, { error: 'json-required', message: 'comment mutations require application/json' }, head)
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req, COMMENT_BODY_MAX)
  } catch (error) {
    if (error instanceof BodyLimitError) {
      sendJson(res, 413, { error: 'payload-too-large', message: 'comment request body is too large' }, head)
      return
    }
    sendJson(res, 400, { error: 'invalid-json', message: 'comment request body must be a JSON object' }, head)
    return
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(res, 400, { error: 'invalid', message: 'comment request body must be a JSON object' }, head)
    return
  }
  if ('session' in body) {
    sendJson(res, 400, { error: 'invalid', message: 'session identity comes from the route, not the body' }, head)
    return
  }
  try {
    if (action === 'create') {
      const parsed = parseCommentCreate(body)
      if (!parsed.ok) {
        sendJson(res, 400, { error: 'invalid', message: parsed.error }, head)
        return
      }
      sendJson(res, 200, store.create(session, parsed.value), head)
      return
    }
    if (action === 'update') {
      const parsed = parseCommentUpdate(body)
      if (!parsed.ok) {
        sendJson(res, 400, { error: 'invalid', message: parsed.error }, head)
        return
      }
      sendJson(res, 200, store.update(session, parsed.value), head)
      return
    }
    if (action === 'remove') {
      const parsed = parseCommentRemove(body)
      if (!parsed.ok) {
        sendJson(res, 400, { error: 'invalid', message: parsed.error }, head)
        return
      }
      sendJson(res, 200, store.remove(session, parsed.value), head)
      return
    }
    const parsed = parseCommentSubmit(body)
    if (!parsed.ok) {
      sendJson(res, 400, { error: 'invalid', message: parsed.error }, head)
      return
    }
    const result = await store.submit(session, parsed.value.requestId, parsed.value.versions)
    sendJson(
      res,
      200,
      {
        accepted: true,
        requestId: result.requestId,
        acceptedAt: result.acceptedAt,
        replayed: result.replayed,
        versions: result.versions,
        cleared: result.cleared,
        snapshot: result.snapshot,
      },
      head,
    )
  } catch (error) {
    sendCommentError(res, error, head)
  }
}

/** Normalize a decoded request path into safe segments. */
function safeSegments(value: string): string[] | undefined {
  if (value.includes('\0')) return undefined
  const segments = value.split('/')
  if (segments.some((segment) => segment === '..' || segment === '.' || segment === '')) return undefined
  if (segments.includes('.cache')) return undefined
  return segments
}

/** Serve one trusted bundle asset with a restrictive, non-sniffed type. */
async function serveAsset(res: ServerResponse, assetsDir: string, requested: string, head: boolean): Promise<void> {
  const segments = safeSegments(requested)
  if (segments === undefined) {
    send(res, 404, notFoundPage('Not found', 'Asset not found.'), undefined, head)
    return
  }
  const extension = extname(segments.at(-1) ?? '').toLowerCase()
  if (!TRUSTED_ASSET_EXTENSIONS.has(extension)) {
    send(res, 404, notFoundPage('Not found', 'Asset not found.'), undefined, head)
    return
  }
  const root = await realpath(assetsDir).catch(() => undefined)
  if (root === undefined) {
    send(res, 404, notFoundPage('Not found', 'Asset not found.'), undefined, head)
    return
  }
  const target = resolve(root, segments.join('/'))
  const real = await realpath(target).catch(() => undefined)
  if (real === undefined || (real !== root && !real.startsWith(root + sep))) {
    send(res, 404, notFoundPage('Not found', 'Asset not found.'), undefined, head)
    return
  }
  const info = await stat(real).catch(() => undefined)
  if (info === undefined || !info.isFile() || info.size > MAX_ASSET_BYTES) {
    send(res, 404, notFoundPage('Not found', 'Asset not found.'), undefined, head)
    return
  }
  const type = TEXT_TYPES[extension]
  const raster =
    extension === '.png' ||
    extension === '.jpg' ||
    extension === '.jpeg' ||
    extension === '.webp' ||
    extension === '.gif'
  if (raster) {
    const buffer = await readFile(real)
    if (buffer.length > MAX_ASSET_BYTES) {
      send(res, 404, notFoundPage('Not found', 'Asset not found.'), undefined, head)
      return
    }
    const sniffed = sniffRaster(buffer)
    if (sniffed === undefined || sniffed !== RASTER_TYPES[extension]) {
      send(res, 404, notFoundPage('Not found', 'Asset not found.'), undefined, head)
      return
    }
    res.writeHead(200, mediaHeaders(sniffed, buffer.length, 'public, max-age=3600'))
    if (head) res.end()
    else res.end(buffer)
    return
  }
  res.writeHead(200, {
    'content-type': type ?? 'application/octet-stream',
    'content-length': String(info.size),
    'cache-control': 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    ...(extension === '.svg'
      ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" }
      : {}),
  })
  if (head) {
    res.end()
    return
  }
  await new Promise<void>((resolveStream) => {
    const stream = createReadStream(real)
    stream.on('error', () => {
      res.destroy()
      resolveStream()
    })
    stream.on('end', resolveStream)
    stream.pipe(res)
  })
}

/** Headers applied to every project media response. */
function mediaHeaders(type: string, length: number, cache: string): Record<string, string> {
  return {
    'content-type': type,
    'content-length': String(length),
    'content-disposition': 'inline',
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
  }
}

/** Serve one bounded, sniffed passive raster from the design folder. */
async function serveProjectMedia(res: ServerResponse, folder: string, requested: string, head: boolean): Promise<void> {
  const segments = safeSegments(requested)
  if (segments === undefined) {
    send(res, 404, notFoundPage('Not found', 'File not found.'), undefined, head)
    return
  }
  const extension = extname(segments.at(-1) ?? '').toLowerCase()
  const expected = RASTER_TYPES[extension]
  if (expected === undefined) {
    send(res, 404, notFoundPage('Not found', 'Only passive raster images are served.'), undefined, head)
    return
  }
  const root = await realpath(folder).catch(() => undefined)
  if (root === undefined) {
    send(res, 404, notFoundPage('Not found', 'File not found.'), undefined, head)
    return
  }
  const target = resolve(root, segments.join('/'))
  const real = await realpath(target).catch(() => undefined)
  if (real === undefined || (real !== root && !real.startsWith(root + sep))) {
    send(res, 404, notFoundPage('Not found', 'File not found.'), undefined, head)
    return
  }
  const info = await stat(real).catch(() => undefined)
  if (info === undefined || !info.isFile() || info.size === 0 || info.size > MAX_MEDIA_BYTES) {
    send(res, 404, notFoundPage('Not found', 'File not found.'), undefined, head)
    return
  }
  const buffer = await readFile(real)
  if (buffer.length > MAX_MEDIA_BYTES) {
    send(res, 404, notFoundPage('Not found', 'File not found.'), undefined, head)
    return
  }
  const sniffed = sniffRaster(buffer)
  if (sniffed === undefined || sniffed !== expected) {
    send(res, 404, notFoundPage('Not found', 'File not found.'), undefined, head)
    return
  }
  res.writeHead(200, mediaHeaders(sniffed, buffer.length, 'no-store'))
  if (head) res.end()
  else res.end(buffer)
}

/**
 * Build the prefix route handler. The route uses the default `required`
 * admission and additionally enforces the owner principal, following the
 * DSH open-in-app pattern.
 */
export function createRouteHandler(
  registry: ProjectRegistry,
  assetsDir = defaultAssetsDir(),
  comments?: CommentStore,
): (req: IncomingMessage, res: ServerResponse, peer?: { principal?: { kind?: string } }) => Promise<void> {
  return async (req, res, peer) => {
    const head = req.method === 'HEAD'
    if (peer?.principal?.kind !== 'owner') {
      forbidden(res, head)
      return
    }
    const url = new URL(req.url ?? '/', 'http://design.invalid')
    const parts = url.pathname.split('/').filter((part) => part.length > 0)
    // parts[0] === 'design'
    if (parts.length < 2) {
      send(res, 404, notFoundPage('Design preview', 'Open /design/<session>/ from a design session.'), undefined, head)
      return
    }
    const session = decodeSegment(parts[1] as string)
    if (session === undefined || !/^[A-Za-z0-9._-]+$/.test(session)) {
      send(res, 404, notFoundPage('Unknown session', 'The session id is malformed.'), undefined, head)
      return
    }
    const runtime = await registry.forSession(session)
    if (runtime === undefined) {
      send(
        res,
        404,
        notFoundPage('Unknown session', 'No live session with that id has a working directory.'),
        undefined,
        head,
      )
      return
    }
    const rest = parts.slice(2)

    if (rest[0] === '_' && rest[1] === 'comments' && comments !== undefined) {
      await handleComments(req, res, head, session, comments, rest.slice(1))
      return
    }

    if (rest[0] === '_') {
      const endpoint = rest[1]
      if (endpoint === undefined) {
        send(res, 404, notFoundPage('Not found', 'Unknown design endpoint.'), undefined, head)
        return
      }
      if (endpoint === 'assets') {
        const decoded = decodeSegment(rest.slice(2).join('/'))
        if (decoded === undefined) {
          send(res, 404, notFoundPage('Not found', 'Asset not found.'), undefined, head)
          return
        }
        try {
          await serveAsset(res, assetsDir, decoded, head)
        } catch {
          send(res, 404, notFoundPage('Not found', 'Asset not found.'), undefined, head)
        }
        return
      }
      if (endpoint === 'project') {
        let project
        try {
          project = await runtime.get()
        } catch (error) {
          send(
            res,
            500,
            notFoundPage('Preview failed', error instanceof Error ? error.message : String(error)),
            undefined,
            head,
          )
          return
        }
        const body = JSON.stringify(buildPayload(session, runtime.currentRevision, registry.kitVersion, project))
        send(res, 200, body, 'application/json; charset=utf-8', head)
        return
      }
      if (endpoint === 'events') {
        await runtime.get().catch(() => undefined)
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        res.write('retry: 1000\n\n')
        const listener = (revision: number): void => {
          if (!res.writableEnded) res.write('event: revision\ndata: ' + JSON.stringify({ rev: revision }) + '\n\n')
        }
        const unsubscribe = runtime.subscribe(listener)
        const ping = setInterval(() => {
          if (!res.writableEnded) res.write(': ping\n\n')
        }, 15000)
        ping.unref?.()
        const close = (): void => {
          clearInterval(ping)
          unsubscribe()
        }
        req.on('close', close)
        res.on('close', close)
        return
      }
      if (endpoint === 'files') {
        const decoded = decodeSegment(rest.slice(2).join('/'))
        if (decoded === undefined) {
          send(res, 404, notFoundPage('Not found', 'File not found.'), undefined, head)
          return
        }
        await serveProjectMedia(res, runtime.folder, decoded, head)
        return
      }
      send(res, 404, notFoundPage('Not found', 'Unknown design endpoint.'), undefined, head)
      return
    }

    // Shell requests: /design/<session>/[<screen>]
    let project
    try {
      project = await runtime.get()
    } catch (error) {
      send(
        res,
        500,
        notFoundPage('Preview failed', error instanceof Error ? error.message : String(error)),
        undefined,
        head,
      )
      return
    }
    const screen = rest.length === 0 ? undefined : decodeSegment(rest.join('/'))
    const available = project.screens.filter((candidate) => candidate.id !== '').map((candidate) => candidate.id)
    if (screen !== undefined && (screen === '' || !available.includes(screen))) {
      send(
        res,
        404,
        notFoundPage('Unknown screen', 'No screen with id "' + (screen ?? '') + '" in this design project.', available),
        undefined,
        head,
      )
      return
    }
    if (available.length === 0 && project.diagnostics.some((diagnostic) => diagnostic.code === 'project-missing')) {
      send(
        res,
        404,
        notFoundPage('No design project', 'This session has no design project. Run design_init first.'),
        undefined,
        head,
      )
      return
    }
    try {
      if (url.searchParams.get('deterministic') === '1') {
        const assets = await collectDeterministicAssets(project)
        const document = await deterministicDocument(
          assetsDir,
          buildPayload(session, runtime.currentRevision, registry.kitVersion, project, assets),
        )
        send(res, 200, document.html, 'text/html; charset=utf-8', head, {
          'content-security-policy': document.csp,
          'cross-origin-resource-policy': 'same-origin',
          'x-frame-options': 'DENY',
        })
        return
      }
      const html = await renderShell(assetsDir, session)
      send(res, 200, html, 'text/html; charset=utf-8', head, {
        'content-security-policy': "frame-ancestors 'self'",
        'cross-origin-resource-policy': 'same-origin',
      })
    } catch (error) {
      send(
        res,
        500,
        notFoundPage(
          'Preview unavailable',
          'The renderer bundle is missing: ' + (error instanceof Error ? error.message : String(error)),
        ),
        undefined,
        head,
      )
    }
  }
}

/** Decode one URL path segment, returning undefined on malformed escapes. */
function decodeSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

/** Read one local file for tests and diagnostics. */
export async function readLocalFile(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

/** Exported for route tests. */
export { send as sendForTest, serveAsset as serveAssetForTest, serveProjectMedia as serveProjectMediaForTest }
export type { ProjectRegistry }
