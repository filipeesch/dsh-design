/** Side-by-side variant comparison with isolated interactive preview panes. */
import { useCallback, useEffect, useRef } from 'react'
import type { NamedState } from '@filipeesch/dsh-design-core'
import { buildRouteUrl, setCompareRoute, type PreviewRoute, type RouteCompare } from './route.ts'
import type { ProjectPayload, WireScreen } from './wire.ts'

/** Inputs for the comparison surface. */
export interface CompareViewProps {
  readonly route: PreviewRoute
  readonly project: ProjectPayload
}

function activeScreen(project: ProjectPayload, route: PreviewRoute): WireScreen | undefined {
  const available = project.screens.filter((screen) => screen.id !== '')
  if (route.screen !== undefined) return available.find((screen) => screen.id === route.screen)
  const entry = project.config.entry ?? available[0]?.id
  return available.find((screen) => screen.id === entry) ?? available[0]
}

function branchLabel(screen: WireScreen, groupPath: string, branchId: string): string {
  const group = screen.variants?.find((candidate) => candidate.path === groupPath)
  return branchId === group?.chosen ? branchId + ' (chosen)' : branchId
}

function ComparePane(props: {
  readonly pane: 'left' | 'right'
  readonly branch: string
  readonly label: string
  readonly chosen: boolean
  readonly width: number
  readonly url: string
  readonly resetKey: string
  readonly issue?: string
  readonly stale?: boolean
}) {
  const frame = useRef<HTMLIFrameElement | null>(null)
  const load = useCallback(
    (node: HTMLIFrameElement | null) => {
      frame.current = node
      if (node === null) return
      try {
        node.contentWindow?.location.replace(props.url)
      } catch {
        // The pane may still be about:blank; the effect retries.
      }
    },
    [props.url, props.resetKey],
  )
  // Replacing the pane location avoids adding iframe entries to the joint
  // session history, so parent Back restores the comparison controls. The
  // callback ref also loads a freshly mounted iframe without a URL change.
  useEffect(() => {
    try {
      frame.current?.contentWindow?.location.replace(props.url)
    } catch {
      // The pane may still be about:blank; the next render retries.
    }
  }, [props.url, props.resetKey])
  return (
    <section className={'dsx-compare-pane dsx-compare-' + props.pane} style={{ width: props.width }}>
      <div className="dsx-compare-pane-label">
        <strong>{props.label}</strong>
        <span>
          {props.stale === true ? 'last valid · diagnostics' : props.chosen ? 'chosen branch' : 'alternative branch'}
        </span>
      </div>
      {props.issue === undefined ? (
        <iframe
          ref={load}
          title={'Design preview ' + props.pane + ' branch ' + props.branch}
          data-src={props.url}
          width={props.width}
          height={720}
          style={{ width: props.width, height: 720 }}
          data-dsx-pane={props.pane}
        />
      ) : (
        <div className="dsx-compare-pane-error" role="alert">
          <strong>Branch unavailable</strong>
          <p>{props.issue}</p>
        </div>
      )}
    </section>
  )
}

/** Render the bounded side-by-side comparison. */
export function CompareView({ route, project }: CompareViewProps) {
  const screen = activeScreen(project, route)
  if (screen === undefined) {
    return (
      <div className="dsx-compare dsx-compare-empty" role="alert">
        <strong>{route.screen === undefined ? 'No screen to compare' : 'Screen not found'}</strong>
        <p>
          {route.screen === undefined
            ? 'This design project has no renderable screen.'
            : 'Screen "' + route.screen + '" is not part of this project. No other screen is substituted.'}
        </p>
      </div>
    )
  }
  const groups = screen.variants ?? []
  if (groups.length === 0) {
    return (
      <div className="dsx-compare dsx-compare-empty" role="alert">
        <strong>No variants to compare</strong>
        <p>Screen "{screen.id}" declares no variant groups.</p>
        <a href={buildRouteUrl(screen.id, { breakpoint: route.breakpoint })}>Open the chosen screen</a>
      </div>
    )
  }
  const requested = route.compare
  const group = groups.find((candidate) => candidate.path === requested?.group) ?? groups[0]!
  const known = new Set(group.branches.map((branch) => branch.id))
  const chosen = group.chosen
  const fallbackRight = group.branches.find((branch) => branch.id !== chosen)?.id ?? chosen
  const left = requested !== undefined && known.has(requested.left) ? requested.left : chosen
  const right = requested !== undefined && known.has(requested.right) ? requested.right : fallbackRight
  const invalid =
    requested !== undefined &&
    (!groups.some((entry) => entry.path === requested.group) ||
      !known.has(requested.left) ||
      !known.has(requested.right))
  const breakpointName = project.config.breakpoints.some((entry) => entry.name === route.breakpoint)
    ? (route.breakpoint as string)
    : ([...project.config.breakpoints].sort((a, b) => b.width - a.width)[0]?.name ?? 'desktop')
  const breakpoint = project.config.breakpoints.find((entry) => entry.name === breakpointName)
  const stateMap = new Map<string, NamedState>()
  for (const state of screen.states ?? []) stateMap.set(state.name, state)
  for (const branch of group.branches) {
    for (const state of branch.states ?? []) if (!stateMap.has(state.name)) stateMap.set(state.name, state)
  }
  const states = [...stateMap.values()]
  const unknownState = route.state !== undefined && !stateMap.has(route.state)

  const update = (next: Partial<RouteCompare>, overrides: { breakpoint?: string; state?: string } = {}): void => {
    const compare: RouteCompare = {
      group: next.group ?? group.path,
      left: next.left ?? left,
      right: next.right ?? right,
    }
    setCompareRoute(screen.id, compare, {
      breakpoint: overrides.breakpoint ?? breakpointName,
      state: overrides.state === undefined ? (route.state ?? '') : overrides.state,
    })
  }

  const paneUrl = (branch: string, pane: 'left' | 'right'): string =>
    buildRouteUrl(screen.id, {
      breakpoint: breakpointName,
      ...(route.state === undefined ? {} : { state: route.state }),
      variant: { group: group.path, branch },
      embed: true,
      pane,
    })

  const width = breakpoint?.width ?? 390

  const resetKey = [group.path, left, right, breakpointName, route.state ?? ''].join('|')
  const branchIssue = (branch: string) => {
    const entry = group.branches.find((candidate) => candidate.id === branch)
    if (entry === undefined || entry.valid || entry.stale === true) return undefined
    const first = entry.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
    return first === undefined
      ? 'Branch has validation errors.'
      : first.file + ':' + String(first.line) + ':' + String(first.column) + ' ' + first.message
  }

  return (
    <div className="dsx-compare" data-dsx-compare="1" data-dsx-compare-group={group.path}>
      <header className="dsx-compare-header">
        <div className="dsx-compare-title">
          <strong>Compare variants</strong>
          <span>
            {screen.id} · {group.path}
          </span>
        </div>
        <label className="dsx-compare-field">
          <span>Group</span>
          <select
            aria-label="Variant group"
            value={group.path}
            onChange={(event) => {
              const next = groups.find((candidate) => candidate.path === event.target.value)
              if (next === undefined) return
              const nextRight = next.branches.find((branch) => branch.id !== next.chosen)?.id ?? next.chosen
              update({ group: next.path, left: next.chosen, right: nextRight })
            }}
          >
            {groups.map((entry) => (
              <option key={entry.path} value={entry.path}>
                {entry.path}
              </option>
            ))}
          </select>
        </label>
        <label className="dsx-compare-field">
          <span>Left branch</span>
          <select aria-label="Left branch" value={left} onChange={(event) => update({ left: event.target.value })}>
            {group.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.id + (branch.id === group.chosen ? ' (chosen)' : '')}
              </option>
            ))}
          </select>
        </label>
        <label className="dsx-compare-field">
          <span>Right branch</span>
          <select aria-label="Right branch" value={right} onChange={(event) => update({ right: event.target.value })}>
            {group.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.id + (branch.id === group.chosen ? ' (chosen)' : '')}
              </option>
            ))}
          </select>
        </label>
        <div className="dsx-compare-field dsx-compare-breakpoints" role="group" aria-label="Comparison breakpoints">
          <span>Breakpoint</span>
          <div>
            {project.config.breakpoints.map((candidate) => (
              <button
                key={candidate.name}
                type="button"
                className={candidate.name === breakpointName ? 'active' : ''}
                onClick={() => update({}, { breakpoint: candidate.name })}
              >
                {candidate.name}
                <small>{candidate.width}px</small>
              </button>
            ))}
          </div>
        </div>
        <label className="dsx-compare-field">
          <span>Starting state</span>
          <select
            aria-label="Starting state"
            value={route.state ?? ''}
            onChange={(event) => update({}, { state: event.target.value })}
          >
            <option value="">default</option>
            {unknownState ? <option value={route.state}>{route.state} (unknown)</option> : null}
            {states.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <a className="dsx-compare-link" href={buildRouteUrl(screen.id, { breakpoint: breakpointName })}>
          Open chosen
        </a>
      </header>
      {invalid ? (
        <div className="dsx-compare-notice" role="alert">
          <strong>Unknown comparison selection</strong>
          <p>
            Screen "{screen.id}" does not declare that group or branch. Known branches for "{group.path}":{' '}
            {group.branches.map((branch) => branch.id).join(', ')}.
          </p>
        </div>
      ) : null}
      {unknownState ? (
        <div className="dsx-compare-notice" role="alert">
          <strong>Unknown comparison state</strong>
          <p>
            State "{route.state}" is not declared by screen "{screen.id}" or either comparison branch. It is not
            replaced with a default state.
          </p>
        </div>
      ) : null}
      {invalid ? null : (
        <>
          <p className="dsx-compare-hint">
            Each pane is interactive and focused separately. Scroll horizontally to compare both branches at {width} CSS
            pixels.
          </p>
          <div
            className="dsx-compare-scroll"
            tabIndex={0}
            role="group"
            aria-label="Side-by-side variant panes"
            data-dsx-compare-scroll="1"
          >
            <div className="dsx-compare-panes" style={{ width: width * 2 + 2 }}>
              {(['left', 'right'] as const).map((pane) => {
                const branch = pane === 'left' ? left : right
                return (
                  <ComparePane
                    key={pane}
                    pane={pane}
                    branch={branch}
                    label={branchLabel(screen, group.path, branch)}
                    chosen={branch === group.chosen}
                    width={width}
                    url={paneUrl(branch, pane)}
                    resetKey={resetKey}
                    {...(branchIssue(branch) === undefined ? {} : { issue: branchIssue(branch) })}
                    {...(group.branches.find((entry) => entry.id === branch)?.stale === true ? { stale: true } : {})}
                  />
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
