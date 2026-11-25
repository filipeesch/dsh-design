export interface ToolDefinition {
  name: string
  [key: string]: unknown
}

export function defineTool<T extends ToolDefinition>(definition: T): T {
  return definition
}
