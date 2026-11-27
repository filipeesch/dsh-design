import {
  COMMENT_DISCLOSURES_MAX,
  COMMENT_LABEL_MAX,
  COMMENT_OVERLAYS_MAX,
  COMMENT_TABS_MAX,
  resolveResponsive,
  type Breakpoint,
  type CommentContext,
  type DesignChild,
  type DesignElement,
  type DesignScreenNode,
} from '@filipeesch/dsh-design-core'
import { kitMetadata } from '@filipeesch/dsh-design-kit'
import type { PreviewState } from './state.ts'

/** Read safe coordinates from declared nodes, never from form values or arbitrary DOM text. */
export function collectReviewState(
  tree: DesignScreenNode | undefined,
  state: PreviewState,
  open: ReadonlySet<string>,
  breakpoints: readonly Breakpoint[],
  breakpoint: string,
): Pick<CommentContext, 'overlays' | 'tabs' | 'disclosures'> {
  const overlays: string[] = []
  const tabs: Record<string, string> = {}
  const disclosures: Record<string, boolean> = {}
  if (tree === undefined) return { tabs, disclosures }
  const visit = (node: DesignChild | DesignScreenNode): void => {
    if (node.kind === 'text') return
    const id = node.id
    if (id !== undefined && /^[a-z][a-z0-9-]*$/.test(id)) {
      const key = tree.id + '/' + id
      if (kitMetadata[node.type]?.overlay === true && open.has(id)) overlays.push(id)
      if (node.type === 'Disclosure' && Object.keys(disclosures).length < COMMENT_DISCLOSURES_MAX) {
        disclosures[id] =
          state.disclosures[key] ?? resolveResponsive(node.props.defaultOpen, breakpoints, breakpoint) === true
      }
      if (node.type === 'Tabs' && Object.keys(tabs).length < COMMENT_TABS_MAX) {
        const children = node.children.filter(
          (child): child is DesignElement => child.kind === 'element' && child.type === 'Tab',
        )
        const active = state.tabs[key] ?? resolveResponsive(node.props.value, breakpoints, breakpoint)
        const tab =
          (typeof active === 'string'
            ? children.find((child) => (child.id ?? child.address.label) === active || child.props.value === active)
            : undefined) ?? children[0]
        const value = tab?.id ?? tab?.props.value
        if (typeof value === 'string' && value.length <= COMMENT_LABEL_MAX) tabs[id] = value
      }
    }
    for (const child of node.children) visit(child)
  }
  visit(tree)
  return {
    // A truncated set would falsely close missing overlays in a temporary render.
    ...(overlays.length > COMMENT_OVERLAYS_MAX ? {} : { overlays: overlays.sort() }),
    tabs,
    disclosures,
  }
}
