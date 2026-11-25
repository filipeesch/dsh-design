/** Registers the `design` agent preset. */
import { designPresetPlugins } from './plugins.ts'

/** Plugin name. */
export const name = 'design-preset'
/** Required service: the agent preset registry. */
export const inject = ['agentPresets']

/** Register the preset, cleaning it up with the plugin fiber. */
export function apply(ctx: any): void {
  let disposed = false
  let dispose: (() => Promise<void>) | undefined
  const registration = ctx.agentPresets.register({
    id: 'design',
    name: 'Design',
    description: 'Sketch and iterate on a clickable, responsive design with live preview.',
    order: 2,
    plugins: designPresetPlugins(new URL('./tools.js', import.meta.url).href),
  }) as Promise<() => Promise<void>>
  registration.then(
    (value) => {
      if (disposed) void value()
      else dispose = value
    },
    (error: unknown) => {
      ctx.logger?.warn?.('design preset: ' + (error instanceof Error ? error.message : String(error)))
    },
  )
  ctx.effect(
    () => () => {
      disposed = true
      if (dispose !== undefined) void dispose()
    },
    'design preset registration',
  )
}
