/** Exercise live previews over Chromium's real HTTP/1.1 connection pool. */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page, type Request } from 'playwright-core'
import { expect, it } from 'vitest'
import { findChromium } from '../../host/tests/chromium.ts'
import { ProjectRegistry } from '../../host/src/registry.ts'
import { createRouteHandler } from '../../host/src/routes.ts'
import { KIT_VERSION, kitMetadata } from '../../kit/src/meta.ts'

const executablePath = await findChromium()
const assets = fileURLToPath(new URL('../dist/', import.meta.url))
const preview = '/design/concurrency/home'
const revisionPath = '/design/concurrency/_/revision'
const projectPath = '/design/concurrency/_/project'
const previewDocuments = 6

function screen(label: string): string {
  return (
    '<Screen id="home" title="Home"><Stack gap="spacing.md">' +
    '<Input id="name" label="Name" /><Button id="action">' +
    label +
    '</Button></Stack></Screen>\n'
  )
}

it.skipIf(executablePath === undefined)(
  'keeps HTTP/1.1 available with six live previews and catches up on visibility return',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsx-preview-concurrency-'))
    const design = join(root, 'design')
    const source = join(design, 'screens', 'home.dsx')
    let origin = ''
    const registry = new ProjectRegistry({
      folderName: 'design',
      kitVersion: KIT_VERSION,
      installedKitVersion: KIT_VERSION,
      kit: kitMetadata,
      resolveSessionCwd: () => root,
      origin: () => origin,
      idleStopMs: 1500,
    })
    const route = createRouteHandler(registry, assets)
    const versions = new Set<string>()
    const active = new Map<number, number>()
    const completed: number[] = []
    const eventStreams: string[] = []
    let revisionSerial = 0
    const scriptPath = '/design/concurrency/_/assets/app.js'
    let legacyScriptRequests = 0
    const server = createServer((req, res) => {
      versions.add(req.httpVersion)
      if (req.url === '/legacy-panel') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<iframe title="Legacy preview" src="/legacy-preview"></iframe>')
        return
      }
      if (req.url === '/legacy-preview') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<script type="module" src="' + scriptPath + '"></script>')
        return
      }
      if (req.url === scriptPath) {
        legacyScriptRequests++
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=3600' })
        res.end('document.body.textContent = "Legacy renderer"')
        return
      }
      if (req.url === '/panel') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(
          '<a target="_blank" rel="noopener" href="' +
            preview +
            '">Open in tab</a>' +
            '<iframe title="Design preview" src="' +
            preview +
            '" width="1000" height="700"></iframe>',
        )
        return
      }
      if (req.url === '/control') {
        res.setHeader('cache-control', 'no-store')
        res.end('ready')
        return
      }
      if (req.url === revisionPath) {
        const id = ++revisionSerial
        const start = performance.now()
        active.set(id, start)
        res.once('finish', () => {
          completed.push(performance.now() - start)
          active.delete(id)
        })
        res.once('close', () => active.delete(id))
      }
      if (req.headers.accept === 'text/event-stream' || req.url?.endsWith('/_/events')) eventStreams.push(req.url ?? '')
      void route(req, res, { principal: { kind: 'owner' } }).catch((error: unknown) => res.destroy(error as Error))
    })
    let browser: Browser | undefined
    try {
      await mkdir(join(design, 'screens'), { recursive: true })
      await writeFile(join(design, 'design.json'), JSON.stringify({ kitVersion: KIT_VERSION, entry: 'home' }))
      await writeFile(
        join(design, 'tokens.json'),
        JSON.stringify({ spacing: { md: { $value: '16px', $type: 'dimension' } } }),
      )
      await writeFile(source, screen('Original action'))
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      origin = 'http://127.0.0.1:' + String((server.address() as { port: number }).port)
      browser = await chromium.launch({ executablePath, chromiumSandbox: true })
      const context = await browser.newContext({ serviceWorkers: 'block' })
      context.setDefaultTimeout(5000)
      const projectRequests: Request[] = []
      const revisions: Request[] = []
      context.on('request', (request) => {
        const { pathname } = new URL(request.url())
        if (pathname === projectPath) projectRequests.push(request)
      })
      context.on('requestfinished', (request) => {
        if (new URL(request.url()).pathname === revisionPath) revisions.push(request)
      })
      const panel = await context.newPage()
      await panel.goto(origin + '/legacy-panel')
      await panel.frameLocator('iframe').getByText('Legacy renderer').waitFor()
      expect(legacyScriptRequests).toBe(1)
      await panel.goto(origin + '/panel')
      const embedded = panel.frameLocator('iframe[title="Design preview"]')
      await embedded.getByRole('button', { name: 'Original action' }).waitFor()
      const [standalone] = await Promise.all([
        context.waitForEvent('page'),
        panel.getByRole('link', { name: 'Open in tab' }).click(),
      ])
      await standalone.getByRole('button', { name: 'Original action' }).waitFor()
      expect(await standalone.locator('script[type="module"]').getAttribute('src')).toContain(scriptPath + '?build=')
      expect(legacyScriptRequests).toBe(1)
      const tabs: Page[] = [standalone]
      for (let count = 2; count < previewDocuments; count++) {
        const tab = await context.newPage()
        await tab.goto(origin + preview)
        await tab.getByRole('button', { name: 'Original action' }).waitFor()
        tabs.push(tab)
      }
      await panel.bringToFront()
      const control = await panel.evaluate(async () => {
        const response = await fetch('/control', { signal: AbortSignal.timeout(1000) })
        return { status: response.status, body: await response.text() }
      })
      expect(control).toEqual({ status: 200, body: 'ready' })
      expect([...versions]).toEqual(['1.1'])
      expect(eventStreams).toEqual([])
      // Require at least three completed checks with an unchanged constant token.
      // A one-off startup fetch cannot satisfy this, nor can a hung/long-polled response.
      const beforeIdle = projectRequests.length
      const beforeRevisions = revisions.length
      await expect.poll(() => revisions.length, { timeout: 2400 }).toBeGreaterThanOrEqual(beforeRevisions + 3)
      expect(projectRequests).toHaveLength(beforeIdle)
      const idleResponses = await Promise.all(
        revisions.slice(beforeRevisions).map(async (request) => (await request.response())?.json()),
      )
      expect(idleResponses[0]).toEqual({ token: expect.any(String) })
      expect(new Set(idleResponses.map((response) => response?.token)).size).toBe(1)
      expect(Math.max(...completed)).toBeLessThan(1000)
      const idleHeaders = await Promise.all(
        revisions
          .slice(beforeRevisions)
          .map(async (request) => (await request.response())?.headerValue('content-type')),
      )
      expect(idleHeaders.every((header) => header?.startsWith('application/json'))).toBe(true)
      expect([...active.values()].some((started) => performance.now() - started >= 1000)).toBe(false)

      await standalone.getByRole('textbox', { name: 'Name' }).fill('Saved across visibility changes')
      await panel.bringToFront()
      // Headless Chromium can report all tabs visible. Drive the visibility input in
      // that case, without stubbing any timers, requests, watcher, or renderer behavior.
      const emulatedVisibility = await standalone.evaluate(() => {
        if (document.hidden) return false
        Object.defineProperties(document, {
          visibilityState: { configurable: true, value: 'hidden' },
          hidden: { configurable: true, value: true },
        })
        document.dispatchEvent(new Event('visibilitychange'))
        return true
      })
      expect(await standalone.evaluate(() => document.visibilityState)).toBe('hidden')
      expect(
        await embedded.getByRole('button', { name: 'Original action' }).evaluate(() => document.visibilityState),
      ).toBe('visible')
      const started = performance.now()
      await writeFile(source, screen('New action'))
      await embedded.getByRole('button', { name: 'New action' }).waitFor({ timeout: 1000 })
      expect(performance.now() - started).toBeLessThanOrEqual(1000)
      expect(await standalone.getByRole('button', { name: 'Original action' }).count()).toBe(1)
      expect(projectRequests.slice(beforeIdle).some((request) => request.frame().page() === standalone)).toBe(false)

      await standalone.bringToFront()
      if (emulatedVisibility) {
        await standalone.evaluate(() => {
          Reflect.deleteProperty(document, 'visibilityState')
          Reflect.deleteProperty(document, 'hidden')
          document.dispatchEvent(new Event('visibilitychange'))
        })
      }
      expect(await standalone.evaluate(() => document.visibilityState)).toBe('visible')
      await standalone.getByRole('button', { name: 'New action' }).waitFor({ timeout: 1000 })
      expect(await standalone.getByRole('textbox', { name: 'Name' }).inputValue()).toBe(
        'Saved across visibility changes',
      )
      expect(context.pages()).toEqual([panel, ...tabs])
      expect(eventStreams).toEqual([])

      // Hidden tabs do not renew the lease. After all other previews close,
      // an invalid edit must not discard this tab's last valid canvas or input.
      await standalone.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await Promise.all([panel.close(), ...tabs.slice(1).map((tab) => tab.close())])
      await expect.poll(() => registry.size, { timeout: 4000 }).toBe(0)
      await writeFile(source, '<Screen id="home"><Text>Unclosed')
      await standalone.evaluate(() => {
        Reflect.deleteProperty(document, 'visibilityState')
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await standalone.getByText(/Showing the last valid render/).waitFor({ timeout: 1000 })
      expect(await standalone.getByRole('button', { name: 'New action' }).count()).toBe(1)
      expect(await standalone.getByRole('textbox', { name: 'Name' }).inputValue()).toBe(
        'Saved across visibility changes',
      )
      await writeFile(source, screen('Repaired action'))
      await standalone.getByRole('button', { name: 'Repaired action' }).waitFor({ timeout: 1000 })
      expect(await standalone.getByText(/Showing the last valid render/).count()).toBe(0)
      expect(await standalone.getByRole('textbox', { name: 'Name' }).inputValue()).toBe(
        'Saved across visibility changes',
      )
    } finally {
      await browser?.close()
      registry.dispose()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
  20_000,
)
