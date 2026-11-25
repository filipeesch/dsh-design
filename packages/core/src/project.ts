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
import { validateTree } from './validate.ts'
import { parseTokens } from './tokens.ts'
import type {
  DesignProject,
  DesignScreenNode,
  Diagnostic,
  NamedState,
  ParsedJourney,
  ParsedScreen,
  ProjectJourney,
  ProjectScreen,
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

/** Screen data after fixture expansion and state extraction. */
interface PreparedScreen {
  readonly parsed: ParsedScreen
  readonly root?: DesignScreenNode
  readonly states: readonly NamedState[]
  readonly diagnostics: readonly Diagnostic[]
}

/** Expand one parsed screen, extract its named states, and collect diagnostics. */
function prepareScreen(parsed: ParsedScreen, fixtures: DesignProject['fixtures'], kit: KitMetadata): PreparedScreen {
  if (parsed.root === undefined) {
    return { parsed, states: [], diagnostics: parsed.diagnostics }
  }
  const expanded = expandScreen(parsed.root, fixtures, parsed.file)
  const states = extractNamedStates(expanded.root, parsed.file, kit)
  return {
    parsed,
    root: states.root,
    states: states.states,
    diagnostics: [...parsed.diagnostics, ...expanded.diagnostics, ...states.diagnostics],
  }
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
      })
      continue
    }
    const semantic = validateTree(candidate.root, parsed.file, {
      kit,
      tokens: tokens.tokens,
      breakpoints: parsedConfig.config.breakpoints.map((breakpoint) => breakpoint.name),
      projectScreens: screenIds,
      designFolder: folder,
      kitVersionPin: parsedConfig.config.kitVersion,
      installedKitVersion,
    })
    const all = sortDiagnostics([...candidate.diagnostics, ...semantic])
    const hasErrors = countDiagnostics(all).errors > 0
    screenResults.push({
      id: candidate.root.id === '' ? (previousScreen?.id ?? '') : candidate.root.id,
      file: parsed.file,
      root: candidate.root,
      diagnostics: all,
      ...(hasErrors
        ? previousScreen?.lastValidRoot === undefined
          ? {}
          : { lastValidRoot: previousScreen.lastValidRoot }
        : { lastValidRoot: candidate.root }),
      states: hasErrors ? (previousScreen?.states ?? []) : candidate.states,
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
