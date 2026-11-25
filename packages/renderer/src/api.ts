/** Browser transport for the preview endpoints. */
import type { ProjectPayload, RevisionEvent } from './wire.ts'

/** Build a route relative to a session preview. */
export function sessionBase(session: string): string {
  return '/design/' + encodeURIComponent(session) + '/'
}

/** Options for one project fetch. */
export interface ProjectFetchOptions {
  /** Screen that owns an explicit variant selection. */
  readonly screen?: string
  /** Explicit branch selection as group:branch. */
  readonly variant?: string
}

/** Fetch the project payload. */
export async function fetchProject(
  session: string,
  revision?: number,
  options: ProjectFetchOptions = {},
): Promise<ProjectPayload> {
  const params = new URLSearchParams()
  if (revision !== undefined) params.set('rev', String(revision))
  if (options.screen !== undefined && options.screen !== '') params.set('screen', options.screen)
  if (options.variant !== undefined && options.variant !== '') params.set('variant', options.variant)
  const suffix = params.size === 0 ? '' : '?' + params.toString()
  const response = await fetch(sessionBase(session) + '_/project' + suffix, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('project request failed: ' + String(response.status))
  return (await response.json()) as ProjectPayload
}

/** Subscribe to revision events, returning an unsubscribe function. */
export function subscribeRevisions(
  session: string,
  onRevision: (event: RevisionEvent) => void,
  onError?: () => void,
): () => void {
  if (typeof EventSource === 'undefined') return () => undefined
  const source = new EventSource(sessionBase(session) + '_/events')
  source.addEventListener('revision', (event) => {
    try {
      const parsed = JSON.parse((event as MessageEvent).data as string) as RevisionEvent
      if (typeof parsed.rev === 'number') onRevision(parsed)
    } catch {
      // Ignore malformed events; the next revision or a manual reload recovers.
    }
  })
  source.addEventListener('error', () => {
    onError?.()
  })
  return () => {
    source.close()
  }
}
