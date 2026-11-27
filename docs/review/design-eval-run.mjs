/** Submit the frozen user text through the isolated DSH GUI; inspect results separately. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFile, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const { DESIGN_EVAL_ROOT, DESIGN_EVAL_ONLY, DSH_DESIGN_CHROMIUM_PATH } = process.env
const root = await realpath(DESIGN_EVAL_ROOT)
assert.equal((await stat(root)).mode & 0o077, 0, 'Evaluation directory must be private (0700)')
assert.ok(!root.startsWith(resolve(import.meta.dirname, '../..') + '/'), 'Store evidence outside the worktree')
const hostLog = await readFile(join(root, 'host.log'), 'utf8')
const entry = hostLog.match(/^dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/m)?.[1]
assert.ok(entry, 'Isolated GUI entry missing')
const { origin, port } = new URL(entry)
assert.ok(port && port !== '3080', 'Do not drive the active DSH GUI')
const seeded = await json(join(root, 'sessions.json'))
assert.equal(seeded.route.listed, true, 'Pinned model route is not available')
const catalogue = await readFile(new URL('./design-eval-catalogue.json', import.meta.url))
const items = JSON.parse(catalogue).requests
assert.equal(items.length, 5)
const seeds = Object.fromEntries(
  await Promise.all(
    items.map(async ({ id }) => {
      assert.match(id, /^[a-z][a-z-]{0,50}$/)
      assert.ok(seeded.workspaces.includes(id))
      return [id, await manifest(join(root, 'workspaces', id, 'design'))]
    }),
  ),
)
assert.equal(
  new Set(Object.values(seeds).map((seed) => digest(JSON.stringify(seed)))).size,
  1,
  'Workspace seeds differ',
)
const browser = await chromium.launch({ headless: true, executablePath: DSH_DESIGN_CHROMIUM_PATH })
try {
  for (const item of items.filter(({ id }) => !DESIGN_EVAL_ONLY || id === DESIGN_EVAL_ONLY)) {
    const { id, text } = item
    const dir = join(root, 'evidence', id)
    const attempt = join(dir, 'started.json')
    await writeJson(attempt, { promptSha256: digest(text), catalogueSha256: digest(catalogue), seed: seeds[id] }, 'wx')
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    const metric = { id, status: 'incomplete' }
    let checkpoint
    let phase = 'authenticate'
    const frames = []
    const seen = new Set()
    // Capture only event-stream payload bytes, never headers, owner URLs, or token-bearing requests.
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    cdp.on('Network.responseReceived', ({ requestId, response }) => {
      if (!response.url.startsWith(origin + '/') || response.mimeType !== 'text/event-stream') return
      seen.add(requestId)
      void cdp
        .send('Network.streamResourceContent', { requestId })
        .then(({ bufferedData }) => {
          frames.push({ requestId, bufferedData })
        })
        .catch(() => {})
    })
    cdp.on('Network.dataReceived', ({ requestId, data, timestamp }) => {
      if (data && seen.has(requestId)) frames.push({ requestId, data, timestamp })
    })
    const started = Date.now()
    try {
      await page.goto(entry, { waitUntil: 'domcontentloaded' })
      phase = 'open-fresh-design-session'
      for (const label of ['Configure later', 'Continue']) {
        const button = page.getByRole('button', { name: label, exact: true })
        if (
          await button.waitFor({ timeout: 1500 }).then(
            () => true,
            () => false,
          )
        )
          await button.click()
      }
      const workspace = page.getByRole('treeitem').filter({ has: page.getByText(id, { exact: true }) })
      await workspace.hover()
      await workspace.getByRole('button', { name: 'New session in ' + id, exact: true }).click()
      const design = page.getByRole('button', { name: 'Design', exact: true })
      const standard = page.getByRole('button', { name: 'Standard mode', exact: true })
      await design.or(standard).first().waitFor()
      if (!(await design.isVisible())) {
        await standard.click()
        await page.getByText('Design', { exact: true }).last().click()
      }
      await design.waitFor()
      await page.screenshot({ path: join(dir, 'before.png') })
      phase = 'submit-user-text-only'
      const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
      assert.equal(await composer.textContent(), '')
      await composer.fill(text)
      assert.equal(await composer.textContent(), text)
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      phase = 'wait-for-native-checkpoint'
      checkpoint = await waitForJson(join(dir, 'settled.json'), Number(process.env.DESIGN_EVAL_TIMEOUT_MS || 180000))
      assert.equal(checkpoint.persisted, true)
      const events = (await readFile(join(dir, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
      assert.deepEqual([...new Set(events.map((event) => event.sessionId))], [checkpoint.sessionId])
      assert.deepEqual(
        events
          .filter(({ type, data }) => type === 'user/message' && data.source.kind === 'user')
          .map(({ data }) => messageText(data)),
        [text],
      )
      const route = events.filter(({ type }) => type === 'request/header').map(({ data }) => data.header.config)
      assert.ok(route.length > 0, 'Session did not materialize a model route')
      assert.ok(
        route.every(({ provider, model }) => provider === seeded.route.provider && model === seeded.route.model),
      )
      phase = 'read-native-evidence'
      const last = events.find(({ seq }) => seq === checkpoint.seq)
      Object.assign(metric, {
        status: last.data.reason.kind === 'completed' ? 'completed' : 'incomplete',
        reason: last.data.reason.kind,
        code: last.data.reason.error?.code,
        roundTrips: events.filter(({ type }) => type === 'assistant/message' || type === 'assistant/attempt').length,
        usage: events
          .filter(({ type, data }) => type === 'assistant/message' && data.usage)
          .map(({ seq, data }) => ({ seq, ...data.usage })),
        route,
        requestVerified: true,
      })
      const calls = events.filter(({ type }) => type === 'tool/call' || type.startsWith('tool/ptc-dispatch-'))
      const results = events
        .filter(({ type }) => type === 'tool/result')
        .map(({ seq, data }) => ({
          seq,
          id: data.message.toolCallId,
          isError: data.message.isError === true,
          textBytes: Buffer.byteLength(messageText(data.message)),
          imageBytes: data.message.content.reduce(
            (sum, part) => sum + (part.type === 'image' ? (part.attachment?.bytes ?? 0) : 0),
            0,
          ),
        }))
      metric.tools = {
        calls: calls.length,
        results: results.length,
        textBytes: results.reduce((sum, row) => sum + row.textBytes, 0),
        imageBytes: results.reduce((sum, row) => sum + row.imageBytes, 0),
      }
      await writeJson(join(dir, 'tool-calls.json'), { calls, results })
      await writeJson(
        join(dir, 'transcript.json'),
        events.flatMap(({ seq, type, data }) =>
          type === 'user/message' && data.source.kind === 'user'
            ? [{ seq, role: 'user', text: messageText(data) }]
            : type === 'assistant/message'
              ? [{ seq, role: 'assistant', text: messageText(data.message) }]
              : [],
        ),
      )
      await page.screenshot({ path: join(dir, 'after.png') })
      // The grader never feeds back into the GUI composer or conversation.
      const designRoot = join(root, 'workspaces', id, 'design')
      const after = await manifest(designRoot)
      metric.changedSources = [...new Set([...Object.keys(after), ...Object.keys(seeds[id])])].filter(
        (path) => after[path] !== seeds[id][path],
      )
      if (metric.status === 'completed') {
        phase = 'verify-preview-and-artifact'
        await verifyPreview(page, origin, checkpoint.sessionId, item.preview, dir, metric)
        if (id === 'create-simple') metric.screenshots = await screenshots(designRoot)
      }
    } catch (error) {
      // Error messages from Playwright and adapters may carry owner links or secrets.
      metric.issue = { phase, type: error.name }
    } finally {
      metric.elapsedMs = Date.now() - started
      await writeJson(join(dir, 'summary.json'), metric)
      if (frames.length)
        await appendFile(join(dir, 'sse.jsonl'), frames.map((line) => JSON.stringify(line) + '\n').join(''), {
          mode: 0o600,
        })
      await context.close()
      console.log(id, metric.status, metric.reason ?? '', metric.issue?.phase ?? '')
    }
  }
} finally {
  await browser.close()
}

function messageText(message) {
  return message.content
    .filter((part) => part.type === 'text')
    .map(({ text }) => text)
    .join('')
}

function digest(data) {
  return createHash('sha256').update(data).digest('hex')
}

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function writeJson(file, data, flag = 'w') {
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag })
}

async function waitForJson(file, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      return await json(file)
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    await delay(400)
  }
  throw new Error('Turn did not reach a durable checkpoint before the fixed deadline')
}

async function manifest(root, relative = '') {
  const output = {}
  const files = await readdir(join(root, relative), { withFileTypes: true })
  for (const file of files.sort((one, two) => one.name.localeCompare(two.name))) {
    if (file.name === '.cache' || file.name === '.git') continue
    const path = join(relative, file.name)
    if (file.isDirectory()) Object.assign(output, await manifest(root, path))
    else if (file.isFile()) output[path] = digest(await readFile(join(root, path)))
    else output[path] = 'non-regular'
  }
  return output
}

async function screenshots(designRoot) {
  const cache = join(await realpath(designRoot), '.cache', 'screenshots')
  assert.equal(await realpath(cache), cache)
  const files = (await readdir(cache, { withFileTypes: true })).filter(
    (file) => file.isFile() && file.name.endsWith('.png'),
  )
  return Promise.all(
    files.map(async ({ name }) => {
      const png = await readFile(join(cache, name))
      assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a')
      return {
        path: 'design/.cache/screenshots/' + name,
        bytes: png.length,
        width: png.readUInt32BE(16),
        height: png.readUInt32BE(20),
        sha256: digest(png),
      }
    }),
  )
}

async function verifyPreview(page, origin, session, selected, dir, metric) {
  const { screen, bp, state, visible, disclosure, navigate } = selected
  const params = new URLSearchParams({ bp, ...(state ? { state } : {}) })
  await page.goto(origin + '/design/' + encodeURIComponent(session) + '/' + encodeURIComponent(screen) + '?' + params)
  const canvas = page.locator('.dsx-frame[data-screen="' + screen + '"][data-breakpoint="' + bp + '"]')
  await canvas.waitFor()
  metric.preview = {
    screen,
    bp,
    state,
    canvasWidth: await canvas.evaluate((node) => node.getBoundingClientRect().width),
  }
  if (disclosure) {
    const button = canvas.getByRole('button', { name: disclosure, exact: true })
    await button.waitFor()
    assert.equal(await button.getAttribute('aria-expanded'), 'false')
    assert.equal(await canvas.getByText(visible, { exact: true }).isVisible(), false)
    metric.preview.initiallyCollapsed = true
    await button.click()
    const body = canvas.getByText(visible, { exact: true })
    await body.waitFor()
    // Scope the navigation to the disclosure region, not an existing sibling button.
    const regionId = await button.getAttribute('aria-controls')
    assert.ok(regionId)
    const region = canvas.locator('[id=' + JSON.stringify(regionId) + ']')
    await region.getByRole('button', { name: navigate, exact: true }).click()
    await page.locator('.dsx-frame[data-screen="catalog"]').waitFor()
    metric.preview.disclosureRoundTrip = true
  } else {
    await canvas.getByText(visible, { exact: true }).first().waitFor()
    metric.preview.visible = visible
    if (screen === 'checkout' && !state) {
      metric.preview.buttonBox = await canvas.getByRole('button', { name: 'Place order', exact: true }).boundingBox()
    }
  }
  await page.screenshot({ path: join(dir, 'preview.png') })
}
