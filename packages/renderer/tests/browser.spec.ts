// Real Chromium regression for the preview renderer.
import { createServer, type Server } from 'node:http'
import { access, readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { parseScreen } from '../../core/src/parse.ts'
import { extractNamedStates } from '../../core/src/state.ts'
import { kitMetadata } from '../../kit/src/meta.ts'
import { resolveVariantDocument } from '../../core/src/variants.ts'
import { fingerprintDesignTree } from '../../core/src/fingerprint.ts'
import { deterministicDocument } from '../../host/src/deterministic.ts'
import type { NamedState } from '@filipeesch/dsh-design-core'
import type { ProjectPayload, WireScreen } from '../src/wire.ts'

const dist = new URL('../dist/', import.meta.url).pathname

function screen(id: string, source: string, states?: readonly NamedState[]): WireScreen {
  const parsed = parseScreen(source, 'screens/' + id + '.dsx')
  return {
    id,
    file: 'screens/' + id + '.dsx',
    root: parsed.root,
    lastValidRoot: parsed.root,
    diagnostics: parsed.diagnostics,
    errors: 0,
    warnings: 0,
    ...(states === undefined ? {} : { states }),
  }
}

const homeSource =
  '<Screen id="home" title="Home"><Header title="Home" /><Stack gap="spacing.md"><Text>Home screen</Text><Button id="go-checkout" onPress={navigate("checkout")}>Go checkout</Button></Stack></Screen>'
const checkoutSource =
  '<Screen id="checkout" title="Checkout"><Header title="Checkout" /><Stack gap="spacing.md"><Stack id="styled" css="border-left: 4px solid rgb(255, 0, 0)" gap="spacing.sm"><Text>Styled card</Text><Image src="images/pixel.png" alt="Pixel" height="8px" /></Stack><Button id="open-filters" onPress={open("filters")}>Filters</Button><Tabs id="tabs"><Tab id="one" label="One" value="one"><Text>First panel</Text></Tab><Tab id="two" label="Two" value="two"><Text>Second panel</Text></Tab></Tabs></Stack><Drawer id="filters" title="Filters"><Text>Drawer body</Text></Drawer></Screen>'
const statedSource =
  '<Screen id="stated" title="Stated" states={{ "filter-open": { open: ["filters"], tabs: { tabs: "two" } } }}><Header title="Stated" /><Stack gap="spacing.md"><Input id="search" label="Search" /><Tabs id="tabs"><Tab id="one" label="One" value="one"><Text>First panel</Text></Tab><Tab id="two" label="Two" value="two"><Text>Second panel</Text></Tab></Tabs><Button id="open-filters" onPress={open("filters")}>Filters</Button></Stack><Drawer id="filters" title="Filters"><Text>Drawer body</Text></Drawer></Screen>'
const statedStates: readonly NamedState[] = [
  {
    name: 'filter-open',
    source: { file: 'screens/stated.dsx', line: 1, column: 1 },
    open: ['filters'],
    tabs: { tabs: 'two' },
    values: { search: 'seeded' },
  },
]
const reconcileSource = (order: readonly string[]): string =>
  '<Screen id="reconcile" title="Reconcile"><Stack gap="spacing.md"><Input id="search" label="Search" /><List id="orders-list" gap="spacing.sm">' +
  order.map((id) => '<ListItem id="orders-list-' + id + '"><Text>' + id + '</Text></ListItem>').join('') +
  '</List><Button id="open-filters" onPress={open("filters")}>Filters</Button></Stack><Drawer id="filters" title="Filters"><Text>Drawer body</Text></Drawer></Screen>'

let variantDemoSource = [
  '<Screen id="variant-demo" title="Variants">',
  '  <Text>Hello preview</Text>',
  '  <Variants id="layout" chosen="compact">',
  '    <Variant branch="compact">',
  '      <Stack gap="spacing.md"><Text>Compact pane</Text><Button id="open" onPress={open("filters")}>Open</Button><Button id="go-other" onPress={navigate("other")}>Go other</Button><Input id="name" label="Name" /><Drawer id="filters" title="Filters"><Text>Compact drawer</Text></Drawer></Stack>',
  '    </Variant>',
  '    <Variant branch="spacious">',
  '      <Stack gap="spacing.md"><Text>Spacious pane</Text><Button id="open">Open</Button><Input id="name" label="Name" /><Drawer id="filters" title="Filters"><Text>Spacious drawer</Text></Drawer></Stack>',
  '    </Variant>',
  '  </Variants>',
  '</Screen>',
].join('\n')

let variantDemoBroken: 'stale' | 'none' | undefined

function otherVariantScreen(): WireScreen {
  const parsed = parseScreen('<Screen id="other" title="Other"><Text>Other screen</Text></Screen>', 'screens/other.dsx')
  return {
    id: 'other',
    file: 'screens/other.dsx',
    root: parsed.root,
    lastValidRoot: parsed.root,
    diagnostics: [],
    errors: 0,
    warnings: 0,
    blockingErrors: 0,
  }
}

function variantDemoScreen(branch: 'compact' | 'spacious'): WireScreen {
  const parsed = parseScreen(variantDemoSource, 'screens/variant-demo.dsx')
  const projection = resolveVariantDocument(parsed.document!, branch === 'compact' ? {} : { layout: 'spacious' })
  if (projection.screen === undefined) throw new Error('variant projection failed')
  return {
    id: 'variant-demo',
    file: 'screens/variant-demo.dsx',
    root: projection.screen,
    lastValidRoot: projection.screen,
    diagnostics:
      branch === 'spacious' && variantDemoBroken === 'stale'
        ? [
            {
              severity: 'error',
              code: 'branch-invalid',
              file: 'screens/variant-demo.dsx',
              line: 7,
              column: 5,
              message: 'The spacious source is invalid; showing the last valid projection.',
              branch: 'spacious',
            },
          ]
        : [],
    errors: 0,
    warnings: 0,
    blockingErrors: 0,
    variants: [
      {
        id: 'layout',
        path: 'layout',
        chosen: 'compact',
        source: { file: 'screens/variant-demo.dsx', line: 3, column: 3 },
        wholeScreen: false,
        branches: [
          {
            id: 'compact',
            source: { file: 'screens/variant-demo.dsx', line: 4, column: 5 },
            valid: true,
            diagnostics: [],
          },
          {
            id: 'spacious',
            source: { file: 'screens/variant-demo.dsx', line: 7, column: 5 },
            valid: variantDemoBroken === undefined,
            ...(variantDemoBroken === 'stale' ? { stale: true } : {}),
            diagnostics: [],
          },
        ],
      },
    ],
    variant: {
      group: 'layout',
      path: 'layout',
      branch,
      chosen: branch === 'compact',
      selection: branch === 'compact' ? { layout: 'compact' } : { layout: 'spacious' },
    },
    ...(branch === 'spacious' && variantDemoBroken === 'stale' ? { variantStale: true } : {}),
  }
}

function disclosureScreen(edited = false): WireScreen {
  const value = screen(
    'disclosure',
    `<Screen id="disclosure" states={{ expanded: { disclosures: { price: true, initially: false } } }}>
    <Disclosure id="price" label="Price details"><Button id="inside">Inside</Button></Disclosure>
    <Disclosure id="delivery" label="${edited ? 'Delivery updated' : 'Delivery details'}"><Text>Delivery answer</Text></Disclosure>
    <Disclosure id="initially" label="Initially open" defaultOpen><Text>Default answer</Text></Disclosure>
    <Button id="after">Continue</Button>
  </Screen>`,
  )
  const extracted = extractNamedStates(value.root!, value.file, kitMetadata)
  expect(extracted.diagnostics).toEqual([])
  return { ...value, root: extracted.root, lastValidRoot: extracted.root, states: extracted.states }
}

function allScreens(revision: number, reconcile: readonly string[] = ['order-1', 'order-2']): ProjectPayload {
  return payload(revision, [
    screen('home', homeSource),
    screen('checkout', checkoutSource),
    screen('stated', statedSource, statedStates),
    screen('reconcile', reconcileSource(reconcile)),
  ])
}

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
let current: ProjectPayload = payload(1, [
  screen('home', homeSource),
  screen('checkout', checkoutSource),
  screen('stated', statedSource, statedStates),
  screen('reconcile', reconcileSource(['order-1', 'order-2'])),
])

interface BrowserDraft {
  id: string
  revision: number
  text: string
  anchor: { id: string; kind: 'stable' | 'structural'; type: string; revision: number }
  context: { screen: string; breakpoint: string; state?: string; overlays: string[]; tabs: Record<string, string> }
  createdAt: number
  updatedAt: number
}

let comments: BrowserDraft[] = []
let commentSequence = 1
let commentRevision = 0

function commentSnapshot(): Record<string, unknown> {
  return { session: 'session-test', revision: commentRevision, drafts: comments.map((draft) => ({ ...draft })) }
}

beforeEach(() => {
  variantDemoBroken = undefined
  variantDemoSource = variantDemoSource.replace('Spacious recovered', 'Spacious pane')
  comments = []
  commentSequence = 1
  commentRevision = 0
})

async function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? undefined : JSON.parse(text)
}

function publish(next: ProjectPayload): void {
  current = next
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
    if (apiPath === '/_/comments') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(commentSnapshot()))
      return
    }
    if (apiPath.startsWith('/_/comments/')) {
      const action = apiPath.slice('/_/comments/'.length)
      const body = (await readBody(req)) as any
      if (req.method !== 'POST' || body === undefined) {
        res.writeHead(400).end()
        return
      }
      if (action === 'create') {
        const draft: BrowserDraft = {
          id: 'comment-' + String(commentSequence++),
          revision: 1,
          text: body.text,
          anchor: body.anchor,
          context: body.context,
          createdAt: 1,
          updatedAt: 1,
        }
        comments.push(draft)
        commentRevision += 1
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(commentSnapshot()))
        return
      }
      if (action === 'update' || action === 'remove') {
        const draft = comments.find((candidate) => candidate.id === body.id)
        if (draft === undefined || draft.revision !== body.revision) {
          res.writeHead(409, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'stale', message: 'comment changed' }))
          return
        }
        if (action === 'update') {
          draft.text = body.text
          draft.revision += 1
        } else {
          comments = comments.filter((candidate) => candidate.id !== body.id)
        }
        commentRevision += 1
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(commentSnapshot()))
        return
      }
      res.writeHead(404).end()
      return
    }
    if (apiPath === '/_/project') {
      res.writeHead(200, { 'content-type': 'application/json' })
      const variant = url.searchParams.get('variant')
      if (url.searchParams.get('screen') === 'variant-demo' && variant !== null) {
        const index = variant.lastIndexOf(':')
        const branch = index < 0 ? '' : variant.slice(index + 1)
        const selected = branch === 'spacious' ? variantDemoScreen('spacious') : variantDemoScreen('compact')
        res.end(JSON.stringify(payload(current.revision, [selected, otherVariantScreen()])))
        return
      }
      res.end(JSON.stringify(current))
      return
    }
    if (apiPath === '/_/revision') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ token: String(current.revision) }))
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
    if (url.pathname === '/__short-pane') {
      const width = Number(url.searchParams.get('w') ?? '369')
      const height = Number(url.searchParams.get('h') ?? '344')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        '<!doctype html><html><body style="margin:0;overflow:hidden"><iframe title="short pane" src="/design/session-test/checkout?bp=desktop" style="width:' +
          String(width) +
          'px;height:' +
          String(height) +
          'px;border:0;display:block"></iframe></body></html>',
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

async function comparePageAt(viewport: { width: number; height: number }, path: string): Promise<Page> {
  if (browser === undefined) throw new Error('Chromium is unavailable')
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  page.on('pageerror', (error) => console.log('compare page error: ' + String(error)))
  page.setDefaultTimeout(10000)
  await page.goto(base + path, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.dsx-compare')
  await page.waitForTimeout(250)
  return page
}

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

async function browseScreen(page: Page, id: string): Promise<void> {
  const browse = page.getByRole('button', { name: 'Screens', exact: true })
  if (await browse.isVisible()) await browse.click()
  await page
    .getByRole('navigation', { name: 'Screens' })
    .locator('a[href*="/' + id + '?"]')
    .click()
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
        await page.getByLabel('Breakpoint').selectOption('desktop')
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
        await browseScreen(page, 'checkout')
        await page.waitForURL('**/design/session-test/checkout?bp=desktop')
        expect(await page.getByText('Styled card').count()).toBe(1)
        await page.goBack()
        await page.waitForURL('**/design/session-test/')
        await page.getByText('Home screen').waitFor()
        await page.goForward()
        await page.waitForURL('**/design/session-test/checkout?bp=desktop')
        await page.getByText('Styled card').waitFor()
        await page.getByLabel('Breakpoint').selectOption('mobile')
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
    'applies a named state on direct links, keeps it across breakpoints, and reapplies it on history',
    async () => {
      current = allScreens(10)
      const page = await pageAt({ width: 390, height: 844 }, '/design/session-test/stated?bp=mobile&state=filter-open')
      try {
        expect(await page.locator('.dsx-shell').getAttribute('data-dsx-state')).toBe('filter-open')
        expect(await page.locator('.dsx-frame').getAttribute('data-breakpoint')).toBe('mobile')
        await page.getByRole('dialog').waitFor({ state: 'visible' })
        expect(await page.getByText('Second panel').count()).toBe(1)
        expect(await page.locator('[data-dsx-id="search"] input').inputValue()).toBe('seeded')
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null)
        await page.getByLabel('Breakpoint').selectOption('desktop')
        await page.waitForURL('**/design/session-test/stated?bp=desktop&state=filter-open')
        await page.waitForTimeout(150)
        expect(await page.locator('.dsx-frame').getAttribute('data-breakpoint')).toBe('desktop')
        expect(await page.locator('[role="dialog"]').count()).toBe(0)
        await browseScreen(page, 'home')
        await page.waitForURL('**/design/session-test/home?bp=desktop')
        await page.goBack()
        await page.waitForURL('**/design/session-test/stated?bp=desktop&state=filter-open')
        await page.getByRole('dialog').waitFor({ state: 'visible' })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForSelector('.dsx-frame')
        await page.getByRole('dialog').waitFor({ state: 'visible' })
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'operates independent Disclosure toggles and seeds the same canvas in deterministic mode',
    async () => {
      current = payload(1, [disclosureScreen()])
      const path = '/design/session-test/disclosure?bp=mobile&state=expanded'
      const viewport = { width: 390, height: 844 }
      const page = await pageAt(viewport, path)
      const price = page.getByRole('button', { name: 'Price details' })
      const inside = page.getByRole('button', { name: 'Inside' })
      const delivery = page.getByRole('button', { name: 'Delivery details' })
      const initially = page.getByRole('button', { name: 'Initially open' })
      try {
        expect(await price.getAttribute('aria-expanded')).toBe('true')
        expect(await delivery.getAttribute('aria-expanded')).toBe('false')
        expect(await initially.getAttribute('aria-expanded')).toBe('false')
        const controlled = await price.getAttribute('aria-controls')
        expect(await page.locator('[id="' + controlled + '"]').isVisible()).toBe(true)
        await inside.focus()
        await price.click()
        expect(await price.getAttribute('aria-expanded')).toBe('false')
        expect(await price.evaluate((node) => node === document.activeElement)).toBe(true)
        expect(await inside.count()).toBe(0)
        await page.keyboard.press('Tab')
        expect(await delivery.evaluate((node) => node === document.activeElement)).toBe(true)
        await delivery.press('Space')
        expect(await delivery.getAttribute('aria-expanded')).toBe('true')
        await delivery.press('Enter')
        expect(await delivery.getAttribute('aria-expanded')).toBe('false')
        expect(await delivery.evaluate((node) => node === document.activeElement)).toBe(true)
        expect(new URL(page.url()).searchParams.get('state')).toBe('expanded')

        current = payload(2, [disclosureScreen(true)])
        publish(current)
        await page.getByRole('button', { name: 'Delivery updated' }).waitFor()
        expect(await price.getAttribute('aria-expanded')).toBe('false')
        expect(await inside.count()).toBe(0)

        await page.goto(base + path + '&deterministic=1', { waitUntil: 'domcontentloaded' })
        await page.locator('.dsx-frame').waitFor()
        expect(await price.getAttribute('aria-expanded')).toBe('true')
        expect(await inside.isVisible()).toBe(true)
        expect(await initially.getAttribute('aria-expanded')).toBe('false')
        await page.goto(base + '/design/session-test/disclosure?bp=mobile&deterministic=1', {
          waitUntil: 'domcontentloaded',
        })
        await page.locator('.dsx-frame').waitFor()
        expect(await price.getAttribute('aria-expanded')).toBe('false')
        expect(await initially.getAttribute('aria-expanded')).toBe('true')
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'navigates the focused and full flow map while preserving comment mode',
    async () => {
      const home = { screen: 'home' }
      const checkout = { screen: 'checkout' }
      const approved = { screen: 'stated', state: 'filter-open', situation: 'filters-open' }
      const isolated = screen(
        'isolated',
        '<Screen id="isolated" title="Standalone help"><Text>Independent topic</Text></Screen>',
      )
      const authored = [
        { id: 'approve', kind: 'simulated', label: 'Simulate approval', from: checkout, to: approved },
        { id: 'return', kind: 'illustrative', label: 'Return to start', from: approved, to: home },
      ] as const
      current = {
        ...allScreens(44),
        screens: [...allScreens(44).screens, isolated],
        preview: {
          screens: { home: { summary: 'Durable summary', details: 'Longer review context' } },
          groups: [{ id: 'shop', label: 'Shop flow', screens: ['home', 'checkout'] }],
          situations: [
            {
              id: 'filters-open',
              label: 'Open filters',
              parent: 'stated',
              target: { screen: 'stated', state: 'filter-open' },
            },
          ],
          relationships: authored,
        },
        relationships: [
          { id: 'go', kind: 'prototype', label: 'Go checkout', from: home, to: checkout },
          { id: 'cycle', kind: 'prototype', label: 'Go home', from: checkout, to: home },
          ...authored,
        ],
      }
      const page = await pageAt({ width: 1440, height: 900 }, '/design/session-test/home?bp=desktop')
      try {
        expect(await page.getByText('Durable summary').count()).toBe(1)
        await page.getByText('Screen details', { exact: true }).click()
        expect(await page.getByText('Longer review context').isVisible()).toBe(true)
        await page.getByRole('button', { name: 'Comment', exact: true }).click()
        const mapButton = page.getByRole('button', { name: 'Flow map', exact: true })
        await mapButton.click()
        const map = page.getByRole('dialog', { name: 'Flow map' })
        await map.waitFor()
        expect(await map.getByText('Prototype click').count()).toBe(2)
        expect(await map.getByText('Illustrative only').count()).toBe(1)
        expect(await map.getByRole('link', { name: 'Standalone help' }).count()).toBe(0)
        await page.keyboard.press('Escape')
        expect(await map.count()).toBe(0)
        expect(await mapButton.evaluate((node) => document.activeElement === node)).toBe(true)
        await page.getByRole('button', { name: 'Go checkout' }).click()
        await page.getByRole('textbox', { name: 'Comment text' }).waitFor()
        expect(new URL(page.url()).pathname.endsWith('/home')).toBe(true)
        await page.keyboard.press('Escape')
        await mapButton.click()
        await map.getByRole('button', { name: 'All screens' }).click()
        await map.getByRole('link', { name: 'Standalone help' }).press('Enter')
        await page.getByText('Independent topic').waitFor()
        await browseScreen(page, 'checkout')
        const outcomes = page.getByRole('region', { name: 'Simulated outcomes' })
        const simulate = outcomes.getByRole('button', { name: 'Simulate approval' })
        await simulate.waitFor()
        expect(await page.locator('.dsx-frame').getByText('Simulate approval').count()).toBe(0)
        await mapButton.click()
        expect(await map.getByText('Manual simulation').count()).toBe(1)
        expect(new URL(page.url()).pathname.endsWith('/checkout')).toBe(true)
        await map.getByRole('button', { name: 'Close' }).click()
        await simulate.click()
        await page.waitForURL('**/stated?bp=desktop&state=filter-open&situation=filters-open')
        await page.locator('.dsx-frame').getByRole('dialog').waitFor()
        expect(await outcomes.count()).toBe(0)
        expect(
          await page
            .getByRole('navigation', { name: 'Screens' })
            .getByRole('link', { name: 'Open filters' })
            .getAttribute('aria-current'),
        ).toBe('page')
        await page.goBack()
        await simulate.waitFor()
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'browses authored situations in a narrow iframe without changing canvas width',
    async () => {
      current = {
        ...allScreens(45),
        preview: {
          screens: {},
          groups: [],
          relationships: [],
          situations: [
            {
              id: 'filter-situation',
              label: 'Open filters',
              parent: 'checkout',
              target: { screen: 'stated', state: 'filter-open' },
            },
          ],
        },
      }
      if (browser === undefined) throw new Error('no browser')
      const page = await browser.newPage({ viewport: { width: 420, height: 600 } })
      try {
        await page.goto(base + '/__short-pane')
        const frame = page.frameLocator('iframe')
        const trigger = frame.getByRole('button', { name: 'Screens', exact: true })
        await trigger.press('Enter')
        const dialog = frame.getByRole('dialog', { name: 'Browse screens' })
        await dialog.getByRole('link', { name: 'Open filters' }).press('Enter')
        await dialog.waitFor({ state: 'hidden' })
        // The named state opens a drawer, which may take focus from the browser navigator.
        expect(
          await trigger.evaluate(
            (node) =>
              node === document.activeElement || document.activeElement?.closest('.dsx-frame [role=dialog]') !== null,
          ),
        ).toBe(true)
        expect(await frame.locator('.dsx-frame').getAttribute('data-breakpoint')).toBe('desktop')
        expect(await frame.locator('.dsx-shell').getAttribute('data-dsx-state')).toBe('filter-open')
        expect(await frame.getByRole('button', { name: 'Comment', exact: true }).isVisible()).toBe(true)
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'shows an explicit diagnostic for an unknown state and does not apply it',
    async () => {
      current = allScreens(11)
      const page = await pageAt({ width: 390, height: 844 }, '/design/session-test/stated?bp=mobile&state=ghost')
      try {
        expect(await page.locator('.dsx-shell').getAttribute('data-dsx-state-error')).toBe('1')
        expect(await page.getByText('Unknown state').count()).toBe(1)
        expect(await page.getByText(/not declared for screen/).count()).toBe(1)
        expect(await page.locator('[role="dialog"]').count()).toBe(0)
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'reconciles fixture-like rows and named state with owner interaction on hot reload',
    async () => {
      current = allScreens(12)
      const page = await pageAt({ width: 390, height: 844 }, '/design/session-test/reconcile?bp=mobile')
      try {
        expect(await page.locator('[data-dsx-id="orders-list-order-1"]').count()).toBe(1)
        await page.locator('[data-dsx-id="search"] input').fill('kept')
        await page.getByRole('button', { name: 'Filters' }).click()
        await page.getByRole('dialog').waitFor({ state: 'visible' })
        current = allScreens(13, ['order-2', 'order-1'])
        publish(current)
        await page.waitForFunction(
          () => document.querySelector('[data-dsx-id="orders-list"]')?.textContent?.startsWith('order-2') === true,
        )
        expect(await page.locator('[data-dsx-id="orders-list-order-1"]').count()).toBe(1)
        expect(await page.locator('[data-dsx-id="orders-list-order-2"]').count()).toBe(1)
        expect(await page.locator('[data-dsx-id="search"] input').inputValue()).toBe('kept')
        await page.getByText('Drawer body').waitFor({ state: 'visible' })
        current = allScreens(14, ['order-1'])
        publish(current)
        await page.waitForFunction(() => document.querySelector('[data-dsx-id="orders-list-order-2"]') === null)
        expect(await page.locator('[data-dsx-id="orders-list-order-1"]').count()).toBe(1)
        expect(await page.locator('[data-dsx-id="search"] input').inputValue()).toBe('kept')
        await page.getByText('Drawer body').waitFor({ state: 'visible' })
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'drives comment keyboard entry, selection, escape, and focus restore with the drawer open',
    async () => {
      current = allScreens(30)
      const page = await pageAt({ width: 1440, height: 900 }, '/design/session-test/checkout?bp=desktop')
      try {
        await page.getByRole('button', { name: 'Filters' }).click()
        await page.getByRole('dialog').waitFor({ state: 'visible' })
        const toggle = page.getByRole('button', { name: 'Comment', exact: true })
        await toggle.focus()
        await page.keyboard.press('Enter')
        await page.waitForFunction(() => document.querySelector('[data-dsx-review-target]') !== null)
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        const composer = page.locator('.dsx-review-composer')
        await composer.waitFor({ state: 'visible' })
        await page.waitForFunction(
          () => document.querySelector('.dsx-review-composer')?.getAttribute('data-dsx-balloon') === 'anchored',
        )
        expect(await page.locator('.dsx-review-pointer').count()).toBe(1)
        const context = await composer.locator('.dsx-review-context').first().textContent()
        expect(context ?? '').not.toContain('Screen · #')
        expect(context ?? '').toContain('unstable address')
        expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Comment text')
        for (let index = 0; index < 5; index += 1) {
          await page.keyboard.press('Tab')
          expect(await page.evaluate(() => document.activeElement?.closest('.dsx-review') !== null)).toBe(true)
        }
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => document.querySelector('.dsx-review-composer') === null)
        expect(await page.getByRole('dialog').count()).toBe(1)
        expect(
          await page.evaluate(
            () =>
              document.activeElement?.closest('.dsx-review') !== null ||
              document.activeElement?.closest('[role="dialog"]') !== null,
          ),
        ).toBe(true)
        await toggle.click()
        await page.waitForFunction(() => document.querySelector('[data-dsx-review-target]') !== null)
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => document.querySelector('[data-dsx-review-target]') === null)
        expect((await toggle.textContent())?.trim()).toBe('Comment')
        expect(await page.getByRole('dialog').count()).toBe(1)
        expect(await page.evaluate(() => document.activeElement?.closest('[data-dsx-review-toggle]') !== null)).toBe(
          true,
        )
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null)
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'anchors the comment balloon beside the drawer target and reopens it at the pin',
    async () => {
      current = allScreens(30)
      const page = await pageAt({ width: 1440, height: 900 }, '/design/session-test/checkout?bp=desktop')
      try {
        await page.getByRole('button', { name: 'Filters' }).click()
        await page.getByRole('dialog').waitFor({ state: 'visible' })
        const frameBefore = await page.locator('.dsx-frame').boundingBox()
        const innerBefore = await page
          .locator('.dsx-frame-inner')
          .evaluate((element) => element.getBoundingClientRect().height)
        await page.getByRole('button', { name: 'Comment', exact: true }).click()
        await page.getByText('Drawer body').click()
        await page.locator('.dsx-review-composer').waitFor({ state: 'visible' })
        await page.waitForFunction(
          () => document.querySelector('.dsx-review-composer')?.getAttribute('data-dsx-balloon') === 'anchored',
        )
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Comment text')
        const geometry = await page.evaluate(() => {
          const rect = (element: Element | null) => {
            if (element === null) return null
            const box = element.getBoundingClientRect()
            return {
              left: box.left,
              top: box.top,
              right: box.right,
              bottom: box.bottom,
              width: box.width,
              height: box.height,
            }
          }
          const balloon = document.querySelector('.dsx-review-composer')
          const candidates = [...document.querySelectorAll('[data-dsx-id], [data-dsx-address]')].filter(
            (node) => (node.textContent ?? '').trim() === 'Drawer body',
          )
          return {
            balloon: rect(balloon),
            pointer: rect(document.querySelector('.dsx-review-pointer')),
            target: rect(candidates.at(-1) ?? null),
            stage: rect(document.querySelector('.dsx-stage')),
            frame: rect(document.querySelector('.dsx-frame')),
            side: balloon?.getAttribute('data-side') ?? null,
            anchor: balloon?.getAttribute('data-anchor') ?? null,
            pointers: document.querySelectorAll('.dsx-review-pointer').length,
            dialogs: document.querySelectorAll('[role="dialog"][aria-modal="true"]').length,
            focused: document.activeElement?.getAttribute('aria-label') ?? null,
          }
        })
        expect(geometry.balloon, JSON.stringify(geometry)).not.toBeNull()
        expect(geometry.target, JSON.stringify(geometry)).not.toBeNull()
        expect(geometry.stage, JSON.stringify(geometry)).not.toBeNull()
        const balloon = geometry.balloon!
        const target = geometry.target!
        const stage = geometry.stage!
        expect(geometry.anchor).toBe('available')
        expect(['right', 'left', 'bottom', 'top']).toContain(geometry.side)
        expect(geometry.pointers).toBe(1)
        expect(geometry.dialogs).toBe(1)
        expect(geometry.focused).toBe('Comment text')
        expect(balloon.left).toBeGreaterThanOrEqual(stage.left - 1)
        expect(balloon.top).toBeGreaterThanOrEqual(stage.top - 1)
        expect(balloon.right).toBeLessThanOrEqual(stage.right + 1)
        expect(balloon.bottom).toBeLessThanOrEqual(stage.bottom + 1)
        await page.screenshot({ path: '/tmp/dsx-balloon-desktop.png' })
        const pointer = geometry.pointer!
        expect(pointer, JSON.stringify(geometry)).not.toBeNull()
        if (geometry.side === 'right') {
          expect(Math.abs(pointer.right - balloon.left)).toBeLessThanOrEqual(1)
          expect(pointer.left).toBeGreaterThanOrEqual(target.right - 2)
        } else if (geometry.side === 'left') {
          expect(Math.abs(pointer.left - balloon.right)).toBeLessThanOrEqual(1)
          expect(pointer.right).toBeLessThanOrEqual(target.left + 2)
        } else if (geometry.side === 'bottom') {
          expect(Math.abs(pointer.bottom - balloon.top)).toBeLessThanOrEqual(1)
          expect(pointer.top).toBeGreaterThanOrEqual(target.bottom - 2)
        } else {
          expect(Math.abs(pointer.top - balloon.bottom)).toBeLessThanOrEqual(1)
          expect(pointer.bottom).toBeLessThanOrEqual(target.top + 2)
        }
        const horizontalGap = Math.max(balloon.left - target.right, target.left - balloon.right)
        const verticalGap = Math.max(balloon.top - target.bottom, target.top - balloon.bottom)
        const horizontalOverlap = Math.min(balloon.bottom, target.bottom) - Math.max(balloon.top, target.top) > 0
        const verticalOverlap = Math.min(balloon.right, target.right) - Math.max(balloon.left, target.left) > 0
        expect(
          (horizontalGap >= 0 && horizontalGap <= 24 && horizontalOverlap) ||
            (verticalGap >= 0 && verticalGap <= 24 && verticalOverlap),
          JSON.stringify({ balloon, target }),
        ).toBe(true)
        const frameAfter = await page.locator('.dsx-frame').boundingBox()
        expect(frameAfter?.width).toBe(frameBefore?.width)
        expect(frameAfter?.height).toBe(frameBefore?.height)
        expect(
          await page.locator('.dsx-frame-inner').evaluate((element) => element.getBoundingClientRect().height),
        ).toBe(innerBefore)

        await page.keyboard.press('Escape')
        await page.waitForFunction(() => document.querySelector('.dsx-review-composer') === null)
        expect(await page.getByRole('dialog').count()).toBe(1)

        await page.getByRole('button', { name: 'Comment', exact: true }).click()
        await page.getByText('Drawer body').click()
        await page.getByRole('textbox', { name: 'Comment text' }).fill('Anchor this drawer text')
        await page.getByRole('button', { name: 'Save comment' }).click()
        await page.waitForFunction(() => document.querySelectorAll('.dsx-pin').length === 1)
        await page.locator('.dsx-pin').click()
        await page.locator('.dsx-review-composer').waitFor({ state: 'visible' })
        await page.waitForFunction(
          () => document.querySelector('.dsx-review-composer')?.getAttribute('data-dsx-balloon') === 'anchored',
        )
        expect(await page.getByRole('textbox', { name: 'Comment text' }).inputValue()).toBe('Anchor this drawer text')
        expect(await page.locator('[role="dialog"][aria-modal="true"]').count()).toBe(1)
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => document.querySelector('.dsx-review-composer') === null)
        await page.waitForFunction(() => document.activeElement?.classList.contains('dsx-pin') === true)
        expect(await page.getByRole('dialog').count()).toBe(1)
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'keeps the anchored balloon compact inside a mobile canvas and a narrow pane',
    async () => {
      current = allScreens(31)
      const desktop = await pageAt({ width: 1440, height: 900 }, '/design/session-test/checkout?bp=mobile')
      try {
        expect(await desktop.locator('.dsx-frame').evaluate((element) => element.getBoundingClientRect().width)).toBe(
          390,
        )
        await desktop.getByRole('button', { name: 'Filters' }).click()
        await desktop.getByRole('button', { name: 'Comment', exact: true }).focus()
        await desktop.keyboard.press('Enter')
        await desktop.waitForFunction(() => document.querySelector('[data-dsx-review-target]') !== null)
        let highlighted = ''
        for (let index = 0; index < 30; index += 1) {
          highlighted = await desktop.evaluate(
            () => document.querySelector('[data-dsx-review-target]')?.textContent?.trim() ?? '',
          )
          if (highlighted === 'Drawer body') break
          await desktop.keyboard.press('ArrowDown')
        }
        expect(highlighted).toBe('Drawer body')
        await desktop.keyboard.press('Enter')
        await desktop.locator('.dsx-review-composer').waitFor({ state: 'visible' })
        await desktop.waitForFunction(
          () => document.querySelector('.dsx-review-composer')?.getAttribute('data-dsx-balloon') === 'anchored',
        )
        const mobile = await desktop.evaluate(() => {
          const box = (element: Element | null) => {
            if (element === null) return null
            const rect = element.getBoundingClientRect()
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width }
          }
          return {
            balloon: box(document.querySelector('.dsx-review-composer')),
            stage: box(document.querySelector('.dsx-stage')),
            pointers: document.querySelectorAll('.dsx-review-pointer').length,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          }
        })
        expect(mobile.balloon, JSON.stringify(mobile)).not.toBeNull()
        const mobileBalloon = mobile.balloon!
        const mobileStage = mobile.stage!
        expect(mobile.pointers).toBe(1)
        expect(mobileBalloon.width).toBeLessThanOrEqual(360)
        expect(mobileBalloon.left).toBeGreaterThanOrEqual(mobileStage.left - 1)
        expect(mobileBalloon.right).toBeLessThanOrEqual(mobileStage.right + 1)
        expect(mobile.overflow).toBeLessThanOrEqual(1)
        await desktop.screenshot({ path: '/tmp/dsx-balloon-mobile-canvas.png' })
      } finally {
        await desktop.context().close()
      }

      const narrow = await pageAt({ width: 647, height: 900 }, '/design/session-test/checkout?bp=desktop')
      try {
        await narrow.getByRole('button', { name: 'Filters' }).click()
        await narrow.getByRole('button', { name: 'Comment', exact: true }).click()
        await narrow.getByText('Drawer body').click()
        await narrow.locator('.dsx-review-composer').waitFor({ state: 'visible' })
        await narrow.waitForFunction(
          () => document.querySelector('.dsx-review-composer')?.getAttribute('data-dsx-balloon') === 'anchored',
        )
        const compact = await narrow.evaluate(() => {
          const rect = (element: Element | null) => {
            if (element === null) return null
            const box = element.getBoundingClientRect()
            return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width }
          }
          return {
            balloon: rect(document.querySelector('.dsx-review-composer')),
            stage: rect(document.querySelector('.dsx-stage')),
            pointers: document.querySelectorAll('.dsx-review-pointer').length,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          }
        })
        expect(compact.balloon, JSON.stringify(compact)).not.toBeNull()
        const compactBalloon = compact.balloon!
        const compactStage = compact.stage!
        expect(compact.pointers).toBe(1)
        expect(compactBalloon.width).toBeLessThanOrEqual(360)
        expect(compactBalloon.width).toBeLessThan(compactStage.width - 8)
        expect(compactBalloon.left).toBeGreaterThanOrEqual(compactStage.left - 1)
        expect(compactBalloon.right).toBeLessThanOrEqual(compactStage.right + 1)
        expect(compact.overflow).toBeLessThanOrEqual(1)
        await narrow.screenshot({ path: '/tmp/dsx-balloon-narrow.png' })
      } finally {
        await narrow.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'keeps each comparison pane balloon inside its own pane and its own branch',
    async () => {
      current = payload(1, [variantDemoScreen('compact'), otherVariantScreen()])
      const page = await comparePageAt(
        { width: 900, height: 900 },
        '/design/session-test/variant-demo?compare=layout:compact:spacious&bp=mobile',
      )
      try {
        const left = page.frameLocator('iframe[data-dsx-pane="left"]')
        const right = page.frameLocator('iframe[data-dsx-pane="right"]')
        await left.getByRole('button', { name: 'Open', exact: true }).click()
        await left.getByText('Compact drawer').waitFor({ state: 'visible' })
        await left.getByRole('button', { name: 'Comment', exact: true }).click()
        await left.getByText('Compact drawer').click()
        await left.locator('.dsx-review-composer').waitFor({ state: 'visible' })
        await left.locator('.dsx-review-pointer').waitFor({ state: 'visible' })
        const geometry = await left.locator('body').evaluate(() => {
          const rect = (element: Element | null) => {
            if (element === null) return null
            const box = element.getBoundingClientRect()
            return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width }
          }
          return {
            balloon: rect(document.querySelector('.dsx-review-composer')),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            pointers: document.querySelectorAll('.dsx-review-pointer').length,
          }
        })
        expect(geometry.balloon, JSON.stringify(geometry)).not.toBeNull()
        const balloon = geometry.balloon!
        expect(geometry.pointers).toBe(1)
        expect(balloon.width).toBeLessThanOrEqual(360)
        expect(balloon.left).toBeGreaterThanOrEqual(0)
        expect(balloon.right).toBeLessThanOrEqual(geometry.viewport.width + 1)
        expect(balloon.top).toBeGreaterThanOrEqual(0)
        expect(balloon.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1)
        expect(await right.locator('.dsx-review-composer').count()).toBe(0)
        await left.getByRole('textbox', { name: 'Comment text' }).fill('Only this branch')
        await left.getByRole('button', { name: 'Save comment' }).click()
        await left.locator('.dsx-pin').waitFor({ state: 'visible' })
        expect(await left.locator('.dsx-pin').count()).toBe(1)
        expect(await right.locator('.dsx-pin').count()).toBe(0)
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'edits a draft whose target is unavailable without a false pointer',
    async () => {
      current = allScreens(32)
      comments = [
        {
          id: 'foreign-comment',
          revision: 1,
          text: 'From another screen',
          anchor: { id: 'open-filters', kind: 'stable', type: 'Button', revision: 32 },
          context: { screen: 'home', breakpoint: 'desktop', overlays: [], tabs: {} },
          createdAt: 1,
          updatedAt: 1,
        },
      ]
      const page = await pageAt({ width: 647, height: 900 }, '/design/session-test/checkout?bp=desktop')
      try {
        await page.getByRole('button', { name: /Pending \(1\)/ }).click()
        await page.getByRole('button', { name: 'Edit' }).click()
        await page.locator('.dsx-review-composer').waitFor({ state: 'visible' })
        await page.waitForFunction(
          () => document.querySelector('.dsx-review-composer')?.getAttribute('data-anchor') === 'unavailable',
        )
        expect(await page.locator('.dsx-review-pointer').count()).toBe(0)
        const box = await page.locator('.dsx-review-composer').boundingBox()
        const pane = await page.locator('.dsx-stage').evaluate((element) => element.getBoundingClientRect().width)
        expect(box?.width ?? 0).toBeLessThan(pane - 8)
        expect(await page.getByRole('textbox', { name: 'Comment text' }).inputValue()).toBe('From another screen')
        await page.getByRole('textbox', { name: 'Comment text' }).fill('Edited without an anchor')
        await page.getByRole('button', { name: 'Save comment' }).click()
        await expect.poll(() => comments[0]?.text).toBe('Edited without an anchor')
        expect(await page.locator('.dsx-pin').count()).toBe(0)
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'detaches an open editor when the screen changes and restores it at the original anchor',
    async () => {
      const catalog = screen(
        'catalog',
        '<Screen id="catalog" title="Catalog"><Header title="Catalog" /><Stack gap="spacing.md"><Text>Catalog row</Text></Stack></Screen>',
      )
      current = payload(33, [
        screen('home', homeSource),
        screen('checkout', checkoutSource),
        catalog,
        screen('stated', statedSource, statedStates),
        screen('reconcile', reconcileSource(['order-1', 'order-2'])),
      ])
      const page = await pageAt({ width: 1440, height: 900 }, '/design/session-test/checkout?bp=desktop')
      try {
        // Exact HOLD repro: a structural Header comment, reopened, then Catalog.
        await page.getByRole('button', { name: 'Comment', exact: true }).click()
        await page.locator('[data-dsx-type="Header"]').click()
        await page.getByRole('textbox', { name: 'Comment text' }).fill('Header note')
        await page.getByRole('button', { name: 'Save comment' }).click()
        await page.waitForFunction(() => document.querySelectorAll('.dsx-pin').length === 1)
        await page.locator('.dsx-pin').click()
        await page.locator('.dsx-review-composer').waitFor({ state: 'visible' })
        await page.getByRole('textbox', { name: 'Comment text' }).fill('Header note edited')
        await browseScreen(page, 'catalog')
        await page.waitForFunction(() => {
          const composer = document.querySelector('.dsx-review-composer')
          return (
            composer !== null &&
            composer.getAttribute('data-anchor') === 'unavailable' &&
            composer.getAttribute('data-detached') === 'screen'
          )
        })
        expect(await page.locator('.dsx-review-pointer').count()).toBe(0)
        expect(await page.getByRole('textbox', { name: 'Comment text' }).inputValue()).toBe('Header note edited')
        expect(await page.locator('.dsx-pin').count()).toBe(0)
        await browseScreen(page, 'checkout')
        await page.waitForFunction(
          () => document.querySelector('.dsx-review-composer')?.getAttribute('data-anchor') === 'available',
        )
        expect(await page.locator('.dsx-review-pointer').count()).toBe(1)
        expect(await page.locator('.dsx-pin').count()).toBe(1)

        // Stable id shared by two screens must not reattach on the other screen.
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => document.querySelector('.dsx-review-composer') === null)
        await page.getByRole('button', { name: 'Comment', exact: true }).click()
        await page.locator('[data-dsx-id="open-filters"]').click()
        await page.getByRole('textbox', { name: 'Comment text' }).fill('Filters note')
        await page.getByRole('button', { name: 'Save comment' }).click()
        await page.waitForFunction(() => document.querySelectorAll('.dsx-pin').length === 2)
        await page.getByRole('button', { name: /Edit comment 2 on Button/ }).click()
        await page.locator('.dsx-review-composer').waitFor({ state: 'visible' })
        await page.getByRole('textbox', { name: 'Comment text' }).fill('Filters note edited')
        await browseScreen(page, 'reconcile')
        await page.waitForFunction(() => {
          const composer = document.querySelector('.dsx-review-composer')
          return (
            composer !== null &&
            composer.getAttribute('data-anchor') === 'unavailable' &&
            composer.getAttribute('data-detached') === 'screen'
          )
        })
        expect(await page.locator('.dsx-review-pointer').count()).toBe(0)
        expect(await page.locator('.dsx-pin').count()).toBe(0)
        expect(await page.getByRole('textbox', { name: 'Comment text' }).inputValue()).toBe('Filters note edited')
        await browseScreen(page, 'checkout')
        await page.waitForFunction(
          () => document.querySelector('.dsx-review-composer')?.getAttribute('data-anchor') === 'available',
        )
        expect(await page.locator('.dsx-review-pointer').count()).toBe(1)
        expect(await page.locator('.dsx-pin').count()).toBe(2)
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'detaches a structural balloon when its address is reused and restores it with the original content',
    async () => {
      current = payload(34, [
        screen('home', homeSource),
        screen('checkout', checkoutSource),
        screen('stated', statedSource, statedStates),
      ])
      const page = await pageAt({ width: 1440, height: 900 }, '/design/session-test/checkout?bp=desktop')
      try {
        await page.getByRole('button', { name: 'Comment', exact: true }).click()
        await page.locator('[data-dsx-type="Header"]').click()
        await page.getByRole('textbox', { name: 'Comment text' }).fill('Structural header note')
        await page.getByRole('button', { name: 'Save comment' }).click()
        await page.waitForFunction(() => document.querySelectorAll('.dsx-pin').length === 1)
        await page.locator('.dsx-pin').click()
        await page.locator('.dsx-review-composer').waitFor({ state: 'visible' })
        await page.getByRole('textbox', { name: 'Comment text' }).fill('Structural header note edited')
        current = payload(35, [
          screen('home', homeSource),
          screen(
            'checkout',
            checkoutSource.replace('<Header title="Checkout" />', '<Header title="Checkout edited" />'),
          ),
          screen('stated', statedSource, statedStates),
        ])
        publish(current)
        await page.waitForFunction(() =>
          document.querySelector('.dsx-frame-inner')?.textContent?.includes('Checkout edited'),
        )
        await page.waitForFunction(() => {
          const composer = document.querySelector('.dsx-review-composer')
          return (
            composer !== null &&
            composer.getAttribute('data-anchor') === 'unavailable' &&
            composer.getAttribute('data-detached') === 'content'
          )
        })
        expect(await page.locator('.dsx-review-pointer').count()).toBe(0)
        expect(await page.getByRole('textbox', { name: 'Comment text' }).inputValue()).toBe(
          'Structural header note edited',
        )
        expect(await page.locator('.dsx-pin').count()).toBe(0)
        current = payload(36, [
          screen('home', homeSource),
          screen('checkout', checkoutSource),
          screen('stated', statedSource, statedStates),
        ])
        publish(current)
        await page.waitForFunction(
          () => !document.querySelector('.dsx-frame-inner')?.textContent?.includes('Checkout edited'),
        )
        await page.waitForFunction(
          () => document.querySelector('.dsx-review-composer')?.getAttribute('data-anchor') === 'available',
        )
        expect(await page.locator('.dsx-review-pointer').count()).toBe(1)
        expect(await page.locator('.dsx-pin').count()).toBe(1)
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'keeps a short native pane editor clear of its target or drops the pointer',
    async () => {
      const shortCheckout = screen(
        'checkout',
        checkoutSource.replace(
          '<Stack id="styled"',
          '<Input id="email" label="Email" placeholder="you@example.com" type="email" /><Stack id="styled"',
        ),
      )
      current = payload(37, [screen('home', homeSource), shortCheckout, screen('stated', statedSource, statedStates)])
      const context = await browser!.newContext({ viewport: { width: 1050, height: 420 } })
      const page = await context.newPage()
      page.on('pageerror', (error) => console.log('short pane error: ' + String(error)))
      page.setDefaultTimeout(10000)
      await page.goto(base + '/__short-pane', { waitUntil: 'domcontentloaded' })
      const frame = page.frameLocator('iframe[title="short pane"]')
      await frame.locator('.dsx-frame').waitFor()
      const geometryOf = (selector: string) =>
        frame.locator('.dsx-frame').evaluate((root, targetSelector) => {
          const document_ = root.ownerDocument
          const box = (element: Element | null) => {
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
          const composer = document_.querySelector('.dsx-review-composer')
          return {
            balloon: box(composer),
            target: box(document_.querySelector(targetSelector)),
            stage: box(document_.querySelector('.dsx-stage')),
            pointers: document_.querySelectorAll('.dsx-review-pointer').length,
            detached: composer?.getAttribute('data-detached') ?? null,
            anchor: composer?.getAttribute('data-anchor') ?? null,
          }
        }, selector)
      const overlaps = (
        balloon: { left: number; right: number; top: number; bottom: number },
        target: { left: number; right: number; top: number; bottom: number },
      ): boolean =>
        balloon.left < target.right &&
        balloon.right > target.left &&
        balloon.top < target.bottom &&
        balloon.bottom > target.top
      try {
        await frame.getByRole('button', { name: 'Comment', exact: true }).click()
        await frame.locator('[data-dsx-type="Header"]').click()
        await frame.locator('.dsx-review-composer').waitFor({ state: 'visible' })
        const header = await geometryOf('[data-dsx-type="Header"]')
        expect(header.pointers, JSON.stringify(header)).toBe(1)
        expect(header.detached).toBeNull()
        expect(header.balloon).not.toBeNull()
        expect(header.target).not.toBeNull()
        expect(overlaps(header.balloon!, header.target!), JSON.stringify(header)).toBe(false)
        await frame.getByRole('textbox', { name: 'Comment text' }).fill('Kept in a short pane')
        await page.evaluate(() => {
          const element = document.querySelector('iframe[title="short pane"]') as HTMLIFrameElement | null
          if (element !== null) element.style.height = '240px'
        })
        await page.waitForFunction(() => {
          const element = document.querySelector('iframe[title="short pane"]') as HTMLIFrameElement | null
          return (
            element?.contentDocument?.querySelector('.dsx-review-composer')?.getAttribute('data-detached') === 'space'
          )
        })
        const short = await geometryOf('[data-dsx-type="Header"]')
        expect(short.pointers).toBe(0)
        expect(short.detached).toBe('space')
        expect(short.anchor).toBe('unavailable')
        expect(await frame.getByRole('textbox', { name: 'Comment text' }).inputValue()).toBe('Kept in a short pane')
        await page.evaluate(() => {
          const element = document.querySelector('iframe[title="short pane"]') as HTMLIFrameElement | null
          if (element !== null) element.style.height = '344px'
        })
        await page.waitForFunction(() => {
          const element = document.querySelector('iframe[title="short pane"]') as HTMLIFrameElement | null
          return (
            element?.contentDocument?.querySelector('.dsx-review-composer')?.getAttribute('data-anchor') === 'available'
          )
        })
        const restored = await geometryOf('[data-dsx-type="Header"]')
        expect(restored.pointers).toBe(1)
        expect(overlaps(restored.balloon!, restored.target!), JSON.stringify(restored)).toBe(false)
        expect(await frame.getByRole('textbox', { name: 'Comment text' }).inputValue()).toBe('Kept in a short pane')
        await page.keyboard.press('Escape')
        await frame.locator('.dsx-review-composer').waitFor({ state: 'detached' })

        await frame.getByRole('button', { name: 'Comment', exact: true }).click()
        await frame.locator('[data-dsx-id="email"]').click()
        await frame.locator('.dsx-review-composer').waitFor({ state: 'visible' })
        const email = await geometryOf('[data-dsx-id="email"]')
        if (email.pointers === 0) {
          expect(email.detached).toBe('space')
          expect(email.anchor).toBe('unavailable')
        } else {
          expect(email.detached).toBeNull()
          expect(email.anchor).toBe('available')
          expect(email.balloon).not.toBeNull()
          expect(email.target).not.toBeNull()
          expect(overlaps(email.balloon!, email.target!), JSON.stringify(email)).toBe(false)
        }
        await frame.getByRole('textbox', { name: 'Comment text' }).fill('Email kept in a short pane')
        await page.evaluate(() => {
          const element = document.querySelector('iframe[title="short pane"]') as HTMLIFrameElement | null
          if (element !== null) element.style.height = '240px'
        })
        await page.waitForFunction(() => {
          const element = document.querySelector('iframe[title="short pane"]') as HTMLIFrameElement | null
          return (
            element?.contentDocument?.querySelector('.dsx-review-composer')?.getAttribute('data-detached') === 'space'
          )
        })
        const emailShort = await geometryOf('[data-dsx-id="email"]')
        expect(emailShort.pointers).toBe(0)
        expect(emailShort.detached).toBe('space')
        expect(await frame.getByRole('textbox', { name: 'Comment text' }).inputValue()).toBe(
          'Email kept in a short pane',
        )
      } finally {
        await context.close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'keeps structural pins through an idle revision reset and drops them when same-address content is edited',
    async () => {
      const checkout = screen('checkout', checkoutSource)
      const fingerprint = fingerprintDesignTree(checkout.root!)
      current = payload(40, [screen('home', homeSource), checkout, screen('stated', statedSource, statedStates)])
      comments = [
        {
          id: 'stable-comment',
          revision: 1,
          text: 'Filter note',
          anchor: { id: 'open-filters', kind: 'stable', type: 'Button', revision: 40 },
          context: { screen: 'checkout', breakpoint: 'desktop', overlays: [], tabs: {} },
          createdAt: 1,
          updatedAt: 1,
        },
      ]
      const page = await pageAt({ width: 1440, height: 900 }, '/design/session-test/checkout?bp=desktop')
      try {
        await page.waitForFunction(() => document.querySelectorAll('.dsx-pin').length === 1)
        // Create the structural draft through the ordinary review flow.
        await page.getByRole('button', { name: 'Comment', exact: true }).click()
        await page.locator('[data-dsx-type="Header"]').click()
        await page.getByRole('textbox', { name: 'Comment text' }).fill('Header note')
        await page.getByRole('button', { name: 'Save comment' }).click()
        await page.waitForFunction(() => document.querySelectorAll('.dsx-pin').length === 2)
        const created = comments.find((draft) => draft.id !== 'stable-comment')
        expect(created?.anchor.fingerprint).toBe(fingerprint)
        // A recreated runtime counts from revision 1 again; the unchanged content
        // fingerprint must keep the structural pin.
        current = payload(1, [screen('home', homeSource), checkout, screen('stated', statedSource, statedStates)])
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForSelector('.dsx-frame')
        await page.waitForFunction(() => document.querySelectorAll('.dsx-pin').length === 2)
        const edited = screen(
          'checkout',
          checkoutSource.replace('<Header title="Checkout" />', '<Header title="Checkout edited" />'),
        )
        current = payload(2, [screen('home', homeSource), edited, screen('stated', statedSource, statedStates)])
        publish(current)
        await page.waitForFunction(() => document.querySelectorAll('.dsx-pin').length === 1)
        await page.getByRole('button', { name: /Pending \(2\)/ }).click()
        await page.getByText('content changed').waitFor({ state: 'visible' })
        expect(await page.getByText('unanchored').count()).toBe(0)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForSelector('.dsx-frame')
        await page.waitForFunction(() => document.querySelectorAll('.dsx-pin').length === 1)
        await page.getByRole('button', { name: /Pending \(2\)/ }).click()
        await page.getByText('content changed').waitFor({ state: 'visible' })
        expect(await page.locator('.dsx-pin').count()).toBe(1)
      } finally {
        await page.context().close()
      }
    },
  )

  it.skipIf(chromiumPath === undefined)('does not pin a comment whose target is hidden', async () => {
    current = payload(50, [
      screen(
        'home',
        '<Screen id="home" title="Home"><Stack gap="spacing.md"><Box id="hidden" css="display: none"><Text>Hidden text</Text></Box><Text>Visible text</Text></Stack></Screen>',
      ),
    ])
    comments = [
      {
        id: 'hidden-comment',
        revision: 1,
        text: 'Hidden note',
        anchor: { id: 'hidden', kind: 'stable', type: 'Box', revision: 50 },
        context: { screen: 'home', breakpoint: 'desktop', overlays: [], tabs: {} },
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    const page = await pageAt({ width: 1440, height: 900 }, '/design/session-test/')
    try {
      await page.getByText('Visible text').waitFor({ state: 'visible' })
      expect(await page.locator('.dsx-pin').count()).toBe(0)
      await page.getByRole('button', { name: /Pending \(1\)/ }).click()
      await page.getByText('unanchored').waitFor({ state: 'visible' })
    } finally {
      await page.context().close()
    }
  })

  it.skipIf(chromiumPath === undefined)(
    'serves a self-contained deterministic document with no further requests',
    async () => {
      current = allScreens(20)
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
        await first.page.evaluate(() => {
          history.pushState(null, '', '/design/session-test/home?bp=desktop&deterministic=1')
          dispatchEvent(new PopStateEvent('popstate'))
        })
        await first.page.waitForURL('**/design/session-test/home?bp=desktop&deterministic=1')
        await first.page.evaluate(() => {
          history.pushState(null, '', '/design/session-test/checkout?bp=desktop&deterministic=1')
          dispatchEvent(new PopStateEvent('popstate'))
        })
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
  describe('real browser variant comparison', () => {
    it.skipIf(chromiumPath === undefined)(
      'keeps exact widths, isolated interaction and focus, and keyboard scrolling at desktop width',
      async () => {
        variantDemoSource = variantDemoSource.replace('Compact pane edited', 'Compact pane')
        current = payload(30, [variantDemoScreen('compact')])
        const page = await comparePageAt(
          { width: 1440, height: 900 },
          '/design/session-test/variant-demo?compare=layout:compact:spacious&bp=desktop',
        )
        try {
          await page.locator('iframe[data-dsx-pane="left"]').waitFor({ state: 'visible' })
          await page.locator('iframe[data-dsx-pane="right"]').waitFor({ state: 'visible' })
          const left = page.frameLocator('iframe[data-dsx-pane="left"]')
          const right = page.frameLocator('iframe[data-dsx-pane="right"]')
          await left.locator('.dsx-frame').waitFor()
          await right.locator('.dsx-frame').waitFor()
          await left.getByText('Compact pane').waitFor()
          await right.getByText('Spacious pane').waitFor()
          expect(await left.locator('.dsx-frame').evaluate((element) => element.getBoundingClientRect().width)).toBe(
            1280,
          )
          expect(await right.locator('.dsx-frame').evaluate((element) => element.getBoundingClientRect().width)).toBe(
            1280,
          )
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)

          await left.getByRole('button', { name: 'Open' }).click()
          await left.getByText('Compact drawer').waitFor({ state: 'visible' })
          await page.waitForTimeout(150)
          expect(await right.getByText('Spacious drawer').count()).toBe(0)
          const leftFrame = page.frames().find((frame) => frame.url().includes('pane=left'))
          expect(leftFrame).toBeDefined()
          const leftFocus = await leftFrame!.evaluate(
            () =>
              document.activeElement?.closest('[role="dialog"]') !== null ||
              document.activeElement?.closest('[data-dsx-id="filters"]') !== null,
          )
          expect(leftFocus).toBe(true)
          await leftFrame!.evaluate(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          })
          await page.waitForTimeout(150)

          await right.locator('[data-dsx-id="name"] input').fill('Only right')
          expect(await left.locator('[data-dsx-id="name"] input').inputValue()).toBe('')

          const scroller = page.locator('.dsx-compare-scroll')
          await scroller.focus()
          const dimensions = await scroller.evaluate((element) => ({
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
          }))
          expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth)
          await scroller.press('ArrowRight')
          await scroller.press('ArrowRight')
          await page.waitForTimeout(200)
          expect(await scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
        } finally {
          await page.context().close()
        }
      },
    )

    it.skipIf(chromiumPath === undefined)(
      'stays side by side with internal scrolling at 390 CSS pixels and restores history',
      async () => {
        variantDemoSource = variantDemoSource.replace('Compact pane edited', 'Compact pane')
        current = payload(31, [variantDemoScreen('compact')])
        const page = await comparePageAt(
          { width: 390, height: 844 },
          '/design/session-test/variant-demo?compare=layout:compact:spacious&bp=mobile',
        )
        try {
          await page.locator('iframe[data-dsx-pane="left"]').waitFor({ state: 'visible' })
          const left = page.frameLocator('iframe[data-dsx-pane="left"]')
          const right = page.frameLocator('iframe[data-dsx-pane="right"]')
          await left.locator('.dsx-frame').waitFor()
          await right.locator('.dsx-frame').waitFor()
          expect(await left.locator('.dsx-frame').evaluate((element) => element.getBoundingClientRect().width)).toBe(
            390,
          )
          expect(await right.locator('.dsx-frame').evaluate((element) => element.getBoundingClientRect().width)).toBe(
            390,
          )
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
          const scroller = page.locator('.dsx-compare-scroll')
          expect(await scroller.evaluate((element) => element.clientWidth)).toBeLessThanOrEqual(390)
          expect(await scroller.evaluate((element) => element.scrollWidth)).toBeGreaterThan(390)
          await scroller.press('ArrowRight')
          await scroller.press('ArrowRight')
          await page.waitForTimeout(150)
          expect(await scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)

          await page.getByLabel('Right branch').selectOption('compact')
          await page.waitForFunction(
            () => new URLSearchParams(window.location.search).get('compare') === 'layout:compact:compact',
          )
          await page.evaluate(() => history.back())
          await page.waitForTimeout(500)
          await page.waitForFunction(
            () => new URLSearchParams(window.location.search).get('compare') === 'layout:compact:spacious',
          )
          await left.locator('.dsx-frame').waitFor()
          expect(await left.getByText('Compact pane').count()).toBe(1)
        } finally {
          await page.context().close()
        }
      },
    )

    it.skipIf(chromiumPath === undefined)('keeps a deterministic comparison one self-contained canvas', async () => {
      variantDemoSource = variantDemoSource.replace('Compact pane edited', 'Compact pane')
      current = payload(34, [variantDemoScreen('compact')])
      const page = await pageAt(
        { width: 390, height: 844 },
        '/design/session-test/variant-demo?compare=layout:compact:spacious&bp=mobile&deterministic=1',
      )
      try {
        await page.getByText('Compact pane').waitFor()
        expect(await page.locator('.dsx-compare').count()).toBe(0)
        expect((page as Page & { requests: string[] }).requests).toHaveLength(1)
      } finally {
        await page.context().close()
      }
    })

    it.skipIf(chromiumPath === undefined)(
      'resets both panes to the parent screen when a shared control changes after in-pane navigation',
      async () => {
        variantDemoBroken = undefined
        current = payload(60, [variantDemoScreen('compact'), otherVariantScreen()])
        const page = await comparePageAt(
          { width: 1440, height: 900 },
          '/design/session-test/variant-demo?compare=layout:compact:spacious&bp=desktop',
        )
        try {
          const left = page.frameLocator('iframe[data-dsx-pane="left"]')
          const right = page.frameLocator('iframe[data-dsx-pane="right"]')
          await left.getByText('Compact pane').waitFor()
          await right.getByText('Spacious pane').waitFor()
          await left.locator('[data-dsx-id="name"] input').fill('kept before navigation')
          await left.getByRole('button', { name: 'Go other' }).click()
          await left.getByText('Other screen').waitFor()
          const navigated = page.frames().find((frame) => frame.url().includes('pane=left'))
          expect(navigated?.url()).toContain('/design/session-test/other')
          await page.getByLabel('Right branch').selectOption('compact')
          await page.waitForFunction(
            () => new URLSearchParams(window.location.search).get('compare') === 'layout:compact:compact',
          )
          await left.getByText('Compact pane').waitFor()
          await page.waitForTimeout(300)
          expect(await left.locator('[data-dsx-id="name"] input').inputValue()).toBe('')
          const reset = page.frames().find((frame) => frame.url().includes('pane=left'))
          expect(reset?.url()).toContain('/design/session-test/variant-demo')

          await page.evaluate(() => history.back())
          await page.waitForFunction(
            () => new URLSearchParams(window.location.search).get('compare') === 'layout:compact:spacious',
          )
          await page.waitForTimeout(300)
          await left.getByText('Compact pane').waitFor()
          await right.getByText('Spacious pane').waitFor()
        } finally {
          await page.context().close()
        }
      },
    )

    it.skipIf(chromiumPath === undefined)(
      'preserves compatible pane interaction through a valid revision refresh',
      async () => {
        variantDemoBroken = undefined
        current = payload(61, [variantDemoScreen('compact')])
        const page = await comparePageAt(
          { width: 1440, height: 900 },
          '/design/session-test/variant-demo?compare=layout:compact:spacious&bp=desktop',
        )
        try {
          const left = page.frameLocator('iframe[data-dsx-pane="left"]')
          await left.getByText('Compact pane').waitFor()
          await left.getByRole('button', { name: 'Open' }).click()
          await left.getByText('Compact drawer').waitFor({ state: 'visible' })
          await left.locator('[data-dsx-id="name"] input').fill('preserved')
          publish({ ...current, revision: 62 })
          await page.waitForTimeout(1500)
          expect(await left.getByText('Compact drawer').count()).toBe(1)
          expect(await left.locator('[data-dsx-id="name"] input').inputValue()).toBe('preserved')
        } finally {
          await page.context().close()
        }
      },
    )

    it.skipIf(chromiumPath === undefined)(
      'keeps the last valid comparison pane through an invalid alternate edit and recovers in place',
      async () => {
        variantDemoBroken = undefined
        current = payload(63, [variantDemoScreen('compact')])
        const page = await comparePageAt(
          { width: 1440, height: 900 },
          '/design/session-test/variant-demo?compare=layout:compact:spacious&bp=desktop',
        )
        try {
          const right = page.frameLocator('iframe[data-dsx-pane="right"]')
          await right.getByText('Spacious pane').waitFor()
          const compareUrl = page.url()
          variantDemoBroken = 'stale'
          current = payload(64, [variantDemoScreen('compact')])
          publish(current)
          await page.getByText('last valid · diagnostics').waitFor()
          await right.getByText('Spacious pane').waitFor()
          expect(await page.locator('iframe[data-dsx-pane="right"]').count()).toBe(1)
          variantDemoSource = variantDemoSource.replace('Spacious pane', 'Spacious recovered')
          variantDemoBroken = undefined
          current = payload(65, [variantDemoScreen('compact')])
          publish(current)
          await right.getByText('Spacious recovered').waitFor({ timeout: 10000 })
          expect(page.url()).toBe(compareUrl)
        } finally {
          await page.context().close()
        }
      },
    )

    it.skipIf(chromiumPath === undefined)(
      'mounts a repaired comparison pane that started without a prior snapshot',
      async () => {
        variantDemoBroken = 'none'
        current = payload(66, [variantDemoScreen('compact')])
        const page = await comparePageAt(
          { width: 1440, height: 900 },
          '/design/session-test/variant-demo?compare=layout:compact:spacious&bp=desktop',
        )
        try {
          await page.getByText('Branch unavailable').waitFor()
          expect(await page.locator('iframe[data-dsx-pane="right"]').count()).toBe(0)
          const compareUrl = page.url()
          variantDemoBroken = undefined
          current = payload(67, [variantDemoScreen('compact')])
          publish(current)
          const right = page.frameLocator('iframe[data-dsx-pane="right"]')
          await right.getByText('Spacious pane').waitFor({ timeout: 10000 })
          expect(page.url()).toBe(compareUrl)
        } finally {
          await page.context().close()
        }
      },
    )

    it.skipIf(chromiumPath === undefined)('live reloads both panes from the same starting selection', async () => {
      variantDemoSource = variantDemoSource.replace('Compact pane edited', 'Compact pane')
      current = payload(32, [variantDemoScreen('compact')])
      const page = await comparePageAt(
        { width: 1440, height: 900 },
        '/design/session-test/variant-demo?compare=layout:compact:spacious&bp=desktop',
      )
      try {
        const left = page.frameLocator('iframe[data-dsx-pane="left"]')
        await left.getByText('Compact pane').waitFor()
        variantDemoSource = variantDemoSource.replace('Compact pane', 'Compact pane edited')
        publish({ ...current, revision: 33 })
        await left.getByText('Compact pane edited').waitFor({ timeout: 10000 })
        const right = page.frameLocator('iframe[data-dsx-pane="right"]')
        expect(await right.getByText('Spacious pane').count()).toBe(1)
      } finally {
        await page.context().close()
      }
    })
  })
})
