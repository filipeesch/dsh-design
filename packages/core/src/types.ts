/**
 * Design tree, source, and token types shared by the parser, validator,
 * project loader, agent tools, and the browser renderer.
 */

/** One configured breakpoint name, such as `mobile` or `desktop`. */
export type BreakpointName = string

/** Interaction verbs accepted by the DSL. */
export type InteractionAction = 'open' | 'close' | 'toggle' | 'navigate'

/** One interaction reference, for example `open("filters")`. */
export interface InteractionRef {
  readonly $interaction: InteractionAction
  readonly target: string
}

/** Value stored on a design node after parsing. */
export type DesignPropValue =
  string | number | boolean | null | InteractionRef | DesignPropValue[] | { [key: string]: DesignPropValue }

/** Props by name, in source order. */
export type DesignProps = Record<string, DesignPropValue>

/** One position in a screen file, 1-based line and column. */
export interface SourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly endLine?: number
  readonly endColumn?: number
}

/**
 * Stable-by-construction position of a node in its screen tree. A structural
 * address changes when siblings move, so tools label it unstable.
 */
export interface StructuralAddress {
  /** Child indices from the screen root; empty for the root itself. */
  readonly path: readonly number[]
  /** Human form, for example `#0.2`. */
  readonly label: string
}

/** Literal text child of a design node. */
export interface DesignText {
  readonly kind: 'text'
  readonly value: string
  readonly source: SourceLocation
}

/** Shared shape of every design element. */
export interface DesignElement {
  readonly kind: 'element'
  /** Kit component name, for example `Button`. */
  readonly type: string
  /** Explicit DSL id, present only when the source declares `id`. */
  readonly id?: string
  readonly props: DesignProps
  readonly children: readonly DesignChild[]
  readonly source: SourceLocation
  readonly address: StructuralAddress
}

/** A parsed design screen; `type` is always `Screen`. */
export interface DesignScreenNode {
  readonly kind: 'element'
  readonly type: 'Screen'
  readonly id: string
  readonly props: DesignProps
  readonly children: readonly DesignChild[]
  readonly source: SourceLocation
  readonly address: StructuralAddress
}

/** One child of a design node. */
export type DesignChild = DesignElement | DesignText

/** A parsed screen file. */
export interface ParsedScreen {
  readonly file: string
  readonly root?: DesignScreenNode
  readonly diagnostics: readonly Diagnostic[]
}

/** Severity of one validation diagnostic. */
export type DiagnosticSeverity = 'error' | 'warning'

/** One validation diagnostic with source position and optional guidance. */
export interface Diagnostic {
  readonly severity: DiagnosticSeverity
  /** Stable machine code, for example `unknown-component`. */
  readonly code: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly message: string
  /** Explicit node id when the source declared one. */
  readonly nodeId?: string
  /** Structural address when the diagnostic concerns a node. */
  readonly address?: string
  /** Suggested correction, when the validator can compute one. */
  readonly suggestion?: string
}

/** One design token after alias expansion. */
export interface ResolvedToken {
  readonly path: string
  readonly type: TokenType
  readonly value: string | number
  readonly cssVar: string
}

/** Supported W3C design-token types in this subset. */
export type TokenType = 'color' | 'dimension' | 'fontFamily' | 'fontWeight' | 'number' | 'shadow' | 'duration'

/** Resolved token table of a project. */
export interface ResolvedTokens {
  /** Tokens by dotted path. */
  readonly tokens: Readonly<Record<string, ResolvedToken>>
  /** CSS custom-property declarations for a frame root. */
  readonly cssText: string
  readonly diagnostics: readonly Diagnostic[]
}

/** One project breakpoint. */
export interface Breakpoint {
  readonly name: BreakpointName
  readonly width: number
}

/** Project configuration after defaults are applied. */
export interface DesignConfig {
  /** Kit version range pinned by the project. */
  readonly kitVersion: string
  readonly breakpoints: readonly Breakpoint[]
  /** Entry screen id, or undefined to use the alphabetically first screen. */
  readonly entry?: string
}

/** One screen in a loaded project. */
export interface ProjectScreen {
  readonly id: string
  readonly file: string
  /** Parsed tree when parsing produced a root. */
  readonly root?: DesignScreenNode
  readonly diagnostics: readonly Diagnostic[]
  /** Last tree that validated without errors; undefined when none did. */
  readonly lastValidRoot?: DesignScreenNode
}

/** A loaded and validated design project. */
export interface DesignProject {
  readonly folder: string
  readonly config: DesignConfig
  readonly tokens: ResolvedTokens
  readonly screens: readonly ProjectScreen[]
  readonly diagnostics: readonly Diagnostic[]
  /** Alphabetically first screen id, used when config.entry is absent. */
  readonly entry: string | undefined
}

/** One unresolved token before alias expansion. */
export interface RawToken {
  readonly path: string
  readonly type: TokenType
  readonly value: unknown
  readonly source: SourceLocation
}
