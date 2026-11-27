import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseScreen } from '../../core/src/parse.ts'
import { extractNamedStates } from '../../core/src/state.ts'
import { kitMetadata } from '../src/meta.ts'
import type { ProjectPayload, WireScreen } from '../../renderer/src/wire.ts'

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? process.env.DSH_DESIGN_CHROMIUM_PATH
const codeText = 'start\n    ' + 'a'.repeat(420) + '\n  end'

function screen(id: string, dsx: string): WireScreen {
  const parsed = parseScreen(dsx, 'screens/' + id + '.dsx')
  expect(parsed.diagnostics).toEqual([])
  const { root, states, diagnostics } = extractNamedStates(parsed.root!, parsed.file, kitMetadata)
  expect(diagnostics).toEqual([])
  return { id, file: parsed.file, root, states, diagnostics: [], errors: 0, warnings: 0 }
}

const screens = [
  screen(
    'example',
    `<Screen id="example" states={{ seeded: { values: { pin: true, mode: "list" } } }}>
  <Stack gap="8px">
    <Stack id="row" direction="row" gap="8px">
      <Input id="repo" label="Repository" grow={{ mobile: false, desktop: true }} />
      <Button id="submit">Open</Button>
    </Stack>
    <Disclosure id="faq" label="Show answer" expandedLabel="Hide answer"><Text>Inline answer</Text></Disclosure>
    <ToggleButton id="pin" label="Pin" /><ToggleButton id="cannot-toggle" label="Disabled toggle" disabled={true} />
    <SelectButton id="mode" label="Mode" options={[{ value: "grid", label: "Grid" }, { value: "disabled", label: "Unavailable", disabled: true }, { value: "list", label: "List" }]} />
    <Switch id="track" label="Visual switch" appearance="track" /><Switch id="legacy" label="Legacy switch" />
    <Tabs id="tabs">
      <Tab id="general" label="General"><Text>General panel</Text></Tab>
      <Tab id="activity" label="Activity"><Text>Activity panel</Text></Tab>
    </Tabs>
    <Stack direction="row" justify="end">
      <Button id="anchor" onPress={open("anchored")}>Anchored</Button>
      <SplitButton id="save" label="Primary" onClick={navigate("primary")} options={[
        { value: "disabled", label: "Unavailable action", disabled: true, onClick: navigate("primary") },
        { value: "draft", label: "Save draft with a distinct name", onClick: navigate("draft") },
      ]} />
    </Stack>
    <Stack direction="row" gap="8px">
      <Button id="show-drawer" onPress={open("drawer")}>Drawer</Button>
      <Button id="center" onPress={open("centered")}>Center</Button>
      <Button id="toast-trigger" onPress={open("toast")}>Toast</Button>
    </Stack>
    <Drawer id="drawer" title="Log" width={{ mobile: "480px", desktop: "size.drawer" }}>
      <CodeBlock id="log" text={${JSON.stringify(codeText)}} />
      <Callout id="notice" title="Review required" tone="warning"><Text>Persistent feedback</Text></Callout>
    </Drawer>
    <Popover id="anchored" anchor="anchor" title="Anchored panel">
      <Text>Panel content</Text>
      <Button id="authored-close" onPress={close("anchored")}>Close options</Button>
      <Button id="popover-navigation" onPress={navigate("draft")}>Go to draft</Button>
    </Popover>
    <Popover id="centered" title="Centered panel" />
    <Toast id="toast" message="Success" />
  </Stack>
  </Screen>`,
  ),
  screen('primary', '<Screen id="primary"><Text>Primary destination</Text></Screen>'),
  screen('draft', '<Screen id="draft"><Text>Draft destination</Text></Screen>'),
]

const tokens = {
  'size.drawer': { path: 'size.drawer', type: 'dimension', value: '480px', cssVar: '--dsx-size-drawer' },
} as const
const payload: ProjectPayload = {
  session: 'kit',
  revision: 1,
  kitVersion: '1.0.0',
  config: {
    entry: 'example',
    kitVersion: '1.0.0',
    breakpoints: [
      { name: 'mobile', width: 390 },
      { name: 'desktop', width: 900 },
    ],
  },
  tokens,
  cssVariables: {},
  diagnostics: [],
  screens,
  themes: {
    base: { tokens, cssVariables: {} },
    dark: { tokens, cssVariables: { '--dsx-color-warningBg': '#314159' } },
  },
}

let browser: Browser | undefined
let html: string
const id = (page: Page, target: string) => page.locator('[data-dsx-id="' + target + '"]')

async function openPage(breakpoint: 'mobile' | 'desktop') {
  const page = await browser!.newPage({ viewport: { width: breakpoint === 'mobile' ? 390 : 960, height: 720 } })
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'document') await route.fulfill({ contentType: 'text/html', body: html })
    else await route.abort()
  })
  await page.goto('http://kit.test/preview/kit/example?deterministic=1&state=seeded&theme=dark&bp=' + breakpoint)
  await id(page, 'repo').waitFor()
  return page
}

describe.skipIf(executablePath === undefined)('kit controls in Chromium', () => {
  beforeAll(async () => {
    const source = (path: string) => resolve(import.meta.dirname, '../..', path)
    const bundle = await build({
      entryPoints: [source('renderer/src/main.tsx')],
      bundle: true,
      format: 'iife',
      jsx: 'automatic',
      write: false,
      outdir: 'kit-browser-test',
      external: ['*.woff2'],
      alias: {
        '@filipeesch/dsh-design-core': source('core/src/browser.ts'),
        '@filipeesch/dsh-design-kit': source('kit/src/index.ts'),
      },
    })
    const result = (suffix: string) => bundle.outputFiles.find((file) => file.path.endsWith(suffix))!.text
    html =
      '<!doctype html><style>' +
      result('.css') +
      '</style><div id="root"></div><script>window.__DSX_PROJECT__=' +
      JSON.stringify(payload).replaceAll('<', '\\u003c') +
      ';' +
      result('.js').replaceAll('</script', '<\\/script') +
      '</script>'
    browser = await chromium.launch({ executablePath, chromiumSandbox: true })
  })
  afterAll(async () => browser?.close())

  it('preserves code indentation and confines long lines and a token-width drawer', async () => {
    const page = await openPage('mobile')
    try {
      await id(page, 'show-drawer').click()
      expect(await id(page, 'log').textContent()).toBe(codeText)
      const bounds = await id(page, 'log').evaluate((pre) => ({ width: pre.clientWidth, scroll: pre.scrollWidth }))
      expect(bounds.scroll).toBeGreaterThan(bounds.width)
      expect((await id(page, 'drawer').boundingBox())?.width).toBe(390)
      expect(await id(page, 'notice').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
        'rgb(49, 65, 89)',
      )
      expect(await id(page, 'notice').textContent()).toContain('Persistent feedback')
      expect(await page.getByRole('status').count()).toBe(0)
    } finally {
      await page.close()
    }
  })

  it('honors authored seeds, keyboard and disabled behavior without changing native Switch', async () => {
    const page = await openPage('desktop')
    try {
      const pin = page.getByRole('button', { name: 'Pin', exact: true })
      expect(await pin.getAttribute('aria-pressed')).toBe('true')
      await pin.press('Space')
      expect(await pin.getAttribute('data-dsx-value')).toBe('false')
      await pin.click()
      expect(await pin.getAttribute('aria-pressed')).toBe('true')
      expect(await id(page, 'cannot-toggle').isDisabled()).toBe(true)
      const list = page.getByRole('radio', { name: 'List' })
      expect(await list.getAttribute('aria-checked')).toBe('true')
      await list.press('ArrowLeft')
      expect(await id(page, 'mode').getAttribute('data-dsx-value')).toBe('grid')
      expect(await page.getByRole('radio', { name: 'Unavailable' }).isDisabled()).toBe(true)
      await list.click()
      expect(await list.getAttribute('aria-checked')).toBe('true')
      const track = page.getByRole('switch', { name: 'Visual switch' })
      const legacy = page.getByRole('switch', { name: 'Legacy switch' })
      expect(await track.evaluate((input) => getComputedStyle(input).appearance)).toBe('none')
      expect(await legacy.evaluate((input) => getComputedStyle(input).appearance)).toBe('auto')
      await track.press('Space')
      await legacy.press('Space')
      expect(await track.isChecked()).toBe(true)
      expect(await legacy.isChecked()).toBe(true)
    } finally {
      await page.close()
    }
  })

  it('targets inactive tabs, keeps Disclosure focus, and fits a desktop growing Input beside its action', async () => {
    const page = await openPage('desktop')
    try {
      const activity = id(page, 'activity')
      expect(await activity.getAttribute('aria-selected')).toBe('false')
      await activity.click()
      expect(await activity.count()).toBe(1)
      expect(await activity.getAttribute('aria-selected')).toBe('true')
      expect(await page.getByRole('tabpanel', { name: 'Activity' }).innerText()).toBe('Activity panel')
      await page.getByRole('button', { name: 'Show answer' }).press('Enter')
      expect(
        await page.getByRole('button', { name: 'Hide answer' }).evaluate((node) => document.activeElement === node),
      ).toBe(true)
      await page.getByRole('button', { name: 'Hide answer' }).press('Space')
      expect(await page.getByText('Inline answer').count()).toBe(0)
      const row = (await id(page, 'row').boundingBox())!
      const input = (await page.getByRole('textbox', { name: 'Repository' }).boundingBox())!
      const button = (await id(page, 'submit').boundingBox())!
      expect(input.width).toBeGreaterThan(650)
      expect(input.x + input.width).toBeLessThan(button.x)
      expect(button.x + button.width).toBeLessThanOrEqual(row.x + row.width + 1)
      await id(page, 'show-drawer').click()
      expect((await id(page, 'drawer').boundingBox())?.width).toBe(480)
    } finally {
      await page.close()
    }
  })

  it('clamps anchored menus, returns keyboard focus, and distinguishes primary and alternate actions', async () => {
    const page = await openPage('mobile')
    try {
      await id(page, 'anchor').click()
      const anchor = (await id(page, 'anchor').boundingBox())!
      const popover = id(page, 'anchored')
      const panel = (await popover.boundingBox())!
      expect(panel.x).toBeGreaterThan(0)
      expect(panel.x + panel.width).toBeLessThanOrEqual(390)
      expect(panel.y > anchor.y + anchor.height || panel.y + panel.height < anchor.y).toBe(true)
      await page.keyboard.press('Escape')
      expect(await popover.count()).toBe(0)
      expect(await id(page, 'anchor').evaluate((node) => document.activeElement === node)).toBe(true)
      const isFocused = (target: string) => id(page, target).evaluate((node) => document.activeElement === node)
      await id(page, 'anchor').press('Enter')
      await id(page, 'authored-close').press('Enter')
      expect(await popover.count()).toBe(0)
      expect(await isFocused('anchor')).toBe(true)
      await id(page, 'anchor').press('Enter')
      const closeIcon = popover.getByRole('button', { name: 'Close', exact: true })
      expect(await closeIcon.boundingBox()).toEqual(expect.objectContaining({ width: 44, height: 44 }))
      await closeIcon.press('Enter')
      expect(await popover.count()).toBe(0)
      expect(await isFocused('anchor')).toBe(true)
      await id(page, 'anchor').press('Enter')
      await id(page, 'submit').click()
      expect(await popover.count()).toBe(0)
      expect(await isFocused('submit')).toBe(true)
      await id(page, 'anchor').press('Enter')
      await id(page, 'popover-navigation').press('Enter')
      await page.getByText('Draft destination').waitFor()
      expect(await id(page, 'anchor').count()).toBe(0)
      await page.goBack()
      await id(page, 'center').click()
      const centered = (await id(page, 'centered').boundingBox())!
      expect(centered.x + centered.width / 2).toBeCloseTo(195, 0)
      await page.getByRole('dialog', { name: 'Centered panel' }).getByRole('button', { name: 'Close' }).click()
      await id(page, 'toast-trigger').click()
      expect(await page.getByRole('status').textContent()).toContain('Success')
      await page.getByRole('status').getByRole('button', { name: 'Close' }).click()
      expect(await page.getByRole('status').count()).toBe(0)
      const menuTrigger = id(page, 'save').locator('[data-dsx-part="menu"]')
      const menuTarget = (await menuTrigger.boundingBox())!
      expect(menuTarget.width).toBeGreaterThanOrEqual(44)
      expect(menuTarget.height).toBeGreaterThanOrEqual(44)
      await menuTrigger.press('ArrowDown')
      const menu = (await page.getByRole('menu').boundingBox())!
      expect(menu.x + menu.width).toBeLessThanOrEqual(390)
      const option = page.getByRole('menuitem', { name: 'Save draft with a distinct name' })
      expect(await option.evaluate((node) => document.activeElement === node)).toBe(true)
      await page.keyboard.press('Escape')
      expect(await menuTrigger.evaluate((node) => document.activeElement === node)).toBe(true)
      expect(await page.getByRole('menu').count()).toBe(0)
      await menuTrigger.click()
      await page.keyboard.press('Enter')
      await page.getByText('Draft destination').waitFor()
      expect(new URL(page.url()).searchParams.get('theme')).toBe('dark')
      await page.goBack()
      await id(page, 'save').locator('[data-dsx-part="primary"]').click()
      await page.getByText('Primary destination').waitFor()
    } finally {
      await page.close()
    }
  })
})
