/**
 * Ordinary browser QA for the disposable standalone handoff review.
 *
 * Checks the real Design preview at desktop and Mobile widths, the named state,
 * and the generated handoff layouts/PNGs. It also confirms that the workspace
 * cache has no capture directory.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const entry = process.env.DSH_ENTRY_URL
const session = process.env.REVIEW_SESSION ?? 'handoff-review'
const cwd = process.env.REVIEW_CWD
if (entry === undefined) throw new Error('DSH_ENTRY_URL is required')
const origin = new URL(entry).origin
const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}
const executablePath = process.env.DSH_DESIGN_CHROMIUM_PATH
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  ...(executablePath === undefined ? {} : { executablePath }),
})

async function readPreview(viewport, path) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.goto(entry, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(300)
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.dsx-frame')
  await page.waitForTimeout(300)
  const frame = page.locator('.dsx-frame')
  const result = {
    path,
    breakpoint: await frame.getAttribute('data-breakpoint'),
    screen: await frame.getAttribute('data-screen'),
    width: await frame.evaluate((element) => Math.round(element.getBoundingClientRect().width)),
    documentWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    windowWidth: await page.evaluate(() => window.innerWidth),
  }
  if (result.screen === 'checkout') {
    result.drawer = await page.getByRole('dialog').count()
    result.email = await page.locator('[data-dsx-id="email"] input').inputValue()
  }
  await context.close()
  return result
}

const desktop = await readPreview(
  { width: 1440, height: 900 },
  '/design/' + session + '/checkout?bp=desktop&state=review-open',
)
check(desktop.breakpoint === 'desktop' && desktop.width === 1280, 'desktop canvas is 1280 px')
check(desktop.drawer === 1, 'desktop named state opens the review drawer')
check(desktop.email === 'ada@example.com', 'desktop named state seeds the email')
check(desktop.documentWidth <= desktop.windowWidth + 1, 'desktop page has no horizontal overflow')

const mobile = await readPreview(
  { width: 390, height: 844 },
  '/design/' + session + '/checkout?bp=mobile&state=review-open',
)
check(mobile.breakpoint === 'mobile' && mobile.width === 390, 'Mobile canvas is 390 px')
check(mobile.drawer === 1, 'Mobile named state opens the review drawer')
check(mobile.email === 'ada@example.com', 'Mobile named state seeds the email')
check(mobile.documentWidth <= mobile.windowWidth + 1, 'Mobile page has no horizontal overflow')

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return undefined
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

const manifests = []
let captureCacheAbsent = false
if (cwd !== undefined) {
  const cache = join(cwd, 'design', '.cache')
  try {
    const entries = await readdir(cache, { withFileTypes: true })
    captureCacheAbsent = !entries.some((entry) => entry.isDirectory() && entry.name === 'capture')
  } catch {
    captureCacheAbsent = true
  }
  try {
    const handoffRoot = join(cache, 'handoff')
    for (const entry of await readdir(handoffRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue
      manifests.push({
        directory: join(handoffRoot, entry.name),
        manifest: JSON.parse(await readFile(join(handoffRoot, entry.name, 'manifest.json'), 'utf8')),
      })
    }
  } catch {
    failures.push('handoff cache is unreadable')
  }
}
check(captureCacheAbsent, 'no capture cache directory exists')
check(manifests.length >= 2, 'both Mobile and Desktop handoff packages exist')

const artifacts = []
for (const { directory, manifest } of manifests) {
  for (const projection of manifest.projections) {
    if (projection.screen !== 'checkout') continue
    const layout = JSON.parse(await readFile(join(directory, projection.layout), 'utf8'))
    const png = await readFile(join(directory, projection.screenshot))
    const size = pngSize(png)
    artifacts.push({
      id: manifest.id,
      state: projection.stateName,
      breakpoint: projection.breakpoint.name,
      layoutWidth: layout.canvas.width,
      screenshotWidth: size?.width,
      nodes: layout.nodes.length,
    })
    check(size !== undefined, 'handoff screenshot is a PNG')
    check(size?.width === layout.canvas.width, 'handoff screenshot width matches its layout canvas')
    check(projection.breakpoint.name !== 'desktop' || layout.canvas.width === 1280, 'desktop handoff canvas is 1280 px')
    check(projection.breakpoint.name !== 'mobile' || layout.canvas.width === 390, 'Mobile handoff canvas is 390 px')
    check(directory.includes(join('design', '.cache', 'handoff')), 'handoff package stays in the ignored cache')
  }
}
check(
  artifacts.some((artifact) => artifact.breakpoint === 'desktop'),
  'a desktop handoff was generated',
)
check(
  artifacts.some((artifact) => artifact.breakpoint === 'mobile' && artifact.state === 'review-open'),
  'a Mobile named-state handoff was generated',
)

await browser.close()
console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      failures,
      evidence: {
        desktop: { canvas: desktop.width, documentWidth: desktop.documentWidth, drawer: desktop.drawer },
        mobile: { canvas: mobile.width, documentWidth: mobile.documentWidth, drawer: mobile.drawer },
        handoffArtifacts: artifacts,
        handoffPackages: manifests.length,
        captureCacheAbsent,
      },
    },
    null,
    2,
  ),
)
if (failures.length > 0) process.exitCode = 1
