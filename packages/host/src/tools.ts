/**
 * Design-session plugin (mounted by the `design` preset): the five model
 * tools plus automatic validation of every call that changed design files.
 */
import { randomUUID } from 'node:crypto'
import {
  countDiagnostics,
  editDistance,
  formatDiagnostic,
  loadProject,
  projectScreen,
  propsOf,
  scaffoldProject,
  sortDiagnostics,
  type DesignProject,
  type Diagnostic,
} from '@filipeesch/dsh-design-core'
import { KIT_VERSION, componentNames, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { changedFiles, fingerprintFolder, type FolderFingerprint } from './runtime.ts'

/** Plugin name. */
export const name = 'design-tools'
/** Required services: the tool registry, the design host, and prompt sections. */
export const inject = ['tools', 'design', 'systemPrompt']

const MAX_ATTACHED = 10

interface ParameterSpec {
  type?: 'string' | 'number' | 'boolean'
  enum?: readonly string[]
  description?: string
  required?: boolean
}

interface ToolOptions {
  name: string
  description: string
  parameters: Record<string, ParameterSpec>
  output: { schema: Record<string, unknown>; render: (args: any, value: any) => Array<{ type: 'text'; text: string }> }
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
      for (const [name, spec] of Object.entries(options.parameters)) {
        const value = record[name]
        if (value === undefined) {
          if (spec.required === true) throw new Error(options.name + ': missing required argument "' + name + '"')
          continue
        }
        if (spec.type !== undefined && typeof value !== spec.type)
          throw new Error(options.name + ': argument "' + name + '" must be a ' + spec.type)
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
  const project = await loadProject({ folder, kit: kitMetadata, installedKitVersion: KIT_VERSION })
  return { facts, folder, project }
}

/** Human-readable diagnostic summary, capped. */
function summarize(diagnostics: readonly Diagnostic[], cap = MAX_ATTACHED): string {
  const counts = countDiagnostics(diagnostics)
  if (diagnostics.length === 0) return 'Design validation: no problems in the changed design files.'
  const lines = diagnostics.slice(0, cap).map((diagnostic) => '  ' + formatDiagnostic(diagnostic))
  const more = diagnostics.length > cap ? '\n  … ' + String(diagnostics.length - cap) + ' more' : ''
  return (
    'Design validation: ' +
    String(counts.errors) +
    ' error(s), ' +
    String(counts.warnings) +
    ' warning(s).\n' +
    lines.join('\n') +
    more
  )
}

/** Filter project diagnostics to the changed files. */
function diagnosticsForFiles(project: DesignProject, files: readonly string[]): Diagnostic[] {
  const changed = new Set(files)
  return sortDiagnostics(
    project.diagnostics.filter(
      (diagnostic) =>
        changed.has(diagnostic.file) ||
        (changed.has('tokens.json') && diagnostic.file === 'tokens.json') ||
        (changed.has('design.json') && diagnostic.file === 'design.json'),
    ),
  )
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

/** Register the design tools and automatic validation. */
export function apply(ctx: any): void {
  const changes = new Map<symbol, { folder: string; files: string[] }>()
  const pending = new Map<symbol, { folder: string; files: Set<string> }>()

  ctx.on('tools/execute', async (exec: any, next: () => Promise<any>) => {
    const session = exec.agent?.session
    if (session === undefined) return next()
    const cwd = ctx.design.resolveSessionCwd(session.id) as string | undefined
    if (cwd === undefined) return next()
    const folder = ctx.design.folderForCwd(cwd) as string
    ctx.design.registry.learnSession(session.id, cwd)
    let before: FolderFingerprint
    try {
      before = await fingerprintFolder(folder)
    } catch {
      return next()
    }
    const result = await next()
    try {
      const after = await fingerprintFolder(folder)
      const files = changedFiles(before, after)
      if (files.length > 0) {
        changes.set(exec.token, { folder, files })
        if (exec.parent !== undefined) {
          const entry = pending.get(exec.parent) ?? { folder, files: new Set<string>() }
          for (const file of files) entry.files.add(file)
          pending.set(exec.parent, entry)
        }
        try {
          await ctx.design.registry.forFolder(folder).reload()
        } catch {
          // Validation below reports a broken project; preview updates on the watcher.
        }
      }
    } catch {
      // Fingerprint failure means no reliable changed set; skip attachment.
    }
    return result
  })

  ctx.on('tools/post-execute', async (exec: any, _result: any, next: () => Promise<any>) => {
    const decision = await next()
    const own = changes.get(exec.token)
    changes.delete(exec.token)
    const child = pending.get(exec.token)
    pending.delete(exec.token)
    const combined = new Set<string>(own?.files ?? [])
    if (child !== undefined) for (const file of child.files) combined.add(file)
    const contextText: string[] = []
    if (exec.parent !== undefined && combined.size > 0) {
      // Nested calls aggregate onto the enclosing call; the model sees one summary.
      const parent = pending.get(exec.parent) ?? {
        folder: own?.folder ?? (ctx.design.folderForCwd(sessionCwd(exec.agent)) as string),
        files: new Set<string>(),
      }
      for (const file of combined) parent.files.add(file)
      pending.set(exec.parent, parent)
      return decision
    }
    if (combined.size > 0 && own !== undefined) {
      try {
        const project = await loadProject({ folder: own.folder, kit: kitMetadata, installedKitVersion: KIT_VERSION })
        contextText.push(summarize(diagnosticsForFiles(project, [...combined])))
      } catch (error) {
        contextText.push('Design validation failed: ' + (error instanceof Error ? error.message : String(error)))
      }
    }
    if (contextText.length === 0) return decision
    const message = userMessage(contextText.join('\n'))
    return {
      ...decision,
      additionalContexts: [...(decision.additionalContexts ?? []), message],
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
        'Report whether a design project exists, its screens, kit versions, diagnostics counts, and the preview URL.',
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
            message: { type: 'string' },
          },
        },
        render: (_args: unknown, value: any) =>
          text(
            value.exists
              ? 'Design project at ' +
                  value.folder +
                  ': ' +
                  value.screens.length +
                  ' screen(s), ' +
                  value.errors +
                  ' error(s), ' +
                  value.warnings +
                  ' warning(s). Preview: ' +
                  value.previewUrl
              : value.message + ' Preview: ' + value.previewUrl,
          ),
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
          ...(project.config.kitVersion === '' ? {} : { kitVersion: project.config.kitVersion }),
          ...(project.entry === undefined ? {} : { entry: project.entry }),
          screens: project.screens
            .filter((screen) => screen.id !== '')
            .map((screen) => {
              const screenCounts = countDiagnostics(screen.diagnostics)
              return { id: screen.id, file: screen.file, errors: screenCounts.errors, warnings: screenCounts.warnings }
            }),
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
        'Return a compact indented text projection of a screen, optionally one subtree and with overlays expanded.',
      parameters: {
        screen: { type: 'string', description: 'Screen id; defaults to the project entry screen.' },
        node: { type: 'string', description: 'Node id to project only that subtree.' },
        depth: { type: 'number', description: 'Maximum node depth.' },
        open: { type: 'boolean', description: 'Expand overlay children instead of marking them closed.' },
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
            screens: { type: 'array', items: { type: 'string' } },
          },
        },
        render: (_args: unknown, value: any) => text(value.error ?? value.text),
      },
      async execute(args: any, exec: any) {
        const { project } = await loadForSession(ctx, exec)
        const available = project.screens.filter((screen) => screen.id !== '').map((screen) => screen.id)
        const screenId = args.screen ?? project.entry
        const screen = project.screens.find((candidate) => candidate.id === screenId)
        if (screen === undefined || screen.root === undefined) {
          return {
            screen: screenId ?? '',
            text: '',
            error: 'No screen "' + String(screenId) + '" with a parsed tree.',
            screens: available,
          }
        }
        const view = projectScreen(screen.root, {
          ...(args.depth === undefined ? {} : { depth: args.depth }),
          ...(args.node === undefined ? {} : { node: args.node }),
          ...(args.open === undefined ? {} : { openOverlays: args.open }),
        })
        return { screen: screen.id, text: view.text, ...(view.node === undefined ? {} : { node: view.node }) }
      },
    }),
  )

  ctx.tools.register(
    tool({
      name: 'design_catalog',
      description:
        "List kit components, or return one component's props, values, defaults, and a minimal example; unknown names return the closest matches.",
      parameters: {
        name: { type: 'string', description: 'Component name; omit to list every component.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            components: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  category: { type: 'string' },
                  tier: { type: 'number' },
                },
              },
            },
            name: { type: 'string' },
            description: { type: 'string' },
            props: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
            example: { type: 'string' },
            error: { type: 'string' },
            closest: { type: 'array', items: { type: 'string' } },
          },
        },
        render: (_args: unknown, value: any) =>
          text(
            value.error !== undefined
              ? value.error + ' Closest: ' + value.closest.join(', ')
              : value.components !== undefined
                ? value.components.map((component: any) => component.name + ' — ' + component.description).join('\n')
                : '<' +
                  value.name +
                  '> ' +
                  value.description +
                  '\n' +
                  value.props
                    .map(
                      (prop: any) =>
                        '  ' +
                        prop.name +
                        ': ' +
                        prop.kind +
                        (prop.values === undefined ? '' : ' (' + prop.values.join(' | ') + ')') +
                        (prop.required ? ' required' : '') +
                        ' — ' +
                        prop.description,
                    )
                    .join('\n') +
                  '\n\nExample:\n' +
                  value.example,
          ),
      },
      async execute(args: any) {
        if (args.name === undefined) {
          const components = componentNames.map((componentName) => {
            const meta = kitMetadata[componentName] as any
            return { name: meta.name, description: meta.description, category: meta.category, tier: meta.tier }
          })
          return { components }
        }
        const meta = kitMetadata[args.name]
        if (meta === undefined) {
          return {
            error: 'Unknown component "' + String(args.name) + '".',
            closest: componentNames
              .map((candidate) => ({ candidate, distance: editDistance(String(args.name), candidate) }))
              .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))
              .slice(0, 3)
              .map((entry) => entry.candidate),
          }
        }
        return {
          name: meta.name,
          description: meta.description,
          props: propsOf(meta).map((prop) => ({
            name: prop.name,
            kind: prop.kind,
            ...(prop.values === undefined ? {} : { values: prop.values }),
            ...(prop.required === undefined ? {} : { required: prop.required }),
            ...(prop.default === undefined ? {} : { default: prop.default }),
            description: prop.description,
          })),
          example: meta.example,
        }
      },
    }),
  )
}

/** Fallback working directory for a nested call's parent aggregation. */
function sessionCwd(agent: any): string {
  return agent?.session?.header?.cwd ?? process.cwd()
}
