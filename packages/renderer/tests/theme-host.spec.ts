/** Exercise preview, review and watcher through the built renderer and real host routes. */
import { createServer } from 'node:http'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium, type Locator } from 'playwright-core'
import { expect, it } from 'vitest'
import { CommentStore } from '../../host/src/comments.ts'
import { ProjectRegistry } from '../../host/src/registry.ts'
import { createRouteHandler } from '../../host/src/routes.ts'
import { KIT_VERSION, kitMetadata } from '../../kit/src/meta.ts'

const assets = fileURLToPath(new URL('../dist/', import.meta.url))
const example = fileURLToPath(new URL('../../../examples/release-console/design/', import.meta.url))
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? process.env.DSH_DESIGN_CHROMIUM_PATH
const evidenceDir = process.env.DSH_DESIGN_SCREENSHOT_DIR

function fieldAppearance(field: Locator) {
  return field.evaluate((el) => {
    const style = getComputedStyle(el)
    const placeholder = getComputedStyle(el, '::placeholder')
    return {
      fill: style.backgroundColor,
      edge: style.borderTopColor,
      edgeWidth: parseFloat(style.borderTopWidth),
      surrounding: getComputedStyle(el.closest('[data-dsx-id="release-card"]')!).backgroundColor,
      placeholder: placeholder.color,
      placeholderOpacity: placeholder.opacity,
    }
  })
}

function luminance(color: string): number {
  // The example uses opaque sRGB tokens. Reject unsupported formats rather than silently ignoring alpha.
  const channels = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color)
  if (channels === null) throw new Error('Expected an opaque sRGB color, got ' + color)
  const [r, g, b] = channels.slice(1).map((byte) => {
    const channel = Number(byte) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

it.skipIf(chromiumPath === undefined)(
  'uses one canvas for themes, shared CSS, and captured review coordinates',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsx-themed-preview-'))
    const design = join(root, 'design')
    await cp(example, design, { recursive: true })
    const source = join(design, 'screens', 'overview.dsx')
    const initial = await readFile(source, 'utf8')
    const sent: string[] = []
    const comments = new CommentStore({
      prompt: () => ({
        prompt: async (input) => {
          sent.push(input.content[0]!.text)
          return { accepted: true }
        },
      }),
    })
    let base = ''
    const registry = new ProjectRegistry({
      folderName: 'design',
      kitVersion: KIT_VERSION,
      installedKitVersion: KIT_VERSION,
      kit: kitMetadata,
      resolveSessionCwd: () => root,
      origin: () => base,
      debounceMs: 15,
    })
    const route = createRouteHandler(registry, assets, comments)
    const server = createServer((req, res) => {
      void route(req, res, { principal: { kind: 'owner' } })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = 'http://127.0.0.1:' + String((server.address() as { port: number }).port)
    const browser = await chromium.launch({ executablePath: chromiumPath, chromiumSandbox: true })
    try {
      const viewport = { width: 1550, height: 880 }
      const page = await browser.newPage({ viewport })
      page.setDefaultTimeout(5000)
      const unexpected: string[] = []
      page.on('request', (request) => {
        if (!request.url().startsWith(base) || request.url().includes('/styles/')) unexpected.push(request.url())
      })
      const overview = base + '/design/theme-test/overview'
      await page.goto(overview + '?bp=desktop&theme=light')
      const frame = page.locator('.dsx-frame')
      const inner = frame.locator('.dsx-frame-inner')
      const select = page.getByLabel('Theme', { exact: true })
      const screen = frame.locator('[data-dsx-type="Screen"]')
      const node = (id: string) => frame.locator('[data-dsx-id="' + id + '"]')
      const bg = () => screen.evaluate((el) => getComputedStyle(el).backgroundColor)
      await frame.waitFor()
      const light = await bg()
      const lightField = await fieldAppearance(page.getByRole('textbox', { name: 'Repository' }))
      expect(lightField).toMatchObject({ placeholder: 'rgb(117, 117, 117)', edge: 'rgb(199, 210, 227)' })
      const chrome = await page.locator('.dsx-chrome').evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(await node('release-card').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
        'rgba(0, 0, 0, 0)',
      )
      if (evidenceDir !== undefined) {
        await mkdir(evidenceDir, { recursive: true })
        await frame.screenshot({ path: join(evidenceDir, 'desktop-light.png') })
      }
      await page.getByRole('textbox', { name: 'Repository' }).fill('not-a-review-coordinate')
      await page.getByRole('button', { name: 'Review', exact: true }).click()
      await select.selectOption('dark')
      expect(await frame.getAttribute('data-theme')).toBe('dark')
      expect(await inner.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark')
      expect(await bg()).not.toBe(light)
      expect(await page.locator('.dsx-chrome').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(chrome)
      expect(await node('review-drawer').isVisible()).toBe(true)
      const share = await browser.newPage({ viewport })
      await share.goto(page.url())
      await share.locator('.dsx-frame[data-theme="dark"]').waitFor()
      const repository = share.getByRole('textbox', { name: 'Repository' })
      expect(await repository.inputValue()).toBe('')
      const fieldColors = await fieldAppearance(repository)
      expect(fieldColors.placeholderOpacity).toBe('1')
      expect(fieldColors.edgeWidth).toBeGreaterThan(0)
      expect
        .soft(contrast(fieldColors.placeholder, fieldColors.fill), 'placeholder vs. field fill')
        .toBeGreaterThanOrEqual(4.5)
      expect.soft(contrast(fieldColors.edge, fieldColors.fill), 'boundary vs. field fill').toBeGreaterThanOrEqual(3)
      expect
        .soft(contrast(fieldColors.edge, fieldColors.surrounding), 'boundary vs. surrounding card')
        .toBeGreaterThanOrEqual(3)
      const visualSwitch = share.getByRole('switch', { name: 'Notify demo team' })
      expect(await visualSwitch.isChecked()).toBe(false)
      const track = await fieldAppearance(visualSwitch)
      expect(track.edgeWidth).toBeGreaterThan(0)
      expect.soft(contrast(track.edge, track.surrounding), 'off-switch track boundary').toBeGreaterThanOrEqual(3)
      expect(await share.locator('[data-dsx-id="review-drawer"]').count()).toBe(0)
      await share.goto(overview + '?bp=desktop&theme=base')
      await share.locator('.dsx-frame[data-theme="base"]').waitFor()
      expect(await fieldAppearance(repository)).toEqual(lightField)
      await share.close()
      await page.goBack()
      await page.locator('.dsx-frame[data-theme="light"]').waitFor()
      expect(await node('review-drawer').isVisible()).toBe(true)
      await page.goForward()
      await page.locator('.dsx-frame[data-theme="dark"]').waitFor()

      await page.getByRole('link', { name: 'Draft review open', exact: true }).click()
      expect(new URL(page.url()).searchParams.get('theme')).toBe('dark')
      await page.getByRole('button', { name: 'Close review' }).click()
      await page.getByRole('textbox', { name: 'Repository' }).fill('not-a-review-coordinate')
      await page.getByRole('button', { name: 'Hide release notes' }).click()
      await page.getByRole('tab', { name: 'Build log' }).click()
      await page.getByRole('button', { name: 'Comment', exact: true }).click()
      await node('release-heading').click()
      await page.getByRole('textbox', { name: 'Comment text' }).fill('Clarify the title.')
      await page.getByRole('button', { name: 'Save comment' }).click()
      await page.getByRole('button', { name: 'Pending (1)' }).click()
      expect(sent).toEqual([])
      await page.getByRole('button', { name: 'Send 1 comment' }).click()
      await expect.poll(() => sent.length).toBe(1)
      expect(sent[0]).not.toContain('not-a-review-coordinate')
      expect(sent[0]).toContain('named state=review-open')
      const coordinates = sent[0]?.split('Review context: ')[1]
      expect(JSON.parse(coordinates ?? 'null')).toEqual({
        screen: 'overview',
        theme: 'dark',
        selection: '',
        open: [],
        tabs: { 'release-tabs': 'tab-logs' },
        disclosures: { 'release-details': false },
      })
      expect(await node('review-drawer').count()).toBe(0)
      expect(await node('release-details').getAttribute('aria-expanded')).toBe('false')
      expect(await readFile(source, 'utf8')).toBe(initial)

      // A selected theme survives real authored navigation and deterministic direct visits.
      await page.getByRole('button', { name: 'View history', exact: true }).click()
      await page.locator('.dsx-frame[data-screen="history"][data-theme="dark"]').waitFor()
      await page.goto(overview + '?theme=unavailable')
      await page.getByText('Unknown theme', { exact: true }).waitFor()
      expect(await frame.count()).toBe(0)
      await page.goto(overview + '?bp=mobile&theme=dark&deterministic=1')
      await page.locator('.dsx-frame[data-theme="dark"]').waitFor()
      expect(await node('release-card').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
        'rgba(0, 0, 0, 0)',
      )
      expect(await select.count()).toBe(0)
      expect(unexpected).toEqual([])

      await page.setViewportSize({ width: 430, height: 850 })
      await page.goto(overview + '?bp=mobile&theme=dark', { waitUntil: 'domcontentloaded' })
      await frame.waitFor()
      if (evidenceDir !== undefined) {
        // A fresh viewer never inherits the synthetic text used in the review assertion.
        const evidence = await browser.newPage({ viewport: { width: 430, height: 850 } })
        try {
          const capture = (name: string) =>
            evidence.locator('.dsx-frame').screenshot({
              path: join(evidenceDir, name),
              style: '.dsx-chrome { visibility: hidden; }',
            })
          await evidence.goto(overview + '?bp=mobile&theme=dark')
          await capture('mobile-dark.png')
          await evidence.goto(overview + '?bp=mobile&theme=dark&state=menu-open')
          const menu = evidence.getByRole('dialog', { name: 'Release options' })
          await menu.waitFor()
          const close = menu.getByRole('button', { name: 'Close options', exact: true })
          await close.focus()
          await capture('mobile-dark-anchored.png')
          await close.press('Enter')
          await menu.waitFor({ state: 'hidden' })
          const opener = evidence.getByRole('button', { name: 'Release options', exact: true })
          expect(await opener.evaluate((element) => element === document.activeElement)).toBe(true)
          expect(await evidence.getByText('Approval pending').isVisible()).toBe(true)
          await capture('mobile-dark-dismissed-focus.png')
        } finally {
          await evidence.close()
        }
      }
      // Keep the same open panel and its focused child through a valid anchor edit.
      const opener = node('release-options')
      const nextAnchor = node('nav-history')
      const panel = node('release-menu')
      const focusedChild = node('close-release-menu')
      const isFocused = (el: Element) => document.activeElement === el
      const anchorGap = async (anchor: Locator) => {
        const anchorBox = (await anchor.boundingBox())!
        const panelBox = (await panel.boundingBox())!
        return Math.min(
          Math.abs(panelBox.y - (anchorBox.y + anchorBox.height)),
          Math.abs(anchorBox.y - (panelBox.y + panelBox.height)),
        )
      }
      await opener.press('Enter')
      await focusedChild.focus()
      await expect.poll(() => anchorGap(opener)).toBeCloseTo(6, 0)
      await writeFile(source, initial.replace('anchor="release-options"', 'anchor="nav-history"'))
      await expect.poll(() => anchorGap(nextAnchor)).toBeCloseTo(6, 0)
      expect(await focusedChild.evaluate(isFocused)).toBe(true)
      if (evidenceDir !== undefined) {
        await frame.screenshot({
          path: join(evidenceDir, 'mobile-dark-reanchored.png'),
          style: '.dsx-chrome { visibility: hidden; }',
        })
      }
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'hidden' })
      expect(await nextAnchor.evaluate(isFocused)).toBe(true)
      await writeFile(source, initial)

      const palettePath = join(design, 'themes', 'dark.json')
      const validPalette = await readFile(palettePath, 'utf8')
      const dark = await bg()
      await writeFile(palettePath, '{')
      await page.getByText('Showing its last valid palette.', { exact: false }).waitFor()
      expect(await bg()).toBe(dark)
      await writeFile(palettePath, validPalette.replace('#101827', '#113355'))
      await expect.poll(bg).toBe('rgb(17, 51, 85)')
      expect(await page.getByText('Invalid theme', { exact: true }).count()).toBe(0)
      const baseTokensPath = join(design, 'tokens.json')
      const baseTokens = JSON.parse(await readFile(baseTokensPath, 'utf8'))
      const darkTokens = JSON.parse(await readFile(palettePath, 'utf8'))
      for (const [name, value] of Object.entries({ warningBg: '#fae8aa', focus: '#bb2323', control: '#112222' })) {
        baseTokens.color[name] = { $type: 'color', $value: '#ffffff' }
        darkTokens.tokens.color[name] = { $type: 'color', $value: value }
      }
      await writeFile(baseTokensPath, JSON.stringify(baseTokens))
      await writeFile(palettePath, JSON.stringify(darkTokens))
      const colorOf = (el: Element) => getComputedStyle(el).backgroundColor
      await expect.poll(() => node('approval-note').evaluate(colorOf)).toBe('rgb(250, 232, 170)')
      await page.getByRole('tab', { name: 'Summary' }).click()
      const field = page.getByRole('textbox', { name: 'Repository' })
      expect(await field.evaluate(colorOf)).toBe('rgb(17, 34, 34)')
      await field.focus()
      expect(await field.evaluate((el) => getComputedStyle(el).outlineColor)).toBe('rgb(187, 35, 35)')

      const css = join(design, 'styles', 'release.css')
      const stylesheet = await readFile(css, 'utf8')
      const cardColor = () => node('release-card').evaluate((el) => getComputedStyle(el).backgroundColor)
      const beforeCss = await cardColor()
      await writeFile(css, '.release-card { background-image: url(https://invalid.example/must-not-load.png); }')
      await page.getByText('Showing the last valid render.', { exact: true }).waitFor()
      expect(await cardColor()).toBe(beforeCss)
      await writeFile(
        css,
        stylesheet.replace(/background-color: var\(--dsx-color-panel\);/g, 'background-color: #415161;'),
      )
      await expect.poll(cardColor).toBe('rgb(65, 81, 97)')
      expect(unexpected).toEqual([])
      const layout = join(design, 'layouts', 'console-shell.dsx')
      const layoutSource = await readFile(layout, 'utf8')
      const consumer = await browser.newPage({ viewport })
      await consumer.goto(base + '/design/theme-test/history?theme=dark')
      await consumer.locator('.dsx-frame').waitFor()
      await writeFile(layout, layoutSource.replace('Release console', 'Updated shared header'))
      await frame.getByText('Updated shared header', { exact: true }).waitFor()
      await consumer.locator('.dsx-frame').getByText('Updated shared header', { exact: true }).waitFor()
      await consumer.close()

      // Both branches reuse the composed layout; explicitly opted roots and node css differ per branch.
      const compareSource = initial
        .replace(
          '<Stack id="release-card" gap="spacing.md" styleClass="release-card">',
          '<Stack id="release-card" gap="spacing.md" styleClass="release-card" css="background-color: #991155">',
        )
        .replace(
          '</Screen>',
          `  <Variants id="density" chosen="compact">
        <Variant branch="compact"><Stack id="compare-example" styleClass="release-card"><Text>Compact sample</Text></Stack></Variant>
        <Variant branch="spacious"><Stack id="compare-example"><Text>Spacious sample</Text></Stack></Variant>
      </Variants></Screen>`,
        )
      await writeFile(source, compareSource)
      await page.waitForFunction(() => Boolean(document.querySelector('select option[value="density:spacious"]')))
      await page.setViewportSize(viewport)
      await page.goto(overview + '?bp=mobile&theme=light&compare=density:compact:spacious')
      const left = page.frameLocator('iframe[data-dsx-pane="left"]')
      const right = page.frameLocator('iframe[data-dsx-pane="right"]')
      await left.locator('.dsx-frame[data-theme="light"]').waitFor()
      await right.locator('.dsx-frame[data-theme="light"]').waitFor()
      const color = (el: Element) => getComputedStyle(el).backgroundColor
      expect(await left.locator('[data-dsx-id="compare-example"]').evaluate(color)).toBe('rgb(65, 81, 97)')
      expect(await right.locator('[data-dsx-id="compare-example"]').evaluate(color)).toBe('rgba(0, 0, 0, 0)')
      expect(await left.locator('[data-dsx-id="release-card"]').evaluate(color)).toBe('rgb(153, 17, 85)')
      await left.getByRole('textbox', { name: 'Repository' }).fill('left-only')
      await select.selectOption('dark')
      await left.locator('.dsx-frame[data-theme="dark"]').waitFor()
      await right.locator('.dsx-frame[data-theme="dark"]').waitFor()
      expect(await left.getByRole('textbox', { name: 'Repository' }).inputValue()).toBe('left-only')
      expect(await right.getByRole('textbox', { name: 'Repository' }).inputValue()).toBe('')
      await page.goBack()
      await left.locator('.dsx-frame[data-theme="light"]').waitFor()
      expect(await left.getByRole('textbox', { name: 'Repository' }).inputValue()).toBe('left-only')
      await left.getByRole('button', { name: 'History', exact: true }).click()
      await left.locator('.dsx-frame[data-screen="history"][data-theme="light"]').waitFor()
      await select.selectOption('dark')
      await left.locator('.dsx-frame[data-screen="history"][data-theme="dark"]').waitFor()
      await right.locator('.dsx-frame[data-screen="overview"][data-theme="dark"]').waitFor()
    } finally {
      await browser.close()
      comments.dispose()
      registry.dispose()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
)
