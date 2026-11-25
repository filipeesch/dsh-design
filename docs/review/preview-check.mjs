/**
 * Browser review for a disposable DSH preview.
 *
 * Usage:
 *   DSH_ENTRY_URL='<printed owner entry URL>' REVIEW_SESSION=review-session \
 *     node docs/review/preview-check.mjs
 *
 * It authenticates with the printed owner link, then checks the real preview at
 * the mobile and desktop breakpoints, the named state deep link, fixture rows,
 * and that deterministic mode makes exactly one request.
 */
import { chromium } from 'playwright-core'

const entry = process.env.DSH_ENTRY_URL
const session = process.env.REVIEW_SESSION ?? 'review-session'
if (entry === undefined) throw new Error('DSH_ENTRY_URL is required')
const origin = new URL(entry).origin
const browser = await chromium.launch({
  headless: true,
  ...(process.env.DSH_DESIGN_CHROMIUM_PATH === undefined
    ? {}
    : { executablePath: process.env.DSH_DESIGN_CHROMIUM_PATH }),
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}

await page.goto(entry, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)

const readFrame = async (path) => {
  const requests = []
  const listener = (request) => requests.push(request.url())
  page.on('request', listener)
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.dsx-frame')
  await page.waitForTimeout(300)
  const frame = page.locator('.dsx-frame')
  const result = {
    url: path,
    breakpoint: await frame.getAttribute('data-breakpoint'),
    width: await frame.evaluate((element) => element.getBoundingClientRect().width),
    screen: await frame.getAttribute('data-screen'),
    requests: requests.slice(),
  }
  page.off('request', listener)
  return result
}

const mobile = await readFrame('/design/' + session + '/catalog?bp=mobile')
check(mobile.breakpoint === 'mobile' && mobile.width === 390, 'mobile canvas is 390 px')
check((await page.locator('[data-dsx-id="products-list-aurora-lamp"]').count()) === 1, 'fixture list row renders')
check((await page.getByRole('listitem').count()) === 3, 'one semantic listitem per fixture key')

const desktop = await readFrame('/design/' + session + '/catalog?bp=desktop&deterministic=1')
check(desktop.breakpoint === 'desktop' && desktop.width === 1280, 'desktop canvas is 1280 px')
check(desktop.requests.length === 1, 'deterministic mode makes exactly one request')
check((await page.getByText('Aurora Desk Lamp').count()) >= 1, 'fixture table renders')

const stated = await readFrame('/design/' + session + '/checkout?bp=mobile&state=review-open')
check(stated.screen === 'checkout', 'state deep link opens checkout')
check((await page.getByRole('dialog').count()) === 1, 'named state opens the review drawer')
check((await page.locator('[data-dsx-id="email"] input').inputValue()) === 'ada@example.com', 'named state seeds email')
check((await page.locator('[data-dsx-id="plan"] select').inputValue()) === 'pro', 'named state seeds plan')

await browser.close()
console.log(JSON.stringify({ mobile, desktop, stated, failures }, null, 2))
if (failures.length > 0) process.exitCode = 1
