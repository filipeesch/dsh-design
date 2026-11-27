/** One live design folder: lazy load, debounced watcher, and published snapshots. */
import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { relative, sep } from 'node:path'
import {
  loadProject,
  localProjectSourceReader,
  readProjectSources,
  type DesignProject,
  type KitMetadata,
  type ParseCacheEntry,
} from '@filipeesch/dsh-design-core'

/** Options for one project runtime. */
export interface RuntimeOptions {
  readonly kit: KitMetadata
  readonly installedKitVersion: string
  /** Debounce for filesystem events. */
  readonly debounceMs?: number
  /** Time with no preview activity before the watcher stops. */
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
  const inventory = await readProjectSources(localProjectSourceReader(folder))
  return new Map([...inventory.entries].map(([file, entry]) => [file, entry.fingerprint]))
}

/** Files whose fingerprint changed between two reads. */
export function changedFiles(before: FolderFingerprint, after: FolderFingerprint): string[] {
  const names = new Set([...before.keys(), ...after.keys()])
  const changed: string[] = []
  for (const name of names) if (before.get(name) !== after.get(name)) changed.push(name)
  return changed.sort((left, right) => left.localeCompare(right))
}

/** Project data and its revision identity, published together. */
export interface ProjectSnapshot {
  readonly project: DesignProject
  readonly revision: number
  readonly token: string
}

/** One design folder's live project state. */
export class ProjectRuntime {
  readonly folder: string
  private readonly options: RuntimeOptions
  private readonly parseCache = new Map<string, ParseCacheEntry>()
  private generation = randomUUID()
  private previousPreview: DesignProject | undefined
  private snapshot: (ProjectSnapshot & { generation: string }) | undefined
  private snapshotWatcher: FSWatcher | undefined
  private previewLoad: Promise<ProjectSnapshot> | undefined
  private watcher: FSWatcher | undefined
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(folder: string, options: RuntimeOptions, previousPreview?: DesignProject) {
    this.folder = folder
    this.options = options
    this.previousPreview = previousPreview
  }

  /** Recovery seed for an idle preview, not a published or current snapshot. */
  peekPreview(): DesignProject | undefined {
    return this.previousPreview
  }

  /** Current project, loading it on first read. */
  async get(): Promise<DesignProject> {
    return this.snapshot?.project ?? this.reload()
  }

  /** Current revision. */
  get currentRevision(): number {
    return this.snapshot?.revision ?? 0
  }

  /** Current project without loading. */
  peek(): DesignProject | undefined {
    return this.snapshot?.project
  }

  /** Read current sources without publishing a revision or returning retained source as current. */
  readCurrent(): Promise<DesignProject> {
    const previous = this.peek() ?? this.previousPreview
    return loadProject({
      folder: this.folder,
      kit: this.options.kit,
      installedKitVersion: this.options.installedKitVersion,
      ...(previous === undefined ? {} : { previous }),
      parseCache: this.parseCache,
    })
  }

  /** Reload from disk, reusing cached parses for unchanged screen files. */
  async reload(): Promise<DesignProject> {
    return (await this.reloadSnapshot()).project
  }

  private reloadSnapshot(onlyIfChanged = false): Promise<ProjectSnapshot> {
    const run = async (): Promise<ProjectSnapshot> => {
      if (this.disposed) throw new Error('Project runtime is disposed.')
      const generation = this.generation
      const watcher = this.watcher
      const project = await this.readCurrent()
      if (this.disposed) throw new Error('Project runtime is disposed.')
      const previous = this.snapshot
      if (
        onlyIfChanged &&
        previous?.generation === generation &&
        this.snapshotWatcher === watcher &&
        previous.project.sourceIdentity === project.sourceIdentity
      )
        return previous
      const revision = this.currentRevision + 1
      const snapshot = { project, revision, generation, token: generation + ':' + String(revision) }
      this.snapshot = snapshot
      this.snapshotWatcher = watcher
      return snapshot
    }
    const queued = this.queue.then(run, run)
    this.queue = queued.catch(() => undefined)
    return queued
  }

  /** Read a watched snapshot, renewing the lease without source I/O when warm. */
  async previewSnapshot(): Promise<ProjectSnapshot> {
    this.ensureWatching()
    if (this.disposed) throw new Error('Project runtime is disposed.')
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.stopWatcher(), this.options.idleStopMs ?? 5 * 60 * 1000)
    this.idleTimer.unref?.()

    // Install the watcher before the initial read so a racing edit schedules a reload.
    // A snapshot read before this watcher was installed may have missed an edit.
    const snapshot = this.snapshot
    const current =
      snapshot?.generation === this.generation && this.snapshotWatcher === this.watcher
        ? snapshot
        : await (this.previewLoad ??= this.reloadSnapshot().finally(() => {
            this.previewLoad = undefined
          }))
    this.previousPreview = current.project
    return current
  }

  /** Start watching lazily, including when a design folder first appears. */
  ensureWatching(): void {
    if (this.disposed || this.watcher !== undefined) return
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
      void this.reloadSnapshot(true).catch(() => undefined)
    }, this.options.debounceMs ?? 50)
  }

  /** Stop the watcher but keep the last project for a later restart. */
  stopWatcher(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    this.watcher?.close()
    this.watcher = undefined
    this.generation = randomUUID()
    this.options.onStop?.(this)
  }

  /** Fingerprint the project sources. */
  fingerprint(): Promise<FolderFingerprint> {
    return fingerprintFolder(this.folder)
  }

  /** Dispose the watcher and timers. */
  dispose(): void {
    this.disposed = true
    this.stopWatcher()
  }
}

/** Relative file name used in diagnostics and fingerprints. */
export function relativeFile(folder: string, absolute: string): string {
  return relative(folder, absolute).split(sep).join('/')
}
