/** Navigation references from already resolved and validated screen projections. */
import type { KitMetadata } from './metadata.ts'
import type { PreviewRelationship } from './preview.ts'
import { isInteraction } from './refs.ts'
import type { DesignChild, DesignElement, DesignScreenNode } from './types.ts'

interface NavigationReference {
  readonly node: DesignElement | DesignScreenNode
  readonly prop: string
  readonly target: string
}

function collectNavigation(root: DesignChild | DesignScreenNode, kit?: KitMetadata): NavigationReference[] {
  const references: NavigationReference[] = []
  const visit = (node: DesignChild | DesignScreenNode): void => {
    if (node.kind === 'text') return
    for (const [prop, value] of Object.entries(node.props)) {
      if (!isInteraction(value) || value.$interaction !== 'navigate' || typeof value.target !== 'string') continue
      // Event props are direct references. Values nested inside data (for
      // example a table cell) cannot trigger navigation.
      const event =
        kit === undefined
          ? /^on[A-Z]/.test(prop)
          : kit[node.type]?.props.some((field) => field.name === prop && field.kind === 'event') === true
      if (event) references.push({ node, prop, target: value.target })
    }
    for (const child of node.children) visit(child)
  }
  visit(root)
  return references
}

/** Unique declared navigation destinations, in source traversal order. */
export function navigationTargets(root: DesignChild | DesignScreenNode, kit?: KitMetadata): string[] {
  return [...new Set(collectNavigation(root, kit).map((reference) => reference.target))]
}

function actionLabel(node: NavigationReference['node'], target: string): string {
  for (const property of ['label', 'title']) {
    const value = node.props[property]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  const text = node.children.flatMap((child) => (child.kind === 'text' ? [child.value.trim()] : [])).filter(Boolean)
  return text.join(' ') || (node.id ?? 'Go to ' + target)
}

/**
 * One edge per resolved navigation reference. Its identity is the action's
 * address, not its text or destination, so editing either updates the edge.
 */
export function navigationRelationships(root: DesignScreenNode, kit?: KitMetadata): PreviewRelationship[] {
  return collectNavigation(root, kit).map(({ node, prop, target }) => {
    const identity = node.id === undefined || node.id === '' ? node.address.label : node.id
    return {
      id: 'prototype:' + JSON.stringify([root.id, identity, prop]),
      label: actionLabel(node, target),
      kind: 'prototype',
      from: { screen: root.id },
      to: { screen: target },
      ...(node.id === undefined || node.id === '' ? {} : { nodeId: node.id }),
    }
  })
}
