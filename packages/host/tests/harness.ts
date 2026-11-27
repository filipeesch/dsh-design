import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scaffoldProject } from '@filipeesch/dsh-design-core'
import { apply as applyHost, type DesignService } from '../src/index.ts'
import { apply as applyTools } from '../src/tools.ts'
import { createRouteHandler } from '../src/routes.ts'
import { ProjectRegistry } from '../src/registry.ts'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'

export interface HostHarness {
  readonly root: string
  readonly service: DesignService
  readonly routes: any[]
  readonly tools: Map<string, any>
  readonly promptSections: any[]
  readonly handlers: Record<string, any>
  readonly sessions: Map<string, { id: string; header: { cwd?: string } }>
  readonly registry: ProjectRegistry
  readonly route: (req: any, res: any) => Promise<void>
  readonly exec: (name: string, cwd: string, extra?: Record<string, unknown>) => any
  close(): void
}

export async function createHarness(
  options: {
    withProject?: boolean
    assetsDir?: string
    folderName?: string
    debounceMs?: number
    effectiveCwd?: (session: any) => string | undefined
    sessionController?: any
    extraServices?: Record<string, unknown>
    chromiumPath?: string
    browserTimeoutMs?: number
  } = {},
): Promise<HostHarness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-design-host-'))
  if (options.withProject !== false) await scaffoldProject(root, { kitVersion: KIT_VERSION })
  const routes: any[] = []
  const tools = new Map<string, any>()
  const handlers: Record<string, any> = {}
  const promptSections: any[] = []
  const sessions = new Map<string, { id: string; header: { cwd?: string } }>()
  const disposers: (() => void)[] = []
  const webServer = {
    register(route: any) {
      routes.push(route)
      return () => undefined
    },
    getOrigin() {
      return 'http://127.0.0.1:3091'
    },
  }
  const ctx: any = {
    webServer,
    tools: {
      register(definition: any) {
        tools.set(definition.name, definition)
      },
    },
    systemPrompt: {
      section(section: any) {
        promptSections.push(section)
        return () => undefined
      },
      getSectionOrder() {
        return 1000
      },
    },
    effect(callback: () => unknown) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
      return () => undefined
    },
    on(event: string, listener: any) {
      handlers[event] = listener
      return () => undefined
    },
    get(name: string) {
      if (name === 'webServer') return webServer
      if (name === 'sessions') return { get: (id: string) => sessions.get(id) }
      if (name === 'sessionController') return options.sessionController
      if (name === 'workingDirectory')
        return options.effectiveCwd === undefined
          ? undefined
          : { get: (session: any) => options.effectiveCwd?.(session) }
      return options.extraServices?.[name]
    },
    logger: { info() {}, warn() {}, error() {} },
    inject(_services: string[], callback: (scope: any) => void) {
      callback(ctx)
      return () => undefined
    },
    provide(name: string, value: unknown) {
      ;(ctx as Record<string, unknown>)[name] = value
      return () => undefined
    },
  }
  applyHost(ctx, {
    folderName: options.folderName ?? 'design',
    debounceMs: options.debounceMs ?? 10,
    idleStopMs: 50,
    ...(options.assetsDir === undefined ? {} : { assetsDir: options.assetsDir }),
    ...(options.chromiumPath === undefined ? {} : { chromiumPath: options.chromiumPath }),
    ...(options.browserTimeoutMs === undefined ? {} : { browserTimeoutMs: options.browserTimeoutMs }),
  })
  const service = ctx.design as DesignService
  applyTools(ctx)
  const route = createRouteHandler(service.registry, options.assetsDir, service.comments)
  let next = 0
  return {
    root,
    service,
    routes,
    tools,
    promptSections,
    handlers,
    sessions,
    registry: service.registry!,
    route,
    exec(name: string, cwd: string, extra: Record<string, unknown> = {}) {
      next += 1
      const sessionId = 'session-' + String(next)
      const session = { id: sessionId, header: { cwd } }
      sessions.set(sessionId, session)
      return {
        callId: 'call-' + String(next),
        name,
        arguments: {},
        signal: new AbortController().signal,
        token: Symbol(name),
        agent: { session },
        ...extra,
      }
    },
    close() {
      for (const dispose of disposers) dispose()
      service.registry?.dispose()
    },
  }
}

/** Invoke one registered tool. */
export async function callTool(harness: HostHarness, name: string, args: Record<string, unknown>, cwd: string) {
  const tool = harness.tools.get(name)
  if (tool === undefined) throw new Error('missing tool ' + name)
  return await tool.execute(args, harness.exec(name, cwd))
}

/** Run the tools/execute and tools/post-execute listeners around one body. */
export async function runPipeline(harness: HostHarness, exec: any, body: () => Promise<void>): Promise<any> {
  const execute = harness.handlers['tools/execute']
  const post = harness.handlers['tools/post-execute']
  let result: any = { isError: false, content: [] }
  if (execute !== undefined) {
    result = await execute(exec, async () => {
      await body()
      return result
    })
  } else {
    await body()
  }
  if (post === undefined) return { kind: 'accept' }
  return await post(exec, result, async () => ({ kind: 'accept' }))
}

export async function writeScreen(root: string, file: string, source: string): Promise<void> {
  await mkdir(join(root, 'design', 'screens'), { recursive: true })
  await writeFile(join(root, 'design', 'screens', file), source)
}

export { kitMetadata }
