import { createServer, type Server } from 'node:http'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { chromium } from 'playwright-core'
import { scaffoldProject } from '@filipeesch/dsh-design-core'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { chromiumLaunchOptions } from '../src/browser.ts'
import { buildPayload, type InteractivePreviewPayload } from '../src/payload.ts'
import { ProjectRegistry } from '../src/registry.ts'
import { createRouteHandler } from '../src/routes.ts'
import { changedFiles } from '../src/runtime.ts'

const assetsDir = fileURLToPath(new URL('../../renderer/dist/', import.meta.url))
const browsers = [process.env.DSH_DESIGN_CHROMIUM_PATH, process.env.PLAYWRIGHT_CHROMIUM_PATH, chromium.executablePath()]
const chromiumPath = (
  await Promise.all(
    browsers.map(async (path) =>
      path === undefined
        ? undefined
        : await access(path).then(
            () => path,
            () => undefined,
          ),
    ),
  )
).find(Boolean)
const resources: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of resources.splice(0).reverse()) await cleanup()
})

async function preview() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preview-payload-'))
  resources.push(async () => await rm(root, { recursive: true, force: true }))
  const folder = join(root, 'design')
  await scaffoldProject(root, { kitVersion: KIT_VERSION })
  const registry = new ProjectRegistry({
    folderName: 'design',
    kitVersion: KIT_VERSION,
    kit: kitMetadata,
    installedKitVersion: KIT_VERSION,
    resolveSessionCwd: () => root,
    origin: () => origin,
  })
  const route = createRouteHandler(registry, assetsDir)
  const server = createServer((req, res) => void route(req, res, { principal: { kind: 'owner' } }))
  resources.push(async () => {
    registry.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  await listen(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No preview port')
  const origin = 'http://127.0.0.1:' + address.port
  const url = origin + '/design/preview-test/'
  const project = async (query = ''): Promise<InteractivePreviewPayload> => {
    const response = await fetch(url + '_/project' + query)
    expect(response.status).toBe(200)
    return (await response.json()) as InteractivePreviewPayload
  }
  return { folder, runtime: () => registry.forFolder(folder), project, url }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
}

const variants =
  '<Screen id="home"><Variants id="layout" chosen="main"><Variant branch="main"><Button id="go" onPress={navigate("orders")}>Show orders</Button></Variant><Variant branch="alternate"><Button id="go" onPress={navigate("settings")}>Open settings</Button></Variant></Variants></Screen>'

describe('interactive project metadata', () => {
  it('projects only the selected screen and keeps compact labels, diagnostics, and last-valid data', async () => {
    const server = await preview()
    const ordersFile = join(server.folder, 'screens', 'orders.dsx')
    await writeFile(
      ordersFile,
      '<Screen id="orders" title="  Order history  " states={{ open: { disclosures: { details: true } } }}><Disclosure id="details" label="Details"><Text>Orders canvas</Text></Disclosure></Screen>',
    )
    await writeFile(join(server.folder, 'screens', 'untitled.dsx'), '<Screen id="untitled" title="   " />')
    const chosen = await server.project()
    expect(chosen.token).toEqual(expect.any(String))
    expect(chosen.projectedScreen).toBe('home')
    expect(chosen.screens[0]).toHaveProperty('root')
    const ordersSummary = {
      id: 'orders',
      file: 'screens/orders.dsx',
      title: '  Order history  ',
      diagnostics: [],
      errors: 0,
      blockingErrors: 0,
      warnings: 0,
    }
    expect(chosen.screens[1]).toEqual(ordersSummary)
    expect(chosen.screens[2]).not.toHaveProperty('title')
    expect(JSON.stringify(chosen)).not.toContain('Orders canvas')

    const orders = await server.project('?screen=orders')
    expect(orders.token).toBe(chosen.token)
    expect(orders.projectedScreen).toBe('orders')
    expect(orders.screens[0]).not.toHaveProperty('root')
    expect(orders.screens[0]).not.toHaveProperty('states')
    expect(orders.screens[0]).not.toHaveProperty('variants')
    expect(orders.screens[1]).toMatchObject({
      ...ordersSummary,
      root: expect.any(Object),
      states: [{ name: 'open' }],
      variants: [],
    })
    const unknown = await server.project('?screen=missing')
    expect(unknown.projectedScreen).toBe('home')
    expect(unknown.variantError).toBeUndefined()
    const unknownVariant = await server.project('?screen=missing&variant=layout:alternate')
    expect(unknownVariant.projectedScreen).toBeUndefined()
    expect(unknownVariant.variantError).toBe('Screen "missing" is not part of this project.')
    expect(unknownVariant.screens.every((screen) => !Object.hasOwn(screen as object, 'root'))).toBe(true)

    await writeFile(ordersFile, '<Screen id="orders" title="Broken title"><Buton /></Screen>')
    await server.runtime().reload()
    const invalid = await server.project('?screen=orders')
    expect(invalid.token).not.toBe(chosen.token)
    expect(invalid.screens[1]).not.toHaveProperty('root')
    expect(invalid.screens[1]).toMatchObject({
      title: '  Order history  ',
      blockingErrors: 1,
      lastValidRoot: expect.any(Object),
    })
    const unselected = (await server.project()).screens[1]
    expect(unselected).toMatchObject({ title: '  Order history  ', blockingErrors: 1, diagnostics: expect.any(Array) })
    expect(unselected).not.toHaveProperty('lastValidRoot')
    expect(unselected).not.toHaveProperty('states')

    // The deterministic contract neither stamps nor narrows its screens.
    const runtime = server.runtime()
    const deterministic = buildPayload('preview-test', 0, KIT_VERSION, await runtime.get())
    expect(deterministic).not.toHaveProperty('token')
    expect(deterministic).not.toHaveProperty('projectedScreen')
    expect(deterministic.screens[2]).toHaveProperty('root')
  })
  it('replaces only the explicitly viewed screen’s graph and omits stale branch links', async () => {
    const server = await preview()
    const file = join(server.folder, 'screens', 'home.dsx')
    await writeFile(file, variants)
    await writeFile(
      join(server.folder, 'screens', 'orders.dsx'),
      '<Screen id="orders"><Button id="back" onPress={navigate("home")}>Back home</Button></Screen>',
    )
    await writeFile(join(server.folder, 'screens', 'settings.dsx'), '<Screen id="settings" />')
    const chosen = await server.project()
    expect(chosen.preview).toBeUndefined()
    expect(chosen.relationships).toMatchObject([
      { label: 'Show orders', from: { screen: 'home' }, to: { screen: 'orders' } },
      { label: 'Back home', from: { screen: 'orders' }, to: { screen: 'home' } },
    ])
    const query = '?screen=home&variant=layout:alternate'
    const alternate = await server.project(query)
    expect(alternate.projectedScreen).toBe('home')
    expect(alternate.screens[0]).toMatchObject({ variant: { path: 'layout', branch: 'alternate' } })
    expect(alternate.screens[1]).not.toHaveProperty('root')
    expect(alternate.relationships).toMatchObject([
      { id: chosen.relationships[0]?.id, label: 'Open settings', from: { screen: 'home' }, to: { screen: 'settings' } },
      chosen.relationships[1],
    ])
    expect((await server.project()).relationships).toEqual(chosen.relationships)
    const unknown = await server.project('?screen=home&variant=layout:missing')
    expect(unknown.variantError).toContain('missing')
    expect(unknown.relationships).toEqual([chosen.relationships[1]])
    await writeFile(file, variants.replace('navigate("settings")', 'navigate("removed")'))
    await server.runtime().reload()
    const stale = await server.project(query)
    expect(stale.screens[0]).toMatchObject({ variantStale: true })
    expect(stale.relationships).toEqual([chosen.relationships[1]])
    expect((await server.project()).relationships).toEqual(chosen.relationships)
  })

  it('publishes recoverable preview diagnostics and excludes metadata from deterministic data', async () => {
    const server = await preview()
    const runtime = server.runtime()
    const before = await runtime.fingerprint()
    const starting = await runtime.get()
    const canvas = buildPayload('preview-test', 0, KIT_VERSION, starting)
    await writeFile(
      join(server.folder, 'preview.json'),
      '{"screens":{"home":{"summary":"A review summary"},"missing":{"summary":"Removed"}}}',
    )
    const loaded = await runtime.reload()
    expect(changedFiles(before, await runtime.fingerprint())).toEqual(['preview.json'])
    const payload = await server.project()
    expect(payload.preview?.screens).toEqual({ home: { summary: 'A review summary' } })
    expect(payload.projectError).toBeUndefined()
    expect(payload.diagnostics).toContainEqual(
      expect.objectContaining({ file: 'preview.json', code: 'preview-screen' }),
    )
    expect(buildPayload('preview-test', 0, KIT_VERSION, loaded)).toEqual(canvas)
  })

  it.skipIf(chromiumPath === undefined)(
    'moves focus to a simulated outcome after leaving an explicit variant',
    async () => {
      const server = await preview()
      await writeFile(
        join(server.folder, 'screens', 'home.dsx'),
        '<Screen id="home" title="Start"><Variants id="layout" chosen="main"><Variant branch="main"><Text>Initial canvas</Text></Variant><Variant branch="alternate"><Text>Alternate canvas</Text></Variant></Variants></Screen>',
      )
      await writeFile(
        join(server.folder, 'screens', 'result.dsx'),
        '<Screen id="result" title="Review complete" states={{ approved: { disclosures: { details: true } } }}><Disclosure id="details" label="Result details"><Text>Result canvas</Text></Disclosure></Screen>',
      )
      await writeFile(
        join(server.folder, 'preview.json'),
        JSON.stringify({
          situations: [
            {
              id: 'approved-review',
              parent: 'result',
              label: 'Approved review',
              target: { screen: 'result', state: 'approved' },
            },
          ],
          relationships: [
            {
              id: 'finish',
              label: 'Approve',
              kind: 'simulated',
              from: { screen: 'home' },
              to: { situation: 'approved-review' },
            },
          ],
        }),
      )
      const browser = await chromium.launch(chromiumLaunchOptions(chromiumPath))
      resources.push(async () => await browser.close())
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.goto(server.url + 'home?bp=mobile&variant=layout:alternate')
      await page.getByText('Alternate canvas').waitFor()
      const projectionReload = Promise.withResolvers<void>()
      await page.route(
        (url) => url.pathname.endsWith('/_/project') && url.searchParams.get('screen') === 'result',
        async (route) => {
          await projectionReload.promise
          await route.continue()
        },
      )
      await page.getByRole('button', { name: 'Approve' }).press('Enter')
      try {
        await page.getByText('Loading preview…').waitFor({ timeout: 5000 })
      } finally {
        projectionReload.resolve()
      }
      await page.getByText('Result canvas').waitFor()
      expect(new URL(page.url()).search).toBe('?bp=mobile&state=approved&situation=approved-review')
      expect(await page.getByRole('button', { name: 'Result details' }).getAttribute('aria-expanded')).toBe('true')
      await page
        .getByRole('heading', { name: /Review complete.*Approved review/ })
        .and(page.locator(':focus'))
        .waitFor({ timeout: 5000 })
    },
  )

  it.skipIf(chromiumPath === undefined)('updates an open flow map when the declared target changes', async () => {
    const server = await preview()
    const source = join(server.folder, 'screens', 'home.dsx')
    const home = (target: string) =>
      '<Screen id="home" title="Start"><Button id="continue" onPress={navigate("' +
      target +
      '")}>Continue</Button></Screen>'
    await writeFile(join(server.folder, 'screens', 'orders.dsx'), '<Screen id="orders" title="Order history" />')
    await writeFile(join(server.folder, 'screens', 'settings.dsx'), '<Screen id="settings" title="Account settings" />')
    await writeFile(source, home('orders'))
    const browser = await chromium.launch(chromiumLaunchOptions(chromiumPath))
    resources.push(async () => await browser.close())
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(server.url + 'home?bp=mobile')
    await page.getByRole('button', { name: 'Flow map' }).click()
    const map = page.getByRole('dialog', { name: 'Flow map' })
    await map.getByRole('link', { name: 'Order history' }).waitFor()
    await writeFile(source, home('settings'))
    await map.getByRole('link', { name: 'Account settings' }).waitFor({ timeout: 5000 })
    expect(await map.getByRole('link', { name: 'Order history' }).count()).toBe(0)
    expect(await map.getByText('Start → Account settings').count()).toBe(1)
  })

  it.skipIf(chromiumPath === undefined)(
    'updates context through the real watcher without resetting canvas geometry or edited state',
    async () => {
      const server = await preview()
      await writeFile(
        join(server.folder, 'screens', 'home.dsx'),
        '<Screen id="home" title="Review"><Input id="notes" label="Notes" /></Screen>',
      )
      const metadata = join(server.folder, 'preview.json')
      await writeFile(metadata, '{"screens":{"home":{"summary":"Original summary"}}}')
      const browser = await chromium.launch(chromiumLaunchOptions(chromiumPath))
      resources.push(async () => await browser.close())
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.goto(server.url + 'home?bp=mobile')
      await page.getByText('Original summary', { exact: true }).waitFor({ timeout: 5000 })
      const field = page.getByRole('textbox', { name: 'Notes' })
      await field.fill('Reviewer text')
      const frame = page.locator('.dsx-frame')
      const before = await frame.boundingBox()
      const beforeUrl = page.url()
      expect(before?.width).toBe(390)
      await writeFile(metadata, '{"screens":{"home":{"summary":"Revised review summary"}}}')
      await page.getByText('Revised review summary', { exact: true }).waitFor({ timeout: 5000 })
      const after = await frame.boundingBox()
      expect({ width: after?.width, height: after?.height }).toEqual({ width: before?.width, height: before?.height })
      expect(await field.inputValue()).toBe('Reviewer text')
      expect(page.url()).toBe(beforeUrl)
    },
  )
})
