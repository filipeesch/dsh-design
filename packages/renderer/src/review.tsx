/**
 * Review layer for the interactive preview: component selection, anchored pins,
 * pending drafts, and one explicit batch send.
 *
 * The host is the only draft authority. This layer renders from the snapshot the
 * comment endpoint returns, refreshes on load and focus, and clears only the
 * versions the host acknowledged. It is never mounted in deterministic mode.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
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
  readonly theme?: string
  readonly overlays?: readonly string[]
  readonly disclosures?: Readonly<Record<string, boolean>>
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
  | {
      readonly kind: 'edit'
      readonly text: string
      readonly id: string
      readonly revision: number
      /** Immutable draft context; the same matching rules as a saved pin apply. */
      readonly context: CommentContext
      /** Anchor resolved when the editor opened; absent when the draft has no usable target. */
      readonly anchor?: CommentAnchor
    }

/** Why a draft or open editor is detached from the current view. */
export type AnchorContextReason = 'screen' | 'state' | 'variant' | 'content'

/** How one stored draft relates to the currently rendered screen. */
export type DraftViewStatus =
  | { readonly kind: 'anchored'; readonly element: HTMLElement }
  | { readonly kind: 'context'; readonly reason: AnchorContextReason }
  | { readonly kind: 'unresolved' }

type Status = { readonly kind: 'success' | 'error' | 'info'; readonly message: string }

interface PinPosition {
  readonly draft: CommentDraft
  readonly index: number
  readonly left: number
  readonly top: number
}

/** One placement for the component-anchored comment balloon. */
export interface BalloonPlacement {
  readonly side: 'right' | 'left' | 'bottom' | 'top'
  readonly left: number
  readonly top: number
  readonly width: number
  readonly maxHeight: number
  /** Offset of the pointer centre from the balloon's leading edge. */
  readonly pointer: number
}

/** Minimal rectangle geometry shared by every placement input. */
export interface BalloonRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

const BALLOON_GAP = 12
const BALLOON_MARGIN = 8
const BALLOON_MAX_WIDTH = 360
const BALLOON_MIN_WIDTH = 180
/** jsdom has no layout; a sane height still yields a deterministic test placement. */
const BALLOON_FALLBACK_HEIGHT = 220
const BALLOON_MIN_HEIGHT = 120

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

/** Intersect one rectangle with another, collapsing to zero area when disjoint. */
export function intersectBalloonRect(rect: BalloonRect, bounds: BalloonRect): BalloonRect {
  const left = Math.max(rect.left, bounds.left)
  const top = Math.max(rect.top, bounds.top)
  const right = Math.min(rect.right, bounds.right)
  const bottom = Math.min(rect.bottom, bounds.bottom)
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  }
}

/** Whether any part of the target is inside the visible pane. */
export function isBalloonTargetVisible(target: BalloonRect, bounds: BalloonRect): boolean {
  const visible = intersectBalloonRect(target, bounds)
  return visible.width > 0 && visible.height > 0
}

/**
 * Place the balloon beside the visible target without ever covering it.
 *
 * Each candidate side must have enough usable room in the pane for a minimum
 * editor: horizontal sides shrink the width, vertical sides shrink the height
 * and let the balloon scroll internally. Sides are tried right, left, below,
 * above. When none is usable, this returns undefined so the caller can show an
 * explicitly pointerless editor instead of a false or overlapping pointer.
 */
export function placeCommentBalloon(
  target: BalloonRect,
  bounds: BalloonRect,
  measured: { readonly width: number; readonly height: number },
): BalloonPlacement | undefined {
  const margin = BALLOON_MARGIN
  const gap = BALLOON_GAP
  const maxWidth = Math.min(BALLOON_MAX_WIDTH, bounds.width - margin * 2)
  const maxHeight = bounds.height - margin * 2
  const visible = intersectBalloonRect(target, bounds)
  if (maxWidth < BALLOON_MIN_WIDTH || maxHeight < BALLOON_MIN_HEIGHT) return undefined
  if (visible.width <= 0 || visible.height <= 0) return undefined
  const rawHeight = Math.min(Math.max(measured.height > 1 ? measured.height : BALLOON_FALLBACK_HEIGHT, 1), maxHeight)
  const leftLimit = bounds.left + margin
  const topLimit = bounds.top + margin
  const rightLimit = Math.max(bounds.right - margin, leftLimit)
  const bottomLimit = Math.max(bounds.bottom - margin, topLimit)
  const centreX = visible.left + visible.width / 2
  const centreY = visible.top + visible.height / 2
  const pointerFor = (
    side: BalloonPlacement['side'],
    left: number,
    top: number,
    width: number,
    height: number,
  ): number =>
    side === 'right' || side === 'left'
      ? clamp(centreY - top, 14, Math.max(14, height - 14))
      : clamp(centreX - left, 14, Math.max(14, width - 14))

  const rightSpace = rightLimit - visible.right - gap
  if (rightSpace >= BALLOON_MIN_WIDTH) {
    const width = Math.min(maxWidth, rightSpace)
    const height = Math.min(rawHeight, maxHeight)
    const left = visible.right + gap
    const top = clamp(centreY - height / 2, topLimit, bottomLimit - height)
    if (left + width <= rightLimit && top >= topLimit && top + height <= bottomLimit) {
      return { side: 'right', left, top, width, maxHeight, pointer: pointerFor('right', left, top, width, height) }
    }
  }
  const leftSpace = visible.left - leftLimit - gap
  if (leftSpace >= BALLOON_MIN_WIDTH) {
    const width = Math.min(maxWidth, leftSpace)
    const height = Math.min(rawHeight, maxHeight)
    const left = visible.left - gap - width
    const top = clamp(centreY - height / 2, topLimit, bottomLimit - height)
    if (left >= leftLimit && top >= topLimit && top + height <= bottomLimit) {
      return { side: 'left', left, top, width, maxHeight, pointer: pointerFor('left', left, top, width, height) }
    }
  }
  const bottomSpace = bottomLimit - visible.bottom - gap
  if (bottomSpace >= BALLOON_MIN_HEIGHT) {
    const height = Math.min(rawHeight, bottomSpace)
    const width = maxWidth
    const left = clamp(centreX - width / 2, leftLimit, rightLimit - width)
    const top = visible.bottom + gap
    if (top + height <= bottomLimit) {
      return {
        side: 'bottom',
        left,
        top,
        width,
        maxHeight: height,
        pointer: pointerFor('bottom', left, top, width, height),
      }
    }
  }
  const topSpace = visible.top - topLimit - gap
  if (topSpace >= BALLOON_MIN_HEIGHT) {
    const height = Math.min(rawHeight, topSpace)
    const width = maxWidth
    const left = clamp(centreX - width / 2, leftLimit, rightLimit - width)
    const top = visible.top - gap - height
    if (top >= topLimit) {
      return {
        side: 'top',
        left,
        top,
        width,
        maxHeight: height,
        pointer: pointerFor('top', left, top, width, height),
      }
    }
  }
  return undefined
}

function sameBalloon(left: BalloonPlacement | undefined, right: BalloonPlacement): boolean {
  return (
    left !== undefined &&
    left.side === right.side &&
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.maxHeight === right.maxHeight &&
    left.pointer === right.pointer
  )
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
 * Shared anchor-context rule for saved pins and the open composer balloon.
 *
 * A draft from another screen, state or variant is never attached, and a
 * structural address is only trusted while its rendered-content fingerprint
 * still matches. Stable ids may survive revisions.
 */
export function anchorContextMismatch(
  context: CommentContext,
  anchor: CommentAnchor,
  view: { readonly screen: string; readonly state?: string; readonly variant?: string; readonly fingerprint?: string },
): AnchorContextReason | undefined {
  if (context.screen !== view.screen) return 'screen'
  if ((context.state ?? undefined) !== (view.state ?? undefined)) return 'state'
  if ((context.variant ?? undefined) !== (view.variant ?? undefined)) return 'variant'
  if (anchor.kind === 'structural' && (anchor.fingerprint === undefined || anchor.fingerprint !== view.fingerprint))
    return 'content'
  return undefined
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
  const mismatch = anchorContextMismatch(draft.context, draft.anchor, view)
  if (mismatch !== undefined) return { kind: 'context', reason: mismatch }
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
    ...(props.theme === undefined ? {} : { theme: props.theme }),
    ...(props.overlays === undefined ? {} : { overlays: [...props.overlays].sort() }),
    ...(props.disclosures === undefined ? {} : { disclosures: { ...props.disclosures } }),
    tabs,
  }
}

function contextSummary(context: CommentContext): string {
  const parts = [context.screen, context.breakpoint]
  if (context.state !== undefined) parts.push('state ' + context.state)
  if (context.variant !== undefined) parts.push('variant ' + context.variant)
  if (context.theme !== undefined) parts.push('theme ' + context.theme)
  if (context.overlays !== undefined && (context.overlays.length > 0 || context.theme !== undefined))
    parts.push('overlays ' + (context.overlays.join(', ') || 'none'))
  const disclosures = Object.entries(context.disclosures ?? {})
  if (disclosures.length > 0)
    parts.push(
      'disclosures ' + disclosures.map(([id, expanded]) => id + '=' + (expanded ? 'open' : 'closed')).join(', '),
    )
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
  const [balloon, setBalloon] = useState<BalloonPlacement | undefined>(undefined)
  const [balloonDetached, setBalloonDetached] = useState<AnchorContextReason | 'missing' | 'space' | undefined>(
    undefined,
  )
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const balloonRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | undefined>(undefined)
  const pendingBatch = useRef<{ requestId: string; signature: string } | undefined>(undefined)
  const context = useMemo(() => contextOf(props), [props])
  const contextRef = useRef(context)
  contextRef.current = context
  const revisionRef = useRef(revision)
  revisionRef.current = revision
  const fingerprintRef = useRef(fingerprint)
  fingerprintRef.current = fingerprint
  const viewRef = useRef({ screen, state, variant, fingerprint })
  viewRef.current = { screen, state, variant, fingerprint }
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

  const frameRef = useRef(frame)
  frameRef.current = frame
  const composerStateRef = useRef(composer)
  composerStateRef.current = composer
  const balloonRaf = useRef<number | undefined>(undefined)
  const balloonTarget = useRef<HTMLElement | undefined>(undefined)
  const balloonTargetObserver = useRef<ResizeObserver | undefined>(undefined)
  const balloonUpdate = useRef<() => void>(() => undefined)

  const scheduleBalloon = useCallback((): void => {
    if (balloonRaf.current !== undefined) return
    const raf = globalThis.requestAnimationFrame
    if (typeof raf !== 'function') {
      balloonUpdate.current()
      return
    }
    balloonRaf.current = raf(() => {
      balloonRaf.current = undefined
      balloonUpdate.current()
    })
  }, [])

  const updateBalloon = useCallback((): void => {
    const currentComposer = composerStateRef.current
    const currentFrame = frameRef.current
    if (currentComposer === undefined || currentFrame === null) {
      setBalloon(undefined)
      setBalloonDetached(undefined)
      return
    }
    if (currentComposer.anchor === undefined) {
      setBalloon(undefined)
      setBalloonDetached(undefined)
      return
    }
    // The editor keeps the same immutable context as a saved draft, so a
    // navigation, state/variant change or content edit detaches the balloon
    // instead of finding an unrelated component with the same id or address.
    const mismatch = anchorContextMismatch(currentComposer.context, currentComposer.anchor, viewRef.current)
    if (mismatch !== undefined) {
      setBalloon(undefined)
      setBalloonDetached(mismatch)
      return
    }
    const inner = currentFrame.querySelector<HTMLElement>('.dsx-frame-inner') ?? currentFrame
    const element = findAnchorElement(inner, currentComposer.anchor)
    const stage = currentFrame.closest<HTMLElement>('.dsx-stage')
    const pane = (stage ?? currentFrame).getBoundingClientRect()
    const width = globalThis.innerWidth || document.documentElement.clientWidth || pane.right
    const height = globalThis.innerHeight || document.documentElement.clientHeight || pane.bottom
    const bounds = intersectBalloonRect(pane, { left: 0, top: 0, right: width, bottom: height, width, height })
    const target = element === undefined || !isRendered(element) ? undefined : element.getBoundingClientRect()
    if (target === undefined || bounds.width <= 0 || bounds.height <= 0 || !isBalloonTargetVisible(target, bounds)) {
      setBalloon(undefined)
      setBalloonDetached('missing')
      return
    }
    const measured = balloonRef.current === null ? undefined : balloonRef.current.getBoundingClientRect()
    // The visible box may already be capped by a previous short-pane placement;
    // the scrollable body keeps the natural content height so the balloon can
    // grow back when the pane does.
    const body = balloonRef.current?.querySelector<HTMLElement>('.dsx-review-balloon-body')
    const contentHeight = Math.max(measured?.height ?? 0, body?.scrollHeight ?? 0)
    const placement = placeCommentBalloon(target, bounds, {
      width: measured?.width ?? BALLOON_MAX_WIDTH,
      height: contentHeight > 0 ? contentHeight : BALLOON_FALLBACK_HEIGHT,
    })
    if (placement === undefined) {
      // No side has enough room for a non-overlapping editor: keep the text
      // editable in the pointerless fallback instead of drawing a false arrow.
      setBalloon(undefined)
      setBalloonDetached('space')
      return
    }
    setBalloon((current) => (sameBalloon(current, placement) ? current : placement))
    setBalloonDetached(undefined)
    if (balloonTarget.current !== element) {
      balloonTargetObserver.current?.disconnect()
      if (element !== undefined && typeof ResizeObserver !== 'undefined') {
        balloonTargetObserver.current ??= new ResizeObserver(() => scheduleBalloon())
        balloonTargetObserver.current.observe(element)
      }
      balloonTarget.current = element
    }
  }, [scheduleBalloon])
  balloonUpdate.current = updateBalloon

  useLayoutEffect(() => {
    updateBalloon()
    // Recompute when the editor opens, its anchor or immutable context changes,
    // or the preview moves to another screen/state/variant, not on every
    // keystroke; observers cover layout and target changes while it is open.
  }, [
    composer === undefined,
    composer?.kind,
    composer?.anchor,
    composer?.context,
    frame,
    screen,
    state,
    variant,
    fingerprint,
    updateBalloon,
  ])

  useEffect(() => {
    if (composer === undefined || frame === null) return
    const inner = frame.querySelector<HTMLElement>('.dsx-frame-inner')
    const stage = frame.closest<HTMLElement>('.dsx-stage')
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => scheduleBalloon())
    resize?.observe(frame)
    if (inner !== null) resize?.observe(inner)
    if (stage !== null) resize?.observe(stage)
    if (balloonRef.current !== null) resize?.observe(balloonRef.current)
    const mutations =
      typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => scheduleBalloon())
    mutations?.observe(inner ?? frame, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-dsx-id', 'data-dsx-address', 'class', 'style'],
    })
    window.addEventListener('resize', scheduleBalloon)
    document.addEventListener('scroll', scheduleBalloon, true)
    scheduleBalloon()
    return () => {
      resize?.disconnect()
      mutations?.disconnect()
      balloonTargetObserver.current?.disconnect()
      balloonTargetObserver.current = undefined
      balloonTarget.current = undefined
      window.removeEventListener('resize', scheduleBalloon)
      document.removeEventListener('scroll', scheduleBalloon, true)
      if (balloonRaf.current !== undefined) {
        globalThis.cancelAnimationFrame?.(balloonRaf.current)
        balloonRaf.current = undefined
      }
    }
  }, [composer === undefined, frame, scheduleBalloon])

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
        context: selected,
      })
      setStatus(undefined)
    },
    [drafts.length],
  )

  const beginEdit = useCallback(
    (draft: CommentDraft) => {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      setMode(false)
      setPanelOpen(true)
      const resolved = statuses.get(draft.id)
      const element = resolved?.kind === 'anchored' ? resolved.element : undefined
      // A pin for a target outside the visible pane still reopens at that
      // component: bring it into view before placing the balloon. A stale or
      // foreign draft keeps its text and opens without a pointer instead.
      if (element !== undefined && typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
      setComposer({
        kind: 'edit',
        text: draft.text,
        id: draft.id,
        revision: draft.revision,
        context: draft.context,
        ...(element === undefined ? {} : { anchor: draft.anchor }),
      })
      setStatus(undefined)
    },
    [statuses],
  )

  const composerWasOpen = useRef(false)
  const focusedComposer = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (composer !== undefined) {
      composerWasOpen.current = true
      const key = composer.kind + ':' + (composer.kind === 'edit' ? composer.id : composer.anchor.id)
      // An anchored balloon is briefly hidden while it is measured; focus it
      // once it is visible instead of losing focus to the drawer behind it.
      if (focusedComposer.current === key) return
      if (composer.anchor !== undefined && balloon === undefined && balloonDetached === undefined) return
      focusedComposer.current = key
      composerRef.current?.focus()
    } else if (composerWasOpen.current) {
      composerWasOpen.current = false
      focusedComposer.current = undefined
      restoreFocus()
    }
  }, [composer, balloon, balloonDetached, restoreFocus])

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
      if (target instanceof Element && target.closest('.dsx-preview-dialog') !== null) return
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
            <div
              ref={balloonRef}
              className={'dsx-review-composer' + (balloon === undefined ? ' is-unanchored' : ' is-anchored')}
              role="dialog"
              aria-label="Comment composer"
              aria-modal="false"
              data-dsx-balloon={balloon === undefined ? 'unanchored' : 'anchored'}
              data-anchor={balloon === undefined ? 'unavailable' : 'available'}
              data-detached={balloonDetached}
              data-side={balloon?.side}
              style={
                balloon !== undefined
                  ? ({
                      left: balloon.left,
                      top: balloon.top,
                      width: balloon.width,
                      maxHeight: balloon.maxHeight,
                      '--dsx-pointer': String(balloon.pointer) + 'px',
                    } as CSSProperties)
                  : composer.anchor !== undefined && balloonDetached === undefined
                    ? { visibility: 'hidden' }
                    : undefined
              }
            >
              {balloon !== undefined ? <span className="dsx-review-pointer" aria-hidden="true" /> : null}
              <div className="dsx-review-balloon-body">
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
                ) : composer.anchor === undefined ? null : (
                  <div className="dsx-review-context">
                    {composer.anchor.type} · {composer.anchor.id}
                    {composer.anchor.kind === 'structural' ? ' (unstable address)' : ''}
                  </div>
                )}
                {composer.anchor === undefined ? (
                  <div className="dsx-review-context dsx-review-away">
                    This comment belongs to another screen, state, variant, or a component that changed. It stays
                    editable here without a pointer.
                  </div>
                ) : balloonDetached === 'missing' ? (
                  <div className="dsx-review-context dsx-review-away" role="status">
                    Target unavailable on this view. Your text is kept; the balloon returns when the component is
                    visible again.
                  </div>
                ) : balloonDetached === 'space' ? (
                  <div className="dsx-review-context dsx-review-away" role="status">
                    Not enough room beside this component in the visible pane. Your text is kept; the balloon returns
                    when the pane or the component has room again.
                  </div>
                ) : balloonDetached !== undefined ? (
                  <div className="dsx-review-context dsx-review-away" role="status">
                    This balloon is detached from the current screen, state, variant, or content. Your text is kept; it
                    reattaches only when its original target is valid again.
                  </div>
                ) : null}
                <textarea
                  ref={composerRef}
                  aria-label="Comment text"
                  value={composer.text}
                  onChange={(event) =>
                    setComposer((current) =>
                      current === undefined ? current : { ...current, text: event.target.value },
                    )
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
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
