/** One live design folder: lazy load, debounced watcher, revision counter. */
import { watch, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { loadProject, type DesignProject, type KitMetadata, type ParseCacheEntry } from '@filipeesch/dsh-design-core'

/** Source files that make up a design project. */
const SOURCE_FILES = ['design.json', 'tokens.json'] as const

/** Options for one project runtime. */
export interface RuntimeOptions {
  readonly kit: KitMetadata
  readonly installedKitVersion: string
  /** Debounce for filesystem events. */
  readonly debounceMs?: number
  /** Time with no subscribers before the watcher stops. */
  readonly idleStopMs?: number
  readonly onStop?: (runtime: ProjectRuntime) => void
}

/** Fingerprint of every source file in a design folder. */
export type FolderFingerprint = Map<string, string>

/**
 * Fingerprint the source files under a design folder. Only project sources
 * participate, so unrelated edits never trigger design validation.
 */
export async function fingerprintFolder(folder: string): Promise<FolderFingerprint> {
  const result: FolderFingerprint = new Map()
  const record = async (absolute: string, name: string): Promise<void> => {
    try {
      const info = await stat(absolute)
      result.set(name, String(info.mtimeMs) + ':' + String(info.size))
    } catch {
      result.set(name, 'missing')
    }
  }
  for (const name of SOURCE_FILES) await record(join(folder, name), name)
  try {
    const entries = await readdir(join(folder, 'screens'), { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.dsx'))
        await record(join(folder, 'screens', entry.name), 'screens/' + entry.name)
    }
  } catch {
    // A missing screens directory is a valid empty project.
  }
  return result
}

/** Files whose fingerprint changed between two reads. */
export function changedFiles(before: FolderFingerprint, after: FolderFingerprint): string[] {
  const names = new Set([...before.keys(), ...after.keys()])
  const changed: string[] = []
  for (const name of names) if (before.get(name) !== after.get(name)) changed.push(name)
  return changed.sort((left, right) => left.localeCompare(right))
}

/** One design folder's live project state. */
export class ProjectRuntime {
  readonly folder: string
  private readonly options: RuntimeOptions
  private readonly parseCache = new Map<string, ParseCacheEntry>()
  private readonly subscribers = new Set<(revision: number) => void>()
  private project: DesignProject | undefined
  private revision = 0
  private watcher: FSWatcher | undefined
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(folder: string, options: RuntimeOptions) {
    this.folder = folder
    this.options = options
  }

  /** Current project, loading it on first read. */
  async get(): Promise<DesignProject> {
    if (this.project === undefined) await this.reload()
    return this.project as DesignProject
  }

  /** Current revision. */
  get currentRevision(): number {
    return this.revision
  }

  /** Current project without loading. */
  peek(): DesignProject | undefined {
    return this.project
  }

  /** Reload from disk, reusing cached parses for unchanged screen files. */
  async reload(): Promise<DesignProject> {
    const run = async (): Promise<DesignProject> => {
      if (this.disposed) return this.project as DesignProject
      const next = await loadProject({
        folder: this.folder,
        kit: this.options.kit,
        installedKitVersion: this.options.installedKitVersion,
        ...(this.project === undefined ? {} : { previous: this.project }),
        parseCache: this.parseCache,
      })
      this.project = next
      this.revision += 1
      for (const subscriber of [...this.subscribers]) {
        try {
          subscriber(this.revision)
        } catch (error) {
          this.options.onStop?.(this)
          void error
        }
      }
      return next
    }
    const queued = this.queue.then(run, run)
    this.queue = queued.catch(() => undefined)
    return queued
  }

  /** Start the watcher lazily and reset the idle stop. */
  ensureWatching(): void {
    if (this.disposed) return
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
    if (this.watcher !== undefined) return
    try {
      this.watcher = watch(this.folder, { recursive: true }, (_event, filename) => {
        if (filename !== null && (filename.includes('.cache') || filename.split(sep).includes('node_modules'))) return
        this.scheduleReload()
      })
      this.watcher.on('error', () => {
        this.stopWatcher()
      })
    } catch {
      this.watcher = undefined
    }
  }

  /** Debounced reload triggered by a file event. */
  private scheduleReload(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      void this.reload().catch(() => undefined)
    }, this.options.debounceMs ?? 50)
  }

  /** Subscribe to revision changes. */
  subscribe(listener: (revision: number) => void): () => void {
    this.subscribers.add(listener)
    this.ensureWatching()
    return () => {
      this.unsubscribe(listener)
    }
  }

  /** Remove a subscriber, scheduling idle stop when the last one leaves. */
  unsubscribe(listener: (revision: number) => void): void {
    this.subscribers.delete(listener)
    if (this.subscribers.size === 0) {
      if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
      this.idleTimer = setTimeout(
        () => {
          this.idleTimer = undefined
          if (this.subscribers.size === 0) this.stopWatcher()
        },
        this.options.idleStopMs ?? 5 * 60 * 1000,
      )
      this.idleTimer.unref?.()
    }
  }

  /** Stop the watcher but keep the last project for a later restart. */
  stopWatcher(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    if (this.watcher !== undefined) {
      this.watcher.close()
      this.watcher = undefined
    }
    this.options.onStop?.(this)
  }

  /** Fingerprint the project sources. */
  fingerprint(): Promise<FolderFingerprint> {
    return fingerprintFolder(this.folder)
  }

  /** Dispose the watcher and timers. */
  dispose(): void {
    this.disposed = true
    this.subscribers.clear()
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    this.stopWatcher()
  }
}

/** Relative file name used in diagnostics and fingerprints. */
export function relativeFile(folder: string, absolute: string): string {
  return relative(folder, absolute).split(sep).join('/')
}
