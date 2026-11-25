/** Cards, lists, data display, and feedback components. */
import type { CSSProperties } from 'react'
import type { DesignPropValue } from '@filipeesch/dsh-design-core'
import { useDesign } from './context.tsx'
import { useAct, useInteraction } from './interactions.ts'
import {
  BORDER,
  CANVAS,
  FONT,
  MUTED,
  PAD_MD,
  PAD_SM,
  RADIUS,
  SURFACE,
  TEXT,
  type DesignComponentProps,
} from './primitives.tsx'
import {
  nodeAttributes,
  useBooleanProp,
  useImageSource,
  useNumberProp,
  useStringProp,
  useStyleValue,
  useSurfaceStyle,
  useTransition,
} from './styles.ts'

/** Card surface. */
export function Card({ node, children }: DesignComponentProps) {
  const variant = useStringProp(node, 'variant') ?? 'elevated'
  const act = useAct(node, 'onPress')
  const pressable = useInteraction(node, 'onPress') !== undefined
  const transition = useTransition(node)
  const style: CSSProperties = {
    boxSizing: 'border-box',
    background: SURFACE,
    borderRadius: RADIUS,
    padding: PAD_MD,
    ...(variant === 'elevated'
      ? { boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)', border: '1px solid transparent' }
      : {}),
    ...(variant === 'outlined' ? { border: '1px solid ' + BORDER } : {}),
    ...(variant === 'flat' ? { border: '1px solid transparent' } : {}),
    ...useSurfaceStyle(node),
    ...(pressable ? { cursor: 'pointer' } : {}),
    ...transition,
  }
  return (
    <div
      {...nodeAttributes(node)}
      role={pressable ? 'button' : undefined}
      tabIndex={pressable ? 0 : undefined}
      onClick={pressable ? act : undefined}
      onKeyDown={
        pressable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') act()
            }
          : undefined
      }
      style={style}
    >
      {children}
    </div>
  )
}

/** List container. */
export function List({ node, children }: DesignComponentProps) {
  const gap = useStyleValue(node, 'gap')
  return (
    <div
      {...nodeAttributes(node)}
      role="list"
      style={{
        display: 'flex',
        flexDirection: 'column',
        ...(gap === undefined ? {} : { gap }),
        ...useSurfaceStyle(node),
      }}
    >
      {children}
    </div>
  )
}

/** List row. */
export function ListItem({ node, children }: DesignComponentProps) {
  const pressable = useInteraction(node, 'onPress') !== undefined
  const act = useAct(node, 'onPress')
  return (
    <div
      {...nodeAttributes(node)}
      role="listitem"
      tabIndex={pressable ? 0 : undefined}
      onClick={pressable ? act : undefined}
      style={{
        padding: '10px 12px',
        borderRadius: RADIUS,
        background: SURFACE,
        border: '1px solid ' + BORDER,
        ...useSurfaceStyle(node),
        ...(pressable ? { cursor: 'pointer' } : {}),
      }}
    >
      {children}
    </div>
  )
}

/** Avatar. */
export function Avatar({ node }: DesignComponentProps) {
  const { url, placeholder } = useImageSource(node)
  const initials = useStringProp(node, 'initials')
  const size = useStyleValue(node, 'size') ?? '40px'
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    background: CANVAS,
    border: '1px solid ' + BORDER,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: 600,
    color: TEXT,
    flex: '0 0 auto',
  }
  if (url !== undefined)
    return (
      <img {...nodeAttributes(node)} src={url} alt={initials ?? 'Avatar'} style={{ ...style, objectFit: 'cover' }} />
    )
  return (
    <span {...nodeAttributes(node)} role="img" aria-label={initials ?? placeholder ?? 'Avatar'} style={style}>
      {initials ?? (placeholder === undefined ? '?' : '')}
    </span>
  )
}

/** Badge. */
export function Badge({ node, children }: DesignComponentProps) {
  const tone = useStringProp(node, 'tone') ?? 'neutral'
  const palettes: Record<string, { background: string; color: string }> = {
    neutral: { background: '#f1f5f9', color: '#334155' },
    success: { background: '#dcfce7', color: '#166534' },
    warning: { background: '#fef3c7', color: '#92400e' },
    danger: { background: '#fee2e2', color: '#991b1b' },
    info: { background: '#e0f2fe', color: '#075985' },
  }
  const palette = palettes[tone] ?? palettes.neutral!
  return (
    <span
      {...nodeAttributes(node)}
      style={{
        ...palette,
        borderRadius: 999,
        padding: '2px 8px',
        fontFamily: FONT,
        fontSize: 12,
        fontWeight: 600,
        display: 'inline-block',
      }}
    >
      {children}
    </span>
  )
}

/** Data table. */
export function Table({ node }: DesignComponentProps) {
  const columns = Array.isArray(node.props.columns) ? node.props.columns.map(String) : []
  const rows = Array.isArray(node.props.rows)
    ? (node.props.rows.filter((row) => Array.isArray(row)) as DesignPropValue[][])
    : []
  const striped = useBooleanProp(node, 'striped') ?? false
  return (
    <div {...nodeAttributes(node)} style={{ overflowX: 'auto', ...useSurfaceStyle(node) }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: FONT, fontSize: 14, color: TEXT }}>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={String(index) + '-' + column}
                scope="col"
                style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid ' + BORDER, fontWeight: 600 }}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={striped && rowIndex % 2 === 1 ? { background: CANVAS } : undefined}>
              {columns.map((_, columnIndex) => (
                <td key={columnIndex} style={{ padding: '8px 12px', borderBottom: '1px solid ' + BORDER }}>
                  {String(row[columnIndex] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Breadcrumb trail. */
export function Breadcrumbs({ node }: DesignComponentProps) {
  const items = Array.isArray(node.props.items) ? node.props.items.map(String) : []
  return (
    <nav {...nodeAttributes(node)} aria-label="Breadcrumbs" style={{ fontFamily: FONT, fontSize: 13, color: MUTED }}>
      <ol style={{ display: 'flex', flexWrap: 'wrap', gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((item, index) => (
          <li key={String(index) + '-' + item} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span
              aria-current={index === items.length - 1 ? 'page' : undefined}
              style={index === items.length - 1 ? { color: TEXT, fontWeight: 600 } : undefined}
            >
              {item}
            </span>
            {index === items.length - 1 ? null : <span aria-hidden="true">/</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** Pagination control. */
export function Pagination({ node }: DesignComponentProps) {
  const env = useDesign()
  const id = node.id ?? node.address.label
  const total = Math.max(1, useNumberProp(node, 'total') ?? 1)
  const page = Math.min(total, Math.max(1, Number(env.getValue(id, useNumberProp(node, 'page') ?? 1)) || 1))
  const act = useAct(node, 'onChange')
  const set = (next: number): void => {
    env.setValue(id, Math.min(total, Math.max(1, next)))
    act()
  }
  const buttonStyle: CSSProperties = {
    border: '1px solid ' + BORDER,
    background: SURFACE,
    borderRadius: 6,
    padding: '4px 10px',
    fontFamily: FONT,
    cursor: 'pointer',
  }
  return (
    <nav
      {...nodeAttributes(node)}
      role="navigation"
      aria-label="Pagination"
      style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT, fontSize: 13, color: TEXT }}
    >
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => set(page - 1)}
        style={{ ...buttonStyle, opacity: page <= 1 ? 0.5 : 1 }}
      >
        Previous
      </button>
      <span aria-live="polite">
        Page {page} of {total}
      </span>
      <button
        type="button"
        disabled={page >= total}
        onClick={() => set(page + 1)}
        style={{ ...buttonStyle, opacity: page >= total ? 0.5 : 1 }}
      >
        Next
      </button>
    </nav>
  )
}

/** Progress bar. */
export function Progress({ node }: DesignComponentProps) {
  const value = useNumberProp(node, 'value')
  const max = Math.max(1, useNumberProp(node, 'max') ?? 100)
  const label = useStringProp(node, 'label')
  const determinate = value !== undefined
  const percent = determinate ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      {...nodeAttributes(node)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={determinate ? value : undefined}
      aria-label={label}
      style={{ fontFamily: FONT }}
    >
      {label === undefined ? null : <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>{label}</div>}
      <div
        style={{ height: 8, borderRadius: 999, background: CANVAS, border: '1px solid ' + BORDER, overflow: 'hidden' }}
      >
        <div
          style={{
            height: '100%',
            width: determinate ? String(percent) + '%' : '40%',
            background: 'var(--dsx-color-action, #2563eb)',
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  )
}

/** Loading placeholder. */
export function Skeleton({ node }: DesignComponentProps) {
  const variant = useStringProp(node, 'variant') ?? 'text'
  const width = useStyleValue(node, 'width') ?? '100%'
  const height = useStyleValue(node, 'height') ?? (variant === 'text' ? '14px' : '48px')
  const radius = useStyleValue(node, 'radius') ?? (variant === 'circle' ? '50%' : '6px')
  const background = useStyleValue(node, 'background') ?? CANVAS
  return (
    <div
      {...nodeAttributes(node)}
      aria-hidden="true"
      data-dsx-skeleton={variant}
      style={{ width, height, borderRadius: radius, background, border: '1px solid ' + BORDER }}
    />
  )
}

/** Empty result state. */
export function EmptyState({ node, children }: DesignComponentProps) {
  const title = useStringProp(node, 'title') ?? ''
  const message = useStringProp(node, 'message')
  return (
    <div
      {...nodeAttributes(node)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: PAD_MD,
        textAlign: 'center',
        ...useSurfaceStyle(node),
      }}
    >
      <strong style={{ fontFamily: FONT, fontSize: 16, color: TEXT }}>{title}</strong>
      {message === undefined ? null : <span style={{ fontFamily: FONT, fontSize: 13, color: MUTED }}>{message}</span>}
      {children}
    </div>
  )
}

void PAD_SM
