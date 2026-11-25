/** Interaction references executed by the preview renderer. */
import { isInteraction, type DesignElement, type InteractionRef } from '@filipeesch/dsh-design-core'
import { useDesign } from './context.tsx'

/** Execute one interaction reference against the environment. */
export function runInteraction(ref: InteractionRef): void {
  const env = useDesign()
  switch (ref.$interaction) {
    case 'open':
      env.openOverlay(ref.target)
      break
    case 'close':
      env.closeOverlay(ref.target)
      break
    case 'toggle':
      env.toggleOverlay(ref.target)
      break
    case 'navigate':
      env.navigate(ref.target)
      break
  }
}

/** Read a declared event prop as an interaction reference. */
export function useInteraction(node: DesignElement, name: string): InteractionRef | undefined {
  const value = node.props[name]
  return isInteraction(value) ? value : undefined
}

/** Return a click handler for an event prop, or a no-op when absent. */
export function useAct(node: DesignElement, name: string): () => void {
  const env = useDesign()
  const ref = useInteraction(node, name)
  return () => {
    if (ref === undefined) return
    switch (ref.$interaction) {
      case 'open':
        env.openOverlay(ref.target)
        break
      case 'close':
        env.closeOverlay(ref.target)
        break
      case 'toggle':
        env.toggleOverlay(ref.target)
        break
      case 'navigate':
        env.navigate(ref.target)
        break
    }
  }
}
