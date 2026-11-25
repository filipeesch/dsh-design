/**
 * Disposable review harness for the packed design plugin.
 *
 * Loaded through a DSH --patch overlay in a throwaway DSH_HOME. It creates one
 * agent session in the review workspace with the design preset, so the
 * owner-gated preview route has a live session, and reports which design tools
 * the packed preset registered. With REVIEW_TOOLS_SMOKE=1 it also executes the
 * packed browser-backed and static tools against the synthetic example.
 */
export const name = 'design-review-session'

const SMOKE = {
  design_lint: { screen: 'catalog', breakpoint: 'mobile' },
  design_run_journey: { journey: 'catalog-to-confirmation' },
  design_screenshot: { screen: 'catalog', breakpoint: 'mobile', highlight: 'products-list' },
  design_view: { screen: 'catalog', breakpoint: 'mobile' },
  design_query: { component: 'Button', id: 'open-*' },
}

/** Exercise one packed tool through the same definition a model would call. */
async function smokeTool(scope, agent, name, args) {
  const definition = scope.tools.definitions(agent).find((tool) => tool.name === name)
  if (definition === undefined) {
    console.log('REVIEW_TOOL', name, 'missing')
    return
  }
  try {
    const result = await definition.execute(args, {
      agent,
      signal: new AbortController().signal,
      token: Symbol(name),
      name,
      arguments: args,
    })
    const summary =
      name === 'design_lint'
        ? {
            errors: result.errors,
            warnings: result.warnings,
            rules: [...new Set(result.findings.map((item) => item.rule))],
          }
        : name === 'design_run_journey'
          ? { ok: result.ok, steps: result.steps.length }
          : name === 'design_screenshot'
            ? { width: result.width, bytes: result.bytes, cachePath: result.path.includes('.cache') }
            : name === 'design_view'
              ? { breakpoint: result.breakpoint, canvas: result.layout?.canvas, nodes: result.layout?.nodes.length }
              : { total: result.total, node: result.matches?.[0]?.node }
    console.log('REVIEW_TOOL', name, JSON.stringify(summary))
  } catch (error) {
    console.log('REVIEW_TOOL', name, 'failed', error instanceof Error ? error.message : String(error))
  }
}

export function apply(ctx) {
  ctx.inject(['sessionController', 'agents', 'tools'], (scope) => {
    const cwd = process.env.REVIEW_CWD
    scope.sessionController
      .create({ sessionId: 'review-session', cwd, agentPreset: 'design' })
      .then(async (created) => {
        console.log('REVIEW_SESSION', created.sessionId, created.agentPreset)
        const agent = scope.agents.get(created.sessionId)
        const names = agent === undefined ? [] : scope.tools.definitions(agent).map((tool) => tool.name)
        console.log(
          'REVIEW_TOOLS',
          names
            .filter((tool) => tool.startsWith('design_'))
            .sort()
            .join(','),
        )
        if (process.env.REVIEW_TOOLS_SMOKE === '1' && agent !== undefined) {
          for (const [name, args] of Object.entries(SMOKE)) await smokeTool(scope, agent, name, args)
          console.log('REVIEW_TOOLS_SMOKE', 'done')
        }
      })
      .catch((error) => {
        console.error('REVIEW_ERROR', error instanceof Error ? error.stack : String(error))
      })
  })
}
