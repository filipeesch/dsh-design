/**
 * Disposable harness for the variants review.
 *
 * Loaded through a DSH --patch overlay in a throwaway DSH_HOME. It registers
 * REVIEW_CWD as a workspace, creates the "Variants Review" Design session, and
 * executes the packed variant-aware tools so the boot log records the chosen and
 * alternate projections, screenshots, and semantic diff. No model is needed.
 */
export const name = 'design-variants-review-session'

const SESSION_ID = 'variants-review'

async function callTool(scope, agent, name, args) {
  const definition = scope.tools.definitions(agent).find((tool) => tool.name === name)
  if (definition === undefined) return { missing: true }
  return definition.execute(args, {
    agent,
    signal: new AbortController().signal,
    token: Symbol(name),
    name,
    arguments: args,
  })
}

export function apply(ctx) {
  ctx.inject(['workspaceController', 'workspaceRegistry', 'sessionController', 'agents', 'tools'], (scope) => {
    const run = async () => {
      const cwd = process.env.REVIEW_CWD
      if (cwd === undefined || cwd === '') throw new Error('REVIEW_CWD is required')
      const created = await scope.workspaceController.create({ path: cwd })
      const workspaceId = created.workspace.workspaceId
      await scope.workspaceController.rename({ workspaceId, title: 'Variants review workspace' })
      console.log('REVIEW_WORKSPACE', workspaceId)
      const session = await scope.sessionController.create({
        sessionId: SESSION_ID,
        workspaceId,
        agentPreset: 'design',
      })
      await scope.sessionController.rename({ sessionId: session.sessionId, title: 'Variants Review' })
      await scope.sessionController.prompt(
        {
          requestId: 'variants-review-setup',
          sessionId: session.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: 'Variants review setup message (ignore).' }],
        },
        new AbortController().signal,
      )
      const agent = scope.agents.get(session.sessionId)
      const names = agent === undefined ? [] : scope.tools.definitions(agent).map((tool) => tool.name)
      console.log(
        'REVIEW_TOOLS',
        names
          .filter((name) => name.startsWith('design_'))
          .sort()
          .join(','),
      )
      if (agent !== undefined && process.env.REVIEW_TOOLS_SMOKE === '1') {
        const status = await callTool(scope, agent, 'design_status', {})
        console.log('REVIEW_VARIANTS', JSON.stringify({ screens: status.screens?.length, variants: status.variants }))
        const chosen = await callTool(scope, agent, 'design_view', { screen: 'catalog' })
        const alternate = await callTool(scope, agent, 'design_view', { screen: 'catalog', variant: 'layout:spacious' })
        console.log(
          'REVIEW_VARIANT_VIEW',
          JSON.stringify({
            chosen: chosen.text?.includes('Compact catalog'),
            alternate: alternate.text?.includes('Spacious catalog'),
            alternateVariant: alternate.variant,
          }),
        )
        const query = await callTool(scope, agent, 'design_query', {
          screen: 'catalog',
          id: 'checkout',
          variant: 'layout:spacious',
        })
        console.log('REVIEW_VARIANT_QUERY', JSON.stringify({ total: query.total, variant: query.variant }))
        const compact = await callTool(scope, agent, 'design_screenshot', {
          screen: 'catalog',
          breakpoint: 'mobile',
        })
        const spacious = await callTool(scope, agent, 'design_screenshot', {
          screen: 'catalog',
          breakpoint: 'mobile',
          variant: 'layout:spacious',
        })
        console.log(
          'REVIEW_VARIANT_SCREENSHOTS',
          JSON.stringify({
            distinct: compact.path !== spacious.path,
            chosenCache: compact.path?.includes('.cache/screenshots'),
            alternateBytes: spacious.bytes,
            alternateVariant: spacious.variant,
          }),
        )
        const diff = await callTool(scope, agent, 'design_diff', {
          screen: 'catalog',
          group: 'layout',
          from: 'compact',
          to: 'spacious',
        })
        console.log(
          'REVIEW_VARIANT_DIFF',
          JSON.stringify({
            ok: diff.ok,
            moves: diff.moves?.map((move) => ({ node: move.node, reason: move.reason })),
            changes: diff.changes?.map((change) => ({ node: change.node, kind: change.kind, after: change.after })),
          }),
        )
        console.log(
          'REVIEW_DISCARD_IGNORED',
          JSON.stringify({
            screens: status.screens?.map((screen) => screen.id),
            discarded: status.screens?.some((screen) => screen.id === 'rejected') ?? false,
          }),
        )
      }
      console.log('REVIEW_READY')
    }
    run().catch((error) => {
      console.error('REVIEW_ERROR', error instanceof Error ? error.stack : String(error))
    })
  })
}
