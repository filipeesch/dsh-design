/** Compare unthemed, unclassed DSX with the 5313758 archive (see legacy-appearance.md). */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Locator, type Page, type Request } from 'playwright-core'
import { expect, it } from 'vitest'
import { BrowserSessions } from '../../host/src/browser.ts'
import { runningDesignBuild } from '../../host/src/build-identity.ts'
import { buildPayload } from '../../host/src/payload.ts'
import { ProjectRegistry } from '../../host/src/registry.ts'
import { createRouteHandler } from '../../host/src/routes.ts'
import { KIT_VERSION, kitMetadata } from '../../kit/src/meta.ts'

const defaultAssets = fileURLToPath(new URL('../dist/', import.meta.url))
const assets = process.env.DSH_DESIGN_LEGACY_RENDERER_ASSETS ?? defaultAssets
const chromiumPath = process.env.DSH_DESIGN_CHROMIUM_PATH ?? process.env.PLAYWRIGHT_CHROMIUM_PATH
const session = 'legacy-appearance'
const height = 900
const cases = [
  { breakpoint: 'desktop', width: 1280, ownerViewport: 1440 },
  { breakpoint: 'mobile', width: 390, ownerViewport: 430 },
] as const
const files = {
  'design.json': JSON.stringify({ kitVersion: '1.0.0' }),
  'tokens.json': JSON.stringify({
    color: {
      ink: { $type: 'color', $value: '#2b3140' },
      text: { $type: 'color', $value: '{color.ink}' },
      action: { $type: 'color', $value: '#1e4d9a' },
      canvas: { $type: 'color', $value: '#f3f5f8' },
      surface: { $type: 'color', $value: '#fffefd' },
      border: { $type: 'color', $value: '#c7ceda' },
    },
  }),
  'screens/home.dsx': `<Screen id="home" title="Legacy appearance">
  <Stack>
    <Card id="card">
      <Text id="body">Enter a description.</Text>
      <Text id="muted" variant="caption">Optional information.</Text>
      <Input id="name" label="Name" placeholder="Enter a name" />
      <TextArea id="notes" label="Notes" placeholder="Enter notes" />
      <Select id="priority" label="Priority" options={["Normal", "High"]} />
      <Checkbox id="subscribe" label="Subscribe" checked={true} />
    </Card>
    <Stack direction="row" wrap={true}>
      <Button id="primary" onPress={open("details")}>Details</Button>
      <Button id="secondary" variant="secondary" onPress={open("notice")}>Notify</Button>
      <Button id="ghost" variant="ghost">Ghost</Button>
      <Button id="danger" variant="danger">Danger</Button>
      <Button id="link" variant="link">Link</Button>
      <Button id="disabled" disabled={true}>Disabled</Button>
    </Stack>
  </Stack>
  <Drawer id="details" title="Details"><Text>More information.</Text></Drawer>
  <Toast id="notice" message="Saved" tone="success" />
</Screen>
`,
}

const typography = ['color', 'font-family', 'font-size', 'font-weight']
const surface = ['background-color', 'border-top-color', 'border-top-width', 'border-radius']
const field = [...typography, ...surface, 'padding', 'min-height']
const button = [...typography, ...surface, 'padding', 'opacity', 'text-decoration-line']

function computed(target: Locator, properties: string[], pseudo?: string) {
  return target.evaluate(
    (element, { properties, pseudo }) => {
      const css = getComputedStyle(element, pseudo)
      return Object.fromEntries(properties.map((property) => [property, css.getPropertyValue(property)]))
    },
    { properties, pseudo },
  )
}

async function focusOutline(page: Page, target: Locator, previous: Locator) {
  await previous.focus()
  await page.keyboard.press('Tab')
  expect(await target.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  return target.evaluate((element) => {
    const outline = getComputedStyle(element)
    // The native Chromium focus ring color depends on the host platform.
    const probe = document.createElement('span')
    probe.style.color = '-webkit-focus-ring-color'
    document.body.append(probe)
    const nativeColor = getComputedStyle(probe).color
    probe.remove()
    return {
      color: outline.outlineColor === nativeColor ? 'native Chromium focus ring' : outline.outlineColor,
      offset: outline.outlineOffset,
      style: outline.outlineStyle,
      width: outline.outlineWidth,
    }
  })
}

async function measure(page: Page, breakpoint: string, width: number) {
  const frame = page.locator('.dsx-frame[data-screen="home"][data-breakpoint="' + breakpoint + '"]')
  await frame.waitFor()
  await page.evaluate(() => document.fonts.ready)
  expect((await frame.boundingBox())?.width).toBe(width)
  const node = (id: string) => frame.locator('[data-dsx-id="' + id + '"]')
  const control = (id: string, role: 'textbox' | 'combobox' | 'checkbox') => node(id).getByRole(role)
  const name = control('name', 'textbox')
  const notes = control('notes', 'textbox')
  const appearance = {
    screen: await computed(node('home'), ['background-color', ...typography, 'color-scheme']),
    card: await computed(node('card'), [...surface, 'box-shadow', 'padding']),
    text: await computed(node('body'), typography),
    mutedText: await computed(node('muted'), typography),
    fieldLabel: await computed(node('name').getByText('Name', { exact: true }), typography),
    input: await computed(name, field),
    inputPlaceholder: await computed(name, ['color', 'opacity', 'font-size'], '::placeholder'),
    textArea: await computed(notes, field),
    textAreaPlaceholder: await computed(notes, ['color', 'opacity', 'font-size'], '::placeholder'),
    select: await computed(control('priority', 'combobox'), field),
    checkbox: await computed(control('subscribe', 'checkbox'), ['accent-color', 'width', 'height']),
    buttons: Object.fromEntries(
      await Promise.all(
        ['primary', 'secondary', 'ghost', 'danger', 'link', 'disabled'].map(async (id) => [
          id,
          await computed(node(id), button),
        ]),
      ),
    ),
    fieldFocus: await focusOutline(page, notes, name),
    buttonFocus: await focusOutline(page, node('primary'), control('subscribe', 'checkbox')),
  }

  await page.keyboard.press('Enter')
  const drawer = node('details')
  const { width: drawerWidth, ...drawerAppearance } = await computed(drawer, [...surface, 'box-shadow', 'width'])
  expect((await drawer.boundingBox())?.width).toBeLessThanOrEqual(width)
  await drawer.getByRole('button', { name: 'Close' }).click()
  await drawer.waitFor({ state: 'detached' })

  await node('secondary').click()
  const toast = node('notice').and(frame.getByRole('status'))
  const toastAppearance = {
    panel: await computed(toast, [...surface, 'color', 'box-shadow', 'min-width', 'padding']),
    message: await computed(toast.getByText('Saved', { exact: true }), typography),
    close: await computed(toast.getByRole('button', { name: 'Close' }), ['background-color', 'color']),
    backdrop: await computed(frame.locator('[data-dsx-backdrop="notice"]'), ['background-color']),
  }
  await toast.getByRole('button', { name: 'Close' }).click()
  await toast.waitFor({ state: 'detached' })
  return { style: { ...appearance, drawer: drawerAppearance, toast: toastAppearance }, drawerWidth }
}

it.skipIf(!chromiumPath)('preserves archived base appearance in owner previews and deterministic checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsx-legacy-appearance-'))
  const design = join(root, 'design')
  let origin = ''
  const registry = new ProjectRegistry({
    folderName: 'design',
    kitVersion: KIT_VERSION,
    installedKitVersion: KIT_VERSION,
    kit: kitMetadata,
    resolveSessionCwd: () => root,
    origin: () => origin,
  })
  const route = createRouteHandler(registry, assets)
  const server = createServer((req, res) => {
    void route(req, res, { principal: { kind: 'owner' } }).catch((error: unknown) => res.destroy(error as Error))
  })
  let browser: Browser | undefined
  let browsers: BrowserSessions | undefined
  try {
    const chromiumBrowser = await chromium.launch({ executablePath: chromiumPath, chromiumSandbox: true })
    browser = chromiumBrowser
    const deterministicRequests: Request[] = []
    chromiumBrowser.on('context', (context) => context.on('request', (request) => deterministicRequests.push(request)))
    browsers = new BrowserSessions({ launch: async () => chromiumBrowser, viewportHeight: height })
    await mkdir(join(design, 'screens'), { recursive: true })
    await Promise.all(Object.entries(files).map(([path, source]) => writeFile(join(design, path), source)))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = 'http://127.0.0.1:' + String((server.address() as { port: number }).port)
    const runtime = registry.forFolder(design)
    const project = await runtime.get()
    expect(project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
    const payload = buildPayload(session, 0, KIT_VERSION, project, {})

    const widths: Record<string, string | undefined> = {}
    let commonStyle: Awaited<ReturnType<typeof measure>>['style'] | undefined
    const checkStyle = (name: string, { style, drawerWidth }: Awaited<ReturnType<typeof measure>>) => {
      if (commonStyle === undefined) {
        expect(style).toMatchSnapshot('base styles')
        commonStyle = style
      } else {
        expect(style, name).toEqual(commonStyle)
      }
      widths[name] = drawerWidth
    }
    for (const { breakpoint, width, ownerViewport } of cases) {
      const page = await browser.newPage({
        viewport: { width: ownerViewport, height },
        // The legacy canvas stays light regardless of owner OS preference.
        colorScheme: 'dark',
        locale: 'en-US',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      })
      try {
        page.setDefaultTimeout(5000)
        const ownerRequests: Request[] = []
        page.on('request', (request) => ownerRequests.push(request))
        await page.route('**/*', (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()))
        await page.goto(origin + '/design/' + session + '/home?bp=' + breakpoint)
        await page.locator('.dsx-chrome').waitFor()
        checkStyle('owner ' + breakpoint, await measure(page, breakpoint, width))
        expect(ownerRequests.filter((request) => new URL(request.url()).origin !== origin).map((r) => r.url())).toEqual(
          [],
        )
        expect(ownerRequests.filter((request) => request.resourceType() === 'stylesheet').map((r) => r.url())).toEqual([
          origin + '/design/' + session + '/_/assets/app.css?build=' + encodeURIComponent(runningDesignBuild.id),
        ])
      } finally {
        await page.close()
      }

      deterministicRequests.length = 0
      const measured = await browsers.run(
        { sessionId: session, payload, assetsDir: assets, screen: 'home', breakpoint, breakpointWidth: width },
        async (page) => {
          expect(await page.locator('[data-dsx-deterministic="1"]').count()).toBe(1)
          expect(await page.locator('.dsx-chrome').count()).toBe(0)
          return measure(page, breakpoint, width)
        },
      )
      checkStyle('deterministic ' + breakpoint, measured)
      expect(deterministicRequests.map((request) => request.resourceType())).toEqual(['document'])
    }

    expect(widths).toMatchSnapshot('default drawer widths')

    // Opening and using a legacy project does not migrate or augment its authored sources.
    expect((await readdir(design)).sort()).toEqual(['design.json', 'screens', 'tokens.json'])
    expect(await readdir(join(design, 'screens'))).toEqual(['home.dsx'])
    for (const [path, source] of Object.entries(files)) expect(await readFile(join(design, path), 'utf8')).toBe(source)
  } finally {
    await browsers?.disposeAll()
    await browser?.close()
    registry.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
