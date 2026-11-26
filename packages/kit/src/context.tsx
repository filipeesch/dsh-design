/** Environment shared by kit components: tokens, breakpoint, interaction state. */
import { createContext, useContext, type ReactNode } from 'react'
import type { Breakpoint, DesignChild, ResolvedToken } from '@filipeesch/dsh-design-core'

/** Interaction and rendering services supplied by the preview renderer. */
export interface DesignEnvironment {
  readonly tokens: Readonly<Record<string, ResolvedToken>>
  /** Breakpoints ordered from narrowest to widest. */
  readonly breakpoints: readonly Breakpoint[]
  readonly activeBreakpoint: string
  readonly deterministic: boolean
  /** Fixed clock in deterministic mode. */
  readonly now: () => number
  /** Render a design node through the interpreter. */
  readonly renderNode: (node: DesignChild) => ReactNode
  /** Render every element child of a node. */
  readonly renderChildren: (node: DesignChild) => ReactNode
  isOverlayOpen: (id: string) => boolean
  openOverlay: (id: string) => void
  closeOverlay: (id: string) => void
  toggleOverlay: (id: string) => void
  navigate: (screen: string) => void
  getValue: (id: string, fallback: unknown) => unknown
  setValue: (id: string, value: unknown) => void
  getTab: (id: string, fallback: string) => string
  setTab: (id: string, value: string) => void
  isDisclosureOpen: (id: string, fallback: boolean) => boolean
  setDisclosure: (id: string, expanded: boolean) => void
  /** Resolve a design-folder image path into a preview URL. */
  imageUrl: (path: string) => string
}

const fallbackEnvironment: DesignEnvironment = {
  tokens: {},
  breakpoints: [
    { name: 'mobile', width: 390 },
    { name: 'tablet', width: 768 },
    { name: 'desktop', width: 1280 },
  ],
  activeBreakpoint: 'desktop',
  deterministic: false,
  now: () => Date.now(),
  renderNode: () => null,
  renderChildren: () => null,
  isOverlayOpen: () => false,
  openOverlay: () => undefined,
  closeOverlay: () => undefined,
  toggleOverlay: () => undefined,
  navigate: () => undefined,
  getValue: (_id, fallback) => fallback,
  setValue: () => undefined,
  getTab: (_id, fallback) => fallback,
  setTab: () => undefined,
  isDisclosureOpen: (_id, fallback) => fallback,
  setDisclosure: () => undefined,
  imageUrl: (path) => path,
}

/** Context carrying the preview environment. */
export const DesignEnvironmentContext = createContext<DesignEnvironment>(fallbackEnvironment)

/** Read the current preview environment. */
export function useDesign(): DesignEnvironment {
  return useContext(DesignEnvironmentContext)
}
