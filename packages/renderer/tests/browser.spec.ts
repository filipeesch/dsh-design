// Real Chromium regression for the preview renderer.
import { createServer, type Server } from 'node:http'
import { access, readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { parseScreen } from '../../core/src/parse.ts'
import { deterministicDocument } from '../../host/src/deterministic.ts'
import type { ProjectPayload, WireScreen } from '../src/wire.ts'

const dist = new URL('../dist/', import.meta.url).pathname

function screen(id: string, source: string): WireScreen {
  const parsed = parseScreen(source, 'screens/' + id + '.dsx')
  return {
    id,
    file: 'screens/' + id + '.dsx',
    root: parsed.root,
    lastValidRoot: parsed.root,
    diagnostics: parsed.diagnostics,
    errors: 0,
    warnings: 0,
  }
}

const homeSource =
  '<Screen id="home" title="Home"><Header title="Home" /><Stack gap="spacing.md"><Text>Home screen</Text><Button id="go-checkout" onPress={navigate("checkout")}>Go checkout</Button></Stack></Screen>'
const checkoutSource =
  '<Screen id="checkout" title="Checkout"><Header title="Checkout" /><Stack gap="spacing.md"><Stack id="styled" css="border-left: 4px solid rgb(255, 0, 0)" gap="spacing.sm"><Text>Styled card</Text><Image src="images/pixel.png" alt="Pixel" height="8px" /></Stack><Button id="open-filters" onPress={open("filters")}>Filters</Button><Tabs id="tabs"><Tab id="one" label="One" value="one"><Text>First panel</Text></Tab><Tab id="two" label="Two" value="two"><Text>Second panel</Text></Tab></Tabs></Stack><Drawer id="filters" title="Filters"><Text>Drawer body</Text></Drawer></Screen>'

function payload(revision: number, screens: WireScreen[], projectError?: string): ProjectPayload {
  return {
    session: 'session-test',
    revision,
    config: {
      kitVersion: '1.0.0',
      breakpoints: [
        { name: 'mobile', width: 390 },
        { name: 'tablet', width: 768 },
        { name: 'desktop', width: 1280 },
      ],
      entry: 'home',
    },
    kitVersion: '1.0.0',
    tokens: {
      'color.text': { path: 'color.text', type: 'color', value: '#334155', cssVar: '--dsx-color-text' },
      'spacing.md': { path: 'spacing.md', type: 'dimension', value: '16px', cssVar: '--dsx-spacing-md' },
      'spacing.sm': { path: 'spacing.sm', type: 'dimension', value: '8px', cssVar: '--dsx-spacing-sm' },
    },
    cssVariables: { '--dsx-color-text': '#334155' },
    diagnostics: [],
    screens,
    assets: {
      'images/pixel.png':
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3nWQAAAABJRU5ErkJggg==',
    },
    ...(projectError === undefined ? {} : { projectError }),
  }
}

async function findChromium(): Promise<string | undefined> {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH !== undefined) return process.env.PLAYWRIGHT_CHROMIUM_PATH
  const roots = [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]
  const candidates = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-linux/chrome',
    'chrome-linux64/chrome',
  ]
  for (const root of roots) {
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith('chromium-')) continue
      for (const candidate of candidates) {
        const path = join(root, entry, candidate)
        try {
          await access(path)
          return path
        } catch {
          // Try the next layout.
        }
      }
    }
  }
  return undefined
}

const chromiumPath = await findChromium()
let server: Server | undefined
let browser: Browser | undefined
let base = ''
let current: ProjectPayload = payload(1, [screen('home', homeSource), screen('checkout', checkoutSource)])
const streams = new Set<import('node:http').ServerResponse>()

function publish(next: ProjectPayload): void {
  current = next
  for (const stream of streams)
    stream.write('event: revision\ndata: ' + JSON.stringify({ rev: next.revision }) + '\n\n')
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

beforeAll(async () => {
  try {
    await access(join(dist, 'app.js'))
  } catch {
    return
  }
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://test')
    const apiPath = url.pathname.replace(/^\/design\/session-test/, '')
    if (apiPath === '/_/project') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(current))
      return
    }
    if (apiPath === '/_/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write('retry: 200\n\n')
      streams.add(res)
      req.on('close', () => streams.delete(res))
      return
    }
    if (apiPath.startsWith('/_/assets/') || url.pathname.startsWith('/_/assets/')) {
      const assetPath = url.pathname.startsWith('/_/assets/') ? url.pathname : apiPath
      const file = resolve(dist, assetPath.slice('/_/assets/'.length))
      try {
        const body = await readFile(file)
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
        res.end(body)
      } catch {
        res.writeHead(404).end()
      }
      return
    }
    if (apiPath === '/_/files/pixel.png') {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3nWQAAAABJRU5ErkJggg==',
          'base64',
        ),
      )
      return
    }
    if (url.pathname.startsWith('/design/session-test') && !apiPath.startsWith('/_/')) {
      if (url.searchParams.get('deterministic') === '1') {
        const document = await deterministicDocument(dist, current)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': document.csp })
        res.end(document.html)
        return
      }
      const html = (await readFile(join(dist, 'index.html'), 'utf8')).replaceAll('./app.', '/_/assets/app.')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((ready) => server!.listen(0, '127.0.0.1', ready))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  base = 'http://127.0.0.1:' + String(address.port)
  if (chromiumPath === undefined) return
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
}, 60000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>((closed) => (server === undefined ? closed() : server.close(() => closed())))
})

async function pageAt(viewport: { width: number; height: number }, path: string): Promise<Page> {
  if (browser === undefined) throw new Error('Chromium is unavailable')
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  ;(page as Page & { requests: string[] }).requests = requests
  page.on('pageerror', (error) => console.log('preview page error: ' + String(error)))
  page.setDefaultTimeout(10000)
  await page.goto(base + path, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.dsx-frame')
  await page.waitForTimeout(250)
  return page
}

describe('real browser preview regressions', async () => {
  it.skipIf(chromiumPath === undefined)(
    'fits 390x844, keeps exact canvas widths, and avoids page overflow',
    async () => {
      const page = await pageAt({ width: 390, height: 844 }, '/design/session-test/checkout?bp=mobile')
      try {
        const frame = page.locator('.dsx-frame')
        expect(await frame.getAttribute('data-breakpoint')).toBe('mobile')
        expect(await frame.evaluate((element) => element.getBoundingClientRect().width)).toBe(390)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
        await page.getByRole('button', { name: /desktop/ }).click()
        await page.waitForTimeout(200)
        expect(await frame.getAttribute('data-breakpoint')).toBe('desktop')
        expect(await frame.evaluate((element) => element.getBoundingClientRect().width)).toBe(1280)
        expect(new URL(page.url()).searchParams.get('bp')).toBe('desktop')
        await page.screenshot({ path: '/tmp/dsx-browser-phone.png' })
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'keeps deep links, Back, Forward, and the breakpoint picker in agreement',
    async () => {
      const page = await pageAt({ width: 1440, height: 900 }, '/design/session-test/')
      try {
        expect(await page.getByText('Home screen').count()).toBe(1)
        await page.getByRole('button', { name: 'checkout', exact: true }).click()
        await page.waitForURL('**/design/session-test/checkout?bp=desktop')
        expect(await page.getByText('Styled card').count()).toBe(1)
        await page.goBack()
        await page.waitForURL('**/design/session-test/')
        expect(await page.getByText('Home screen').count()).toBe(1)
        await page.goForward()
        await page.waitForURL('**/design/session-test/checkout?bp=desktop')
        expect(await page.getByText('Styled card').count()).toBe(1)
        await page.getByRole('button', { name: /mobile/ }).click()
        await page.waitForURL('**/design/session-test/checkout?bp=mobile')
        expect(await page.locator('.dsx-frame').getAttribute('data-breakpoint')).toBe('mobile')
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForSelector('.dsx-frame')
        expect(await page.locator('.dsx-frame').getAttribute('data-breakpoint')).toBe('mobile')
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'confines a named drawer, moves focus in, restores it, and applies node css',
    async () => {
      const page = await pageAt({ width: 1440, height: 900 }, '/design/session-test/checkout?bp=desktop')
      try {
        const styled = page.locator('[data-dsx-id="styled"]')
        expect(await styled.evaluate((element) => getComputedStyle(element).borderLeftWidth)).toBe('4px')
        expect(await styled.evaluate((element) => getComputedStyle(element).borderLeftColor)).toBe('rgb(255, 0, 0)')
        const trigger = page.getByRole('button', { name: 'Filters' })
        await trigger.click()
        const dialog = page.getByRole('dialog')
        await dialog.waitFor({ state: 'visible' })
        expect(await dialog.getAttribute('aria-labelledby')).toBeTruthy()
        expect(await dialog.evaluate((element) => element.textContent ?? '')).toContain('Filters')
        const measurement = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]')
          const frame = document.querySelector('.dsx-frame')
          if (dialog === null || frame === null)
            return { insideFrame: false, focusInside: false, dialog: [], frame: [] }
          const dialogRect = dialog.getBoundingClientRect()
          const frameRect = frame.getBoundingClientRect()
          const active = document.activeElement
          return {
            insideFrame:
              dialogRect.top >= frameRect.top - 1 &&
              dialogRect.bottom <= frameRect.bottom + 1 &&
              dialogRect.left >= frameRect.left - 1 &&
              dialogRect.right <= frameRect.right + 1,
            focusInside: active !== null && dialog.contains(active),
            dialog: [dialogRect.top, dialogRect.bottom, dialogRect.left, dialogRect.right],
            frame: [frameRect.top, frameRect.bottom, frameRect.left, frameRect.right],
            active: active?.tagName,
          }
        })
        expect(measurement.insideFrame, JSON.stringify(measurement)).toBe(true)
        expect(measurement.focusInside, JSON.stringify(measurement)).toBe(true)
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null)
        expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(true)
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'retains the last valid tree and state through a syntax break and repair',
    async () => {
      const page = await pageAt({ width: 1440, height: 900 }, '/design/session-test/checkout?bp=desktop')
      try {
        await page.getByRole('button', { name: 'Filters' }).click()
        await page.getByText('Drawer body').waitFor({ state: 'visible' })
        const checkout = screen('checkout', checkoutSource)
        current = payload(2, [
          screen('home', homeSource),
          {
            ...checkout,
            root: undefined,
            lastValidRoot: checkout.root,
            errors: 1,
            diagnostics: [
              {
                severity: 'error',
                code: 'syntax-error',
                file: 'screens/checkout.dsx',
                line: 2,
                column: 1,
                message: 'Unclosed tag',
              },
            ],
          },
        ])
        publish(current)
        await page.getByText(/validation error/).waitFor({ state: 'visible' })
        await page.getByText('Styled card').waitFor({ state: 'visible' })
        await page.getByText('Drawer body').waitFor({ state: 'visible' })
        current = payload(3, [screen('home', homeSource), checkout])
        publish(current)
        await page.waitForFunction(() => !document.body.textContent?.includes('validation error'))
        await page.getByText('Drawer body').waitFor({ state: 'visible' })
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'traps focus in the top modal at phone and desktop, including after reload',
    async () => {
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ]) {
        const page = await pageAt(viewport, '/design/session-test/checkout?bp=desktop')
        try {
          const trigger = page.getByRole('button', { name: 'Filters' })
          await trigger.click()
          await page.getByRole('dialog').waitFor({ state: 'visible' })
          for (let index = 0; index < 6; index += 1) {
            await page.keyboard.press('Tab')
            expect(
              await page.evaluate(() => {
                const dialog = document.querySelector('[role="dialog"]')
                return dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement)
              }),
            ).toBe(true)
          }
          for (let index = 0; index < 3; index += 1) {
            await page.keyboard.press('Shift+Tab')
            expect(
              await page.evaluate(() => {
                const dialog = document.querySelector('[role="dialog"]')
                return dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement)
              }),
            ).toBe(true)
          }
          await page
            .locator('.dsx-chrome button')
            .first()
            .evaluate((element) => (element as HTMLElement).focus())
          await page.waitForTimeout(50)
          expect(
            await page.evaluate(() => {
              const dialog = document.querySelector('[role="dialog"]')
              return dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement)
            }),
          ).toBe(true)
          await page.keyboard.press('Escape')
          await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null)
          expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(true)
          await trigger.click()
          await page.getByRole('dialog').waitFor({ state: 'visible' })
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.waitForSelector('.dsx-frame')
          await page.getByRole('dialog').waitFor({ state: 'visible' })
          expect(
            await page.evaluate(() => {
              const dialog = document.querySelector('[role="dialog"]')
              return dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement)
            }),
          ).toBe(true)
          await page.keyboard.press('Tab')
          expect(
            await page.evaluate(() => {
              const dialog = document.querySelector('[role="dialog"]')
              return dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement)
            }),
          ).toBe(true)
        } finally {
          await page.context().close()
        }
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'serves a self-contained deterministic document with no further requests',
    async () => {
      const load = async (): Promise<{ page: Page; html: string; rects: number[][] }> => {
        const page = await pageAt(
          { width: 1440, height: 900 },
          '/design/session-test/checkout?bp=desktop&deterministic=1',
        )
        try {
          const html = await page.locator('.dsx-frame-inner').innerHTML()
          const rects = await page.locator('[data-dsx-type]').evaluateAll((nodes) =>
            nodes.map((node) => {
              const rect = node.getBoundingClientRect()
              return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)]
            }),
          )
          return { page, html, rects }
        } catch (error) {
          await page.context().close()
          throw error
        }
      }
      const first = await load()
      try {
        const requests = (first.page as Page & { requests: string[] }).requests
        expect(requests).toHaveLength(1)
        expect(requests[0]).toBe(first.page.url())
        expect(await first.page.locator('.dsx-shell').getAttribute('data-dsx-clock')).toBe('1700000000000')
        expect(await first.page.evaluate(() => document.fonts.check('16px Inter'))).toBe(true)
        expect(
          await first.page
            .locator('img[alt="Pixel"]')
            .evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
        ).toBe(true)
        await first.page.getByRole('button', { name: /home/ }).click()
        await first.page.waitForURL('**/design/session-test/home?bp=desktop&deterministic=1')
        await first.page.getByRole('button', { name: 'checkout', exact: true }).click()
        await first.page.waitForURL('**/design/session-test/checkout?bp=desktop&deterministic=1')
        await first.page.getByRole('button', { name: 'Filters' }).click()
        await first.page.getByText('Drawer body').waitFor({ state: 'visible' })
        expect((first.page as Page & { requests: string[] }).requests).toHaveLength(1)
        const second = await load()
        try {
          expect(second.html).toBe(first.html)
          expect(second.rects).toEqual(first.rects)
          expect((second.page as Page & { requests: string[] }).requests).toHaveLength(1)
        } finally {
          await second.page.context().close()
        }
      } finally {
        await first.page.context().close()
      }
    },
  )
})
