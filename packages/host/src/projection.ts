/** Resolve a chosen or explicitly selected variant projection for tools and checks. */
import {
  countDiagnostics,
  expandScreen,
  extractNamedStates,
  findNamedState,
  resolveVariantDocument,
  stateCompatibility,
  validateTree,
  type DesignProject,
  type Diagnostic,
  type NamedState,
  type ProjectScreen,
} from '@filipeesch/dsh-design-core'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'

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
  if (value === undefined || value === '') return undefined
  const index = value.lastIndexOf(':')
  if (index <= 0 || index === value.length - 1) {
    throw new Error('variant must be "group:branch", for example "layout:spacious".')
  }
  return { group: value.slice(0, index), branch: value.slice(index + 1) }
}

function projectionContext(project: DesignProject) {
  return {
    kit: kitMetadata,
    tokens: project.tokens.tokens,
    breakpoints: project.config.breakpoints.map((breakpoint) => breakpoint.name),
    projectScreens: project.screens.filter((screen) => screen.id !== '').map((screen) => screen.id),
    designFolder: project.folder,
    kitVersionPin: project.config.kitVersion,
    installedKitVersion: KIT_VERSION,
  }
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
  const document = screen.variantDocument ?? screen.root
  if (document === undefined) throw new Error('Screen "' + screenId + '" has no parsed document to project.')
  const resolution = resolveVariantDocument(document, { [group.path]: branch.id })
  if (resolution.screen === undefined) {
    const first = resolution.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
    throw new Error('Variant projection failed: ' + (first?.message ?? 'the document did not resolve.'))
  }
  const expanded = expandScreen(resolution.screen, screen.variantFixtures ?? project.fixtures, screen.file)
  const states = extractNamedStates(expanded.root, screen.file, kitMetadata)
  const semantic = validateTree(states.root, screen.file, projectionContext(project))
  const wholeScreen = document.type === 'Variants'
  const diagnostics = [
    ...resolution.diagnostics,
    ...expanded.diagnostics,
    ...(wholeScreen ? states.diagnostics : []),
    ...semantic,
  ]
  const errors = countDiagnostics(diagnostics).errors
  if (errors > 0) {
    const first = diagnostics.find((diagnostic) => diagnostic.severity === 'error')
    throw new Error(
      'Variant group "' +
        group.path +
        '" branch "' +
        branch.id +
        '" is invalid: ' +
        (first === undefined
          ? 'unknown error'
          : first.file + ':' + String(first.line) + ':' + String(first.column) + ' ' + first.message),
    )
  }
  return {
    screen: {
      ...screen,
      root: states.root,
      ...(wholeScreen ? { states: states.states } : {}),
      blockingErrors: 0,
      diagnostics,
    },
    variant: {
      group: group.id,
      path: group.path,
      branch: branch.id,
      chosen: branch.id === group.chosen,
      selection: resolution.selection,
    },
    diagnostics,
  }
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
