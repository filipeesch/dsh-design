/** Browser verification of the installed plugin, including its iframe inside the real DSH shell. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const { REVIEW_STARTUP_LOG, REVIEW_OUTPUT, DSH_DESIGN_CHROMIUM_PATH } = process.env
assert.ok(REVIEW_STARTUP_LOG && REVIEW_OUTPUT, 'REVIEW_STARTUP_LOG and REVIEW_OUTPUT are required')
const entry = (await readFile(REVIEW_STARTUP_LOG, 'utf8')).match(
  /^dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/m,
)?.[1]
assert.ok(entry, 'disposable server did not print its owner entry URL')
const origin = new URL(entry).origin
const session = 'authoring-vision'
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  executablePath: DSH_DESIGN_CHROMIUM_PATH,
})
const evidence = { ok: true, screenshots: {} }
const pageErrors = []

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const buffer = await page.screenshot({ path: join(REVIEW_OUTPUT, name + '.png'), animations: 'disabled' })
  evidence.screenshots[name] = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

async function observedPage(viewport) {
  const context = await browser.newContext({ viewport, locale: 'en-US' })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  try {
    await page.goto(entry, { waitUntil: 'domcontentloaded' })
  } catch {
    // Do not print the owner URL even if Playwright cannot navigate to it.
    throw new Error('Could not authenticate to the disposable DSH profile')
  }
  return page
}

try {
  const desktop = await observedPage({ width: 1560, height: 920 })
  await desktop.goto(origin + '/design/' + session + '/document?bp=desktop')
  const canvas = desktop.locator('.dsx-frame[data-screen="document"][data-breakpoint="desktop"]')
  await canvas.waitFor()
  const sidebar = desktop.getByRole('navigation', { name: 'Screens' })
  await sidebar.getByText('Editorial workflow').waitFor()
  await desktop.getByText('Read the draft and submit it for editorial review.', { exact: true }).waitFor()
  assert.equal(await canvas.evaluate((node) => Math.round(node.getBoundingClientRect().width)), 1280)
  assert.ok(await desktop.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await capture(desktop, 'desktop-preview')
  await desktop.getByRole('button', { name: 'Hide screens' }).click()
  await sidebar.waitFor({ state: 'hidden' })
  await desktop.getByRole('button', { name: 'Show screens' }).click()
  await sidebar.waitFor()

  await desktop.getByRole('button', { name: 'Submit for review' }).click()
  await desktop.getByText('Waiting for editorial review', { exact: true }).waitFor()
  const outcomes = desktop.getByRole('region', { name: 'Simulated outcomes' })
  await outcomes.getByRole('button', { name: 'Approval', exact: true }).waitFor()
  await outcomes.getByRole('button', { name: 'Correction request', exact: true }).waitFor()
  await desktop.getByRole('button', { name: 'Flow map' }).click()
  const map = desktop.getByRole('dialog', { name: 'Flow map' })
  await map.waitFor()
  assert.equal(await map.getByRole('button', { name: 'Near this screen' }).getAttribute('aria-pressed'), 'true')
  for (const label of ['Prototype click', 'Manual simulation', 'Illustrative only'])
    await map.getByText(label, { exact: true }).first().waitFor()
  assert.equal(await map.getByRole('link', { name: /Review status.*Current/ }).getAttribute('aria-current'), 'page')
  const twoWayPaths = await map
    .locator('svg > path[data-kind="prototype"]')
    .evaluateAll((paths) => paths.map((path) => path.getAttribute('d')))
  assert.equal(twoWayPaths.length, 2)
  assert.notEqual(twoWayPaths[0].match(/^M \d+ (\d+)/)?.[1], twoWayPaths[1].match(/^M \d+ (\d+)/)?.[1])
  await map
    .getByRole('region', { name: 'Situation shortcuts' })
    .getByRole('link', { name: 'Awaiting review' })
    .waitFor()
  await capture(desktop, 'focused-map')
  await desktop.keyboard.press('Escape')
  await map.waitFor({ state: 'hidden' })
  assert.ok(await desktop.getByRole('button', { name: 'Flow map' }).evaluate((node) => node === document.activeElement))

  await outcomes.getByRole('button', { name: 'Correction request', exact: true }).press('Enter')
  await desktop.getByText('Revise the opening hours', { exact: true }).waitFor()
  await desktop.getByText(/Add the Saturday opening time/).waitFor()
  assert.equal(await desktop.getByRole('button', { name: 'Editorial note' }).getAttribute('aria-expanded'), 'true')
  assert.equal(await outcomes.count(), 0)
  await desktop.waitForFunction(() => document.activeElement?.matches('.dsx-screen-context h1'))
  assert.equal(new URL(desktop.url()).searchParams.get('state'), 'needs-correction')
  assert.equal(new URL(desktop.url()).searchParams.get('situation'), 'correction-requested')
  evidence.correction = {
    route: new URL(desktop.url()).pathname + new URL(desktop.url()).search,
    disclosureExpanded: true,
  }
  await capture(desktop, 'simulated-correction')

  await desktop
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Awaiting review' })
    .press('Enter')
  await desktop.getByRole('button', { name: 'Flow map' }).click()
  const currentShortcut = map
    .getByRole('region', { name: 'Situation shortcuts' })
    .getByRole('link', { name: /Awaiting review/ })
  assert.equal(await currentShortcut.getAttribute('aria-current'), 'page')
  await map.getByRole('link', { name: /Review status.*Active screen/ }).waitFor()
  assert.equal(
    await map
      .locator('.dsx-map-layout')
      .getByRole('link', { name: /Awaiting review/ })
      .count(),
    0,
  )
  await desktop.keyboard.press('Escape')

  const mobile = await observedPage({ width: 390, height: 844 })
  const configureLater = mobile.getByRole('button', { name: /Configure later|Configurar mais tarde/i })
  if (
    await configureLater.waitFor({ timeout: 3500 }).then(
      () => true,
      () => false,
    )
  )
    await configureLater.click()
  const continueOnboarding = mobile.getByRole('button', { name: /^(Continue|Continuar)$/ })
  if (
    await continueOnboarding.waitFor({ timeout: 1500 }).then(
      () => true,
      () => false,
    )
  )
    await continueOnboarding.click()
  const sidebarToggle = mobile.getByRole('button', { name: /Open sidebar|Toggle sidebar/ })
  const sessionLink = mobile.locator('[data-slot="sidebar"]').getByText('Authoring vision', { exact: true })
  if (!(await sessionLink.isVisible()) && (await sidebarToggle.isVisible())) await sidebarToggle.click()
  await sessionLink.click()
  await mobile.getByRole('button', { name: 'Design', exact: true }).click()
  const iframe = mobile.locator('iframe[title="Design preview for ' + session + '"]')
  await iframe.waitFor()
  const embedded = iframe.contentFrame()
  await embedded.getByLabel('Breakpoint').selectOption('mobile')
  const embeddedCanvas = embedded.locator('.dsx-frame[data-screen="document"][data-breakpoint="mobile"]')
  await embeddedCanvas.waitFor()
  const iframeWidth = Math.round((await iframe.boundingBox()).width)
  assert.ok(iframeWidth > 0 && iframeWidth <= 390)
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  const screens = embedded.getByRole('button', { name: 'Screens', exact: true })
  await screens.press('Enter')
  const navigator = embedded.getByRole('dialog', { name: 'Browse screens' })
  const awaiting = navigator.getByRole('link', { name: 'Awaiting review', exact: true })
  await awaiting.waitFor()
  await navigator.getByRole('link', { name: 'Correction requested', exact: true }).waitFor()
  assert.equal(new URL(await awaiting.getAttribute('href'), origin).searchParams.get('bp'), 'mobile')
  assert.equal(new URL(await awaiting.getAttribute('href'), origin).searchParams.get('situation'), 'awaiting-review')
  const modalBox = await navigator.boundingBox()
  assert.ok(modalBox.width <= iframeWidth + 1)
  await capture(mobile, 'narrow-embedded-navigator')
  await awaiting.press('Enter')
  await navigator.waitFor({ state: 'hidden' })
  await embedded.locator('.dsx-frame[data-screen="review"][data-breakpoint="mobile"]').waitFor()
  await embedded.getByText('Waiting for editorial review', { exact: true }).waitFor()
  evidence.embedded = {
    iframeWidth,
    modalWidth: Math.round(modalBox.width),
    breakpoint: 'mobile',
    keyboardNavigation: true,
  }
  assert.deepEqual(pageErrors, [])
  await writeFile(join(REVIEW_OUTPUT, 'browser-result.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await browser.close()
}
