/**
 * Headless checks over the same validated kit and deterministic document as the
 * preview: semantic layout snapshots, layout lint, journey execution, and
 * explicit canvas screenshots.
 */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  countDiagnostics,
  findNamedState,
  findNode,
  type DesignProject,
  type Diagnostic,
  type NamedState,
  type ProjectScreen,
} from '@filipeesch/dsh-design-core'
import { KIT_VERSION } from '@filipeesch/dsh-design-kit/meta'
import { BrowserSessions, DesignBrowserError, settleFrame } from './browser.ts'
import { collectDeterministicAssets } from './deterministic.ts'
import { buildPayload, type PreviewPayload } from './payload.ts'

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
  readonly breakpoints: readonly string[]
  readonly findings: readonly LintFinding[]
  readonly errors: number
  readonly warnings: number
}

/** One executed journey step. */
export interface JourneyStepResult {
  readonly index: number
  readonly kind: string
  readonly status: 'passed' | 'failed'
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
  readonly width: number
  readonly height: number
  readonly bytes: number
}

/** Services one headless check needs. */
export interface CheckContext {
  readonly sessionId: string
  readonly browsers: BrowserSessions
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

/** One project screen with a renderable tree, or an explicit input error. */
function requireScreen(project: DesignProject, id: string): ProjectScreen {
  const screen = project.screens.find((candidate) => candidate.id === id)
  if (screen === undefined || screen.id === '') throw new Error('Unknown screen "' + id + '".')
  if (screen.root === undefined) throw new Error('Screen "' + id + '" has no parsed tree; fix its diagnostics first.')
  const first = screen.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
  if (first !== undefined) {
    throw new Error(
      'Screen "' +
        id +
        '" has validation errors; fix them before a browser check. First error: ' +
        first.file +
        ':' +
        String(first.line) +
        ':' +
        String(first.column) +
        ' ' +
        first.message,
    )
  }
  return screen
}

/** Build the immutable preview payload shared by preview and checks. */
export async function payloadFor(project: DesignProject, session: string): Promise<PreviewPayload> {
  const assets = await collectDeterministicAssets(project)
  return buildPayload(session, 0, KIT_VERSION, project, assets)
}

interface RenderInput {
  readonly ctx: CheckContext
  readonly project: DesignProject
  readonly payload: PreviewPayload
  readonly screen: string
  readonly breakpoint: string
  readonly state?: string
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
): Promise<LayoutSnapshot> {
  const raw = await page.evaluate(() => {
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
    const all = [...document.querySelectorAll('.dsx-frame-inner [data-dsx-type]')]
    for (const element of all) {
      if (!(element instanceof HTMLElement)) continue
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity) > 0
      if (!visible) continue
      if (nodes.length >= limit) {
        truncated = true
        break
      }
      const id = element.getAttribute('data-dsx-id') ?? undefined
      const address = element.getAttribute('data-dsx-address') ?? undefined
      const labelledby = element.getAttribute('aria-labelledby')
      const labelled = labelledby === null ? undefined : (document.getElementById(labelledby)?.textContent ?? '').trim()
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
  })
  if ('error' in raw) throw new Error('The rendered canvas is missing.')
  return {
    screen,
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
async function lintPage(page: import('playwright-core').Page): Promise<RawFinding[]> {
  return page.evaluate(() => {
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
  })
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
  options: { breakpoint?: string; state?: string } = {},
): Promise<LintResult> {
  const screen = requireScreen(project, screenId)
  const names =
    options.breakpoint === undefined
      ? project.config.breakpoints.map((candidate) => candidate.name)
      : [options.breakpoint]
  if (names.length === 0) throw new Error('The project configures no breakpoints.')
  for (const name of names) breakpointWidth(project, name)
  if (options.state !== undefined && !findNamedState(screen.states, options.state)) {
    throw new Error('Screen "' + screenId + '" does not declare state "' + options.state + '".')
  }
  const payload = await payloadFor(project, ctx.sessionId)
  const findings: LintFinding[] = []
  for (const breakpoint of names) {
    const raw = await render(
      {
        ctx,
        project,
        payload,
        screen: screenId,
        breakpoint,
        ...(options.state === undefined ? {} : { state: options.state }),
      },
      (page) => lintPage(page),
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
    if (diagnostic.code !== 'off-token' || diagnostic.severity !== 'warning') continue
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
    ...(options.state === undefined ? {} : { state: options.state }),
    breakpoints: names,
    findings,
    errors,
    warnings: findings.length - errors,
  }
}

/** Locator for a stable design id inside the canvas. */
function nodeLocator(page: import('playwright-core').Page, target: string): import('playwright-core').Locator {
  return page.locator('.dsx-frame-inner [data-dsx-id="' + target + '"]')
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
async function currentScreen(page: import('playwright-core').Page): Promise<string> {
  await page.waitForSelector('.dsx-frame')
  await settleFrame(page)
  return (await page.locator('.dsx-frame').getAttribute('data-screen')) ?? ''
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
  const neededScreens = new Set<string>([journey.start])
  for (const step of journey.steps) {
    if (step.kind === 'navigate' || step.kind === 'expect-screen') neededScreens.add(step.screen)
  }
  for (const screenId of neededScreens) requireScreen(project, screenId)
  const breakpoint = journey.breakpoint ?? defaultBreakpoint(project)
  breakpointWidth(project, breakpoint)
  const payload = await payloadFor(project, ctx.sessionId)
  const steps: JourneyStepResult[] = []
  let failure: { screen: string; snapshot: LayoutSnapshot } | undefined
  const run = await render(
    {
      ctx,
      project,
      payload,
      screen: journey.start,
      breakpoint,
      ...(journey.state === undefined ? {} : { state: journey.state }),
    },
    async (page) => {
      let activeScreen = journey.start
      const fail = async (
        index: number,
        step: (typeof journey.steps)[number],
        result: { expected?: string; observed?: string; message?: string },
      ): Promise<void> => {
        steps.push({ index, kind: step.kind, status: 'failed', ...result })
        const snapshot = await readSnapshot(page, activeScreen, breakpoint, journey.state)
        failure = { screen: activeScreen, snapshot }
      }
      for (const [index, step] of journey.steps.entries()) {
        if (ctx.signal?.aborted === true) throw new DesignBrowserError('cancelled', 'The design journey was cancelled.')
        activeScreen = await currentScreen(page)
        try {
          switch (step.kind) {
            case 'tap': {
              if ((await visibleCount(page, step.target)) === 0) {
                await fail(index, step, { expected: 'target present', observed: 'target missing' })
                return steps
              }
              await nodeLocator(page, step.target).first().click({ timeout: 2000 })
              await settleFrame(page)
              activeScreen = await currentScreen(page)
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
              const radio = target.locator('input[type="radio"][value="' + step.value + '"]').first()
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
              activeScreen = await currentScreen(page)
              steps.push({ index, kind: step.kind, status: 'passed', expected: step.screen })
              break
            }
            case 'expect-screen': {
              const observed = await currentScreen(page)
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
              const observed = await nodeLocator(page, step.target)
                .first()
                .evaluate((element) => {
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
                .catch(() => undefined)
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
          if (error instanceof DesignBrowserError) throw error
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
    tokens: project.tokens.cssText,
    assets,
    breakpoint,
    state: named?.name ?? null,
    stateOpen: named?.open ?? [],
    stateTabs: named?.tabs ?? {},
    stateValues: named?.values ?? {},
    highlight: highlight ?? null,
  })
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 12)
  const parts = [screen.id, breakpoint]
  if (named !== undefined) parts.push(named.name)
  if (highlight !== undefined) parts.push(highlight)
  parts.push(hash)
  return parts.join('-') + '.png'
}

/**
 * Validate one cache directory component before creating it. Existing symlinks,
 * non-directories, and paths whose canonical target is not the expected plain
 * directory are refused.
 */
async function ensureCacheComponent(path: string, expected: string): Promise<string> {
  let info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (info === undefined) {
    try {
      await mkdir(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    info = await lstat(path)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('The design cache component "' + path + '" must be a plain directory; refusing to write.')
  }
  const real = await realpath(path)
  if (real !== expected) {
    throw new Error('The design cache resolves outside its canonical location; refusing to write.')
  }
  return real
}

/** Resolve and verify the canonical screenshot directory inside `.cache`. */
async function screenshotDirectory(folder: string): Promise<string> {
  const realFolder = await realpath(folder)
  const cache = resolve(realFolder, '.cache')
  await ensureCacheComponent(cache, cache)
  const directory = resolve(cache, 'screenshots')
  await ensureCacheComponent(directory, directory)
  return directory
}

/** Revalidate the canonical screenshot directory immediately before a write. */
async function revalidateScreenshotDirectory(folder: string, directory: string): Promise<string> {
  const realFolder = await realpath(folder)
  const expected = resolve(realFolder, '.cache', 'screenshots')
  if (directory !== expected) throw new Error('The screenshot cache path is not canonical; refusing to write.')
  const info = await lstat(directory).catch(() => undefined)
  if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('The screenshot cache is no longer a plain directory; refusing to write.')
  }
  const real = await realpath(directory)
  if (real !== expected) {
    throw new Error('The screenshot cache resolves outside its canonical location; refusing to write.')
  }
  return real
}

/** Capture the canvas as a deterministic PNG under the ignored cache. */
export async function captureScreenshot(
  ctx: CheckContext,
  project: DesignProject,
  screenId: string,
  options: { breakpoint?: string; state?: string; highlight?: string } = {},
): Promise<ScreenshotResult> {
  const screen = requireScreen(project, screenId)
  const breakpoint = options.breakpoint ?? defaultBreakpoint(project)
  breakpointWidth(project, breakpoint)
  if (options.state !== undefined && !findNamedState(screen.states, options.state)) {
    throw new Error('Screen "' + screenId + '" does not declare state "' + options.state + '".')
  }
  if (
    options.highlight !== undefined &&
    findNode(screen.root as NonNullable<typeof screen.root>, options.highlight) === undefined
  ) {
    throw new Error('Screen "' + screenId + '" has no node "' + options.highlight + '" to highlight.')
  }
  const payload = await payloadFor(project, ctx.sessionId)
  const named = findNamedState(screen.states, options.state)
  const name = screenshotName(
    project,
    screen,
    payload,
    breakpoint,
    named,
    options.highlight,
    ctx.browsers.viewportHeight,
  )
  const directory = await screenshotDirectory(project.folder)
  const path = join(directory, name)
  const captured = await render(
    {
      ctx,
      project,
      payload,
      screen: screenId,
      breakpoint,
      ...(options.state === undefined ? {} : { state: options.state }),
    },
    async (page) => {
      if (options.highlight !== undefined) {
        const target = nodeLocator(page, options.highlight).first()
        if ((await target.count()) === 0)
          throw new Error('Highlight target "' + options.highlight + '" is not rendered.')
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
      return { buffer, box }
    },
  )
  const buffer = captured.buffer
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
  return {
    path,
    screen: screenId,
    ...(options.state === undefined ? {} : { state: options.state }),
    breakpoint,
    ...(options.highlight === undefined ? {} : { highlight: options.highlight }),
    width: captured.box?.width ?? breakpointWidth(project, breakpoint),
    height: captured.box?.height ?? 0,
    bytes: buffer.length,
  }
}
