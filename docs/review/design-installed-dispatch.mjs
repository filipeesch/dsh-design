/** DSH patch overlay for deterministic checks against the installed bundle. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { runStatusContract } from './design-installed-status.mjs'

export const name = 'design-installed-dispatch'

const stableTools = [
  'design_catalog',
  'design_diff',
  'design_init',
  'design_lint',
  'design_query',
  'design_run_journey',
  'design_screenshot',
  'design_status',
  'design_validate',
  'design_view',
]
const focused = {
  screen: 'checkout',
  mode: 'geometry',
  nodes: ['price-breakdown', 'place-order', 'not-a-node'],
  cases: [{ breakpoint: 'mobile' }, { breakpoint: 'mobile', state: 'prices-open' }],
}
const candidateCalls = [
  ['invalid-view', 'design_view', { ...focused, cases: [{ breakpoint: 'not-configured' }] }],
  ['initial-readiness', 'design_status', {}],
  ['focused-view', 'design_view', focused],
]
const commonCalls = [
  ['status', 'design_status', {}],
  ['catalog', 'design_catalog', { name: 'Disclosure' }],
  ['validation', 'design_validate', {}],
  ['query', 'design_query', { screen: 'checkout', component: 'Button' }],
  ['geometry', 'design_view', { screen: 'checkout', node: 'place-order', breakpoint: 'mobile' }],
  ['journey', 'design_run_journey', { journey: 'catalog-to-confirmation' }],
  [
    'screenshot',
    'design_screenshot',
    { screen: 'checkout', breakpoint: 'mobile', state: 'prices-open', highlight: 'price-breakdown' },
  ],
]

export function apply(ctx) {
  ctx.inject(['workspaceController', 'sessionController', 'agents', 'tools', 'profileContext'], (scope) => {
    run(scope).catch(() => {
      console.error('DESIGN_DISPATCH_FAILED (see private evidence)')
    })
  })
}

async function run(scope) {
  const {
    DESIGN_EVAL_ROOT: root,
    DESIGN_EVAL_BUNDLE: tarball,
    DESIGN_EVAL_SOURCE: source,
    DESIGN_EVAL_LANE: lane,
  } = process.env
  assert.ok(root && tarball && /^[a-f0-9]{40}$/.test(source) && ['baseline', 'candidate'].includes(lane))
  assert.equal(relative(await realpath(root), await realpath(scope.profileContext.home)), 'home')
  assert.ok(scope.profileContext.name.startsWith('design-eval'))
  const missingBrowser = process.env.DESIGN_EVAL_NO_CHROMIUM === '1'
  const timeout = process.env.DESIGN_EVAL_CHECK_TIMEOUT === '1'
  assert.ok(!(missingBrowser || timeout) || lane === 'candidate')
  const out = join(root, 'dispatch.json')
  const evidence = { source, lane, tarballSha256: digest(await readFile(tarball)), sessions: {}, assertions: {} }
  try {
    const cwd = join(root, 'dispatch')
    if (process.env.DESIGN_EVAL_STATUS) {
      await runStatusContract(scope, evidence, root, cwd, stableTools, dispatch)
      evidence.ok = true
      console.log('DESIGN_DISPATCH_READY')
      return
    }
    if (lane === 'candidate' && !missingBrowser && !timeout) {
      await writeFile(
        join(cwd, 'design/journeys/review-expected-failure.dsx'),
        '<Journey id="review-expected-failure" start="checkout" breakpoint="mobile">\n  <ExpectVisible target="place-order" visible={false} />\n  <ExpectScreen screen="checkout" />\n</Journey>\n',
        { flag: 'wx' },
      )
    }
    const { workspace } = await scope.workspaceController.create({ path: cwd })
    for (const preset of ['design', 'standard']) {
      const sessionId = 'dispatch-' + preset + '-' + Date.now()
      const created = await scope.sessionController.create({
        sessionId,
        workspaceId: workspace.workspaceId,
        agentPreset: preset,
      })
      assert.equal(created.agentPreset, preset)
      const agent = scope.agents.get(sessionId)
      assert.ok(agent, 'Missing scoped agent: ' + preset)
      const schemas = scope.tools.schemas(agent).filter((tool) => tool.name.startsWith('design_'))
      const names = schemas.map(({ name }) => name).sort()
      assert.deepEqual(
        names,
        preset === 'standard' ? [] : [...stableTools, ...(lane === 'baseline' ? ['design_handoff'] : [])].sort(),
      )
      const rows = []
      evidence.sessions[preset] = { schemas, calls: rows }
      const common = missingBrowser || timeout ? commonCalls.slice(0, 4) : commonCalls
      const outcomes =
        missingBrowser || timeout
          ? []
          : [
              ['lint-findings', 'design_lint', { screen: 'checkout', breakpoint: 'mobile' }],
              ['ordinary-failure', 'design_run_journey', { journey: 'review-expected-failure' }],
              ['cancelled', 'design_view', focused],
            ]
      const calls =
        preset === 'standard'
          ? [commonCalls[0]]
          : lane === 'baseline'
            ? common
            : [...candidateCalls, ...common, ...outcomes]
      await dispatch(scope, agent, rows, calls, ({ id, name, result }) => {
        assert.ok(
          result?.content?.some((part) => part.type === 'text' && part.text.trim()),
          'No ordinary output: ' + name,
        )
        if (id === 'cancelled' && result.isError) {
          assert.equal(result.error?.info?.code, 'ABORTED')
          assert.match(result.content[0].text, /abort|cancel/i)
          return
        }
        assert.equal(result.isError, preset === 'standard', 'Unexpected dispatcher outcome: ' + name)
        if (preset === 'standard') assert.match(result.error?.message ?? '', /unknown tool "design_status"/i)
        else assert.ok(result.value && typeof result.value === 'object', 'No canonical result: ' + name)
      })
    }
    const results = Object.fromEntries(evidence.sessions.design.calls.map(({ id, result }) => [id, result]))
    if (lane === 'candidate') {
      const items = evidence.sessions.design.schemas.find(({ name }) => name === 'design_view').parameters.properties
        .cases.items
      assert.deepEqual(items.required, ['breakpoint'])
      assert.equal(items.properties.breakpoint.required, undefined)
      assert.equal(results['invalid-view'].value.errorCode, 'invalid-selection')
      assert.match(results['invalid-view'].content[0].text, /invalid-selection.*not-configured/)
      assert.equal(results['initial-readiness'].value.browser.status, 'unverified')
      const result = results['focused-view']
      if (missingBrowser || timeout) {
        const code = missingBrowser ? 'chromium-missing' : 'timeout'
        assert.equal(result.value.errorCode, code)
        assert.ok(result.content[0].text.startsWith(code + ':'))
      } else {
        assert.ok(result.value.sourceIdentity)
        assert.equal(result.value.text, undefined)
        assert.deepEqual(
          result.value.cases.map(({ nodes }) => nodes.map(({ status }) => status)),
          [
            ['hidden', 'visible', 'absent'],
            ['visible', 'visible', 'absent'],
          ],
        )
        assert.ok(result.content.every(({ type }) => type === 'text'))
        assert.match(result.content[0].text, /not-a-node: absent/)
        assert.ok(results['lint-findings'].value.warnings > 0)
        assert.match(results['lint-findings'].content[0].text, /tap-target/)
        const failure = results['ordinary-failure']
        assert.equal(failure.value.ok, false)
        assert.equal(failure.value.steps.length, 1)
        assert.ok(failure.value.snapshot)
        assert.match(failure.content[0].text, /failed/)
        if (!results.cancelled.isError) {
          assert.equal(results.cancelled.value.errorCode, 'cancelled')
          assert.match(results.cancelled.content[0].text, /^cancelled:/)
        }
      }
    }
    if (missingBrowser || timeout) {
      evidence.assertions = { missingBrowser, timeout, invalidSelectionBeforeLaunch: true }
      evidence.ok = true
      console.log('DESIGN_DISPATCH_READY')
      return
    }
    assert.equal(results.journey.value.ok, true)
    assert.equal(results.geometry.value.layout.canvas.width, 390)
    assert.ok(results.geometry.value.layout.nodes.some((node) => node.id === 'place-order'))
    const shot = results.screenshot.value
    const file = await realpath(resolve(cwd, shot.path))
    assert.match(relative(await realpath(cwd), file), /^design\/\.cache\/screenshots\/[\w.-]+\.png$/)
    const png = await readFile(file)
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a')
    assert.equal(png.readUInt32BE(16), 390)
    assert.equal(png.length, shot.bytes)
    evidence.assertions = { pngSha256: digest(png), pngWidth: 390, journeySteps: results.journey.value.steps.length }
    evidence.ok = true
  } catch (error) {
    evidence.ok = false
    evidence.error = { name: error.name, message: error.message }
  } finally {
    await writeFile(out, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  }
  console.log(evidence.ok ? 'DESIGN_DISPATCH_READY' : 'DESIGN_DISPATCH_FAILED (see private evidence)')
}

/** Run the native DSH tool dispatcher; the model tool call is scripted instead of inferred. */
async function dispatch(scope, agent, rows, calls, check = () => {}) {
  const turn = 1 + new Set(rows.map(({ turn }) => turn)).size
  agent.session.append('turn/start', { turn })
  try {
    for (const [index, [id, name, args]] of calls.entries()) {
      const log = { turn, step: index + 1 }
      agent.session.append('step/start', log)
      const call = { type: 'tool-call', id, name, arguments: JSON.stringify(args) }
      agent.session.append(
        'assistant/message',
        {
          ...log,
          message: { role: 'assistant', source: { kind: 'model' }, content: [call] },
          stream: [],
        },
        { surfaceOp: 'append' },
      )
      const cancellation = id === 'cancelled' ? new AbortController() : undefined
      // Allow the native dispatcher to enter the packed browser tool before cancelling.
      const timer = cancellation && setTimeout(() => cancellation.abort(), 25)
      const result = (
        await scope.tools
          .execute({
            calls: [call],
            agent,
            log,
            signal: cancellation?.signal ?? AbortSignal.timeout(45000),
          })
          .finally(() => clearTimeout(timer))
      ).results[0]?.result
      const row = { turn, id, name, args, result }
      rows.push(row)
      agent.session.append('step/end', log)
      check(row)
    }
  } finally {
    agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
}

function digest(data) {
  return createHash('sha256').update(data).digest('hex')
}
