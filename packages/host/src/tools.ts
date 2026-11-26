/**
 * Design-session plugin (mounted by the `design` preset): the five model
 * tools plus automatic validation of every call that changed design files.
 */
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { relative, sep } from 'node:path'
import {
  countDiagnostics,
  designPrompt,
  handoffPrompt,
  formatDiagnostic,
  loadProject,
  projectScreen,
  resolveHandoffPlan,
  scaffoldProject,
  sortDiagnostics,
  HandoffSelectionError,
  type DesignProject,
  type Diagnostic,
} from '@filipeesch/dsh-design-core'
import { KIT_VERSION, componentNames, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { BrowserSessions } from './browser.ts'
import { DesignBrowserError } from './browser.ts'
import { PackageError } from './cache.ts'
import { catalogOutputSchema, designCatalog, formatCatalog, MAX_CATALOG_NAMES } from './catalog.ts'
import {
  captureScreenshot,
  measureSelection,
  resolveCheckSelection,
  runJourney,
  runLint,
  type CheckContext,
} from './checks.ts'
import type { MediaDiagnostic } from './deterministic.ts'
import { screenshotAttachment, type ToolContent } from './screenshot-result.ts'
import { HandoffError, runHandoff } from './handoff.ts'
import { queryDesign } from './query.ts'
import { diffGitRevisions, diffVariantBranches, formatDesignDiff } from './diff.ts'
import { compatibleState, resolveScreenProjection } from './projection.ts'
import { summarizeDiagnosticDelta } from './diagnostic-delta.ts'
import { changedFiles, fingerprintFolder } from './runtime.ts'

/** Plugin name. */
export const name = 'design-tools'
/** Required services: the tool registry, the design host, and prompt sections. */
export const inject = ['tools', 'design', 'systemPrompt']

interface ParameterSpec {
  type?: 'string' | 'number' | 'boolean' | 'array'
  items?: 'string'
  enum?: readonly string[]
  description?: string
  required?: boolean
}

interface ToolOptions {
  name: string
  description: string
  parameters: Record<string, ParameterSpec>
  output: { schema: Record<string, unknown>; render: (args: any, value: any) => ToolContent[] }
  execute: (args: any, exec: any) => Promise<unknown>
}

/** Move property-level `required: true` flags to JSON-Schema root required arrays. */
function toJsonSchema(node: any): any {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return node
  if (node.type === 'object' && node.properties !== null && typeof node.properties === 'object') {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [name, property] of Object.entries(node.properties as Record<string, any>)) {
      const { required: isRequired, ...rest } = property
      properties[name] = toJsonSchema(rest)
      if (isRequired === true) required.push(name)
    }
    return { ...node, properties, ...(required.length === 0 ? {} : { required }) }
  }
  if (node.type === 'array' && node.items !== undefined) return { ...node, items: toJsonSchema(node.items) }
  return node
}

/** Build a registry-ready tool definition without importing the DSH tool helper. */
function tool(options: ToolOptions): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [name, spec] of Object.entries(options.parameters)) {
    properties[name] = {
      ...(spec.type === undefined ? {} : { type: spec.type }),
      ...(spec.type === 'array' ? { items: { type: spec.items ?? 'string' } } : {}),
      ...(spec.enum === undefined ? {} : { enum: [...spec.enum] }),
      ...(spec.description === undefined ? {} : { description: spec.description }),
    }
    if (spec.required === true) required.push(name)
  }
  const parameters = {
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required }),
    additionalProperties: false,
  }
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: { ...options.output, schema: toJsonSchema(options.output.schema) },
    async execute(args: unknown, exec: any): Promise<unknown> {
      if (args === null || typeof args !== 'object' || Array.isArray(args))
        throw new Error(options.name + ': arguments must be an object')
      const record = args as Record<string, unknown>
      for (const name of Object.keys(record)) {
        if (!Object.hasOwn(options.parameters, name))
          throw new Error(options.name + ': unknown argument "' + name + '"')
      }
      for (const [name, spec] of Object.entries(options.parameters)) {
        const value = record[name]
        if (value === undefined) {
          if (spec.required === true) throw new Error(options.name + ': missing required argument "' + name + '"')
          continue
        }
        if (spec.type === 'array') {
          if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
            throw new Error(options.name + ': argument "' + name + '" must be an array of strings')
        } else if (spec.type !== undefined && typeof value !== spec.type) {
          throw new Error(options.name + ': argument "' + name + '" must be a ' + spec.type)
        }
        if (spec.enum !== undefined && !spec.enum.includes(String(value)))
          throw new Error(options.name + ': argument "' + name + '" must be one of ' + spec.enum.join(', '))
      }
      return options.execute(record, exec)
    },
  }
}

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
function checkContext(ctx: any, exec: any): CheckContext {
  const facts = sessionFacts(ctx, exec)
  return {
    sessionId: facts.sessionId,
    browsers: ctx.design.browsers as BrowserSessions,
    assetsDir: ctx.design.assetsDir as string,
    ...(exec.signal === undefined ? {} : { signal: exec.signal as AbortSignal }),
    ...(ctx.design.browserTimeoutMs === undefined ? {} : { timeoutMs: ctx.design.browserTimeoutMs as number }),
  }
}

/** Resolve the calling session and its working directory. */
function sessionFacts(ctx: any, exec: any): SessionFacts {
  const session = exec.agent?.session
  if (session === undefined) throw new Error('design tools require a calling agent session')
  const effective = ctx.design.resolveSessionCwd(session.id) as string | undefined
  if (effective === undefined) throw new Error('the calling session has no working directory')
  ctx.design.registry.learnSession(session.id, effective)
  return { sessionId: session.id, cwd: effective }
}

/** Load the project for a session from disk. */
async function loadForSession(
  ctx: any,
  exec: any,
): Promise<{ facts: SessionFacts; folder: string; project: DesignProject }> {
  const facts = sessionFacts(ctx, exec)
  const folder = ctx.design.folderForCwd(facts.cwd) as string
  // Reuse the live runtime so last-valid variant metadata and diagnostics are
  // visible to tools. Current checks never read a stale projection as current.
  const runtime = await ctx.design.registry?.forSession(facts.sessionId)
  const previous = runtime === undefined ? undefined : await runtime.get()
  const project = await loadProject({
    folder,
    kit: kitMetadata,
    installedKitVersion: KIT_VERSION,
    ...(previous === undefined ? {} : { previous }),
  })
  return { facts, folder, project }
}

/** Read screen diagnostics for a design_validate scope. */
function scopedDiagnostics(project: DesignProject, scope: string, file?: string, screen?: string): Diagnostic[] {
  if (scope === 'file') {
    const target = file ?? ''
    return sortDiagnostics(
      project.diagnostics.filter(
        (diagnostic) =>
          diagnostic.file === target ||
          (diagnostic.file === 'tokens.json' && target !== 'design.json') ||
          (diagnostic.file === 'design.json' && target === 'design.json'),
      ),
    )
  }
  if (scope === 'screen') {
    const screenFile = project.screens.find((candidate) => candidate.id === screen)?.file
    if (screenFile === undefined) return []
    return sortDiagnostics(
      project.diagnostics.filter((diagnostic) => diagnostic.file === screenFile || diagnostic.file === 'tokens.json'),
    )
  }
  return sortDiagnostics(project.diagnostics)
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
  variant?: { path: string; branch: string }
  selection?: Record<string, string>
}): string {
  const branches = Object.entries(value.selection ?? {}).map(([group, branch]) => group + ':' + branch)
  return (
    'screen=' +
    JSON.stringify(value.screen) +
    ' state=' +
    (value.state === undefined ? '(default)' : JSON.stringify(value.state)) +
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

const mediaSchema = { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } }
const selectionSchema = { type: 'object', additionalProperties: true, properties: {} }

/** Project-relative path with forward slashes for tool results and artifacts. */
async function projectPath(cwd: string, folder: string, absolute: string): Promise<string> {
  const realCwd = await realpath(cwd)
  const realFolder = await realpath(folder)
  const design = relative(realCwd, realFolder).split(sep).join('/')
  const inside = relative(realFolder, absolute).split(sep).join('/')
  return design + '/' + inside
}

/** Register the design tools and automatic validation. */
export function apply(ctx: any): void {
  const editReports = new Map<symbol, string>()

  ctx.systemPrompt.section({
    name: 'design:guidance',
    order: 700,
    text: designPrompt(componentNames),
    interpolate: false,
  })
  ctx.systemPrompt.section({
    name: 'design:handoff',
    order: 710,
    text: handoffPrompt(),
    interpolate: false,
  })

  ctx.on('tools/execute', async (exec: any, next: () => Promise<any>) => {
    // The enclosing call brackets all nested writes, including edits undone before it returns.
    const session = exec.agent?.session
    if (session === undefined || exec.parent !== undefined) return next()
    const cwd = ctx.design.resolveSessionCwd(session.id) as string | undefined
    if (cwd === undefined) return next()
    const folder = ctx.design.folderForCwd(cwd) as string
    ctx.design.registry.learnSession(session.id, cwd)
    const readProject = () => loadProject({ folder, kit: kitMetadata, installedKitVersion: KIT_VERSION })
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
      await ctx.design.registry.forFolder(folder).reload()
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
        const folderName = ctx.design.folderName as string
        const result = await scaffoldProject(facts.cwd, { folderName, kitVersion: KIT_VERSION })
        await ctx.design.registry
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
        'Report project selectors, kit versions, diagnostic counts, preview URL, and browser readiness without launching Chromium.',
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
          lines.push('Preview: ' + value.previewUrl)
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
        'Validate the whole design project, one file, or one screen, returning ordered diagnostics with suggestions.',
      parameters: {
        scope: {
          type: 'string',
          enum: ['project', 'file', 'screen'],
          description: 'Validation scope; defaults to project.',
        },
        file: { type: 'string', description: 'Project-relative file for file scope, for example screens/home.dsx.' },
        screen: { type: 'string', description: 'Screen id for screen scope.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scope: { type: 'string', required: true },
            diagnostics: {
              type: 'array',
              required: true,
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
            errors: { type: 'number', required: true },
            warnings: { type: 'number', required: true },
          },
        },
        render: (_args: unknown, value: any) =>
          text(
            value.diagnostics.length === 0
              ? 'No diagnostics in the ' + value.scope + ' scope.'
              : String(value.errors) +
                  ' error(s), ' +
                  String(value.warnings) +
                  ' warning(s):\n' +
                  value.diagnostics.map(formatDiagnostic).join('\n'),
          ),
      },
      async execute(args: any, exec: any) {
        const { project } = await loadForSession(ctx, exec)
        const scope = args.scope ?? 'project'
        const diagnostics = scopedDiagnostics(project, scope, args.file, args.screen)
        const counts = countDiagnostics(diagnostics)
        return { scope, diagnostics, errors: counts.errors, warnings: counts.warnings }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_view',
      description:
        'Return a compact indented text projection of a screen, optionally one subtree, a named state, and a measured layout snapshot at one breakpoint.',
      parameters: {
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
            text: { type: 'string', required: true },
            node: { type: 'string' },
            error: { type: 'string' },
            errorCode: { type: 'string' },
            state: { type: 'string' },
            variant: { type: 'object', additionalProperties: true, properties: {} },
            breakpoint: { type: 'string' },
            selection: selectionSchema,
            media: mediaSchema,
            layout: { type: 'object', additionalProperties: true, properties: {} },
            screens: { type: 'array', items: { type: 'string' } },
          },
        },
        render: (_args: unknown, value: any) => {
          if (value.error !== undefined) return text(value.error)
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
      async execute(args: any, exec: any) {
        const { project } = await loadForSession(ctx, exec)
        const available = project.screens.filter((screen) => screen.id !== '').map((screen) => screen.id)
        const screenId = args.screen ?? project.entry ?? ''
        try {
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
            ...(view.node === undefined ? {} : { node: view.node }),
            ...(named === undefined ? {} : { state: named.name }),
            ...(variant === undefined ? {} : { variant }),
          }
          if (args.breakpoint === undefined) return base
          if (args.node !== undefined && view.node === undefined) throw new Error('Unknown node "' + args.node + '".')
          return {
            ...base,
            breakpoint: args.breakpoint,
            ...(await measureSelection(checkContext(ctx, exec), project, selected)),
          }
        } catch (error) {
          return {
            screen: screenId,
            text: '',
            screens: available,
            error: error instanceof Error ? error.message : String(error),
            errorCode: error instanceof DesignBrowserError ? error.code : 'invalid-selection',
          }
        }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_catalog',
      description:
        'Index kit components, DSX constructs, and composition recipes, or look up details with props and validated examples. Batch related names in one call.',
      parameters: {
        name: { type: 'string', description: 'One exact catalog name. Omit name and names for the index.' },
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
          type: 'object',
          additionalProperties: false,
          properties: {
            journey: { type: 'string', required: true },
            screen: { type: 'string', required: true },
            state: { type: 'string' },
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
        render: (_args: unknown, value: any) => {
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
              ': ' +
              (value.ok ? 'passed' : 'failed'),
            ...value.steps.map(
              (step: any) =>
                '  ' +
                String(step.index + 1) +
                '. ' +
                step.kind +
                ' ' +
                step.status +
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
      async execute(args: any, exec: any) {
        const { project } = await loadForSession(ctx, exec)
        const result = await runJourney(checkContext(ctx, exec), project, args.journey)
        return result
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_lint',
      description:
        'Measure layout across configured breakpoints and report overflow, peer overlap, clipped text, small tap targets, and off-token warnings.',
      parameters: {
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
          type: 'object',
          additionalProperties: false,
          properties: {
            screen: { type: 'string', required: true },
            state: { type: 'string' },
            selection: selectionSchema,
            variant: selectionSchema,
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
        render: (_args: unknown, value: any) => {
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
                  (finding: any) =>
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
      async execute(args: any, exec: any) {
        const { project } = await loadForSession(ctx, exec)
        return await runLint(checkContext(ctx, exec), project, args.screen, args)
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_screenshot',
      description:
        'Capture the rendered canvas as a deterministic PNG under the design cache, optionally highlighting one stable node; use only when visual evidence is needed.',
      parameters: {
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
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            screen: { type: 'string', required: true },
            state: { type: 'string' },
            breakpoint: { type: 'string', required: true },
            highlight: { type: 'string' },
            variant: selectionSchema,
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
        render: (_args: unknown, value: any) => {
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
              ' breakpoint=' +
              JSON.stringify(value.breakpoint) +
              (value.highlight === undefined ? '' : ' highlight=' + JSON.stringify(value.highlight)) +
              (value.attachment === undefined
                ? '\nPath-only fallback: ' +
                  value.imageFallback +
                  ' Open the saved PNG locally, or use read_image on an image-capable route.'
                : '') +
              formatMedia(value.media),
          )
          if (value.attachment !== undefined) content.push({ type: 'image', attachment: value.attachment })
          return content
        },
      },
      async execute(args: any, exec: any) {
        const { project } = await loadForSession(ctx, exec)
        let image: Awaited<ReturnType<typeof screenshotAttachment>> = {
          imageDelivery: 'path-only',
          imageFallback: 'Image delivery is unavailable.',
        }
        const result = await captureScreenshot(checkContext(ctx, exec), project, args.screen, args, async (png) => {
          image = await screenshotAttachment(ctx, exec, png)
        })
        return { ...result, ...image }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_handoff',
      description:
        'Generate an on-demand, content-addressed implementation package under the ignored design cache for chosen screens, named states, and breakpoints: editable chosen DSX, support inputs, resolved tokens, relevant journeys, semantic boxes, and canvas screenshots.',
      parameters: {
        screens: {
          type: 'array',
          items: 'string',
          description: 'Screen ids to include; omit for every valid chosen screen.',
        },
        states: {
          type: 'array',
          items: 'string',
          description:
            'Named state names, plus "$default" for the unnamed state; omit for the unnamed state and every declared state. A state literally named "default" is selected by its own name.',
        },
        breakpoints: {
          type: 'array',
          items: 'string',
          description: 'Configured breakpoint names; omit for every configured breakpoint.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', required: true },
            message: { type: 'string' },
            error: { type: 'string' },
            errorCode: { type: 'string' },
            package: { type: 'string' },
            manifest: { type: 'string' },
            id: { type: 'string' },
            screens: { type: 'array', items: { type: 'string' } },
            supportingScreens: { type: 'array', items: { type: 'string' } },
            states: { type: 'array', items: { type: 'string' } },
            breakpoints: { type: 'array', items: { type: 'string' } },
            projections: { type: 'number' },
            counts: { type: 'object', additionalProperties: true, properties: {} },
            bytes: { type: 'number' },
            warnings: { type: 'array', items: { type: 'string' } },
            reused: { type: 'boolean' },
          },
        },
        render: (_args: unknown, value: any) => {
          if (value.status !== 'ok') return text('Handoff ' + value.status + ': ' + (value.error ?? 'unknown error'))
          return text(
            'Wrote handoff ' +
              value.package +
              ' with ' +
              String(value.projections) +
              ' projection(s) across ' +
              value.screens.join(', ') +
              ' at ' +
              value.breakpoints.join(', ') +
              (value.supportingScreens === undefined || value.supportingScreens.length === 0
                ? ''
                : ' with supporting source(s) ' + value.supportingScreens.join(', ')) +
              '. Manifest: ' +
              value.manifest,
          )
        },
      },
      async execute(args: any, exec: any) {
        const { facts, project } = await loadForSession(ctx, exec)
        if (project.diagnostics.some((diagnostic) => diagnostic.code === 'project-missing')) {
          return {
            status: 'error',
            errorCode: 'no-project',
            error: 'No design project exists at ' + ctx.design.folderForCwd(facts.cwd) + '; call design_init first.',
          }
        }
        let plan
        try {
          plan = resolveHandoffPlan(project, {
            ...(args.screens === undefined ? {} : { screens: args.screens as string[] }),
            ...(args.states === undefined ? {} : { states: args.states as string[] }),
            ...(args.breakpoints === undefined ? {} : { breakpoints: args.breakpoints as string[] }),
            kit: kitMetadata,
          })
        } catch (error) {
          if (error instanceof HandoffSelectionError) {
            return { status: 'error', errorCode: error.code, error: error.message }
          }
          throw error
        }
        try {
          const result = await runHandoff({
            folder: project.folder,
            project,
            plan,
            ctx: checkContext(ctx, exec),
          })
          const packagePath = await projectPath(facts.cwd, project.folder, result.path)
          return {
            status: 'ok',
            message:
              'Wrote handoff package ' +
              packagePath +
              ' with ' +
              String(result.projections) +
              ' projection(s)' +
              (result.reused ? ' (verified cache reuse).' : '.'),
            package: packagePath,
            manifest: await projectPath(facts.cwd, project.folder, result.manifest),
            id: result.id,
            screens: [...result.screens],
            supportingScreens: [...result.supportingScreens],
            states: [...new Set(plan.projections.map((projection) => projection.stateName))],
            breakpoints: [...result.breakpoints],
            projections: result.projections,
            counts: result.counts,
            bytes: result.bytes,
            warnings: [...result.warnings],
            reused: result.reused,
          }
        } catch (error) {
          if (error instanceof HandoffError) {
            return {
              status: error.code === 'cancelled' ? 'cancelled' : 'error',
              errorCode: error.code,
              error: error.message,
            }
          }
          if (error instanceof PackageError) {
            return { status: 'error', errorCode: error.code, error: error.message }
          }
          if (error instanceof DesignBrowserError) {
            return {
              status: error.code === 'cancelled' ? 'cancelled' : error.code === 'timeout' ? 'timeout' : 'error',
              errorCode: error.code,
              error: 'The design handoff render failed closed.',
            }
          }
          return { status: 'error', errorCode: 'package-failed', error: 'The design handoff failed closed.' }
        }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_query',
      description:
        'Filter the validated design tree by screen, component, exact scalar prop, and id glob using * or ?; no browser and no executable selectors.',
      parameters: {
        screen: { type: 'string', description: 'Restrict to one screen id.' },
        component: { type: 'string', description: 'Exact component name, for example Input.' },
        prop: { type: 'string', description: 'Prop name for an exact scalar match.' },
        value: { description: 'Exact scalar prop value (string, number, or boolean).' },
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
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
            total: { type: 'number', required: true },
            truncated: { type: 'boolean', required: true },
            variant: { type: 'object', additionalProperties: true, properties: {} },
          },
        },
        render: (_args: unknown, value: any) =>
          text(
            value.matches.length === 0
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
                  .join('\n') + (value.truncated ? '\n… ' + String(value.total - value.matches.length) + ' more' : ''),
          ),
      },
      async execute(args: any, exec: any) {
        const { project } = await loadForSession(ctx, exec)
        if (args.value !== undefined) {
          const kind = typeof args.value
          if (kind !== 'string' && kind !== 'number' && kind !== 'boolean') {
            throw new Error('design_query: argument "value" must be a string, number, or boolean')
          }
        }
        if (args.prop === undefined && args.value !== undefined) {
          throw new Error('design_query: argument "value" requires "prop"')
        }
        const screenId = args.screen ?? project.entry
        if (screenId === undefined) return { matches: [], total: 0, truncated: false }
        let projection
        try {
          projection = resolveScreenProjection(project, screenId, args.variant)
        } catch (error) {
          throw new Error('design_query: ' + (error instanceof Error ? error.message : String(error)), { cause: error })
        }
        const scopedProject: DesignProject = {
          ...project,
          screens: project.screens.map((screen) => (screen.id === screenId ? projection.screen : screen)),
        }
        const result = queryDesign(scopedProject, {
          ...(args.screen === undefined ? {} : { screen: screenId }),
          ...(args.component === undefined ? {} : { component: args.component }),
          ...(args.prop === undefined ? {} : { prop: args.prop }),
          ...(args.value === undefined ? {} : { value: args.value }),
          ...(args.id === undefined ? {} : { id: args.id }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
        })
        return projection.variant === undefined ? result : { ...result, variant: projection.variant }
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
