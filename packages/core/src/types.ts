/**
 * Design tree, source, and token types shared by the parser, validator,
 * project loader, agent tools, and the browser renderer.
 */

import type { CssBlock } from './stylesheets.ts'
import type { PreviewMetadata } from './preview.ts'

/** One configured breakpoint name, such as `mobile` or `desktop`. */
export type BreakpointName = string

/** Interaction verbs accepted by the DSL. */
export type InteractionAction = 'open' | 'close' | 'toggle' | 'navigate'

/** One interaction reference, for example `open("filters")`. */
export interface InteractionRef {
  readonly $interaction: InteractionAction
  readonly target: string
}

/** One declarative fixture binding, for example `fixture("orders")`. */
export interface FixtureRef {
  readonly $fixture: string
}

/** One declarative template field reference, for example `item("name")`. */
export interface ItemRef {
  readonly $item: string
}

/** Value stored on a design node after parsing. */
export type DesignPropValue =
  | string
  | number
  | boolean
  | null
  | InteractionRef
  | FixtureRef
  | ItemRef
  | DesignPropValue[]
  | { [key: string]: DesignPropValue }

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

/** Literal text child of a design node, or a template field placeholder. */
export interface DesignText {
  readonly kind: 'text'
  readonly value: string
  readonly source: SourceLocation
  /** Template field whose value replaces this text during fixture expansion. */
  readonly itemField?: string
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
  /** Validated shared declarations, in cascade order before node CSS. */
  readonly classCss?: CssBlock
  /** Source position of each attribute, used for metadata diagnostics. */
  readonly propLocations?: Readonly<Record<string, SourceLocation>>
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
  /** Validated shared declarations, in cascade order before node CSS. */
  readonly classCss?: CssBlock
  /** Source position of each attribute, used for metadata diagnostics. */
  readonly propLocations?: Readonly<Record<string, SourceLocation>>
}

/** One child of a design node. */
export type DesignChild = DesignElement | DesignText

/** A parsed screen file. */
export interface ParsedScreen {
  readonly file: string
  /** Resolved root when the file is an ordinary Screen. */
  readonly root?: DesignScreenNode
  /** Raw root document, which may be a whole-screen Variants wrapper. */
  readonly document?: DesignScreenNode | DesignElement
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
  /** Variant group path when the diagnostic belongs to one group's projection. */
  readonly group?: string
  /** Variant branch id when the diagnostic belongs to one branch projection. */
  readonly branch?: string
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
  readonly themes?: Readonly<Record<string, string>>
  readonly defaultTheme?: string
  readonly stylesheets?: readonly string[]
}

/** The effective, typed token palette for one canvas. */
export interface ResolvedTheme {
  readonly name: string
  readonly tokens: ResolvedTokens
  readonly colorScheme?: 'light' | 'dark'
}

/** One branch of a variant group, with its validated projection state. */
export interface VariantBranchInfo {
  readonly id: string
  readonly source: SourceLocation
  /** Whether the projection choosing this branch validates without errors. */
  readonly valid: boolean
  /** True when a previous valid snapshot is kept after an invalid edit. */
  readonly stale?: boolean
  /** Branch-local Screen states for a whole-screen alternative. */
  readonly states?: readonly NamedState[]
  /** Diagnostics produced by this branch's own projection. */
  readonly diagnostics: readonly Diagnostic[]
}

/** Last valid expanded inputs for one branch projection. */
export interface VariantProjectionSnapshot {
  /** Expanded tree with the Screen states prop stripped. */
  readonly root: DesignScreenNode
  /** Named states validated against this projection. */
  readonly states: readonly NamedState[]
  /** Effective selection used to resolve this snapshot. */
  readonly selection: Readonly<Record<string, string>>
  /** Fixture collections used to expand this snapshot. */
  readonly fixtures: FixtureCollections
  /** Render diagnostics of this exact projection, without branch tags. */
  readonly diagnostics: readonly Diagnostic[]
}

/** One validated variant group discovered in a screen source. */
export interface VariantGroupInfo {
  readonly id: string
  /** Screen-local group path used in routes and selections. */
  readonly path: string
  readonly chosen: string
  readonly source: SourceLocation
  readonly parentPath?: string
  readonly parentBranch?: string
  readonly wholeScreen: boolean
  readonly branches: readonly VariantBranchInfo[]
}

/** One screen in a loaded project. */
export interface ProjectScreen {
  readonly id: string
  readonly file: string
  /** Shared source dependencies found in the screen document and its branches. */
  readonly sourceDependencies?: readonly string[]
  /** Parsed tree when parsing produced a root. */
  readonly root?: DesignScreenNode
  readonly diagnostics: readonly Diagnostic[]
  /** Last tree that validated without errors; undefined when none did. */
  readonly lastValidRoot?: DesignScreenNode
  /** Validated named states belonging to the current (or last valid) tree. */
  readonly states: readonly NamedState[]
  /** Validated groups, including branch projection diagnostics. */
  readonly variants?: readonly VariantGroupInfo[]
  /** Raw document (current when structurally valid, otherwise last valid). */
  readonly variantDocument?: DesignScreenNode | DesignElement
  /** Fixtures paired with variantDocument; never mix old source with new fixtures. */
  readonly variantFixtures?: FixtureCollections
  /** Last valid expanded snapshot per group/branch, keyed by path|branch. */
  readonly variantSnapshots?: Readonly<Record<string, VariantProjectionSnapshot>>
  /** True when the variant document/snapshots come from a previous valid load. */
  readonly variantStale?: boolean
  /** Whether variantDocument is the current source (false when retained). */
  readonly variantDocumentCurrent?: boolean
  /** Effective chosen-branch selection for this screen. */
  readonly chosenSelection?: Readonly<Record<string, string>>
  /** Errors that block the chosen projection; branch-only errors do not. */
  readonly blockingErrors?: number
}

/** One value assignable by a named screen state. */
export type DesignStateValue = string | number | boolean | readonly string[]

/** One validated named screen state. */
export interface NamedState {
  readonly name: string
  readonly open: readonly string[]
  readonly tabs: Readonly<Record<string, string>>
  readonly values: Readonly<Record<string, DesignStateValue>>
  /** Expansion seeds for resolved Disclosure ids, separate from overlays and field values. */
  readonly disclosures?: Readonly<Record<string, boolean>>
  readonly source: SourceLocation
}

/** A loaded and validated design project. */
export interface DesignProject {
  readonly folder: string
  readonly config: DesignConfig
  readonly tokens: ResolvedTokens
  /** Current validated palettes only, including base when its tokens are valid. */
  readonly themes: Readonly<Record<string, ResolvedTheme>>
  readonly defaultTheme: string
  /** Preview-only recovery for still-declared palettes; never used by checks. */
  readonly lastValidThemes: Readonly<Record<string, ResolvedTheme>>
  /** Content identity of the source inventory, excluding render assets. */
  readonly sourceIdentity: string
  /** Present design-relative source paths in the current inventory. */
  readonly sourceFiles: readonly string[]
  readonly screens: readonly ProjectScreen[]
  readonly diagnostics: readonly Diagnostic[]
  /** Alphabetically first screen id, used when config.entry is absent. */
  readonly entry: string | undefined
  /** Validated project-local fixture collections. */
  readonly fixtures: Readonly<Record<string, FixtureCollection>>
  /** Parsed journey files, including invalid ones and their diagnostics. */
  readonly journeys: readonly ProjectJourney[]
  /** Validated review context, separate from the canvas projection. */
  readonly preview?: PreviewMetadata
}

/** One fixture item: a stable key and flat scalar fields. */
export interface FixtureItem {
  readonly id: string
  readonly fields: Readonly<Record<string, string | number | boolean>>
}

/** One validated fixture collection read from `fixtures/<id>.json`. */
export interface FixtureCollection {
  readonly id: string
  readonly file: string
  readonly items: readonly FixtureItem[]
}

/** All fixture collections of a project. */
export type FixtureCollections = Readonly<Record<string, FixtureCollection>>

/** One journey action or assertion, in source order. */
export type JourneyStep =
  | {
      readonly kind: 'tap'
      readonly target: string
      readonly part?: 'primary' | 'menu'
      readonly source: SourceLocation
    }
  | { readonly kind: 'type'; readonly target: string; readonly value: string; readonly source: SourceLocation }
  | {
      readonly kind: 'choose'
      readonly target: string
      readonly part?: 'menu'
      readonly value: string
      readonly source: SourceLocation
    }
  | { readonly kind: 'navigate'; readonly screen: string; readonly source: SourceLocation }
  | { readonly kind: 'expect-screen'; readonly screen: string; readonly source: SourceLocation }
  | {
      readonly kind: 'expect-visible'
      readonly target: string
      readonly visible: boolean
      readonly source: SourceLocation
    }
  | { readonly kind: 'expect-value'; readonly target: string; readonly value: string; readonly source: SourceLocation }
  | { readonly kind: 'expect-count'; readonly target: string; readonly count: number; readonly source: SourceLocation }

/** One parsed journey file. */
export interface ParsedJourney {
  readonly file: string
  readonly journey?: {
    readonly id: string
    readonly start: string
    readonly state?: string
    readonly breakpoint?: string
    readonly theme?: string
    readonly steps: readonly JourneyStep[]
    readonly source: SourceLocation
  }
  readonly diagnostics: readonly Diagnostic[]
}

/** One journey in a loaded project, parsed and validated. */
export interface ProjectJourney {
  readonly file: string
  readonly id: string
  readonly journey?: ParsedJourney['journey']
  readonly diagnostics: readonly Diagnostic[]
}

/** One unresolved token before alias expansion. */
export interface RawToken {
  readonly path: string
  readonly type: TokenType
  readonly value: unknown
  readonly source: SourceLocation
}
