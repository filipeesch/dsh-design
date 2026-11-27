import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PreviewTarget } from '@filipeesch/dsh-design-core'
import { FlowMap } from './flow-map.tsx'
import {
  currentSituation,
  PreviewDialog,
  ScreenNavigator,
  screenLabel,
  SimulationOptions,
} from './preview-navigation.tsx'
import { buildRouteUrl, parseVariantParam, pushRoute, selectBreakpoint, type PreviewRoute } from './route.ts'
import { ThemeSelector } from './theme.tsx'
import type { ProjectPayload, WireScreen } from './wire.ts'

export function PreviewChrome({
  project,
  route,
  screen,
  entry,
  breakpoint,
  state,
  canSimulate,
  onSimulate,
  consumeOutcomeFocus,
  attachBar,
  children,
}: {
  readonly project: ProjectPayload
  readonly route: PreviewRoute
  readonly screen: WireScreen | undefined
  readonly entry: string | undefined
  readonly breakpoint: string
  readonly state: string | undefined
  readonly canSimulate: boolean
  readonly onSimulate: (href: string) => void
  readonly consumeOutcomeFocus: () => boolean
  readonly attachBar: (node: HTMLDivElement | null) => void
  readonly children: ReactNode
}) {
  const [panel, setPanel] = useState<'screens' | 'map' | undefined>()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const heading = useRef<HTMLHeadingElement>(null)
  const workspace = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // A destination can seed a dialog that needs focus first. Move focus to
    // the destination context only if the simulation left nothing focused.
    const frame = requestAnimationFrame(() => {
      if (consumeOutcomeFocus() && document.activeElement === document.body) {
        ;(heading.current ?? workspace.current)?.focus()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [route, consumeOutcomeFocus])
  const close = () => setPanel(undefined)
  const activeBase = screen === undefined ? undefined : { screen: screen.id, ...(state === undefined ? {} : { state }) }
  const situation = currentSituation(
    project,
    activeBase === undefined
      ? undefined
      : { ...activeBase, ...(route.situation === undefined ? {} : { situation: route.situation }) },
  )
  const active: PreviewTarget | undefined =
    activeBase === undefined || situation === undefined ? activeBase : { ...activeBase, situation: situation.id }
  const onVisit = (href: string) => {
    pushRoute(href)
    close()
  }
  const hrefFor = (target: PreviewTarget) =>
    buildRouteUrl(target.screen, {
      breakpoint,
      theme: route.theme,
      state: target.state,
      situation: target.situation,
      embed: route.embed,
      pane: route.pane,
    })
  const context = screen === undefined ? undefined : project.preview?.screens[screen.id]
  const isOutcome =
    active !== undefined &&
    (project.relationships ?? []).some(
      ({ kind, to }) =>
        kind === 'simulated' &&
        to.screen === active.screen &&
        to.state === active.state &&
        (to.situation === undefined || to.situation === active.situation),
    )
  const metadataProblems = project.diagnostics.filter((diagnostic) => diagnostic.file === 'preview.json')
  const variants =
    screen?.variants?.filter(
      (group) => group.parentPath === undefined || screen.effectiveSelection?.[group.parentPath] === group.parentBranch,
    ) ?? []
  const navigation = { project, active, entry, hrefFor, onVisit }
  return (
    <>
      <header className="dsx-chrome dsx-preview-header">
        <button
          className="dsx-open-nav dsx-chrome-action"
          type="button"
          aria-haspopup="dialog"
          onClick={() => setPanel('screens')}
        >
          Screens
        </button>
        {route.embed ? null : (
          <button
            className="dsx-toggle-sidebar dsx-chrome-action"
            type="button"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? 'Hide screens' : 'Show screens'}
          </button>
        )}
        <div className="dsx-brand">Design preview</div>
        {route.pane !== undefined ? null : (
          <button className="dsx-chrome-action" type="button" aria-haspopup="dialog" onClick={() => setPanel('map')}>
            Flow map
          </button>
        )}
        {route.pane !== undefined ? null : (
          <label className="dsx-chrome-select">
            Breakpoint
            <select value={breakpoint} onChange={(event) => selectBreakpoint(event.currentTarget.value)}>
              {project.config.breakpoints.map(({ name, width }) => (
                <option key={name} value={name}>
                  {name} · {width}px
                </option>
              ))}
            </select>
          </label>
        )}
        {route.pane === undefined ? <ThemeSelector project={project} route={route} /> : null}
        {variants.length === 0 || route.pane !== undefined ? null : (
          <label className="dsx-chrome-select">
            Variant
            <select
              value={route.variantRaw ?? ''}
              onChange={(event) => {
                pushRoute(
                  buildRouteUrl(screen?.id, {
                    breakpoint,
                    state: route.state,
                    theme: route.theme,
                    situation: route.situation,
                    embed: route.embed,
                    variant: parseVariantParam(event.currentTarget.value),
                  }),
                )
              }}
            >
              <option value="">Chosen branches</option>
              {route.variantRaw !== undefined &&
              !variants.some((group) =>
                group.branches.some((branch) => group.path + ':' + branch.id === route.variantRaw),
              ) ? (
                <option value={route.variantRaw} disabled>
                  {route.variantRaw}
                </option>
              ) : null}
              {variants.map((group) => (
                <optgroup key={group.path} label={group.path}>
                  {group.branches.map((branch) => (
                    <option
                      key={branch.id}
                      value={group.path + ':' + branch.id}
                      disabled={!branch.valid && !branch.stale}
                    >
                      {branch.id}
                      {group.chosen === branch.id ? ' (chosen)' : ''}
                      {branch.stale ? ' (stale)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {screen?.variant === undefined ? null : (
          <span className="dsx-variant-badge" data-dsx-variant-badge>
            {screen.variant.path} · {screen.variant.branch}
            {screen.variant.chosen ? ' (chosen)' : ' (alternative)'}
          </span>
        )}
        <div className="dsx-review-slot" ref={attachBar} />
        <div className="dsx-meta">
          kit {project.kitVersion} · rev {project.revision}
        </div>
      </header>
      <div className="dsx-preview-body" data-sidebar={sidebarOpen && !route.embed ? 'open' : 'closed'}>
        {route.embed || !sidebarOpen ? null : (
          <aside className="dsx-preview-sidebar">
            <h2>Screens</h2>
            <ScreenNavigator {...navigation} />
          </aside>
        )}
        <div className="dsx-preview-workspace" ref={workspace} tabIndex={-1} aria-label="Preview destination">
          {screen === undefined ||
          route.pane !== undefined ||
          (context === undefined && situation === undefined && !isOutcome) ? null : (
            <div className="dsx-screen-context" key={screen.id}>
              <div>
                <h1 ref={heading} tabIndex={-1}>
                  {screenLabel(screen)}
                  {situation === undefined ? null : <span> · {situation.label}</span>}
                </h1>
                {isOutcome ? <span className="dsx-outcome-badge">Simulated outcome</span> : null}
              </div>
              {context === undefined ? null : <p>{context.summary}</p>}
              {context?.details === undefined ? null : (
                <details>
                  <summary>Screen details</summary>
                  <p>{context.details}</p>
                </details>
              )}
            </div>
          )}
          {route.pane !== undefined || metadataProblems.length === 0 ? null : (
            <details className="dsx-preview-diagnostics">
              <summary>Preview metadata diagnostics ({metadataProblems.length})</summary>
              <ul>
                {metadataProblems.map((diagnostic, i) => (
                  <li key={i}>
                    {diagnostic.file}:{diagnostic.line}:{diagnostic.column} {diagnostic.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {active === undefined || !canSimulate || route.pane !== undefined ? null : (
            <SimulationOptions
              relationships={project.relationships ?? []}
              active={active}
              onSelect={(target) => onSimulate(hrefFor(target))}
            />
          )}
          {children}
        </div>
      </div>
      {panel === 'screens' ? (
        <PreviewDialog title="Browse screens" onClose={close}>
          <ScreenNavigator {...navigation} />
        </PreviewDialog>
      ) : null}
      {panel === 'map' ? (
        <PreviewDialog title="Flow map" onClose={close}>
          <FlowMap {...navigation} />
        </PreviewDialog>
      ) : null}
    </>
  )
}
