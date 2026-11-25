/**
 * Content fingerprint for a rendered design tree.
 *
 * Structural anchors cannot trust a numeric project revision: the host evicts an
 * idle ProjectRuntime and a fresh runtime counts from revision 1 again. A
 * canonical, content-derived fingerprint distinguishes an unchanged screen from
 * a same-address replacement without depending on process or runtime lifetime.
 */
import type { DesignChild, DesignElement, DesignScreenNode } from './types.ts'

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const ordered: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) ordered[key] = canonicalValue(record[key])
    return ordered
  }
  return value
}

function canonicalNode(node: DesignChild | DesignScreenNode): unknown {
  if (node.kind === 'text') {
    return { kind: 'text', value: node.value, itemField: node.itemField ?? null }
  }
  const element = node as DesignElement | DesignScreenNode
  return {
    kind: 'element',
    type: element.type,
    id: element.id ?? null,
    address: element.address.label,
    props: canonicalValue(element.props),
    children: element.children.map(canonicalNode),
  }
}

function fnv1a(value: string, seed: number): number {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, '0')
}

/**
 * Compute a stable content fingerprint for one screen root.
 *
 * The fingerprint ignores source locations, prop insertion order, the project
 * revision, breakpoints, and interaction state. It changes when rendered
 * content, component identity, props, text, or child order changes.
 * @param root - parsed screen root actually rendered by the preview.
 * @returns a bounded fingerprint string suitable for a structural anchor.
 */
export function fingerprintDesignTree(root: DesignScreenNode): string {
  const canonical = JSON.stringify(canonicalNode(root))
  return (
    'fp-' +
    hex8(fnv1a(canonical, 0x811c9dc5)) +
    hex8(fnv1a(canonical, 0x9e3779b9)) +
    '-' +
    canonical.length.toString(16)
  )
}
