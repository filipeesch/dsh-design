/** Resolve a chosen or explicitly selected variant projection for tools and checks. */
import {
  countDiagnostics,
  findNamedState,
  formatDiagnostic,
  stateCompatibility,
  type DesignProject,
  type Diagnostic,
  type NamedState,
  type ProjectScreen,
} from '@filipeesch/dsh-design-core'
import { kitMetadata } from '@filipeesch/dsh-design-kit/meta'

/** One effective variant identity carried by a tool result. */
export interface ResolvedVariant {
  readonly group: string
  readonly path: string
  readonly branch: string
  readonly chosen: boolean
  readonly selection: Readonly<Record<string, string>>
}

/** A screen projected through an optional variant selection. */
export interface ResolvedProjection {
  readonly screen: ProjectScreen
  readonly variant?: ResolvedVariant
  readonly diagnostics: readonly Diagnostic[]
}

/** Parse a tool-level variant argument (group:branch) with a bounded shape. */
export function parseVariantArgument(value: string | undefined): { group: string; branch: string } | undefined {
  if (value === undefined) return undefined
  const index = value.lastIndexOf(':')
  if (index <= 0 || index === value.length - 1) {
    throw new Error('variant must be "group:branch", for example "layout:spacious".')
  }
  return { group: value.slice(0, index), branch: value.slice(index + 1) }
}

/**
 * Project one screen, either as chosen or through an explicit branch.
 * @param project - loaded project.
 * @param screenId - screen id.
 * @param variant - optional group:branch selection.
 */
export function resolveScreenProjection(
  project: DesignProject,
  screenId: string,
  variant?: string,
): ResolvedProjection {
  const screen = project.screens.find((candidate) => candidate.id === screenId)
  if (screen === undefined || screen.id === '') throw new Error('Unknown screen "' + screenId + '".')
  const parsed = parseVariantArgument(variant)
  if (parsed === undefined) return { screen, diagnostics: screen.diagnostics }
  if (screen.variantDocumentCurrent !== true) {
    throw new Error(
      'Screen "' +
        screenId +
        '" currently has validation errors; the preview keeps the last valid projection, but current tool checks do not use retained variant data.',
    )
  }
  const groups = screen.variants ?? []
  const group = groups.find((candidate) => candidate.path === parsed.group)
  if (group === undefined) {
    throw new Error(
      'Screen "' +
        screenId +
        '" does not declare variant group "' +
        parsed.group +
        '". Known groups: ' +
        (groups.map((candidate) => candidate.path).join(', ') || 'none') +
        '.',
    )
  }
  const branch = group.branches.find((candidate) => candidate.id === parsed.branch)
  if (branch === undefined) {
    throw new Error(
      'Group "' +
        group.path +
        '" does not declare branch "' +
        parsed.branch +
        '". Known branches: ' +
        group.branches.map((candidate) => candidate.id).join(', ') +
        '.',
    )
  }
  if (!branch.valid) {
    const first = branch.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
    throw new Error(
      'Variant group "' +
        group.path +
        '" branch "' +
        branch.id +
        '" has validation errors; fix them first.' +
        (first === undefined
          ? ''
          : ' First error: ' +
            first.file +
            ':' +
            String(first.line) +
            ':' +
            String(first.column) +
            ' ' +
            first.message),
    )
  }
  const snapshot = screen.variantSnapshots?.[group.path + '|' + branch.id]
  if (snapshot === undefined || branch.stale === true) {
    throw new Error('Variant projection has no valid current snapshot.')
  }
  const diagnostics = snapshot.diagnostics
  return {
    screen: {
      ...screen,
      root: snapshot.root,
      states: snapshot.states,
      blockingErrors: 0,
      diagnostics,
    },
    variant: {
      group: group.id,
      path: group.path,
      branch: branch.id,
      chosen: branch.id === group.chosen,
      selection: snapshot.selection,
    },
    diagnostics,
  }
}

/** Test the chosen tree, independent of retained snapshots for other branches. */
export function hasCurrentProjection(screen: ProjectScreen): boolean {
  return screen.root !== undefined && (screen.blockingErrors ?? countDiagnostics(screen.diagnostics).errors) === 0
}

/** Resolve a projection suitable for current queries and browser evidence. */
export function requireCurrentProjection(project: DesignProject, id: string, variant?: string): ResolvedProjection {
  const projection = resolveScreenProjection(project, id, variant)
  const { screen } = projection
  if (hasCurrentProjection(screen)) return projection
  const first =
    screen.diagnostics.find((diagnostic) => diagnostic.severity === 'error' && diagnostic.branch === undefined) ??
    screen.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
  throw new Error(
    'Screen "' +
      id +
      '" ' +
      (screen.root === undefined && first === undefined
        ? 'has no parsed tree; fix its diagnostics first.'
        : 'has validation errors; fix them first.' +
          (first === undefined ? '' : ' First error: ' + formatDiagnostic(first))),
  )
}

/** Resolve a named state against one projection, reporting incompatible targets. */
export function compatibleState(
  screen: ProjectScreen,
  states: readonly NamedState[],
  state: string | undefined,
): NamedState | undefined {
  if (state === undefined) return undefined
  const named = findNamedState(states, state)
  if (named === undefined) throw new Error('Screen "' + screen.id + '" does not declare state "' + state + '".')
  if (screen.root === undefined) throw new Error('Screen "' + screen.id + '" has no renderable tree.')
  const issues = stateCompatibility(screen.root, named, kitMetadata)
  if (issues.length > 0) {
    throw new Error('State "' + state + '" is incompatible with this projection: ' + issues.join('; ') + '.')
  }
  return named
}
