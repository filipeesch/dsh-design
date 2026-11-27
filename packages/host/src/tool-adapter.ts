import type { ToolContent } from './screenshot-result.ts'

export interface ToolExecution {
  readonly agent?: {
    readonly session?: {
      readonly id: string
      requestHeader?(): { config?: { provider?: string; model?: string } } | undefined
    }
    readonly options?: { provider?: string; model?: string }
  }
  readonly signal?: AbortSignal
  readonly execution?: { readonly scope?: unknown }
}

interface ParameterSpec {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object'
  schema?: Schema
  items?: 'string'
  enum?: readonly string[]
  description?: string
  required?: boolean
}

type Schema = Record<string, unknown>

interface ToolOptions<Args, Result> {
  name: string
  description: string
  parameters: Record<string, ParameterSpec>
  output: { schema: Schema; render: (args: Args, value: Result) => ToolContent[] }
  execute: (args: Args, exec: ToolExecution) => Promise<Result>
}

/** Move property-level `required: true` flags to JSON-Schema root required arrays. */
function toJsonSchema(node: unknown): unknown {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return node
  const shape = node as Schema
  if (shape.type === 'object' && shape.properties !== null && typeof shape.properties === 'object') {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [name, property] of Object.entries(shape.properties as Record<string, Schema>)) {
      const { required: isRequired, ...rest } = property
      properties[name] = toJsonSchema(rest)
      if (isRequired === true) required.push(name)
    }
    return { ...shape, properties, ...(required.length === 0 ? {} : { required }) }
  }
  if (shape.type === 'array' && shape.items !== undefined) return { ...shape, items: toJsonSchema(shape.items) }
  if (Array.isArray(shape.oneOf)) return { ...shape, oneOf: shape.oneOf.map(toJsonSchema) }
  return shape
}

/** Build a registry-ready tool definition without importing the DSH tool helper. */
export function tool<Args = Record<string, never>, Result = unknown>(
  options: ToolOptions<Args, Result>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [name, spec] of Object.entries(options.parameters)) {
    properties[name] = {
      ...(spec.type === undefined ? {} : { type: spec.type }),
      ...(spec.type === 'array' ? { items: { type: spec.items ?? 'string' } } : {}),
      ...spec.schema,
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
    parameters: toJsonSchema(parameters),
    output: { ...options.output, schema: toJsonSchema(options.output.schema) },
    async execute(args: unknown, exec: ToolExecution): Promise<unknown> {
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
          if (!Array.isArray(value) || (spec.items !== undefined && value.some((entry) => typeof entry !== spec.items)))
            throw new Error(
              options.name + ': argument "' + name + '" must be ' + (spec.items ? 'an array of strings' : 'an array'),
            )
        } else if (spec.type !== undefined && typeof value !== spec.type) {
          throw new Error(options.name + ': argument "' + name + '" must be a ' + spec.type)
        }
        if (spec.enum !== undefined && !spec.enum.includes(String(value)))
          throw new Error(options.name + ': argument "' + name + '" must be one of ' + spec.enum.join(', '))
      }
      return options.execute(record as Args, exec)
    },
  }
}
