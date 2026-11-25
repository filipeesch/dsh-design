/** Preview interaction state keyed by screen and node id. */
import type { ProjectPayload } from './wire.ts'
import { collectIds } from './wire.ts'

/** Persisted preview interaction state. */
export interface PreviewState {
  openOverlays: Record<string, true>
  tabs: Record<string, string>
  values: Record<string, unknown>
}

const KEY_PREFIX = 'dsh-design:state:'

/** Empty initial state. */
export function emptyState(): PreviewState {
  return { openOverlays: {}, tabs: {}, values: {} }
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
  for (const screen of project.screens) collectIds(screen.lastValidRoot ?? screen.root, ids, radios)
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
  }
}
