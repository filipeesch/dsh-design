/** One preview document state shared by the project endpoint and deterministic shell. */
import {
  collectVariantGroups,
  countDiagnostics,
  expandScreen,
  extractNamedStates,
  navigationRelationships,
  PREVIEW_METADATA_FILE,
  resolveVariantDocument,
  type DesignProject,
  type PreviewMetadata,
  type PreviewRelationship,
  type NamedState,
  type ProjectScreen,
  type ResolvedToken,
} from '@filipeesch/dsh-design-core'
import { kitMetadata } from '@filipeesch/dsh-design-kit/meta'

/** One explicit branch projection requested by a preview URL. */
export interface PayloadVariantRequest {
  readonly screen: string
  readonly group: string
  readonly branch: string
}

/** Effective variant selection carried by one payload screen. */
export interface PayloadVariant {
  readonly group: string
  readonly path: string
  readonly branch: string
  readonly chosen: boolean
  readonly selection: Readonly<Record<string, string>>
}

interface PayloadTheme {
  readonly tokens: Readonly<Record<string, ResolvedToken>>
  readonly cssVariables: Readonly<Record<string, string>>
  readonly colorScheme?: 'light' | 'dark'
  readonly stale?: boolean
}

/** Deterministic-only initial interaction and palette selection. */
export interface PayloadRenderOptions {
  readonly theme?: string
  readonly initialState?: { readonly screen: string; readonly seed: NamedState }
}

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
  /** Request-level selection failure, for example an unknown group. */
  readonly variantError?: string
  readonly themes?: Readonly<Record<string, PayloadTheme>>
  readonly theme?: string
  readonly declaredThemes?: readonly string[]
  readonly initialState?: PayloadRenderOptions['initialState']
}

/** Project endpoint only; deterministic rendering uses PreviewPayload. */
export interface InteractivePreviewPayload extends PreviewPayload {
  readonly preview?: PreviewMetadata
  readonly relationships: readonly PreviewRelationship[]
}

/** Resolve one explicit branch projection for the payload. */
function resolveSelection(
  project: DesignProject,
  screen: ProjectScreen,
  request: PayloadVariantRequest | undefined,
): {
  root?: ProjectScreen['root']
  states?: readonly NamedState[]
  variant?: PayloadVariant
  stale?: boolean
  error?: string
} {
  if (request === undefined || request.screen !== screen.id) return {}
  const document = screen.variantDocument ?? screen.root
  if (document === undefined) return { error: 'Screen "' + screen.id + '" has no parsed document to project.' }
  const groups =
    screen.variants ??
    collectVariantGroups(document).groups.map((group) => ({
      id: group.id,
      path: group.path,
      chosen: group.chosen,
      source: group.source,
      ...(group.parentPath === undefined ? {} : { parentPath: group.parentPath }),
      ...(group.parentBranch === undefined ? {} : { parentBranch: group.parentBranch }),
      wholeScreen: group.wholeScreen,
      branches: group.branches.map((branch) => ({
        id: branch.id,
        source: branch.source,
        valid: true,
        diagnostics: [],
      })),
    }))
  const group = groups.find((candidate) => candidate.path === request.group)
  if (group === undefined) {
    return {
      error:
        'Screen "' +
        screen.id +
        '" does not declare variant group "' +
        request.group +
        '". Known groups: ' +
        (groups.map((candidate) => candidate.path).join(', ') || 'none') +
        '.',
    }
  }
  const branch = group.branches.find((candidate) => candidate.id === request.branch)
  if (branch === undefined) {
    return {
      error:
        'Group "' +
        group.path +
        '" does not declare branch "' +
        request.branch +
        '". Known branches: ' +
        group.branches.map((candidate) => candidate.id).join(', ') +
        '.',
    }
  }
  const snapshot = screen.variantSnapshots?.[group.path + '|' + branch.id]
  if (!branch.valid) {
    if (snapshot === undefined) {
      return {
        error:
          'Variant group "' +
          group.path +
          '" branch "' +
          branch.id +
          '" has validation errors and no previously valid projection to keep.',
      }
    }
    return {
      root: snapshot.root,
      states: snapshot.states,
      stale: true,
      variant: {
        group: group.id,
        path: group.path,
        branch: branch.id,
        chosen: branch.id === group.chosen,
        selection: snapshot.selection,
      },
    }
  }
  const projection = resolveVariantDocument(document, { [group.path]: branch.id })
  if (projection.screen === undefined) {
    const detail = projection.diagnostics.find((entry) => entry.severity === 'error')?.message
    return { error: ['Variant projection could not resolve.', detail].filter(Boolean).join(' ') }
  }
  if (snapshot !== undefined) {
    return {
      root: snapshot.root,
      states: snapshot.states,
      variant: {
        group: group.id,
        path: group.path,
        branch: branch.id,
        chosen: branch.id === group.chosen,
        selection: snapshot.selection,
      },
    }
  }
  const expanded = expandScreen(projection.screen, screen.variantFixtures ?? project.fixtures, screen.file)
  const states = extractNamedStates(expanded.root, screen.file, kitMetadata)
  if (document.type === 'Variants' && countDiagnostics(states.diagnostics).errors > 0) {
    const first = states.diagnostics.find((entry) => entry.severity === 'error')
    return {
      error: 'Variant branch Screen states are invalid: ' + (first?.message ?? 'unknown validation error'),
    }
  }
  return {
    root: states.root,
    states: document.type === 'Variants' ? states.states : screen.states,
    variant: {
      group: group.id,
      path: group.path,
      branch: branch.id,
      chosen: branch.id === group.chosen,
      selection: projection.selection,
    },
  }
}

/** Build the payload, omitting any root that still has errors. */
export function buildPayload(
  session: string,
  revision: number,
  kitVersion: string,
  project: DesignProject,
  assets?: Record<string, string>,
  variantRequest?: PayloadVariantRequest,
  options?: PayloadRenderOptions,
): PreviewPayload {
  return projectPayload(session, revision, kitVersion, project, assets, variantRequest, undefined, options)
}

/** Attach project review metadata and graph evidence to the interactive endpoint. */
export function buildInteractivePayload(
  session: string,
  revision: number,
  kitVersion: string,
  project: DesignProject,
  variantRequest?: PayloadVariantRequest,
): InteractivePreviewPayload {
  const relationships: PreviewRelationship[] = []
  const knownScreens = new Set<string>()
  const duplicateScreens = new Set<string>()
  for (const screen of project.screens) {
    if (screen.id === '') continue
    if (knownScreens.has(screen.id)) duplicateScreens.add(screen.id)
    knownScreens.add(screen.id)
  }
  const payload = projectPayload(session, revision, kitVersion, project, undefined, variantRequest, (root) => {
    if (duplicateScreens.has(root.id)) return
    for (const edge of navigationRelationships(root, kitMetadata)) {
      if (knownScreens.has(edge.to.screen) && !duplicateScreens.has(edge.to.screen)) relationships.push(edge)
    }
  })
  return {
    ...payload,
    relationships: [...relationships, ...(project.preview?.relationships ?? [])],
    ...(project.preview === undefined ? {} : { preview: project.preview }),
  }
}

function projectPayload(
  session: string,
  revision: number,
  kitVersion: string,
  project: DesignProject,
  assets: Record<string, string> | undefined,
  variantRequest: PayloadVariantRequest | undefined,
  onCurrentRoot?: (root: NonNullable<ProjectScreen['root']>) => void,
  options?: PayloadRenderOptions,
): PreviewPayload {
  let requestError: string | undefined
  let matchedRequest = false
  const screens = project.screens
    .filter((screen) => screen.id !== '')
    .map((screen) => {
      const counts = countDiagnostics(screen.diagnostics)
      const blockingErrors = screen.blockingErrors ?? counts.errors
      const chosenRoot = blockingErrors === 0 ? screen.root : undefined
      const requested = variantRequest !== undefined && variantRequest.screen === screen.id
      let selected = resolveSelection(project, screen, variantRequest)
      if (requested) {
        matchedRequest = true
        if (selected.error !== undefined) requestError = selected.error
      }
      if (selected.error !== undefined) selected = {}
      const variant = selected.variant
      const root = requested ? (variant === undefined ? undefined : selected.root) : chosenRoot
      if (root !== undefined && screen.variantDocumentCurrent !== false && selected.stale !== true) {
        onCurrentRoot?.(root)
      }
      return {
        id: screen.id,
        file: screen.file,
        root,
        lastValidRoot: requested ? undefined : screen.lastValidRoot,
        diagnostics: screen.diagnostics,
        errors: requested ? 0 : counts.errors,
        blockingErrors: requested ? 0 : blockingErrors,
        warnings: counts.warnings,
        effectiveSelection: variant?.selection ?? screen.chosenSelection,
        states: selected.states ?? screen.states,
        variants: screen.variants ?? [],
        ...(variant === undefined ? {} : { variant }),
        ...(selected.stale === true || (requested && screen.variantStale === true) ? { variantStale: true } : {}),
      }
    })
  if (variantRequest !== undefined && !matchedRequest) {
    requestError = 'Screen "' + variantRequest.screen + '" is not part of this project.'
  }
  const toPalette = (
    tokens: Readonly<Record<string, ResolvedToken>>,
    colorScheme?: 'light' | 'dark',
  ): PayloadTheme => ({
    tokens,
    cssVariables: Object.fromEntries(Object.values(tokens).map((token) => [token.cssVar, String(token.value)])),
    ...(colorScheme === undefined ? {} : { colorScheme }),
  })
  const themes: Record<string, PayloadTheme> = Object.create(null)
  for (const [name, palette] of Object.entries(project.themes ?? {})) {
    themes[name] = toPalette(palette.tokens.tokens, palette.colorScheme)
  }
  // Retained sources are preview-only; a deterministic render must never use them.
  if (onCurrentRoot !== undefined) {
    for (const [name, palette] of Object.entries(project.lastValidThemes ?? {})) {
      themes[name] ??= { ...toPalette(palette.tokens.tokens, palette.colorScheme), stale: true }
    }
  }
  const theme = options?.theme ?? project.defaultTheme ?? 'base'
  const { tokens, cssVariables } = themes[theme] ?? toPalette(project.tokens.tokens)
  const fatal = project.diagnostics.find(
    (diagnostic) =>
      diagnostic.severity === 'error' &&
      (diagnostic.file === 'design.json' ||
        (diagnostic.file === 'tokens.json' && themes.base?.stale !== true) ||
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
    ...(project.themes === undefined
      ? {}
      : {
          theme,
          themes,
          declaredThemes: ['base', ...Object.keys(project.config.themes ?? {})],
        }),
    ...(options?.initialState === undefined ? {} : { initialState: options.initialState }),
    diagnostics:
      onCurrentRoot !== undefined
        ? project.diagnostics
        : project.diagnostics.filter((entry) => entry.file !== PREVIEW_METADATA_FILE),
    screens,
    ...(fatal === undefined ? {} : { projectError: fatal.message }),
    ...(assets === undefined ? {} : { assets }),
    ...(requestError === undefined ? {} : { variantError: requestError }),
  }
}
