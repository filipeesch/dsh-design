/** Compact DSL guidance for the `design` preset (under 6,000 characters). */
import { designPrompt as buildDesignPrompt } from '@filipeesch/dsh-design-core'
import { componentNames } from '@filipeesch/dsh-design-kit/meta'

/**
 * Build the design prompt section. It points at `design_catalog` for prop
 * details instead of embedding per-component prop tables.
 */
export function designPrompt(): string {
  return buildDesignPrompt(componentNames)
}
