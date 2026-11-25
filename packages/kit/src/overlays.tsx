/** Overlay components opened by interaction references. */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import type { DesignElement } from '@filipeesch/dsh-design-core'
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
import { nodeAttributes, useStringProp } from './styles.ts'

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
  const title = useStringProp(node, 'title') ?? useStringProp(node, 'message') ?? ''
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (dialog === null) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    let active = true
    const isTop = (): boolean => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      return dialogs.at(-1) === dialog
    }
    const focusable = (): HTMLElement[] =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !active || !isTop()) return
      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0] as HTMLElement
      const last = items.at(-1) as HTMLElement
      const current = document.activeElement
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
      if (event.target instanceof Node && !dialog.contains(event.target)) closeRef.current?.focus()
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
  const titleId = 'dsx-dialog-title-' + id
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
        style={{ ...overlayStyle(side), ...styles }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: PAD_MD,
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
        <div style={{ padding: PAD_MD, fontFamily: FONT, color: TEXT }}>{children}</div>
      </div>
    </>
  )
}

/** Drawer side sheet. */
export function Drawer({ node, children }: DesignComponentProps) {
  const side = useStringProp(node, 'side') === 'left' ? 'left' : 'right'
  return (
    <OverlayShell node={node} side={side} role="dialog">
      {children}
    </OverlayShell>
  )
}

/** Centered modal. */
export function Modal({ node, children }: DesignComponentProps) {
  return (
    <OverlayShell node={node} side="center" role="dialog">
      {children}
    </OverlayShell>
  )
}

/** Anchored popover. */
export function Popover({ node, children }: DesignComponentProps) {
  return (
    <OverlayShell node={node} side="center" role="dialog">
      {children}
    </OverlayShell>
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
  const backgrounds: Record<string, string> = {
    info: '#0ea5e9',
    success: '#16a34a',
    warning: '#d97706',
    danger: '#dc2626',
  }
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
          background: backgrounds[tone] ?? backgrounds.info,
          color: '#ffffff',
          padding: PAD_MD,
          display: 'flex',
          gap: GAP_SM,
          alignItems: 'center',
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 14 }}>{useStringProp(node, 'message') ?? children}</span>
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            env.closeOverlay(id)
            act()
          }}
          style={{ border: 'none', background: 'transparent', color: '#ffffff', cursor: 'pointer', fontSize: 16 }}
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
