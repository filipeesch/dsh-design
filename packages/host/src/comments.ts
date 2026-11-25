/**
 * Bounded in-memory review comments, keyed by DSH session.
 *
 * The store never touches the design repository: drafts and the receipts that
 * make a submission idempotent live only in this process. Pending drafts
 * therefore survive a browser reload, and are discarded when the process or the
 * session ends.
 */
import { randomUUID } from 'node:crypto'
import {
  COMMENT_BATCH_MAX,
  COMMENT_DRAFT_MAX,
  COMMENT_RECEIPTS_MAX,
  formatCommentBatch,
  sameCommentVersions,
  type CommentCreateInput,
  type CommentDraft,
  type CommentSnapshot,
  type CommentVersion,
} from '@filipeesch/dsh-design-core'

/** Failure classes the HTTP route maps to responses. */
export type CommentStoreErrorCode = 'not-found' | 'stale' | 'limit' | 'delivery-unavailable' | 'delivery-rejected'

/** One typed business failure raised by the comment store. */
export class CommentStoreError extends Error {
  /** Whether retrying the same request can succeed unchanged. */
  readonly retryable: boolean
  constructor(
    readonly code: CommentStoreErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message)
    this.name = 'CommentStoreError'
    this.retryable = retryable
  }
}

/** One prompt admission request handed to the DSH session controller. */
export interface CommentPromptRequest {
  readonly requestId: string
  readonly sessionId: string
  readonly mode: 'queue'
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
}

/** The one host capability the comment store needs. */
export interface CommentPromptPort {
  prompt(
    request: CommentPromptRequest,
    signal: AbortSignal,
  ): Promise<
    | { readonly accepted: true }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >
}

/** Accepted submission receipt, retained for idempotent retries. */
export interface CommentSubmissionReceipt {
  readonly requestId: string
  readonly acceptedAt: number
  /** Exact draft versions the accepted message carried. */
  readonly versions: readonly CommentVersion[]
  /** Draft ids removed by the accepted submission. */
  readonly cleared: readonly string[]
}

/** One accepted submission as the panel observes it. */
export interface CommentSubmissionResult extends CommentSubmissionReceipt {
  /** Always true; present so a caller can discriminate the result shape. */
  readonly accepted: true
  /** True when this response replays an earlier acceptance instead of sending. */
  readonly replayed: boolean
  /** This session's pending drafts after the acceptance. */
  readonly snapshot: CommentSnapshot
}

/** Store policy, with test seams for time and prompt admission. */
export interface CommentStoreOptions {
  /** Resolve the host prompt face at submit time; absent means unavailable. */
  readonly prompt?: () => CommentPromptPort | undefined
  readonly now?: () => number
  readonly maxDrafts?: number
  readonly maxReceipts?: number
  /** Overall admission deadline; an unobserved acceptance remains replayable. */
  readonly promptTimeoutMs?: number
}

interface SubmissionReceipt extends CommentSubmissionReceipt {}

interface SessionState {
  revision: number
  drafts: CommentDraft[]
  receipts: Map<string, SubmissionReceipt>
  submitTail: Promise<unknown>
}

function copyDraft(draft: CommentDraft): CommentDraft {
  return {
    ...draft,
    anchor: { ...draft.anchor },
    context: {
      ...draft.context,
      overlays: [...draft.context.overlays],
      tabs: { ...draft.context.tabs },
    },
  }
}

function copySnapshot(session: string, state: SessionState): CommentSnapshot {
  return {
    session,
    revision: state.revision,
    drafts: state.drafts.map(copyDraft),
  }
}

function freshState(): SessionState {
  return { revision: 0, drafts: [], receipts: new Map(), submitTail: Promise.resolve() }
}

/** In-memory draft authority for every live DSH session. */
export class CommentStore {
  private readonly sessions = new Map<string, SessionState>()
  private readonly now: () => number
  private readonly maxDrafts: number
  private readonly maxReceipts: number
  private readonly promptTimeoutMs: number
  private readonly prompt: (() => CommentPromptPort | undefined) | undefined

  constructor(options: CommentStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.maxDrafts = options.maxDrafts ?? COMMENT_DRAFT_MAX
    this.maxReceipts = options.maxReceipts ?? COMMENT_RECEIPTS_MAX
    this.promptTimeoutMs = options.promptTimeoutMs ?? 20000
    this.prompt = options.prompt
  }

  private state(session: string): SessionState {
    let state = this.sessions.get(session)
    if (state === undefined) {
      state = freshState()
      this.sessions.set(session, state)
    }
    return state
  }

  /** Read one session's pending drafts. */
  snapshot(session: string): CommentSnapshot {
    const state = this.sessions.get(session)
    return state === undefined ? { session, revision: 0, drafts: [] } : copySnapshot(session, state)
  }

  /** Add one draft. */
  create(session: string, input: CommentCreateInput): CommentSnapshot {
    const state = this.state(session)
    if (state.drafts.length >= this.maxDrafts)
      throw new CommentStoreError(
        'limit',
        'this session already holds the maximum of ' + String(this.maxDrafts) + ' pending comments',
      )
    const time = this.now()
    const draft: CommentDraft = {
      id: randomUUID(),
      revision: 1,
      text: input.text,
      anchor: { ...input.anchor },
      context: {
        ...input.context,
        overlays: [...input.context.overlays],
        tabs: { ...input.context.tabs },
      },
      createdAt: time,
      updatedAt: time,
    }
    state.drafts.push(draft)
    state.revision += 1
    return copySnapshot(session, state)
  }

  /** Edit the exact revision the owner reviewed. */
  update(session: string, input: CommentVersion & { readonly text: string }): CommentSnapshot {
    const state = this.state(session)
    const index = state.drafts.findIndex((draft) => draft.id === input.id)
    const current = state.drafts[index]
    if (current === undefined) throw new CommentStoreError('not-found', 'comment draft was not found')
    if (current.revision !== input.revision)
      throw new CommentStoreError('stale', 'comment draft changed since it was loaded; refresh and try again')
    state.drafts[index] = { ...current, revision: current.revision + 1, text: input.text, updatedAt: this.now() }
    state.revision += 1
    return copySnapshot(session, state)
  }

  /** Remove the exact revision the owner reviewed. */
  remove(session: string, input: CommentVersion): CommentSnapshot {
    const state = this.state(session)
    const index = state.drafts.findIndex((draft) => draft.id === input.id)
    const current = state.drafts[index]
    if (current === undefined) throw new CommentStoreError('not-found', 'comment draft was not found')
    if (current.revision !== input.revision)
      throw new CommentStoreError('stale', 'comment draft changed since it was loaded; refresh and try again')
    state.drafts.splice(index, 1)
    state.revision += 1
    return copySnapshot(session, state)
  }

  /**
   * Send exact reviewed versions as one queued user message.
   *
   * Submissions are serialized per session. A captured version that changed or
   * disappeared is a conflict before any prompt is attempted. The clear step
   * removes only the captured id/revision pairs, so drafts added, edited, or
   * removed while admission is in flight are preserved. An accepted request id
   * is recorded; replaying it returns the original acknowledgement without a
   * second prompt.
   */
  submit(session: string, requestId: string, versions: readonly CommentVersion[]): Promise<CommentSubmissionResult> {
    const state = this.state(session)
    const run = async (): Promise<CommentSubmissionResult> => {
      const receipt = state.receipts.get(requestId)
      if (receipt !== undefined) {
        if (!sameCommentVersions(receipt.versions, versions))
          throw new CommentStoreError('stale', 'this submission id was already accepted with different versions')
        return {
          ...receipt,
          accepted: true,
          versions: receipt.versions.map((version) => ({ ...version })),
          cleared: [...receipt.cleared],
          replayed: true,
          snapshot: copySnapshot(session, state),
        }
      }
      if (versions.length === 0 || versions.length > COMMENT_BATCH_MAX)
        throw new CommentStoreError('limit', 'a submission must contain 1-' + String(COMMENT_BATCH_MAX) + ' versions')
      const captured: CommentDraft[] = []
      for (const version of versions) {
        const draft = state.drafts.find((candidate) => candidate.id === version.id)
        if (draft === undefined || draft.revision !== version.revision)
          throw new CommentStoreError('stale', 'a reviewed comment changed or was removed; refresh and try again')
        captured.push(draft)
      }
      const port = this.prompt?.()
      if (port === undefined)
        throw new CommentStoreError(
          'delivery-unavailable',
          'the DSH session controller is not available; retry when the session is ready',
          true,
        )
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort()
      }, this.promptTimeoutMs)
      timer.unref?.()
      let admitted:
        | { readonly accepted: true }
        | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
      try {
        admitted = await port.prompt(
          {
            requestId,
            sessionId: session,
            mode: 'queue',
            content: [{ type: 'text', text: formatCommentBatch(captured) }],
          },
          controller.signal,
        )
      } catch (error) {
        throw new CommentStoreError(
          'delivery-rejected',
          'the session rejected the comment batch: ' +
            (error instanceof Error ? error.message : String(error)) +
            '; your comments were kept, retry to send again',
          true,
        )
      } finally {
        clearTimeout(timer)
      }
      if ('ok' in admitted && admitted.ok === false)
        throw new CommentStoreError(
          'delivery-rejected',
          'the session rejected the comment batch (' +
            admitted.error.code +
            ': ' +
            admitted.error.message +
            '); your comments were kept, retry to send again',
          true,
        )
      const cleared: string[] = []
      const remaining: CommentDraft[] = []
      for (const draft of state.drafts) {
        const matched = captured.some((candidate) => candidate.id === draft.id && candidate.revision === draft.revision)
        if (matched) cleared.push(draft.id)
        else remaining.push(draft)
      }
      if (cleared.length > 0) {
        state.drafts = remaining
        state.revision += 1
      }
      const accepted: SubmissionReceipt = {
        requestId,
        acceptedAt: this.now(),
        versions: versions.map((version) => ({ ...version })),
        cleared,
      }
      state.receipts.set(requestId, accepted)
      while (state.receipts.size > this.maxReceipts) {
        const oldest = state.receipts.keys().next().value
        if (oldest === undefined) break
        state.receipts.delete(oldest)
      }
      return {
        ...accepted,
        accepted: true,
        versions: accepted.versions.map((version) => ({ ...version })),
        cleared: [...accepted.cleared],
        replayed: false,
        snapshot: copySnapshot(session, state),
      }
    }
    const tail = state.submitTail.then(run, run)
    state.submitTail = tail.then(
      () => undefined,
      () => undefined,
    )
    return tail
  }

  /** Discard one session's drafts and receipts. */
  clearSession(session: string): void {
    this.sessions.delete(session)
  }

  /** Number of sessions with in-memory state, for diagnostics and tests. */
  get size(): number {
    return this.sessions.size
  }

  /** Discard every draft and receipt. */
  dispose(): void {
    this.sessions.clear()
  }
}
