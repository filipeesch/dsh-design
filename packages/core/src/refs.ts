/** Runtime predicates for the DSL's declarative references. */
import type { DesignPropValue, FixtureRef, InteractionRef, ItemRef } from './types.ts'

/** Whether a value is one parsed interaction reference. */
export function isInteraction(value: unknown): value is InteractionRef {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && '$interaction' in value
}

/** Whether a value is one fixture collection reference. */
export function isFixtureRef(value: unknown): value is FixtureRef {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && '$fixture' in value
}

/** Whether a value is one template field reference. */
export function isItemRef(value: unknown): value is ItemRef {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && '$item' in value
}

/** Whether a prop value is any declarative call reference. */
export function isReference(value: unknown): value is InteractionRef | FixtureRef | ItemRef {
  return isInteraction(value) || isFixtureRef(value) || isItemRef(value)
}

/** Format one declarative reference as DSL text, for diagnostics and views. */
export function formatReference(value: InteractionRef | FixtureRef | ItemRef): string {
  if (isInteraction(value)) return value.$interaction + '("' + value.target + '")'
  if (isFixtureRef(value)) return 'fixture("' + value.$fixture + '")'
  return 'item("' + value.$item + '")'
}

/** Type guard helper used by expansion before indexing a reference. */
export function isDesignObject(value: DesignPropValue): value is { [key: string]: DesignPropValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !isReference(value)
}
