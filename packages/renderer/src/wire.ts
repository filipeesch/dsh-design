/** Wire types shared with the host project endpoint. */
import type { Breakpoint, DesignChild, DesignScreenNode, Diagnostic, ResolvedToken } from '@filipeesch/dsh-design-core'

/** One screen in the project payload. */
export interface WireScreen {
  readonly id: string
  readonly file: string
  /** Current parsed tree, when parsing produced one. */
  readonly root?: DesignScreenNode
  /** Last tree that validated without errors. */
  readonly lastValidRoot?: DesignScreenNode
  readonly diagnostics: readonly Diagnostic[]
  readonly errors: number
  readonly warnings: number
}

/** Project payload returned by `_/project`. */
export interface ProjectPayload {
  readonly session: string
  readonly revision: number
  readonly config: {
    readonly kitVersion: string
    readonly breakpoints: readonly Breakpoint[]
    readonly entry?: string
  }
  readonly kitVersion: string
  readonly tokens: Readonly<Record<string, ResolvedToken>>
  readonly cssVariables: Readonly<Record<string, string>>
  readonly diagnostics: readonly Diagnostic[]
  readonly screens: readonly WireScreen[]
  /** Project-level fatal message, for example a kit version mismatch. */
  readonly projectError?: string
  /** Inline data URIs used by the self-contained deterministic document. */
  readonly assets?: Readonly<Record<string, string>>
}

/** Events payload from the SSE stream. */
export interface RevisionEvent {
  readonly rev: number
}

/** Every element id in a tree, plus radio group names. */
export function collectIds(
  node: DesignChild | DesignScreenNode | undefined,
  ids: Set<string>,
  radios: Set<string>,
): void {
  if (node === undefined || node.kind === 'text') return
  if (node.id !== undefined && node.id !== '') ids.add(node.id)
  if (node.type === 'Radio') {
    const name = node.props.name
    if (typeof name === 'string') radios.add(name)
  }
  for (const child of node.children) collectIds(child, ids, radios)
}
