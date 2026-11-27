import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react'
import type { PreviewRelationship, PreviewSituation, PreviewTarget } from '@filipeesch/dsh-design-core'
import type { ProjectPayload, WireScreen } from './wire.ts'

export type PreviewDestinationLink = (target: PreviewTarget) => string

export function screenLabel(screen: WireScreen): string {
  const title = screen.title ?? (screen.root ?? screen.lastValidRoot)?.props.title
  return typeof title === 'string' && title.trim() !== '' ? title : screen.id
}

function sameSelection(left: PreviewTarget, right: PreviewTarget | undefined): boolean {
  return left.screen === right?.screen && left.state === right.state
}

export function currentSituation(
  project: ProjectPayload,
  active: PreviewTarget | undefined,
): PreviewSituation | undefined {
  return project.preview?.situations.find(
    (situation) =>
      sameSelection(situation.target, active) &&
      (active?.situation === undefined ? active?.state !== undefined : situation.id === active.situation),
  )
}

interface DestinationProps {
  readonly active: PreviewTarget | undefined
  readonly hrefFor: PreviewDestinationLink
  readonly onVisit: (href: string) => void
}

function activate(event: MouseEvent<HTMLAnchorElement>, onVisit: (href: string) => void): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return
  event.preventDefault()
  onVisit(event.currentTarget.pathname + event.currentTarget.search)
}

export function PreviewLink({
  target,
  hrefFor,
  onVisit,
  isCurrent,
  children,
}: Pick<DestinationProps, 'hrefFor' | 'onVisit'> & {
  readonly target: PreviewTarget
  readonly isCurrent?: boolean
  readonly children: ReactNode
}) {
  return (
    <a
      href={hrefFor(target)}
      aria-current={isCurrent ? 'page' : undefined}
      onClick={(event) => activate(event, onVisit)}
    >
      {children}
    </a>
  )
}

export function ScreenNavigator({
  project,
  active,
  entry,
  hrefFor,
  onVisit,
}: DestinationProps & {
  readonly project: ProjectPayload
  readonly entry: string | undefined
}) {
  const screens = project.screens.filter((screen) => screen.id !== '')
  const byId = new Map(screens.map((screen) => [screen.id, screen]))
  const groups = project.preview?.groups ?? []
  const grouped = new Set(groups.flatMap((group) => group.screens))
  const situation = currentSituation(project, active)
  const renderScreen = (screen: WireScreen) => {
    const situations = project.preview?.situations.filter((candidate) => candidate.parent === screen.id) ?? []
    return (
      <li key={screen.id}>
        <PreviewLink
          target={{ screen: screen.id }}
          isCurrent={active?.screen === screen.id && situation === undefined}
          hrefFor={hrefFor}
          onVisit={onVisit}
        >
          <span>{screenLabel(screen)}</span>
          {entry === screen.id ? <small>Start</small> : null}
          {screen.errors > 0 ? <span className="dsx-badge error">{screen.errors} errors</span> : null}
          {screen.errors === 0 && screen.warnings > 0 ? (
            <span className="dsx-badge warning">{screen.warnings} warnings</span>
          ) : null}
        </PreviewLink>
        {situations.length === 0 ? null : (
          <ul className="dsx-nav-situations">
            {situations.map((item) => (
              <li key={item.id}>
                <PreviewLink
                  target={{ ...item.target, situation: item.id }}
                  isCurrent={situation?.id === item.id}
                  hrefFor={hrefFor}
                  onVisit={onVisit}
                >
                  {item.label}
                </PreviewLink>
              </li>
            ))}
          </ul>
        )}
      </li>
    )
  }
  return (
    <nav aria-label="Screens" className="dsx-screen-navigator">
      {groups.map((group) => (
        <section key={group.id} aria-label={group.label}>
          <h3>{group.label}</h3>
          <ul>
            {group.screens.flatMap((id) => {
              const screen = byId.get(id)
              return screen === undefined ? [] : [renderScreen(screen)]
            })}
          </ul>
        </section>
      ))}
      <ul>{screens.filter((screen) => !grouped.has(screen.id)).map(renderScreen)}</ul>
    </nav>
  )
}

/** A modal on demand leaves the preview tree mounted and returns focus to its trigger. */
export function PreviewDialog({
  title,
  onClose,
  children,
}: {
  readonly title: string
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    const previous = document.activeElement
    // The native modal makes the rest of the preview inert.
    dialog.showModal()
    closeButton.current?.focus()
    return () => {
      dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="dsx-preview-dialog"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="dsx-dialog-close" onClick={onClose} ref={closeButton}>
          Close
        </button>
      </header>
      {children}
    </dialog>
  )
}

/** Only the current authored source can expose its manual system outcomes. */
export function SimulationOptions({
  relationships,
  active,
  onSelect,
}: {
  readonly relationships: readonly PreviewRelationship[]
  readonly active: PreviewTarget
  readonly onSelect: (target: PreviewTarget) => void
}) {
  const outcomes = relationships.filter(
    (edge) =>
      edge.kind === 'simulated' &&
      sameSelection(edge.from, active) &&
      (edge.from.situation === undefined || edge.from.situation === active.situation),
  )
  if (outcomes.length === 0) return null
  return (
    <section className="dsx-outcomes" aria-label="Simulated outcomes">
      <span>Simulated outcomes</span>
      {outcomes.map((edge) => (
        <button key={edge.id} type="button" onClick={() => onSelect(edge.to)}>
          {edge.label}
        </button>
      ))}
    </section>
  )
}
