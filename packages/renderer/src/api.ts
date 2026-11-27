/** Browser transport for the preview endpoints. */
import type { ProjectPayload } from './wire.ts'

/** Build a route relative to a session preview. */
export function sessionBase(session: string): string {
  return '/design/' + encodeURIComponent(session) + '/'
}

export interface ProjectFetchOptions {
  readonly screen?: string
  readonly variant?: string
  readonly signal?: AbortSignal
}

/** Fetch the project metadata and selected screen projection. */
export async function fetchProject(session: string, options: ProjectFetchOptions = {}): Promise<ProjectPayload> {
  const params = new URLSearchParams()
  if (options.screen !== undefined && options.screen !== '') params.set('screen', options.screen)
  if (options.variant !== undefined && options.variant !== '') params.set('variant', options.variant)
  const suffix = params.size === 0 ? '' : '?' + params.toString()
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(new Error('project request timed out')), REQUEST_TIMEOUT_MS)
  const signal = options.signal === undefined ? deadline.signal : AbortSignal.any([options.signal, deadline.signal])
  try {
    const response = await fetch(sessionBase(session) + '_/project' + suffix, {
      headers: { accept: 'application/json' },
      signal,
    })
    if (!response.ok) throw new Error('project request failed: ' + String(response.status))
    return (await response.json()) as ProjectPayload
  } finally {
    clearTimeout(timer)
  }
}

const CHECK_MS = 350
const MAX_RETRY_MS = 2800
const REQUEST_TIMEOUT_MS = 5000

interface RevisionPoll {
  readonly listeners: Set<(token: string) => void>
  stop(): void
}

// Each renderer document owns its checks. Multiple consumers in the same
// document and session share a single request and visibility lifecycle.
const polls = new Map<string, RevisionPoll>()

function startPoll(session: string): RevisionPoll {
  const listeners = new Set<(token: string) => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let request: AbortController | undefined
  let retry = CHECK_MS
  let immediate = false
  let stopped = false
  let pageHidden = false
  const active = () => !stopped && !pageHidden && document.visibilityState !== 'hidden'
  const cancelTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const check = async () => {
    cancelTimer()
    if (!active() || request !== undefined) return
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    request = controller
    immediate = false
    try {
      const response = await fetch(sessionBase(session) + '_/revision', {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error('revision request failed: ' + String(response.status))
      const result = (await response.json()) as { token?: unknown } | null
      if (typeof result?.token !== 'string' || result.token === '') throw new Error('invalid revision response')
      if (controller.signal.aborted || !active()) return
      retry = CHECK_MS
      for (const listener of listeners) listener(result.token)
    } catch {
      retry = Math.min(retry * 2, MAX_RETRY_MS)
    } finally {
      clearTimeout(deadline)
      request = undefined
      if (active()) timer = setTimeout(() => void check(), immediate ? 0 : retry)
    }
  }
  const wake = () => {
    if (!active()) {
      immediate = false
      cancelTimer()
      request?.abort()
      return
    }
    if (request !== undefined) {
      immediate ||= request.signal.aborted
      return
    }
    void check()
  }
  const suspend = () => {
    cancelTimer()
    request?.abort()
  }
  const hide = () => {
    pageHidden = true
    suspend()
  }
  const restore = (event: PageTransitionEvent) => {
    if (!pageHidden && !event.persisted) return
    pageHidden = false
    wake()
  }
  document.addEventListener('visibilitychange', wake)
  globalThis.addEventListener('pageshow', restore)
  globalThis.addEventListener('pagehide', hide)
  if (active()) timer = setTimeout(() => void check(), CHECK_MS)
  return {
    listeners,
    stop() {
      stopped = true
      suspend()
      document.removeEventListener('visibilitychange', wake)
      globalThis.removeEventListener('pageshow', restore)
      globalThis.removeEventListener('pagehide', hide)
    },
  }
}

/** Observe revision tokens while the document can use them. */
export function subscribeRevisions(session: string, listener: (token: string) => void): () => void {
  let poll = polls.get(session)
  if (poll === undefined) {
    poll = startPoll(session)
    polls.set(session, poll)
  }
  const owned = poll
  owned.listeners.add(listener)
  return () => {
    owned.listeners.delete(listener)
    if (owned.listeners.size === 0 && polls.get(session) === owned) {
      owned.stop()
      polls.delete(session)
    }
  }
}
