/** Preview interaction state keyed by screen and node id. */
import type { DesignChild, DesignScreenNode, NamedState } from '@filipeesch/dsh-design-core'
import type { ProjectPayload } from './wire.ts'
import { collectIds } from './wire.ts'

/** Persisted preview interaction state. */
export interface PreviewState {
  openOverlays: Record<string, true>
  tabs: Record<string, string>
  values: Record<string, unknown>
  disclosures: Record<string, boolean>
}

const KEY_PREFIX = 'dsh-design:state:'

/** Empty initial state. */
export function emptyState(): PreviewState {
  return { openOverlays: {}, tabs: {}, values: {}, disclosures: {} }
}

/** Load state for a session from session storage. */
export function loadState(session: string, fallback: PreviewState = emptyState()): PreviewState {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + session)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as Partial<PreviewState>
    return {
      openOverlays:
        parsed.openOverlays !== null && typeof parsed.openOverlays === 'object'
          ? (parsed.openOverlays as Record<string, true>)
          : {},
      tabs: parsed.tabs !== null && typeof parsed.tabs === 'object' ? (parsed.tabs as Record<string, string>) : {},
      disclosures:
        parsed.disclosures !== null && typeof parsed.disclosures === 'object' && !Array.isArray(parsed.disclosures)
          ? Object.fromEntries(Object.entries(parsed.disclosures).filter(([, value]) => typeof value === 'boolean'))
          : {},
      values:
        parsed.values !== null && typeof parsed.values === 'object' ? (parsed.values as Record<string, unknown>) : {},
    }
  } catch {
    return fallback
  }
}

/** Persist state for a session. */
export function saveState(session: string, state: PreviewState): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + session, JSON.stringify(state))
  } catch {
    // Storage can be unavailable; the preview still works for this page.
  }
}

/** Keep only state whose nodes still exist in the current project. */
export function filterState(state: PreviewState, project: ProjectPayload): PreviewState {
  const ids = new Set<string>()
  const radios = new Set<string>()
  const disclosures = new Set<string>()
  const collectDisclosures = (node: DesignChild | DesignScreenNode | undefined, prefix: string): void => {
    if (node === undefined || node.kind === 'text') return
    if (node.type === 'Disclosure' && node.id !== undefined) disclosures.add(prefix + node.id)
    for (const child of node.children) collectDisclosures(child, prefix)
  }
  for (const screen of project.screens) {
    const root = screen.lastValidRoot ?? screen.root
    collectIds(root, ids, radios)
    collectDisclosures(root, screen.id + '/')
  }
  const keep = (key: string): boolean => {
    const slash = key.indexOf('/')
    if (slash === -1) return false
    const nodePart = key.slice(slash + 1)
    if (nodePart.startsWith('radio:')) return radios.has(nodePart.slice('radio:'.length))
    return ids.has(nodePart)
  }
  const pick = <T>(record: Record<string, T>): Record<string, T> => {
    const next: Record<string, T> = {}
    for (const [key, value] of Object.entries(record)) if (keep(key)) next[key] = value
    return next
  }
  return {
    openOverlays: pick(state.openOverlays),
    tabs: pick(state.tabs),
    values: pick(state.values),
    disclosures: Object.fromEntries(Object.entries(state.disclosures).filter(([key]) => disclosures.has(key))),
  }
}
/**
 * Apply one named state to a screen scope, replacing that screen's interaction
 * state with the declared starting point. Other screens are left untouched.
 */
export function seedState(state: PreviewState, screen: string, named: NamedState): PreviewState {
  const prefix = screen + '/'
  const next = clearScreenState(state, screen)
  for (const id of named.open) next.openOverlays[prefix + id] = true
  for (const [id, value] of Object.entries(named.tabs)) next.tabs[prefix + id] = value
  for (const [id, value] of Object.entries(named.values)) next.values[prefix + id] = value
  for (const [id, value] of Object.entries(named.disclosures ?? {})) next.disclosures[prefix + id] = value
  return next
}
/** Clear only one screen's interaction state, preserving other screens. */
export function clearScreenState(state: PreviewState, screen: string): PreviewState {
  const prefix = screen + '/'
  const strip = <T>(record: Record<string, T>): Record<string, T> => {
    const next: Record<string, T> = {}
    for (const [key, value] of Object.entries(record)) if (!key.startsWith(prefix)) next[key] = value
    return next
  }
  return {
    openOverlays: strip(state.openOverlays),
    tabs: strip(state.tabs),
    values: strip(state.values),
    disclosures: strip(state.disclosures),
  }
}
