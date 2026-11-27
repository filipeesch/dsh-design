/** Overlay components opened by interaction references. */
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import type { DesignElement } from '@filipeesch/dsh-design-core'
import { anchoredSurface, useAnchoredPanel } from './anchored.ts'
import { useDesign } from './context.tsx'
import { useAct, useInteraction } from './interactions.ts'
import {
  backdropStyle,
  BORDER,
  FONT,
  GAP_SM,
  MUTED,
  overlayStyle,
  PAD_MD,
  RADIUS,
  SURFACE,
  TEXT,
  type DesignComponentProps,
} from './primitives.tsx'
import { nodeAttributes, useStringProp, useStyleValue } from './styles.ts'

/** Shared shell: backdrop, dialog panel, close control, Escape handled by the renderer. */
function OverlayShell({
  node,
  children,
  side,
  role,
  styles,
}: {
  node: DesignElement
  children?: ReactNode
  side: 'left' | 'right' | 'center' | 'bottom'
  role: string
  styles?: CSSProperties
}) {
  const env = useDesign()
  const id = node.id ?? node.address.label
  const open = env.isOverlayOpen(id)
  const act = useAct(node, 'onClose')
  const authoredTitle = useStringProp(node, 'title')
  const title = authoredTitle ?? ''
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const padding = useStyleValue(node, 'padding') ?? PAD_MD
  const background = useStyleValue(node, 'background')
  const titleId = 'dsx-dialog-title-' + useId()
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (dialog === null) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    let active = true
    const isTop = (): boolean => {
      // Only modal dialogs compete for "top"; a non-modal review composer must
      // not disable the drawer's focus trap while it is open.
      const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
      return dialogs.at(-1) === dialog
    }
    const focusableWithin = (root: HTMLElement): HTMLElement[] =>
      [
        ...root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0)
    const focusable = (): HTMLElement[] => focusableWithin(dialog)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !active || !isTop()) return
      // The review layer is a documented sibling surface: its composer must keep
      // focus while this dialog is open, but Tab cycles within that surface
      // rather than escaping to the page behind the modal.
      const current = document.activeElement
      const review = current instanceof Element ? current.closest<HTMLElement>('[data-dsx-review]') : null
      if (review !== null) {
        const reviewItems = focusableWithin(review)
        if (reviewItems.length === 0) {
          event.preventDefault()
          return
        }
        event.preventDefault()
        const index = reviewItems.indexOf(current as HTMLElement)
        const next = event.shiftKey
          ? reviewItems[index <= 0 ? reviewItems.length - 1 : index - 1]
          : reviewItems[index < 0 || index === reviewItems.length - 1 ? 0 : index + 1]
        next?.focus()
        return
      }
      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0] as HTMLElement
      const last = items.at(-1) as HTMLElement
      if (event.shiftKey && (current === first || current === null || !dialog.contains(current))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (current === last || current === null || !dialog.contains(current))) {
        event.preventDefault()
        first.focus()
      }
    }
    const onFocusIn = (event: FocusEvent): void => {
      if (!active || !isTop()) return
      if (!(event.target instanceof Node) || dialog.contains(event.target)) return
      // The review composer lives outside the dialog by design; it must keep
      // focus so an owner can comment on a component inside an open drawer.
      if (event.target instanceof Element && event.target.closest('[data-dsx-review]') !== null) return
      closeRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    closeRef.current?.focus()
    return () => {
      active = false
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      if (previous?.isConnected === true) previous.focus()
    }
  }, [open])
  if (!open) return null
  return (
    <>
      <div
        data-dsx-backdrop={id}
        onClick={() => {
          env.closeOverlay(id)
          act()
        }}
        style={backdropStyle()}
      />
      <div
        {...nodeAttributes(node)}
        ref={dialogRef}
        tabIndex={-1}
        role={role}
        aria-modal="true"
        aria-labelledby={title === '' ? undefined : titleId}
        aria-label={title === '' ? 'Dialog' : undefined}
        style={{ ...overlayStyle(side), ...(background === undefined ? {} : { background }), ...styles }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding,
            borderBottom: '1px solid ' + BORDER,
          }}
        >
          <strong id={titleId} style={{ fontFamily: FONT, fontSize: 16, color: TEXT }}>
            {title}
          </strong>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={() => {
              env.closeOverlay(id)
              act()
            }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: MUTED, fontSize: 18 }}
          >
            ×
          </button>
        </div>
        <div style={{ padding, fontFamily: FONT, color: TEXT, minWidth: 0 }}>{children}</div>
      </div>
    </>
  )
}

/** Drawer side sheet. */
export function Drawer({ node, children }: DesignComponentProps) {
  const side = useStringProp(node, 'side') === 'left' ? 'left' : 'right'
  const width = useStyleValue(node, 'width')
  return (
    <OverlayShell
      node={node}
      side={side}
      role="dialog"
      styles={{ width: width ?? 'min(var(--dsx-size-drawer, 360px), 88vw)', maxWidth: '100%', overflowY: 'auto' }}
    >
      {children}
    </OverlayShell>
  )
}

/** Centered modal. */
export function Modal({ node, children }: DesignComponentProps) {
  const size = useStringProp(node, 'size')
  const width = size === 'sm' ? 'min(360px, 92vw)' : size === 'lg' ? 'min(720px, 92vw)' : undefined
  return (
    <OverlayShell
      node={node}
      side="center"
      role="dialog"
      styles={{ ...(width === undefined ? {} : { width }), maxWidth: '100%' }}
    >
      {children}
    </OverlayShell>
  )
}

/** Anchored popover. */
export function Popover({ node, children }: DesignComponentProps) {
  const anchor = useStringProp(node, 'anchor')
  if (anchor !== undefined)
    return (
      <AnchoredPopover node={node} anchor={anchor}>
        {children}
      </AnchoredPopover>
    )
  return (
    <OverlayShell node={node} side="center" role="dialog">
      {children}
    </OverlayShell>
  )
}

function AnchoredPopover({ node, anchor, children }: DesignComponentProps & { anchor: string }) {
  const env = useDesign()
  const id = node.id ?? node.address.label
  const open = env.isOverlayOpen(id)
  const closeAction = useAct(node, 'onClose')
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const label = useStringProp(node, 'title')?.trim() || 'Popover'
  const background = useStyleValue(node, 'background')
  const padding = useStyleValue(node, 'padding') ?? PAD_MD
  const close = () => {
    env.closeOverlay(id)
    closeAction()
  }
  const anchorIn = (canvas: HTMLElement) =>
    [...canvas.querySelectorAll<HTMLElement>('[data-dsx-id]')].find((element) => element.dataset.dsxId === anchor) ??
    null
  useAnchoredPanel(open, panel, anchorIn, close, (element) => closeButton.current ?? element)
  if (!open) return null
  return (
    <div
      {...nodeAttributes(node)}
      ref={panel}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={{
        ...anchoredSurface,
        ...(background === undefined ? {} : { background }),
        width: 'max-content',
        padding,
        fontFamily: FONT,
        overflowWrap: 'anywhere',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: GAP_SM }}>
        <strong>{label}</strong>
        <button
          ref={closeButton}
          type="button"
          aria-label="Close"
          onClick={close}
          style={{
            border: 0,
            background: 'transparent',
            color: MUTED,
            fontSize: 18,
            cursor: 'pointer',
            minWidth: 44,
            minHeight: 44,
            flexShrink: 0,
            borderRadius: RADIUS,
          }}
        >
          ×
        </button>
      </div>
      {children}
    </div>
  )
}

/** Menu panel. */
export function Menu({ node, children }: DesignComponentProps) {
  return (
    <OverlayShell node={node} side="center" role="menu">
      {children}
    </OverlayShell>
  )
}

/** Toast message. */
export function Toast({ node, children }: DesignComponentProps) {
  const env = useDesign()
  const id = node.id ?? node.address.label
  const open = env.isOverlayOpen(id)
  const act = useAct(node, 'onClose')
  const tone = useStringProp(node, 'tone') ?? 'info'
  const message = useStringProp(node, 'message')
  const backgrounds = { info: '#0ea5e9', success: '#16a34a', warning: '#d97706', danger: '#dc2626' } as const
  const status = tone === 'success' || tone === 'warning' || tone === 'danger' ? tone : 'info'
  const background = 'var(--dsx-color-' + status + 'Bg, ' + backgrounds[status] + ')'
  const color = 'var(--dsx-color-' + status + 'Text, #ffffff)'
  if (!open) return null
  return (
    <>
      <div
        data-dsx-backdrop={id}
        onClick={() => {
          env.closeOverlay(id)
          act()
        }}
        style={{ ...backdropStyle(), background: 'rgba(15, 23, 42, 0.2)' }}
      />
      <div
        {...nodeAttributes(node)}
        role="status"
        style={{
          ...overlayStyle('bottom'),
          background,
          color,
          padding: PAD_MD,
          display: 'flex',
          gap: GAP_SM,
          alignItems: 'center',
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 14 }}>{message ?? children}</span>
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            env.closeOverlay(id)
            act()
          }}
          style={{ border: 'none', background: 'transparent', color, cursor: 'pointer', fontSize: 16 }}
        >
          ×
        </button>
      </div>
    </>
  )
}

/** Tooltip wrapper. */
export function Tooltip({ node, children }: DesignComponentProps) {
  const text = useStringProp(node, 'text') ?? ''
  return (
    <span {...nodeAttributes(node)} title={text} aria-label={text} style={{ display: 'inline-block' }}>
      {children}
    </span>
  )
}

/** Whether a node is a pressable surface. */
export function usePressable(node: DesignElement): { pressable: boolean; act: () => void } {
  const pressable = useInteraction(node, 'onPress') !== undefined
  const act = useAct(node, 'onPress')
  return { pressable, act }
}

/** Unused constant kept for parity with the kit's visual radius. */
export const OVERLAY_RADIUS = RADIUS
void SURFACE
