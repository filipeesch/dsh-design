/** Shared primitives, text styles, and icon paths. */
import type { CSSProperties, ReactNode } from 'react'
import type { DesignElement } from '@filipeesch/dsh-design-core'
import { useDesign } from './context.tsx'
import { useStyleValue } from './styles.ts'

export const FONT = 'var(--dsx-font-family, system-ui, -apple-system, "Segoe UI", sans-serif)'
export const TEXT = 'var(--dsx-color-text, #334155)'
export const MUTED = 'var(--dsx-color-muted, #64748b)'
export const ACTION = 'var(--dsx-color-action, #2563eb)'
export const SURFACE = 'var(--dsx-color-surface, #ffffff)'
export const CANVAS = 'var(--dsx-color-canvas, #f8fafc)'
export const BORDER = 'var(--dsx-color-border, #e2e8f0)'
export const RADIUS = 'var(--dsx-radius-md, 8px)'
export const PAD_MD = 'var(--dsx-spacing-md, 16px)'
export const PAD_SM = 'var(--dsx-spacing-sm, 8px)'
export const GAP_SM = 'var(--dsx-spacing-sm, 8px)'

export interface DesignComponentProps {
  readonly node: DesignElement
  readonly children?: ReactNode
}

/** Base text style, optionally overridden. */
export function textStyle(node: DesignElement, overrides: CSSProperties = {}): CSSProperties {
  const color = useStyleValue(node, 'color')
  return { fontFamily: FONT, color: color ?? TEXT, ...overrides }
}

/** Overlay panel geometry. */
export function overlayStyle(side: 'left' | 'right' | 'center' | 'bottom'): CSSProperties {
  const common: CSSProperties = {
    position: 'absolute',
    zIndex: 50,
    boxSizing: 'border-box',
    background: SURFACE,
    boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
  }
  if (side === 'left')
    return { ...common, top: 0, bottom: 0, left: 0, width: 'min(360px, 88vw)', borderRadius: '0 12px 12px 0' }
  if (side === 'right')
    return { ...common, top: 0, bottom: 0, right: 0, width: 'min(360px, 88vw)', borderRadius: '12px 0 0 12px' }
  if (side === 'bottom')
    return { ...common, left: '50%', bottom: 24, transform: 'translateX(-50%)', borderRadius: 12, minWidth: 280 }
  return {
    ...common,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    borderRadius: 12,
    width: 'min(520px, 92vw)',
  }
}

/** Dimmed backdrop behind an open overlay. */
export function backdropStyle(): CSSProperties {
  return { position: 'absolute', inset: 0, zIndex: 49, background: 'rgba(15, 23, 42, 0.45)' }
}

/** Bundled icon path data. */
export const ICONS: Record<string, string> = {
  check: 'M20 6L9 17l-5-5',
  close: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  info: 'M12 16v-4M12 8h.01M12 22a10 10 0 100-20 10 10 0 000 20z',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z',
}

/** Span wrapper used by text-bearing components. */
export function Line({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
  useDesign()
  return <span style={{ fontFamily: FONT, color: TEXT, ...style }}>{children}</span>
}
