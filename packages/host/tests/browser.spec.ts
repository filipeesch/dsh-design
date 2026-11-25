import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { BrowserSessions, DesignBrowserError, chromiumLaunchOptions } from '../src/browser.ts'
import type { PreviewPayload } from '../src/payload.ts'

const assetsDir = fileURLToPath(new URL('../../renderer/dist/', import.meta.url))

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

interface FakeContext extends BrowserContext {
  readonly closes: () => number
}

function fakePage(): Page {
  return {
    setDefaultTimeout: () => undefined,
    goto: async () => undefined,
    waitForSelector: async () => undefined,
    waitForFunction: async () => undefined,
    evaluate: async () => undefined,
  } as unknown as Page
}

function fakeContext(): FakeContext {
  let closes = 0
  return {
    route: async () => undefined,
    newPage: async () => fakePage(),
    close: async () => {
      closes += 1
    },
    closes: () => closes,
  } as unknown as FakeContext
}

interface FakeBrowser extends Browser {
  readonly closeCount: () => number
  readonly contexts: FakeContext[]
}

function fakeBrowser(contextGate?: Promise<void>, onContext?: () => void, closeGate?: Promise<void>): FakeBrowser {
  let closes = 0
  const contexts: FakeContext[] = []
  return {
    isConnected: () => closes === 0,
    close: async () => {
      closes += 1
      if (closeGate !== undefined) await closeGate
    },
    newContext: async () => {
      onContext?.()
      if (contextGate !== undefined) await contextGate
      const context = fakeContext()
      contexts.push(context)
      return context
    },
    closeCount: () => closes,
    contexts,
  } as unknown as FakeBrowser
}

function payload(): PreviewPayload {
  return {
    session: 'browser-pool-test',
    revision: 1,
    config: { kitVersion: '1.0.0', breakpoints: [{ name: 'mobile', width: 390 }] },
    kitVersion: '1.0.0',
    tokens: {},
    cssVariables: {},
    diagnostics: [],
    screens: [],
  }
}

function request(sessionId: string, extra: Record<string, unknown> = {}) {
  return {
    sessionId,
    payload: payload(),
    assetsDir,
    screen: 'home',
    breakpoint: 'mobile',
    breakpointWidth: 390,
    ...extra,
  }
}

describe('browser session pool lifecycle', () => {
  it('shares one cold-start launch between callers of the same session', async () => {
    const gate = deferred<Browser>()
    let launches = 0
    const sessions = new BrowserSessions({
      launch: async () => {
        launches += 1
        return gate.promise
      },
    })
    const first = sessions.prewarm('one')
    const second = sessions.prewarm('one')
    await tick()
    expect(launches).toBe(1)
    gate.resolve(fakeBrowser())
    await Promise.all([first, second])
    expect(launches).toBe(1)
    expect(sessions.size).toBe(1)
    await sessions.disposeAll()
  })

  it('counts in-flight launches against the cap and never blocks eviction forever', async () => {
    const gate = deferred<Browser>()
    const closed: FakeBrowser[] = []
    let launches = 0
    const sessions = new BrowserSessions({
      maxSessions: 1,
      launch: async () => {
        launches += 1
        if (launches === 1) return gate.promise
        const browser = fakeBrowser()
        closed.push(browser)
        return browser
      },
    })
    const first = sessions.prewarm('one')
    const second = sessions.prewarm('two')
    await tick()
    expect(launches).toBe(1)
    const firstBrowser = fakeBrowser()
    closed.push(firstBrowser)
    gate.resolve(firstBrowser)
    await first
    await second
    expect(launches).toBe(2)
    expect(sessions.size).toBe(1)
    expect(sessions.has('two')).toBe(true)
    expect(firstBrowser.closeCount()).toBe(1)
    await sessions.disposeAll()
  })

  it('retains an evicted browser reservation until its close resolves', async () => {
    const closeGate = deferred<void>()
    let launches = 0
    const first = fakeBrowser(undefined, undefined, closeGate.promise)
    const sessions = new BrowserSessions({
      maxSessions: 1,
      launch: async () => {
        launches += 1
        return launches === 1 ? first : fakeBrowser()
      },
    })
    await sessions.prewarm('one')
    const second = sessions.prewarm('two')
    await tick()
    expect(launches).toBe(1)
    expect(sessions.retiringBrowsers).toBe(1)
    expect(sessions.size).toBe(1)
    closeGate.resolve()
    await second
    expect(launches).toBe(2)
    expect(sessions.retiringBrowsers).toBe(0)
    await sessions.disposeAll()
  })

  it('retains a late-launch reservation until its browser close resolves', async () => {
    const launchGate = deferred<Browser>()
    const closeGate = deferred<void>()
    let launches = 0
    const late = fakeBrowser(undefined, undefined, closeGate.promise)
    const sessions = new BrowserSessions({
      maxSessions: 1,
      launch: async () => {
        launches += 1
        return launches === 1 ? launchGate.promise : fakeBrowser()
      },
    })
    const controller = new AbortController()
    const cancelledRun = sessions.run(request('one', { signal: controller.signal }), async () => 'unused')
    await tick()
    controller.abort()
    await expect(cancelledRun).rejects.toMatchObject({ code: 'cancelled' })
    launchGate.resolve(late)
    await tick()
    expect(sessions.retiringBrowsers).toBe(1)
    const second = sessions.prewarm('two')
    await tick()
    expect(launches).toBe(1)
    closeGate.resolve()
    await second
    expect(launches).toBe(2)
    expect(sessions.retiringBrowsers).toBe(0)
    await sessions.disposeAll()
  })

  it('drains retirements already unlinked from active records', async () => {
    const closeGate = deferred<void>()
    let launches = 0
    const sessions = new BrowserSessions({
      maxSessions: 1,
      launch: async () => {
        launches += 1
        return launches === 1 ? fakeBrowser(undefined, undefined, closeGate.promise) : fakeBrowser()
      },
    })
    await sessions.prewarm('one')
    const waiting = sessions.prewarm('two')
    const waitingResult = waiting.catch((error: unknown) => error)
    await tick()
    expect(sessions.retiringBrowsers).toBe(1)
    let drained = false
    const disposal = sessions.disposeAll().then(() => {
      drained = true
    })
    await tick()
    expect(drained).toBe(false)
    closeGate.resolve()
    await disposal
    expect(drained).toBe(true)
    expect(sessions.retiringBrowsers).toBe(0)
    await expect(waitingResult).resolves.toMatchObject({ code: 'browser-failed' })
  })

  it('disposing a session rejects a capacity-only admission and opens a new generation', async () => {
    const gate = deferred<Browser>()
    let launches = 0
    const sessions = new BrowserSessions({
      maxSessions: 1,
      launch: async () => {
        launches += 1
        return launches === 1 ? gate.promise : fakeBrowser()
      },
    })
    const first = sessions.prewarm('one')
    await tick()
    const oldAdmission = sessions.prewarm('two')
    await tick()
    expect(launches).toBe(1)
    expect(sessions.has('two')).toBe(false)
    await sessions.disposeSession('two')
    await expect(oldAdmission).rejects.toMatchObject({ code: 'browser-failed' })
    expect(sessions.has('two')).toBe(false)
    const freshAdmission = sessions.prewarm('two')
    gate.resolve(fakeBrowser())
    await first
    await freshAdmission
    expect(launches).toBe(2)
    expect(sessions.has('two')).toBe(true)
    await sessions.disposeAll()
  })

  it('does not evict a busy or queued session', async () => {
    let launches = 0
    const browsers: FakeBrowser[] = []
    const sessions = new BrowserSessions({
      maxSessions: 1,
      launch: async () => {
        launches += 1
        const browser = fakeBrowser()
        browsers.push(browser)
        return browser
      },
    })
    const started = deferred<void>()
    const release = deferred<void>()
    const active = sessions.run(request('one'), async () => {
      started.resolve()
      await release.promise
      return 'done'
    })
    await started.promise
    const waiting = sessions.prewarm('two')
    await tick()
    expect(launches).toBe(1)
    expect(sessions.has('one')).toBe(true)
    expect(sessions.has('two')).toBe(false)
    release.resolve()
    expect(await active).toBe('done')
    await waiting
    expect(launches).toBe(2)
    expect(browsers[0]?.closeCount()).toBe(1)
    expect(sessions.has('two')).toBe(true)
    await sessions.disposeAll()
  })

  it('includes admission and queue waiting in cancellation', async () => {
    let launches = 0
    const gate = deferred<Browser>()
    const sessions = new BrowserSessions({
      maxSessions: 1,
      launch: async () => {
        launches += 1
        return launches === 1 ? gate.promise : fakeBrowser()
      },
    })
    const first = sessions.prewarm('one')
    const controller = new AbortController()
    const admitted = sessions.run(request('two', { signal: controller.signal }), async () => 'unused')
    controller.abort()
    await expect(admitted).rejects.toMatchObject({ code: 'cancelled' })
    expect(launches).toBe(1)
    gate.resolve(fakeBrowser())
    await first
    await sessions.disposeAll()
  })

  it('includes admission and launch waiting in the deadline', async () => {
    const gate = deferred<Browser>()
    let launches = 0
    const sessions = new BrowserSessions({
      maxSessions: 1,
      launch: async () => {
        launches += 1
        return launches === 1 ? gate.promise : fakeBrowser()
      },
    })
    const first = sessions.prewarm('one')
    await expect(sessions.run(request('two', { timeoutMs: 10 }), async () => 'unused')).rejects.toMatchObject({
      code: 'timeout',
    })
    expect(launches).toBe(1)
    gate.resolve(fakeBrowser())
    await first
    await sessions.disposeAll()

    const launchGate = deferred<Browser>()
    const lateBrowser = fakeBrowser()
    const timed = new BrowserSessions({ launch: async () => launchGate.promise })
    const pending = timed.run(request('three', { timeoutMs: 10 }), async () => 'unused')
    await expect(pending).rejects.toMatchObject({ code: 'timeout' })
    launchGate.resolve(lateBrowser)
    await tick()
    expect(lateBrowser.closeCount()).toBe(1)
    expect(timed.size).toBe(0)
    await timed.disposeAll()
  })

  it('includes queue waiting in the deadline', async () => {
    const sessions = new BrowserSessions({ maxSessions: 1, launch: async () => fakeBrowser() })
    const started = deferred<void>()
    const release = deferred<void>()
    const active = sessions.run(request('one'), async () => {
      started.resolve()
      await release.promise
      return 'first'
    })
    await started.promise
    let queuedRuns = 0
    const queued = sessions.run(request('one', { timeoutMs: 10 }), async () => {
      queuedRuns += 1
      return 'second'
    })
    await expect(queued).rejects.toMatchObject({ code: 'timeout' })
    release.resolve()
    await active
    await tick()
    expect(queuedRuns).toBe(0)
    await sessions.disposeAll()
  })

  it('does not execute a queued check after cancellation', async () => {
    let launches = 0
    const sessions = new BrowserSessions({
      maxSessions: 1,
      launch: async () => {
        launches += 1
        return fakeBrowser()
      },
    })
    const started = deferred<void>()
    const release = deferred<void>()
    const active = sessions.run(request('one'), async () => {
      started.resolve()
      await release.promise
      return 'first'
    })
    await started.promise
    let queuedRuns = 0
    const controller = new AbortController()
    const queued = sessions.run(request('one', { signal: controller.signal }), async () => {
      queuedRuns += 1
      return 'second'
    })
    await tick()
    controller.abort()
    await expect(queued).rejects.toMatchObject({ code: 'cancelled' })
    release.resolve()
    await active
    await tick()
    expect(queuedRuns).toBe(0)
    expect(launches).toBe(1)
    await sessions.disposeAll()
  })

  it('closes a browser that arrives after the caller cancelled', async () => {
    const gate = deferred<Browser>()
    const sessions = new BrowserSessions({ launch: async () => gate.promise })
    const controller = new AbortController()
    const running = sessions.run(request('one', { signal: controller.signal }), async () => 'unused')
    controller.abort()
    await expect(running).rejects.toMatchObject({ code: 'cancelled' })
    const browser = fakeBrowser()
    gate.resolve(browser)
    await tick()
    expect(browser.closeCount()).toBe(1)
    expect(sessions.has('one')).toBe(false)
    await sessions.disposeAll()
  })

  it('closes a context created after cancellation and closes late contexts', async () => {
    const contextGate = deferred<void>()
    const contextStarted = deferred<void>()
    const browser = fakeBrowser(contextGate.promise, () => contextStarted.resolve())
    const sessions = new BrowserSessions({ launch: async () => browser })
    const controller = new AbortController()
    const running = sessions.run(request('one', { signal: controller.signal }), async () => 'unused')
    await contextStarted.promise
    controller.abort()
    await expect(running).rejects.toMatchObject({ code: 'cancelled' })
    contextGate.resolve()
    await tick()
    expect(browser.contexts[0]?.closes()).toBeGreaterThanOrEqual(1)
    await sessions.disposeAll()
  })

  it('drains a pending launch on session and pool disposal', async () => {
    const firstGate = deferred<Browser>()
    const firstBrowser = fakeBrowser()
    let launches = 0
    const sessions = new BrowserSessions({
      launch: async () => {
        launches += 1
        return launches === 1 ? firstGate.promise : fakeBrowser()
      },
    })
    const pending = sessions.prewarm('one')
    const disposed = sessions.disposeSession('one')
    firstGate.resolve(firstBrowser)
    await disposed
    await expect(pending).rejects.toMatchObject({ code: 'browser-failed' })
    expect(firstBrowser.closeCount()).toBe(1)
    expect(sessions.has('one')).toBe(false)

    const secondGate = deferred<Browser>()
    sessions.disposeAll()
    const second = new BrowserSessions({ launch: async () => secondGate.promise })
    const again = second.prewarm('two')
    const drained = second.disposeAll()
    const late = fakeBrowser()
    secondGate.resolve(late)
    await drained
    await expect(again).rejects.toMatchObject({ code: 'browser-failed' })
    expect(late.closeCount()).toBe(1)
    expect(second.size).toBe(0)
  })

  it('always launches with the Chromium sandbox enabled and no fallback', () => {
    expect(chromiumLaunchOptions()).toMatchObject({ headless: true, chromiumSandbox: true })
    expect(chromiumLaunchOptions('/opt/chrome').executablePath).toBe('/opt/chrome')
  })

  it('evicts the least recently used idle session when the pool is full', async () => {
    const closed: string[] = []
    const sessions = new BrowserSessions({
      launch: async () => {
        const id = 'browser-' + String(closed.length + 1)
        return {
          isConnected: () => !closed.includes(id),
          close: async () => {
            closed.push(id)
          },
        } as unknown as Browser
      },
      maxSessions: 2,
    })
    await sessions.prewarm('one')
    await new Promise((resolve) => setTimeout(resolve, 5))
    await sessions.prewarm('two')
    await new Promise((resolve) => setTimeout(resolve, 5))
    await sessions.prewarm('three')
    expect(sessions.size).toBe(2)
    expect(sessions.has('one')).toBe(false)
    expect(sessions.has('two')).toBe(true)
    expect(sessions.has('three')).toBe(true)
    await sessions.disposeAll()
  })

  it('reports missing Chromium with install and sandbox guidance', async () => {
    const sessions = new BrowserSessions({
      launch: async () => {
        throw new Error("Executable doesn't exist")
      },
    })
    await expect(sessions.prewarm('one')).rejects.toMatchObject({
      name: 'DesignBrowserError',
      code: 'chromium-missing',
    })
    const error = await sessions.prewarm('one').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DesignBrowserError)
    expect((error as Error).message).toContain('DSH_DESIGN_CHROMIUM_PATH')
    expect((error as Error).message).toContain('playwright install chromium')
    expect((error as Error).message).toContain('Preview and static design tools keep working')
    expect((error as Error).message).toContain('chromiumSandbox: true')
  })

  it('reports cancellation before any browser work', async () => {
    const sessions = new BrowserSessions({ launch: async () => fakeBrowser() })
    const controller = new AbortController()
    controller.abort()
    await expect(
      sessions.run(request('one', { signal: controller.signal }), async () => undefined),
    ).rejects.toMatchObject({ code: 'cancelled' })
    await sessions.disposeAll()
  })
})
