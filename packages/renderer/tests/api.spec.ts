// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchProject, subscribeRevisions } from '../src/api.ts'

const revision = (token: string) => ({ ok: true, json: async () => ({ token }) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('times out a stalled projection body without aborting the route or a later attempt', async () => {
  const route = new AbortController()
  const request = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementationOnce(
      async (_, init) =>
        ({
          ok: true,
          json: () =>
            new Promise((_, reject) => {
              const signal = init!.signal!
              signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            }),
        }) as Response,
    )
    .mockResolvedValueOnce(Response.json({ token: 'new:2' }))
  const result = expect(fetchProject('resume', { signal: route.signal })).rejects.toThrow('project request timed out')
  await vi.advanceTimersByTimeAsync(5000)
  await result
  expect(route.signal.aborted).toBe(false)
  await expect(fetchProject('resume', { signal: route.signal })).resolves.toEqual({ token: 'new:2' })
  expect(request).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})

describe('revision checks', () => {
  it('coalesces listeners, waits for a response before checking again, and cancels on teardown', async () => {
    let finish: ((value: ReturnType<typeof revision>) => void) | undefined
    let signal: AbortSignal | undefined
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation((_, init) => {
      signal = init?.signal ?? undefined
      return new Promise((resolve) => {
        finish = (value) => resolve(value as Response)
      })
    })
    const one = vi.fn(),
      two = vi.fn()
    const stopOne = subscribeRevisions('coalesced', one)
    const stopTwo = subscribeRevisions('coalesced', two)
    try {
      await vi.advanceTimersByTimeAsync(1100)
      expect(request).toHaveBeenCalledTimes(1)
      finish?.(revision('generation-a:1'))
      await vi.advanceTimersByTimeAsync(350)
      expect(one).toHaveBeenCalledWith('generation-a:1')
      expect(two).toHaveBeenCalledWith('generation-a:1')
      expect(request).toHaveBeenCalledTimes(2)
      stopOne()
      expect(signal?.aborted).toBe(false)
      stopTwo()
      expect(signal?.aborted).toBe(true)
      finish?.(revision('generation-b:1'))
      await vi.advanceTimersByTimeAsync(2000)
      expect(request).toHaveBeenCalledTimes(2)
      expect(two).toHaveBeenCalledTimes(1)
    } finally {
      stopOne()
      stopTwo()
    }
  })

  it('backs off on failure and checks immediately on visibility return and page restoration', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(revision('generation-b:1') as Response)
    const listener = vi.fn()
    const stop = subscribeRevisions('resumed', listener)
    try {
      await vi.advanceTimersByTimeAsync(1049)
      expect(request).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(listener).toHaveBeenCalledWith('generation-b:1')
      vi.mocked(Object.getOwnPropertyDescriptor(document, 'visibilityState')!.get!).mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(1000)
      expect(request).toHaveBeenCalledTimes(2)
      vi.mocked(Object.getOwnPropertyDescriptor(document, 'visibilityState')!.get!).mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
      expect(request).toHaveBeenCalledTimes(3)
      window.dispatchEvent(new Event('pagehide'))
      await vi.advanceTimersByTimeAsync(1000)
      expect(request).toHaveBeenCalledTimes(3)
      window.dispatchEvent(new Event('pageshow'))
      await vi.advanceTimersByTimeAsync(0)
      expect(request).toHaveBeenCalledTimes(4)
    } finally {
      stop()
    }
  })
})
