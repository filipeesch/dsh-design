/**
 * Review layer for the interactive preview: component selection, anchored pins,
 * pending drafts, and one explicit batch send.
 *
 * The host is the only draft authority. This layer renders from the snapshot the
 * comment endpoint returns, refreshes on load and focus, and clears only the
 * versions the host acknowledged. It is never mounted in deterministic mode.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { COMMENT_DRAFT_MAX } from '@filipeesch/dsh-design-core'
import type { CommentAnchor, CommentContext, CommentDraft, CommentSnapshot } from '@filipeesch/dsh-design-core'
import {
  CommentApiError,
  createComment,
  fetchComments,
  removeComment,
  submitComments,
  updateComment,
} from './comments.ts'

/** One component the owner can comment on. */
export interface ReviewTarget {
  readonly element: HTMLElement
  readonly anchor: CommentAnchor
}

/** Inputs supplied by the preview application. */
export interface ReviewOverlayProps {
  readonly session: string
  readonly screen: string
  readonly revision: number
  readonly breakpoint: string
  readonly state?: string
  /** Effective variant identity, for example `layout:spacious`. */
  readonly variant?: string
  readonly overlays: readonly string[]
  readonly tabs: Readonly<Record<string, string>>
  readonly frame: HTMLDivElement | null
  /** Content fingerprint of the rendered screen tree. */
  readonly fingerprint?: string
  /** Chrome slot that hosts the compact review controls. */
  readonly barHost?: HTMLElement | null
}

type Composer =
  | {
      readonly kind: 'new'
      readonly text: string
      readonly anchor: CommentAnchor
      readonly context: CommentContext
    }
  | { readonly kind: 'edit'; readonly text: string; readonly id: string; readonly revision: number }

/** How one stored draft relates to the currently rendered screen. */
export type DraftViewStatus =
  | { readonly kind: 'anchored'; readonly element: HTMLElement }
  | { readonly kind: 'context'; readonly reason: 'screen' | 'state' | 'variant' | 'content' }
  | { readonly kind: 'unresolved' }

type Status = { readonly kind: 'success' | 'error' | 'info'; readonly message: string }

interface PinPosition {
  readonly draft: CommentDraft
  readonly index: number
  readonly left: number
  readonly top: number
}

const NODE_SELECTOR = '[data-dsx-id], [data-dsx-address]'

function errorMessage(error: unknown): string {
  if (error instanceof CommentApiError) return error.message
  return error instanceof Error ? error.message : String(error)
}

function newRequestId(): string {
  const api = globalThis.crypto
  if (api !== undefined && typeof api.randomUUID === 'function') return api.randomUUID()
  return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/** Resolve a rendered element to the nearest design node identity. */
export function resolveReviewTarget(
  element: Element | null,
  revision: number,
  fingerprint?: string,
): ReviewTarget | undefined {
  if (element === null) return undefined
  if (element.closest('[data-dsx-review]') !== null) return undefined
  const node = element.closest<HTMLElement>(NODE_SELECTOR)
  if (node === null) return undefined
  const type = node.getAttribute('data-dsx-type') ?? 'Unknown'
  const id = node.getAttribute('data-dsx-id')
  if (id !== null && id !== '') return { element: node, anchor: { id, kind: 'stable', type, revision } }
  const address = node.getAttribute('data-dsx-address')
  if (address !== null && address !== '')
    return {
      element: node,
      anchor: {
        id: address,
        kind: 'structural',
        type,
        revision,
        ...(fingerprint === undefined ? {} : { fingerprint }),
      },
    }
  return undefined
}

/** Find the element a stored anchor still points at, or undefined when it is stale. */
export function findAnchorElement(root: ParentNode, anchor: CommentAnchor): HTMLElement | undefined {
  const nodes = root.querySelectorAll<HTMLElement>(NODE_SELECTOR)
  for (const node of nodes) {
    const value = anchor.kind === 'stable' ? node.getAttribute('data-dsx-id') : node.getAttribute('data-dsx-address')
    if (value !== anchor.id) continue
    if ((node.getAttribute('data-dsx-type') ?? 'Unknown') !== anchor.type) continue
    return node
  }
  return undefined
}

/** Whether a node is rendered and not CSS-hidden. */
function isRendered(node: HTMLElement): boolean {
  if (!node.isConnected) return false
  if (typeof node.checkVisibility === 'function') {
    return node.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })
  }
  const style = getComputedStyle(node)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

/**
 * Resolve a stored draft against the current screen, named state, and revision.
 *
 * A draft from another screen or state is not attached. A structural address is
 * only trusted at its originating revision: later revisions can move the same
 * address onto an unrelated component. Stable ids may survive revisions.
 */
export function resolveDraftStatus(
  draft: CommentDraft,
  root: ParentNode | null,
  view: { readonly screen: string; readonly state?: string; readonly variant?: string; readonly fingerprint?: string },
): DraftViewStatus {
  if (draft.context.screen !== view.screen) return { kind: 'context', reason: 'screen' }
  if ((draft.context.state ?? undefined) !== (view.state ?? undefined)) return { kind: 'context', reason: 'state' }
  if ((draft.context.variant ?? undefined) !== (view.variant ?? undefined))
    return { kind: 'context', reason: 'variant' }
  if (
    draft.anchor.kind === 'structural' &&
    (draft.anchor.fingerprint === undefined || draft.anchor.fingerprint !== view.fingerprint)
  )
    return { kind: 'context', reason: 'content' }
  if (root === null) return { kind: 'unresolved' }
  const node = findAnchorElement(root, draft.anchor)
  if (node === undefined || !isRendered(node)) return { kind: 'unresolved' }
  return { kind: 'anchored', element: node }
}

/** Visible commentable nodes in document order. */
export function visibleReviewTargets(frame: HTMLElement | null): HTMLElement[] {
  if (frame === null) return []
  const scope = frame.querySelector<HTMLElement>('.dsx-frame-inner') ?? frame
  const all = [...scope.querySelectorAll<HTMLElement>(NODE_SELECTOR)].filter(
    (node) => node.closest('[data-dsx-review]') === null,
  )
  const visible = all.filter((node) => node.getClientRects().length > 0)
  // jsdom has no layout; exercising the picker there still needs the nodes.
  return visible.length > 0 ? visible : all
}

function contextOf(props: ReviewOverlayProps): CommentContext {
  const tabs: Record<string, string> = {}
  for (const [key, value] of Object.entries(props.tabs)) {
    if (key === '' || key.startsWith('radio:')) continue
    tabs[key] = value
  }
  return {
    screen: props.screen,
    breakpoint: props.breakpoint,
    ...(props.state === undefined ? {} : { state: props.state }),
    ...(props.variant === undefined ? {} : { variant: props.variant }),
    overlays: [...props.overlays].sort((left, right) => left.localeCompare(right)),
    tabs,
  }
}

function contextSummary(context: CommentContext): string {
  const parts = [context.screen, context.breakpoint]
  if (context.state !== undefined) parts.push('state ' + context.state)
  if (context.variant !== undefined) parts.push('variant ' + context.variant)
  if (context.overlays.length > 0) parts.push('overlays ' + context.overlays.join(', '))
  const tabs = Object.entries(context.tabs)
  if (tabs.length > 0) parts.push('tabs ' + tabs.map(([key, value]) => key + '=' + value).join(', '))
  return parts.join(' · ')
}

/** Draw and manage the review surface inside an interactive preview. */
export function ReviewOverlay(props: ReviewOverlayProps): ReactNode {
  const { session, frame, revision, screen, breakpoint, state, variant, fingerprint, barHost = null } = props
  const [snapshot, setSnapshot] = useState<CommentSnapshot | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [mode, setMode] = useState(false)
  const [composer, setComposer] = useState<Composer | undefined>(undefined)
  const [panelOpen, setPanelOpen] = useState(false)
  const [status, setStatus] = useState<Status | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState(0)
  const [positions, setPositions] = useState<PinPosition[]>([])
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const previousFocus = useRef<HTMLElement | undefined>(undefined)
  const pendingBatch = useRef<{ requestId: string; signature: string } | undefined>(undefined)
  const context = useMemo(() => contextOf(props), [props])
  const contextRef = useRef(context)
  contextRef.current = context
  const revisionRef = useRef(revision)
  revisionRef.current = revision
  const fingerprintRef = useRef(fingerprint)
  fingerprintRef.current = fingerprint
  const drafts = useMemo<readonly CommentDraft[]>(() => snapshot?.drafts ?? [], [snapshot])
  const count = drafts.length
  const atLimit = count >= COMMENT_DRAFT_MAX
  const statuses = useMemo(() => {
    const inner = frame?.querySelector<HTMLElement>('.dsx-frame-inner') ?? null
    const map = new Map<string, DraftViewStatus>()
    for (const draft of drafts) {
      map.set(draft.id, resolveDraftStatus(draft, inner, { screen, state, variant, fingerprint }))
    }
    return map
  }, [drafts, frame, screen, state, variant, fingerprint, breakpoint])

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const next = await fetchComments(session, signal)
        setSnapshot(next)
        setLoadError(undefined)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (signal?.aborted === true) return
        setLoadError(errorMessage(error))
      }
    },
    [session],
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== globalThis.location.origin) return
      const data = event.data as { readonly type?: unknown } | null
      if (data !== null && typeof data === 'object' && data.type === 'dsh-design-refresh') void refresh()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [refresh])

  useEffect(() => {
    setSnapshot(undefined)
    setLoadError(undefined)
    setMode(false)
    setComposer(undefined)
    setPanelOpen(false)
    setStatus(undefined)
    setPositions([])
    pendingBatch.current = undefined
    const controller = new AbortController()
    void refresh(controller.signal)
    const onFocus = (): void => {
      if (!controller.signal.aborted) void refresh()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible' && !controller.signal.aborted) void refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      controller.abort()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [session, refresh])

  const restoreFocus = useCallback(() => {
    const target = previousFocus.current
    previousFocus.current = undefined
    if (target !== undefined && target.isConnected) {
      target.focus()
      if (document.activeElement === target) return
    }
    // A selected node can be structurally non-focusable after mode ends; send
    // focus somewhere real rather than leaving it on the document body.
    const toggle = document.querySelector<HTMLElement>('[data-dsx-review-toggle]')
    toggle?.focus()
  }, [])

  const closeComposer = useCallback(() => {
    setComposer(undefined)
    setStatus((current) => (current?.kind === 'error' ? undefined : current))
  }, [])

  useEffect(() => {
    if (composer === undefined) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeComposer()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [composer, closeComposer])

  const beginNew = useCallback(
    (element: HTMLElement) => {
      if (drafts.length >= COMMENT_DRAFT_MAX) {
        setStatus({
          kind: 'error',
          message:
            'Pending review is full (' +
            String(COMMENT_DRAFT_MAX) +
            '). Send or remove comments before adding another.',
        })
        return
      }
      const target = resolveReviewTarget(element, revisionRef.current, fingerprintRef.current)
      if (target === undefined) return
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      const selected = contextRef.current
      setMode(false)
      setComposer({
        kind: 'new',
        text: '',
        anchor: target.anchor,
        context: { ...selected, overlays: [...selected.overlays], tabs: { ...selected.tabs } },
      })
      setStatus(undefined)
    },
    [drafts.length],
  )

  const beginEdit = useCallback((draft: CommentDraft) => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    setMode(false)
    setPanelOpen(true)
    setComposer({ kind: 'edit', text: draft.text, id: draft.id, revision: draft.revision })
    setStatus(undefined)
  }, [])

  const composerWasOpen = useRef(false)
  useEffect(() => {
    if (composer !== undefined) {
      composerWasOpen.current = true
      composerRef.current?.focus()
    } else if (composerWasOpen.current) {
      composerWasOpen.current = false
      restoreFocus()
    }
  }, [composer, restoreFocus])

  useEffect(() => {
    if (!mode || composer !== undefined) return
    const targets = visibleReviewTargets(frame)
    const node = targets[Math.min(picker, targets.length - 1)]
    if (node === undefined) return
    const outline = node.style.outline
    const offset = node.style.outlineOffset
    const tabIndex = node.getAttribute('tabindex')
    node.style.outline = '3px solid #2563eb'
    node.style.outlineOffset = '2px'
    node.setAttribute('data-dsx-review-target', '')
    if (tabIndex === null) node.setAttribute('tabindex', '-1')
    try {
      node.focus({ preventScroll: true })
    } catch {
      // A host element that cannot take focus still gets the visible ring and
      // keeps keyboard selection state, which is what Enter acts on.
    }
    if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
    return () => {
      node.style.outline = outline
      node.style.outlineOffset = offset
      node.removeAttribute('data-dsx-review-target')
      if (tabIndex === null) node.removeAttribute('tabindex')
      else node.setAttribute('tabindex', tabIndex)
    }
  }, [mode, composer, frame, picker, revision, breakpoint])

  useEffect(() => {
    if (!mode) return
    const onClick = (event: MouseEvent): void => {
      if (composer !== undefined) return
      const target = event.target
      if (!(target instanceof Element)) return
      const resolved = resolveReviewTarget(target, revisionRef.current)
      if (resolved === undefined) return
      event.preventDefault()
      event.stopPropagation()
      beginNew(resolved.element)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [mode, composer, beginNew])

  useEffect(() => {
    if (!mode) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setMode(false)
        restoreFocus()
        return
      }
      if (composer !== undefined) return
      if (target instanceof HTMLElement && target.closest('.dsx-review-composer') !== null) return
      if (target instanceof HTMLElement && target.closest('.dsx-review-panel') !== null) return
      // The toggle itself may still be focused before the selection ring takes
      // focus, and returns there when a composer closes. Enter/Space on it keeps
      // its normal cancel action; arrows and letters still drive the picker.
      if (
        target instanceof HTMLElement &&
        target.closest('[data-dsx-review-toggle]') !== null &&
        (event.key === 'Enter' || event.key === ' ')
      ) {
        return
      }
      if (
        target instanceof HTMLElement &&
        target.closest('[data-dsx-review]') === null &&
        target.closest('input, textarea, select, [contenteditable="true"]') !== null
      )
        return
      const targets = visibleReviewTargets(frame)
      if (targets.length === 0) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault()
        event.stopPropagation()
        setPicker((current) => (current + 1) % targets.length)
        return
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault()
        event.stopPropagation()
        setPicker((current) => (current - 1 + targets.length) % targets.length)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        const node = targets[Math.min(picker, targets.length - 1)]
        if (node !== undefined) beginNew(node)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [mode, composer, frame, picker, beginNew, restoreFocus, closeComposer])

  useEffect(() => {
    if (frame === null) {
      setPositions([])
      return
    }
    const compute = (): void => {
      const frameRect = frame.getBoundingClientRect()
      const inner = frame.querySelector<HTMLElement>('.dsx-frame-inner') ?? frame
      const next: PinPosition[] = []
      const view = { screen, state, variant, fingerprint }
      drafts.forEach((draft, index) => {
        const resolution = resolveDraftStatus(draft, inner, view)
        if (resolution.kind !== 'anchored') return
        const rect = resolution.element.getBoundingClientRect()
        const left = Math.min(Math.max(rect.right - frameRect.left - 9, 2), Math.max(frameRect.width - 22, 2))
        const top = Math.min(Math.max(rect.top - frameRect.top - 9, 2), Math.max(frameRect.height - 22, 2))
        next.push({ draft, index, left, top })
      })
      setPositions(next)
    }
    compute()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(compute)
    observer?.observe(frame)
    const inner = frame.querySelector<HTMLElement>('.dsx-frame-inner')
    if (inner !== null) observer?.observe(inner)
    window.addEventListener('resize', compute)
    document.addEventListener('scroll', compute, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', compute)
      document.removeEventListener('scroll', compute, true)
    }
  }, [frame, drafts, revision, screen, state, variant, fingerprint, breakpoint])

  const save = async (): Promise<void> => {
    if (composer === undefined || busy) return
    const text = composer.text.trim()
    if (text === '') {
      setStatus({ kind: 'error', message: 'Comment text is required.' })
      return
    }
    setBusy(true)
    setStatus(undefined)
    try {
      const next =
        composer.kind === 'new'
          ? await createComment(session, { text, anchor: composer.anchor, context: composer.context })
          : await updateComment(session, composer.id, composer.revision, text)
      setSnapshot(next)
      setComposer(undefined)
      setStatus({ kind: 'success', message: composer.kind === 'new' ? 'Comment added.' : 'Comment updated.' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (draft: CommentDraft): Promise<void> => {
    if (busy || sending) return
    setBusy(true)
    setStatus(undefined)
    try {
      setSnapshot(await removeComment(session, draft.id, draft.revision))
      if (composer !== undefined && composer.kind === 'edit' && composer.id === draft.id) setComposer(undefined)
      setStatus({ kind: 'success', message: 'Comment removed.' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const send = async (): Promise<void> => {
    if (sending || drafts.length === 0) return
    const versions = drafts.map((draft) => ({ id: draft.id, revision: draft.revision }))
    const signature = versions.map((version) => version.id + ':' + String(version.revision)).join('|')
    const existing = pendingBatch.current
    const requestId = existing?.signature === signature ? existing.requestId : newRequestId()
    pendingBatch.current = { requestId, signature }
    setSending(true)
    setStatus(undefined)
    try {
      const result = await submitComments(session, requestId, versions)
      setSnapshot(result.snapshot)
      pendingBatch.current = undefined
      const accepted = result.versions.length
      const cleared = result.cleared.length
      const remaining = result.snapshot.drafts.length
      const edited = Math.max(accepted - cleared, 0)
      const added = Math.max(remaining - edited, 0)
      const message = ['Sent ' + String(accepted) + (accepted === 1 ? ' comment' : ' comments') + ' as one message.']
      if (edited > 0) message.push(String(edited) + ' edited during send stayed pending.')
      if (added > 0) message.push(String(added) + ' newer draft(s) kept.')
      setStatus({ kind: 'success', message: message.join(' ') })
      setPanelOpen(remaining > 0)
    } catch (error) {
      const suffix = error instanceof CommentApiError && error.retryable ? ' Retry to send again.' : ''
      setStatus({ kind: 'error', message: errorMessage(error) + suffix })
      // A competing panel or tab may have accepted or changed this batch; show
      // the host's current version instead of a stale local list.
      void refresh()
    } finally {
      setSending(false)
    }
  }

  const statusBadge = (draft: CommentDraft): { readonly label: string; readonly className: string } | undefined => {
    const status = statuses.get(draft.id)
    if (status === undefined || status.kind === 'anchored') return undefined
    if (status.kind === 'unresolved') return { label: 'unanchored', className: 'dsx-review-stale' }
    return {
      label:
        status.reason === 'screen'
          ? 'different screen'
          : status.reason === 'state'
            ? 'different state'
            : status.reason === 'variant'
              ? 'different variant'
              : 'content changed',
      className: 'dsx-review-context-mismatch',
    }
  }

  const pins =
    frame === null
      ? null
      : createPortal(
          <div className="dsx-pins" data-dsx-review>
            {positions.map((position) => (
              <button
                key={position.draft.id}
                type="button"
                className="dsx-pin"
                style={{ left: position.left, top: position.top }}
                aria-label={'Edit comment ' + String(position.index + 1) + ' on ' + position.draft.anchor.type}
                title={'Comment ' + String(position.index + 1)}
                onClick={() => beginEdit(position.draft)}
              >
                {position.index + 1}
              </button>
            ))}
          </div>,
          frame,
        )

  const instruction = mode ? 'Select a component. Arrow keys move, Enter selects, Escape exits.' : undefined
  const bar = (
    <div className="dsx-review-bar" data-dsx-review>
      <button
        type="button"
        data-dsx-review-toggle
        aria-pressed={mode}
        className={mode ? 'active' : ''}
        disabled={!mode && atLimit}
        title={
          !mode && atLimit
            ? 'Pending review is full (' + String(COMMENT_DRAFT_MAX) + '). Send or remove comments first.'
            : undefined
        }
        onClick={() => {
          setStatus(undefined)
          if (mode) {
            setMode(false)
            restoreFocus()
          } else {
            previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
            setPicker(0)
            setMode(true)
          }
        }}
      >
        {mode ? 'Cancel comment' : 'Comment'}
      </button>
      <button type="button" onClick={() => setPanelOpen((open) => !open)} aria-expanded={panelOpen}>
        Pending ({count})
      </button>
      {loadError !== undefined && snapshot === undefined ? (
        <button type="button" onClick={() => void refresh()}>
          Retry
        </button>
      ) : null}
    </div>
  )
  const floating = instruction !== undefined || status !== undefined || panelOpen || composer !== undefined
  return (
    <>
      {pins}
      {barHost === null ? null : createPortal(bar, barHost)}
      {floating ? (
        <div className="dsx-review" data-dsx-review>
          {instruction !== undefined ? (
            <div className="dsx-review-hint" role="status">
              {instruction}
            </div>
          ) : null}
          {status !== undefined ? (
            <div className={'dsx-review-status ' + status.kind} role={status.kind === 'error' ? 'alert' : 'status'}>
              <span>{status.message}</span>
              <button
                type="button"
                className="dsx-review-dismiss"
                aria-label="Dismiss message"
                onClick={() => setStatus(undefined)}
              >
                ×
              </button>
            </div>
          ) : null}
          {panelOpen ? (
            <aside className="dsx-review-panel" aria-label="Pending review comments">
              <header>
                <strong>Pending review</strong>
                <button type="button" aria-label="Close pending review" onClick={() => setPanelOpen(false)}>
                  ×
                </button>
              </header>
              {loadError !== undefined ? (
                <div className="dsx-review-error" role="alert">
                  <p>{loadError}</p>
                  <button type="button" onClick={() => void refresh()}>
                    Retry
                  </button>
                </div>
              ) : null}
              {drafts.length === 0 ? (
                <p className="dsx-review-empty">No pending comments. Turn on Comment and select a component.</p>
              ) : (
                <ul>
                  {drafts.map((draft, index) => {
                    const badge = statusBadge(draft)
                    return (
                      <li key={draft.id}>
                        <div className="dsx-review-meta">
                          <strong>#{index + 1}</strong>
                          <span>{draft.anchor.type}</span>
                          <span>{draft.anchor.kind === 'stable' ? 'stable id' : 'unstable address'}</span>
                          {badge === undefined ? null : <span className={badge.className}>{badge.label}</span>}
                        </div>
                        <p>{draft.text}</p>
                        <div className="dsx-review-context">{contextSummary(draft.context)}</div>
                        <div className="dsx-review-actions">
                          <button type="button" onClick={() => beginEdit(draft)} disabled={busy || sending}>
                            Edit
                          </button>
                          <button type="button" onClick={() => void remove(draft)} disabled={busy || sending}>
                            Remove
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              <footer>
                <button
                  type="button"
                  className="dsx-review-send"
                  onClick={() => void send()}
                  disabled={sending || drafts.length === 0}
                >
                  {sending ? 'Sending…' : 'Send ' + String(count) + (count === 1 ? ' comment' : ' comments')}
                </button>
                <small>
                  {String(count)} of {String(COMMENT_DRAFT_MAX)} pending. One chat message. Unsent comments stay in this
                  DSH process.
                </small>
              </footer>
            </aside>
          ) : null}
          {composer !== undefined ? (
            <div className="dsx-review-composer" role="dialog" aria-label="Comment composer" aria-modal="false">
              <header>
                <strong>{composer.kind === 'new' ? 'New comment' : 'Edit comment'}</strong>
                <button type="button" aria-label="Close comment composer" onClick={closeComposer}>
                  ×
                </button>
              </header>
              {composer.kind === 'new' ? (
                <div className="dsx-review-context">
                  {composer.anchor.type} · {composer.anchor.id}
                  {composer.anchor.kind === 'structural' ? ' (unstable address)' : ''}
                </div>
              ) : null}
              <textarea
                ref={composerRef}
                aria-label="Comment text"
                value={composer.text}
                onChange={(event) =>
                  setComposer((current) => (current === undefined ? current : { ...current, text: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    closeComposer()
                  } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    void save()
                  }
                }}
                rows={3}
                maxLength={2000}
                placeholder="What should change here?"
              />
              <div className="dsx-review-context">
                Screen {screen} · {breakpoint}
                {composer.kind === 'new' && composer.context.variant !== undefined
                  ? ' · variant ' + composer.context.variant
                  : ''}
              </div>
              <div className="dsx-review-actions">
                <button type="button" className="dsx-review-save" onClick={() => void save()} disabled={busy}>
                  {busy ? 'Saving…' : 'Save comment'}
                </button>
                <button type="button" onClick={closeComposer}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
