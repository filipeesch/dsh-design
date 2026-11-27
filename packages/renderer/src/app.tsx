/** Preview application: chrome, frame, live reload, and interaction state. */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import { selectPalette, ThemeNotice } from './theme.tsx'
import { collectReviewState } from './review-state.ts'
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

const ignoreOutcomeFocus = () => false

/** Root preview application. */
export function App() {
  const route = useRoute()
  const canvasId = 'canvas-' + useId().replace(/[^a-z0-9-]/gi, '')
  const session = route.session
  const bootstrap = route.deterministic
    ? (globalThis as { __DSX_PROJECT__?: ProjectPayload }).__DSX_PROJECT__
    : undefined
  const [loadError, setLoadError] = useState<{ key: string; message: string } | undefined>()
  const [state, setState] = useState<PreviewState>(() =>
    route.embed || route.deterministic ? emptyState() : loadState(session),
  )
  const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null)
  const [barHost, setBarHost] = useState<HTMLDivElement | null>(null)
  const malformedVariant = route.variantRaw !== undefined && route.variant === undefined
  const malformedCompare = route.compareRaw !== undefined && route.compare === undefined
  const variantParam = route.variant === undefined ? undefined : route.variant.group + ':' + route.variant.branch
  const requestedId = route.screen
  const projectionKey = JSON.stringify([session, requestedId, variantParam])
  const [snapshot, setSnapshot] = useState<{ key: string; project: ProjectPayload } | undefined>()
  const project = bootstrap ?? (snapshot?.project.session === session ? snapshot.project : undefined)
  const loadingProjection = bootstrap === undefined && snapshot?.key !== projectionKey
  const ready = project !== undefined && !loadingProjection
  const theme = project === undefined ? undefined : selectPalette(project, route)
  const palette = theme?.palette
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
  const appliedSeed = useRef<{ session: string; screen: string; state?: string; variant?: string } | undefined>(
    undefined,
  )

  useEffect(() => {
    setState(route.embed || route.deterministic ? emptyState() : loadState(session))
  }, [session, route.embed, route.deterministic])

  useEffect(() => {
    if (bootstrap !== undefined) return
    const controller = new AbortController()
    let committedToken: string | undefined
    let observedToken: string | undefined
    let pending = false
    let hasProjection = false
    const load = async () => {
      if (pending || controller.signal.aborted) return
      const startingToken = observedToken
      pending = true
      try {
        const next = await fetchProject(session, {
          screen: requestedId,
          variant: variantParam,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        committedToken = next.token ?? String(next.revision)
        hasProjection = true
        setSnapshot({ key: projectionKey, project: next })
        setState((current) => filterState(current, next))
        setLoadError(undefined)
      } catch (error) {
        if (!controller.signal.aborted && !hasProjection) {
          setLoadError({ key: projectionKey, message: error instanceof Error ? error.message : String(error) })
        }
      } finally {
        pending = false
        // Only follow up immediately if a token arrived during this request.
        // An earlier check may lag this response; the next check settles it.
        if (observedToken !== startingToken && observedToken !== committedToken) void load()
      }
    }
    setLoadError(undefined)
    void load()
    const unsubscribe = route.deterministic
      ? undefined
      : subscribeRevisions(session, (token) => {
          observedToken = token
          if (token !== committedToken) void load()
        })
    return () => {
      controller.abort()
      unsubscribe?.()
    }
  }, [session, requestedId, variantParam, projectionKey, route.deterministic, bootstrap])

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
  const activeScreen = loadingProjection ? undefined : (requestedScreen ?? findScreen(project, entryId))
  const screenId = activeScreen?.id
  const missingScreen = ready && route.screen !== undefined && requestedScreen === undefined

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
    route.variant === undefined || loadingProjection
      ? malformedVariantError
      : (malformedVariantError ?? project?.variantError)
  // The host rejects stale inputs to checks; explicit preview payloads may still
  // display their retained tree with diagnostics without claiming fresh evidence.
  const currentRoot = !projectFatal && screenErrors === 0 ? activeScreen?.root : undefined
  const retainedRoot =
    route.deterministic || route.variant !== undefined
      ? undefined
      : activeScreen === undefined
        ? undefined
        : activeScreen.lastValidRoot
  const tree = projectFatal || missingScreen || variantError !== undefined ? undefined : (currentRoot ?? retainedRoot)
  const treeFingerprint = useMemo(() => (tree === undefined ? undefined : fingerprintDesignTree(tree)), [tree])
  const screenStates = activeScreen?.states ?? []
  const unknownState =
    ready && route.state !== undefined && !screenStates.some((candidate) => candidate.name === route.state)
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
  // view. A breakpoint change and a revision refresh leave the route key
  // unchanged, so compatible local interaction survives.
  useEffect(() => {
    if (!ready || screenId === undefined) {
      if (requestedId !== undefined && appliedSeed.current?.screen !== requestedId) appliedSeed.current = undefined
      return
    }
    const previous = appliedSeed.current
    const first = previous?.session !== session
    if (!first && previous.screen === screenId && previous.state === route.state && previous.variant === variantParam)
      return
    appliedSeed.current = { session, screen: screenId, state: route.state, variant: variantParam }
    const override =
      first && route.deterministic && bootstrap?.initialState?.screen === screenId
        ? bootstrap.initialState.seed
        : undefined
    const named = override ?? screenStates.find((candidate) => candidate.name === route.state)
    const compatible =
      named === undefined
        ? false
        : route.variant === undefined || tree === undefined
          ? true
          : stateCompatibility(tree, named, kitMetadata).length === 0
    setState((current) => {
      if (named !== undefined && compatible) return seedState(current, screenId, named)
      // A plain screen visit restores compatible interaction. A changed
      // starting selector on the same screen starts a new interaction.
      if (route.state !== undefined || (!first && previous.screen === screenId)) {
        return clearScreenState(current, screenId)
      }
      return current
    })
  }, [
    ready,
    requestedId,
    session,
    screenId,
    route.state,
    route.deterministic,
    bootstrap,
    screenStates,
    route.variant,
    variantParam,
    tree,
  ])

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
  const reviewState = useMemo(
    () => collectReviewState(tree, state, openOverlays, breakpoints, breakpointName),
    [tree, state, openOverlays, breakpoints, breakpointName],
  )

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
    () =>
      tree === undefined ? '' : collectCssRules(tree, imageUrl, '[data-dsx-canvas="' + canvasId + '"]').join('\n'),
    [tree, imageUrl, canvasId],
  )

  const environment: DesignEnvironment = useMemo(
    () => ({
      tokens: palette?.tokens ?? {},
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
      palette,
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
  const overlayErrors: Diagnostic[] = [...new Set([...(projectFatal ? projectErrors : []), ...activeErrors])]

  if (loadError?.key === projectionKey && project === undefined) {
    return (
      <div role="alert" style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#991b1b' }}>
        Preview failed to load: {loadError.message}
      </div>
    )
  }
  if (project === undefined) {
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
        <a
          href={buildRouteUrl(project.config.entry ?? route.screen, {
            breakpoint: route.breakpoint,
            theme: route.theme,
          })}
        >
          Open the chosen screen
        </a>
      </div>
    )
  }
  if (route.compare !== undefined && !route.deterministic) {
    return ready ? <CompareView route={route} project={project} /> : <div role="status">Loading preview…</div>
  }
  const deterministicCompare = route.deterministic && (route.compare !== undefined || route.compareRaw !== undefined)

  const frame = breakpoint === undefined ? undefined : breakpoint
  const reviewScreen = screenId ?? project.projectedScreen ?? entryId
  const variantIdentity = canonicalVariantIdentity(activeScreen?.effectiveSelection ?? {})
  const canvas = (
    <main className="dsx-stage">
      <ThemeNotice project={project} route={route} />
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
      {loadingProjection ? (
        loadError?.key === projectionKey ? (
          <div className="dsx-notice error" role="alert">
            Preview failed to load: {loadError.message}
          </div>
        ) : (
          <div className="dsx-notice" role="status">
            Loading preview…
          </div>
        )
      ) : palette === undefined ? null : frame === undefined || tree === undefined ? (
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
            data-theme={theme?.name}
            data-screen={screenId ?? ''}
            style={{ width: frame.width, minHeight: 520 }}
          >
            <style>{cssText}</style>
            <div
              className="dsx-frame-inner"
              data-dsx-canvas={canvasId}
              style={
                {
                  ...palette.cssVariables,
                  colorScheme: palette.colorScheme,
                  '--dsx-font-family': '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
                } as CSSProperties
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
          {currentRoot === undefined || activeScreen?.variantStale === true ? (
            <p>Showing the last valid render.</p>
          ) : null}
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
      data-dsx-theme={theme?.name}
      data-dsx-theme-error={palette === undefined || palette.stale === true ? '1' : undefined}
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
            currentRoot !== undefined &&
            tree !== undefined &&
            palette !== undefined &&
            palette.stale !== true &&
            !unknownState &&
            incompatibleState === undefined
          }
          attachBar={attachBar}
          onSimulate={navigateOutcome}
          consumeOutcomeFocus={ready ? consumeOutcomeFocus : ignoreOutcomeFocus}
        >
          {canvas}
        </PreviewChrome>
      )}
      {!route.deterministic &&
      palette !== undefined &&
      (loadingProjection || tree !== undefined) &&
      frame !== undefined &&
      reviewScreen !== undefined ? (
        <ReviewOverlay
          key={session}
          session={session}
          screen={reviewScreen}
          revision={project.revision}
          breakpoint={breakpointName}
          {...(appliedState === undefined ? {} : { state: appliedState })}
          {...(variantIdentity === undefined ? {} : { variant: variantIdentity })}
          theme={theme?.name ?? 'base'}
          {...reviewState}
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
