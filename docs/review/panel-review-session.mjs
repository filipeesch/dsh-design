/**
 * Disposable review harness for the Design panel and review comments.
 *
 * Loaded through a DSH --patch overlay in a throwaway DSH_HOME. It registers
 * REVIEW_CWD as a workspace and creates two Design-preset sessions in it, so the
 * panel can be checked with the same project in two independent sessions. With
 * REVIEW_REJECT_FIRST=1 the first design-comment batch is rejected once, which
 * exercises the panel's recovery path without a model or network provider.
 */
export const name = 'design-panel-review-session'

const SESSIONS = [
  ['review-a', 'Review A'],
  ['review-b', 'Review B'],
]

/** Register the workspace, create the review sessions, then wrap prompt admission. */
export function apply(ctx) {
  ctx.inject(['workspaceController', 'workspaceRegistry', 'sessionController', 'agents'], (scope) => {
    const run = async () => {
      const cwd = process.env.REVIEW_CWD
      if (cwd === undefined || cwd === '') throw new Error('REVIEW_CWD is required')
      const created = await scope.workspaceController.create({ path: cwd })
      const workspaceId = created.workspace.workspaceId
      await scope.workspaceController.rename({ workspaceId, title: 'Design review workspace' })
      console.log('REVIEW_WORKSPACE', workspaceId, created.workspace.title)
      for (const [sessionId, title] of SESSIONS) {
        const session = await scope.sessionController.create({
          sessionId,
          workspaceId,
          agentPreset: 'design',
        })
        await scope.sessionController.rename({ sessionId: session.sessionId, title })
        const seeded = await scope.sessionController.prompt(
          {
            requestId: 'review-setup-' + session.sessionId,
            sessionId: session.sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: 'Review setup message (ignore).' }],
          },
          new AbortController().signal,
        )
        console.log('REVIEW_SESSION', session.sessionId, title, seeded.accepted === true ? 'seeded' : 'not-seeded')
      }
      console.log(
        'REVIEW_WORKSPACE_SESSIONS',
        JSON.stringify(scope.workspaceRegistry.get(workspaceId)?.sessionIds ?? []),
      )
      const controller = scope.sessionController
      const original = controller.prompt.bind(controller)
      let rejectFirst = process.env.REVIEW_REJECT_FIRST === '1'
      controller.prompt = async (request, signal) => {
        const text = request?.content?.[0]?.text ?? ''
        if (rejectFirst && text.startsWith('Design review comments')) {
          rejectFirst = false
          console.log('REVIEW_REJECT design batch')
          throw new Error('review harness: simulated session rejection')
        }
        return original(request, signal)
      }
      console.log('REVIEW_READY')
    }
    run().catch((error) => {
      console.error('REVIEW_ERROR', error instanceof Error ? error.stack : String(error))
    })
  })
}
