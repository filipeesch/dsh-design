/** Compact text projection of a design screen for the `design_view` tool. */
import { formatReference, isReference } from './refs.ts'
import type { DesignChild, DesignElement, DesignPropValue, DesignScreenNode } from './types.ts'

/** Options for the text projection. */
export interface ViewOptions {
  /** Maximum node depth to render. */
  readonly depth?: number
  /** Render only this node's subtree. */
  readonly node?: string
  /** Expand every overlay child instead of marking it closed. */
  readonly openOverlays?: boolean
  /** Overlay ids to expand, for example a selected named state. */
  readonly openIds?: readonly string[]
}

/** Result of a projection. */
export interface ViewResult {
  readonly text: string
  readonly lines: readonly string[]
  /** Node the projection started from, when a subtree was requested. */
  readonly node?: string
}

const OVERLAY_TYPES = new Set(['Drawer', 'Modal', 'Popover', 'Menu', 'Toast'])

/** Find a node by explicit id anywhere in the tree. */
export function findNode(
  root: DesignChild | DesignScreenNode,
  id: string,
): DesignElement | DesignScreenNode | undefined {
  if (root.kind === 'element' && root.id === id) return root
  if (root.kind === 'text') return undefined
  for (const child of root.children) {
    if (child.kind === 'text') continue
    const found = findNode(child, id)
    if (found !== undefined) return found
  }
  return undefined
}

/** Format one prop value for the projection. */
function formatValue(value: DesignPropValue): string {
  if (isReference(value)) return formatReference(value)
  return JSON.stringify(value)
}

/** Render one element line without children. */
function elementLine(
  node: DesignElement | DesignScreenNode,
  depth: number,
  closed: boolean,
  truncated: boolean,
): string {
  const indent = '  '.repeat(depth)
  const identity = node.id === undefined || node.id === '' ? node.address.label : `#${node.id}`
  const props = Object.entries(node.props)
    .filter(([name]) => name !== 'id')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ` ${name}=${formatValue(value)}`)
    .join('')
  const text = node.children
    .filter((child): child is Extract<DesignChild, { kind: 'text' }> => child.kind === 'text')
    .map((child) => (child.itemField === undefined ? child.value : 'item("' + child.itemField + '")'))
    .join(' ')
  const suffix = text.length === 0 ? '' : ` "${text}"`
  const marker = closed ? ' (closed)' : truncated ? ' …' : ''
  return `${indent}<${node.type} ${identity}${props}>${suffix}${marker}`
}

/**
 * Project a screen to one indented line per node.
 * @param root - screen root or subtree root.
 * @param options - depth, subtree, and overlay expansion.
 */
export function projectScreen(root: DesignElement | DesignScreenNode, options: ViewOptions = {}): ViewResult {
  let start: DesignElement | DesignScreenNode | undefined = root
  if (options.node !== undefined) {
    start = findNode(root, options.node)
    if (start === undefined) {
      return { text: `No node with id "${options.node}" in screen "${root.id ?? ''}".`, lines: [] }
    }
  }
  const maxDepth = options.depth ?? 40
  const requested = options.node !== undefined
  const lines: string[] = []

  const visit = (node: DesignChild | DesignScreenNode, depth: number, forceOpen: boolean): void => {
    if (node.kind === 'text') return
    const isOverlay = OVERLAY_TYPES.has(node.type)
    const closed =
      isOverlay &&
      !options.openOverlays &&
      !forceOpen &&
      !(node.id !== undefined && (options.openIds ?? []).includes(node.id))
    const truncated = depth >= maxDepth && node.children.some((child) => child.kind === 'element')
    lines.push(elementLine(node, depth, closed, truncated))
    if (closed || truncated) return
    for (const child of node.children) {
      if (child.kind === 'element') visit(child, depth + 1, false)
    }
  }
  if (start === undefined) return { text: '', lines: [] }
  visit(start, 0, requested)
  return {
    text: lines.join('\n'),
    lines,
    ...(options.node === undefined ? {} : { node: options.node }),
  }
}
