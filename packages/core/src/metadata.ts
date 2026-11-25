/** Component metadata contract shared by the kit, validator, catalog, and prompt. */
import type { TokenType } from './types.ts'

/** Value types a component prop may declare. */
export type PropKind =
  'string' | 'number' | 'boolean' | 'enum' | 'token' | 'event' | 'image' | 'css' | 'array' | 'object'

/** One prop declaration in component metadata. */
export interface PropMeta {
  readonly name: string
  readonly kind: PropKind
  /** Accepted values for `enum` props. */
  readonly values?: readonly string[]
  /** Token type required by a `token` prop. */
  readonly tokenType?: TokenType
  /** Whether the prop is required. */
  readonly required?: boolean
  /** Default value applied by the renderer when the prop is absent. */
  readonly default?: string | number | boolean
  /** One-line model-facing description. */
  readonly description: string
}

/** How children may be used by a component. */
export type ChildrenRule = 'none' | 'text' | 'elements' | 'any'

/** Metadata every kit component must publish. */
export interface ComponentMeta {
  readonly name: string
  /** One-line catalog description. */
  readonly description: string
  readonly category: 'layout' | 'content' | 'form' | 'navigation' | 'feedback' | 'overlay' | 'data'
  readonly tier: 1 | 2
  /** Whether the DSL requires an explicit id on this component. */
  readonly requiredId: boolean
  /** Whether the component responds to user input. */
  readonly interactive: boolean
  /** Whether the component is an overlay opened by interaction references. */
  readonly overlay: boolean
  /** Semantic role used by the rendered markup, when the element has one. */
  readonly role?: string
  readonly children: ChildrenRule
  readonly props: readonly PropMeta[]
  /** Minimal valid example used by catalog details and component tests. */
  readonly example: string
}

/** Component metadata keyed by component name. */
export type KitMetadata = Readonly<Record<string, ComponentMeta>>

/** Props every component accepts in addition to its own metadata. */
export const COMMON_PROPS: readonly PropMeta[] = [
  { name: 'id', kind: 'string', description: 'Stable node id; required on interactive, overlay, and targeted nodes.' },
  { name: 'css', kind: 'css', description: 'Raw CSS declarations scoped to this node; always reported as a warning.' },
]

/** Look up the props a component declares, including common props. */
export function propsOf(meta: ComponentMeta): readonly PropMeta[] {
  return [...COMMON_PROPS, ...meta.props]
}

/** Look up one prop by name. */
export function propOf(meta: ComponentMeta, name: string): PropMeta | undefined {
  return propsOf(meta).find((prop) => prop.name === name)
}
