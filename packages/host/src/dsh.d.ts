/** Minimal ambient declarations for the DSH runtime surface this plugin uses. */
declare module '@deepseek-ai/cordis' {
  export interface Context {
    readonly [key: string]: unknown
    effect(callback: () => void | (() => void | Promise<void>), label?: string): () => void
    on(event: string, listener: (...args: any[]) => any): () => void
    get(name: string): any
    logger: { info(message: string): void; warn(message: string | Error): void; error(message: string | Error): void }
    webServer: any
    provide(name: string, value: unknown): () => void
    sessions: any
    tools: any
    agentPresets: any
    systemPrompt: any
    getOrigin(): string
  }
  export class Service {
    constructor(ctx: Context, name: string)
    protected readonly ctx: Context
  }
}
declare module '@deepseek-ai/dsh-tools' {
  export interface ToolRunContext {
    readonly callId: string
    readonly name: string
    readonly arguments: unknown
    readonly agent?: { readonly session: { readonly id: string; readonly header: { readonly cwd?: string } } }
    readonly signal: AbortSignal
    readonly token: symbol
    readonly parent?: symbol
  }
  export interface UserMessageLike {
    readonly [key: string]: unknown
  }
  export function defineTool<T>(definition: T): T
  export function createUserMessage(input: unknown): UserMessageLike
}
declare module '@deepseek-ai/dsh-llm' {
  export function createUserMessage(input: unknown): unknown
}
