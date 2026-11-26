/**
 * Repeatable browser review for the Design panel and review comments.
 *
 * Usage:
 *   DSH_ENTRY_URL='<printed owner entry URL>' \
 *   DSH_DESIGN_CHROMIUM_PATH='<chromium executable>' \
 *     node docs/review/panel-check.mjs
 *
 * The disposable profile must have run docs/review/panel-review-session.mjs
 * with REVIEW_CWD pointing at a copy of examples/synthetic-checkout/design.
 * The report names no owner token, session credential, or machine path.
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
const page = await context.newPage()
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
      await target.waitForTimeout(600)
      handled = true
      break
    }
    if (handled) continue
    for (const label of resume) {
      if (!(await target.getByRole('button', { name: label, exact: true }).count())) continue
      await target.getByRole('button', { name: label, exact: true }).click()
      await target.waitForTimeout(600)
      handled = true
      break
    }
    if (!handled) break
  }
  await target.waitForTimeout(500)
}

async function openSession(target, title) {
  await target.locator('[data-slot="sidebar"]').getByText(title, { exact: true }).click()
  await target.waitForTimeout(1200)
}

function panelFrame(target, sessionId) {
  return target.frameLocator('iframe[title="Design preview for ' + sessionId + '"]')
}

async function openPanel(target, sessionId) {
  if (
    !(await target
      .locator('iframe[title="Design preview for ' + sessionId + '"]')
      .isVisible()
      .catch(() => false))
  ) {
    await target.getByRole('button', { name: 'Design', exact: true }).click()
    await target.waitForTimeout(1200)
  }
  await target.locator('iframe[title="Design preview for ' + sessionId + '"]').waitFor({ state: 'visible' })
  const frame = panelFrame(target, sessionId)
  await frame.locator('.dsx-frame').waitFor()
  return frame
}

async function pendingText(frame) {
  return await frame.getByRole('button', { name: /Pending/ }).innerText()
}

async function clearDrafts(target, sessionId) {
  await target.evaluate(async (session) => {
    const base = '/design/' + encodeURIComponent(session) + '/_/comments'
    const snapshot = await (await fetch(base)).json()
    for (const draft of snapshot.drafts) {
      await fetch(base + '/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-design-comments': '1' },
        body: JSON.stringify({ id: draft.id, revision: draft.revision }),
      })
    }
  }, sessionId)
}

async function createDraft(frame, targetId, text) {
  await frame.getByRole('button', { name: 'Comment', exact: true }).click()
  await frame.locator('[data-dsx-id="' + targetId + '"]').click()
  await frame.getByRole('textbox', { name: 'Comment text' }).fill(text)
  await frame.getByRole('button', { name: 'Save comment' }).click()
  await new Promise((resolve) => setTimeout(resolve, 500))
}

await page.goto(entry, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await dismissOnboarding(page)
await clearDrafts(page, 'review-a')
await clearDrafts(page, 'review-b')
await page.screenshot({ path: '/tmp/dsh-panel-desktop-start.png' })

// 1. Panel opens beside the conversation for the selected session.
await openSession(page, 'Review A')
let desktopFrame = await openPanel(page, 'review-a')
check(
  (await page.locator('iframe[title="Design preview for review-a"]').count()) === 1,
  'desktop panel frames review-a',
)
check(
  (await desktopFrame.locator('.dsx-frame').getAttribute('data-screen')) === 'catalog',
  'desktop panel shows catalog',
)
const desktopBox = await page.locator('iframe[title="Design preview for review-a"]').boundingBox()
check(
  desktopBox !== null && desktopBox.width > 320,
  'desktop panel width leaves room for preview',
  Math.round(desktopBox?.width ?? 0),
)
const desktopOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
)
check(desktopOverflow <= 1, 'desktop page has no horizontal overflow', desktopOverflow)
check(
  (await desktopFrame.getByRole('button', { name: 'Comment', exact: true }).count()) === 1,
  'desktop chrome exposes Comment',
)
check((await desktopFrame.locator('.dsx-review').count()) === 0, 'desktop review overlay is absent until invoked')

// 2. A panel draft is visible to the separate-tab client for the same session.
await createDraft(desktopFrame, 'products-list-aurora-lamp', 'Make the lamp title heavier in the catalog.')
check((await pendingText(desktopFrame)) === 'Pending (1)', 'panel draft appears in the panel')
check((await desktopFrame.locator('.dsx-pin').count()) === 1, 'panel draft renders one pin')

// A browser reload is not DSH session disposal: the host keeps the same
// session, so its pending draft must reconnect to the re-opened panel.
await page.reload({ waitUntil: 'domcontentloaded' })
await dismissOnboarding(page)
await openSession(page, 'Review A')
desktopFrame = await openPanel(page, 'review-a')
check((await pendingText(desktopFrame)) === 'Pending (1)', 'draft survives a browser reload')
check((await desktopFrame.locator('.dsx-pin').count()) === 1, 'reloaded panel reattaches the pin')
const tab = await context.newPage()
await tab.goto(origin + '/design/review-a/catalog', { waitUntil: 'domcontentloaded' })
await tab.locator('.dsx-frame').waitFor()
check((await pendingText(tab)) === 'Pending (1)', 'separate tab reads the same session draft')
await createDraft(tab, 'products-list-nimbus-notebook', 'Use a stronger hover state on the notebook row.')
check((await pendingText(tab)) === 'Pending (2)', 'separate tab adds a second draft')
await page.bringToFront()
await page.locator('iframe[title="Design preview for review-a"]').evaluate((element) => {
  const frame = element.contentWindow
  if (frame === null) return
  frame.dispatchEvent(new Event('focus'))
  frame.document.dispatchEvent(new Event('visibilitychange'))
})
await page.waitForTimeout(800)
check((await pendingText(desktopFrame)) === 'Pending (2)', 'panel refreshes to the shared draft set')

// 3. The second session has its own pending set over the same project.
await openSession(page, 'Review B')
const secondFrame = await openPanel(page, 'review-b')
check(
  (await secondFrame.locator('.dsx-frame').getAttribute('data-screen')) === 'catalog',
  'second session frames its own preview',
)
check((await pendingText(secondFrame)) === 'Pending (0)', 'second session does not share drafts')
await page.screenshot({ path: '/tmp/dsh-panel-desktop-second-session.png' })

// 4. Rejected delivery keeps the drafts and an accepted retry sends exactly one message.
await openSession(page, 'Review A')
const reviewFrame = await openPanel(page, 'review-a')
await page.waitForTimeout(1000)
await reviewFrame.getByRole('button', { name: /Pending/ }).click()
const reviewPanel = reviewFrame.locator('aside[aria-label="Pending review comments"]')
const sendButton = reviewPanel.getByRole('button', { name: /^Send \d+ comments?$/ })
await sendButton.click()
const rejected = reviewFrame.getByRole('alert').filter({ hasText: /reject/i })
await rejected.waitFor({ timeout: 10000 })
check((await pendingText(reviewFrame)) === 'Pending (2)', 'rejected delivery keeps both drafts')
await sendButton.click()
await reviewFrame.getByText(/Sent 2 comments as one message/).waitFor({ timeout: 10000 })
check((await pendingText(reviewFrame)) === 'Pending (0)', 'accepted retry clears the acknowledged drafts')
check((await reviewFrame.locator('.dsx-pin').count()) === 0, 'accepted retry removes the pins')
const chatMessages = await page.getByText(/Design review comments \(2 comments\)/).count()
check(chatMessages === 1, 'retry records exactly one chat message', chatMessages)
await page.screenshot({ path: '/tmp/dsh-panel-desktop-accepted.png' })

// 5. Phone layout keeps the preview and controls usable and returns to chat.
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(1500)
const phoneFrame = await openPanel(page, 'review-a')
const phoneBox = await page.locator('iframe[title="Design preview for review-a"]').boundingBox()
check(phoneBox !== null && phoneBox.width <= 390, 'phone panel fits the viewport', Math.round(phoneBox?.width ?? 0))
await phoneFrame.getByLabel('Breakpoint').selectOption('mobile')
await page.waitForTimeout(500)
check(
  (await phoneFrame.locator('.dsx-frame').getAttribute('data-breakpoint')) === 'mobile',
  'phone preview switches to the mobile breakpoint',
)
const phoneOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
)
check(phoneOverflow <= 1, 'phone page has no horizontal overflow', phoneOverflow)
await createDraft(phoneFrame, 'products-list-harbor-tray', 'Check the tray row at the phone breakpoint.')
check((await pendingText(phoneFrame)) === 'Pending (1)', 'phone comment controls add a draft')
await phoneFrame.getByRole('button', { name: /Pending \(1\)/ }).click()
const phonePanel = phoneFrame.locator('aside[aria-label="Pending review comments"]')
await phonePanel.getByRole('button', { name: 'Remove' }).click()
await new Promise((resolve) => setTimeout(resolve, 500))
check((await pendingText(phoneFrame)) === 'Pending (0)', 'phone review can remove a draft')
await page.screenshot({ path: '/tmp/dsh-panel-phone.png' })
await page.getByRole('button', { name: 'Back to conversation' }).click()
await page.waitForTimeout(800)
check(
  !(await page
    .locator('iframe[title="Design preview for review-a"]')
    .isVisible()
    .catch(() => false)),
  'back to chat closes the panel',
)
check(await page.getByText('Review setup message (ignore).').first().isVisible(), 'conversation is visible again')

// 6. Deterministic preview carries no comment UI and makes no comment request.
const deterministic = await context.newPage()
const commentRequests = []
deterministic.on('request', (request) => {
  if (request.url().includes('_/comments')) commentRequests.push(request.url())
})
await deterministic.goto(origin + '/design/review-a/catalog?deterministic=1', { waitUntil: 'domcontentloaded' })
await deterministic.locator('.dsx-frame').waitFor()
check(
  (await deterministic.getByRole('button', { name: 'Comment', exact: true }).count()) === 0,
  'deterministic preview has no Comment control',
)
check((await deterministic.locator('[data-dsx-review]').count()) === 0, 'deterministic preview renders no review layer')
await deterministic.waitForTimeout(500)
check(commentRequests.length === 0, 'deterministic preview makes no comment request', commentRequests.length)

// 7. Anonymous access is refused before content.
const anonymous = await browser.newContext()
const anonymousPage = await anonymous.newPage()
const anonymousResponse = await anonymousPage.goto(origin + '/design/review-a/catalog')
check(
  anonymousResponse !== null && [401, 403].includes(anonymousResponse.status()),
  'anonymous preview is refused',
  anonymousResponse?.status(),
)

await browser.close()
const report = { ok: failures.length === 0, failures, evidence }
console.log(JSON.stringify(report, null, 2))
if (failures.length > 0) process.exitCode = 1
