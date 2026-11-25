/** Public surface of the design component kit. */
export { KIT_VERSION, kitMetadata, componentNames } from './metadata.ts'
export { DesignEnvironmentContext, useDesign, type DesignEnvironment } from './context.tsx'
export { kitComponents, type KitComponentName } from './registry.ts'
export type { DesignComponentProps } from './primitives.tsx'
export * from './styles.ts'
export * from './interactions.ts'
