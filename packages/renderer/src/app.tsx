/** Preview application: chrome, frame, live reload, and interaction state. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  canonicalVariantIdentity,
  collectCssRules,
  countDiagnostics,
  fingerprintDesignTree,
  stateCompatibility,
  type Breakpoint,
  type DesignChild,
  type DesignElement,
  type DesignScreenNode,
  type Diagnostic,
} from '@filipeesch/dsh-design-core'
import { DesignEnvironmentContext, kitMetadata, type DesignEnvironment } from '@filipeesch/dsh-design-kit'
import { fetchProject, subscribeRevisions } from './api.ts'
import { CompareView } from './compare.tsx'
import { renderNode } from './interpreter.tsx'
import { buildRouteUrl, getRoute, navigateRoute, pushRoute, useRoute } from './route.ts'
import { PreviewChrome } from './preview-chrome.tsx'
import {
  clearScreenState,
  emptyState,
  filterState,
  loadState,
  saveState,
  seedState,
  type PreviewState,
} from './state.ts'
import { ReviewOverlay } from './review.tsx'
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
  const [loadError, setLoadError] = useState<string | undefined>()
  const [state, setState] = useState<PreviewState>(() => emptyState())
  const [ready, setReady] = useState(bootstrap !== undefined)
  const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null)
  const [barHost, setBarHost] = useState<HTMLDivElement | null>(null)
  const malformedVariant = route.variantRaw !== undefined && route.variant === undefined
  const malformedCompare = route.compareRaw !== undefined && route.compare === undefined
  const variantParam = route.variant === undefined ? undefined : route.variant.group + ':' + route.variant.branch
  // Only an explicit variant route needs its screen id; ordinary screen
  // navigation keeps one project payload and one seeded state.
  const variantScreen = variantParam === undefined ? undefined : route.screen
  const projectionKey = JSON.stringify([session, variantScreen, variantParam])
  const [snapshot, setSnapshot] = useState<{ key: string; project: ProjectPayload } | undefined>(() =>
    bootstrap === undefined ? undefined : { key: projectionKey, project: bootstrap },
  )
  const project = snapshot?.key === projectionKey ? snapshot.project : undefined
  // The chrome unmounts while a new projection loads; keep the request here.
  const outcomeDestination = useRef<string | undefined>(undefined)
  const navigateOutcome = useCallback((href: string) => {
    if (href === location.pathname + location.search) return
    outcomeDestination.current = href
    pushRoute(href)
  }, [])
  const consumeOutcomeFocus = useCallback(() => {
    const pending = outcomeDestination.current
    if (pending === undefined || pending !== location.pathname + location.search) return false
    outcomeDestination.current = undefined
    return true
  }, [])
  useEffect(() => {
    if (outcomeDestination.current !== location.pathname + location.search) outcomeDestination.current = undefined
  }, [route])
  const attachFrame = useCallback((node: HTMLDivElement | null) => {
    setFrameElement(node)
  }, [])
  const attachBar = useCallback((node: HTMLDivElement | null) => {
    setBarHost(node)
  }, [])
  const revision = useRef(bootstrap?.revision ?? -1)
  const lastTrees = useRef(new Map<string, DesignScreenNode>())
  const appliedSeed = useRef<string | undefined>(undefined)

  const updateProject = useCallback(
    (next: ProjectPayload) => {
      setSnapshot({ key: projectionKey, project: next })
      revision.current = next.revision
      for (const screen of next.screens) {
        const errors = countDiagnostics(screen.diagnostics).errors
        if (errors === 0 && screen.root !== undefined) lastTrees.current.set(screen.id, screen.root)
      }
      setState((current) => filterState(current, next))
      setReady(true)
    },
    [projectionKey],
  )

  useEffect(() => {
    if (bootstrap !== undefined) {
      setState(emptyState())
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
    setSnapshot(undefined)
    lastTrees.current.clear()
    fetchProject(session, undefined, {
      ...(variantScreen === undefined ? {} : { screen: variantScreen }),
      ...(variantParam === undefined ? {} : { variant: variantParam }),
    })
      .then((next) => {
        if (cancelled) return
        setState(route.embed || route.deterministic ? emptyState() : loadState(session))
        updateProject(next)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [session, variantScreen, variantParam, route.embed, route.deterministic, updateProject, bootstrap])

  useEffect(() => {
    if (route.deterministic) return
    let subscribed = true
    const unsubscribe = subscribeRevisions(session, (event) => {
      if (event.rev > revision.current) {
        fetchProject(session, event.rev, {
          ...(variantScreen === undefined ? {} : { screen: variantScreen }),
          ...(variantParam === undefined ? {} : { variant: variantParam }),
        })
          .then((next) => {
            if (subscribed) updateProject(next)
          })
          .catch(() => undefined)
      }
    })
    return () => {
      subscribed = false
      unsubscribe()
    }
  }, [session, route.deterministic, variantScreen, variantParam, updateProject])

  useEffect(() => {
    if (ready && !route.embed && !route.deterministic) saveState(session, state)
  }, [session, state, ready, route.embed, route.deterministic])

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

  const screenErrors =
    activeScreen === undefined ? 0 : (activeScreen.blockingErrors ?? countDiagnostics(activeScreen.diagnostics).errors)
  const projectFatal = project?.projectError !== undefined
  const malformedVariantError =
    malformedVariant && route.variantRaw !== undefined
      ? 'The variant query "' + route.variantRaw + '" is not a group:branch selection.'
      : undefined
  const variantError =
    route.variant === undefined ? malformedVariantError : (malformedVariantError ?? project?.variantError)
  const currentRoot = !projectFatal && screenErrors === 0 ? activeScreen?.root : undefined
  const retainedRoot =
    route.variant !== undefined
      ? undefined
      : activeScreen === undefined
        ? undefined
        : (activeScreen.lastValidRoot ?? lastTrees.current.get(activeScreen.id))
  const tree = projectFatal || missingScreen || variantError !== undefined ? undefined : (currentRoot ?? retainedRoot)
  const treeFingerprint = useMemo(() => (tree === undefined ? undefined : fingerprintDesignTree(tree)), [tree])
  const screenStates = activeScreen?.states ?? []
  const unknownState = route.state !== undefined && !screenStates.some((candidate) => candidate.name === route.state)
  const namedState = screenStates.find((candidate) => candidate.name === route.state)
  const stateIssues =
    route.variant !== undefined && namedState !== undefined && tree !== undefined
      ? stateCompatibility(tree, namedState, kitMetadata)
      : []
  const incompatibleState =
    stateIssues.length === 0
      ? undefined
      : 'State "' +
        String(route.state) +
        '" is incompatible with variant branch ' +
        route.variant!.group +
        ':' +
        route.variant!.branch +
        ': ' +
        stateIssues.join('; ') +
        '.'
  const appliedState =
    route.state !== undefined && namedState !== undefined && stateIssues.length === 0 ? route.state : undefined

  // A shared selector transition reseeds or clears that screen's starting
  // view. A breakpoint change and a valid SSE reload leave the route key
  // unchanged, so compatible local interaction survives.
  useEffect(() => {
    if (!ready || screenId === undefined) return
    const variantKey = route.variant === undefined ? '' : route.variant.group + ':' + route.variant.branch
    const key = screenId + '|' + (route.state ?? '') + '|' + variantKey
    if (appliedSeed.current === key) return
    const first = appliedSeed.current === undefined
    appliedSeed.current = key
    const named = screenStates.find((candidate) => candidate.name === route.state)
    const compatible =
      named === undefined
        ? false
        : route.variant === undefined || tree === undefined
          ? true
          : stateCompatibility(tree, named, kitMetadata).length === 0
    setState((current) => {
      // Initial mount keeps compatible persisted interaction when the route
      // carries no named state; later shared-selector changes reset it.
      if (first && route.state === undefined) return current
      const cleared = clearScreenState(current, screenId)
      if (first) return named !== undefined && compatible ? seedState(current, screenId, named) : cleared
      return named === undefined || !compatible ? cleared : seedState(cleared, screenId, named)
    })
  }, [ready, screenId, route.state, screenStates, route.variant, tree])

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
  const overlayList = useMemo(() => [...openOverlays].sort((left, right) => left.localeCompare(right)), [openOverlays])
  const tabSelections = useMemo(() => {
    const selections: Record<string, string> = {}
    if (screenId === undefined) return selections
    const prefix = screenId + '/'
    for (const [key, value] of Object.entries(state.tabs)) {
      if (!key.startsWith(prefix)) continue
      const node = key.slice(prefix.length)
      if (node === '' || node.startsWith('radio:')) continue
      selections[node] = value
    }
    return selections
  }, [state.tabs, screenId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || screenId === undefined || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('.dsx-preview-dialog') !== null) return
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
      isDisclosureOpen: (id: string, fallback: boolean) =>
        screenId === undefined ? fallback : (state.disclosures[screenId + '/' + id] ?? fallback),
      setDisclosure: (id: string, expanded: boolean) =>
        setState((current) =>
          screenId === undefined
            ? current
            : { ...current, disclosures: { ...current.disclosures, [screenId + '/' + id]: expanded } },
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
      state.disclosures,
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
  if (malformedCompare && !route.deterministic) {
    return (
      <div className="dsx-compare dsx-compare-empty" role="alert">
        <strong>Malformed comparison selection</strong>
        <p>
          The comparison query "{route.compareRaw}" is not a group:left:right selection. No branch or screen is
          substituted.
        </p>
        <a href={buildRouteUrl(project.config.entry ?? route.screen, { breakpoint: route.breakpoint })}>
          Open the chosen screen
        </a>
      </div>
    )
  }
  if (route.compare !== undefined && !route.deterministic) return <CompareView route={route} project={project} />
  const deterministicCompare = route.deterministic && (route.compare !== undefined || route.compareRaw !== undefined)

  const frame = breakpoint === undefined ? undefined : breakpoint
  const variantIdentity = canonicalVariantIdentity(activeScreen?.effectiveSelection ?? {})
  const canvas = (
    <main className="dsx-stage">
      {unknownState ? (
        <div className="dsx-notice error" role="alert">
          <strong>Unknown state</strong>
          <p>
            State "{route.state}" is not declared for screen "{screenId ?? ''}". No state was applied.
          </p>
        </div>
      ) : null}
      {incompatibleState === undefined ? null : (
        <div className="dsx-notice error" role="alert">
          <strong>Incompatible state for this branch</strong>
          <p>{incompatibleState} No state was applied.</p>
        </div>
      )}
      {variantError === undefined ? null : (
        <div className="dsx-notice error" role="alert">
          <strong>Unknown variant selection</strong>
          <p>{variantError}</p>
          {activeScreen?.variants === undefined || activeScreen.variants.length === 0 ? null : (
            <ul>
              {activeScreen.variants.map((group) => (
                <li key={group.path}>
                  {group.path} (chosen {group.chosen}): {group.branches.map((branch) => branch.id).join(', ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {deterministicCompare ? (
        <div className="dsx-notice" role="status">
          <strong>Deterministic preview</strong>
          <p>
            This self-contained canvas renders the chosen projection only; open the interactive comparison route to
            compare branches.
          </p>
        </div>
      ) : null}
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
          <strong>{variantError === undefined ? 'No renderable screen' : 'Variant unavailable'}</strong>
          <p>
            {variantError === undefined
              ? 'Fix the errors below and save the file. The last valid render is kept while it exists.'
              : 'The requested branch is not rendered. The chosen branch is not substituted automatically.'}
          </p>
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
            ref={attachFrame}
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
  )
  return (
    <div
      className={'dsx-shell' + (route.deterministic ? ' dsx-deterministic' : '') + (route.embed ? ' dsx-embed' : '')}
      data-dsx-session={session}
      data-dsx-deterministic={route.deterministic ? '1' : undefined}
      data-dsx-clock={route.deterministic ? String(FIXED_TIME) : undefined}
      data-dsx-state={route.state}
      data-dsx-state-error={unknownState || incompatibleState !== undefined ? '1' : undefined}
      data-dsx-variant={variantIdentity}
      data-dsx-variant-chosen={activeScreen?.variant?.chosen === true ? '1' : undefined}
      data-dsx-embed={route.embed ? '1' : undefined}
    >
      {route.deterministic ? (
        canvas
      ) : (
        <PreviewChrome
          project={project}
          route={route}
          screen={activeScreen}
          entry={entryId}
          breakpoint={breakpointName}
          state={appliedState}
          canSimulate={
            currentRoot !== undefined && tree !== undefined && !unknownState && incompatibleState === undefined
          }
          attachBar={attachBar}
          onSimulate={navigateOutcome}
          consumeOutcomeFocus={consumeOutcomeFocus}
        >
          {canvas}
        </PreviewChrome>
      )}
      {!route.deterministic && tree !== undefined && frame !== undefined && screenId !== undefined ? (
        <ReviewOverlay
          session={session}
          screen={screenId}
          revision={project.revision}
          breakpoint={breakpointName}
          {...(appliedState === undefined ? {} : { state: appliedState })}
          {...(variantIdentity === undefined ? {} : { variant: variantIdentity })}
          overlays={overlayList}
          tabs={tabSelections}
          frame={frameElement}
          {...(treeFingerprint === undefined ? {} : { fingerprint: treeFingerprint })}
          barHost={barHost}
        />
      ) : null}
    </div>
  )
}

export { getRoute }
export type { DesignElement, DesignScreenNode }
