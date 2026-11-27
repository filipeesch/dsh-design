/** Registry of design projects keyed by absolute design folder path. */
import { join, resolve } from 'node:path'
import { ProjectRuntime } from './runtime.ts'
import type { DesignProject } from '@filipeesch/dsh-design-core'
import type { RuntimeOptions } from './runtime.ts'

const MAX_IDLE_PREVIEWS = 4

/** Options for the project registry. */
export interface RegistryOptions extends RuntimeOptions {
  readonly folderName: string
  /** Installed kit version reported to the preview and tools. */
  readonly kitVersion: string
  /** Resolve a session's effective working directory. */
  readonly resolveSessionCwd: (sessionId: string) => Promise<string | undefined> | string | undefined
  /** Absolute origin used to build preview URLs. */
  readonly origin: () => string
}

/** Shared project registry: one watcher per design folder, shared by sessions. */
export class ProjectRegistry {
  private readonly projects = new Map<string, ProjectRuntime>()
  private readonly idlePreviews = new Map<string, DesignProject>()
  private readonly learned = new Map<string, string>()
  private readonly options: RegistryOptions
  private readonly created: RuntimeOptions
  /** Installed kit version reported to the preview and tools. */
  readonly kitVersion: string

  constructor(options: RegistryOptions) {
    this.options = options
    this.kitVersion = options.kitVersion
    const {
      folderName: _folderName,
      resolveSessionCwd: _resolve,
      origin: _origin,
      kitVersion: _kitVersion,
      ...runtime
    } = options
    this.created = {
      ...runtime,
      onStop: (runtimeProject) => {
        const folder = runtimeProject.folder
        if (this.projects.get(folder) !== runtimeProject) return
        this.projects.delete(folder)
        const previous = runtimeProject.peekPreview()
        if (previous === undefined) return
        this.idlePreviews.set(folder, previous)
        if (this.idlePreviews.size > MAX_IDLE_PREVIEWS) {
          const oldest = this.idlePreviews.keys().next().value
          if (oldest !== undefined) this.idlePreviews.delete(oldest)
        }
      },
    }
  }

  /** Remember the working directory observed for a session. */
  learnSession(sessionId: string, cwd: string | undefined): void {
    if (cwd !== undefined && cwd.length > 0) this.learned.set(sessionId, resolve(cwd))
  }

  /** Resolve a session's working directory, preferring an observed value. */
  async resolveCwd(sessionId: string): Promise<string | undefined> {
    const learned = this.learned.get(sessionId)
    if (learned !== undefined) return learned
    const cwd = await this.options.resolveSessionCwd(sessionId)
    if (cwd !== undefined) this.learned.set(sessionId, resolve(cwd))
    return cwd
  }

  /** Design folder for a session, or undefined without a working directory. */
  async folderForSession(sessionId: string): Promise<string | undefined> {
    const cwd = await this.resolveCwd(sessionId)
    return cwd === undefined ? undefined : join(cwd, this.options.folderName)
  }

  /** Runtime for a session's design folder, or undefined without a working directory. */
  async forSession(sessionId: string): Promise<ProjectRuntime | undefined> {
    const folder = await this.folderForSession(sessionId)
    return folder === undefined ? undefined : this.forFolder(folder)
  }

  /** Runtime for an absolute design folder, created lazily. */
  forFolder(folder: string): ProjectRuntime {
    const absolute = resolve(folder)
    let runtime = this.projects.get(absolute)
    if (runtime === undefined) {
      const previous = this.idlePreviews.get(absolute)
      this.idlePreviews.delete(absolute)
      runtime = new ProjectRuntime(absolute, this.created, previous)
      this.projects.set(absolute, runtime)
    }
    runtime.ensureWatching()
    return runtime
  }

  /** Number of live runtimes, for registry tests. */
  get size(): number {
    return this.projects.size
  }

  /** Absolute preview URL for a session and optional screen. */
  previewUrl(sessionId: string, screen?: string): string {
    const base = this.options.origin() + '/design/' + encodeURIComponent(sessionId) + '/'
    return screen === undefined ? base : base + encodeURIComponent(screen)
  }

  /** Dispose every runtime. */
  dispose(): void {
    for (const runtime of this.projects.values()) runtime.dispose()
    this.projects.clear()
    this.idlePreviews.clear()
  }
}
