/** Browser transport for the owner-only review comment surface. */
import type { CommentCreateInput, CommentSnapshot, CommentVersion } from '@filipeesch/dsh-design-core'
import { sessionBase } from './api.ts'

/** One typed comment API failure; `retryable` mirrors the host's hint. */
export class CommentApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean
  constructor(status: number, code: string, message: string, retryable = false) {
    super(message)
    this.name = 'CommentApiError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

/** One accepted batch as the host reports it. */
export interface CommentSubmission {
  readonly accepted: true
  readonly requestId: string
  readonly acceptedAt: number
  readonly replayed: boolean
  /** Exact versions the accepted message carried. */
  readonly versions: readonly CommentVersion[]
  readonly cleared: readonly string[]
  readonly snapshot: CommentSnapshot
}

const INTENT_HEADER = 'x-dsh-design-comments'

function commentUrl(session: string, action?: string): string {
  return sessionBase(session) + '_/comments' + (action === undefined ? '' : '/' + action)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    return undefined
  }
}

function errorOf(payload: unknown): { code: string; message: string; retryable: boolean } {
  if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return {
      code: typeof record.error === 'string' ? record.error : 'request-failed',
      message: typeof record.message === 'string' ? record.message : 'comment request failed',
      retryable: record.retryable === true,
    }
  }
  return { code: 'request-failed', message: 'comment request failed', retryable: false }
}

async function request(session: string, action: string | undefined, init: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(commentUrl(session, action), {
      credentials: 'same-origin',
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.method === undefined || init.method === 'GET'
          ? {}
          : { 'content-type': 'application/json', [INTENT_HEADER]: '1' }),
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    throw new CommentApiError(
      0,
      'network',
      'could not reach the design preview service: ' + (error instanceof Error ? error.message : String(error)),
      true,
    )
  }
  const payload = await readJson(response)
  if (!response.ok) {
    const details = errorOf(payload)
    throw new CommentApiError(response.status, details.code, details.message, details.retryable)
  }
  return payload
}

/** Read one session's pending comments. */
export async function fetchComments(session: string, signal?: AbortSignal): Promise<CommentSnapshot> {
  return (await request(session, undefined, {
    method: 'GET',
    ...(signal === undefined ? {} : { signal }),
  })) as CommentSnapshot
}

/** Add one pending comment. */
export async function createComment(
  session: string,
  input: CommentCreateInput,
  signal?: AbortSignal,
): Promise<CommentSnapshot> {
  return (await request(session, 'create', {
    method: 'POST',
    body: JSON.stringify(input),
    ...(signal === undefined ? {} : { signal }),
  })) as CommentSnapshot
}

/** Edit the exact draft revision the owner reviewed. */
export async function updateComment(
  session: string,
  id: string,
  revision: number,
  text: string,
  signal?: AbortSignal,
): Promise<CommentSnapshot> {
  return (await request(session, 'update', {
    method: 'POST',
    body: JSON.stringify({ id, revision, text }),
    ...(signal === undefined ? {} : { signal }),
  })) as CommentSnapshot
}

/** Remove the exact draft revision the owner reviewed. */
export async function removeComment(
  session: string,
  id: string,
  revision: number,
  signal?: AbortSignal,
): Promise<CommentSnapshot> {
  return (await request(session, 'remove', {
    method: 'POST',
    body: JSON.stringify({ id, revision }),
    ...(signal === undefined ? {} : { signal }),
  })) as CommentSnapshot
}

/** Send exact reviewed draft versions as one queued user message. */
export async function submitComments(
  session: string,
  requestId: string,
  versions: readonly CommentVersion[],
  signal?: AbortSignal,
): Promise<CommentSubmission> {
  return (await request(session, 'submit', {
    method: 'POST',
    body: JSON.stringify({ requestId, versions }),
    ...(signal === undefined ? {} : { signal }),
  })) as CommentSubmission
}
