/** Single reactive source for the preview URL. */
import { useSyncExternalStore } from 'react'

/** One explicit branch selection. */
export interface RouteVariant {
  /** Screen-local group path. */
  readonly group: string
  readonly branch: string
}

/** One side-by-side comparison selection. */
export interface RouteCompare {
  readonly group: string
  readonly left: string
  readonly right: string
}

/** Parsed preview location. */
export interface PreviewRoute {
  readonly session: string
  readonly screen?: string
  readonly breakpoint?: string
  /** Named screen state requested by the state query parameter. */
  readonly state?: string
  readonly theme?: string
  /** Optional authored situation identity, in addition to its render selectors. */
  readonly situation?: string
  readonly deterministic: boolean
  /** Explicit single-branch selection. */
  readonly variant?: RouteVariant
  /** Raw variant query, retained even when malformed. */
  readonly variantRaw?: string
  /** Side-by-side comparison selection. */
  readonly compare?: RouteCompare
  /** Raw comparison query, retained even when malformed. */
  readonly compareRaw?: string
  /** Renderer embedded in a comparison pane. */
  readonly embed: boolean
  /** Pane identity for isolated interaction state. */
  readonly pane?: string
}

/** Options accepted by the URL builder. */
export interface RouteUrlOptions {
  readonly breakpoint?: string
  readonly state?: string
  readonly theme?: string
  /** Optional authored situation identity, in addition to its render selectors. */
  readonly situation?: string
  readonly deterministic?: boolean
  readonly variant?: RouteVariant
  readonly compare?: RouteCompare
  readonly embed?: boolean
  readonly pane?: string
}

/** Stable key for one location. */
function locationKey(): string {
  return (globalThis.location?.pathname ?? '') + (globalThis.location?.search ?? '')
}

/** Parse one group:branch value; group paths may contain slashes. */
export function parseVariantParam(value: string | null): RouteVariant | undefined {
  if (value === null || value === '') return undefined
  const index = value.lastIndexOf(':')
  if (index <= 0 || index === value.length - 1) return undefined
  return { group: value.slice(0, index), branch: value.slice(index + 1) }
}

/** Parse one group:left:right value. */
export function parseCompareParam(value: string | null): RouteCompare | undefined {
  if (value === null || value === '') return undefined
  const rightAt = value.lastIndexOf(':')
  if (rightAt <= 0) return undefined
  const leftAt = value.lastIndexOf(':', rightAt - 1)
  if (leftAt <= 0) return undefined
  const group = value.slice(0, leftAt)
  const left = value.slice(leftAt + 1, rightAt)
  const right = value.slice(rightAt + 1)
  if (group === '' || left === '' || right === '') return undefined
  return { group, left, right }
}

/** Parse a preview pathname and query string. */
export function parseRoute(pathname: string, search: string): PreviewRoute {
  const parts = pathname.split('/').filter((part) => part.length > 0)
  const session = parts[1] === undefined ? '' : decodeURIComponent(parts[1])
  const screen =
    parts.length > 2 && parts.slice(2).join('/') !== '_' ? decodeURIComponent(parts.slice(2).join('/')) : undefined
  const params = new URLSearchParams(search)
  const compareRaw = params.get('compare') ?? undefined
  const variantRaw = params.get('variant') ?? undefined
  const compare = parseCompareParam(compareRaw ?? null)
  const variant = parseVariantParam(variantRaw ?? null)
  const pane = params.get('pane') ?? undefined
  return {
    session,
    ...(screen === undefined || screen === '' ? {} : { screen }),
    breakpoint: params.get('bp') ?? undefined,
    state: params.get('state') ?? undefined,
    theme: params.get('theme') ?? undefined,
    situation: params.get('situation') ?? undefined,
    deterministic: params.get('deterministic') === '1',
    ...(variant === undefined ? {} : { variant }),
    ...(variantRaw === undefined || variantRaw === '' ? {} : { variantRaw }),
    ...(compare === undefined ? {} : { compare }),
    ...(compareRaw === undefined || compareRaw === '' ? {} : { compareRaw }),
    embed: params.get('embed') === '1',
    ...(pane === undefined || pane === '' ? {} : { pane }),
  }
}

let cachedKey = ''
let cachedRoute: PreviewRoute = parseRoute('', '')
const listeners = new Set<() => void>()
let listening = false

/** Read the current route, reparsing only when the address changed. */
export function getRoute(): PreviewRoute {
  const key = locationKey()
  if (key !== cachedKey) {
    cachedKey = key
    cachedRoute = parseRoute(globalThis.location.pathname, globalThis.location.search)
  }
  return cachedRoute
}

function emit(): void {
  cachedKey = ''
  for (const listener of [...listeners]) listener()
}

function ensurePopstate(): void {
  if (listening) return
  listening = true
  globalThis.addEventListener('popstate', emit)
}

/** Subscribe to route changes. */
export function subscribeRoute(listener: () => void): () => void {
  ensurePopstate()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Build a canonical preview URL. */
export function buildRouteUrl(screen: string | undefined, options: RouteUrlOptions = {}): string {
  const route = getRoute()
  const params = new URLSearchParams()
  if (options.breakpoint !== undefined && options.breakpoint !== '') params.set('bp', options.breakpoint)
  if (options.state !== undefined && options.state !== '') params.set('state', options.state)
  if (options.theme !== undefined) params.set('theme', options.theme)
  if (options.situation !== undefined && options.situation !== '') params.set('situation', options.situation)
  if (options.variant !== undefined) {
    params.set('variant', options.variant.group + ':' + options.variant.branch)
  }
  if (options.compare !== undefined) {
    params.set('compare', options.compare.group + ':' + options.compare.left + ':' + options.compare.right)
  }
  if (options.embed === true) params.set('embed', '1')
  if (options.pane !== undefined && options.pane !== '') params.set('pane', options.pane)
  if (options.deterministic === true) params.set('deterministic', '1')
  const suffix = params.size === 0 ? '' : '?' + params.toString()
  return (
    '/design/' +
    encodeURIComponent(route.session) +
    '/' +
    (screen === undefined || screen === '' ? '' : encodeURIComponent(screen)) +
    suffix
  )
}

/**
 * Build a URL for one route, preserving the current options unless replaced.
 * Used by the comparison parent and the variant chrome.
 */
export function routeWith(screen: string | undefined, overrides: RouteUrlOptions): string {
  const route = getRoute()
  return buildRouteUrl(screen ?? route.screen, {
    breakpoint: overrides.breakpoint ?? route.breakpoint,
    state: overrides.state ?? route.state,
    theme: overrides.theme ?? route.theme,
    situation: overrides.situation ?? route.situation,
    deterministic: overrides.deterministic ?? route.deterministic,
    ...(overrides.variant === undefined
      ? route.variant === undefined
        ? {}
        : { variant: route.variant }
      : { variant: overrides.variant }),
    ...(overrides.compare === undefined
      ? route.compare === undefined
        ? {}
        : { compare: route.compare }
      : { compare: overrides.compare }),
    embed: overrides.embed ?? route.embed,
    ...(overrides.pane === undefined
      ? route.pane === undefined
        ? {}
        : { pane: route.pane }
      : { pane: overrides.pane }),
  })
}

/** Push a URL and notify subscribers. */
export function pushRoute(url: string): void {
  if (url !== globalThis.location.pathname + globalThis.location.search) history.pushState(null, '', url)
  emit()
}

/** Build the canonical preview URL. */
export function routeUrl(screen: string, breakpoint?: string, deterministic = false, state?: string): string {
  return buildRouteUrl(screen, {
    ...(breakpoint === undefined || breakpoint === '' ? {} : { breakpoint }),
    ...(state === undefined || state === '' ? {} : { state }),
    deterministic,
    theme: getRoute().theme,
  })
}

/**
 * Navigate to a screen, keeping the current breakpoint unless replaced.
 * Entering another screen without an explicit state clears the state. A
 * comparison pane keeps its embed identity but drops a screen-scoped variant
 * or comparison selection when the screen changes.
 */
export function navigateRoute(screen: string, breakpoint?: string, state?: string): void {
  const route = getRoute()
  const sameScreen = route.screen === screen
  pushRoute(
    buildRouteUrl(screen, {
      breakpoint: breakpoint ?? route.breakpoint,
      theme: route.theme,
      ...(state === undefined ? {} : { state }),
      deterministic: route.deterministic,
      ...(sameScreen && route.variant !== undefined ? { variant: route.variant } : {}),
      ...(sameScreen && route.compare !== undefined ? { compare: route.compare } : {}),
      ...(route.embed ? { embed: true } : {}),
      ...(route.pane === undefined ? {} : { pane: route.pane }),
    }),
  )
}

/** Select a palette without changing other route coordinates. */
export function selectTheme(theme: string): void {
  const url = new URL(location.href)
  url.searchParams.set('theme', theme)
  pushRoute(url.pathname + url.search)
}

/** Select one configured breakpoint, preserving variant and comparison state. */
export function selectBreakpoint(breakpoint: string): void {
  const route = getRoute()
  pushRoute(routeWith(route.screen, { breakpoint }))
}

/** Select one explicit branch in a single preview. */
export function selectVariant(variant: RouteVariant): void {
  const route = getRoute()
  pushRoute(routeWith(route.screen, { variant }))
}

/** Select the group and both branches of a comparison. */
export function selectCompare(compare: RouteCompare, breakpoint?: string, state?: string): void {
  const route = getRoute()
  pushRoute(
    routeWith(route.screen, {
      compare,
      ...(breakpoint === undefined ? {} : { breakpoint }),
      ...(state === undefined ? {} : { state }),
    }),
  )
}

/** Replace every comparison control at once. */
export function setCompareRoute(
  screen: string,
  compare: RouteCompare,
  options: { breakpoint?: string; state?: string } = {},
): void {
  pushRoute(
    buildRouteUrl(screen, {
      breakpoint: options.breakpoint,
      theme: getRoute().theme,
      ...(options.state === undefined || options.state === '' ? {} : { state: options.state }),
      compare,
      deterministic: getRoute().deterministic,
    }),
  )
}

/** React binding for the route store. */
export function useRoute(): PreviewRoute {
  return useSyncExternalStore(subscribeRoute, getRoute, getRoute)
}
