/** Wire types shared with the host project endpoint. */
import type {
  Breakpoint,
  DesignChild,
  DesignScreenNode,
  Diagnostic,
  NamedState,
  PreviewMetadata,
  PreviewRelationship,
  ResolvedToken,
} from '@filipeesch/dsh-design-core'

/** One branch of a variant group inside the payload. */
export interface WireVariantBranch {
  readonly id: string
  readonly source: NamedState['source']
  readonly valid: boolean
  /** A previous valid snapshot is kept while the source branch is invalid. */
  readonly stale?: boolean
  /** Branch-local Screen states for whole-screen alternatives. */
  readonly states?: readonly NamedState[]
  readonly diagnostics: readonly Diagnostic[]
}

/** One validated variant group inside the payload. */
export interface WireVariantGroup {
  readonly id: string
  readonly path: string
  readonly chosen: string
  readonly source: NamedState['source']
  readonly parentPath?: string
  readonly parentBranch?: string
  readonly wholeScreen: boolean
  readonly branches: readonly WireVariantBranch[]
}

/** Effective variant selection of the current payload screen. */
export interface WireVariant {
  readonly group: string
  readonly path: string
  readonly branch: string
  readonly chosen: boolean
  readonly selection: Readonly<Record<string, string>>
}

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
  /** Blocking errors for the chosen projection; branch-only errors excluded. */
  readonly blockingErrors?: number
  /** Validated named initial states for this screen. */
  readonly states?: readonly NamedState[]
  /** Validated variant groups, including branch validity. */
  readonly variants?: readonly WireVariantGroup[]
  /** Effective branch selection, when the payload was resolved explicitly. */
  readonly variant?: WireVariant
  /** Effective chosen or explicit selection used to resolve this screen. */
  readonly effectiveSelection?: Readonly<Record<string, string>>
  /** True when the screen keeps a previous valid variant snapshot. */
  readonly variantStale?: boolean
}

export interface WireTheme {
  readonly tokens: Readonly<Record<string, ResolvedToken>>
  readonly cssVariables: Readonly<Record<string, string>>
  readonly colorScheme?: 'light' | 'dark'
  readonly stale?: boolean
}

/** Project payload returned by the project endpoint. */
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
  readonly preview?: PreviewMetadata
  readonly relationships?: readonly PreviewRelationship[]
  /** Project-level fatal message, for example a kit version mismatch. */
  readonly projectError?: string
  /** Inline data URIs used by the self-contained deterministic document. */
  readonly assets?: Readonly<Record<string, string>>
  /** Explicit selection failure, for example an unknown group or branch. */
  readonly variantError?: string
  readonly themes?: Readonly<Record<string, WireTheme>>
  readonly theme?: string
  readonly declaredThemes?: readonly string[]
  readonly initialState?: { readonly screen: string; readonly seed: NamedState }
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
