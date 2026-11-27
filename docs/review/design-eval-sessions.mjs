/** Boot only synthetic workspaces and checkpoint the evaluated DSH conversations. */
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

export const name = 'design-eval-sessions'

export function apply(ctx) {
  ctx.inject(['workspaceController', 'agents', 'tools', 'llm', 'sessions', 'profileContext'], (scope) => {
    seed(scope).catch(() => console.error('DESIGN_EVAL_SEED_FAILED'))
  })
}

async function seed(scope) {
  const { DESIGN_EVAL_ROOT: root, DESIGN_EVAL_PROVIDER: provider, DESIGN_EVAL_MODEL: model } = process.env
  assert.ok(root && provider && model)
  const hostHome = await realpath(scope.profileContext.home)
  assert.equal(relative(await realpath(root), hostHome), 'home')
  assert.ok(scope.profileContext.name.startsWith('design-eval'))
  const workspaces = join(await realpath(root), 'workspaces')
  const evidence = join(root, 'evidence')
  await mkdir(evidence, { mode: 0o700 })
  const ids = new Map()
  scope.on('session/event', (session, event) => {
    const id = ids.get(session.header.cwd)
    if (!id || !/^(user\/message|assistant\/|tool\/|turn\/|request\/header|llm\/retry)/.test(event.type)) return
    const file = join(evidence, id, 'events.jsonl')
    appendFileSync(file, JSON.stringify({ sessionId: session.id, ...event }) + '\n', { mode: 0o600 })
    if (event.type === 'turn/end') {
      // The append above is a committed Session event. Also demand native storage durability.
      void scope.sessions
        .flush(session)
        .then(async (persisted) => {
          const agent = scope.agents.get(session.id)
          await writeFile(
            join(evidence, id, 'settled.json'),
            JSON.stringify({
              sessionId: session.id,
              persisted,
              seq: event.seq,
              schemas:
                agent === undefined ? [] : scope.tools.schemas(agent).filter(({ name }) => name.startsWith('design_')),
            }),
            { mode: 0o600, flag: 'wx' },
          )
        })
        .catch(() => console.error('DESIGN_EVAL_CHECKPOINT_FAILED'))
    }
  })
  const modelInfo = await scope.llm.resolveModelInfo(provider, model).catch(() => undefined)
  for (const entry of await readdir(workspaces, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z][a-z-]{0,50}$/.test(entry.name)) continue
    const dir = join(workspaces, entry.name)
    ids.set(dir, entry.name)
    await mkdir(join(evidence, entry.name), { mode: 0o700 })
    await scope.workspaceController.create({ path: dir })
  }
  await writeFile(
    join(root, 'sessions.json'),
    JSON.stringify(
      {
        route: { provider, model, listed: modelInfo !== undefined, inputModalities: modelInfo?.inputModalities },
        workspaces: [...ids.values()],
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600, flag: 'wx' },
  )
  console.log('DESIGN_EVAL_SEED_READY')
}
