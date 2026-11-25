/** Single reactive source for the preview URL. */
import { useSyncExternalStore } from 'react'

/** Parsed preview location. */
export interface PreviewRoute {
  readonly session: string
  readonly screen?: string
  readonly breakpoint?: string
  /** Named screen state requested by `?state=`. */
  readonly state?: string
  readonly deterministic: boolean
}

/** Stable key for one location. */
function locationKey(): string {
  return (globalThis.location?.pathname ?? '') + (globalThis.location?.search ?? '')
}

/** Parse a preview pathname and query string. */
export function parseRoute(pathname: string, search: string): PreviewRoute {
  const parts = pathname.split('/').filter((part) => part.length > 0)
  const session = parts[1] === undefined ? '' : decodeURIComponent(parts[1])
  const screen =
    parts.length > 2 && parts.slice(2).join('/') !== '_' ? decodeURIComponent(parts.slice(2).join('/')) : undefined
  const params = new URLSearchParams(search)
  return {
    session,
    ...(screen === undefined || screen === '' ? {} : { screen }),
    breakpoint: params.get('bp') ?? undefined,
    state: params.get('state') ?? undefined,
    deterministic: params.get('deterministic') === '1',
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

/** Build the canonical preview URL. */
export function routeUrl(screen: string, breakpoint?: string, deterministic = false, state?: string): string {
  const route = getRoute()
  const params = new URLSearchParams()
  if (breakpoint !== undefined && breakpoint !== '') params.set('bp', breakpoint)
  if (state !== undefined && state !== '') params.set('state', state)
  if (deterministic) params.set('deterministic', '1')
  const suffix = params.size === 0 ? '' : '?' + params.toString()
  return '/design/' + encodeURIComponent(route.session) + '/' + encodeURIComponent(screen) + suffix
}

/**
 * Navigate to a screen, keeping the current breakpoint unless replaced.
 * Entering another screen without an explicit state clears `?state=`.
 */
export function navigateRoute(screen: string, breakpoint?: string, state?: string): void {
  const route = getRoute()
  const next = routeUrl(screen, breakpoint ?? route.breakpoint, route.deterministic, state)
  if (next !== globalThis.location.pathname + globalThis.location.search) history.pushState(null, '', next)
  emit()
}

/** Select one configured breakpoint. */
export function selectBreakpoint(breakpoint: string): void {
  const route = getRoute()
  const screen = route.screen
  if (screen === undefined) {
    const params = new URLSearchParams(globalThis.location.search)
    params.set('bp', breakpoint)
    if (route.deterministic) params.set('deterministic', '1')
    history.pushState(null, '', '/design/' + encodeURIComponent(route.session) + '/' + '?' + params.toString())
  } else {
    history.pushState(null, '', routeUrl(screen, breakpoint, route.deterministic, route.state))
  }
  emit()
}

/** React binding for the route store. */
export function useRoute(): PreviewRoute {
  return useSyncExternalStore(subscribeRoute, getRoute, getRoute)
}
