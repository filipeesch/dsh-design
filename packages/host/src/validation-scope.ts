import { countDiagnostics, sortDiagnostics, type DesignProject, type Diagnostic } from '@filipeesch/dsh-design-core'

type Scope = 'project' | 'file' | 'screen'
export interface ValidationArgs {
  readonly scope?: Scope
  readonly file?: string
  readonly screen?: string
}
interface Counts {
  readonly scope: Scope
  readonly diagnostics: readonly Diagnostic[]
  readonly errors: number
  readonly warnings: number
}
export type ValidationResult = Counts | (Counts & { errorCode: 'invalid-selection'; error: string })

export function validateScope(
  project: DesignProject,
  { scope: requested, file, screen }: ValidationArgs,
): ValidationResult {
  const scope = requested ?? (file !== undefined ? 'file' : screen !== undefined ? 'screen' : 'project')
  const fail = (error: string): ValidationResult => ({
    scope,
    diagnostics: [],
    errors: 0,
    warnings: 0,
    errorCode: 'invalid-selection',
    error,
  })
  if (
    scope === 'file'
      ? file === undefined || screen !== undefined
      : scope === 'screen'
        ? screen === undefined || file !== undefined
        : file !== undefined || screen !== undefined
  ) {
    return fail('Provide only file, only screen, or no target for project scope.')
  }
  let selected = project.diagnostics
  if (scope === 'file' && file !== undefined) {
    if (!project.sourceFiles.includes(file))
      return fail('Unknown source file ' + JSON.stringify(file) + '. Use a path relative to the design folder.')
    selected = selected.filter((item) => item.file === file || (item.file === 'tokens.json' && file !== 'design.json'))
  }
  if (scope === 'screen') {
    const found = project.screens.find((item) => item.id !== '' && item.id === screen)
    if (found === undefined)
      return fail('Unknown screen ' + JSON.stringify(screen) + '. Discover screen IDs with design_status.')
    const dependencies = new Set([found.file, 'tokens.json', 'design.json', ...(found.sourceDependencies ?? [])])
    selected = selected.filter((item) => dependencies.has(item.file))
  }
  return { scope, diagnostics: sortDiagnostics(selected), ...countDiagnostics(selected) }
}
