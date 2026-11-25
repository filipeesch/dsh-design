/** Layout, content, and typography components. */
import type { CSSProperties } from 'react'
import {
  nodeAttributes,
  useBooleanProp,
  useImageSource,
  useNumberProp,
  useStringProp,
  useStyleValue,
  useSurfaceStyle,
} from './styles.ts'
import {
  BORDER,
  CANVAS,
  FONT,
  ICONS,
  MUTED,
  RADIUS,
  SURFACE,
  TEXT,
  textStyle,
  type DesignComponentProps,
} from './primitives.tsx'

/** Screen root. */
export function Screen({ node, children }: DesignComponentProps) {
  const background = useStyleValue(node, 'background')
  const maxWidth = useStyleValue(node, 'maxWidth')
  const style: CSSProperties = {
    fontFamily: FONT,
    color: TEXT,
    background: background ?? CANVAS,
    minHeight: '100%',
    width: '100%',
    boxSizing: 'border-box',
  }
  return (
    <main {...nodeAttributes(node)} role="main" style={style} data-dsx-screen={node.id}>
      <div style={{ maxWidth: maxWidth ?? '100%', margin: '0 auto', width: '100%' }}>{children}</div>
    </main>
  )
}

/** Flow layout. */
export function Stack({ node, children }: DesignComponentProps) {
  const direction = useStringProp(node, 'direction') ?? 'column'
  const align = useStringProp(node, 'align') ?? 'stretch'
  const justify = useStringProp(node, 'justify') ?? 'start'
  const wrap = useBooleanProp(node, 'wrap') ?? false
  const gap = useStyleValue(node, 'gap')
  const alignMap: Record<string, CSSProperties['alignItems']> = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
    stretch: 'stretch',
  }
  const justifyMap: Record<string, CSSProperties['justifyContent']> = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
    between: 'space-between',
    around: 'space-around',
  }
  const style: CSSProperties = {
    display: 'flex',
    flexDirection: direction === 'row' ? 'row' : 'column',
    alignItems: alignMap[align] ?? 'stretch',
    justifyContent: justifyMap[justify] ?? 'flex-start',
    flexWrap: wrap ? 'wrap' : 'nowrap',
    ...(gap === undefined ? {} : { gap }),
    boxSizing: 'border-box',
    ...useSurfaceStyle(node),
  }
  return (
    <div {...nodeAttributes(node)} style={style}>
      {children}
    </div>
  )
}

/** Column grid. */
export function Grid({ node, children }: DesignComponentProps) {
  const columns = useNumberProp(node, 'columns') ?? 2
  const gap = useStyleValue(node, 'gap')
  const style: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(' + String(Math.max(1, Math.floor(columns))) + ', minmax(0, 1fr))',
    ...(gap === undefined ? {} : { gap }),
    boxSizing: 'border-box',
    ...useSurfaceStyle(node),
  }
  return (
    <div {...nodeAttributes(node)} style={style}>
      {children}
    </div>
  )
}

/** Generic container. */
export function Box({ node, children }: DesignComponentProps) {
  return (
    <div {...nodeAttributes(node)} style={{ boxSizing: 'border-box', ...useSurfaceStyle(node) }}>
      {children}
    </div>
  )
}

/** Empty space. */
export function Spacer({ node }: DesignComponentProps) {
  const size = useStyleValue(node, 'size') ?? 'var(--dsx-spacing-md, 16px)'
  return <div {...nodeAttributes(node)} aria-hidden="true" style={{ flex: '0 0 auto', width: size, height: size }} />
}

/** Separator. */
export function Divider({ node }: DesignComponentProps) {
  const vertical = useStringProp(node, 'orientation') === 'vertical'
  const margin = useStyleValue(node, 'margin')
  return (
    <div
      {...nodeAttributes(node)}
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      style={{
        background: BORDER,
        ...(vertical ? { width: 1, alignSelf: 'stretch', minHeight: 16 } : { height: 1, width: '100%' }),
        ...(margin === undefined ? {} : { margin }),
      }}
    />
  )
}

/** Page header. */
export function Header({ node, children }: DesignComponentProps) {
  const title = useStringProp(node, 'title') ?? ''
  const subtitle = useStringProp(node, 'subtitle')
  return (
    <header
      {...nodeAttributes(node)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--dsx-spacing-md, 16px)',
        padding: 'var(--dsx-spacing-md, 16px)',
        background: useStyleValue(node, 'background') ?? SURFACE,
        borderBottom: '1px solid ' + BORDER,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...textStyle(node), fontSize: 'var(--dsx-font-size-lg, 20px)', fontWeight: 600 }}>{title}</span>
        {subtitle === undefined ? null : (
          <span style={{ ...textStyle(node), color: MUTED, fontSize: 'var(--dsx-font-size-sm, 13px)' }}>
            {subtitle}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--dsx-spacing-sm, 8px)' }}>{children}</div>
    </header>
  )
}

/** Text paragraph. */
export function Text({ node, children }: DesignComponentProps) {
  const variant = useStringProp(node, 'variant') ?? 'body'
  const align = useStringProp(node, 'align')
  const color = useStyleValue(node, 'color')
  const size = useStyleValue(node, 'fontSize')
  const weight = useStyleValue(node, 'fontWeight')
  const family = useStyleValue(node, 'fontFamily')
  const presets: Record<string, { fontSize: string; fontWeight: number }> = {
    title: { fontSize: 'var(--dsx-font-size-xl, 28px)', fontWeight: 700 },
    heading: { fontSize: 'var(--dsx-font-size-lg, 20px)', fontWeight: 600 },
    body: { fontSize: 'var(--dsx-font-size-md, 15px)', fontWeight: 400 },
    caption: { fontSize: 'var(--dsx-font-size-sm, 13px)', fontWeight: 400 },
    label: { fontSize: 'var(--dsx-font-size-sm, 13px)', fontWeight: 600 },
  }
  const preset = presets[variant] ?? presets.body!
  const style: CSSProperties = {
    margin: 0,
    fontFamily: family ?? FONT,
    color: color ?? TEXT,
    fontSize: size ?? preset.fontSize,
    fontWeight: weight ?? String(preset.fontWeight),
    ...(align === undefined ? {} : { textAlign: align as CSSProperties['textAlign'] }),
    whiteSpace: 'pre-wrap',
  }
  return (
    <p {...nodeAttributes(node)} style={style}>
      {children}
    </p>
  )
}

/** Bundled inline icon. */
export function Icon({ node }: DesignComponentProps) {
  const name = useStringProp(node, 'name') ?? 'info'
  const size = useStyleValue(node, 'size') ?? '20px'
  const color = useStyleValue(node, 'color') ?? 'currentColor'
  return (
    <svg
      {...nodeAttributes(node)}
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: '0 0 auto', display: 'inline-block', verticalAlign: 'middle' }}
    >
      <path d={ICONS[name] ?? ICONS.info} />
    </svg>
  )
}

/** Local image or placeholder. */
export function Image({ node }: DesignComponentProps) {
  const { url, placeholder } = useImageSource(node)
  const alt = useStringProp(node, 'alt') ?? ''
  const width = useStyleValue(node, 'width')
  const height = useStyleValue(node, 'height')
  const radius = useStyleValue(node, 'radius') ?? RADIUS
  const fit = useStringProp(node, 'fit') ?? 'cover'
  if (url === undefined) {
    return (
      <div
        {...nodeAttributes(node)}
        role="img"
        aria-label={alt || placeholder}
        style={{
          width: width ?? '100%',
          height: height ?? 120,
          borderRadius: radius,
          background: CANVAS,
          border: '1px dashed ' + BORDER,
          color: MUTED,
          fontFamily: FONT,
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: 8,
          boxSizing: 'border-box',
        }}
      >
        {(placeholder ?? alt) || 'Image'}
      </div>
    )
  }
  return (
    <img
      {...nodeAttributes(node)}
      src={url}
      alt={alt}
      style={{
        width: width ?? '100%',
        height: height ?? 'auto',
        borderRadius: radius,
        objectFit: fit as CSSProperties['objectFit'],
        display: 'block',
      }}
    />
  )
}
