/** One preview document state shared by the project endpoint and deterministic shell. */
import { countDiagnostics, type DesignProject } from '@filipeesch/dsh-design-core'

/** Serialized project state consumed by the renderer. */
export interface PreviewPayload {
  readonly session: string
  readonly revision: number
  readonly config: {
    readonly kitVersion: string
    readonly breakpoints: readonly { readonly name: string; readonly width: number }[]
    readonly entry?: string
  }
  readonly kitVersion: string
  readonly tokens: Record<string, unknown>
  readonly cssVariables: Record<string, string>
  readonly diagnostics: readonly unknown[]
  readonly screens: readonly unknown[]
  readonly projectError?: string
  readonly assets?: Record<string, string>
}

/** Build the payload, omitting any root that still has errors. */
export function buildPayload(
  session: string,
  revision: number,
  kitVersion: string,
  project: DesignProject,
  assets?: Record<string, string>,
): PreviewPayload {
  const screens = project.screens
    .filter((screen) => screen.id !== '')
    .map((screen) => {
      const counts = countDiagnostics(screen.diagnostics)
      const valid = counts.errors === 0 && screen.root !== undefined
      return {
        id: screen.id,
        file: screen.file,
        root: valid ? screen.root : undefined,
        lastValidRoot: screen.lastValidRoot,
        diagnostics: screen.diagnostics,
        errors: counts.errors,
        warnings: counts.warnings,
        states: screen.states,
      }
    })
  const tokens = project.tokens.tokens
  const cssVariables: Record<string, string> = {}
  for (const token of Object.values(tokens)) cssVariables[token.cssVar] = String(token.value)
  const fatal = project.diagnostics.find(
    (diagnostic) =>
      diagnostic.severity === 'error' &&
      (diagnostic.file === 'design.json' ||
        diagnostic.file === 'tokens.json' ||
        diagnostic.code === 'kit-version-mismatch' ||
        diagnostic.code === 'project-missing'),
  )
  return {
    session,
    revision,
    config: {
      kitVersion: project.config.kitVersion,
      breakpoints: project.config.breakpoints,
      ...(project.config.entry === undefined ? {} : { entry: project.config.entry }),
    },
    kitVersion,
    tokens,
    cssVariables,
    diagnostics: project.diagnostics,
    screens,
    ...(fatal === undefined ? {} : { projectError: fatal.message }),
    ...(assets === undefined ? {} : { assets }),
  }
}
