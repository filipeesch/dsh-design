/** DSH host plugin: preview routes and the shared project registry. */
import { join, resolve } from 'node:path'
import { normalizeFolderName } from '@filipeesch/dsh-design-core'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { BrowserSessions } from './browser.ts'
import { CommentStore, type CommentPromptPort } from './comments.ts'
import { ProjectRegistry } from './registry.ts'
import { createRouteHandler, defaultAssetsDir } from './routes.ts'

/** Plugin name. */
export const name = 'design-host'

/** Deployment configuration for the design host. */
export interface DesignConfig {
  /** Design folder name inside a session working directory. */
  folderName?: string
  /** Debounce for filesystem events in milliseconds. */
  debounceMs?: number
  /** Idle time before a project watcher stops. */
  idleStopMs?: number
  /** Built renderer assets used by deterministic headless checks. */
  assetsDir?: string
  /** Operator-configured Chromium executable for headless checks. */
  chromiumPath?: string
  /** Overall timeout for one headless check. */
  browserTimeoutMs?: number
  /** Maximum live session browsers. */
  maxBrowserSessions?: number
  /** Fixed browser viewport height for headless checks. */
  viewportHeight?: number
}

/**
 * The design host service: one route prefix, one registry, one watcher per
 * design folder. It is provided as `ctx.design` for the preset-scoped tools.
 */
export class DesignService {
  /** Shared project registry, absent when the webServer extension point is missing. */
  readonly registry: ProjectRegistry | undefined
  /** Configured design folder name (one safe path segment). */
  readonly folderName: string
  /** Warm browser sessions for headless checks, keyed by DSH session. */
  readonly browsers: BrowserSessions
  /** Built renderer assets used by deterministic checks. */
  readonly assetsDir: string
  /** In-memory review comments and submission receipts, keyed by session. */
  readonly comments: CommentStore
  /** Overall timeout for one headless check. */
  readonly browserTimeoutMs: number
  private readonly ctx: any

  constructor(ctx: any, config: DesignConfig = {}) {
    this.ctx = ctx
    const folderName = normalizeFolderName(config.folderName ?? 'design')
    this.folderName = folderName
    this.assetsDir = config.assetsDir ?? defaultAssetsDir()
    this.browserTimeoutMs = config.browserTimeoutMs ?? 20000
    this.browsers = new BrowserSessions({
      ...(config.chromiumPath === undefined ? {} : { executablePath: config.chromiumPath }),
      ...(config.browserTimeoutMs === undefined ? {} : { timeoutMs: config.browserTimeoutMs }),
      ...(config.maxBrowserSessions === undefined ? {} : { maxSessions: config.maxBrowserSessions }),
      ...(config.viewportHeight === undefined ? {} : { viewportHeight: config.viewportHeight }),
    })
    const settings = {
      folderName,
      debounceMs: config.debounceMs ?? 50,
      idleStopMs: config.idleStopMs ?? 5 * 60 * 1000,
    }
    this.comments = new CommentStore({ prompt: () => this.promptPort() })
    this.registry = new ProjectRegistry({
      ...settings,
      kit: kitMetadata,
      installedKitVersion: KIT_VERSION,
      kitVersion: KIT_VERSION,
      resolveSessionCwd: (sessionId: string) => this.resolveSessionCwd(sessionId),
      origin: () => this.ctx.get('webServer')?.getOrigin?.() as string,
    })
  }

  /** Resolve a session's effective working directory without filesystem I/O. */
  resolveSessionCwd(sessionId: string): string | undefined {
    let session: any
    try {
      session = this.ctx.get('sessions')?.get?.(sessionId)
    } catch {
      session = undefined
    }
    if (session === undefined) return undefined
    try {
      const workingDirectory = this.ctx.get('workingDirectory')
      if (workingDirectory?.get !== undefined) return workingDirectory.get(session) as string
    } catch {
      // Fall through to the session header.
    }
    return session.header?.cwd as string | undefined
  }

  /** Design folder for an arbitrary working directory. */
  folderForCwd(cwd: string): string {
    return join(resolve(cwd), this.folderName)
  }

  /** Resolve a session's design folder, or undefined without a working directory. */
  async folderForSession(sessionId: string): Promise<string | undefined> {
    return this.registry?.folderForSession(sessionId)
  }

  /** Preview URL for a session and optional screen. */
  previewUrl(sessionId: string, screen?: string): string {
    return this.registry?.previewUrl(sessionId, screen) ?? ''
  }

  /** Release one session's browser and pending comments; safe when none exist. */
  async disposeSession(sessionId: string): Promise<void> {
    this.comments.clearSession(sessionId)
    await this.browsers.disposeSession(sessionId)
  }

  /** Resolve the host prompt face lazily, so a late controller is still used. */
  private promptPort(): CommentPromptPort | undefined {
    let controller: any
    try {
      controller = this.ctx.get?.('sessionController') ?? this.ctx.sessionController
    } catch {
      controller = undefined
    }
    if (controller === undefined || typeof controller.prompt !== 'function') return undefined
    return {
      async prompt(request, signal) {
        const result = await controller.prompt(
          {
            requestId: request.requestId,
            sessionId: request.sessionId,
            mode: request.mode,
            content: request.content,
          },
          signal,
        )
        if (result !== null && typeof result === 'object' && 'ok' in result && result.ok === false) {
          return result as { ok: false; error: { code: string; message: string } }
        }
        if (result !== null && typeof result === 'object' && result.accepted === true) return { accepted: true }
        return { ok: false, error: { code: 'not-accepted', message: 'the session did not accept the prompt' } }
      },
    }
  }

  /** Release every browser, project runtime, and pending comment. */
  async dispose(): Promise<void> {
    this.comments.dispose()
    this.registry?.dispose()
    await this.browsers.disposeAll()
  }
}

/**
 * Register the design service and preview route. A DSH build without
 * `webServer` logs a clear error and keeps running, so one unavailable
 * extension point never prevents the rest of DSH from starting.
 */
export function apply(ctx: any, config: DesignConfig = {}): void {
  const missing = (): void => {
    ctx?.logger?.error?.(
      'design: missing extension point "webServer"; the preview route is disabled and the rest of DSH keeps running',
    )
  }
  const start = (): void => {
    const webServer = ctx.get?.('webServer') ?? ctx.webServer
    if (webServer === undefined || typeof webServer.register !== 'function') {
      missing()
      return
    }
    const service = new DesignService(ctx, config)
    ctx.provide('design', service)
    if (typeof ctx.on === 'function') {
      ctx.on('session/disposed', (event: any) => {
        const sessionId = typeof event === 'string' ? event : (event?.id ?? event?.sessionId ?? event?.session?.id)
        if (typeof sessionId === 'string' && sessionId !== '') void service.disposeSession(sessionId)
      })
    }
    ctx.effect(
      () =>
        webServer.register({
          kind: 'prefix',
          path: '/design',
          handler: createRouteHandler(service.registry!, service.assetsDir, service.comments),
        }),
      'design: preview route',
    )
    ctx.effect(() => () => service.dispose(), 'design: project and browser resources')
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], start)
    const timer = setTimeout(() => {
      if (ctx.get?.('design') === undefined) missing()
    }, 5000)
    timer.unref?.()
    ctx.effect(() => () => clearTimeout(timer), 'design: activation diagnostic')
    return
  }
  start()
}

export default definePlugin()

function definePlugin(): { name: string; apply: typeof apply } {
  return { name, apply }
}
