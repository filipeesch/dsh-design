/**
 * Design project discovery and loading.
 *
 * A project is a design folder with `design.json`, `tokens.json`, and
 * `screens/*.dsx`, plus optional `fixtures/*.json` and `journeys/*.dsx`.
 * Loading never writes: derived output belongs to the host under
 * `<design-folder>/.cache/`.
 */
import { lstat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { checkKitVersion, SOURCE_NAME } from './config.ts'
import { countDiagnostics, sortDiagnostics } from './diagnostics.ts'
import { expandScreen, parseFixtureCollection } from './fixtures.ts'
import { parseJourney, validateJourney } from './journey.ts'
import type { KitMetadata } from './metadata.ts'
import { parseScreen } from './parse.ts'
import { parsePreviewMetadata, PREVIEW_METADATA_FILE } from './preview.ts'
import { loadThemes } from './themes.ts'
import { composeLayout, loadLayouts, type LayoutCatalog } from './layouts.ts'
import { applyStyleClasses, loadStylesheets, type StylesheetCatalog } from './stylesheets.ts'
import { localProjectSourceReader, readProjectSources, type SourceInventory } from './sources.ts'
import { isFixtureRef } from './refs.ts'
import { extractNamedStates } from './state.ts'
import { validateTree, type ValidationContext } from './validate.ts'
import {
  collectVariantGroups,
  enumerateVariantSelections,
  MAX_VARIANT_PROJECTIONS,
  resolveVariantDocument,
  variantSelectionKey,
  type DiscoveredVariantGroup,
} from './variants.ts'
import type {
  DesignElement,
  DesignProject,
  DesignPropValue,
  FixtureCollection,
  DesignScreenNode,
  Diagnostic,
  NamedState,
  ParsedJourney,
  ParsedScreen,
  ProjectJourney,
  ProjectScreen,
  VariantBranchInfo,
  VariantGroupInfo,
  VariantProjectionSnapshot,
} from './types.ts'

/** Default design folder name inside the session working directory. */
export const DEFAULT_DESIGN_FOLDER = 'design'

/** Validate and normalize a configured design folder name (one path segment). */
export function normalizeFolderName(name: string = DEFAULT_DESIGN_FOLDER): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error('design folder name must be one safe path segment, got ' + JSON.stringify(name))
  }
  return name
}

/** Outcome of discovering a design project from a working directory. */
export interface DiscoveryResult {
  readonly found: boolean
  readonly cwd: string
  readonly folderName: string
  readonly folder: string
  readonly configPath: string
}

/**
 * Locate the design folder under a working directory.
 * @param cwd - session working directory.
 * @param folderName - configurable folder name, default `design`.
 */
export async function discoverProject(cwd: string, folderName = DEFAULT_DESIGN_FOLDER): Promise<DiscoveryResult> {
  const safeName = normalizeFolderName(folderName)
  const folder = resolve(cwd, safeName)
  const configPath = join(folder, 'design.json')
  try {
    const info = await lstat(configPath)
    return { found: info.isFile() || info.isSymbolicLink(), cwd, folderName: safeName, folder, configPath }
  } catch {
    return { found: false, cwd, folderName: safeName, folder, configPath }
  }
}

/** Cached parse of one screen file, keyed by modification time and size. */
export interface ParseCacheEntry {
  readonly fingerprint: string
  readonly mtimeMs?: number
  readonly size: number
  readonly parsed: ParsedScreen
}

/** Options for loading a project. */
export interface LoadProjectOptions {
  readonly folder: string
  readonly kit: KitMetadata
  readonly installedKitVersion: string
  /** Previous project used to retain last-valid trees across a reload. */
  readonly previous?: DesignProject
  /** Per-file parse cache enabling incremental re-parsing. */
  readonly parseCache?: Map<string, ParseCacheEntry>
}

/** List design screen files admitted by the project source policy. */
export async function listScreenFiles(folder: string): Promise<string[]> {
  return [...(await readProjectSources(localProjectSourceReader(folder))).directories.screens]
}

/** List design journey files admitted by the project source policy. */
export async function listJourneyFiles(folder: string): Promise<string[]> {
  return [...(await readProjectSources(localProjectSourceReader(folder))).directories.journeys]
}

/** Build an empty project for a missing or broken config. */
function emptyProject(folder: string, diagnostics: Diagnostic[], sourceIdentity: string): DesignProject {
  return {
    folder,
    config: { kitVersion: '', breakpoints: [] },
    tokens: { tokens: {}, cssText: '', diagnostics: [] },
    themes: {},
    defaultTheme: 'base',
    lastValidThemes: {},
    sourceIdentity,
    sourceFiles: [],
    screens: [],
    diagnostics: sortDiagnostics(diagnostics),
    entry: undefined,
    fixtures: {},
    journeys: [],
  }
}

/** Screen data after variant resolution, fixture expansion, and state extraction. */
interface PreparedScreen {
  readonly parsed: ParsedScreen
  readonly document?: DesignScreenNode | DesignElement
  readonly root?: DesignScreenNode
  readonly states: readonly NamedState[]
  readonly selection: Readonly<Record<string, string>>
  readonly diagnostics: readonly Diagnostic[]
  /** Whether the chosen projection resolved structurally. */
  readonly structural: boolean
}

interface SharedSources {
  readonly layouts: LayoutCatalog
  readonly styles: StylesheetCatalog
  readonly fixtures: DesignProject['fixtures']
}

/** All chosen and branch projections use the same compose/expand/validate inputs. */
function prepareProjection(screen: DesignScreenNode, file: string, kit: KitMetadata, sources: SharedSources) {
  const composed = composeLayout(screen, sources.layouts)
  const expanded = expandScreen(composed.root, sources.fixtures, file)
  const states = extractNamedStates(expanded.root, file, kit)
  const styled = applyStyleClasses(states.root, sources.styles)
  return {
    root: styled.root,
    states: states.states,
    diagnostics: [...composed.diagnostics, ...expanded.diagnostics, ...styled.diagnostics],
    stateDiagnostics: states.diagnostics,
  }
}

function screenDependencies(
  document: DesignElement | undefined,
  layouts: LayoutCatalog,
  stylesheets: readonly string[],
): string[] {
  const result = new Set<string>()
  function valueRefs(value: DesignPropValue): void {
    if (isFixtureRef(value) && SOURCE_NAME.test(value.$fixture)) {
      result.add('fixtures/' + value.$fixture + '.json')
    } else if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value) as DesignPropValue[]) valueRefs(child)
    }
  }
  function visit(node: DesignElement): void {
    if (node.type === 'Screen' && typeof node.props.layout === 'string' && SOURCE_NAME.test(node.props.layout)) {
      const file = 'layouts/' + node.props.layout + '.dsx'
      const layout = layouts.get(node.props.layout)?.root
      if (!result.has(file) && layout !== undefined) {
        result.add(file)
        visit(layout)
      }
      result.add(file)
    }
    if (Object.hasOwn(node.props, 'styleClass')) for (const file of stylesheets) result.add(file)
    for (const value of Object.values(node.props)) valueRefs(value)
    for (const child of node.children) if (child.kind === 'element') visit(child)
  }
  if (document !== undefined) visit(document)
  return [...result].sort()
}

/** Resolve the chosen projection, expand fixtures, and extract named states. */
function prepareScreen(parsed: ParsedScreen, sources: SharedSources, kit: KitMetadata): PreparedScreen {
  const document = parsed.document ?? parsed.root
  if (document === undefined) {
    return { parsed, states: [], selection: {}, diagnostics: parsed.diagnostics, structural: false }
  }
  const discovery = collectVariantGroups(document)
  const chosen = resolveVariantDocument(document, {})
  const diagnostics: Diagnostic[] = [...parsed.diagnostics, ...discovery.diagnostics, ...chosen.diagnostics]
  if (chosen.screen === undefined) {
    return {
      parsed,
      document,
      states: [],
      selection: chosen.selection,
      diagnostics,
      structural: false,
    }
  }
  const projection = prepareProjection(chosen.screen, parsed.file, kit, sources)
  return {
    parsed,
    document,
    root: projection.root,
    states: projection.states,
    selection: chosen.selection,
    diagnostics: [...diagnostics, ...projection.diagnostics, ...projection.stateDiagnostics],
    structural: true,
  }
}

/** Tag a projection diagnostic with the group and branch it belongs to. */
function tagDiagnostic(
  diagnostic: Diagnostic,
  group: DiscoveredVariantGroup,
  branch: string,
  prefix?: string,
): Diagnostic {
  return {
    ...diagnostic,
    ...(diagnostic.group === undefined ? { group: group.path } : {}),
    ...(diagnostic.branch === undefined ? { branch } : {}),
    ...(prefix === undefined || !diagnostic.severity ? {} : { message: prefix + diagnostic.message }),
  }
}

/** Stable diagnostic identity used to drop repeats across projections. */
function diagnosticKey(diagnostic: Diagnostic): string {
  return [
    diagnostic.code,
    diagnostic.file,
    String(diagnostic.line),
    String(diagnostic.column),
    diagnostic.message,
    diagnostic.group ?? '',
    diagnostic.branch ?? '',
  ].join('|')
}

function dedupe(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  const result: Diagnostic[] = []
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(diagnostic)
  }
  return result
}

interface VariantValidation {
  readonly groups: readonly VariantGroupInfo[]
  /** Diagnostics for alternate branches and multi-branch combinations. */
  readonly extras: readonly Diagnostic[]
  /** Last valid expanded snapshot per group/branch key. */
  readonly snapshots: Readonly<Record<string, VariantProjectionSnapshot>>
  /** Blocking projection-budget diagnostic, when enumeration exceeded it. */
  readonly limit?: Diagnostic
}

/**
 * Validate every reachable bounded projection of one screen. The chosen
 * projection is validated separately; this function covers each alternate
 * branch and every multi-branch combination.
 */
function validateVariantProjections(input: {
  readonly document: DesignScreenNode | DesignElement
  readonly file: string
  readonly context: ValidationContext
  readonly sources: SharedSources
  readonly chosenSelection: Readonly<Record<string, string>>
  readonly chosenErrors: number
  readonly chosenDiagnostics: readonly Diagnostic[]
  readonly chosenRoot?: DesignScreenNode
  readonly chosenStates: readonly NamedState[]
  readonly wholeScreen: boolean
}): VariantValidation {
  const discovery = collectVariantGroups(input.document)
  if (discovery.groups.length === 0) return { groups: [], extras: [], snapshots: {} }
  const extras: Diagnostic[] = []
  const groups: VariantGroupInfo[] = []
  const snapshots: Record<string, VariantProjectionSnapshot> = {}
  const baseline = resolveVariantDocument(input.document, {})
  const baselineSelection: Record<string, string> = {}
  for (const [path, branch] of Object.entries(baseline.selection)) baselineSelection[path] = branch
  for (const [path, branch] of Object.entries(input.chosenSelection)) baselineSelection[path] = branch

  for (const group of discovery.groups) {
    const branches: VariantBranchInfo[] = []
    for (const branch of group.branches) {
      const activeChosen = branch.id === group.chosen && input.chosenSelection[group.path] === branch.id
      if (activeChosen) {
        if (input.chosenErrors === 0 && input.chosenRoot !== undefined) {
          snapshots[group.path + '|' + branch.id] = {
            root: input.chosenRoot,
            states: input.chosenStates,
            selection: input.chosenSelection,
            fixtures: input.sources.fixtures,
            diagnostics: input.chosenDiagnostics,
          }
        }
        branches.push({
          id: branch.id,
          source: branch.source,
          valid: input.chosenErrors === 0,
          ...(input.wholeScreen ? { states: input.chosenStates } : {}),
          diagnostics: [],
        })
        continue
      }
      // Use the same group:branch request the preview and tools use: the
      // resolver chooses only required ancestors and keeps every other
      // reachable group on its implicit chosen branch. Carrying the chosen
      // projection's sibling selections would make disjoint nested branches
      // look unreachable.
      const selection: Record<string, string> = { [group.path]: branch.id }
      const projection = resolveVariantDocument(input.document, selection)
      let diagnostics: Diagnostic[] = [...projection.diagnostics]
      let snapshotStates: readonly NamedState[] = input.chosenStates
      let expandedRoot: DesignScreenNode | undefined
      if (projection.screen !== undefined) {
        const prepared = prepareProjection(projection.screen, input.file, input.context.kit, input.sources)
        const semantic = validateTree(prepared.root, input.file, input.context)
        // Shared Screen states are validated against the chosen projection; a
        // missing branch-local target is diagnosed at selection time. A
        // whole-screen branch owns its Screen states and is validated here.
        diagnostics = [
          ...projection.diagnostics,
          ...prepared.diagnostics,
          ...(input.wholeScreen ? prepared.stateDiagnostics : []),
          ...semantic,
        ]
        expandedRoot = prepared.root
        snapshotStates = input.wholeScreen ? prepared.states : input.chosenStates
      }
      const prefix = 'Variant group #' + group.id + ' branch "' + branch.id + '": '
      const tagged = dedupe(diagnostics.map((entry) => tagDiagnostic(entry, group, branch.id, prefix)))
      const errors = countDiagnostics(tagged).errors
      const valid = projection.screen !== undefined && errors === 0
      if (valid && expandedRoot !== undefined) {
        snapshots[group.path + '|' + branch.id] = {
          root: expandedRoot,
          states: snapshotStates,
          selection: projection.selection,
          fixtures: input.sources.fixtures,
          diagnostics,
        }
      }
      branches.push({
        id: branch.id,
        source: branch.source,
        valid,
        ...(input.wholeScreen ? { states: snapshotStates } : {}),
        diagnostics: tagged,
      })
      extras.push(...tagged)
    }
    groups.push({
      id: group.id,
      path: group.path,
      chosen: group.chosen,
      source: group.source,
      ...(group.parentPath === undefined ? {} : { parentPath: group.parentPath }),
      ...(group.parentBranch === undefined ? {} : { parentBranch: group.parentBranch }),
      wholeScreen: group.wholeScreen,
      branches,
    })
  }

  const enumerated = enumerateVariantSelections(input.document, MAX_VARIANT_PROJECTIONS + 1)
  if (enumerated.selections.length > MAX_VARIANT_PROJECTIONS || enumerated.truncated) {
    const first = discovery.groups[0]!
    const limit: Diagnostic = {
      severity: 'error',
      code: 'variant-projection-limit',
      file: input.file,
      line: first.source.line,
      column: first.source.column,
      group: first.path,
      message:
        'This screen reaches more than ' +
        String(enumerated.selections.length) +
        ' variant projections; reduce the groups or branches so every published alternative can be validated.',
      suggestion: 'Keep each screen within the documented projection budget.',
    }
    return { groups, extras: dedupe(extras), snapshots, limit }
  }
  for (const selection of enumerated.selections) {
    const diffs = Object.entries(selection).filter(([path, branch]) => baselineSelection[path] !== branch)
    if (diffs.length < 2) continue
    const projection = resolveVariantDocument(input.document, selection)
    const first = discovery.groups.find((group) => group.path === diffs[0]![0])
    if (first === undefined) continue
    const branchId = diffs[0]![1]
    const prefix = 'Variant combination ' + variantSelectionKey(selection).split('|').join(', ') + ' is invalid: '
    const diagnostics =
      projection.screen === undefined
        ? [...projection.diagnostics]
        : (() => {
            const prepared = prepareProjection(projection.screen, input.file, input.context.kit, input.sources)
            const semantic = validateTree(prepared.root, input.file, input.context)
            return [
              ...projection.diagnostics,
              ...prepared.diagnostics,
              ...(input.wholeScreen ? prepared.stateDiagnostics : []),
              ...semantic,
            ]
          })()
    const tagged = dedupe(diagnostics.map((entry) => tagDiagnostic(entry, first, branchId, prefix)))
    extras.push(...tagged)
  }
  return { groups, extras: dedupe(extras), snapshots }
}

/** Duplicate journey ids across files, reported on the later file. */
function journeyDuplicates(journeys: readonly ParsedJourney[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const seen = new Map<string, string>()
  for (const parsed of journeys) {
    const id = parsed.journey?.id
    if (id === undefined) continue
    const first = seen.get(id)
    if (first !== undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'journey-duplicate-id',
        file: parsed.file,
        line: parsed.journey?.source.line ?? 1,
        column: parsed.journey?.source.column ?? 1,
        message: `Duplicate journey id "${id}" declared in ${first} and ${parsed.file}.`,
      })
      continue
    }
    seen.set(id, parsed.file)
  }
  return diagnostics
}

/**
 * Load and validate a design project from disk.
 * @param options - folder, kit metadata, installed kit version, and previous project.
 */
export async function loadProject(options: LoadProjectOptions): Promise<DesignProject> {
  if (!isAbsolute(options.folder)) throw new Error('design folder must be absolute, got ' + options.folder)
  const inventory = await readProjectSources(localProjectSourceReader(options.folder))
  return projectFromSources(options, inventory)
}

/** Resolve a previously captured inventory, with no additional project-source reads. */
export function projectFromSources(options: LoadProjectOptions, inventory: SourceInventory): DesignProject {
  const { folder, kit, installedKitVersion, previous } = options
  const configEntry = inventory.entries.get('design.json')
  if (configEntry?.source === undefined) {
    return emptyProject(
      folder,
      [
        configEntry?.issue ?? {
          severity: 'error',
          code: 'project-missing',
          file: 'design.json',
          line: 1,
          column: 1,
          message: 'No design project exists at ' + folder + '; run design_init to scaffold one.',
        },
      ],
      inventory.sourceIdentity,
    )
  }
  const parsedConfig = inventory.config
  const diagnostics: Diagnostic[] = [...parsedConfig.diagnostics, ...inventory.diagnostics]
  if (parsedConfig.config.kitVersion !== '') {
    const mismatch = checkKitVersion(parsedConfig.config.kitVersion, installedKitVersion, 'design.json')
    if (mismatch !== undefined) diagnostics.push(mismatch)
  }
  const palettes = loadThemes(inventory, previous)
  const { tokens, themes, defaultTheme, lastValidThemes } = palettes
  const { layouts, diagnostics: layoutDiagnostics } = loadLayouts(inventory)
  const styles = loadStylesheets(inventory, tokens)
  diagnostics.push(...palettes.diagnostics, ...layoutDiagnostics, ...styles.diagnostics)
  const fixtures: Record<string, FixtureCollection> = {}
  for (const file of inventory.directories.fixtures) {
    const source = inventory.entries.get(file)?.source
    if (source === undefined) continue
    const id = file.slice('fixtures/'.length, -'.json'.length)
    if (!SOURCE_NAME.test(id)) {
      diagnostics.push({
        severity: 'error',
        code: 'fixture-name',
        file,
        line: 1,
        column: 1,
        message: 'Fixture filenames must be kebab-case IDs plus .json.',
      })
      continue
    }
    const collection = parseFixtureCollection(id, file, source, diagnostics)
    if (collection !== undefined) fixtures[id] = collection
  }
  const sources: SharedSources = { layouts, styles, fixtures }
  const parsedScreens = inventory.directories.screens.map((file): ParsedScreen => {
    const entry = inventory.entries.get(file)
    if (entry?.source === undefined) return { file, diagnostics: entry?.issue === undefined ? [] : [entry.issue] }
    const cached = options.parseCache?.get(file)
    if (cached?.fingerprint === entry.fingerprint) return cached.parsed
    const parsed = parseScreen(entry.source, file)
    options.parseCache?.set(file, {
      fingerprint: entry.fingerprint,
      mtimeMs: entry.mtimeMs,
      size: entry.size ?? 0,
      parsed,
    })
    return parsed
  })
  const prepared = parsedScreens.map((parsed) => prepareScreen(parsed, sources, kit))

  // Collect screen ids first so cross-screen references validate in one pass.
  const previousByFile = new Map((previous?.screens ?? []).map((screen) => [screen.file, screen]))
  const screenIds: string[] = []
  const seen = new Map<string, string>()
  const screenDiagnostics: Diagnostic[] = []
  for (const candidate of prepared) {
    const parsed = candidate.parsed
    const previousScreen = previousByFile.get(parsed.file)
    const declaredId = candidate.root?.id
    const id = declaredId === undefined || declaredId === '' ? (previousScreen?.id ?? '') : declaredId
    if (id === '') continue
    if (declaredId !== undefined && declaredId !== '') {
      const firstFile = seen.get(id)
      if (firstFile !== undefined) {
        screenDiagnostics.push({
          severity: 'error',
          code: 'duplicate-screen',
          file: parsed.file,
          line: candidate.root?.source.line ?? 1,
          column: candidate.root?.source.column ?? 1,
          message: `Duplicate screen id "${id}" declared in ${firstFile} and ${parsed.file}.`,
        })
        continue
      }
    }
    if (!seen.has(id)) {
      seen.set(id, parsed.file)
      screenIds.push(id)
    }
  }
  screenIds.sort((left, right) => left.localeCompare(right))
  const configTokenDiagnostics = [...diagnostics]

  const screenResults: ProjectScreen[] = []
  const breakpointNames = parsedConfig.config.breakpoints.map((breakpoint) => breakpoint.name)
  for (const candidate of prepared) {
    const parsed = candidate.parsed
    const previousScreen = previousByFile.get(parsed.file)
    const sourceDependencies = screenDependencies(candidate.document, layouts, parsedConfig.config.stylesheets ?? [])
    const defaultPaletteFile = parsedConfig.config.themes?.[defaultTheme]
    if (defaultPaletteFile !== undefined) sourceDependencies.push(defaultPaletteFile)
    if (candidate.root === undefined) {
      screenResults.push({
        id: previousScreen?.id ?? '',
        file: parsed.file,
        sourceDependencies,
        diagnostics: sortDiagnostics(candidate.diagnostics),
        ...(previousScreen?.lastValidRoot === undefined ? {} : { lastValidRoot: previousScreen.lastValidRoot }),
        states: previousScreen?.states ?? [],
        ...(previousScreen?.variantDocument === undefined ? {} : { variantDocument: previousScreen.variantDocument }),
        ...(previousScreen?.variantFixtures === undefined ? {} : { variantFixtures: previousScreen.variantFixtures }),
        ...(previousScreen?.variantSnapshots === undefined
          ? {}
          : { variantSnapshots: previousScreen.variantSnapshots }),
        ...(previousScreen?.variants === undefined
          ? {}
          : {
              variants: previousScreen.variants.map((group) => ({
                ...group,
                branches: group.branches.map((branch) => ({ ...branch, stale: true })),
              })),
            }),
        ...(previousScreen?.variantDocument === undefined ? {} : { variantStale: true }),
        ...(previousScreen?.variantDocument === undefined ? {} : { variantDocumentCurrent: false }),
        ...(previousScreen?.chosenSelection === undefined ? {} : { chosenSelection: previousScreen.chosenSelection }),
        blockingErrors: countDiagnostics(candidate.diagnostics).errors,
      })
      continue
    }
    const context: ValidationContext = {
      kit,
      tokens: tokens.tokens,
      breakpoints: breakpointNames,
      projectScreens: screenIds,
      designFolder: folder,
      kitVersionPin: parsedConfig.config.kitVersion,
      installedKitVersion,
    }
    const semantic = validateTree(candidate.root, parsed.file, context)
    const chosen = candidate.document === undefined ? undefined : resolveVariantDocument(candidate.document, {})
    const chosenSelection = chosen?.selection ?? {}
    const variantValidation =
      candidate.structural && candidate.document !== undefined
        ? validateVariantProjections({
            document: candidate.document,
            file: parsed.file,
            context,
            sources,
            chosenSelection,
            chosenErrors: countDiagnostics([...candidate.diagnostics, ...semantic]).errors,
            chosenDiagnostics: [...candidate.diagnostics, ...semantic],
            ...(candidate.root === undefined ? {} : { chosenRoot: candidate.root }),
            chosenStates: candidate.states,
            wholeScreen: candidate.document?.type === 'Variants',
          })
        : undefined
    const structuralBlocking = candidate.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error' && diagnostic.branch === undefined,
    ).length
    const chosenBlocking = countDiagnostics(semantic).errors
    const blockingErrors = structuralBlocking + chosenBlocking + (variantValidation?.limit === undefined ? 0 : 1)
    const extras = variantValidation?.extras ?? []
    const all = sortDiagnostics([
      ...candidate.diagnostics,
      ...semantic,
      ...extras,
      ...(variantValidation?.limit === undefined ? [] : [variantValidation.limit]),
    ])
    const hasBlocking = blockingErrors > 0
    const documentValid = candidate.structural && variantValidation?.limit === undefined
    const previousSnapshots = previousScreen?.variantSnapshots ?? {}
    const currentSnapshots = variantValidation?.snapshots ?? {}
    const snapshots = { ...previousSnapshots, ...currentSnapshots }
    const flagBranches = (groups: readonly VariantGroupInfo[], forceStale = false): VariantGroupInfo[] =>
      groups.map((group) => ({
        ...group,
        branches: group.branches.map((branch) => {
          const key = group.path + '|' + branch.id
          const available = previousSnapshots[key] !== undefined || currentSnapshots[key] !== undefined
          return {
            ...branch,
            ...(forceStale || (!branch.valid && available) ? { stale: true } : {}),
          }
        }),
      }))
    const currentVariants = documentValid ? flagBranches(variantValidation?.groups ?? []) : undefined
    const previousVariants =
      previousScreen?.variants === undefined ? undefined : flagBranches(previousScreen.variants, !documentValid)
    const variantStale =
      !documentValid ||
      (currentVariants ?? previousVariants ?? []).some((group) =>
        group.branches.some((branch) => branch.stale === true),
      )
    screenResults.push({
      id: candidate.root.id === '' ? (previousScreen?.id ?? '') : candidate.root.id,
      file: parsed.file,
      sourceDependencies,
      root: candidate.root,
      diagnostics: all,
      ...(hasBlocking
        ? previousScreen?.lastValidRoot === undefined
          ? {}
          : { lastValidRoot: previousScreen.lastValidRoot }
        : { lastValidRoot: candidate.root }),
      states: hasBlocking ? (previousScreen?.states ?? []) : candidate.states,
      ...(documentValid && candidate.document !== undefined
        ? { variantDocument: candidate.document }
        : previousScreen?.variantDocument === undefined
          ? {}
          : { variantDocument: previousScreen.variantDocument }),
      ...(documentValid && candidate.document !== undefined
        ? { variantFixtures: fixtures }
        : previousScreen?.variantFixtures === undefined
          ? {}
          : { variantFixtures: previousScreen.variantFixtures }),
      ...(Object.keys(snapshots).length === 0 ? {} : { variantSnapshots: snapshots }),
      ...(currentVariants === undefined
        ? previousVariants === undefined
          ? {}
          : { variants: previousVariants }
        : { variants: currentVariants }),
      ...(variantStale ? { variantStale: true } : {}),
      ...(documentValid && candidate.document !== undefined
        ? { variantDocumentCurrent: true }
        : previousScreen?.variantDocument === undefined
          ? {}
          : { variantDocumentCurrent: false }),
      ...(candidate.selection === undefined ? {} : { chosenSelection: candidate.selection }),
      blockingErrors,
    })
  }

  // Journeys validate against the prepared screens and their named states.
  const journeyFiles = inventory.directories.journeys
  const parsedJourneys: ParsedJourney[] = []
  for (const file of journeyFiles) {
    const source = inventory.entries.get(file)?.source
    if (source !== undefined) parsedJourneys.push(parseJourney(source, file))
  }
  const journeyDiagnostics = journeyDuplicates(parsedJourneys)
  const screensById = new Map(screenResults.map((screen) => [screen.id, screen]))
  const journeys: ProjectJourney[] = parsedJourneys.map((parsed) => {
    const validation = validateJourney(parsed, {
      projectScreens: screenIds,
      breakpoints: parsedConfig.config.breakpoints.map((breakpoint) => breakpoint.name),
      rootOf: (screen) => {
        const found = screensById.get(screen)
        return found?.root ?? found?.lastValidRoot
      },
      statesOf: (screen) => screensById.get(screen)?.states ?? [],
      themes: Object.keys(themes),
    })
    return {
      file: parsed.file,
      id: parsed.journey?.id ?? '',
      ...(parsed.journey === undefined ? {} : { journey: parsed.journey }),
      diagnostics: sortDiagnostics([...parsed.diagnostics, ...validation]),
    }
  })

  const previewSource = inventory.entries.get(PREVIEW_METADATA_FILE)?.source
  const metadata =
    previewSource === undefined ? { diagnostics: [] } : parsePreviewMetadata(previewSource, screenResults)
  const perScreen = screenResults.flatMap((screen) => screen.diagnostics)
  const perJourney = journeys.flatMap((journey) => journey.diagnostics)
  const allDiagnostics = sortDiagnostics(
    dedupe([
      ...configTokenDiagnostics,
      ...screenDiagnostics,
      ...journeyDiagnostics,
      ...metadata.diagnostics,
      ...perScreen,
      ...perJourney,
    ]),
  )
  const entry = parsedConfig.config.entry ?? screenIds[0]
  if (entry !== undefined && !screenIds.includes(entry)) {
    allDiagnostics.push({
      severity: 'error',
      code: 'entry-missing',
      file: 'design.json',
      line: 1,
      column: 1,
      message: `design.json entry "${entry}" does not match any screen id. Known screens: ${screenIds.join(', ') || 'none'}.`,
    })
  }
  const kitMismatch = allDiagnostics.find((diagnostic) => diagnostic.code === 'kit-version-mismatch')
  return {
    folder,
    config: parsedConfig.config,
    tokens,
    themes,
    defaultTheme,
    lastValidThemes,
    sourceIdentity: inventory.sourceIdentity,
    sourceFiles: [...inventory.entries]
      .filter(([file, entry]) => file.includes('.') && entry.fingerprint !== 'missing')
      .map(([file]) => file),
    screens: screenResults,
    diagnostics: kitMismatch === undefined ? sortDiagnostics(allDiagnostics) : allDiagnostics,
    entry,
    fixtures,
    journeys,
    ...(metadata.preview === undefined ? {} : { preview: metadata.preview }),
  }
}
