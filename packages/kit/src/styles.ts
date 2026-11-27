/** Token, responsive, and shared style helpers used by kit components. */
import {
  cssClassForNode,
  resolveResponsive,
  type Breakpoint,
  type DesignElement,
  type DesignPropValue,
  type ResolvedToken,
} from '@filipeesch/dsh-design-core'
import type { CSSProperties } from 'react'
import { useDesign } from './context.tsx'

/** A token value is a path present in the project token table. */
export function isTokenPath(value: unknown, tokens: Readonly<Record<string, ResolvedToken>>): value is string {
  return typeof value === 'string' && tokens[value] !== undefined
}

/** Resolve a token-backed value to a CSS value with the project token as fallback. */
export function tokenValue(
  value: DesignPropValue | undefined,
  tokens: Readonly<Record<string, ResolvedToken>>,
): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') {
    if (isTokenPath(value, tokens)) {
      const token = tokens[value] as ResolvedToken
      return `var(${token.cssVar}, ${String(token.value)})`
    }
    return value
  }
  return undefined
}

export { resolveResponsive }

/** Read a prop with responsive resolution applied. */
export function useProp(node: DesignElement, name: string): DesignPropValue | undefined {
  const env = useDesign()
  const raw = node.props[name]
  return resolveResponsive(raw, env.breakpoints, env.activeBreakpoint)
}

/** Read a string prop with responsive resolution for a provided environment. */
export function stringProp(
  node: DesignElement,
  name: string,
  env: { breakpoints: readonly Breakpoint[]; activeBreakpoint: string },
): string | undefined {
  const value = resolveResponsive(node.props[name], env.breakpoints, env.activeBreakpoint)
  return value === undefined || value === null ? undefined : String(value)
}

/** Read a string prop with responsive resolution. */
export function useStringProp(node: DesignElement, name: string): string | undefined {
  const value = useProp(node, name)
  return value === undefined || value === null ? undefined : String(value)
}

/** Read a number prop with responsive resolution. */
export function useNumberProp(node: DesignElement, name: string): number | undefined {
  const value = useProp(node, name)
  return typeof value === 'number'
    ? value
    : typeof value === 'string' && value !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : undefined
}

/** Read a boolean prop with responsive resolution. */
export function useBooleanProp(node: DesignElement, name: string): boolean | undefined {
  const value = useProp(node, name)
  return typeof value === 'boolean' ? value : undefined
}

/** Resolve a style-prop value through my tokens, with no responsive lookup. */
export function useStyleValue(node: DesignElement, name: string): string | undefined {
  const env = useDesign()
  const value = resolveResponsive(node.props[name], env.breakpoints, env.activeBreakpoint)
  return tokenValue(value, env.tokens)
}

/** Standard surface styles shared by container components. */
export function useSurfaceStyle(node: DesignElement): CSSProperties {
  const padding = useStyleValue(node, 'padding')
  const margin = useStyleValue(node, 'margin')
  const background = useStyleValue(node, 'background')
  const radius = useStyleValue(node, 'radius')
  const shadow = useStyleValue(node, 'shadow')
  const borderColor = useStyleValue(node, 'borderColor')
  const width = useStyleValue(node, 'width')
  const height = useStyleValue(node, 'height')
  return {
    ...(padding === undefined ? {} : { padding }),
    ...(margin === undefined ? {} : { margin }),
    ...(background === undefined ? {} : { background }),
    ...(radius === undefined ? {} : { borderRadius: radius }),
    ...(shadow === undefined ? {} : { boxShadow: shadow }),
    ...(borderColor === undefined ? {} : { border: `1px solid ${borderColor}` }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  }
}

/** Accessibility and traceability attributes carried by every node wrapper. */
export function nodeAttributes(node: DesignElement): Record<string, string> {
  return {
    ...(node.classCss !== undefined || (typeof node.props.css === 'string' && node.props.css !== '')
      ? { className: cssClassForNode(node) }
      : {}),
    'data-dsx-type': node.type,
    ...(node.id === undefined || node.id === ''
      ? { 'data-dsx-address': node.address.label }
      : { 'data-dsx-id': node.id }),
  }
}

/** Transition style, disabled in deterministic mode. */
export function useTransition(node: DesignElement): CSSProperties {
  const env = useDesign()
  if (env.deterministic) return { transition: 'none', animation: 'none' }
  void node
  return { transition: 'opacity 120ms ease, transform 120ms ease' }
}

/** Resolve a design-folder path or placeholder into an image URL. */
export function useImageSource(node: DesignElement, prop = 'src'): { url?: string; placeholder?: string } {
  const env = useDesign()
  const source = useStringProp(node, prop)
  if (source === undefined) return {}
  if (source.startsWith('placeholder:')) return { placeholder: source.slice('placeholder:'.length).trim() || 'Image' }
  const normalized = source.replace(/^\.\//, '')
  if (normalized.split('/').includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(normalized) || normalized.startsWith('/'))
    return { placeholder: 'Image' }
  return { url: env.imageUrl(normalized) }
}
