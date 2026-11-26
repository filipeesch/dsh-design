/** Throwaway DSH overlay: provides offline route metadata but uses real tool dispatch and attachments. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const resolveFromCli = createRequire(process.env.DSH_REVIEW_CLI)
const { LlmAdapter } = await import(pathToFileURL(resolveFromCli.resolve('@deepseek-ai/dsh-llm')).href)

export const name = 'design-authoring-review-session'
const provider = 'design-review-fixture'
const models = { vision: ['text', 'image'], text: ['text'] }
const projection = { screen: 'review', breakpoint: 'mobile', state: 'needs-correction', highlight: 'correction-note' }

function getModel(model) {
  assert.ok(Object.hasOwn(models, model), 'unexpected review model: ' + model)
  return { provider, id: model, name: model, inputModalities: models[model] }
}

async function screenshot(scope, workspaceId, cwd, model) {
  const sessionId = 'authoring-' + model
  await scope.sessionController.create({ sessionId, workspaceId, agentPreset: 'design' })
  await scope.sessionController.rename({ sessionId, title: 'Authoring ' + model })
  const agent = scope.agents.get(sessionId)
  assert.ok(agent, 'Design agent exists')
  const log = { turn: 1, step: 1 }
  const block = {
    type: 'tool-call',
    id: 'capture-' + model,
    name: 'design_screenshot',
    arguments: JSON.stringify(projection),
  }
  // Seed only local session events; no prompt admission or model stream is called.
  const config = { provider, model }
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('step/start', log)
  agent.session.append('request/header', { header: { config }, reason: 'initial' })
  assert.deepEqual(agent.session.requestHeader()?.config, config)
  const route = await scope.llm.resolveModelInfo(provider, model)
  assert.deepEqual(route.inputModalities, models[model])
  const batch = await scope.tools.execute({
    calls: [{ ...block, id: 'status-' + model, name: 'design_status', arguments: '{}' }, block],
    agent,
    log,
    signal: AbortSignal.timeout(45000),
  })
  agent.session.append('step/end', log)
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const status = batch.results[0]?.result
  assert.equal(status?.isError, false)
  assert.equal(status.value.browser.profile, process.env.REVIEW_PROFILE || 'review')
  const result = batch.results[1]?.result
  assert.equal(result?.isError, false, JSON.stringify(result?.error ?? result?.content))
  const { value, content } = result
  for (const [field, expected] of Object.entries(projection)) assert.equal(value[field], expected)
  const artifact = await realpath(resolve(cwd, value.path))
  assert.match(relative(await realpath(cwd), artifact), /^design\/\.cache\/screenshots\/[\w.-]+\.png$/)
  const png = await readFile(artifact)
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a')
  assert.equal(value.width, 390)
  assert.equal(png.readUInt32BE(16), value.width)
  assert.equal(png.readUInt32BE(20), value.height)
  assert.equal(png.length, value.bytes)
  assert.ok(content[0].text.includes(value.path))
  let attachmentSha256
  if (model === 'vision') {
    assert.equal(value.imageDelivery, 'inline')
    assert.equal(value.imageFallback, undefined)
    assert.deepEqual(
      content.map(({ type }) => type),
      ['text', 'image'],
    )
    assert.deepEqual(content[1].attachment, value.attachment)
    const attachment = await scope.attachments.readImage(content[1].attachment)
    assert.equal(attachment.data.length, content[1].attachment.bytes)
    assert.equal(Buffer.from(attachment.data.subarray(0, 8)).toString('hex'), '89504e470d0a1a0a')
    assert.equal(content[1].attachment.width, value.width)
    assert.equal(content[1].attachment.height, value.height)
    attachmentSha256 = createHash('sha256').update(attachment.data).digest('hex')
  } else {
    assert.equal(value.imageDelivery, 'path-only')
    assert.equal(value.attachment, undefined)
    assert.deepEqual(
      content.map(({ type }) => type),
      ['text'],
    )
    assert.match(content[0].text, /Path-only fallback: .*does not declare image input/)
  }
  assert.doesNotMatch(JSON.stringify(result), /data:image|iVBORw0KGgo/)
  return {
    route: config,
    inputModalities: route.inputModalities,
    profile: status.value.browser.profile,
    result,
    pngSha256: createHash('sha256').update(png).digest('hex'),
    attachmentSha256,
  }
}

export function apply(ctx) {
  ctx.inject(['workspaceController', 'sessionController', 'agents', 'tools', 'llm', 'attachments'], (scope) => {
    const run = async () => {
      const { REVIEW_CWD: cwd, REVIEW_OUTPUT: output } = process.env
      assert.ok(cwd && output, 'REVIEW_CWD and REVIEW_OUTPUT are required')
      class ReviewAdapter extends LlmAdapter {
        providerInfo() {
          return { id: provider, name: 'Offline Design review fixture' }
        }
        async listModels() {
          return Object.keys(models).map(getModel)
        }
        async resolveModel(_provider, model) {
          return getModel(model)
        }
        stream() {
          throw new Error('No model requests are permitted in this installed review')
        }
      }
      scope.llm.registerAdapter([provider], new ReviewAdapter())
      const { workspace } = await scope.workspaceController.create({ path: cwd })
      const vision = await screenshot(scope, workspace.workspaceId, cwd, 'vision')
      const text = await screenshot(scope, workspace.workspaceId, cwd, 'text')
      assert.equal(vision.result.value.path, text.result.value.path)
      assert.equal(vision.pngSha256, text.pngSha256)
      await writeFile(
        join(output, 'native-tool-result.json'),
        JSON.stringify({ ok: true, projection, vision, text }, null, 2) + '\n',
      )
      console.log('AUTHORING_REVIEW_READY')
    }
    run().catch((error) => console.error('AUTHORING_REVIEW_ERROR', error))
  })
}
