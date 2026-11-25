/**
 * Design project discovery and loading.
 *
 * A project is a design folder with `design.json`, `tokens.json`, and
 * `screens/*.dsx`, plus optional `fixtures/*.json` and `journeys/*.dsx`.
 * Loading never writes: derived output belongs to the host under
 * `<design-folder>/.cache/`.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { checkKitVersion, parseConfig } from './config.ts'
import { countDiagnostics, sortDiagnostics } from './diagnostics.ts'
import { expandScreen, loadFixtures } from './fixtures.ts'
import { parseJourney, validateJourney } from './journey.ts'
import type { KitMetadata } from './metadata.ts'
import { parseScreen } from './parse.ts'
import { extractNamedStates } from './state.ts'
import { validateTree, type ValidationContext } from './validate.ts'
import { parseTokens } from './tokens.ts'
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
    const info = await stat(configPath)
    return { found: info.isFile(), cwd, folderName: safeName, folder, configPath }
  } catch {
    return { found: false, cwd, folderName: safeName, folder, configPath }
  }
}

/** Cached parse of one screen file, keyed by modification time and size. */
export interface ParseCacheEntry {
  readonly mtimeMs: number
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

/** Read a project file, returning undefined when absent. */
async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/** List files in one project subdirectory, sorted for deterministic output. */
async function listProjectFiles(folder: string, directory: string, extension: string): Promise<string[]> {
  try {
    const entries = await readdir(join(folder, directory), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => directory + '/' + entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

/** List screen files in a design folder, sorted for deterministic output. */
export async function listScreenFiles(folder: string): Promise<string[]> {
  return listProjectFiles(folder, 'screens', '.dsx')
}

/** List journey files in a design folder, sorted for deterministic output. */
export async function listJourneyFiles(folder: string): Promise<string[]> {
  return listProjectFiles(folder, 'journeys', '.dsx')
}

/** Build an empty project for a missing or broken config. */
function emptyProject(folder: string, diagnostics: Diagnostic[]): DesignProject {
  return {
    folder,
    config: { kitVersion: '', breakpoints: [] },
    tokens: { tokens: {}, cssText: '', diagnostics: [] },
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

/** Resolve the chosen projection, expand fixtures, and extract named states. */
function prepareScreen(parsed: ParsedScreen, fixtures: DesignProject['fixtures'], kit: KitMetadata): PreparedScreen {
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
  const expanded = expandScreen(chosen.screen, fixtures, parsed.file)
  const states = extractNamedStates(expanded.root, parsed.file, kit)
  return {
    parsed,
    document,
    root: states.root,
    states: states.states,
    selection: chosen.selection,
    diagnostics: [...diagnostics, ...expanded.diagnostics, ...states.diagnostics],
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
  readonly fixtures: DesignProject['fixtures']
  readonly chosenSelection: Readonly<Record<string, string>>
  readonly chosenErrors: number
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
            fixtures: input.fixtures,
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
        const expanded = expandScreen(projection.screen, input.fixtures, input.file)
        const states = extractNamedStates(expanded.root, input.file, input.context.kit)
        const semantic = validateTree(states.root, input.file, input.context)
        // Shared Screen states are validated against the chosen projection; a
        // missing branch-local target is diagnosed at selection time. A
        // whole-screen branch owns its Screen states and is validated here.
        diagnostics = [
          ...projection.diagnostics,
          ...expanded.diagnostics,
          ...(input.wholeScreen ? states.diagnostics : []),
          ...semantic,
        ]
        expandedRoot = states.root
        snapshotStates = input.wholeScreen ? states.states : input.chosenStates
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
          fixtures: input.fixtures,
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
            const expanded = expandScreen(projection.screen, input.fixtures, input.file)
            const states = extractNamedStates(expanded.root, input.file, input.context.kit)
            const semantic = validateTree(states.root, input.file, input.context)
            return [
              ...projection.diagnostics,
              ...expanded.diagnostics,
              ...(input.wholeScreen ? states.diagnostics : []),
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
  const { folder, kit, installedKitVersion, previous } = options
  if (!isAbsolute(folder)) throw new Error(`design folder must be absolute, got "${folder}"`)
  const configSource = await readOptional(join(folder, 'design.json'))
  if (configSource === undefined) {
    return emptyProject(folder, [
      {
        severity: 'error',
        code: 'project-missing',
        file: 'design.json',
        line: 1,
        column: 1,
        message: `No design project exists at ${folder}; run design_init to scaffold one.`,
      },
    ])
  }
  const parsedConfig = parseConfig(configSource, 'design.json')
  const diagnostics: Diagnostic[] = [...parsedConfig.diagnostics]
  if (parsedConfig.config.kitVersion !== '') {
    const mismatch = checkKitVersion(parsedConfig.config.kitVersion, installedKitVersion, 'design.json')
    if (mismatch !== undefined) diagnostics.push(mismatch)
  }

  const tokensSource = await readOptional(join(folder, 'tokens.json'))
  const tokens =
    tokensSource === undefined
      ? {
          tokens: {},
          cssText: '',
          diagnostics: [
            {
              severity: 'error' as const,
              code: 'tokens-missing',
              file: 'tokens.json',
              line: 1,
              column: 1,
              message: 'No tokens.json exists in the design folder; run design_init or restore the file.',
            },
          ],
        }
      : parseTokens(tokensSource, 'tokens.json')
  diagnostics.push(...tokens.diagnostics)

  const loadedFixtures = await loadFixtures(folder)
  diagnostics.push(...loadedFixtures.diagnostics)

  const files = await listScreenFiles(folder)
  const parsedScreens = await Promise.all(
    files.map(async (file) => {
      const absolute = join(folder, file)
      const info = await stat(absolute).catch(() => undefined)
      const cached = options.parseCache?.get(file)
      if (info !== undefined && cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
        return cached.parsed
      }
      const source = await readOptional(absolute)
      const parsed = source === undefined ? { file, diagnostics: [], root: undefined } : parseScreen(source, file)
      if (info !== undefined) options.parseCache?.set(file, { mtimeMs: info.mtimeMs, size: info.size, parsed })
      return parsed
    }),
  )
  const prepared = parsedScreens.map((parsed) => prepareScreen(parsed, loadedFixtures.collections, kit))

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
    if (candidate.root === undefined) {
      screenResults.push({
        id: previousScreen?.id ?? '',
        file: parsed.file,
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
            fixtures: loadedFixtures.collections,
            chosenSelection,
            chosenErrors: countDiagnostics([...candidate.diagnostics, ...semantic]).errors,
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
        ? { variantFixtures: loadedFixtures.collections }
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
  const journeyFiles = await listJourneyFiles(folder)
  const parsedJourneys: ParsedJourney[] = []
  for (const file of journeyFiles) {
    const source = await readOptional(join(folder, file))
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
    })
    return {
      file: parsed.file,
      id: parsed.journey?.id ?? '',
      ...(parsed.journey === undefined ? {} : { journey: parsed.journey }),
      diagnostics: sortDiagnostics([...parsed.diagnostics, ...validation]),
    }
  })

  const perScreen = screenResults.flatMap((screen) => screen.diagnostics)
  const perJourney = journeys.flatMap((journey) => journey.diagnostics)
  const allDiagnostics = sortDiagnostics([
    ...configTokenDiagnostics,
    ...screenDiagnostics,
    ...journeyDiagnostics,
    ...perScreen,
    ...perJourney,
  ])
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
    screens: screenResults,
    diagnostics: kitMismatch === undefined ? sortDiagnostics(allDiagnostics) : allDiagnostics,
    entry,
    fixtures: loadedFixtures.collections,
    journeys,
  }
}
