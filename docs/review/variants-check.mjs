/**
 * Repeatable browser review for design variants.
 *
 * Usage:
 *   DSH_ENTRY_URL='<printed owner entry URL>' \
 *   DSH_DESIGN_CHROMIUM_PATH='<chromium executable>' \
 *     node docs/review/variants-check.mjs
 *
 * The disposable profile must have run docs/review/variants-review-session.mjs
 * with REVIEW_CWD pointing at a copy of examples/synthetic-variants/design and
 * REVIEW_TOOLS_SMOKE=1. The report names no owner token, session credential, or
 * machine path.
 */
import { chromium } from 'playwright-core'

const entry = process.env.DSH_ENTRY_URL
if (entry === undefined || entry === '') throw new Error('DSH_ENTRY_URL is required')
const origin = new URL(entry).origin
const executablePath = process.env.DSH_DESIGN_CHROMIUM_PATH
const browser = await chromium.launch({
  headless: true,
  ...(executablePath === undefined ? {} : { executablePath }),
})
const failures = []
const evidence = {}

function check(condition, message, value) {
  if (!condition) failures.push(message)
  if (value !== undefined) evidence[message] = value
  return condition
}

async function dismissOnboarding(target) {
  const later = ['Configure later', 'Configurar mais tarde']
  const resume = ['Continue', 'Continuar']
  for (let index = 0; index < 10; index += 1) {
    let handled = false
    for (const label of later) {
      if (!(await target.getByRole('button', { name: label, exact: true }).count())) continue
      await target.getByRole('button', { name: label, exact: true }).click()
      await target.waitForTimeout(500)
      handled = true
      break
    }
    if (handled) continue
    for (const label of resume) {
      if (!(await target.getByRole('button', { name: label, exact: true }).count())) continue
      await target.getByRole('button', { name: label, exact: true }).click()
      await target.waitForTimeout(500)
      handled = true
      break
    }
    if (!handled) break
  }
}

async function openPreview(context, path, viewport) {
  const page = await context.newPage()
  await page.setViewportSize(viewport)
  const requests = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('pageerror', (error) => console.log('preview error: ' + String(error)))
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' })
  page.requests = requests
  return page
}

async function frameOf(page, pane) {
  const frame = page.frameLocator('iframe[data-dsx-pane="' + pane + '"]')
  await frame.locator('.dsx-frame').waitFor()
  return frame
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
const entryPage = await context.newPage()
await entryPage.goto(entry, { waitUntil: 'domcontentloaded' })
await entryPage.waitForTimeout(2000)
await dismissOnboarding(entryPage)

// Clear any drafts left by an earlier session on this disposable profile.
await entryPage.evaluate(async () => {
  const base = '/design/variants-review/_/comments'
  const snapshot = await (await fetch(base)).json()
  for (const draft of snapshot.drafts) {
    await fetch(base + '/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-design-comments': '1' },
      body: JSON.stringify({ id: draft.id, revision: draft.revision }),
    })
  }
})

// 1. Chosen projection and explicit alternate deep links.
const chosen = await openPreview(context, '/design/variants-review/catalog?bp=desktop', { width: 1440, height: 900 })
await chosen.locator('.dsx-frame').waitFor()
check(await chosen.getByText('Compact catalog').isVisible(), 'chosen route renders the compact branch')
check((await chosen.getByText('Spacious catalog').count()) === 0, 'chosen route omits the alternate branch')
check(
  (await chosen.locator('.dsx-frame').evaluate((element) => element.getBoundingClientRect().width)) === 1280,
  'chosen desktop canvas is exactly 1280 CSS pixels',
  1280,
)
await chosen.close()

const alternate = await openPreview(context, '/design/variants-review/catalog?bp=desktop&variant=layout:spacious', {
  width: 1440,
  height: 900,
})
await alternate.locator('.dsx-frame').waitFor()
check(await alternate.getByText('Spacious catalog').isVisible(), 'explicit variant route renders the alternate branch')
check((await alternate.getByText('Compact catalog').count()) === 0, 'explicit variant route omits the chosen branch')
check(
  (await alternate.locator('.dsx-shell').getAttribute('data-dsx-variant')) === 'layout:spacious',
  'explicit route identifies the effective branch',
)
check(await alternate.getByText(/layout · spacious/).isVisible(), 'chrome labels the branch and choice')
check(
  (await alternate.locator('.dsx-frame').evaluate((element) => element.getBoundingClientRect().width)) === 1280,
  'alternate desktop canvas is exactly 1280 CSS pixels',
  1280,
)
await alternate.close()

// 2. Comparison at desktop and 390 CSS pixels.
const desktop = await openPreview(
  context,
  '/design/variants-review/catalog?bp=desktop&compare=layout:compact:spacious',
  { width: 1440, height: 900 },
)
await desktop.waitForSelector('.dsx-compare')
const desktopLeft = await frameOf(desktop, 'left')
const desktopRight = await frameOf(desktop, 'right')
await desktopLeft.getByText('Compact catalog').waitFor()
await desktopRight.getByText('Spacious catalog').waitFor()
check(
  (await desktopLeft.locator('.dsx-frame').evaluate((element) => element.getBoundingClientRect().width)) === 1280,
  'desktop left pane keeps 1280 CSS pixels',
  1280,
)
check(
  (await desktopRight.locator('.dsx-frame').evaluate((element) => element.getBoundingClientRect().width)) === 1280,
  'desktop right pane keeps 1280 CSS pixels',
  1280,
)
check(
  (await desktop.evaluate(() => document.documentElement.scrollWidth)) <= 1440,
  'desktop comparison page has no horizontal overflow',
)
await desktop.close()

const phone = await openPreview(context, '/design/variants-review/catalog?bp=mobile&compare=layout:compact:spacious', {
  width: 390,
  height: 844,
})
await phone.waitForSelector('.dsx-compare')
const phoneLeft = await frameOf(phone, 'left')
const phoneRight = await frameOf(phone, 'right')
await phoneLeft.getByText('Compact catalog').waitFor()
await phoneRight.getByText('Spacious catalog').waitFor()
check(
  (await phoneLeft.locator('.dsx-frame').evaluate((element) => element.getBoundingClientRect().width)) === 390,
  'phone left pane keeps 390 CSS pixels',
  390,
)
check(
  (await phoneRight.locator('.dsx-frame').evaluate((element) => element.getBoundingClientRect().width)) === 390,
  'phone right pane keeps 390 CSS pixels',
  390,
)
check(
  (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 390,
  'phone comparison page has no horizontal overflow',
)
const scroller = phone.locator('.dsx-compare-scroll')
check(
  (await scroller.evaluate((element) => element.scrollWidth)) >
    (await scroller.evaluate((element) => element.clientWidth)),
  'phone comparison scrolls inside its region',
)
await scroller.focus()
await phone.keyboard.press('ArrowRight')
await phone.keyboard.press('ArrowRight')
await phone.waitForTimeout(200)
check(
  (await scroller.evaluate((element) => element.scrollLeft)) > 0,
  'phone comparison is keyboard scrollable',
  await scroller.evaluate((element) => element.scrollLeft),
)

// A shared starting-state change applies to both panes; clearing it resets
// both drawers and seeded values.
await phone.getByLabel('Starting state').selectOption('filters-open')
await phoneLeft.getByText('Filter panels').waitFor({ state: 'visible' })
await phoneRight.getByText('Filter panels').waitFor({ state: 'visible' })
check(
  (await phoneLeft.locator('[data-dsx-id="search"] input').inputValue()) === 'aurora',
  'named state seeds the left pane',
)
check(
  (await phoneRight.locator('[data-dsx-id="search"] input').inputValue()) === 'aurora',
  'named state seeds the right pane',
)
await phone.getByLabel('Starting state').selectOption('')
await phoneLeft.getByText('Filter panels').waitFor({ state: 'hidden' })
await phoneRight.getByText('Filter panels').waitFor({ state: 'hidden' })
check(
  (await phoneLeft.locator('[data-dsx-id="search"] input').inputValue()) === '',
  'clearing the shared state resets the left pane',
)
check(
  (await phoneRight.locator('[data-dsx-id="search"] input').inputValue()) === '',
  'clearing the shared state resets the right pane',
)

// 3. Independent interaction and modal focus.
await phoneLeft.getByRole('button', { name: 'Filters' }).click()
await phoneLeft.getByText('Filter panels').waitFor({ state: 'visible' })
check(
  (await phoneRight.getByText('Filter panels').count()) === 0,
  'opening the left drawer does not change the right pane',
)
const leftFrame = phone.frames().find((frame) => frame.url().includes('pane=left'))
check(leftFrame !== undefined, 'left pane is an isolated frame')
check(
  (await leftFrame.evaluate(
    () =>
      document.activeElement !== null &&
      (document.activeElement.closest('[role="dialog"]') !== null ||
        document.activeElement.closest('[data-dsx-id="filters"]') !== null),
  )) === true,
  'left pane moves modal focus inside its own document',
)
await phoneLeft.locator('[data-dsx-id="close-filters"]').click()
await phone.waitForTimeout(200)
await phoneRight.locator('[data-dsx-id="search"] input').fill('aurora')
check(
  (await phoneLeft.locator('[data-dsx-id="search"] input').inputValue()) === '',
  'field edits stay inside their pane',
)

// 4. A comment on a shared stable id pins only its own branch and stays queued.
await phoneRight.getByRole('button', { name: 'Comment', exact: true }).click()
await phoneRight.locator('[data-dsx-id="open-filters"]').click()
await phoneRight.getByRole('textbox', { name: 'Comment text' }).fill('Spacious branch note')
await phoneRight.getByRole('button', { name: 'Save comment' }).click()
await phoneRight.getByRole('button', { name: /Pending \(1\)/ }).waitFor({ timeout: 8000 })
check(
  (await phoneRight.getByRole('button', { name: /Pending \(1\)/ }).count()) === 1,
  'alternate pane records one draft',
)
check((await phoneRight.locator('.dsx-pin').count()) === 1, 'alternate pane pins its draft')
check((await phoneLeft.locator('.dsx-pin').count()) === 0, 'shared id in the other pane is not pinned')
const snapshot = await phone.evaluate(async () => {
  const response = await fetch('/design/variants-review/_/comments')
  return await response.json()
})
check(snapshot.drafts.length === 1, 'draft remains in the session review queue')
check(
  snapshot.drafts[0]?.context?.variant === 'layout:spacious',
  'draft context records the effective branch',
  snapshot.drafts[0]?.context?.variant,
)
await phone.evaluate(async () => {
  const base = '/design/variants-review/_/comments'
  const current = await (await fetch(base)).json()
  for (const draft of current.drafts) {
    await fetch(base + '/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-design-comments': '1' },
      body: JSON.stringify({ id: draft.id, revision: draft.revision }),
    })
  }
})

// 5. History restores the comparison controls and both panes.
await phone.getByLabel('Right branch').selectOption('compact')
await phone.waitForFunction(
  () => new URLSearchParams(window.location.search).get('compare') === 'layout:compact:compact',
)
await phone.evaluate(() => history.back())
await phone.waitForFunction(
  () => new URLSearchParams(window.location.search).get('compare') === 'layout:compact:spacious',
)
await phone.waitForTimeout(400)
await phoneRight.getByText('Spacious catalog').waitFor()
check(
  (await phone.locator('.dsx-compare-pane-label strong').nth(1).textContent()) === 'spacious',
  'Back restores the previous comparison selection',
)
await phone.close()

// 6. Deterministic preview stays one self-contained canvas with no comment UI.
const deterministic = await openPreview(context, '/design/variants-review/catalog?bp=mobile&deterministic=1', {
  width: 390,
  height: 844,
})
await deterministic.locator('.dsx-frame').waitFor()
check(
  (await deterministic.getByRole('button', { name: 'Comment', exact: true }).count()) === 0,
  'deterministic preview has no comment control',
)
check((await deterministic.locator('[data-dsx-review]').count()) === 0, 'deterministic preview renders no review layer')
check(
  deterministic.requests.filter((url) => url.includes('_/comments')).length === 0,
  'deterministic preview makes no comment request',
)
check(
  deterministic.requests.length === 1,
  'deterministic preview makes exactly one request',
  deterministic.requests.length,
)
await deterministic.close()

// 7. Malformed and unknown selections stay explicit.
const malformedVariant = await openPreview(context, '/design/variants-review/catalog?variant=broken', {
  width: 390,
  height: 844,
})
await malformedVariant.getByText('Unknown variant selection').waitFor()
check(
  (await malformedVariant.getByText(/not a group:branch selection/).count()) === 1,
  'malformed variant link is diagnosed',
)
check((await malformedVariant.locator('.dsx-frame').count()) === 0, 'malformed variant link renders no chosen canvas')
await malformedVariant.close()

const malformedCompare = await openPreview(context, '/design/variants-review/catalog?compare=broken', {
  width: 390,
  height: 844,
})
await malformedCompare.getByText('Malformed comparison selection').waitFor()
await malformedCompare.close()

const unknownState = await openPreview(
  context,
  '/design/variants-review/catalog?compare=layout:compact:spacious&state=ghost&bp=mobile',
  { width: 390, height: 844 },
)
await unknownState.getByText('Unknown comparison state').waitFor()
check(
  (await unknownState.getByText(/is not declared by screen/).count()) === 1,
  'unknown comparison state is diagnosed',
)
await unknownState.close()

// 8. Anonymous access is refused before content.
const anonymous = await browser.newContext()
const anonymousPage = await anonymous.newPage()
const anonymousResponse = await anonymousPage.goto(origin + '/design/variants-review/catalog')
check(
  anonymousResponse !== null && [401, 403].includes(anonymousResponse.status()),
  'anonymous preview is refused',
  anonymousResponse?.status(),
)
await anonymous.close()
await entryPage.close()
await browser.close()

const report = { ok: failures.length === 0, failures, evidence }
console.log(JSON.stringify(report, null, 2))
if (failures.length > 0) process.exitCode = 1
