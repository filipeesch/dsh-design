/**
 * Design-session plugin (mounted by the `design` preset): model
 * tools plus automatic validation of every call that changed design files.
 */
import { randomUUID } from 'node:crypto'
import {
  countDiagnostics,
  designPrompt,
  formatDiagnostic,
  projectScreen,
  scaffoldProject,
  type DesignProject,
} from '@filipeesch/dsh-design-core'
import { KIT_VERSION, componentNames } from '@filipeesch/dsh-design-kit/meta'
import { designBrowserErrorCode } from './browser.ts'
import { runningDesignBuild, type BuildIdentity } from './build-identity.ts'
import { validateScope, type ValidationArgs, type ValidationResult } from './validation-scope.ts'
import type { DesignService } from './index.ts'
import { tool, type ToolExecution } from './tool-adapter.ts'
import { catalogOutputSchema, designCatalog, formatCatalog, MAX_CATALOG_NAMES } from './catalog.ts'
import {
  captureScreenshot,
  measureSelection,
  defaultBreakpoint,
  resolveCheckSelection,
  resolveJourneyStart,
  runJourney,
  runGeometry,
  type GeometryCase,
  type GeometryResult,
  type JourneyResult,
  type LintResult,
  type ScreenshotResult,
  runLint,
  type CheckContext,
} from './checks.ts'
import type { MediaDiagnostic } from './deterministic.ts'
import { screenshotAttachment, type ToolContent, type AttachmentServices } from './screenshot-result.ts'
import { queryDesign, type QueryOptions } from './query.ts'
import { diffGitRevisions, diffVariantBranches, formatDesignDiff } from './diff.ts'
import {
  compatibleState,
  hasCurrentProjection,
  requireCurrentProjection,
  resolveScreenProjection,
} from './projection.ts'
import { summarizeDiagnosticDelta } from './diagnostic-delta.ts'
import { changedFiles, fingerprintFolder } from './runtime.ts'

/** Plugin name. */
export const name = 'design-tools'
/** Required services: the tool registry, the design host, and prompt sections. */
export const inject = ['tools', 'design', 'systemPrompt']

/** One model-facing validation notice. */
function userMessage(text: string): unknown {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'design-validation', form: 'notice', summary: 'design validation' },
  }
}

interface SessionFacts {
  readonly sessionId: string
  readonly cwd: string
}

/** Build the services one headless check needs for a calling session. */
function checkContext(ctx: ToolContext, exec: ToolExecution, facts: SessionFacts): CheckContext {
  return {
    sessionId: facts.sessionId,
    browsers: ctx.design.browsers,
    assetsDir: ctx.design.assetsDir,
    ...(exec.signal === undefined ? {} : { signal: exec.signal }),
    ...(ctx.design.browserTimeoutMs === undefined ? {} : { timeoutMs: ctx.design.browserTimeoutMs }),
  }
}

/** Resolve the calling session and its working directory. */
function registryOf(ctx: ToolContext): NonNullable<DesignService['registry']> {
  if (ctx.design.registry === undefined) throw new Error('The design project registry is not active.')
  return ctx.design.registry
}

function sessionFacts(ctx: ToolContext, exec: ToolExecution): SessionFacts {
  const session = exec.agent?.session
  if (session === undefined) throw new Error('design tools require a calling agent session')
  const effective = ctx.design.resolveSessionCwd(session.id)
  if (effective === undefined) throw new Error('the calling session has no working directory')
  registryOf(ctx).learnSession(session.id, effective)
  return { sessionId: session.id, cwd: effective }
}

/** Load the project for a session from disk. */
async function loadForSession(
  ctx: ToolContext,
  exec: ToolExecution,
): Promise<{ facts: SessionFacts; folder: string; project: DesignProject }> {
  const facts = sessionFacts(ctx, exec)
  const folder = ctx.design.folderForCwd(facts.cwd)
  // Read current sources, sharing the parser cache without accepting retained render output.
  const project = await registryOf(ctx).forFolder(folder).readCurrent()
  return { facts, folder, project }
}

/** Tool output renderer. */
function text(value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

function usableStates(screen: DesignProject['screens'][number]): string[] {
  return screen.states.flatMap((state) => {
    try {
      compatibleState(screen, screen.states, state.name)
      return [state.name]
    } catch {
      return []
    }
  })
}

function selectionLabel(value: {
  screen: string
  state?: string
  theme?: string
  breakpoint?: string
  variant?: { path: string; branch: string }
  selection?: Record<string, string>
}): string {
  const branches = Object.entries(value.selection ?? {}).map(([group, branch]) => group + ':' + branch)
  return (
    'screen=' +
    JSON.stringify(value.screen) +
    ' state=' +
    (value.state === undefined ? '(default)' : JSON.stringify(value.state)) +
    (value.breakpoint === undefined ? '' : ' breakpoint=' + JSON.stringify(value.breakpoint)) +
    (value.theme === undefined ? '' : ' theme=' + JSON.stringify(value.theme)) +
    ' variant=' +
    (value.variant === undefined ? '(chosen)' : JSON.stringify(value.variant.path + ':' + value.variant.branch)) +
    (branches.length === 0 ? '' : ' [' + branches.join(', ') + ']')
  )
}

function formatMedia(media: readonly MediaDiagnostic[]): string {
  if (media.length === 0) return ''
  return (
    '\nMedia issues (' +
    String(media.length) +
    '; separate from geometry):\n' +
    media
      .slice(0, 20)
      .map(
        (item) =>
          '  ' +
          item.code +
          ' [' +
          item.breakpoint +
          '] ' +
          item.reference +
          ' at ' +
          item.file +
          ':' +
          String(item.line) +
          ':' +
          String(item.column) +
          (item.node === undefined ? '' : ' (' + item.node + ')') +
          ': ' +
          item.remediation,
      )
      .join('\n') +
    (media.length > 20 ? '\n  … ' + String(media.length - 20) + ' more' : '')
  )
}

const stringSchema = { type: 'string' }
const numberField = { type: 'number', required: true }
const stringField = { type: 'string', required: true }
const stringsSchema = { type: 'array', items: stringSchema }
const recordSchema = { type: 'object', additionalProperties: true, properties: {} }
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, additionalProperties: false })
const variantSchema = object({
  group: stringField,
  path: stringField,
  branch: stringField,
  chosen: { type: 'boolean', required: true },
  selection: recordSchema,
})
const buildSchema = object({ id: stringField, version: stringSchema })
const journeySelectorSchema = object({
  id: stringField,
  file: stringField,
  usable: { type: 'boolean', required: true },
  screen: stringSchema,
  breakpoint: stringSchema,
  state: stringSchema,
  theme: stringSchema,
  reason: stringSchema,
})
const failureProperties = { error: stringSchema, errorCode: stringSchema }
const failSchema = object({ error: stringField, errorCode: stringField })
function journeyStatus(project: DesignProject, { id, file, journey, diagnostics }: DesignProject['journeys'][number]) {
  const entry = { id, file }
  const first = diagnostics.find((item) => item.severity === 'error')
  if (journey === undefined)
    return { ...entry, usable: false, reason: first === undefined ? 'No valid journey.' : formatDiagnostic(first) }
  const coordinates = {
    screen: journey.start,
    ...(journey.state === undefined ? {} : { state: journey.state }),
    ...(project.config.breakpoints.length === 0 && journey.breakpoint === undefined
      ? {}
      : { breakpoint: journey.breakpoint ?? defaultBreakpoint(project) }),
    theme: journey.theme ?? project.defaultTheme,
  }
  if (first !== undefined) return { ...entry, ...coordinates, usable: false, reason: formatDiagnostic(first) }
  try {
    resolveJourneyStart(project, journey)
    return { ...entry, ...coordinates, usable: true }
  } catch (error) {
    return { ...entry, ...coordinates, usable: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

function buildLabel(build: BuildIdentity): string {
  return build.version === undefined ? build.id : build.version + ' (' + build.id + ')'
}
function checkFailure(error: unknown) {
  return {
    errorCode: designBrowserErrorCode(error) ?? 'invalid-selection',
    error: error instanceof Error ? error.message : String(error),
  }
}
type CheckFailure = ReturnType<typeof checkFailure>
interface CheckArgs {
  screen: string
  state?: string
  breakpoint?: string
  variant?: string
  theme?: string
  highlight?: string
}
function formatFailure(value: { errorCode?: string; error: string }) {
  return (value.errorCode === undefined ? '' : value.errorCode + ': ') + value.error
}
const reviewSchema = object({
  screen: stringSchema,
  selection: stringSchema,
  theme: stringSchema,
  open: stringsSchema,
  tabs: recordSchema,
  disclosures: recordSchema,
})
const geometryCaseSchema = object({
  breakpoint: stringField,
  state: stringSchema,
  theme: stringSchema,
  reviewContext: reviewSchema,
})
const boxSchema = object({ x: numberField, y: numberField, width: numberField, height: numberField })
interface ViewArgs {
  screen?: string
  node?: string
  depth?: number
  open?: boolean
  state?: string
  variant?: string
  breakpoint?: string
  theme?: string
  mode?: 'geometry'
  nodes?: readonly string[]
  cases?: readonly GeometryCase[]
}
function formatGeometry(value: GeometryResult): string {
  return [
    selectionLabel(value),
    'Current source: ' + value.sourceIdentity,
    ...value.cases.map((item) =>
      [
        selectionLabel({
          ...item,
          screen: value.screen,
          ...(value.variant === undefined ? {} : { variant: value.variant }),
        }) + (item.reviewContext ? ' (temporary review context)' : ''),
        ...item.nodes.map(
          (node) =>
            '  ' +
            node.id +
            ': ' +
            (node.status === 'visible'
              ? node.box.x + ',' + node.box.y + ' ' + node.box.width + 'x' + node.box.height
              : node.status),
        ),
        formatMedia(item.media),
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n')
}

const mediaSchema = { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } }
const geometryMeasurementSchema = object({
  breakpoint: stringField,
  state: stringSchema,
  theme: stringField,
  rendition: stringField,
  reviewContext: { type: 'boolean' },
  canvas: object({ width: numberField, height: numberField }),
  nodes: {
    type: 'array',
    required: true,
    items: object({
      id: stringField,
      status: { type: 'string', required: true, enum: ['visible', 'hidden', 'absent'] },
      box: boxSchema,
    }),
  },
  media: { ...mediaSchema, required: true },
})
const selectionSchema = { type: 'object', additionalProperties: true, properties: {} }

interface ToolContext extends AttachmentServices {
  readonly design: DesignService
  readonly tools: { register(definition: Record<string, unknown>): void }
  readonly systemPrompt: {
    section(definition: { name: string; order: number; text: string; interpolate: boolean }): void
  }
  on(event: string, handler: (...args: any[]) => unknown): void
}

/** Register the design tools and automatic validation. */
export function apply(ctx: ToolContext): void {
  const editReports = new Map<symbol, string>()

  ctx.systemPrompt.section({
    name: 'design:guidance',
    order: 700,
    text: designPrompt(componentNames),
    interpolate: false,
  })

  ctx.on('tools/execute', async (exec: any, next: () => Promise<any>) => {
    // The enclosing call brackets all nested writes, including edits undone before it returns.
    const session = exec.agent?.session
    if (
      session === undefined ||
      exec.parent !== undefined ||
      (typeof exec.name === 'string' && exec.name.startsWith('design_'))
    )
      return next()
    const cwd = ctx.design.resolveSessionCwd(session.id)
    if (cwd === undefined) return next()
    const folder = ctx.design.folderForCwd(cwd)
    registryOf(ctx).learnSession(session.id, cwd)
    const runtime = registryOf(ctx).forFolder(folder)
    const readProject = () => runtime.readCurrent()
    const before = await fingerprintFolder(folder).catch(() => undefined)
    if (before === undefined) return next()
    const beforeProject = await readProject().catch(() => undefined)
    const result = await next()
    const after = await fingerprintFolder(folder).catch(() => undefined)
    if (after === undefined || changedFiles(before, after).length === 0) return result
    const afterProject = await readProject().catch(() => undefined)
    const report =
      beforeProject === undefined || afterProject === undefined
        ? 'Design validation could not compare the edited project. Run design_validate for current diagnostics.'
        : summarizeDiagnosticDelta(beforeProject.diagnostics, afterProject.diagnostics)
    if (report !== undefined) editReports.set(exec.token, report)
    try {
      await registryOf(ctx).forFolder(folder).reload()
    } catch {
      // Leave preview recovery to its watcher; validation has already read current source.
    }
    return result
  })

  ctx.on('tools/post-execute', async (exec: any, _result: any, next: () => Promise<any>) => {
    const report = editReports.get(exec.token)
    editReports.delete(exec.token)
    const decision = await next()
    if (report === undefined) return decision
    return {
      ...decision,
      additionalContexts: [...(decision.additionalContexts ?? []), userMessage(report)],
    }
  })

  ctx.tools.register(
    tool({
      name: 'design_init',
      description:
        'Scaffold a design project (design.json, tokens.json, one sample screen) in the session working directory, or report that it already exists.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            folder: { type: 'string', required: true },
            created: { type: 'array', required: true, items: { type: 'string' } },
            existing: { type: 'array', required: true, items: { type: 'string' } },
            alreadyExists: { type: 'boolean', required: true },
            previewUrl: { type: 'string', required: true },
          },
        },
        render: (_args: unknown, value: any) =>
          text(
            value.alreadyExists
              ? 'Design project already exists at ' + value.folder + '. Preview: ' + value.previewUrl
              : 'Scaffolded ' + value.created.length + ' files at ' + value.folder + '. Preview: ' + value.previewUrl,
          ),
      },
      async execute(_args: unknown, exec: any) {
        const facts = sessionFacts(ctx, exec)
        const folderName = ctx.design.folderName
        const result = await scaffoldProject(facts.cwd, { folderName, kitVersion: KIT_VERSION })
        await registryOf(ctx)
          .forFolder(result.folder)
          .reload()
          .catch(() => undefined)
        return {
          folder: result.folder,
          created: [...result.created],
          existing: [...result.existing],
          alreadyExists: result.alreadyExists,
          previewUrl: ctx.design.previewUrl(facts.sessionId),
        }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_status',
      description:
        'Discover screens, states, breakpoints, themes and journey IDs; report the active build, kit versions, and Chromium readiness without launching it.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            exists: { type: 'boolean', required: true },
            folder: { type: 'string', required: true },
            previewUrl: { type: 'string', required: true },
            kitVersion: { type: 'string' },
            activeBuild: buildSchema,
            toolsBuild: buildSchema,
            themes: { type: 'array', required: true, items: { type: 'string' } },
            defaultTheme: { type: 'string' },
            journeys: { type: 'array', required: true, items: journeySelectorSchema },
            installedKitVersion: { type: 'string', required: true },
            entry: { type: 'string' },
            breakpoints: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
            browser: { type: 'object', additionalProperties: true, properties: {} },
            screens: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  id: { type: 'string' },
                  file: { type: 'string' },
                  errors: { type: 'number' },
                  warnings: { type: 'number' },
                },
              },
            },
            errors: { type: 'number', required: true },
            warnings: { type: 'number', required: true },
            variants: {
              type: 'array',
              required: true,
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
            message: { type: 'string' },
          },
        },
        render: (_args: unknown, value: any) => {
          const lines = value.exists
            ? [
                'Design project at ' +
                  value.folder +
                  ': ' +
                  String(value.errors) +
                  ' error(s), ' +
                  String(value.warnings) +
                  ' warning(s). Kit pinned: ' +
                  (value.kitVersion ?? '(not set)') +
                  '; installed: ' +
                  value.installedKitVersion +
                  '.',
                'Entry: ' + (value.entry ?? '(none)') + '.',
                'Breakpoints: ' +
                  (value.breakpoints
                    .map((bp: any) => 'breakpoint=' + JSON.stringify(bp.name) + ' (' + String(bp.width) + 'px)')
                    .join(', ') || '(none)'),
              ]
            : [value.message]
          lines.push('Active plugin build: ' + buildLabel(value.activeBuild))
          if (value.toolsBuild !== undefined)
            lines.push(
              'Tools build differs from host: ' +
                buildLabel(value.toolsBuild) +
                '. Host and session may need a restart after an update.',
            )
          lines.push('Preview: ' + value.previewUrl)
          if (value.themes.length > 0)
            lines.push('Themes: ' + value.themes.join(', ') + '; default: ' + value.defaultTheme)
          for (const journey of value.journeys) {
            lines.push(
              '  journey=' +
                JSON.stringify(journey.id) +
                ' (' +
                journey.file +
                '): ' +
                (journey.usable ? 'usable' : 'blocked') +
                (journey.screen === undefined ? '' : ' ' + selectionLabel({ ...journey, screen: journey.screen })) +
                (journey.reason === undefined ? '' : ' — ' + journey.reason),
            )
          }
          for (const screen of value.screens) {
            lines.push(
              '  screen=' +
                JSON.stringify(screen.id) +
                ' (' +
                screen.file +
                ')' +
                (screen.states.length === 0
                  ? ''
                  : '; ' + screen.states.map((state: string) => 'state=' + JSON.stringify(state)).join(', ')),
            )
            for (const variant of screen.selectors) {
              lines.push(
                '    variant=' +
                  JSON.stringify(variant.selector) +
                  (variant.states.length === 0
                    ? ''
                    : '; ' + variant.states.map((state: string) => 'state=' + JSON.stringify(state)).join(', ')),
              )
            }
          }
          if (value.browser !== undefined) {
            lines.push(
              'Browser: ' +
                value.browser.status +
                ' (' +
                value.browser.source +
                (value.browser.executablePath === undefined ? '' : ': ' + value.browser.executablePath) +
                ').',
            )
            if (value.browser.error !== undefined) lines.push('Last launch error: ' + value.browser.error)
            lines.push(value.browser.guidance)
          }
          return text(lines.join('\n'))
        },
      },
      async execute(_args: unknown, exec: any) {
        const { facts, folder, project } = await loadForSession(ctx, exec)
        const exists = !project.diagnostics.some((diagnostic) => diagnostic.code === 'project-missing')
        const counts = countDiagnostics(project.diagnostics)
        return {
          exists,
          folder,
          previewUrl: ctx.design.previewUrl(facts.sessionId),
          activeBuild: ctx.design.build,
          ...(ctx.design.build.id === runningDesignBuild.id ? {} : { toolsBuild: runningDesignBuild }),
          themes: exists ? Object.keys(project.themes).sort() : [],
          ...(exists ? { defaultTheme: project.defaultTheme } : {}),
          journeys: project.journeys.map((entry) => journeyStatus(project, entry)),
          installedKitVersion: KIT_VERSION,
          breakpoints: exists ? project.config.breakpoints : [],
          browser: ctx.design.browsers.readiness(),
          ...(project.config.kitVersion === '' ? {} : { kitVersion: project.config.kitVersion }),
          ...(project.entry === undefined ? {} : { entry: project.entry }),
          screens: project.screens
            .filter((screen) => screen.id !== '')
            .map((screen) => {
              const screenCounts = countDiagnostics(screen.diagnostics)
              const selectors = (screen.variants ?? []).flatMap((group) =>
                group.branches.flatMap((branch) => {
                  if (!branch.valid || branch.stale || screen.variantDocumentCurrent !== true) return []
                  const selector = group.path + ':' + branch.id
                  try {
                    return [
                      { selector, states: usableStates(resolveScreenProjection(project, screen.id, selector).screen) },
                    ]
                  } catch {
                    return []
                  }
                }),
              )
              return {
                id: screen.id,
                file: screen.file,
                errors: screenCounts.errors,
                warnings: screenCounts.warnings,
                states: (screen.blockingErrors ?? screenCounts.errors) === 0 ? usableStates(screen) : [],
                selectors,
              }
            }),
          variants: project.screens.flatMap((screen) =>
            (screen.variants ?? []).map((group) => ({
              screen: screen.id,
              id: group.id,
              path: group.path,
              chosen: group.chosen,
              branches: group.branches.map((branch) => ({
                id: branch.id,
                valid: branch.valid,
                stale: branch.stale === true,
                errors: countDiagnostics(branch.diagnostics).errors,
              })),
            })),
          ),
          errors: counts.errors,
          warnings: counts.warnings,
          ...(exists
            ? {}
            : { message: 'No design project exists at ' + folder + '; call design_init to scaffold one.' }),
        }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_validate',
      description:
        'Check authored source and return diagnostics. Omit arguments for the whole project, or pass only file or screen. Conflicting or missing targets are errors.',
      parameters: {
        scope: {
          type: 'string',
          enum: ['project', 'file', 'screen'],
          description: 'Optional explicit scope; inferred from file or screen when omitted.',
        },
        file: { type: 'string', description: 'Design-folder-relative source path, for example screens/home.dsx.' },
        screen: { type: 'string', description: 'Screen id for screen scope.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scope: { type: 'string', required: true },
            ...failureProperties,
            diagnostics: {
              type: 'array',
              required: true,
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
            errors: { type: 'number', required: true },
            warnings: { type: 'number', required: true },
          },
        },
        render: (_args: unknown, value: ValidationResult) =>
          text(
            'error' in value
              ? formatFailure(value)
              : value.diagnostics.length === 0
                ? 'No diagnostics in the ' + value.scope + ' scope.'
                : String(value.errors) +
                  ' error(s), ' +
                  String(value.warnings) +
                  ' warning(s):\n' +
                  value.diagnostics.map(formatDiagnostic).join('\n'),
          ),
      },
      async execute(args: ValidationArgs, exec: ToolExecution) {
        const { project } = await loadForSession(ctx, exec)
        return validateScope(project, args)
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_view',
      description:
        'Inspect the authored tree, or measure rendered layout with Chromium. For focused comparisons use mode=geometry, nodes, and cases; no images or tree in that mode.',
      parameters: {
        mode: {
          type: 'string',
          enum: ['geometry'],
          description: 'Measure exact node IDs across 1–6 cases. Requires nodes and cases.',
        },
        nodes: {
          type: 'array',
          items: 'string',
          description: '1–24 distinct stable node IDs (not globs), in result order.',
        },
        cases: {
          type: 'array',
          schema: { items: geometryCaseSchema },
          description:
            '1–6 explicit cases with breakpoint and optional state, theme, and reviewContext. Scope screen and variant at the top level.',
        },
        theme: {
          type: 'string',
          description: 'An explicit palette for single-case view; use cases[].theme for geometry mode.',
        },
        screen: { type: 'string', description: 'Screen id; defaults to the project entry screen.' },
        node: { type: 'string', description: 'Node id to project only that subtree.' },
        depth: { type: 'number', description: 'Maximum node depth.' },
        open: { type: 'boolean', description: 'Expand overlay children instead of marking them closed.' },
        state: { type: 'string', description: 'Named screen state whose overlays start open.' },
        variant: {
          type: 'string',
          description: 'Explicit branch selection as group:branch; defaults to chosen branches.',
        },
        breakpoint: {
          type: 'string',
          description: 'Configured breakpoint to measure; omit to keep the static projection browser-free.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            screen: { type: 'string', required: true },
            text: stringSchema,
            theme: stringSchema,
            sourceIdentity: stringSchema,
            cases: { type: 'array', items: geometryMeasurementSchema },
            node: { type: 'string' },
            error: { type: 'string' },
            errorCode: { type: 'string' },
            state: { type: 'string' },
            variant: variantSchema,
            breakpoint: { type: 'string' },
            selection: selectionSchema,
            media: mediaSchema,
            layout: { type: 'object', additionalProperties: true, properties: {} },
            screens: { type: 'array', items: { type: 'string' } },
          },
        },
        render: (_args: unknown, value: any) => {
          if (value.error !== undefined) return text(formatFailure(value))
          if (value.cases !== undefined) return text(formatGeometry(value))
          if (value.layout === undefined) return text(selectionLabel(value) + '\n' + value.text)
          return text(
            selectionLabel(value) +
              '\n' +
              value.text +
              '\n\nLayout at ' +
              String(value.breakpoint) +
              ' (' +
              String(value.layout.canvas?.width) +
              'x' +
              String(value.layout.canvas?.height) +
              '):\n' +
              value.layout.nodes
                .map(
                  (node: any) =>
                    '  ' +
                    (node.id ?? node.address) +
                    ' <' +
                    node.type +
                    '> ' +
                    String(node.x) +
                    ',' +
                    String(node.y) +
                    ' ' +
                    String(node.width) +
                    'x' +
                    String(node.height),
                )
                .join('\n') +
              (value.layout.truncated === true ? '\n  … snapshot truncated' : '') +
              formatMedia(value.media),
          )
        },
      },
      async execute(args: ViewArgs, exec: ToolExecution) {
        const { facts, project } = await loadForSession(ctx, exec)
        const available = project.screens.filter((screen) => screen.id !== '').map((screen) => screen.id)
        const screenId = args.screen ?? project.entry ?? ''
        try {
          if (args.mode === 'geometry') {
            if (args.nodes === undefined || args.cases === undefined)
              throw new Error('Geometry mode requires nodes and cases.')
            if (
              [args.node, args.depth, args.open, args.state, args.breakpoint, args.theme].some(
                (arg) => arg !== undefined,
              )
            )
              throw new Error(
                'Geometry mode accepts state, breakpoint and theme only inside cases; omit node, depth and open.',
              )
            return await runGeometry(checkContext(ctx, exec, facts), project, screenId, {
              nodes: args.nodes,
              cases: args.cases,
              ...(args.variant === undefined ? {} : { variant: args.variant }),
            })
          }
          if (args.nodes !== undefined || args.cases !== undefined)
            throw new Error('Use mode="geometry" with nodes and cases.')
          if (args.depth !== undefined && (!Number.isInteger(args.depth) || args.depth < 0 || args.depth > 40))
            throw new Error('Depth must be an integer from 0 to 40.')
          const selected = resolveCheckSelection(
            project,
            screenId,
            args,
            args.breakpoint === undefined ? 'static' : 'one',
          )
          const { named, variant, selection, root } = selected
          const view = projectScreen(root, {
            ...(args.depth === undefined ? {} : { depth: args.depth }),
            ...(args.node === undefined ? {} : { node: args.node }),
            ...(args.open === undefined ? {} : { openOverlays: args.open }),
            ...(named === undefined ? {} : { openIds: named.open }),
            ...(named?.disclosures === undefined ? {} : { disclosures: named.disclosures }),
            breakpoints: project.config.breakpoints,
            breakpoint: selected.breakpoints[0]?.name,
          })
          const base = {
            screen: screenId,
            text: view.text,
            selection,
            theme: selected.theme,
            ...(view.node === undefined ? {} : { node: view.node }),
            ...(named === undefined ? {} : { state: named.name }),
            ...(variant === undefined ? {} : { variant }),
          }
          if (args.node !== undefined && view.node === undefined) throw new Error('Unknown node "' + args.node + '".')
          if (args.breakpoint === undefined) return base
          return {
            ...base,
            breakpoint: args.breakpoint,
            ...(await measureSelection(checkContext(ctx, exec, facts), project, selected, {
              ...(args.node === undefined ? {} : { node: args.node }),
              ...(args.depth === undefined ? {} : { depth: args.depth }),
            })),
          }
        } catch (error) {
          return {
            screen: screenId,
            text: '',
            screens: available,
            ...checkFailure(error),
          }
        }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_catalog',
      description:
        'Find kit components, DSX constructs, and recipes by intent in Portuguese or English. Pass only query, name, or names; no arguments lists the index.',
      parameters: {
        query: {
          type: 'string',
          description: 'Search by intent in Portuguese or English (1–160 characters); omit name and names.',
        },
        name: { type: 'string', description: 'One exact catalog name; omit query and names.' },
        names: {
          type: 'array',
          items: 'string',
          description:
            '1–' +
            String(MAX_CATALOG_NAMES) +
            ' component, DSX construct, or recipe names in desired order; omit name.',
        },
      },
      output: {
        schema: catalogOutputSchema,
        render: (_args: unknown, value: ReturnType<typeof designCatalog>) => text(formatCatalog(value)),
      },
      async execute(args: Parameters<typeof designCatalog>[0]) {
        return designCatalog(args)
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_run_journey',
      description:
        'Execute one validated journey against a clean headless render; returns ordered step outcomes and the failing screen snapshot.',
      parameters: {
        journey: { type: 'string', required: true, description: 'Journey id declared in design/journeys.' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                journey: { type: 'string', required: true },
                screen: { type: 'string', required: true },
                state: stringSchema,
                theme: stringSchema,
                breakpoint: { type: 'string', required: true },
                ok: { type: 'boolean', required: true },
                steps: {
                  type: 'array',
                  required: true,
                  items: { type: 'object', additionalProperties: true, properties: {} },
                },
                snapshot: { type: 'object', additionalProperties: true, properties: {} },
                error: { type: 'string' },
                diagnostics: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
              },
            },
            failSchema,
          ],
        },
        render: (_args: unknown, value: JourneyResult | CheckFailure) => {
          if ('errorCode' in value) return text(formatFailure(value))
          if (value.error !== undefined)
            return text(
              'Journey ' +
                value.journey +
                ': ' +
                value.error +
                (value.diagnostics === undefined ? '' : '\n' + value.diagnostics.map(formatDiagnostic).join('\n')),
            )
          const lines = [
            'Journey ' +
              value.journey +
              ' on ' +
              value.screen +
              (value.state === undefined ? '' : ' state ' + value.state) +
              ' at ' +
              value.breakpoint +
              (value.theme === undefined ? '' : ' theme=' + JSON.stringify(value.theme)) +
              ': ' +
              (value.ok ? 'passed' : 'failed'),
            ...value.steps.map(
              (step) =>
                '  ' +
                String(step.index + 1) +
                '. ' +
                step.kind +
                ' ' +
                step.status +
                (step.target === undefined ? '' : ' target=' + JSON.stringify(step.target)) +
                (step.expected === undefined ? '' : ' expected=' + step.expected) +
                (step.observed === undefined ? '' : ' observed=' + step.observed) +
                (step.message === undefined ? '' : ' (' + step.message + ')'),
            ),
          ]
          if (value.snapshot !== undefined) {
            lines.push(
              'Failure snapshot: ' +
                String(value.snapshot.nodes.length) +
                ' node(s) at ' +
                String(value.snapshot.canvas.width) +
                'x' +
                String(value.snapshot.canvas.height) +
                '.',
            )
          }
          return text(lines.join('\n'))
        },
      },
      async execute(args: { journey: string }, exec: ToolExecution) {
        const { facts, project } = await loadForSession(ctx, exec)
        try {
          return await runJourney(checkContext(ctx, exec, facts), project, args.journey)
        } catch (error) {
          return checkFailure(error)
        }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_lint',
      description:
        'Measure layout across configured breakpoints and report overflow, peer overlap, clipped text, small tap targets, and off-token warnings.',
      parameters: {
        theme: { type: 'string', description: 'Declared token palette; omit for the project default.' },
        screen: { type: 'string', required: true, description: 'Screen id to lint.' },
        state: { type: 'string', description: 'Named screen state to apply before measuring.' },
        breakpoint: { type: 'string', description: 'One configured breakpoint; omit to lint every breakpoint.' },
        variant: {
          type: 'string',
          description: 'Explicit branch selection as group:branch; defaults to chosen branches.',
        },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                screen: { type: 'string', required: true },
                state: stringSchema,
                theme: stringSchema,
                selection: selectionSchema,
                variant: variantSchema,
                media: mediaSchema,
                breakpoints: { type: 'array', required: true, items: { type: 'string' } },
                findings: {
                  type: 'array',
                  required: true,
                  items: { type: 'object', additionalProperties: true, properties: {} },
                },
                errors: { type: 'number', required: true },
                warnings: { type: 'number', required: true },
              },
            },
            failSchema,
          ],
        },
        render: (_args: unknown, value: LintResult | CheckFailure) => {
          if ('errorCode' in value) return text(formatFailure(value))
          const header =
            'Lint ' +
            selectionLabel(value) +
            ' across ' +
            value.breakpoints.join(', ') +
            ': ' +
            String(value.errors) +
            ' error(s), ' +
            String(value.warnings) +
            ' warning(s).'
          if (value.findings.length === 0) return text(header + formatMedia(value.media))
          return text(
            header +
              '\n' +
              value.findings
                .map(
                  (finding) =>
                    '  ' +
                    finding.rule +
                    ' [' +
                    (finding.breakpoint ?? 'all') +
                    '] ' +
                    finding.nodes.join(', ') +
                    ': ' +
                    finding.message,
                )
                .join('\n') +
              formatMedia(value.media),
          )
        },
      },
      async execute(args: CheckArgs, exec: ToolExecution) {
        const { facts, project } = await loadForSession(ctx, exec)
        try {
          return await runLint(checkContext(ctx, exec, facts), project, args.screen, args)
        } catch (error) {
          return checkFailure(error)
        }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_screenshot',
      description:
        'Capture the rendered canvas as a deterministic PNG under the design cache, optionally highlighting one stable node; use only when visual evidence is needed.',
      parameters: {
        theme: { type: 'string', description: 'Declared token palette; omit for the project default.' },
        screen: { type: 'string', required: true, description: 'Screen id to capture.' },
        breakpoint: { type: 'string', description: 'Configured breakpoint; defaults to the widest.' },
        state: { type: 'string', description: 'Named screen state to apply before capture.' },
        highlight: { type: 'string', description: 'Stable node id to outline temporarily.' },
        variant: {
          type: 'string',
          description: 'Explicit branch selection as group:branch; defaults to chosen branches.',
        },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                screen: { type: 'string', required: true },
                state: stringSchema,
                theme: stringSchema,
                breakpoint: { type: 'string', required: true },
                highlight: { type: 'string' },
                variant: variantSchema,
                selection: selectionSchema,
                media: mediaSchema,
                attachment: selectionSchema,
                imageDelivery: { type: 'string', required: true },
                imageFallback: { type: 'string' },
                width: { type: 'number', required: true },
                height: { type: 'number', required: true },
                bytes: { type: 'number', required: true },
              },
            },
            failSchema,
          ],
        },
        render: (
          _args: unknown,
          value: (ScreenshotResult & Awaited<ReturnType<typeof screenshotAttachment>>) | CheckFailure,
        ) => {
          if ('errorCode' in value) return text(formatFailure(value))
          const content: ToolContent[] = text(
            'Wrote ' +
              value.path +
              ' (' +
              String(Math.round(value.width)) +
              'x' +
              String(Math.round(value.height)) +
              ', ' +
              String(value.bytes) +
              ' bytes). ' +
              selectionLabel(value) +
              (value.highlight === undefined ? '' : ' highlight=' + JSON.stringify(value.highlight)) +
              (value.imageDelivery === 'path-only'
                ? '\nPath-only fallback: ' +
                  value.imageFallback +
                  ' Open the saved PNG locally, or use read_image on an image-capable route.'
                : '') +
              formatMedia(value.media),
          )
          if (value.imageDelivery === 'inline') content.push({ type: 'image', attachment: value.attachment })
          return content
        },
      },
      async execute(args: CheckArgs, exec: ToolExecution) {
        const { facts, project } = await loadForSession(ctx, exec)
        try {
          let image: Awaited<ReturnType<typeof screenshotAttachment>> = {
            imageDelivery: 'path-only',
            imageFallback: 'Image delivery is unavailable.',
          }
          const result = await captureScreenshot(
            checkContext(ctx, exec, facts),
            project,
            args.screen,
            args,
            async (png) => {
              image = await screenshotAttachment(ctx, exec, png)
            },
          )
          return { ...result, ...image }
        } catch (error) {
          return checkFailure(error)
        }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_query',
      description:
        'Find node IDs and source locations in the authored tree. Search all chosen screens by default; use design_view for rendered state, theme, breakpoint or geometry.',
      parameters: {
        screen: { type: 'string', description: 'Restrict to one screen id.' },
        component: { type: 'string', description: 'Exact component name, for example Input.' },
        prop: { type: 'string', description: 'Prop name for an exact scalar match.' },
        value: {
          schema: { oneOf: [stringSchema, { type: 'number' }, { type: 'boolean' }] },
          description: 'Exact scalar value paired with prop.',
        },
        id: { type: 'string', description: 'Node id glob using only * and ?.' },
        limit: { type: 'number', description: 'Maximum matches (1-200).' },
        variant: {
          type: 'string',
          description: 'Explicit branch selection as group:branch; defaults to chosen branches.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            matches: {
              type: 'array',
              required: true,
              items: object({
                screen: stringField,
                node: stringField,
                address: stringField,
                component: stringField,
                file: stringField,
                line: numberField,
                column: numberField,
              }),
            },
            total: { type: 'number', required: true },
            truncated: { type: 'boolean', required: true },
            screen: stringSchema,
            variant: variantSchema,
          },
        },
        render: (_args: unknown, value: any) =>
          text(
            (value.screen === undefined ? 'All screens (chosen branches)' : selectionLabel(value)) +
              '\n' +
              (value.matches.length === 0
                ? 'No nodes match the query.'
                : value.matches
                    .map(
                      (match: any) =>
                        match.screen +
                        ' ' +
                        match.node +
                        ' <' +
                        match.component +
                        '> ' +
                        match.file +
                        ':' +
                        String(match.line) +
                        ':' +
                        String(match.column),
                    )
                    .join('\n') +
                  (value.truncated ? '\n… ' + String(value.total - value.matches.length) + ' more' : '')),
          ),
      },
      async execute(args: QueryOptions & { variant?: string }, exec: ToolExecution) {
        if ((args.prop === undefined) !== (args.value === undefined))
          throw new Error('design_query: "prop" and "value" must be provided together')
        if (args.value !== undefined && !['string', 'number', 'boolean'].includes(typeof args.value))
          throw new Error('design_query: value must be a string, number, or boolean')
        if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 200))
          throw new Error('design_query: limit must be an integer from 1 to 200')
        if (args.variant !== undefined && args.screen === undefined)
          throw new Error('design_query: an explicit variant requires screen')
        const { project } = await loadForSession(ctx, exec)
        if (args.screen === undefined) {
          const screens = project.screens.filter(hasCurrentProjection)
          return queryDesign({ ...project, screens }, args)
        }
        try {
          const { screen, variant } = requireCurrentProjection(project, args.screen, args.variant)
          return {
            ...queryDesign({ ...project, screens: [screen] }, args),
            screen: args.screen,
            ...(variant === undefined ? {} : { variant }),
          }
        } catch (error) {
          throw new Error('design_query: ' + (error instanceof Error ? error.message : String(error)), { cause: error })
        }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_diff',
      description:
        'Compare two branch selections of one screen, or the chosen projection at two locally available Git revisions; deterministic semantic additions, removals, moves, and typed changes without a checkout.',
      parameters: {
        screen: { type: 'string', required: true, description: 'Screen id to compare.' },
        group: { type: 'string', description: 'Variant group path for branch comparison.' },
        from: { type: 'string', description: 'Earlier branch id for branch comparison.' },
        to: { type: 'string', description: 'Later branch id for branch comparison.' },
        fromRevision: { type: 'string', description: 'Earlier local Git revision for revision comparison.' },
        toRevision: { type: 'string', description: 'Later local Git revision for revision comparison.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            mode: { type: 'string', required: true },
            screen: { type: 'string', required: true },
            from: { type: 'string', required: true },
            to: { type: 'string', required: true },
            additions: {
              type: 'array',
              required: true,
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
            removals: {
              type: 'array',
              required: true,
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
            moves: {
              type: 'array',
              required: true,
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
            changes: {
              type: 'array',
              required: true,
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
            diagnostics: {
              type: 'array',
              required: true,
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
          },
        },
        render: (_args: unknown, value: any) => text(formatDesignDiff(value)),
      },
      async execute(args: any, exec: any) {
        const { project } = await loadForSession(ctx, exec)
        const variantMode = args.group !== undefined || args.from !== undefined || args.to !== undefined
        const revisionMode = args.fromRevision !== undefined || args.toRevision !== undefined
        if (variantMode && revisionMode) {
          throw new Error('design_diff: use either group/from/to or fromRevision/toRevision, not both')
        }
        if (variantMode) {
          if (args.group === undefined || args.from === undefined || args.to === undefined) {
            throw new Error('design_diff: branch comparison requires group, from, and to')
          }
          return diffVariantBranches(project, args.screen, args.group, args.from, args.to)
        }
        if (revisionMode) {
          if (args.fromRevision === undefined || args.toRevision === undefined) {
            throw new Error('design_diff: revision comparison requires fromRevision and toRevision')
          }
          return diffGitRevisions(project, args.screen, args.fromRevision, args.toRevision)
        }
        throw new Error('design_diff: choose either group/from/to or fromRevision/toRevision')
      },
    }),
  )
}
