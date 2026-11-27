/** Immutable provenance injected while packaging the running modules. */
export interface BuildIdentity {
  readonly id: string
  readonly version?: string
}

declare const __DSH_DESIGN_BUILD__: BuildIdentity | undefined

export const runningDesignBuild: BuildIdentity = Object.freeze(
  typeof __DSH_DESIGN_BUILD__ === 'undefined' ? { id: 'development-source' } : __DSH_DESIGN_BUILD__,
)
