/** Static, browser-free query over the validated design tree. */
import type { DesignChild, DesignElement, DesignProject, DesignScreenNode } from '@filipeesch/dsh-design-core'

/** One static query match. */
export interface QueryMatch {
  readonly screen: string
  readonly node: string
  readonly address: string
  readonly component: string
  readonly file: string
  readonly line: number
  readonly column: number
}

/** Options accepted by {@link queryDesign}. */
export interface QueryOptions {
  readonly screen?: string
  readonly component?: string
  readonly prop?: string
  readonly value?: string | number | boolean
  readonly id?: string
  readonly limit?: number
}

/** Result of one static query. */
export interface QueryResult {
  readonly matches: readonly QueryMatch[]
  readonly total: number
  readonly truncated: boolean
}

/** Maximum matches returned by one query. */
export const MAX_QUERY_MATCHES = 200
const DEFAULT_QUERY_MATCHES = 100

/** Convert an id glob with only `*` and `?` into an anchored regular expression. */
function idPattern(glob: string): RegExp {
  let source = '^'
  for (const character of glob) {
    if (character === '*') source += '.*'
    else if (character === '?') source += '.'
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(source + '$')
}

function identityOf(node: DesignElement | DesignScreenNode): string | undefined {
  return node.id === undefined || node.id === '' ? undefined : node.id
}

/**
 * Filter the validated project tree by screen, component, exact scalar prop,
 * and stable id glob. Ordering is stable screen and tree order.
 */
export function queryDesign(project: DesignProject, options: QueryOptions = {}): QueryResult {
  const limit = Math.min(MAX_QUERY_MATCHES, Math.max(1, Math.floor(options.limit ?? DEFAULT_QUERY_MATCHES)))
  const pattern = options.id === undefined ? undefined : idPattern(options.id)
  const matches: QueryMatch[] = []
  let total = 0
  const screens =
    options.screen === undefined ? project.screens : project.screens.filter((screen) => screen.id === options.screen)
  for (const screen of screens) {
    if (screen.root === undefined) continue
    const visit = (child: DesignChild): void => {
      if (child.kind === 'text') return
      const identity = identityOf(child)
      const matchesId = pattern === undefined || (identity !== undefined && pattern.test(identity))
      const matchesComponent = options.component === undefined || child.type === options.component
      const matchesProp =
        options.prop === undefined ||
        (Object.prototype.hasOwnProperty.call(child.props, options.prop) && child.props[options.prop] === options.value)
      if (matchesId && matchesComponent && matchesProp) {
        total += 1
        if (matches.length < limit) {
          matches.push({
            screen: screen.id,
            node: identity ?? child.address.label,
            address: child.address.label,
            component: child.type,
            file: child.source.file,
            line: child.source.line,
            column: child.source.column,
          })
        }
      }
      for (const nested of child.children) visit(nested)
    }
    visit(screen.root)
  }
  return { matches, total, truncated: total > matches.length }
}
