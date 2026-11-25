/** Preview application: chrome, frame, live reload, and interaction state. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  collectCssRules,
  countDiagnostics,
  type Breakpoint,
  type DesignChild,
  type DesignElement,
  type DesignScreenNode,
  type Diagnostic,
} from '@filipeesch/dsh-design-core'
import { DesignEnvironmentContext, type DesignEnvironment } from '@filipeesch/dsh-design-kit'
import { fetchProject, subscribeRevisions } from './api.ts'
import { renderNode } from './interpreter.tsx'
import { getRoute, navigateRoute, selectBreakpoint, useRoute } from './route.ts'
import { emptyState, filterState, loadState, saveState, type PreviewState } from './state.ts'
import type { ProjectPayload, WireScreen } from './wire.ts'

/** Clock value used in deterministic mode. */
export const FIXED_TIME = 1700000000000

function widest(breakpoints: readonly Breakpoint[]): string | undefined {
  return [...breakpoints].sort((left, right) => right.width - left.width)[0]?.name
}

function findScreen(project: ProjectPayload | undefined, id: string | undefined): WireScreen | undefined {
  if (project === undefined || id === undefined) return undefined
  return project.screens.find((screen) => screen.id === id)
}

/** Root preview application. */
export function App() {
  const route = useRoute()
  const session = route.session
  const bootstrap = route.deterministic
    ? (globalThis as { __DSX_PROJECT__?: ProjectPayload }).__DSX_PROJECT__
    : undefined
  const [project, setProject] = useState<ProjectPayload | undefined>(bootstrap)
  const [loadError, setLoadError] = useState<string | undefined>()
  const [state, setState] = useState<PreviewState>(() => emptyState())
  const [ready, setReady] = useState(bootstrap !== undefined)
  const revision = useRef(bootstrap?.revision ?? -1)
  const lastTrees = useRef(new Map<string, DesignScreenNode>())

  const updateProject = useCallback((next: ProjectPayload) => {
    setProject(next)
    revision.current = next.revision
    for (const screen of next.screens) {
      const errors = countDiagnostics(screen.diagnostics).errors
      if (errors === 0 && screen.root !== undefined) lastTrees.current.set(screen.id, screen.root)
    }
    setState((current) => filterState(current, next))
    setReady(true)
  }, [])

  useEffect(() => {
    if (bootstrap !== undefined) {
      setState(loadState(session))
      for (const screen of bootstrap.screens) {
        const errors = countDiagnostics(screen.diagnostics).errors
        if (errors === 0 && screen.root !== undefined) lastTrees.current.set(screen.id, screen.root)
      }
      setReady(true)
      return
    }
    let cancelled = false
    setReady(false)
    setLoadError(undefined)
    setProject(undefined)
    lastTrees.current.clear()
    fetchProject(session)
      .then((next) => {
        if (cancelled) return
        setState(loadState(session))
        updateProject(next)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [session, updateProject, bootstrap])

  useEffect(() => {
    if (route.deterministic) return
    return subscribeRevisions(session, (event) => {
      if (event.rev > revision.current) {
        fetchProject(session, event.rev)
          .then(updateProject)
          .catch(() => undefined)
      }
    })
  }, [session, route.deterministic, updateProject])

  useEffect(() => {
    if (ready) saveState(session, state)
  }, [session, state, ready])

  const available = project?.screens.filter((screen) => screen.id !== '') ?? []
  let entryId: string | undefined = available[0]?.id
  if (
    project !== undefined &&
    project.config.entry !== undefined &&
    findScreen(project, project.config.entry) !== undefined
  ) {
    entryId = project.config.entry
  }
  const requestedScreen = project === undefined ? undefined : findScreen(project, route.screen)
  const activeScreen = project === undefined ? undefined : (requestedScreen ?? findScreen(project, entryId))
  const screenId = activeScreen?.id
  const missingScreen = project !== undefined && route.screen !== undefined && requestedScreen === undefined

  const breakpoints = project?.config.breakpoints ?? []
  const breakpointName = breakpoints.some((candidate) => candidate.name === route.breakpoint)
    ? (route.breakpoint as string)
    : (widest(breakpoints) ?? 'desktop')
  const breakpoint = breakpoints.find((candidate) => candidate.name === breakpointName)

  const screenErrors = activeScreen === undefined ? 0 : countDiagnostics(activeScreen.diagnostics).errors
  const projectFatal = project?.projectError !== undefined
  const currentRoot = !projectFatal && screenErrors === 0 ? activeScreen?.root : undefined
  const retainedRoot =
    activeScreen === undefined ? undefined : (activeScreen.lastValidRoot ?? lastTrees.current.get(activeScreen.id))
  const tree = projectFatal || missingScreen ? undefined : (currentRoot ?? retainedRoot)

  const imageUrl = useCallback(
    (path: string) => {
      const normalized = path.replace(/^\.\//, '')
      const inline = project?.assets?.[normalized]
      if (inline !== undefined) return inline
      return (
        '/design/' + encodeURIComponent(session) + '/_/files/' + normalized.split('/').map(encodeURIComponent).join('/')
      )
    },
    [session, project?.assets],
  )

  const openOverlays = useMemo(() => {
    const set = new Set<string>()
    for (const [key, value] of Object.entries(state.openOverlays)) {
      if (value !== true || screenId === undefined) continue
      const prefix = screenId + '/'
      if (key.startsWith(prefix)) set.add(key.slice(prefix.length))
    }
    return set
  }, [state.openOverlays, screenId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || screenId === undefined) return
      const last = [...openOverlays].at(-1)
      if (last === undefined) return
      setState((current) => {
        const next = { ...current.openOverlays }
        delete next[screenId + '/' + last]
        return { ...current, openOverlays: next }
      })
    }
    globalThis.addEventListener('keydown', onKey)
    return () => {
      globalThis.removeEventListener('keydown', onKey)
    }
  }, [openOverlays, screenId])

  const cssText = useMemo(
    () => (tree === undefined ? '' : collectCssRules(tree, imageUrl).join('\n')),
    [tree, imageUrl],
  )

  const environment: DesignEnvironment = useMemo(
    () => ({
      tokens: project?.tokens ?? {},
      breakpoints,
      activeBreakpoint: breakpointName,
      deterministic: route.deterministic,
      now: () => (route.deterministic ? FIXED_TIME : Date.now()),
      renderNode,
      renderChildren: (node: DesignChild) =>
        node.kind === 'text' ? node.value : node.children.map((child) => renderNode(child)),
      isOverlayOpen: (id: string) => openOverlays.has(id),
      openOverlay: (id: string) =>
        setState((current) =>
          screenId === undefined
            ? current
            : { ...current, openOverlays: { ...current.openOverlays, [screenId + '/' + id]: true } },
        ),
      closeOverlay: (id: string) =>
        setState((current) => {
          if (screenId === undefined) return current
          const next = { ...current.openOverlays }
          delete next[screenId + '/' + id]
          return { ...current, openOverlays: next }
        }),
      toggleOverlay: (id: string) =>
        setState((current) => {
          if (screenId === undefined) return current
          const key = screenId + '/' + id
          const next = { ...current.openOverlays }
          if (next[key] === true) delete next[key]
          else next[key] = true
          return { ...current, openOverlays: next }
        }),
      navigate: (screen: string) => navigateRoute(screen, breakpointName),
      getValue: (id: string, fallback: unknown) => {
        if (screenId === undefined) return fallback
        const value = state.values[screenId + '/' + id]
        return value === undefined ? fallback : value
      },
      setValue: (id: string, value: unknown) =>
        setState((current) =>
          screenId === undefined
            ? current
            : { ...current, values: { ...current.values, [screenId + '/' + id]: value } },
        ),
      getTab: (id: string, fallback: string) =>
        screenId === undefined ? fallback : (state.tabs[screenId + '/' + id] ?? fallback),
      setTab: (id: string, value: string) =>
        setState((current) =>
          screenId === undefined ? current : { ...current, tabs: { ...current.tabs, [screenId + '/' + id]: value } },
        ),
      imageUrl,
    }),
    [
      project,
      breakpoints,
      breakpointName,
      route.deterministic,
      screenId,
      state.values,
      state.tabs,
      openOverlays,
      imageUrl,
    ],
  )

  const projectErrors =
    project === undefined ? [] : project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  const activeErrors = activeScreen?.diagnostics.filter((diagnostic) => diagnostic.severity === 'error') ?? []
  const overlayErrors: Diagnostic[] = [...(projectFatal ? projectErrors : []), ...activeErrors]

  if (loadError !== undefined) {
    return (
      <div role="alert" style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#991b1b' }}>
        Preview failed to load: {loadError}
      </div>
    )
  }
  if (project === undefined || !ready) {
    return <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>Loading preview…</div>
  }

  const frame = breakpoint === undefined ? undefined : breakpoint
  return (
    <div
      className={'dsx-shell' + (route.deterministic ? ' dsx-deterministic' : '')}
      data-dsx-session={session}
      data-dsx-deterministic={route.deterministic ? '1' : undefined}
      data-dsx-clock={route.deterministic ? String(FIXED_TIME) : undefined}
    >
      <header className="dsx-chrome">
        <div className="dsx-brand">Design preview</div>
        <nav aria-label="Screens" className="dsx-screens">
          {available.map((screen) => (
            <button
              key={screen.id}
              type="button"
              className={screen.id === screenId ? 'active' : ''}
              onClick={() => navigateRoute(screen.id, breakpointName)}
            >
              <span>{screen.id}</span>
              {screen.errors > 0 ? <span className="dsx-badge error">{screen.errors}</span> : null}
              {screen.errors === 0 && screen.warnings > 0 ? (
                <span className="dsx-badge warning">{screen.warnings}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="dsx-breakpoints" role="group" aria-label="Breakpoints">
          {breakpoints.map((candidate) => (
            <button
              key={candidate.name}
              type="button"
              className={candidate.name === breakpointName ? 'active' : ''}
              onClick={() =>
                screenId === undefined ? selectBreakpoint(candidate.name) : navigateRoute(screenId, candidate.name)
              }
            >
              {candidate.name}
              <small>{candidate.width}px</small>
            </button>
          ))}
        </div>
        <div className="dsx-meta">
          <span>kit {project.kitVersion}</span>
          <span>rev {project.revision}</span>
          {route.deterministic ? <span>deterministic</span> : null}
        </div>
      </header>
      <main className="dsx-stage">
        {missingScreen ? (
          <div className="dsx-notice" role="alert">
            Screen "{route.screen}" no longer exists in this project.
          </div>
        ) : null}
        {projectFatal ? (
          <div className="dsx-notice error" role="alert">
            <strong>Project blocked</strong>
            <p>{project.projectError}</p>
          </div>
        ) : null}
        {frame === undefined || tree === undefined ? (
          <div className="dsx-notice error" role="alert">
            <strong>No renderable screen</strong>
            <p>Fix the errors below and save the file. The last valid render is kept while it exists.</p>
            <ul>
              {overlayErrors.slice(0, 10).map((diagnostic, index) => (
                <li key={index}>
                  {diagnostic.file}:{diagnostic.line}:{diagnostic.column} {diagnostic.message}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="dsx-frame-wrap">
            <div
              className="dsx-frame"
              data-breakpoint={frame.name}
              data-screen={screenId ?? ''}
              style={{ width: frame.width, minHeight: 520 }}
            >
              <style>{cssText}</style>
              <div
                className="dsx-frame-inner"
                style={
                  {
                    ...(project.cssVariables as React.CSSProperties),
                    '--dsx-font-family': '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
                  } as React.CSSProperties
                }
              >
                <DesignEnvironmentContext.Provider value={environment}>
                  {renderNode(tree)}
                </DesignEnvironmentContext.Provider>
              </div>
            </div>
          </div>
        )}
        {overlayErrors.length > 0 && tree !== undefined ? (
          <div className="dsx-overlay diagnostics" role="alert">
            <strong>
              {overlayErrors.length} validation error{overlayErrors.length === 1 ? '' : 's'}
            </strong>
            <ul>
              {overlayErrors.slice(0, 8).map((diagnostic, index) => (
                <li key={index}>
                  <code>
                    {diagnostic.file}:{diagnostic.line}:{diagnostic.column}
                  </code>{' '}
                  {diagnostic.message}
                </li>
              ))}
            </ul>
            {activeScreen?.lastValidRoot !== undefined ? <p>Showing the last valid render.</p> : null}
          </div>
        ) : null}
        {activeScreen !== undefined && activeScreen.errors === 0 && activeScreen.warnings > 0 ? (
          <div className="dsx-overlay warnings" role="status">
            <strong>
              {activeScreen.warnings} warning{activeScreen.warnings === 1 ? '' : 's'}
            </strong>
            <ul>
              {activeScreen.diagnostics
                .filter((diagnostic) => diagnostic.severity === 'warning')
                .slice(0, 5)
                .map((diagnostic, index) => (
                  <li key={index}>
                    <code>
                      {diagnostic.file}:{diagnostic.line}
                    </code>{' '}
                    {diagnostic.message}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </main>
    </div>
  )
}

export { getRoute }
export type { DesignElement, DesignScreenNode }
