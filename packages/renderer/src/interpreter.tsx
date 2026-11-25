/** Design tree interpreter: design node to kit component. */
import type { ReactNode } from 'react'
import type { DesignChild, DesignScreenNode } from '@filipeesch/dsh-design-core'
import { kitComponents } from '@filipeesch/dsh-design-kit'
import type { DesignComponentProps } from '@filipeesch/dsh-design-kit'

/** Render one child node. */
export function renderNode(node: DesignChild | DesignScreenNode): ReactNode {
  if (node.kind === 'text') return node.value
  const Component = kitComponents[node.type as keyof typeof kitComponents]
  const children = node.children.map((child) => renderNode(child))
  if (Component === undefined) {
    return (
      <div
        data-dsx-unknown={node.type}
        style={{ padding: 8, border: '1px dashed #dc2626', color: '#991b1b', fontFamily: 'monospace', fontSize: 12 }}
      >
        Unknown component: {node.type}
      </div>
    )
  }
  const props: DesignComponentProps = { node, children }
  return <Component key={node.id ?? node.address.label} {...props} />
}

export type { DesignChild }
