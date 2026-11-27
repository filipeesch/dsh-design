/** Canvas-local anchoring and dismissal shared by popovers and split menus. */
import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { BORDER, RADIUS, SURFACE, TEXT } from './primitives.tsx'

const EDGE = 8
const GAP = 6

export const anchoredSurface: CSSProperties = {
  position: 'absolute',
  zIndex: 51,
  boxSizing: 'border-box',
  overflow: 'auto',
  background: SURFACE,
  color: TEXT,
  border: '1px solid ' + BORDER,
  borderRadius: RADIUS,
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.18)',
}

export function canvasOf(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>('[data-dsx-canvas]') ?? element.closest<HTMLElement>('[data-dsx-screen]')
}

function fitPanel(panel: HTMLElement, anchor: HTMLElement, canvas: HTMLElement): void {
  const frame = canvas.getBoundingClientRect()
  const trigger = anchor.getBoundingClientRect()
  const containing = panel.offsetParent
  const origin = containing?.getBoundingClientRect()
  const view = panel.ownerDocument.defaultView
  const viewportHeight = view?.innerHeight ?? frame.bottom
  // Use the visible vertical slice so the panel remains usable on a scrolled canvas.
  const top = Math.max(0, frame.top) + EDGE
  const bottom = Math.min(viewportHeight, frame.bottom) - EDGE
  const below = Math.max(0, bottom - trigger.bottom - GAP)
  const above = Math.max(0, trigger.top - top - GAP)
  panel.style.maxWidth = Math.max(0, frame.width - EDGE * 2) + 'px'
  panel.style.maxHeight = Math.max(0, bottom - top) + 'px'
  const preferredHeight = panel.scrollHeight + panel.offsetHeight - panel.clientHeight
  const placeBelow = preferredHeight <= below || below >= above
  const space = placeBelow ? below : above
  if (space > 0) panel.style.maxHeight = space + 'px'
  const { width, height } = panel.getBoundingClientRect()
  const left = Math.max(frame.left + EDGE, Math.min(trigger.left, frame.right - EDGE - width))
  const y = Math.max(top, Math.min(placeBelow ? trigger.bottom + GAP : trigger.top - GAP - height, bottom - height))
  panel.style.left = left - (origin?.left ?? 0) - (containing?.clientLeft ?? 0) + (containing?.scrollLeft ?? 0) + 'px'
  panel.style.top = y - (origin?.top ?? 0) - (containing?.clientTop ?? 0) + (containing?.scrollTop ?? 0) + 'px'
}

/** Positions on this canvas and preserves keyboard focus when the panel closes. */
export function useAnchoredPanel(
  open: boolean,
  panelRef: RefObject<HTMLDivElement | null>,
  getAnchor: (canvas: HTMLElement) => HTMLElement | null,
  onDismiss: () => void,
  initialFocus: (panel: HTMLElement) => HTMLElement,
): void {
  const latest = useRef({ getAnchor, onDismiss, initialFocus })
  const refreshAnchor = useRef<(() => void) | undefined>(undefined)
  useLayoutEffect(() => {
    latest.current = { getAnchor, onDismiss, initialFocus }
    if (open) refreshAnchor.current?.()
  })
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!open || panel === null) return
    const canvas = canvasOf(panel)
    if (canvas === null) return
    const initialAnchor = latest.current.getAnchor(canvas)
    if (initialAnchor === null || panel.contains(initialAnchor)) {
      latest.current.onDismiss()
      return
    }
    let anchor = initialAnchor
    const doc = panel.ownerDocument
    const view = doc.defaultView
    let screen = anchor.closest('[data-dsx-screen]')
    let screenId = screen?.getAttribute('data-dsx-screen')
    let focusedInPanel = false
    let dismissed = false
    const dismiss = (returnFocus = false) => {
      if (dismissed) return
      dismissed = true
      if (returnFocus) anchor.focus({ preventScroll: true })
      latest.current.onDismiss()
    }
    const reposition = () => fitPanel(panel, anchor, canvas)
    const contains = (target: EventTarget | null) =>
      target instanceof Node && (panel.contains(target) || anchor.contains(target))
    const onPointer = (event: PointerEvent) => {
      // Another canvas's control may take focus; do not return focus on a pointer dismissal.
      if (!contains(event.target)) dismiss()
    }
    const onFocus = (event: FocusEvent) => {
      focusedInPanel = event.target instanceof Node && panel.contains(event.target)
      if (!contains(event.target)) dismiss()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape' || !contains(event.target)) return
      event.preventDefault()
      dismiss(true)
    }
    reposition()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reposition)
    observer?.observe(canvas)
    observer?.observe(anchor)
    observer?.observe(panel)
    // Reconcile the DOM anchor after live commits without restarting the open panel or moving focus.
    refreshAnchor.current = () => {
      if (dismissed || !panel.isConnected) return
      const next = latest.current.getAnchor(canvas)
      if (next === null || panel.contains(next)) {
        dismiss()
        return
      }
      if (next !== anchor) {
        observer?.unobserve(anchor)
        anchor = next
        screen = anchor.closest('[data-dsx-screen]')
        screenId = screen?.getAttribute('data-dsx-screen')
        observer?.observe(anchor)
      }
      reposition()
    }
    view?.addEventListener('resize', reposition)
    doc.addEventListener('scroll', reposition, true)
    doc.addEventListener('pointerdown', onPointer, true)
    doc.addEventListener('focusin', onFocus)
    doc.addEventListener('keydown', onKey)
    latest.current.initialFocus(panel).focus({ preventScroll: true })
    return () => {
      refreshAnchor.current = undefined
      observer?.disconnect()
      view?.removeEventListener('resize', reposition)
      doc.removeEventListener('scroll', reposition, true)
      doc.removeEventListener('pointerdown', onPointer, true)
      doc.removeEventListener('focusin', onFocus)
      doc.removeEventListener('keydown', onKey)
      if (dismissed || !focusedInPanel) return
      // An authored close() can remove the focused child before layout cleanup.
      // Wait for the commit; do not override focus or restore it after navigation.
      queueMicrotask(() => {
        if (
          !panel.isConnected &&
          anchor.isConnected &&
          canvas.contains(anchor) &&
          screen?.getAttribute('data-dsx-screen') === screenId &&
          (doc.activeElement === doc.body || doc.activeElement === null)
        )
          anchor.focus({ preventScroll: true })
      })
    }
  }, [open, panelRef])
}
