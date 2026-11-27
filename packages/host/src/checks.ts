/**
 * Headless checks over the same validated kit and deterministic document as the
 * preview: semantic layout snapshots, layout lint, journey execution, and
 * explicit canvas screenshots.
 */
import { createHash, randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  canonicalVariantIdentity,
  countDiagnostics,
  findNode,
  resolveProjectTheme,
  stateCompatibility,
  type DesignChild,
  type DesignScreenNode,
  type DesignProject,
  type Diagnostic,
  type NamedState,
  type ProjectScreen,
} from '@filipeesch/dsh-design-core'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import {
  DEFAULT_CHECK_TIMEOUT_MS,
  DesignBrowserError,
  designBrowserErrorCode,
  settleFrame,
  type BrowserSessions,
} from './browser.ts'
import { cacheAreaDirectory, revalidateCacheArea } from './cache.ts'
import {
  collectAssetsForRoots,
  collectDeterministicAssets,
  collectMediaSnapshot,
  collectSelectedMedia,
  diagnoseMedia,
  type MediaDiagnostic,
} from './deterministic.ts'
import { buildPayload, type PreviewPayload } from './payload.ts'
import {
  compatibleState,
  requireCurrentProjection,
  resolveScreenProjection,
  type ResolvedVariant,
} from './projection.ts'

/** One measured semantic node, in CSS pixels relative to the canvas. */
export interface LayoutNode {
  readonly id?: string
  readonly address?: string
  readonly type: string
  readonly role?: string
  readonly name?: string
  readonly visible: boolean
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Bounded semantic snapshot of a rendered screen. */
export interface LayoutSnapshot {
  readonly screen: string
  readonly state?: string
  readonly theme: string
  readonly breakpoint: string
  readonly canvas: { readonly width: number; readonly height: number }
  readonly nodes: readonly LayoutNode[]
  readonly truncated: boolean
}

/** One layout lint rule finding. */
export interface LintFinding {
  readonly rule: string
  readonly severity: 'error' | 'warning'
  readonly screen: string
  readonly breakpoint?: string
  readonly nodes: readonly string[]
  readonly message: string
  readonly evidence: Readonly<Record<string, string | number>>
}

/** Lint result across the requested breakpoints. */
export interface LintResult {
  readonly screen: string
  readonly state?: string
  readonly theme: string
  readonly breakpoints: readonly string[]
  readonly selection: Readonly<Record<string, string>>
  readonly variant?: ResolvedVariant
  readonly media: readonly MediaDiagnostic[]
  readonly findings: readonly LintFinding[]
  readonly errors: number
  readonly warnings: number
}

/** One executed journey step. */
export interface JourneyStepResult {
  readonly index: number
  readonly kind: string
  readonly status: 'passed' | 'failed'
  readonly target?: string
  readonly expected?: string
  readonly observed?: string
  readonly message?: string
}

/** Outcome of one journey run. */
export interface JourneyResult {
  readonly journey: string
  readonly screen: string
  readonly state?: string
  readonly breakpoint: string
  readonly theme?: string
  readonly ok: boolean
  readonly steps: readonly JourneyStepResult[]
  readonly snapshot?: LayoutSnapshot
  readonly error?: string
  readonly diagnostics?: readonly Diagnostic[]
}

/** One written screenshot. */
export interface ScreenshotResult {
  readonly path: string
  readonly screen: string
  readonly state?: string
  readonly breakpoint: string
  readonly highlight?: string
  readonly theme: string
  readonly selection: Readonly<Record<string, string>>
  readonly variant?: ResolvedVariant
  readonly media: readonly MediaDiagnostic[]
  readonly width: number
  readonly height: number
  readonly bytes: number
}

/** Services one headless check needs. */
export interface CheckContext {
  readonly sessionId: string
  readonly browsers: Pick<BrowserSessions, 'run' | 'viewportHeight'> & Partial<Pick<BrowserSessions, 'checkTimeoutMs'>>
  readonly assetsDir: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/** Resolved breakpoint width, or an explicit input error. */
function breakpointWidth(project: DesignProject, name: string): number {
  const breakpoint = project.config.breakpoints.find((candidate) => candidate.name === name)
  if (breakpoint === undefined) {
    throw new Error(
      'Unknown breakpoint "' +
        name +
        '"; configured breakpoints: ' +
        (project.config.breakpoints.map((candidate) => candidate.name).join(', ') || 'none') +
        '.',
    )
  }
  return breakpoint.width
}

/** Widest configured breakpoint, the preview default. */
export function defaultBreakpoint(project: DesignProject): string {
  const ordered = [...project.config.breakpoints].sort((left, right) => right.width - left.width)
  if (ordered[0] === undefined) throw new Error('The project configures no breakpoints.')
  return ordered[0].name
}

/** Selection arguments shared by static inspection and browser checks. */
export interface CheckSelectionOptions {
  readonly state?: string
  readonly variant?: string
  readonly breakpoint?: string
  readonly theme?: string
}

/** Resolve the exact source, state and breakpoint coverage before any browser work. */
export function resolveCheckSelection(
  project: DesignProject,
  screenId: string,
  options: CheckSelectionOptions,
  mode: 'static' | 'one' | 'all',
) {
  const projection =
    mode === 'static'
      ? resolveScreenProjection(project, screenId, options.variant)
      : requireCurrentProjection(project, screenId, options.variant)
  return resolveProjectionSelection(project, projection, options, mode)
}

function resolveProjectionSelection(
  project: DesignProject,
  projection: ReturnType<typeof resolveScreenProjection>,
  options: CheckSelectionOptions,
  mode: 'static' | 'one' | 'all',
) {
  const { screen, variant } = projection
  const screenId = screen.id
  if (screen.root === undefined)
    throw new Error('Screen "' + screenId + '" has no parsed tree; fix its diagnostics first.')
  if (mode !== 'static') {
    const fatal = project.diagnostics.find(
      (item) =>
        item.severity === 'error' &&
        (item.file === 'design.json' ||
          item.file === 'tokens.json' ||
          item.code === 'kit-version-mismatch' ||
          item.code === 'project-missing'),
    )
    if (fatal !== undefined) throw new Error(fatal.message)
  }
  const named = compatibleState(screen, screen.states, options.state)
  const names =
    options.breakpoint !== undefined
      ? [options.breakpoint]
      : mode === 'all'
        ? project.config.breakpoints.map(({ name }) => name)
        : mode === 'one'
          ? [defaultBreakpoint(project)]
          : []
  if (mode !== 'static' && names.length === 0) throw new Error('The project configures no breakpoints.')
  const breakpoints = names.map((name) => ({ name, width: breakpointWidth(project, name) }))
  const selection = variant?.selection ?? screen.chosenSelection ?? {}
  const theme = resolveProjectTheme(project, options.theme).name
  return { screen, root: screen.root, variant, named, breakpoints, selection, theme }
}

type CheckSelection = ReturnType<typeof resolveCheckSelection>

/** Review coordinates are temporary and never carry typed field values. */
export interface ReviewContext {
  readonly screen?: string
  readonly selection?: string
  readonly theme?: string
  readonly open?: readonly string[]
  readonly tabs?: Readonly<Record<string, string>>
  readonly disclosures?: Readonly<Record<string, boolean>>
}

export interface GeometryCase {
  readonly breakpoint: string
  readonly state?: string
  readonly theme?: string
  readonly reviewContext?: ReviewContext
}

export interface GeometryOptions {
  readonly variant?: string
  readonly nodes: readonly string[]
  readonly cases: readonly GeometryCase[]
}

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type GeometryNode = { readonly id: string } & (
  { readonly status: 'visible'; readonly box: Box } | { readonly status: 'hidden' | 'absent' }
)

interface GeometryMeasurement {
  readonly breakpoint: string
  readonly state?: string
  readonly theme: string
  readonly rendition: 'current'
  readonly reviewContext?: true
  readonly canvas: LayoutSnapshot['canvas']
  readonly nodes: readonly GeometryNode[]
  readonly media: readonly MediaDiagnostic[]
}

export interface GeometryResult {
  readonly screen: string
  readonly selection: Readonly<Record<string, string>>
  readonly variant?: ResolvedVariant
  readonly sourceIdentity: string
  readonly cases: readonly GeometryMeasurement[]
}

const STABLE_ID = /^[a-z][a-z0-9-]*$/
const stableId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 160 && STABLE_ID.test(value)
const MAX_REVIEW_ENTRIES = 100

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}

function reviewMap<T>(value: unknown, isValue: (value: unknown) => value is T): value is Record<string, T> {
  if (!record(value)) return false
  const entries = Object.entries(value)
  return entries.length <= MAX_REVIEW_ENTRIES && entries.every(([key, item]) => stableId(key) && isValue(item))
}

function reviewSeed(selected: CheckSelection, review: ReviewContext): NamedState {
  if (!record(review)) throw new Error('reviewContext must be an object.')
  for (const key of Object.keys(review)) {
    if (!['screen', 'selection', 'theme', 'open', 'tabs', 'disclosures'].includes(key))
      throw new Error('Unsupported reviewContext field "' + key + '"; only safe interaction coordinates are accepted.')
  }
  if (review.screen !== undefined && review.screen !== selected.screen.id)
    throw new Error('Review context is stale: screen does not match "' + selected.screen.id + '".')
  if (review.selection !== undefined && review.selection !== (canonicalVariantIdentity(selected.selection) ?? ''))
    throw new Error('Review context is stale: it belongs to a different branch selection.')
  if (review.theme !== undefined && review.theme !== selected.theme)
    throw new Error('Review context theme does not match the case theme.')
  if (
    review.open !== undefined &&
    (!Array.isArray(review.open) ||
      review.open.length > MAX_REVIEW_ENTRIES ||
      !review.open.every(stableId) ||
      new Set(review.open).size !== review.open.length)
  )
    throw new Error('reviewContext.open must be a bounded list of distinct stable overlay IDs.')
  if (
    review.tabs !== undefined &&
    !reviewMap(review.tabs, (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 160)
  )
    throw new Error('reviewContext.tabs must map stable Tabs IDs to tab values.')
  if (
    review.disclosures !== undefined &&
    !reviewMap(review.disclosures, (item): item is boolean => typeof item === 'boolean')
  )
    throw new Error('reviewContext.disclosures must map stable Disclosure IDs to booleans.')
  const named = selected.named
  const seed: NamedState = {
    name: named?.name ?? 'review-context',
    source: named?.source ?? selected.root.source,
    open: [...(review.open ?? named?.open ?? [])],
    tabs: { ...named?.tabs, ...review.tabs },
    values: { ...named?.values },
    disclosures: { ...named?.disclosures, ...review.disclosures },
  }
  const issues = stateCompatibility(selected.root, seed, kitMetadata)
  if (issues.length > 0) throw new Error('Review context is stale or incompatible: ' + issues.join('; ') + '.')
  return seed
}

/** Serialize the validated projection, without a second variant resolution. */
function selectedPayload(
  project: DesignProject,
  session: string,
  selected: CheckSelection,
  assets: Record<string, string>,
  seed?: NamedState,
) {
  const scoped = {
    ...project,
    screens: [{ ...selected.screen, lastValidRoot: undefined, chosenSelection: selected.selection }],
  }
  return payloadFromAssets(scoped, session, assets, undefined, {
    theme: selected.theme,
    ...(seed === undefined ? {} : { initialState: { screen: selected.screen.id, seed } }),
  })
}

async function selectedRender(project: DesignProject, session: string, selected: CheckSelection, breakpoint: string) {
  const media = await collectSelectedMedia(
    project.folder,
    selected.root,
    selected.screen.file,
    project.config.breakpoints,
    breakpoint,
  )
  return { media, payload: selectedPayload(project, session, selected, media.assets) }
}

export interface LayoutFocus {
  readonly node?: string
  readonly depth?: number
}

interface SnapshotFocus {
  readonly ids?: readonly string[]
  readonly addresses?: readonly string[]
}

function focusSelection(root: DesignScreenNode, { node, depth }: LayoutFocus): SnapshotFocus {
  if (depth !== undefined && (!Number.isSafeInteger(depth) || depth < 0))
    throw new Error('depth must be a nonnegative integer.')
  if (node === undefined && depth === undefined) return {}
  const subtree = node === undefined ? root : findNode(root, node)
  if (subtree === undefined) throw new Error('Screen "' + root.id + '" has no node "' + node + '".')
  const ids: string[] = []
  const addresses: string[] = []
  function visit(element: DesignChild, level: number) {
    if (element.kind !== 'element') return
    if (element.id === undefined) addresses.push(element.address.label)
    else ids.push(element.id)
    if (level < (depth ?? 40)) for (const child of element.children) visit(child, level + 1)
  }
  visit(subtree, 0)
  return { ids, addresses }
}

/** Measure an already validated selection, scoping the DOM read before its cap. */
export async function measureSelection(
  ctx: CheckContext,
  project: DesignProject,
  selected: CheckSelection,
  focus: LayoutFocus = {},
) {
  const breakpoint = selected.breakpoints[0]
  if (breakpoint === undefined) throw new Error('No breakpoint was selected for measurement.')
  const { screen, named, theme } = selected
  const scope = focusSelection(selected.root, focus)
  const { payload, media } = await selectedRender(project, ctx.sessionId, selected, breakpoint.name)
  return render(
    { ctx, project, payload, screen: screen.id, breakpoint: breakpoint.name, state: named?.name, theme },
    async (page) => ({
      layout: await readSnapshot(page, screen.id, breakpoint.name, named?.name, theme, scope),
      media: await diagnoseMedia(page, media),
    }),
  )
}

/** Compare explicit cases on one source and media snapshot; never write artifacts. */
export async function runGeometry(
  ctx: CheckContext,
  project: DesignProject,
  screenId: string,
  options: GeometryOptions,
): Promise<GeometryResult> {
  const timeout = ctx.timeoutMs ?? ctx.browsers.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS
  const deadline = Date.now() + timeout
  const remaining = () => {
    if (ctx.signal?.aborted) throw new DesignBrowserError('cancelled', 'The geometry batch was cancelled.')
    const time = deadline - Date.now()
    if (time <= 0)
      throw new DesignBrowserError('timeout', 'The geometry batch exceeded its ' + timeout + ' ms timeout.')
    return time
  }
  remaining()
  if (
    !Array.isArray(options.nodes) ||
    options.nodes.length < 1 ||
    options.nodes.length > 24 ||
    !options.nodes.every(stableId) ||
    new Set(options.nodes).size !== options.nodes.length
  )
    throw new Error('geometry nodes must be 1–24 distinct stable IDs.')
  if (!Array.isArray(options.cases) || options.cases.length < 1 || options.cases.length > 6)
    throw new Error('geometry requires 1–6 explicit cases.')
  const nodes = [...options.nodes]
  const projection = requireCurrentProjection(project, screenId, options.variant)
  const resolved = options.cases.map((item, index) => {
    try {
      if (!record(item) || typeof item.breakpoint !== 'string' || item.breakpoint === '')
        throw new Error('breakpoint is required.')
      if (Object.keys(item).some((key) => !['breakpoint', 'state', 'theme', 'reviewContext'].includes(key)))
        throw new Error('only breakpoint, state, theme, and reviewContext may be selected per case.')
      if (item.reviewContext !== undefined && !record(item.reviewContext))
        throw new Error('reviewContext must be an object.')
      const theme = item.theme ?? item.reviewContext?.theme
      if (
        (item.state !== undefined && typeof item.state !== 'string') ||
        (theme !== undefined && typeof theme !== 'string')
      )
        throw new Error('state and theme must be names.')
      const selected = resolveProjectionSelection(
        project,
        projection,
        { breakpoint: item.breakpoint, state: item.state, theme },
        'one',
      )
      const seed = item.reviewContext === undefined ? undefined : reviewSeed(selected, item.reviewContext)
      return { selected, seed, breakpoint: item.breakpoint }
    } catch (error) {
      throw new Error(
        'Geometry case ' + (index + 1) + ': ' + (error instanceof Error ? error.message : String(error)),
        { cause: error },
      )
    }
  })
  const { root, screen, selection, variant } = resolved[0]!.selected
  const existing = new Set(nodes.filter((id) => findNode(root, id) !== undefined))
  const assets = await collectMediaSnapshot(
    project.folder,
    root,
    screen.file,
    project.config.breakpoints,
    resolved.map(({ breakpoint }) => breakpoint),
  )
  const cases: GeometryMeasurement[] = []
  for (const { selected, seed, breakpoint } of resolved) {
    const { named, theme } = selected
    const payload = selectedPayload(project, ctx.sessionId, selected, assets.assets, seed)
    const result = await render(
      {
        ctx: { ...ctx, timeoutMs: remaining() },
        project,
        payload,
        screen: screenId,
        breakpoint,
        state: named?.name,
        theme,
      },
      async (page) => {
        const layout = await readSnapshot(page, screenId, breakpoint, named?.name, theme, { ids: [...existing] }, true)
        const visible = new Map(layout.nodes.map((node) => [node.id, node]))
        const geometry: GeometryNode[] = nodes.map((id) => {
          const box = visible.get(id)
          if (box === undefined) return { id, status: existing.has(id) ? 'hidden' : 'absent' }
          const { x, y, width, height } = box
          return { id, status: 'visible', box: { x, y, width, height } }
        })
        return { canvas: layout.canvas, nodes: geometry, media: await diagnoseMedia(page, assets.at(breakpoint)) }
      },
    )
    remaining()
    cases.push({
      breakpoint,
      theme,
      rendition: 'current',
      ...(named === undefined ? {} : { state: named.name }),
      ...(seed === undefined ? {} : { reviewContext: true }),
      ...result,
    })
  }
  return {
    screen: screenId,
    selection,
    ...(variant === undefined ? {} : { variant }),
    sourceIdentity: project.sourceIdentity,
    cases,
  }
}

/** Build the immutable preview payload from a pre-collected asset snapshot. */
export function payloadFromAssets(
  project: DesignProject,
  session: string,
  assets: Record<string, string>,
  variant?: { screen: string; group: string; branch: string },
  options?: { theme?: string; initialState?: { screen: string; seed: NamedState } },
): PreviewPayload {
  return buildPayload(session, 0, KIT_VERSION, project, assets, variant, options)
}

/** Build the immutable preview payload shared by preview and checks. */
export async function payloadFor(
  project: DesignProject,
  session: string,
  variant?: { screen: string; group: string; branch: string },
): Promise<PreviewPayload> {
  return payloadFromAssets(project, session, await collectDeterministicAssets(project), variant)
}

interface RenderInput {
  readonly ctx: CheckContext
  readonly project: DesignProject
  readonly payload: PreviewPayload
  readonly screen: string
  readonly breakpoint: string
  readonly state?: string
  readonly theme: string
}

/** Run one task against a fresh deterministic render. */
async function render<T>(input: RenderInput, task: (page: import('playwright-core').Page) => Promise<T>): Promise<T> {
  return input.ctx.browsers.run(
    {
      sessionId: input.ctx.sessionId,
      payload: input.payload,
      assetsDir: input.ctx.assetsDir,
      screen: input.screen,
      breakpoint: input.breakpoint,
      breakpointWidth: breakpointWidth(input.project, input.breakpoint),
      theme: input.theme,
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.ctx.signal === undefined ? {} : { signal: input.ctx.signal }),
      ...(input.ctx.timeoutMs === undefined ? {} : { timeoutMs: input.ctx.timeoutMs }),
    },
    task,
  )
}

/** Read a bounded semantic snapshot from the committed canvas. */
export async function readSnapshot(
  page: import('playwright-core').Page,
  screen: string,
  breakpoint: string,
  state?: string,
  theme = 'base',
  focus: SnapshotFocus = {},
  geometry = false,
): Promise<LayoutSnapshot> {
  const raw = await page.evaluate(
    ({ focus, geometry }) => {
      const frame = document.querySelector('.dsx-frame')
      if (!(frame instanceof HTMLElement)) return { error: 'canvas-missing' as const }
      const frameRect = frame.getBoundingClientRect()
      const round = (value: number): number => Math.round(value * 100) / 100
      const limit = 500
      const nodes: Array<{
        id?: string
        address?: string
        type: string
        role?: string
        name?: string
        visible: boolean
        x: number
        y: number
        width: number
        height: number
      }> = []
      let truncated = false
      const implicit: Record<string, string> = {
        button: 'button',
        a: 'link',
        select: 'combobox',
        textarea: 'textbox',
        main: 'main',
        header: 'banner',
        nav: 'navigation',
        table: 'table',
        img: 'img',
        p: 'paragraph',
        li: 'listitem',
        ul: 'list',
        ol: 'list',
        h1: 'heading',
        h2: 'heading',
        h3: 'heading',
        h4: 'heading',
        h5: 'heading',
        h6: 'heading',
        svg: 'img',
      }
      const inputRole: Record<string, string> = {
        checkbox: 'checkbox',
        radio: 'radio',
        search: 'searchbox',
        number: 'spinbutton',
        email: 'textbox',
        password: 'textbox',
        text: 'textbox',
      }
      const roleOf = (element: Element): string | undefined => {
        const explicit = element.getAttribute('role')
        if (explicit !== null && explicit !== '') return explicit
        const tag = element.tagName.toLowerCase()
        if (tag === 'input') return inputRole[(element as HTMLInputElement).type] ?? 'textbox'
        return implicit[tag]
      }
      const text = (element: Element): string => (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
      const ids = new Set(focus.ids)
      const addresses = new Set(focus.addresses)
      const focused = focus.ids !== undefined || focus.addresses !== undefined
      const all = frame.querySelectorAll('.dsx-frame-inner [data-dsx-type]')
      for (const element of all) {
        const id = element.getAttribute('data-dsx-id') ?? undefined
        const address = element.getAttribute('data-dsx-address') ?? undefined
        if (focused && !(id !== undefined && ids.has(id)) && !(address !== undefined && addresses.has(address)))
          continue
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          element.checkVisibility({ opacityProperty: true })
        if (!visible) continue
        if (nodes.length >= limit) {
          truncated = true
          break
        }
        if (geometry) {
          nodes.push({
            id,
            type: '',
            visible: true,
            x: round(rect.left - frameRect.left),
            y: round(rect.top - frameRect.top),
            width: round(rect.width),
            height: round(rect.height),
          })
          continue
        }
        const labelledby = element.getAttribute('aria-labelledby')
        const labelled =
          labelledby === null ? undefined : (document.getElementById(labelledby)?.textContent ?? '').trim()
        const name =
          (element.getAttribute('aria-label') ?? '').trim() ||
          (labelled ?? '') ||
          (element.getAttribute('title') ?? '').trim() ||
          (element.getAttribute('alt') ?? '').trim() ||
          text(element)
        nodes.push({
          ...(id === undefined ? {} : { id }),
          ...(address === undefined ? {} : { address }),
          type: element.getAttribute('data-dsx-type') ?? 'Unknown',
          ...(roleOf(element) === undefined ? {} : { role: roleOf(element) as string }),
          ...(name === '' ? {} : { name }),
          visible: true,
          x: round(rect.left - frameRect.left),
          y: round(rect.top - frameRect.top),
          width: round(rect.width),
          height: round(rect.height),
        })
      }
      return {
        canvas: { width: round(frameRect.width), height: round(frameRect.height) },
        nodes,
        truncated,
      }
    },
    { focus, geometry },
  )
  if ('error' in raw) throw new DesignBrowserError('browser-failed', 'The rendered canvas is missing.')
  return {
    screen,
    theme,
    ...(state === undefined ? {} : { state }),
    breakpoint,
    canvas: raw.canvas,
    nodes: raw.nodes,
    truncated: raw.truncated,
  }
}

interface RawFinding {
  rule: string
  nodes: string[]
  message: string
  evidence: Record<string, number>
}

/** Measure overflow, clipped text, overlap, and pointer target size in the page. */
async function lintPage(
  page: import('playwright-core').Page,
  failedMediaNodes: readonly string[],
): Promise<RawFinding[]> {
  return page.evaluate((unavailable) => {
    const frame = document.querySelector('.dsx-frame')
    if (!(frame instanceof HTMLElement)) return []
    const round = (value: number): number => Math.round(value * 100) / 100
    const findings: RawFinding[] = []
    const seen = new Set<string>()
    const label = (element: Element): string => {
      const target = element.closest('[data-dsx-type]') ?? element
      const id = target.getAttribute('data-dsx-id')
      if (id !== null && id !== '') return id
      const address = target.getAttribute('data-dsx-address')
      if (address !== null && address !== '') return address
      return target.getAttribute('data-dsx-type') ?? target.tagName.toLowerCase()
    }
    const push = (
      rule: string,
      nodes: string[],
      message: string,
      evidence: Record<string, number>,
      key?: string,
    ): void => {
      const identity = rule + '|' + (key ?? nodes.join(','))
      if (seen.has(identity)) return
      seen.add(identity)
      findings.push({ rule, nodes, message, evidence })
    }
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity) > 0
      )
    }

    // Ignore only the substitute text for known failed Image/Avatar nodes. Keep
    // their authored boxes so an oversized media box is still a layout fault.
    const failed = new Set(unavailable)
    for (const fallback of frame.querySelectorAll('[data-dsx-type="Image"], [data-dsx-type="Avatar"]')) {
      if (!failed.has(label(fallback))) continue
      if (fallback instanceof HTMLImageElement) {
        // Chromium paints replacement text for broken native images even when
        // they have no text nodes. This clone-only change leaves authored CSS
        // dimensions intact and never changes a capture or the live preview.
        fallback.alt = ''
        fallback.removeAttribute('src')
      } else if (fallback.getAttribute('role') === 'img') {
        fallback.textContent = ''
      }
    }
    if (frame.scrollWidth > frame.clientWidth + 1) {
      push('canvas-overflow', ['canvas'], 'Canvas content is wider than the canvas.', {
        scrollWidth: round(frame.scrollWidth),
        clientWidth: round(frame.clientWidth),
        overflowBy: round(frame.scrollWidth - frame.clientWidth),
      })
    }

    const elements = [frame, ...frame.querySelectorAll('*')]
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue
      const style = getComputedStyle(element)
      const overflowX = style.overflowX
      const overflowY = style.overflowY
      const clipsX = overflowX !== 'visible'
      const clipsY = overflowY !== 'visible'
      if (!clipsX && !clipsY) continue
      const overflowWidth = clipsX && element.scrollWidth > element.clientWidth + 1
      const overflowHeight = clipsY && element.scrollHeight > element.clientHeight + 1
      if (!overflowWidth && !overflowHeight) continue
      const node = label(element)
      if (element !== frame && (overflowWidth || overflowHeight)) {
        push(
          'container-overflow',
          [node],
          'Container content exceeds its clip box.',
          {
            scrollWidth: round(element.scrollWidth),
            clientWidth: round(element.clientWidth),
            scrollHeight: round(element.scrollHeight),
            clientHeight: round(element.clientHeight),
          },
          node + '|overflow',
        )
      }
      const textElement = (element.textContent ?? '').trim().length > 0
      const textStyle = style.textOverflow === 'ellipsis' || (clipsX && clipsY)
      if (textElement && textStyle && (overflowWidth || overflowHeight)) {
        push(
          'clipped-text',
          [node],
          'Text is clipped by its container.',
          {
            scrollWidth: round(element.scrollWidth),
            clientWidth: round(element.clientWidth),
            scrollHeight: round(element.scrollHeight),
            clientHeight: round(element.clientHeight),
          },
          node + '|text',
        )
      }
    }

    const pointerSelector =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="switch"], [role="tab"], [role="checkbox"], [role="radio"]'
    for (const element of frame.querySelectorAll(pointerSelector)) {
      if (!(element instanceof HTMLElement)) continue
      if (element.getAttribute('aria-hidden') === 'true') continue
      if (getComputedStyle(element).pointerEvents === 'none') continue
      if (!visible(element)) continue
      const rect = element.getBoundingClientRect()
      if (rect.width >= 44 && rect.height >= 44) continue
      const node = label(element)
      push(
        'tap-target',
        [node],
        'Pointer control is smaller than the 44 CSS pixel minimum.',
        { width: round(rect.width), height: round(rect.height) },
        node + '|tap',
      )
    }

    const allNodes = frame.querySelectorAll('[data-dsx-type]').length
    if (allNodes > 500) {
      push(
        'measurement-truncated',
        ['canvas'],
        'The semantic snapshot would exceed its node cap; lint still measured overlap on a bounded subset.',
        { nodes: allNodes, cap: 500 },
        'snapshot',
      )
    }
    const candidates: { element: HTMLElement; rect: DOMRect; node: string }[] = []
    for (const element of frame.querySelectorAll('[data-dsx-type]')) {
      if (!(element instanceof HTMLElement)) continue
      if (!visible(element)) continue
      const style = getComputedStyle(element)
      if (style.position === 'absolute' || style.position === 'fixed') continue
      if (element.closest('[data-dsx-backdrop]') !== null) continue
      if (element.closest('[role="dialog"], [role="menu"], [role="status"]') !== null) continue
      let rect = element.getBoundingClientRect()
      let ancestor = element.parentElement
      while (ancestor !== null && ancestor !== frame.parentElement) {
        const overflow = getComputedStyle(ancestor)
        if (overflow.overflowX !== 'visible' || overflow.overflowY !== 'visible') {
          const clip = ancestor.getBoundingClientRect()
          const left = Math.max(rect.left, clip.left)
          const right = Math.min(rect.right, clip.right)
          const top = Math.max(rect.top, clip.top)
          const bottom = Math.min(rect.bottom, clip.bottom)
          rect = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top))
          if (rect.width === 0 || rect.height === 0) break
        }
        ancestor = ancestor.parentElement
      }
      if (rect.width === 0 || rect.height === 0) continue
      candidates.push({ element, rect, node: label(element) })
    }
    if (candidates.length > 300) {
      push(
        'measurement-truncated',
        ['canvas'],
        'Peer overlap measurement is truncated.',
        { candidates: candidates.length, cap: 300 },
        'overlap',
      )
    }
    const bounded = candidates.slice(0, 300)
    for (let left = 0; left < bounded.length; left += 1) {
      for (let right = left + 1; right < bounded.length; right += 1) {
        const a = bounded[left] as (typeof bounded)[number]
        const b = bounded[right] as (typeof bounded)[number]
        if (a.element.contains(b.element) || b.element.contains(a.element)) continue
        const overlapWidth = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left)
        const overlapHeight = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top)
        if (overlapWidth <= 0 || overlapHeight <= 0) continue
        const area = overlapWidth * overlapHeight
        if (area <= 4) continue
        push(
          'peer-overlap',
          [a.node, b.node],
          'Peer components overlap.',
          {
            overlapWidth: round(overlapWidth),
            overlapHeight: round(overlapHeight),
            overlapArea: round(area),
          },
          [a.node, b.node].sort().join('|'),
        )
      }
    }
    return findings
  }, failedMediaNodes)
}

const RULE_ORDER = [
  'canvas-overflow',
  'container-overflow',
  'clipped-text',
  'peer-overlap',
  'tap-target',
  'measurement-truncated',
  'off-token',
]

/** Run layout lint over one or every configured breakpoint. */
export async function runLint(
  ctx: CheckContext,
  project: DesignProject,
  screenId: string,
  options: CheckSelectionOptions = {},
): Promise<LintResult> {
  const selected = resolveCheckSelection(project, screenId, options, 'all')
  const { screen, variant, named, selection, theme } = selected
  const names = selected.breakpoints.map(({ name }) => name)
  const findings: LintFinding[] = []
  const diagnostics: MediaDiagnostic[] = []
  const assets = await collectMediaSnapshot(
    project.folder,
    selected.root,
    screen.file,
    project.config.breakpoints,
    names,
  )
  const payload = selectedPayload(project, ctx.sessionId, selected, assets.assets)
  for (const breakpoint of names) {
    const media = assets.at(breakpoint)
    const raw = await render(
      {
        ctx,
        project,
        payload,
        screen: screenId,
        breakpoint,
        theme,
        ...(named === undefined ? {} : { state: named.name }),
      },
      async (page) => {
        const measuredMedia = await diagnoseMedia(page, media)
        diagnostics.push(...measuredMedia)
        return lintPage(
          page,
          measuredMedia.flatMap(({ node }) => (node === undefined ? [] : [node])),
        )
      },
    )
    for (const finding of raw) {
      findings.push({
        rule: finding.rule,
        severity: finding.rule === 'tap-target' || finding.rule === 'measurement-truncated' ? 'warning' : 'error',
        screen: screenId,
        breakpoint,
        nodes: finding.nodes,
        message: finding.message,
        evidence: finding.evidence,
      })
    }
  }
  for (const diagnostic of screen.diagnostics) {
    if (diagnostic.code !== 'off-token' || diagnostic.severity !== 'warning' || diagnostic.group !== undefined) continue
    const node = diagnostic.nodeId ?? diagnostic.address ?? 'unknown'
    findings.push({
      rule: 'off-token',
      severity: 'warning',
      screen: screenId,
      nodes: [node],
      message: diagnostic.message,
      evidence: { file: diagnostic.file, line: diagnostic.line, column: diagnostic.column },
    })
  }
  const breakpointIndex = new Map(names.map((name, index) => [name, index]))
  findings.sort(
    (left, right) =>
      RULE_ORDER.indexOf(left.rule) - RULE_ORDER.indexOf(right.rule) ||
      (breakpointIndex.get(left.breakpoint ?? '') ?? 0) - (breakpointIndex.get(right.breakpoint ?? '') ?? 0) ||
      left.nodes.join(',').localeCompare(right.nodes.join(',')),
  )
  const errors = findings.filter((finding) => finding.severity === 'error').length
  return {
    screen: screenId,
    ...(named === undefined ? {} : { state: named.name }),
    breakpoints: names,
    theme,
    selection,
    ...(variant === undefined ? {} : { variant }),
    media: diagnostics,
    findings,
    errors,
    warnings: findings.length - errors,
  }
}

/** Quote a value for exact CSS attribute matching, not selector execution. */
function cssString(value: string): string {
  return (
    '"' +
    Array.from(value, (character) => {
      const code = character.charCodeAt(0)
      return character === '"' || character === '\\' || code <= 31 || code === 127
        ? '\\' + code.toString(16) + ' '
        : character
    }).join('') +
    '"'
  )
}

/** Locator for a stable design id inside the canvas. */
function nodeLocator(page: import('playwright-core').Page, target: string): import('playwright-core').Locator {
  return page.locator('.dsx-frame-inner [data-dsx-id=' + cssString(target) + ']')
}

/** Count visible occurrences of a stable id. */
async function visibleCount(page: import('playwright-core').Page, target: string): Promise<number> {
  return nodeLocator(page, target).evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          Number(style.opacity) > 0
        )
      }).length,
  )
}

/** Current screen id after the frame has committed its latest route. */
async function currentScreen(page: import('playwright-core').Page, theme: string): Promise<string> {
  await page.waitForSelector('.dsx-frame')
  await settleFrame(page)
  const selection = await page.locator('.dsx-frame').evaluate((frame) => ({
    screen: frame.getAttribute('data-screen') ?? '',
    theme: frame.getAttribute('data-theme'),
  }))
  if (selection.theme !== theme)
    throw new DesignBrowserError('browser-failed', 'The journey canvas did not retain its selected theme.')
  return selection.screen
}

/** Whether an error means the browser/page itself disappeared. */
function pageGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /target (page|closed|crashed)|browser has been closed|page has been closed|session closed|target closed|crashed/i.test(
    message,
  )
}

/** Navigate within the preview through its history contract. */
async function navigateTo(page: import('playwright-core').Page, screen: string): Promise<void> {
  await page.evaluate((next) => {
    const url = new URL(globalThis.location.href)
    const parts = url.pathname.split('/')
    parts[parts.length - 1] = encodeURIComponent(next)
    url.pathname = parts.join('/')
    url.searchParams.delete('state')
    history.pushState(null, '', url)
    globalThis.dispatchEvent(new PopStateEvent('popstate'))
  }, screen)
  await page.waitForFunction(
    (next) => document.querySelector('.dsx-frame')?.getAttribute('data-screen') === next,
    screen,
    { timeout: 2000 },
  )
  await settleFrame(page)
}

/** Resolve and validate a journey without opening a browser. Shared by status and execution. */
export function resolveJourneyStart(
  project: DesignProject,
  journey: NonNullable<DesignProject['journeys'][number]['journey']>,
) {
  const neededScreens = new Set<string>([journey.start])
  for (const step of journey.steps) {
    if (step.kind === 'navigate' || step.kind === 'expect-screen') neededScreens.add(step.screen)
  }
  for (const screenId of neededScreens) requireCurrentProjection(project, screenId)
  return resolveCheckSelection(
    project,
    journey.start,
    { breakpoint: journey.breakpoint, state: journey.state, theme: journey.theme },
    'one',
  )
}

/** Execute one journey against a clean deterministic render. */
export async function runJourney(ctx: CheckContext, project: DesignProject, journeyId: string): Promise<JourneyResult> {
  const found = project.journeys.find((candidate) => candidate.id === journeyId)
  if (found === undefined) throw new Error('Unknown journey "' + journeyId + '".')
  if (found.journey === undefined || countDiagnostics(found.diagnostics).errors > 0) {
    return {
      journey: journeyId,
      screen: found.journey?.start ?? '',
      ...(found.journey?.state === undefined ? {} : { state: found.journey.state }),
      breakpoint: found.journey?.breakpoint ?? defaultBreakpoint(project),
      ok: false,
      steps: [],
      error: 'Journey "' + journeyId + '" has validation errors; fix them before running.',
      diagnostics: found.diagnostics,
    }
  }
  const journey = found.journey
  const selected = resolveJourneyStart(project, journey)
  const breakpoint = selected.breakpoints[0]!.name
  const theme = selected.theme
  const current = { ...project, screens: project.screens.map((screen) => ({ ...screen, lastValidRoot: undefined })) }
  const media = await collectAssetsForRoots(
    project.folder,
    current.screens.map(({ root, blockingErrors, diagnostics }) =>
      (blockingErrors ?? countDiagnostics(diagnostics).errors) === 0 ? root : undefined,
    ),
  )
  const payload = payloadFromAssets(current, ctx.sessionId, media, undefined, { theme })
  const steps: JourneyStepResult[] = []
  let failure: { screen: string; snapshot: LayoutSnapshot } | undefined
  const run = await render(
    {
      ctx,
      project,
      payload,
      screen: journey.start,
      breakpoint,
      theme,
      ...(journey.state === undefined ? {} : { state: journey.state }),
    },
    async (page) => {
      let activeScreen = journey.start
      const fail = async (
        index: number,
        step: (typeof journey.steps)[number],
        result: { expected?: string; observed?: string; message?: string },
      ): Promise<void> => {
        const target = 'target' in step ? step.target : step.screen
        steps.push({ index, kind: step.kind, status: 'failed', target, ...result })
        activeScreen = await currentScreen(page, theme)
        const state = await page.evaluate(
          () => new URLSearchParams(globalThis.location.search).get('state') ?? undefined,
        )
        const snapshot = await readSnapshot(page, activeScreen, breakpoint, state, theme)
        failure = { screen: activeScreen, snapshot }
      }
      for (const [index, step] of journey.steps.entries()) {
        if (ctx.signal?.aborted === true) throw new DesignBrowserError('cancelled', 'The design journey was cancelled.')
        activeScreen = await currentScreen(page, theme)
        try {
          switch (step.kind) {
            case 'tap': {
              if ((await visibleCount(page, step.target)) === 0) {
                await fail(index, step, { expected: 'target present', observed: 'target missing' })
                return steps
              }
              const target = nodeLocator(page, step.target).first()
              if (step.part !== undefined && (await target.getAttribute('data-dsx-type')) !== 'SplitButton') {
                await fail(index, step, {
                  expected: 'SplitButton ' + step.part + ' trigger',
                  observed: 'target is not a SplitButton',
                })
                return steps
              }
              const control =
                step.part === undefined ? target : target.locator('[data-dsx-part="' + step.part + '"]').first()
              if (!(await control.isVisible())) {
                await fail(index, step, { expected: step.part + ' trigger', observed: 'control part missing' })
                return steps
              }
              await control.click({ timeout: 2000 })
              await settleFrame(page)
              activeScreen = await currentScreen(page, theme)
              steps.push({ index, kind: step.kind, status: 'passed' })
              break
            }
            case 'type': {
              if ((await visibleCount(page, step.target)) === 0) {
                await fail(index, step, { expected: 'control present', observed: 'control missing' })
                return steps
              }
              const control = nodeLocator(page, step.target).first().locator('input, textarea').first()
              if ((await control.count()) === 0) {
                await fail(index, step, { expected: 'text control', observed: 'no text control in target' })
                return steps
              }
              await control.fill(step.value, { timeout: 2000 })
              await settleFrame(page)
              steps.push({ index, kind: step.kind, status: 'passed', expected: step.value })
              break
            }
            case 'choose': {
              if ((await visibleCount(page, step.target)) === 0) {
                await fail(index, step, { expected: 'control present', observed: 'control missing' })
                return steps
              }
              const target = nodeLocator(page, step.target).first()
              const kind = await target.getAttribute('data-dsx-type')
              if (step.part !== undefined || kind === 'SelectButton') {
                if (
                  (step.part === 'menu' && kind !== 'SplitButton') ||
                  (step.part === undefined && kind !== 'SelectButton')
                ) {
                  await fail(index, step, {
                    expected: 'compatible option control',
                    observed: kind ?? 'unknown component',
                  })
                  return steps
                }
                if (step.part === 'menu') {
                  const menu = target.locator('[data-dsx-part="menu"]').first()
                  if (!(await menu.isVisible())) {
                    await fail(index, step, { expected: 'split menu trigger', observed: 'control part missing' })
                    return steps
                  }
                  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click({ timeout: 2000 })
                  await settleFrame(page)
                }
                const option = target
                  .locator('[data-dsx-part="option"][data-dsx-value=' + cssString(step.value) + ']')
                  .first()
                if (!(await option.isVisible())) {
                  await fail(index, step, { expected: step.value, observed: 'option missing' })
                  return steps
                }
                await option.click({ timeout: 2000 })
                await settleFrame(page)
                await currentScreen(page, theme)
                steps.push({ index, kind: step.kind, status: 'passed', target: step.target, expected: step.value })
                break
              }
              const select = target.locator('select').first()
              if ((await select.count()) > 0) {
                const available = await select
                  .locator('option')
                  .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
                if (!available.includes(step.value)) {
                  await fail(index, step, { expected: step.value, observed: 'option missing' })
                  return steps
                }
                await select.selectOption(step.value, { timeout: 2000 })
                await settleFrame(page)
                steps.push({ index, kind: step.kind, status: 'passed', expected: step.value })
                break
              }
              const radio = target.locator('input[type="radio"][value=' + cssString(step.value) + ']').first()
              if ((await radio.count()) === 0) {
                await fail(index, step, { expected: 'select or radio control', observed: 'no compatible control' })
                return steps
              }
              await radio.click({ timeout: 2000 })
              await settleFrame(page)
              steps.push({ index, kind: step.kind, status: 'passed', expected: step.value })
              break
            }
            case 'navigate': {
              if (!project.screens.some((candidate) => candidate.id === step.screen)) {
                await fail(index, step, { expected: step.screen, observed: 'screen missing' })
                return steps
              }
              await navigateTo(page, step.screen)
              activeScreen = await currentScreen(page, theme)
              steps.push({ index, kind: step.kind, status: 'passed', expected: step.screen })
              break
            }
            case 'expect-screen': {
              const observed = await currentScreen(page, theme)
              if (observed !== step.screen) {
                await fail(index, step, { expected: step.screen, observed })
                return steps
              }
              activeScreen = observed
              steps.push({ index, kind: step.kind, status: 'passed', expected: step.screen })
              break
            }
            case 'expect-visible': {
              const count = await visibleCount(page, step.target)
              const observed = count > 0 ? 'visible' : 'hidden'
              if ((step.visible ? count > 0 : count === 0) === false) {
                await fail(index, step, { expected: step.visible ? 'visible' : 'hidden', observed })
                return steps
              }
              steps.push({
                index,
                kind: step.kind,
                status: 'passed',
                expected: step.visible ? 'visible' : 'hidden',
                observed,
              })
              break
            }
            case 'expect-value': {
              const observed = await nodeLocator(page, step.target).evaluateAll(([element]) => {
                if (element === undefined) return undefined
                const stateValue = element.getAttribute('data-dsx-value')
                if (stateValue !== null) return stateValue
                const control = element.matches('input, select, textarea')
                  ? (element as HTMLInputElement)
                  : element.querySelector('input, select, textarea')
                if (
                  control instanceof HTMLInputElement ||
                  control instanceof HTMLSelectElement ||
                  control instanceof HTMLTextAreaElement
                ) {
                  return control.value
                }
                return (element.textContent ?? '').replace(/\s+/g, ' ').trim()
              })
              if (observed === undefined) {
                await fail(index, step, { expected: step.value, observed: 'target missing' })
                return steps
              }
              if (observed !== step.value) {
                await fail(index, step, { expected: step.value, observed })
                return steps
              }
              steps.push({ index, kind: step.kind, status: 'passed', expected: step.value, observed })
              break
            }
            default: {
              const count = await visibleCount(page, step.target)
              if (count !== step.count) {
                await fail(index, step, { expected: String(step.count), observed: String(count) })
                return steps
              }
              steps.push({
                index,
                kind: step.kind,
                status: 'passed',
                expected: String(step.count),
                observed: String(count),
              })
            }
          }
        } catch (error) {
          if (designBrowserErrorCode(error) !== undefined) throw error
          if (pageGone(error)) {
            throw new DesignBrowserError(
              'browser-failed',
              'The headless journey lost its page before the step completed.',
            )
          }
          await fail(index, step, {
            observed: 'action unavailable',
            message: 'The committed canvas did not accept this action.',
          })
          return steps
        }
      }
      return steps
    },
  )
  return {
    journey: journeyId,
    screen: journey.start,
    ...(journey.state === undefined ? {} : { state: journey.state }),
    breakpoint,
    theme,
    ok: failure === undefined,
    steps: run,
    ...(failure === undefined ? {} : { snapshot: failure.snapshot }),
  }
}

/** Deterministic cache-relative screenshot base name. */
function screenshotName(
  project: DesignProject,
  screen: ProjectScreen,
  payload: PreviewPayload,
  breakpoint: string,
  named: NamedState | undefined,
  highlight: string | undefined,
  viewportHeight: number,
  theme: string,
  selection: Readonly<Record<string, string>>,
  png: Buffer,
): string {
  const assets = Object.entries(payload.assets ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, data]) => [path, createHash('sha256').update(data).digest('hex').slice(0, 8)])
  const breakpointWidth = project.config.breakpoints.find((candidate) => candidate.name === breakpoint)?.width
  const identity = JSON.stringify({
    screen: screen.id,
    root: screen.root,
    breakpoints: project.config.breakpoints,
    breakpointWidth,
    viewportHeight,
    deterministic: true,
    locale: 'en-US',
    timezone: 'UTC',
    kitVersion: project.config.kitVersion,
    rendererKitVersion: payload.kitVersion,
    theme,
    palette: resolveProjectTheme(project, theme),
    assets,
    breakpoint,
    state: named?.name ?? null,
    stateOpen: named?.open ?? [],
    stateTabs: named?.tabs ?? {},
    stateValues: named?.values ?? {},
    stateDisclosures: named?.disclosures ?? {},
    highlight: highlight ?? null,
    selection: canonicalVariantIdentity(selection),
    png: createHash('sha256').update(png).digest('hex'),
  })
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 12)
  const parts = [screen.id, breakpoint, theme]
  if (named !== undefined) parts.push(named.name)
  if (highlight !== undefined) parts.push(highlight)
  parts.push(hash)
  return parts.join('-') + '.png'
}

/** Resolve and verify the canonical screenshot directory inside `.cache`. */
async function screenshotDirectory(folder: string): Promise<string> {
  return cacheAreaDirectory(folder, 'screenshots')
}

/** Revalidate the canonical screenshot directory immediately before a write. */
async function revalidateScreenshotDirectory(folder: string, directory: string): Promise<string> {
  return revalidateCacheArea(folder, 'screenshots', directory)
}

/** Capture the canvas as a deterministic PNG under the ignored cache. */
export async function captureScreenshot(
  ctx: CheckContext,
  project: DesignProject,
  screenId: string,
  options: CheckSelectionOptions & { highlight?: string } = {},
  onPersisted?: (png: Buffer) => Promise<void>,
): Promise<ScreenshotResult> {
  const selected = resolveCheckSelection(project, screenId, options, 'one')
  const { screen, root, named, variant, selection, theme } = selected
  const breakpoint = selected.breakpoints[0]!.name
  if (options.highlight !== undefined && findNode(root, options.highlight) === undefined) {
    throw new Error('Screen "' + screenId + '" has no node "' + options.highlight + '" to highlight.')
  }
  const { payload, media } = await selectedRender(project, ctx.sessionId, selected, breakpoint)
  const directory = await screenshotDirectory(project.folder)
  const captured = await render(
    {
      ctx,
      project,
      payload,
      screen: screenId,
      breakpoint,
      theme,
      ...(named === undefined ? {} : { state: named.name }),
    },
    async (page) => {
      if (options.highlight !== undefined) {
        const target = nodeLocator(page, options.highlight).first()
        if (!(await target.isVisible())) return undefined
        await target.evaluate((element) => {
          const style = (element as HTMLElement).style
          style.outline = '3px solid #e11d48'
          style.outlineOffset = '2px'
        })
        await settleFrame(page)
      }
      const canvas = page.locator('.dsx-frame')
      const buffer = await canvas.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', scale: 'css' })
      const box = await canvas.boundingBox()
      return { buffer, box, media: await diagnoseMedia(page, media) }
    },
  )
  if (captured === undefined) throw new Error('Highlight target "' + options.highlight + '" is not rendered.')
  if (ctx.signal?.aborted)
    throw new DesignBrowserError('cancelled', 'The screenshot was cancelled before being written.')
  const buffer = captured.buffer
  const name = screenshotName(
    project,
    screen,
    payload,
    breakpoint,
    named,
    options.highlight,
    ctx.browsers.viewportHeight,
    theme,
    selection,
    buffer,
  )
  const verified = await revalidateScreenshotDirectory(project.folder, directory)
  const target = join(verified, name)
  if (dirname(target) !== verified) throw new Error('The screenshot target is outside the cache; refusing to write.')
  const temporary = join(verified, '.' + name + '.' + randomUUID() + '.tmp')
  try {
    await writeFile(temporary, buffer)
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  await onPersisted?.(buffer)
  return {
    path: target,
    screen: screenId,
    theme,
    selection,
    ...(named === undefined ? {} : { state: named.name }),
    breakpoint,
    ...(options.highlight === undefined ? {} : { highlight: options.highlight }),
    ...(variant === undefined ? {} : { variant }),
    media: captured.media,
    width: captured.box?.width ?? breakpointWidth(project, breakpoint),
    height: captured.box?.height ?? 0,
    bytes: buffer.length,
  }
}
