/** Measure one installed lane, or compare two successful lane reports. */
import assert from 'node:assert/strict'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { firstScreen, lastScreen, sessionId, sessionTitle, verifyFixture } from './preview-transfer-fixture.mjs'

const json = (value) => JSON.stringify(value, null, 2) + '\n'
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
if (process.argv[2] === '--compare') {
  const baseline = await readJson(process.argv[3])
  const candidate = await readJson(process.argv[4])
  assert.equal(baseline.provenance.bundle.version, '0.1.3')
  assert.equal(baseline.provenance.bundle.source, 'installed directory copy')
  assert.equal(candidate.provenance.bundle.source, 'packed archive')
  assert.notEqual(candidate.provenance.bundle.hostSha256, baseline.provenance.bundle.hostSha256)
  for (const key of ['fixture', 'hostCliSha256', 'playwrightCore', 'port']) {
    assert.deepEqual(candidate.provenance[key], baseline.provenance[key], 'Nonmatching setup: ' + key)
  }
  assert.deepEqual(candidate.setup, baseline.setup)
  assert.deepEqual(candidate.navigation, baseline.navigation)
  const { responseBodyBytes: before, projectBodyBytes: beforeProject } = baseline.initial
  const { responseBodyBytes: after, projectBodyBytes: afterProject } = candidate.initial
  assert.ok(
    before > after && after > 0 && beforeProject > afterProject && afterProject > 0,
    'Expected a measured reduction',
  )
  console.log(
    json({
      baselineBytes: before,
      candidateBytes: after,
      reductionPercent: 100 * (1 - after / before),
      beforeProject,
      afterProject,
    }),
  )
} else {
  try {
    await measure()
  } catch (error) {
    // A Playwright navigation exception can contain the private owner link.
    console.error(String(error).replaceAll(/http:\/\/127\.0\.0\.1:\d+\/[^\s"']*/g, '<disposable URL>'))
    process.exitCode = 1
  }
}

async function openPanel(page) {
  const session = page
    .locator('[data-slot="sidebar"]')
    .getByText(sessionTitle, { exact: true })
    .and(page.locator(':not([inert], [inert] *)'))
  const configureLater = page.getByRole('button', { name: 'Configure later', exact: true })
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true }).and(page.locator(':enabled'))
  for (let i = 0; i < 8; i++) {
    await session.or(configureLater).or(continueButton).first().waitFor()
    if (await configureLater.isVisible()) await configureLater.click()
    else if (await continueButton.isVisible()) await continueButton.click()
    else break
  }
  await session.click()
  const selector = 'iframe[title="Design preview for ' + sessionId + '"]'
  const iframe = page.locator(selector)
  if (!(await iframe.isVisible())) await page.getByRole('button', { name: 'Design', exact: true }).click()
  await iframe.waitFor()
  return page.frameLocator(selector)
}

async function measure() {
  const root = await realpath(process.env.PREVIEW_TRANSFER_ROOT)
  assert.equal(await readFile(join(root, 'ready'), 'utf8'), 'idle\n')
  const provenance = await readJson(join(root, 'provenance.json'))
  assert.deepEqual(await verifyFixture(root), provenance.fixture)
  const log = await readFile(join(root, 'host.log'), 'utf8')
  const entries = log.match(/http:\/\/127\.0\.0\.1:\d+\/\S+/g) ?? []
  const entry = entries.find((url) => new URL(url).port === String(provenance.port))
  assert.ok(entry, 'No owner entry URL in disposable host log')
  const origin = new URL(entry).origin
  assert.notEqual(new URL(entry).port, '3080')
  const prefix = '/design/' + sessionId + '/'
  const viewport = { width: 1440, height: 900 }
  const browser = await chromium.launch({
    chromiumSandbox: true,
    executablePath: process.env.DSH_DESIGN_CHROMIUM_PATH ?? process.env.PLAYWRIGHT_CHROMIUM_PATH,
  })
  try {
    const context = await browser.newContext({ viewport, locale: 'en-US', serviceWorkers: 'block' })
    context.setDefaultTimeout(8000)
    await context.addInitScript(
      ({ prefix, firstScreen }) => {
        if (window.parent !== window || !location.pathname.startsWith(prefix)) return
        performance.setResourceTimingBufferSize(1000)
        const observer = new MutationObserver(() => {
          const canvas = document.querySelector(
            '.dsx-frame[data-screen="' + firstScreen + '"] [data-dsx-id="queue-heading"]',
          )
          if (!canvas?.getBoundingClientRect().width) return
          performance.mark('first-preview-canvas')
          observer.disconnect()
        })
        observer.observe(document, { childList: true, attributes: true, subtree: true })
      },
      { prefix, firstScreen },
    )
    const gui = await context.newPage()
    await gui.goto(entry, { waitUntil: 'domcontentloaded' })
    const panel = await openPanel(gui)
    await panel.locator('.dsx-frame[data-screen="' + firstScreen + '"] [data-dsx-id="queue-heading"]').waitFor()
    if (process.env.PREVIEW_TRANSFER_SCREENSHOTS === '1')
      await gui.screenshot({ path: join(root, 'desktop-panel.png') })
    const launch = gui.getByRole('link', { name: 'Open in tab', exact: true })
    const href = await launch.getAttribute('href')
    assert.ok(href, 'Missing native panel preview URL')
    const expected = new URL(href, origin)
    assert.equal(expected.origin, origin)
    const [tab] = await Promise.all([context.waitForEvent('page'), launch.click()])
    await tab.waitForFunction(() => performance.getEntriesByName('first-preview-canvas', 'mark').length === 1)
    const initial = await tab.evaluate((prefix) => {
      const cutoff = performance.getEntriesByName('first-preview-canvas', 'mark')[0].startTime
      const all = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')]
      const responses = all
        .filter((item) => {
          const url = new URL(item.name)
          return (
            url.origin === location.origin &&
            url.pathname.startsWith(prefix) &&
            item.responseEnd > 0 &&
            item.responseEnd <= cutoff
          )
        })
        .map((item) => {
          const url = new URL(item.name)
          return {
            path: url.pathname + url.search,
            responseBodyBytes: item.transferSize > 0 ? item.encodedBodySize : 0,
            decodedBodyBytes: item.decodedBodySize,
            protocol: item.nextHopProtocol,
            cached: item.transferSize === 0,
          }
        })
      const sum = (items) => items.reduce((bytes, item) => bytes + item.responseBodyBytes, 0)
      return {
        firstCanvasMs: cutoff,
        responseBodyBytes: sum(responses),
        projectBodyBytes: sum(responses.filter(({ path }) => path.startsWith(prefix + '_/project'))),
        responses,
      }
    }, prefix)
    assert.ok(initial.projectBodyBytes > 0, 'No project bytes transferred through first canvas')
    assert.ok(initial.responses.every(({ protocol, cached }) => cached || protocol === 'http/1.1'))
    const current = new URL(tab.url())
    assert.equal(current.pathname + current.search, expected.pathname + expected.search)
    assert.equal(context.pages().length, 2)
    assert.equal(await panel.locator('.dsx-frame[data-screen="' + firstScreen + '"]').count(), 1)
    if (process.env.PREVIEW_TRANSFER_SCREENSHOTS === '1') await tab.screenshot({ path: join(root, 'desktop-tab.png') })

    // Traverse the full navigator, then use a named situation from the flow map.
    const documentStart = await tab.evaluate(() => performance.timeOrigin)
    const screens = tab.getByRole('button', { name: 'Screens', exact: true })
    if (await screens.isVisible()) await screens.click()
    const navigator = tab.getByRole('navigation', { name: 'Screens' })
    const screenLinks = navigator.getByRole('link', { name: /^Queue \d{2}(?: Start)?$/ })
    assert.equal(await screenLinks.count(), 30)
    await navigator.getByText('Operations', { exact: true }).waitFor()
    await navigator.getByRole('link', { name: 'Queue 30', exact: true }).click()
    await tab
      .locator('.dsx-frame[data-screen="' + lastScreen + '"]')
      .getByText('Queue dashboard 30')
      .waitFor()
    await tab.getByRole('button', { name: 'Flow map', exact: true }).click()
    await tab.getByRole('dialog', { name: 'Flow map' }).getByRole('link', { name: 'Details open', exact: true }).click()
    await tab.getByRole('dialog', { name: 'Case details' }).waitFor()
    assert.equal(
      await tab.evaluate(() => performance.timeOrigin),
      documentStart,
      'Navigation reloaded the preview document',
    )

    if (process.env.PREVIEW_TRANSFER_SCREENSHOTS === '1') {
      await tab.setViewportSize({ width: 390, height: 844 })
      const mobile = new URL(tab.url())
      mobile.searchParams.set('bp', 'mobile')
      await tab.goto(mobile.href)
      await tab.locator('.dsx-frame[data-breakpoint="mobile"]').waitFor()
      await tab.screenshot({ path: join(root, 'mobile-tab.png') })
    }
    const report = {
      provenance,
      setup: {
        browser: browser.version(),
        viewport,
        entry: expected.pathname + expected.search,
        cache: 'fresh context, default cache, service workers blocked, warmed by open panel',
        agent: 'idle; one setup message without a model, no prompts during measurement',
      },
      initial,
      navigation: { screenLinks: 30, selected: lastScreen, situation: 'details-open', reloaded: false },
    }
    await writeFile(join(root, 'measurement.json'), json(report), { mode: 0o600 })
    console.log(json(report))
  } finally {
    await browser.close()
  }
}
