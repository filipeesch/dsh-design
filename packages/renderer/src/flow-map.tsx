import { useId, useState } from 'react'
import type { PreviewRelationship, PreviewTarget } from '@filipeesch/dsh-design-core'
import { PreviewLink, screenLabel, type PreviewDestinationLink } from './preview-navigation.tsx'
import type { ProjectPayload } from './wire.ts'

const EDGE_LABELS = {
  prototype: 'Prototype click',
  simulated: 'Manual simulation',
  illustrative: 'Illustrative only',
} as const

interface MapNode {
  readonly key: string
  readonly label: string
  readonly target: PreviewTarget
}

function keyOf(target: PreviewTarget): string {
  return target.situation ?? target.screen
}

function buildMap(project: ProjectPayload, active: PreviewTarget | undefined, full: boolean) {
  const situations = project.preview?.situations ?? []
  const mapNodes: MapNode[] = project.screens
    .filter((screen) => screen.id !== '')
    .map((screen) => ({
      key: screen.id,
      label: screenLabel(screen),
      target: { screen: screen.id },
    }))
  for (const item of situations)
    mapNodes.push({ key: item.id, label: item.label, target: { ...item.target, situation: item.id } })
  const byKey = new Map(mapNodes.map((node) => [node.key, node]))
  const all = (project.relationships ?? []).filter((edge) => byKey.has(keyOf(edge.from)) && byKey.has(keyOf(edge.to)))
  if (full || active === undefined) return { nodes: mapNodes, edges: all, byKey }
  const anchors = new Set([
    active.screen,
    ...situations
      .filter((item) => item.parent === active.screen || item.target.screen === active.screen)
      .map((item) => item.id),
  ])
  const edges = all.filter((edge) => anchors.has(keyOf(edge.from)) || anchors.has(keyOf(edge.to)))
  const neighborhood = new Set([...anchors, ...edges.flatMap((edge) => [keyOf(edge.from), keyOf(edge.to)])])
  return { nodes: mapNodes.filter((node) => neighborhood.has(node.key)), edges, byKey }
}

const CELL_X = 212
const CELL_Y = 82
const MAX_DIAGRAM_NODES = 36
const MAX_DIAGRAM_EDGES = 120

/** Layer the visible graph by distance from its current screen, then add any disconnected nodes. */
function layout(nodes: readonly MapNode[], edges: readonly PreviewRelationship[], center: string | undefined) {
  const adjacent = new Map<string, Set<string>>()
  for (const edge of edges) {
    const from = keyOf(edge.from)
    const to = keyOf(edge.to)
    for (const [left, right] of [
      [from, to],
      [to, from],
    ] as const) {
      const next = adjacent.get(left) ?? new Set<string>()
      next.add(right)
      adjacent.set(left, next)
    }
  }
  const ranks = new Map<string, number>()
  const queue = center === undefined ? [] : [center]
  if (center !== undefined) ranks.set(center, 0)
  for (const key of queue) {
    for (const next of adjacent.get(key) ?? []) {
      if (ranks.has(next)) continue
      ranks.set(next, Math.min(3, (ranks.get(key) ?? 0) + 1))
      queue.push(next)
    }
  }
  const fallback = Math.min(3, Math.max(0, ...ranks.values()) + 1)
  const counts = [0, 0, 0, 0]
  const positions = new Map<string, { x: number; y: number }>()
  let maxColumn = 0
  for (const { key } of nodes) {
    const col = ranks.get(key) ?? fallback
    const row = counts[col] ?? 0
    counts[col] = row + 1
    maxColumn = Math.max(col, maxColumn)
    positions.set(key, { x: 16 + CELL_X * col, y: 14 + CELL_Y * row })
  }
  return { positions, width: CELL_X * (maxColumn + 1), height: Math.max(...counts) * CELL_Y }
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }, port: number): string {
  const y = a.y + port
  const end = b.y + port
  if (a.x === b.x && a.y === b.y) return 'M ' + (a.x + 164) + ' ' + y + ' c 39 -46 39 46 0 10'
  if (a.x === b.x)
    return (
      'M ' +
      (a.x + 164) +
      ' ' +
      y +
      ' C ' +
      (a.x + 192) +
      ' ' +
      y +
      ', ' +
      (b.x + 192) +
      ' ' +
      end +
      ', ' +
      (b.x + 164) +
      ' ' +
      end
    )
  const forward = a.x < b.x
  const startX = a.x + (forward ? 164 : 0)
  const endX = b.x + (forward ? 0 : 164)
  const bend = (startX + endX) / 2
  return 'M ' + startX + ' ' + y + ' C ' + bend + ' ' + y + ', ' + bend + ' ' + end + ', ' + endX + ' ' + end
}

export function FlowMap({
  project,
  active,
  entry,
  hrefFor,
  onVisit,
}: {
  readonly project: ProjectPayload
  readonly active: PreviewTarget | undefined
  readonly entry: string | undefined
  readonly hrefFor: PreviewDestinationLink
  readonly onVisit: (url: string) => void
}) {
  const [full, setFull] = useState(false)
  const marker = useId()
  const { nodes, edges, byKey } = buildMap(project, active, full)
  const currentKey = active === undefined ? undefined : keyOf(active)
  // An unqualified situation is an authored shortcut to the screen's default
  // projection rather than a separate diagram step. Preserve its own link and
  // label in the details even when it is current or referenced by an edge.
  const related = new Set(edges.flatMap((edge) => [keyOf(edge.from), keyOf(edge.to)]))
  const shortcuts = nodes.filter(
    (node) =>
      node.target.situation !== undefined &&
      (node.target.state === undefined || (node.key !== currentKey && !related.has(node.key))),
  )
  const shortcutKeys = new Set(shortcuts.map((node) => node.key))
  const graphKey = (target: PreviewTarget) => (shortcutKeys.has(keyOf(target)) ? target.screen : keyOf(target))
  const screenKeys = new Set(shortcuts.map((node) => node.target.screen))
  const diagramNodes = [
    ...new Map(
      [
        ...nodes.filter((node) => !shortcutKeys.has(node.key)),
        ...Array.from(screenKeys).flatMap((key) => {
          const node = byKey.get(key)
          return node === undefined ? [] : [node]
        }),
      ].map((node) => [node.key, node]),
    ).values(),
  ]
  const visibleNodes = diagramNodes.length > MAX_DIAGRAM_NODES ? [] : diagramNodes
  const center = active === undefined ? entry : graphKey(active)
  const diagramEdges = edges
    .slice(0, MAX_DIAGRAM_EDGES)
    .map((edge) => ({ ...edge, from: { screen: graphKey(edge.from) }, to: { screen: graphKey(edge.to) } }))
  const pairKey = (from: string, to: string) => JSON.stringify([from, to])
  const tracks = new Map<string, number>()
  for (const edge of diagramEdges) {
    const key = pairKey(edge.from.screen, edge.to.screen)
    tracks.set(key, (tracks.get(key) ?? 0) + 1)
  }
  const offsets = new Map<string, number>()
  const { positions, width, height } = layout(visibleNodes, diagramEdges, center)
  const link = (node: MapNode) => (
    <PreviewLink target={node.target} isCurrent={node.key === currentKey} hrefFor={hrefFor} onVisit={onVisit}>
      <span>{node.label}</span>
      {node.key === currentKey ? (
        <small>Current</small>
      ) : node.key === center ? (
        <small>Active screen</small>
      ) : node.key === entry ? (
        <small>Start</small>
      ) : null}
    </PreviewLink>
  )
  return (
    <div className="dsx-flow-map">
      <div className="dsx-map-controls" role="group" aria-label="Map scope">
        <button type="button" aria-pressed={!full} onClick={() => setFull(false)}>
          Near this screen
        </button>
        <button type="button" aria-pressed={full} onClick={() => setFull(true)}>
          All screens
        </button>
        <span>
          {nodes.length} destinations · {edges.length} connections
        </span>
      </div>
      {visibleNodes.length === 0 ? null : (
        <div className="dsx-map-scroll">
          <div className="dsx-map-layout" style={{ width, height }}>
            <svg viewBox={'0 0 ' + width + ' ' + height} aria-hidden="true">
              <defs>
                <marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M1 1 L7 4 L1 7" fill="none" stroke="context-stroke" />
                </marker>
              </defs>
              {diagramEdges.map((edge) => {
                const source = positions.get(keyOf(edge.from))
                const target = positions.get(keyOf(edge.to))
                if (source === undefined || target === undefined) return null
                const key = pairKey(edge.from.screen, edge.to.screen)
                const reciprocal = source !== target && tracks.has(pairKey(edge.to.screen, edge.from.screen))
                const forward = source.x < target.x || (source.x === target.x && source.y < target.y)
                const midpoint = reciprocal ? (forward ? 15 : 37) : 26
                const room = reciprocal ? 8 : 18
                const nth = offsets.get(key) ?? 0
                const count = tracks.get(key) ?? 1
                offsets.set(key, nth + 1)
                const port = count === 1 ? midpoint : midpoint - room + (2 * room * nth) / (count - 1)
                return (
                  <path
                    key={edge.id}
                    d={edgePath(source, target, port)}
                    data-kind={edge.kind}
                    markerEnd={'url(#' + marker + ')'}
                  />
                )
              })}
            </svg>
            {visibleNodes.map((node) => {
              const point = positions.get(node.key)
              return (
                <div key={node.key} className="dsx-map-node" style={{ left: point?.x, top: point?.y }}>
                  {link(node)}
                </div>
              )
            })}
          </div>
        </div>
      )}
      {visibleNodes.length === 0 && nodes.length > 0 ? (
        <ul className="dsx-map-destinations">
          {nodes.map((node) => (
            <li key={node.key}>{link(node)}</li>
          ))}
        </ul>
      ) : null}
      {visibleNodes.length > 0 && shortcuts.length > 0 ? (
        <section className="dsx-map-shortcuts" aria-label="Situation shortcuts">
          <h3>Situation shortcuts</h3>
          <ul className="dsx-map-destinations">
            {shortcuts.map((node) => (
              <li key={node.key}>
                {link(node)} <small>{byKey.get(node.target.screen)?.label}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <h3>Connections</h3>
      {edges.length === 0 ? (
        <p className="dsx-map-empty">No connections in this view.</p>
      ) : (
        <ul className="dsx-map-edges">
          {edges.map((edge) => (
            <li key={edge.id}>
              <span className="dsx-edge-type" data-kind={edge.kind}>
                {EDGE_LABELS[edge.kind]}
              </span>
              <span>
                {byKey.get(keyOf(edge.from))?.label} → {byKey.get(keyOf(edge.to))?.label}
              </span>
              <strong>{edge.label}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
