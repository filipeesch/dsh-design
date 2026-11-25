/**
 * Lazily launched, isolated Chromium sessions for headless design checks.
 *
 * One browser per active DSH session is started on first use and reused for
 * later checks; work inside a session is serialized. Every check gets a fresh
 * browser context, so no session observes another session's page state. A
 * bounded pool counts live browsers and in-flight launches, evicts only idle
 * sessions with no queued work, and closes browsers that arrive after a
 * cancellation or disposal.
 */
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { deterministicDocument } from './deterministic.ts'
import type { PreviewPayload } from './payload.ts'

/** Failure classes reported to tools without pretending a run succeeded. */
export type BrowserErrorCode = 'chromium-missing' | 'timeout' | 'cancelled' | 'browser-failed'

/** Explicit browser infrastructure failure. */
export class DesignBrowserError extends Error {
  readonly code: BrowserErrorCode

  constructor(code: BrowserErrorCode, message: string) {
    super(message)
    this.name = 'DesignBrowserError'
    this.code = code
  }
}

/** One check request: immutable payload, deterministic document assets, viewport. */
export interface RenderRequest {
  readonly sessionId: string
  readonly payload: PreviewPayload
  readonly assetsDir: string
  readonly screen: string
  readonly breakpoint: string
  readonly breakpointWidth: number
  readonly state?: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/** Options for the browser session pool. */
export interface BrowserSessionsOptions {
  /** Injectable launcher used by tests; defaults to lazy playwright-core. */
  readonly launch?: () => Promise<Browser>
  /** Operator-configured Chromium executable. */
  readonly executablePath?: string
  /** Maximum number of live or launching session browsers. */
  readonly maxSessions?: number
  /** Fixed browser viewport height for every check. */
  readonly viewportHeight?: number
  /** Overall timeout for one check. */
  readonly timeoutMs?: number
}

/** Launch options always used for design checks. */
export interface ChromiumLaunchOptions {
  readonly headless: true
  readonly chromiumSandbox: true
  readonly executablePath?: string
}

interface SessionRecord {
  readonly id: string
  browser?: Browser
  launching?: Promise<Browser>
  queue: Promise<unknown>
  /** Callers holding or queued for this browser. */
  users: number
  /** Callers waiting for this session's in-flight launch. */
  awaiting: number
  /** Checks currently using this browser. */
  active: number
  /** Checks queued behind an active check. */
  queueDepth: number
  lastUsed: number
  /** True once a caller successfully acquired this browser. */
  warmed: boolean
  disposed: boolean
}

interface Lease {
  readonly record: SessionRecord
  release(): void
}

interface CapacityWaiter {
  readonly sessionId: string
  readonly generation: number
  resolve(): void
  reject(error: Error): void
}

/** Default fixed viewport height for design checks. */
export const DEFAULT_CHECK_VIEWPORT_HEIGHT = 900
/** Default overall check timeout. */
export const DEFAULT_CHECK_TIMEOUT_MS = 20000
/** Default maximum live session browsers. */
export const DEFAULT_MAX_SESSIONS = 4

const MISSING_GUIDANCE =
  'Headless Chromium is unavailable. Install the Playwright Chromium matching playwright-core (for example "pnpm exec playwright install chromium"), or set DSH_DESIGN_CHROMIUM_PATH to a Chromium executable. Preview and static design tools keep working without a browser.'

/** Actionable guidance when the sandboxed browser cannot start. */
export const SANDBOX_GUIDANCE =
  ' Design checks always launch Chromium with chromiumSandbox: true and never fall back to an unsandboxed browser. If this executable cannot run with its sandbox, use a normal Chrome for Testing build or point DSH_DESIGN_CHROMIUM_PATH at one.'

/** Launch options for every headless check. */
export function chromiumLaunchOptions(executablePath?: string): ChromiumLaunchOptions {
  return {
    headless: true,
    chromiumSandbox: true,
    ...(executablePath === undefined || executablePath === '' ? {} : { executablePath }),
  }
}

function cancelled(): DesignBrowserError {
  return new DesignBrowserError('cancelled', 'The design check was cancelled.')
}

function timedOut(timeoutMs: number): DesignBrowserError {
  return new DesignBrowserError('timeout', 'The design check exceeded its ' + String(timeoutMs) + ' ms timeout.')
}

function disposedError(): DesignBrowserError {
  return new DesignBrowserError('browser-failed', 'The design browser pool has been disposed.')
}

function sessionDisposedError(sessionId: string): DesignBrowserError {
  return new DesignBrowserError(
    'browser-failed',
    'The design session "' + sessionId + '" was disposed while a browser admission was pending.',
  )
}

/** Whether a signal has been aborted, without narrowing later checks. */
function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/** Remaining milliseconds before a deadline, never below one. */
function remaining(deadline: number): number {
  return Math.max(1, deadline - Date.now())
}

/** Reject a promise when the signal aborts or the deadline passes. */
async function withDeadline<T>(promise: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  if (signal?.aborted === true) {
    void promise.catch(() => undefined)
    throw cancelled()
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(timedOut(timeoutMs)), Math.max(1, timeoutMs))
    timer.unref?.()
    if (signal !== undefined) {
      onAbort = () => reject(cancelled())
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
  try {
    return await Promise.race([promise, guard])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (signal !== undefined && onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

/** Wait for the renderer's committed state instead of an arbitrary sleep. */
export async function settleFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((ready) => {
        requestAnimationFrame(() => requestAnimationFrame(() => ready()))
      }),
  )
}

/** Session pool for browser-backed checks. */
export class BrowserSessions {
  private readonly options: BrowserSessionsOptions
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly capacityWaiters = new Set<CapacityWaiter>()
  private readonly retirements = new Set<Promise<void>>()
  private readonly sessionGenerations = new Map<string, number>()
  private retiring = 0
  private disposed = false

  constructor(options: BrowserSessionsOptions = {}) {
    this.options = options
  }

  /** Number of live, launching, or retiring session browsers. */
  get size(): number {
    return this.sessions.size + this.retiring
  }

  /** Fixed viewport height used by every check. */
  get viewportHeight(): number {
    return this.options.viewportHeight ?? DEFAULT_CHECK_VIEWPORT_HEIGHT
  }

  /** Whether a session currently owns an active live or launching browser. */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** Number of browser or launch retirements whose close has not resolved. */
  get retiringBrowsers(): number {
    return this.retiring
  }

  /** Launch (or reuse) a session browser without running a check. */
  async prewarm(sessionId: string): Promise<void> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS
    const lease = await this.acquire(sessionId, undefined, timeoutMs, Date.now() + timeoutMs)
    lease.release()
  }

  /** Lazily launch the configured browser. */
  private async launch(): Promise<Browser> {
    if (this.options.launch !== undefined) {
      try {
        return await this.options.launch()
      } catch (error) {
        throw new DesignBrowserError(
          'chromium-missing',
          MISSING_GUIDANCE +
            SANDBOX_GUIDANCE +
            ' Underlying error: ' +
            (error instanceof Error ? error.message : String(error)),
        )
      }
    }
    let playwright: typeof import('playwright-core')
    try {
      playwright = await import('playwright-core')
    } catch (error) {
      throw new DesignBrowserError(
        'chromium-missing',
        MISSING_GUIDANCE +
          ' playwright-core could not be loaded: ' +
          (error instanceof Error ? error.message : String(error)),
      )
    }
    try {
      const executablePath =
        this.options.executablePath ?? process.env.DSH_DESIGN_CHROMIUM_PATH ?? process.env.PLAYWRIGHT_CHROMIUM_PATH
      return await playwright.chromium.launch(chromiumLaunchOptions(executablePath))
    } catch (error) {
      throw new DesignBrowserError(
        'chromium-missing',
        MISSING_GUIDANCE +
          SANDBOX_GUIDANCE +
          ' Underlying error: ' +
          (error instanceof Error ? error.message : String(error)),
      )
    }
  }

  /** Create a session record and start its one shared launch. */
  private createRecord(sessionId: string): SessionRecord {
    const record: SessionRecord = {
      id: sessionId,
      queue: Promise.resolve(),
      users: 0,
      awaiting: 0,
      active: 0,
      queueDepth: 0,
      lastUsed: Date.now(),
      warmed: false,
      disposed: false,
    }
    this.sessions.set(sessionId, record)
    record.launching = this.startLaunch(record)
    return record
  }

  /** Start one launch for a record and close it if nobody claims it. */
  private startLaunch(record: SessionRecord): Promise<Browser> {
    const launching = this.launch().then(
      async (browser) => {
        record.launching = undefined
        record.lastUsed = Date.now()
        if (record.disposed || this.disposed) {
          await browser.close().catch(() => undefined)
          this.notifyCapacity()
          throw disposedError()
        }
        record.browser = browser
        this.notifyCapacity()
        if (
          !record.warmed &&
          record.awaiting === 0 &&
          record.users === 0 &&
          record.active === 0 &&
          record.queueDepth === 0
        ) {
          // The launch was not claimed; keep its reservation until close settles.
          void this.retire(record, browser)
        }
        return browser
      },
      (error: unknown) => {
        record.launching = undefined
        if (this.sessions.get(record.id) === record) this.sessions.delete(record.id)
        this.notifyCapacity()
        throw error
      },
    )
    void launching.catch(() => undefined)
    return launching
  }

  /** Read a record's browser without retaining an earlier undefined narrowing. */
  private browserOf(record: SessionRecord): Browser | undefined {
    return record.browser
  }

  /**
   * Unlink one record and retain its slot until its browser (or its pending
   * launch's browser) has actually closed.
   */
  private retire(record: SessionRecord, browser?: Browser): Promise<void> {
    if (this.sessions.get(record.id) === record) this.sessions.delete(record.id)
    record.disposed = true
    this.retiring += 1
    const work = this.closeRecord(record, browser)
      .catch(() => undefined)
      .finally(() => {
        this.retiring = Math.max(0, this.retiring - 1)
        this.retirements.delete(work)
        this.notifyCapacity()
      })
    this.retirements.add(work)
    return work
  }

  /** Close the browser a retiring record owns, waiting for a pending launch. */
  private async closeRecord(record: SessionRecord, browser?: Browser): Promise<void> {
    let target = browser ?? record.browser
    if (target === undefined && record.launching !== undefined) {
      target = await record.launching.catch(() => undefined)
    }
    if (target !== undefined) await target.close().catch(() => undefined)
  }

  /** Reserved slots: live browsers, in-flight launches, and pending closes. */
  private slotCount(): number {
    let count = this.retiring
    for (const record of this.sessions.values()) {
      if (record.browser !== undefined || record.launching !== undefined) count += 1
    }
    return count
  }

  /** Idle sessions that may be evicted; queued or busy work never qualifies. */
  private pickEvictable(): SessionRecord | undefined {
    return [...this.sessions.values()]
      .filter(
        (record) =>
          record.browser !== undefined &&
          record.launching === undefined &&
          record.users === 0 &&
          record.active === 0 &&
          record.queueDepth === 0 &&
          record.awaiting === 0,
      )
      .sort((left, right) => left.lastUsed - right.lastUsed)[0]
  }

  /** Close one evicted session, retaining its reservation until close resolves. */
  private async evict(record: SessionRecord): Promise<void> {
    await this.retire(record)
  }

  /** Close a launch nobody claimed, or a record after disposal. */
  private async maybeCleanup(record: SessionRecord): Promise<void> {
    if (record.disposed || this.disposed) {
      await this.retire(record)
      return
    }
    if (
      !record.warmed &&
      record.launching === undefined &&
      record.users === 0 &&
      record.active === 0 &&
      record.awaiting === 0 &&
      record.queueDepth === 0
    ) {
      await this.retire(record)
    }
  }

  /** Wrap a record in a released-once lease. */
  private lease(record: SessionRecord): Lease {
    record.users += 1
    record.warmed = true
    record.lastUsed = Date.now()
    let released = false
    return {
      record,
      release: () => {
        if (released) return
        released = true
        record.users = Math.max(0, record.users - 1)
        record.lastUsed = Date.now()
        this.notifyCapacity()
      },
    }
  }

  /** Wait for one admission slot, aborting or timing out with the check. */
  private waitForAdmission(
    sessionId: string,
    generation: number,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    deadline: number,
  ): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(cancelled())
    if (Date.now() >= deadline) return Promise.reject(timedOut(timeoutMs))
    return new Promise<void>((resolve, reject) => {
      const waiter: CapacityWaiter = {
        sessionId,
        generation,
        resolve: () => {
          cleanup()
          resolve()
        },
        reject: (error: Error) => {
          cleanup()
          reject(error)
        },
      }
      const timer = setTimeout(() => waiter.reject(timedOut(timeoutMs)), remaining(deadline))
      timer.unref?.()
      const onAbort = (): void => waiter.reject(cancelled())
      const cleanup = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.capacityWaiters.delete(waiter)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.capacityWaiters.add(waiter)
    })
  }

  /** Wake admission waiters after capacity changes. */
  private notifyCapacity(): void {
    const waiters = [...this.capacityWaiters]
    this.capacityWaiters.clear()
    for (const waiter of waiters) waiter.resolve()
  }

  /** Reject every pending capacity admission for one session generation. */
  private rejectSessionWaiters(sessionId: string): void {
    for (const waiter of [...this.capacityWaiters]) {
      if (waiter.sessionId !== sessionId) continue
      this.capacityWaiters.delete(waiter)
      waiter.reject(sessionDisposedError(sessionId))
    }
  }

  /** Await the shared launch without outliving the caller's deadline. */
  private async waitForLaunch(
    record: SessionRecord,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    deadline: number,
  ): Promise<void> {
    const launching = record.launching
    if (launching === undefined) return
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (error === undefined) resolve()
        else reject(error)
      }
      const timer = setTimeout(() => finish(timedOut(timeoutMs)), remaining(deadline))
      timer.unref?.()
      const onAbort = (): void => finish(cancelled())
      signal?.addEventListener('abort', onAbort, { once: true })
      launching.then(
        () => finish(),
        (error: unknown) => finish(error instanceof Error ? error : disposedError()),
      )
    })
  }

  /** Acquire (and possibly launch) a browser lease for one session. */
  private async acquire(
    sessionId: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    deadline: number,
  ): Promise<Lease> {
    const generation = this.sessionGenerations.get(sessionId) ?? 0
    const stillCurrent = (): boolean => (this.sessionGenerations.get(sessionId) ?? 0) === generation
    while (true) {
      if (this.disposed) throw disposedError()
      if (!stillCurrent()) throw sessionDisposedError(sessionId)
      if (signal?.aborted === true) throw cancelled()
      if (Date.now() >= deadline) throw timedOut(timeoutMs)
      const record = this.sessions.get(sessionId)
      if (record?.browser !== undefined) {
        if (record.browser.isConnected()) {
          record.lastUsed = Date.now()
          return this.lease(record)
        }
        await this.evict(record)
        continue
      }
      if (record?.launching !== undefined) {
        record.awaiting += 1
        let failure: Error | undefined
        try {
          await this.waitForLaunch(record, signal, timeoutMs, deadline)
        } catch (error) {
          failure = error instanceof Error ? error : disposedError()
        } finally {
          record.awaiting -= 1
        }
        if (failure !== undefined) {
          await this.maybeCleanup(record)
          throw failure
        }
        if (this.sessions.get(sessionId) !== record || record.disposed || this.disposed) {
          await this.maybeCleanup(record)
          throw disposedError()
        }
        const browser = this.browserOf(record)
        if (browser === undefined || !browser.isConnected()) {
          await this.maybeCleanup(record)
          throw new DesignBrowserError('browser-failed', 'The session browser disconnected; retry the check.')
        }
        record.lastUsed = Date.now()
        return this.lease(record)
      }
      if (record !== undefined) {
        this.sessions.delete(sessionId)
        this.notifyCapacity()
        continue
      }
      if (this.slotCount() < Math.max(1, this.options.maxSessions ?? DEFAULT_MAX_SESSIONS)) {
        this.createRecord(sessionId)
        continue
      }
      const victim = this.pickEvictable()
      if (victim !== undefined) {
        await this.evict(victim)
        continue
      }
      await this.waitForAdmission(sessionId, generation, signal, timeoutMs, deadline)
    }
  }

  /**
   * Run one deterministic check in a fresh context, serialized per session.
   * Admission, queueing, launch, and browser work share one deadline.
   * @param request - immutable payload, route, viewport, and cancellation.
   * @param task - browser work performed after the canvas commits.
   */
  async run<T>(request: RenderRequest, task: (page: Page) => Promise<T>): Promise<T> {
    const timeoutMs = request.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS
    const deadline = Date.now() + timeoutMs
    return withDeadline(this.runInternal(request, task, timeoutMs, deadline), request.signal, timeoutMs)
  }

  private async runInternal<T>(
    request: RenderRequest,
    task: (page: Page) => Promise<T>,
    timeoutMs: number,
    deadline: number,
  ): Promise<T> {
    const lease = await this.acquire(request.sessionId, request.signal, timeoutMs, deadline)
    const record = lease.record
    record.queueDepth += 1
    const previous = record.queue
    const queued = previous.then(
      () => this.runOnce(record, request, task, timeoutMs, deadline),
      () => this.runOnce(record, request, task, timeoutMs, deadline),
    )
    record.queue = queued.then(
      () => undefined,
      () => undefined,
    )
    try {
      return await queued
    } finally {
      record.queueDepth -= 1
      lease.release()
      this.notifyCapacity()
    }
  }

  /** Run one check once its queued turn arrives. */
  private async runOnce<T>(
    session: SessionRecord,
    request: RenderRequest,
    task: (page: Page) => Promise<T>,
    timeoutMs: number,
    deadline: number,
  ): Promise<T> {
    if (aborted(request.signal)) throw cancelled()
    if (Date.now() >= deadline) throw timedOut(timeoutMs)
    if (session.disposed || this.disposed) throw disposedError()
    if (session.browser === undefined || !session.browser.isConnected()) {
      throw new DesignBrowserError('browser-failed', 'The session browser disconnected; retry the check.')
    }
    session.active += 1
    session.lastUsed = Date.now()
    let context: BrowserContext | undefined
    try {
      return await withDeadline(
        (async () => {
          const rendered = await deterministicDocument(request.assetsDir, request.payload)
          const browser = this.browserOf(session)
          if (browser === undefined) throw new DesignBrowserError('browser-failed', 'The session browser disappeared.')
          const opened = await browser.newContext({
            viewport: { width: request.breakpointWidth, height: this.viewportHeight },
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
            locale: 'en-US',
            timezoneId: 'UTC',
            colorScheme: 'light',
            reducedMotion: 'reduce',
            serviceWorkers: 'block',
          })
          context = opened
          if (aborted(request.signal)) {
            await opened.close().catch(() => undefined)
            context = undefined
            throw cancelled()
          }
          if (Date.now() >= deadline) {
            await opened.close().catch(() => undefined)
            context = undefined
            throw timedOut(timeoutMs)
          }
          if (aborted(request.signal)) {
            await opened.close().catch(() => undefined)
            context = undefined
            throw cancelled()
          }
          if (Date.now() >= deadline) {
            await opened.close().catch(() => undefined)
            context = undefined
            throw timedOut(timeoutMs)
          }
          const page = await opened.newPage()
          page.setDefaultTimeout(Math.min(10000, remaining(deadline)))
          let served = false
          await opened.route('**/*', async (route) => {
            if (!served) {
              served = true
              await route.fulfill({
                status: 200,
                headers: {
                  'content-type': 'text/html; charset=utf-8',
                  'content-security-policy': rendered.csp,
                  'cross-origin-resource-policy': 'same-origin',
                  'cache-control': 'no-store',
                },
                body: rendered.html,
              })
              return
            }
            await route.abort('blockedbyclient')
          })
          const params = new URLSearchParams()
          params.set('bp', request.breakpoint)
          if (request.state !== undefined) params.set('state', request.state)
          params.set('deterministic', '1')
          const url =
            'http://design.invalid/design/preview/' + encodeURIComponent(request.screen) + '?' + params.toString()
          await page.goto(url, { waitUntil: 'domcontentloaded' })
          await page.waitForSelector('.dsx-frame')
          await page.waitForFunction(
            (screen) => document.querySelector('.dsx-frame')?.getAttribute('data-screen') === screen,
            request.screen,
            { timeout: Math.min(5000, remaining(deadline)) },
          )
          await page.evaluate(() => document.fonts.ready)
          await settleFrame(page)
          if (aborted(request.signal)) throw cancelled()
          if (Date.now() >= deadline) throw timedOut(timeoutMs)
          return await task(page)
        })(),
        request.signal,
        remaining(deadline),
      )
    } catch (error) {
      if (error instanceof DesignBrowserError) throw error
      throw new DesignBrowserError(
        'browser-failed',
        'The headless check failed: ' + (error instanceof Error ? error.message : String(error)),
      )
    } finally {
      session.active -= 1
      session.lastUsed = Date.now()
      if (context !== undefined) await context.close().catch(() => undefined)
    }
  }

  /**
   * Dispose one session browser, including a launch still in flight. The
   * generation bump rejects capacity-only admissions that have no record yet,
   * and fresh work may start a new generation afterwards.
   */
  async disposeSession(sessionId: string): Promise<void> {
    this.sessionGenerations.set(sessionId, (this.sessionGenerations.get(sessionId) ?? 0) + 1)
    this.rejectSessionWaiters(sessionId)
    const session = this.sessions.get(sessionId)
    if (session === undefined) return
    await this.retire(session)
  }

  /** Dispose every session browser and drain every pending retirement. */
  async disposeAll(): Promise<void> {
    this.disposed = true
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    for (const waiter of [...this.capacityWaiters]) waiter.reject(disposedError())
    this.capacityWaiters.clear()
    await Promise.all(sessions.map((session) => this.retire(session)))
    // Retirements unlinked by an earlier eviction or late launch are still
    // closing; drain them too, including any added while waiting.
    while (this.retirements.size > 0) {
      await Promise.all([...this.retirements])
    }
  }
}
