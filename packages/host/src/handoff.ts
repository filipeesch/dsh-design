/**
 * On-demand chosen-only handoff generation into the ignored cache.
 *
 * The package contains editable chosen DSX, the support inputs it needs,
 * resolved tokens, relevant journeys, deterministic semantic boxes and canvas
 * screenshots collected from the same committed canvas, and one sorted,
 * content-addressed manifest. No review draft, comparison
 * chrome, or discarded branch is read.
 */
import { readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import {
  canonicalState,
  countDiagnostics,
  extractNamedStates,
  fingerprintDesignTree,
  parseJourney,
  parseScreen,
  parseTokens,
  validateJourney,
  type DesignChild,
  type DesignProject,
  type DesignScreenNode,
  type HandoffPlan,
  type HandoffScreenPlan,
  type NamedState,
  type ParsedJourney,
  type ProjectJourney,
  type ResolvedTokens,
} from '@filipeesch/dsh-design-core'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import {
  cacheAreaDirectory,
  packageIdentity,
  PackageError,
  publishPackage,
  safePackagePath,
  sealManifest,
  sha256Bytes,
} from './cache.ts'
import { payloadFromAssets, readSnapshot, type CheckContext, type LayoutSnapshot } from './checks.ts'
import { collectAssetsForRoots, referencedAssetPaths } from './deterministic.ts'
import { compatibleState, resolveScreenProjection } from './projection.ts'

/** Handoff-specific failure classes. */
export type HandoffErrorCode =
  | 'invalid-source'
  | 'invalid-selection'
  | 'roundtrip'
  | 'asset-unavailable'
  | 'asset-conflict'
  | 'render-failed'
  | 'package-failed'
  | 'cancelled'

/** Explicit handoff failure. */
export class HandoffError extends Error {
  readonly code: HandoffErrorCode

  constructor(code: HandoffErrorCode, message: string) {
    super(message)
    this.name = 'HandoffError'
    this.code = code
  }
}

/** Inputs for one handoff package generation. */
export interface HandoffInput {
  readonly folder: string
  readonly project: DesignProject
  readonly plan: HandoffPlan
  readonly ctx: CheckContext
}

/** One rendered projection retained in the package. */
interface RenderedProjection {
  readonly id: string
  readonly screen: string
  readonly state?: string
  readonly stateName: string
  readonly stateAssignment?: NamedState
  readonly breakpoint: { readonly name: string; readonly width: number; readonly height: number }
  readonly layoutPath: string
  readonly screenshotPath: string
  readonly layout: LayoutSnapshot
  readonly browserVersion: string
}

/** Successful handoff summary. */
export interface HandoffResult {
  readonly path: string
  readonly manifest: string
  readonly id: string
  readonly reused: boolean
  readonly screens: readonly string[]
  readonly supportingScreens: readonly string[]
  readonly breakpoints: readonly string[]
  readonly projections: number
  readonly counts: {
    readonly screens: number
    readonly supportingScreens: number
    readonly layouts: number
    readonly screenshots: number
    readonly journeys: number
    readonly assets: number
  }
  readonly bytes: number
  readonly warnings: readonly string[]
}

/** One immutable source snapshot used for files and rendering. */
interface HandoffSnapshot {
  readonly tokenSource: string
  readonly tokenTable: ResolvedTokens
  readonly journeySources: ReadonlyMap<string, string>
  readonly journeys: ReadonlyMap<string, NonNullable<ProjectJourney['journey']>>
  readonly assets: Readonly<Record<string, string>>
  readonly payload: ReturnType<typeof payloadFromAssets>
}

const HANDOFF_FORMAT = 'dsh-design-handoff/v1'
const HANDOFF_README = `# Design handoff

This folder is an on-demand implementation contract generated from a validated
chosen design. It is derived cache, not a source of truth; do not commit it.

Read \`manifest.json\` first. It names the effective screens, named states, and
breakpoints, and lists every artifact with its size and SHA-256 digest.

- \`screens/*.dsx\` is editable DSX for the chosen projection only. It keeps
  stable ids, declarative interactions, and named screen states; variant
  wrappers and non-chosen branches are absent.
- \`tokens.json\` and \`tokens.resolved.json\` are the support tokens and the
  resolved token table.
- \`layout/*.json\` holds CSS-pixel semantic boxes from the committed canvas.
- \`screenshots/*.png\` is the matching canvas image for each layout.
- \`journeys/*.dsx\` holds relevant acceptance flows. The manifest marks any
  screen a journey needs outside this package.
- Local raster assets are copied at the same relative paths the DSX references.

Consume the package with ordinary file access. Do not call handoff from an
implementation session, do not edit the package in place, and regenerate it
when the chosen design changes.
`

/** Read one project-relative support file without escaping the design folder. */
async function readSupportFile(folder: string, relativePath: string): Promise<string> {
  if (!safePackagePath(relativePath))
    throw new HandoffError('invalid-source', 'Unsafe support file path "' + relativePath + '".')
  const root = await realpath(folder).catch(() => undefined)
  if (root === undefined) throw new HandoffError('invalid-source', 'The design folder is missing.')
  const target = resolve(root, relativePath)
  const real = await realpath(target).catch(() => undefined)
  if (real === undefined || (real !== root && !real.startsWith(root + sep))) {
    throw new HandoffError('invalid-source', 'Support file "' + relativePath + '" escapes the design folder.')
  }
  return await readFile(real, 'utf8')
}

/** Decode one validated raster data URI from deterministic asset collection. */
function decodeAsset(data: string): Buffer {
  const comma = data.indexOf(',')
  if (comma < 0) throw new HandoffError('asset-unavailable', 'A local asset could not be decoded.')
  return Buffer.from(data.slice(comma + 1), 'base64')
}

/** Whether an asset path would collide with a generated package namespace. */
function reservedAssetPath(path: string): boolean {
  return (
    path === 'manifest.json' ||
    path === 'README.md' ||
    path === 'design.json' ||
    path === 'tokens.json' ||
    path === 'tokens.resolved.json' ||
    path.startsWith('screens/') ||
    path.startsWith('journeys/') ||
    path.startsWith('layout/') ||
    path.startsWith('screenshots/')
  )
}

/** Convert one journey step to a source-location-free acceptance entry. */
function journeyStep(
  step: NonNullable<HandoffPlan['journeys'][number]['journey']>['steps'][number],
): Record<string, unknown> {
  switch (step.kind) {
    case 'tap':
      return { kind: 'tap', target: step.target }
    case 'type':
      return { kind: 'type', target: step.target, value: step.value }
    case 'choose':
      return { kind: 'choose', target: step.target, value: step.value }
    case 'navigate':
      return { kind: 'navigate', screen: step.screen }
    case 'expect-screen':
      return { kind: 'expect-screen', screen: step.screen }
    case 'expect-visible':
      return { kind: 'expect-visible', target: step.target, visible: step.visible }
    case 'expect-value':
      return { kind: 'expect-value', target: step.target, value: step.value }
    case 'expect-count':
      return { kind: 'expect-count', target: step.target, count: step.count }
    default:
      return { kind: 'unknown' }
  }
}

/** Source-location-free journey signature used to compare reread bytes. */
function journeySignature(journey: NonNullable<ProjectJourney['journey']>): string {
  return JSON.stringify({
    id: journey.id,
    start: journey.start,
    state: journey.state ?? null,
    breakpoint: journey.breakpoint ?? null,
    steps: journey.steps.map(journeyStep),
  })
}

/** Source-location-free token table signature used to compare reread bytes. */
function tokenSignature(tokens: ResolvedTokens): string {
  return JSON.stringify({
    cssText: tokens.cssText,
    tokens: Object.keys(tokens.tokens)
      .sort((left, right) => left.localeCompare(right))
      .map((path) => {
        const token = tokens.tokens[path]!
        return { path: token.path, type: token.type, value: token.value, cssVar: token.cssVar }
      }),
  })
}

/**
 * Parsed source keeps an id in both node.id and props; expanded fixture nodes
 * keep it only in node.id. Normalize that representation before comparing the
 * printed tree, without changing the DSX printed to the package.
 */
function normalizedIdTree(node: DesignChild | DesignScreenNode): DesignChild | DesignScreenNode {
  if (node.kind === 'text') return node
  const props = { ...node.props }
  if (node.id !== undefined && node.id !== '') props.id = node.id
  return { ...node, props, children: node.children.map((child) => normalizedIdTree(child)) }
}

/** Verify one printed screen round-trips to the same ids, behavior, and states. */
function verifyRoundTrip(screen: HandoffScreenPlan): void {
  const file = 'screens/' + screen.id + '.dsx'
  const parsed = parseScreen(screen.source, file)
  const errors = countDiagnostics(parsed.diagnostics).errors
  if (errors > 0 || parsed.root === undefined) {
    const first = parsed.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
    throw new HandoffError(
      'roundtrip',
      'The normalized DSX for screen "' +
        screen.id +
        '" did not parse' +
        (first === undefined ? '.' : ': ' + first.line + ':' + first.column + ' ' + first.message),
    )
  }
  const extracted = extractNamedStates(parsed.root, file, kitMetadata)
  if (countDiagnostics(extracted.diagnostics).errors > 0) {
    throw new HandoffError(
      'roundtrip',
      'The normalized DSX for screen "' + screen.id + '" failed named-state validation.',
    )
  }
  if (
    fingerprintDesignTree(extracted.root) !== fingerprintDesignTree(normalizedIdTree(screen.root) as DesignScreenNode)
  ) {
    throw new HandoffError(
      'roundtrip',
      'The normalized DSX for screen "' + screen.id + '" changed ids, behavior, text, or structure.',
    )
  }
  const left = JSON.stringify(screen.states.map(canonicalState))
  const right = JSON.stringify(extracted.states.map(canonicalState))
  if (left !== right) {
    throw new HandoffError('roundtrip', 'The normalized DSX for screen "' + screen.id + '" changed its named states.')
  }
  if (screen.source.includes('<Variants')) {
    throw new HandoffError(
      'roundtrip',
      'The normalized DSX for screen "' + screen.id + '" still contains variant wrappers.',
    )
  }
}

/** Render one requested projection from the immutable payload snapshot. */
async function renderProjection(
  input: HandoffInput,
  payload: ReturnType<typeof payloadFromAssets>,
  screenId: string,
  state: string | undefined,
  breakpoint: { name: string; width: number },
): Promise<{ snapshot: LayoutSnapshot; screenshot: Buffer; browserVersion: string }> {
  const projection = resolveScreenProjection(input.project, screenId)
  const source = projection.screen
  if (source.root === undefined || (source.blockingErrors ?? 0) > 0) {
    throw new HandoffError('invalid-source', 'Screen "' + screenId + '" has no current valid chosen tree.')
  }
  compatibleState(source, source.states, state)
  return await input.ctx.browsers.run(
    {
      sessionId: input.ctx.sessionId,
      payload,
      assetsDir: input.ctx.assetsDir,
      screen: screenId,
      breakpoint: breakpoint.name,
      breakpointWidth: breakpoint.width,
      ...(state === undefined ? {} : { state }),
      ...(input.ctx.signal === undefined ? {} : { signal: input.ctx.signal }),
      ...(input.ctx.timeoutMs === undefined ? {} : { timeoutMs: input.ctx.timeoutMs }),
    },
    async (page) => {
      const snapshot = await readSnapshot(page, screenId, breakpoint.name, state)
      const screenshot = await page.locator('.dsx-frame').screenshot({
        type: 'png',
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      })
      return { snapshot, screenshot, browserVersion: page.context().browser()?.version() ?? 'unknown' }
    },
  )
}

/** Read an abort signal without narrowing the caller's variable. */
function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/** Snapshot and exactly revalidate support bytes before any render. */
async function snapshotHandoffSources(
  input: HandoffInput,
  allScreens: readonly HandoffScreenPlan[],
): Promise<HandoffSnapshot> {
  const tokenSource = await readSupportFile(input.folder, 'tokens.json')
  const tokenTable = parseTokens(tokenSource, 'tokens.json')
  if (countDiagnostics(tokenTable.diagnostics).errors > 0) {
    throw new HandoffError(
      'invalid-source',
      'tokens.json changed after the project was validated and is no longer valid.',
    )
  }
  if (tokenSignature(tokenTable) !== tokenSignature(input.project.tokens)) {
    throw new HandoffError('invalid-source', 'tokens.json changed after the project was validated.')
  }

  const journeySources = new Map<string, string>()
  const journeys = new Map<string, NonNullable<ProjectJourney['journey']>>()
  const screensById = new Map(allScreens.map((screen) => [screen.id, screen]))
  const projectScreens = allScreens.map((screen) => screen.id)
  const breakpoints = input.plan.allBreakpoints.map((breakpoint) => breakpoint.name)
  for (const journey of input.plan.journeys) {
    if (journeySources.has(journey.file)) continue
    const source = await readSupportFile(input.folder, journey.file)
    const parsed: ParsedJourney = parseJourney(source, journey.file)
    if (parsed.journey === undefined) {
      throw new HandoffError(
        'invalid-source',
        'Journey "' + journey.file + '" changed after the project was validated.',
      )
    }
    const validation = validateJourney(parsed, {
      projectScreens,
      breakpoints,
      rootOf: (screen) => screensById.get(screen)?.root,
      statesOf: (screen) => screensById.get(screen)?.states ?? [],
    })
    const errors = [...parsed.diagnostics, ...validation].filter((diagnostic) => diagnostic.severity === 'error')
    if (errors.length > 0) {
      const first = errors[0]!
      throw new HandoffError(
        'invalid-source',
        'Journey "' +
          journey.file +
          '" changed after the project was validated: ' +
          first.file +
          ':' +
          String(first.line) +
          ':' +
          String(first.column) +
          ' ' +
          first.message,
      )
    }
    if (journeySignature(parsed.journey) !== journeySignature(journey.journey)) {
      throw new HandoffError(
        'invalid-source',
        'Journey "' + journey.file + '" changed after the project was validated.',
      )
    }
    journeySources.set(journey.file, source)
    journeys.set(parsed.journey.id, parsed.journey)
  }

  const roots = allScreens.map((screen) => screen.root)
  const expectedAssets = referencedAssetPaths(roots)
  const assets = await collectAssetsForRoots(input.folder, roots)
  const missingAssets = expectedAssets.filter((path) => assets[path] === undefined)
  if (missingAssets.length > 0) {
    throw new HandoffError(
      'asset-unavailable',
      'Selected and supporting screens reference local raster assets that are missing, invalid, or over the size bound: ' +
        missingAssets.join(', ') +
        '.',
    )
  }
  return {
    tokenSource,
    tokenTable,
    journeySources,
    journeys,
    assets,
    payload: payloadFromAssets(input.project, input.ctx.sessionId, { ...assets }),
  }
}

/** Build and publish a handoff package for one validated plan. */
export async function runHandoff(input: HandoffInput): Promise<HandoffResult> {
  if (input.plan.projections.length === 0)
    throw new HandoffError('invalid-selection', 'The handoff selection is empty.')
  if (aborted(input.ctx.signal)) throw new HandoffError('cancelled', 'The design handoff was cancelled.')
  const allScreens = [...input.plan.screens, ...input.plan.supportingScreens]
  for (const screen of allScreens) verifyRoundTrip(screen)

  const snapshot = await snapshotHandoffSources(input, allScreens)
  if (aborted(input.ctx.signal)) throw new HandoffError('cancelled', 'The design handoff was cancelled.')

  const files: Record<string, Buffer | string> = {
    'README.md': HANDOFF_README,
    'tokens.json': snapshot.tokenSource,
  }
  const closure = new Set(allScreens.map((screen) => screen.id))
  const entry =
    input.project.entry !== undefined && closure.has(input.project.entry)
      ? input.project.entry
      : input.plan.screens[0]?.id
  const generatedConfig = {
    kitVersion: input.project.config.kitVersion,
    breakpoints: Object.fromEntries(input.plan.allBreakpoints.map((breakpoint) => [breakpoint.name, breakpoint.width])),
    ...(entry === undefined ? {} : { entry }),
  }
  files['design.json'] = JSON.stringify(generatedConfig, null, 2) + '\n'

  const resolvedTokens = Object.keys(snapshot.tokenTable.tokens)
    .sort((left, right) => left.localeCompare(right))
    .map((path) => {
      const token = snapshot.tokenTable.tokens[path]!
      return { path: token.path, type: token.type, value: token.value, cssVar: token.cssVar }
    })
  files['tokens.resolved.json'] =
    JSON.stringify({ format: 'dsh-design-tokens/v1', tokens: resolvedTokens }, null, 2) + '\n'

  for (const screen of allScreens) files['screens/' + screen.id + '.dsx'] = screen.source
  for (const [path, source] of snapshot.journeySources) files[path] = source

  const assetPaths = Object.keys(snapshot.assets).sort((left, right) => left.localeCompare(right))
  for (const path of assetPaths) {
    if (reservedAssetPath(path)) {
      throw new HandoffError(
        'asset-conflict',
        'Local asset path "' + path + '" collides with a generated handoff path.',
      )
    }
    files[path] = decodeAsset(snapshot.assets[path]!)
  }

  const rendered: RenderedProjection[] = []
  for (const projection of input.plan.projections) {
    if (aborted(input.ctx.signal)) throw new HandoffError('cancelled', 'The design handoff was cancelled.')
    const result = await renderProjection(
      input,
      snapshot.payload,
      projection.screen,
      projection.state,
      projection.breakpoint,
    )
    const layoutPath = 'layout/' + projection.id + '.json'
    const screenshotPath = 'screenshots/' + projection.id + '.png'
    const layout = {
      format: 'dsh-design-layout/v1',
      projection: projection.id,
      screen: projection.screen,
      state: projection.state ?? null,
      stateName: projection.stateName,
      stateAssignment: canonicalState(projection.stateAssignment),
      breakpoint: {
        name: projection.breakpoint.name,
        width: projection.breakpoint.width,
        height: input.ctx.browsers.viewportHeight,
      },
      canvas: result.snapshot.canvas,
      nodes: result.snapshot.nodes,
      truncated: result.snapshot.truncated,
    }
    files[layoutPath] = JSON.stringify(layout, null, 2) + '\n'
    files[screenshotPath] = result.screenshot
    rendered.push({
      id: projection.id,
      screen: projection.screen,
      ...(projection.state === undefined ? {} : { state: projection.state }),
      stateName: projection.stateName,
      ...(projection.stateAssignment === undefined ? {} : { stateAssignment: projection.stateAssignment }),
      breakpoint: {
        name: projection.breakpoint.name,
        width: projection.breakpoint.width,
        height: input.ctx.browsers.viewportHeight,
      },
      layoutPath,
      screenshotPath,
      layout: result.snapshot,
      browserVersion: result.browserVersion,
    })
  }

  const browserVersion = rendered[0]?.browserVersion ?? 'unknown'
  const environment = {
    engine: 'chromium',
    version: browserVersion,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    viewportHeight: input.ctx.browsers.viewportHeight,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezone: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  }
  const sourceDigest = sha256Bytes(
    JSON.stringify({
      screens: allScreens.map((screen) => [screen.id, screen.role, screen.supportReasons, sha256Bytes(screen.source)]),
      tokens: sha256Bytes(snapshot.tokenSource),
      journeys: [...snapshot.journeySources.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, source]) => [path, sha256Bytes(source)]),
      assets: assetPaths.map((path) => [path, sha256Bytes(files[path] as Buffer)]),
      selection: input.plan.projections.map((projection) => projection.id),
    }),
  )

  const warnings = input.plan.journeys
    .filter((journey) => journey.outsideScreens.length > 0)
    .map(
      (journey) =>
        'Journey "' +
        journey.id +
        '" requires supporting screen(s) outside the requested matrix: ' +
        journey.outsideScreens.join(', ') +
        '.',
    )
  const manifestBase = {
    format: HANDOFF_FORMAT,
    sourceDigest,
    kit: { pin: input.project.config.kitVersion, installed: KIT_VERSION },
    renderer: {
      pipeline: 'deterministic-preview',
      version: '1',
      kitVersion: input.project.config.kitVersion,
      installedKitVersion: KIT_VERSION,
    },
    environment,
    selection: {
      screens: input.plan.screens.map((screen) => screen.id),
      states: [...new Set(input.plan.projections.map((projection) => projection.stateName))],
      breakpoints: input.plan.breakpoints.map((breakpoint) => breakpoint.name),
      projections: input.plan.projections.length,
    },
    support: {
      screens: input.plan.supportingScreens.map((screen) => ({
        id: screen.id,
        reasons: screen.supportReasons,
      })),
      breakpoints: input.plan.allBreakpoints.map((breakpoint) => ({
        name: breakpoint.name,
        width: breakpoint.width,
      })),
    },
    screens: allScreens.map((screen) => ({
      id: screen.id,
      file: 'screens/' + screen.id + '.dsx',
      role: screen.role,
      supportReasons: screen.supportReasons,
      states: screen.states.map(canonicalState),
      chosen: screen.chosen,
      fingerprint: fingerprintDesignTree(normalizedIdTree(screen.root) as DesignScreenNode),
    })),
    projections: rendered.map((projection) => ({
      id: projection.id,
      screen: projection.screen,
      state: projection.state ?? null,
      stateName: projection.stateName,
      stateAssignment: canonicalState(projection.stateAssignment),
      breakpoint: projection.breakpoint,
      layout: projection.layoutPath,
      screenshot: projection.screenshotPath,
      canvas: projection.layout.canvas,
      nodes: projection.layout.nodes.length,
      truncated: projection.layout.truncated,
    })),
    tokens: {
      source: 'tokens.json',
      resolved: 'tokens.resolved.json',
      count: resolvedTokens.length,
      digest: sha256Bytes(snapshot.tokenSource),
    },
    assets: assetPaths,
    journeys: input.plan.journeys.map((journey) => {
      const parsed = snapshot.journeys.get(journey.id) ?? journey.journey
      return {
        id: parsed.id,
        file: journey.file,
        start: parsed.start,
        state: parsed.state ?? null,
        breakpoint: parsed.breakpoint ?? null,
        steps: parsed.steps.map(journeyStep),
        requiresScreens: journey.requiresScreens,
        outsideScreens: journey.outsideScreens,
      }
    }),
    warnings,
  }
  const manifest = sealManifest(manifestBase, files)
  let published
  try {
    published = await publishPackage({
      folder: input.folder,
      area: 'handoff',
      id: manifest.id,
      manifest,
      files,
      ...(input.ctx.signal === undefined ? {} : { signal: input.ctx.signal }),
    })
  } catch (error) {
    if (error instanceof PackageError && error.code === 'cancelled') {
      throw new HandoffError('cancelled', 'The design handoff was cancelled before publication completed.')
    }
    throw error
  }
  const bytes = manifest.files.reduce((total, file) => total + file.bytes, 0)
  return {
    path: published.path,
    manifest: published.path + '/manifest.json',
    id: manifest.id,
    reused: published.reused,
    screens: input.plan.screens.map((screen) => screen.id),
    supportingScreens: input.plan.supportingScreens.map((screen) => screen.id),
    breakpoints: input.plan.breakpoints.map((breakpoint) => breakpoint.name),
    projections: input.plan.projections.length,
    counts: {
      screens: input.plan.screens.length,
      supportingScreens: input.plan.supportingScreens.length,
      layouts: rendered.length,
      screenshots: rendered.length,
      journeys: input.plan.journeys.length,
      assets: assetPaths.length,
    },
    bytes,
    warnings,
  }
}

/** Re-exported for tools that need the canonical handoff cache path. */
export async function handoffCache(folder: string): Promise<string> {
  return cacheAreaDirectory(folder, 'handoff')
}

/** Re-exported for tests that want to verify an id without a package. */
export { packageIdentity }
