/**
 * Repeatable browser review for the component-anchored comment composer.
 *
 * Usage:
 *   DSH_ENTRY_URL='<printed owner entry URL>' \
 *   DSH_DESIGN_CHROMIUM_PATH='<chromium executable>' \
 *     node docs/review/composer-check.mjs
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

async function browseCheckout(frame) {
  const browse = frame.getByRole('button', { name: 'Screens', exact: true })
  if (await browse.isVisible()) await browse.click()
  await frame.getByRole('navigation', { name: 'Screens' }).locator('a[href*="/checkout?"]').click()
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

function pendingCount(text) {
  const match = /\((\d+)\)/.exec(text)
  return match === null ? -1 : Number(match[1])
}

async function openPendingPanel(frame) {
  const panel = frame.locator('aside[aria-label="Pending review comments"]')
  if ((await panel.count()) === 0) await frame.getByRole('button', { name: /Pending/ }).click()
  await panel.waitFor({ state: 'visible' })
  return panel
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

function overlaps(balloon, target) {
  return (
    balloon.left < target.right &&
    balloon.right > target.left &&
    balloon.top < target.bottom &&
    balloon.bottom > target.top
  )
}

function pointerTouches(geometry) {
  const balloon = geometry.balloon
  const pointer = geometry.pointer
  const target = geometry.target
  if (balloon === null || pointer === null || target === null) return false
  const near = (left, right) => Math.abs(left - right) <= 1
  if (geometry.side === 'right') return near(pointer.right, balloon.left) && pointer.left >= target.right - 2
  if (geometry.side === 'left') return near(pointer.left, balloon.right) && pointer.right <= target.left + 2
  if (geometry.side === 'bottom') return near(pointer.bottom, balloon.top) && pointer.top >= target.bottom - 2
  if (geometry.side === 'top') return near(pointer.top, balloon.bottom) && pointer.bottom <= target.top + 2
  return false
}

function adjacent(balloon, target) {
  const horizontalGap = Math.max(balloon.left - target.right, target.left - balloon.right)
  const verticalGap = Math.max(balloon.top - target.bottom, target.top - balloon.bottom)
  const horizontalOverlap = Math.min(balloon.bottom, target.bottom) - Math.max(balloon.top, target.top) > 0
  const verticalOverlap = Math.min(balloon.right, target.right) - Math.max(balloon.left, target.left) > 0
  return (
    (horizontalGap >= 0 && horizontalGap <= 24 && horizontalOverlap) ||
    (verticalGap >= 0 && verticalGap <= 24 && verticalOverlap)
  )
}

async function balloonGeometry(framed, selector) {
  return framed.evaluate((root, targetSelector) => {
    const document_ = root.ownerDocument
    const box = (element) => {
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
    }
    const balloon = document_.querySelector('.dsx-review-composer')
    return {
      balloon: box(balloon),
      pointer: box(document_.querySelector('.dsx-review-pointer')),
      target: box(document_.querySelector(targetSelector)),
      stage: box(document_.querySelector('.dsx-stage')),
      frame: box(document_.querySelector('.dsx-frame')),
      side: balloon?.getAttribute('data-side') ?? null,
      anchor: balloon?.getAttribute('data-anchor') ?? null,
      detached: balloon?.getAttribute('data-detached') ?? null,
      pointers: document_.querySelectorAll('.dsx-review-pointer').length,
      focused: document_.activeElement?.getAttribute('aria-label') ?? null,
      dialogs: document_.querySelectorAll('[role="dialog"][aria-modal="true"]').length,
    }
  }, selector)
}

async function waitForComposerFocus(frame) {
  await frame.locator('.dsx-review-composer').evaluate(async () => {
    for (let index = 0; index < 100; index += 1) {
      if (document.activeElement?.getAttribute('aria-label') === 'Comment text') return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('composer did not receive focus')
  })
}

async function createDraft(frame, targetId, text, label) {
  const pendingBefore = pendingCount(await pendingText(frame))
  const frameBefore = await frame.locator('.dsx-frame').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  await frame.getByRole('button', { name: 'Comment', exact: true }).click()
  await frame.locator('[data-dsx-id="' + targetId + '"]').click()
  await frame.locator('.dsx-review-composer').waitFor({ state: 'visible' })
  await frame.locator('.dsx-review-composer[data-anchor="available"]').waitFor({ state: 'visible' })
  await waitForComposerFocus(frame)
  const geometry = await balloonGeometry(frame.locator('.dsx-frame'), '[data-dsx-id="' + targetId + '"]')
  const balloon = geometry.balloon
  const target = geometry.target
  const stage = geometry.stage
  check(geometry.anchor === 'available' && geometry.pointers === 1, label + ' opens an anchored balloon', geometry.side)
  check(
    balloon !== null &&
      target !== null &&
      stage !== null &&
      balloon.left >= stage.left - 1 &&
      balloon.top >= stage.top - 1 &&
      balloon.right <= stage.right + 1 &&
      balloon.bottom <= stage.bottom + 1,
    label + ' keeps the balloon inside the pane',
    balloon === null ? null : Math.round(balloon.width),
  )
  check(
    balloon !== null && target !== null && adjacent(balloon, target),
    label + ' places the balloon beside its target',
    geometry.side,
  )
  check(pointerTouches(geometry), label + ' draws a pointer touching the balloon beside its target', geometry.side)
  check(
    balloon !== null && balloon.width <= 360 && stage !== null && balloon.width < stage.width - 8,
    label + ' keeps a compact editor, not a footer',
    balloon === null ? null : Math.round(balloon.width),
  )
  const frameAfter = await frame.locator('.dsx-frame').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  check(
    frameAfter.width === frameBefore.width && frameAfter.height === frameBefore.height,
    label + ' leaves the canvas geometry unchanged',
    Math.round(frameAfter.width),
  )
  check(geometry.focused === 'Comment text', label + ' focuses the editor')
  await page.screenshot({ path: '/tmp/dsh-composer-' + label.replace(/[^a-z0-9]+/gi, '-') + '.png' })
  await frame.getByRole('textbox', { name: 'Comment text' }).fill(text)
  await frame.getByRole('button', { name: 'Save comment' }).click()
  await frame.locator('.dsx-pin').first().waitFor({ state: 'visible' })
  await page.waitForTimeout(500)
  const pendingAfter = pendingCount(await pendingText(frame))
  check(pendingAfter === pendingBefore + 1, label + ' adds exactly one pending draft', pendingAfter)
  return geometry
}

await page.goto(entry, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await dismissOnboarding(page)
await clearDrafts(page, 'review-a')
await page.screenshot({ path: '/tmp/dsh-composer-desktop-start.png' })

// 1. Desktop panel: an anchored balloon in the narrow sidebar.
await openSession(page, 'Review A')
let frame = await openPanel(page, 'review-a')
await clearDrafts(page, 'review-a')
await browseCheckout(frame)
await frame.locator('[data-dsx-id="email"]').waitFor()
await createDraft(frame, 'email', 'Make the email label clearer.', 'desktop panel')
check((await pendingText(frame)) === 'Pending (1)', 'desktop panel draft appears in Pending', await pendingText(frame))
await page.screenshot({ path: '/tmp/dsh-composer-desktop-panel.png' })

// 2. The pin reopens the balloon at the same component and Escape restores focus.
await frame.locator('.dsx-pin').first().click()
await frame.locator('.dsx-review-composer').waitFor({ state: 'visible' })
await frame.locator('.dsx-review-composer[data-anchor="available"]').waitFor({ state: 'visible' })
await waitForComposerFocus(frame)
check(
  (await frame.getByRole('textbox', { name: 'Comment text' }).inputValue()) === 'Make the email label clearer.',
  'desktop panel pin reopens the balloon with its text',
)
await frame.getByRole('textbox', { name: 'Comment text' }).press('Escape')
await frame.locator('.dsx-review-composer').waitFor({ state: 'detached' })
const pinFocused = await frame.locator('.dsx-frame').evaluate(() => {
  const active = document.activeElement
  return active !== null && active.classList.contains('dsx-pin')
})
check(pinFocused, 'desktop panel Escape closes the balloon and restores pin focus')
const openAside = frame.locator('aside[aria-label="Pending review comments"]')
if ((await openAside.count()) > 0) await openAside.getByRole('button', { name: 'Close pending review' }).click()

// 3. A second draft still batches and delivers as one message.
await createDraft(frame, 'place-order', 'Use a clearer primary action label.', 'second draft')
check((await pendingText(frame)) === 'Pending (2)', 'two panel drafts stay pending', await pendingText(frame))
const messagesBefore = await page.getByText(/Design review comments \(\d+ comments?\)/).count()
const pendingPanel = await openPendingPanel(frame)
await pendingPanel.getByRole('button', { name: /^Send \d+ comments?$/ }).click()
await frame.getByText(/Sent 2 comments as one message/).waitFor({ timeout: 10000 })
check(
  (await pendingText(frame)) === 'Pending (0)',
  'batch delivery clears the acknowledged drafts',
  await pendingText(frame),
)
const messagesAfter = await page.getByText(/Design review comments \(\d+ comments?\)/).count()
check(
  messagesAfter === messagesBefore + 1,
  'batch delivery records exactly one chat message',
  messagesAfter - messagesBefore,
)

// 4. Mobile canvas on the same desktop browser.
await frame.getByLabel('Breakpoint').selectOption('mobile')
await page.waitForTimeout(400)
check(
  (await frame.locator('.dsx-frame').getAttribute('data-breakpoint')) === 'mobile',
  'desktop panel switches to the mobile canvas',
)
await createDraft(frame, 'email', 'Check the email field on the mobile canvas.', 'mobile canvas')
const mobileFrameWidth = await frame.locator('.dsx-frame').evaluate((element) => element.getBoundingClientRect().width)
check(mobileFrameWidth === 390, 'mobile canvas keeps its exact width', mobileFrameWidth)
check(
  (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1,
  'mobile canvas keeps the page free of horizontal overflow',
)
await page.screenshot({ path: '/tmp/dsh-composer-mobile-canvas.png' })

// 5. An open drawer at the mobile canvas in a standalone tab.
const tab = await context.newPage()
await tab.goto(origin + '/design/review-a/checkout?state=review-open&bp=mobile', { waitUntil: 'domcontentloaded' })
await tab.locator('.dsx-frame').waitFor()
await tab.getByText('Order review').waitFor({ state: 'visible' })
const tabBefore = await tab.locator('.dsx-frame').evaluate((element) => {
  const rect = element.getBoundingClientRect()
  return { width: rect.width, height: rect.height }
})
await tab.getByRole('button', { name: 'Comment', exact: true }).click()
await tab.locator('[data-dsx-id="close-review"]').click()
await tab.locator('.dsx-review-composer').waitFor({ state: 'visible' })
await tab.locator('.dsx-review-composer[data-anchor="available"]').waitFor({ state: 'visible' })
const drawerGeometry = await balloonGeometry(tab.locator('.dsx-frame'), '[data-dsx-id="close-review"]')
const drawerBalloon = drawerGeometry.balloon
const drawerTarget = drawerGeometry.target
const drawerStage = drawerGeometry.stage
check(
  drawerGeometry.pointers === 1 && drawerGeometry.anchor === 'available',
  'drawer target at the mobile canvas opens an anchored balloon',
  drawerGeometry.side,
)
check(
  pointerTouches(drawerGeometry),
  'drawer balloon draws a pointer touching the balloon beside its target',
  drawerGeometry.side,
)
check(
  drawerBalloon !== null &&
    drawerTarget !== null &&
    drawerStage !== null &&
    adjacent(drawerBalloon, drawerTarget) &&
    drawerBalloon.left >= drawerStage.left - 1 &&
    drawerBalloon.right <= drawerStage.right + 1,
  'drawer balloon stays beside its target inside the mobile pane',
  drawerGeometry.side,
)
await tab.screenshot({ path: '/tmp/dsh-composer-drawer-open.png' })
const tabAfter = await tab.locator('.dsx-frame').evaluate((element) => {
  const rect = element.getBoundingClientRect()
  return { width: rect.width, height: rect.height }
})
check(
  tabAfter.width === tabBefore.width && tabAfter.height === tabBefore.height,
  'drawer balloon leaves the canvas geometry unchanged',
  Math.round(tabAfter.width),
)
await tab.keyboard.press('Escape')
await tab.locator('.dsx-review-composer').waitFor({ state: 'detached' })
check(
  (await tab.locator('[role="dialog"][aria-modal="true"]').count()) === 1,
  'Escape closes the balloon without closing the drawer',
)
await tab.screenshot({ path: '/tmp/dsh-composer-drawer-mobile.png' })
await tab.close()

// 6. Short native pane: an arrow may only appear when the balloon cannot cover
// the target; otherwise the editor stays pointerless with its text preserved.
await page.setViewportSize({ width: 1050, height: 420 })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await dismissOnboarding(page)
await openSession(page, 'Review A')
frame = await openPanel(page, 'review-a')
await frame.getByLabel('Breakpoint').selectOption('desktop')
await browseCheckout(frame)
await frame.locator('[data-dsx-id="email"]').waitFor()
await frame.getByRole('button', { name: 'Comment', exact: true }).click()
await frame.locator('[data-dsx-id="email"]').click()
await frame.locator('.dsx-review-composer').waitFor({ state: 'visible' })
const shortGeometry = await balloonGeometry(frame.locator('.dsx-frame'), '[data-dsx-id="email"]')
const shortPane = await frame.locator('.dsx-stage').evaluate((element) => {
  const rect = element.getBoundingClientRect()
  return { width: Math.round(rect.width), height: Math.round(rect.height) }
})
check(shortPane.width > 200 && shortPane.width < 500, 'short native pane is narrow', shortPane)
if (shortGeometry.pointers > 0) {
  check(
    shortGeometry.balloon !== null &&
      shortGeometry.target !== null &&
      !overlaps(shortGeometry.balloon, shortGeometry.target),
    'short native pane draws an arrow only without covering the email target',
    shortGeometry.side,
  )
} else {
  check(
    shortGeometry.detached === 'space' && shortGeometry.anchor === 'unavailable',
    'short native pane uses a pointerless editor when no side fits',
    shortGeometry.detached,
  )
}
check(
  shortGeometry.balloon === null || shortGeometry.balloon.width <= 360,
  'short native pane keeps the editor compact',
  shortGeometry.balloon === null ? null : Math.round(shortGeometry.balloon.width),
)
await frame.getByRole('textbox', { name: 'Comment text' }).fill('Short pane note')
await page.setViewportSize({ width: 1050, height: 330 })
await page.waitForTimeout(900)
const shortAfter = await balloonGeometry(frame.locator('.dsx-frame'), '[data-dsx-id="email"]')
check(
  shortAfter.pointers === 0
    ? shortAfter.detached === 'space' || shortAfter.detached === 'missing'
    : shortAfter.balloon !== null && shortAfter.target !== null && !overlaps(shortAfter.balloon, shortAfter.target),
  'short native pane never points a detached editor at its target',
  shortAfter.pointers === 0 ? shortAfter.detached : shortAfter.side,
)
check(
  (await frame.getByRole('textbox', { name: 'Comment text' }).inputValue()) === 'Short pane note',
  'short native pane keeps the text while the pointer is dropped',
)
await page.screenshot({ path: '/tmp/dsh-composer-short-pane.png' })
await frame.getByRole('textbox', { name: 'Comment text' }).press('Escape')
await frame.locator('.dsx-review-composer').waitFor({ state: 'detached' })
await page.setViewportSize({ width: 1440, height: 900 })
await page.waitForTimeout(700)

// 7. Deterministic rendering carries no review controls and no comment request.
const deterministic = await context.newPage()
const commentRequests = []
deterministic.on('request', (request) => {
  if (request.url().includes('_/comments')) commentRequests.push(request.url())
})
await deterministic.goto(origin + '/design/review-a/catalog?deterministic=1', { waitUntil: 'domcontentloaded' })
await deterministic.locator('.dsx-frame').waitFor()
check((await deterministic.locator('[data-dsx-review]').count()) === 0, 'deterministic preview renders no review layer')
check(
  (await deterministic.getByRole('button', { name: 'Comment', exact: true }).count()) === 0,
  'deterministic preview has no Comment control',
)
check(commentRequests.length === 0, 'deterministic preview makes no comment request', commentRequests.length)
await deterministic.close()

await context.close()
await browser.close()
console.log(JSON.stringify({ ok: failures.length === 0, failures, evidence }, null, 2))
if (failures.length > 0) process.exitCode = 1
