import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadProject, scaffoldProject } from '@filipeesch/dsh-design-core'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserSessions, designBrowserErrorCode } from '../src/browser.ts'
import {
  captureScreenshot,
  measureSelection,
  resolveCheckSelection,
  runGeometry,
  runJourney,
  runLint,
  type CheckContext,
} from '../src/checks.ts'
import { findChromium } from './chromium.ts'

const chromiumPath = await findChromium()
const assetsDir = process.env.TEST_DESIGN_ASSETS_DIR ?? fileURLToPath(new URL('../../renderer/dist/', import.meta.url))
const dispose: (() => Promise<unknown>)[] = []
afterEach(async () => {
  while (dispose.length > 0) await dispose.pop()?.()
})

function screens(dense: boolean) {
  const crowd = Array.from(
    { length: dense ? 505 : 0 },
    (_, index) => '<Box id="cell-' + index + '" css="width:1px;height:1px" />',
  ).join('')
  return `<Screen id="review" title="Review" states={{ seeded: { open: ["details-drawer"], tabs: { sections: "first" }, disclosures: { details: true }, values: { field: "Authored text" } } }}>
  <Stack gap="spacing.sm">
    ${crowd}
    <Stack id="focus" styleClass="focus-width" gap="spacing.sm">
      <Text id="leaf">Leaf</Text>
      <Text>Addressed leaf</Text>
      <Image id="evidence" src="image.png" width="20px" height="20px" alt="Evidence" />
    </Stack>
    <Box id="transparent" css="opacity:0;width:10px;height:10px"><Text id="invisible-child">Not visible</Text></Box>
    <Input id="field" label="Name" />
    <Disclosure id="details" label="Details"><Text id="disclosure-body">Within Disclosure</Text></Disclosure>
    <Tabs id="sections" value="first">
      <Tab id="first-trigger" label="First" value="first"><Text id="first-body">First panel</Text></Tab>
      <Tab id="second-trigger" label="Second" value="second">
        <Text id="second-body">Second panel</Text>
        <ToggleButton id="pin" label="Pin" />
        <SelectButton id="mode" label="Mode" options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }]} />
        <SplitButton id="actions" label="Save" onClick={navigate("done")} options={[{ value: "draft", label: "Save draft", onClick: navigate("draft") }]} />
      </Tab>
    </Tabs>
    <Drawer id="details-drawer" title="Details"><Text id="drawer-body">Within drawer</Text></Drawer>
  </Stack>
</Screen>`
}

async function fixture(dense = false) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-geometry-'))
  dispose.push(() => rm(directory, { recursive: true, force: true }))
  await scaffoldProject(directory, { kitVersion: KIT_VERSION })
  const folder = join(directory, 'design')
  const source = screens(dense)
  const screenFile = join(folder, 'screens', 'review.dsx')
  const asset = join(folder, 'image.png')
  await mkdir(join(folder, 'themes'), { recursive: true })
  await mkdir(join(folder, 'styles'), { recursive: true })
  await mkdir(join(folder, 'journeys'), { recursive: true })
  await writeFile(
    join(folder, 'design.json'),
    JSON.stringify({
      kitVersion: KIT_VERSION,
      themes: { dark: 'themes/dark.json' },
      stylesheets: ['styles/shared.css'],
    }),
  )
  await writeFile(
    join(folder, 'themes', 'dark.json'),
    JSON.stringify({ colorScheme: 'dark', tokens: { color: { canvas: { $type: 'color', $value: '#151820' } } } }),
  )
  await writeFile(join(folder, 'styles', 'shared.css'), '.focus-width { width: 90px; }')
  await writeFile(
    asset,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/X1sAAAAASUVORK5CYII=',
      'base64',
    ),
  )
  await writeFile(screenFile, source)
  await writeFile(join(folder, 'screens', 'done.dsx'), '<Screen id="done" title="Done"><Text>Done</Text></Screen>')
  await writeFile(join(folder, 'screens', 'draft.dsx'), '<Screen id="draft" title="Draft"><Text>Draft</Text></Screen>')
  const load = () => loadProject({ folder, kit: kitMetadata, installedKitVersion: KIT_VERSION })
  const project = await load()
  expect(project.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
  return { project, folder, source, screenFile, asset, load }
}

function context(): CheckContext & { browsers: BrowserSessions } {
  const browsers = new BrowserSessions({ executablePath: chromiumPath })
  dispose.push(() => browsers.disposeAll())
  return { sessionId: 'geometry', browsers, assetsDir }
}

it('rejects invalid last cases and stale or unsafe review selectors before browser startup', async () => {
  const { project } = await fixture()
  const run = vi.fn()
  const ctx = { sessionId: 'geometry', assetsDir, browsers: { run, viewportHeight: 900 } }
  const first = { breakpoint: 'mobile' }
  const measure = (last: Parameters<typeof runGeometry>[3]['cases'][number]) =>
    runGeometry(ctx, project, 'review', { nodes: ['leaf'], cases: [first, last] })
  await expect(measure({ breakpoint: 'unknown' })).rejects.toThrow(/case 2.*unknown breakpoint/i)
  await expect(measure({ breakpoint: 'mobile', state: 'missing' })).rejects.toThrow(/case 2.*state "missing"/i)
  await expect(measure({ breakpoint: 'mobile', theme: 'missing' })).rejects.toThrow(/case 2.*unknown theme/i)
  await expect(measure({ breakpoint: 'mobile', reviewContext: { screen: 'draft' } })).rejects.toThrow(/stale.*screen/i)
  await expect(measure({ breakpoint: 'mobile', reviewContext: { selection: 'layout:different' } })).rejects.toThrow(
    /stale.*branch/i,
  )
  await expect(measure({ breakpoint: 'mobile', reviewContext: { tabs: { sections: 'old-tab' } } })).rejects.toThrow(
    /stale.*old-tab/i,
  )
  await expect(measure({ breakpoint: 'mobile', reviewContext: { open: ['leaf'] } })).rejects.toThrow(
    /stale.*not an overlay/i,
  )
  await expect(measure({ breakpoint: 'mobile', reviewContext: { disclosures: { leaf: false } } })).rejects.toThrow(
    /stale.*not a Disclosure/i,
  )
  await expect(
    measure({ breakpoint: 'mobile', reviewContext: { values: { field: 'not accepted' } } as never }),
  ).rejects.toThrow(/unsupported reviewContext field "values"/i)
  await expect(runGeometry(ctx, project, 'review', { nodes: ['leaf', 'leaf'], cases: [first] })).rejects.toThrow(
    /distinct/,
  )
  expect(run).not.toHaveBeenCalled()
})

it('discards partial geometry on cancellation or expiration without starting a later case', async () => {
  const { project } = await fixture()
  for (const reason of ['cancelled', 'timeout']) {
    const controller = new AbortController()
    const started = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(started)
    const render = vi.fn(async () => {
      if (reason === 'cancelled') controller.abort()
      else clock.mockReturnValue(started + 1000)
      return { canvas: { width: 390, height: 900 }, nodes: [], media: [] }
    })
    try {
      const ctx: CheckContext = {
        sessionId: 'geometry',
        assetsDir,
        browsers: { run: render as CheckContext['browsers']['run'], viewportHeight: 900, checkTimeoutMs: 1000 },
        signal: controller.signal,
      }
      const cases = [{ breakpoint: 'mobile' }, { breakpoint: 'desktop' }]
      await expect(runGeometry(ctx, project, 'review', { nodes: ['leaf'], cases })).rejects.toMatchObject({
        code: reason,
      })
      expect(render).toHaveBeenCalledTimes(1)
    } finally {
      clock.mockRestore()
    }
  }
})

it('recognizes browser failures from an independently bundled error', () => {
  class OtherBundleError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  for (const code of ['chromium-missing', 'timeout', 'cancelled', 'browser-failed']) {
    expect(designBrowserErrorCode(new OtherBundleError(code))).toBe(code)
  }
  expect(designBrowserErrorCode(new OtherBundleError('ENOENT'))).toBeUndefined()
})

describe.skipIf(chromiumPath === undefined)('isolated Chromium visual checks', () => {
  it('focuses before the cap, returns ordered compact cases, and keeps source and raster bytes across edits', async () => {
    const { project, source, screenFile, asset, folder, load } = await fixture(true)
    const ctx = context()
    const selected = resolveCheckSelection(project, 'review', { breakpoint: 'mobile' }, 'one')
    const focused = await measureSelection(ctx, project, selected, { node: 'focus', depth: 1 })
    expect(focused.layout.truncated).toBe(false)
    expect(focused.layout.nodes.map((node) => node.id ?? node.type)).toEqual(['focus', 'leaf', 'Text', 'evidence'])
    expect(
      (await measureSelection(ctx, project, selected, { node: 'focus', depth: 0 })).layout.nodes.map((node) => node.id),
    ).toEqual(['focus'])
    const nodes = [
      'absent-id',
      'second-trigger',
      'second-body',
      'first-body',
      'disclosure-body',
      'drawer-body',
      'evidence',
      'invisible-child',
    ]
    let ran = 0
    const assetUrls: (string | null)[] = []
    const ctxDuringEdit: CheckContext = {
      ...ctx,
      browsers: {
        viewportHeight: ctx.browsers.viewportHeight,
        run: async (request, task) =>
          ctx.browsers.run(request, async (page) => {
            assetUrls.push(await page.locator('[data-dsx-id="evidence"]').getAttribute('src'))
            if (ran++ === 0) {
              await writeFile(screenFile, source.replace('id="second-body"', 'id="new-body"'))
              await rm(asset)
            }
            return task(page)
          }),
      },
    }
    const result = await runGeometry(ctxDuringEdit, project, 'review', {
      nodes,
      cases: [
        {
          breakpoint: 'desktop',
          state: 'seeded',
          reviewContext: {
            screen: 'review',
            selection: '',
            theme: 'dark',
            open: [],
            tabs: { sections: 'second' },
            disclosures: { details: false },
          },
        },
        { breakpoint: 'mobile', state: 'seeded', theme: 'base' },
      ],
    })
    const [first, second] = result.cases
    expect(first).toMatchObject({
      breakpoint: 'desktop',
      theme: 'dark',
      state: 'seeded',
      rendition: 'current',
      reviewContext: true,
      canvas: { width: 1280 },
      media: [],
    })
    expect(second).toMatchObject({
      breakpoint: 'mobile',
      theme: 'base',
      state: 'seeded',
      rendition: 'current',
      canvas: { width: 390 },
      media: [],
    })
    expect(first?.nodes.map(({ id }) => id)).toEqual(nodes)
    expect(second?.nodes.map(({ id }) => id)).toEqual(nodes)
    expect(first?.nodes.map(({ status }) => status)).toEqual([
      'absent',
      'visible',
      'visible',
      'hidden',
      'hidden',
      'hidden',
      'visible',
      'hidden',
    ])
    expect(second?.nodes.map(({ status }) => status)).toEqual([
      'absent',
      'visible',
      'hidden',
      'visible',
      'visible',
      'visible',
      'visible',
      'hidden',
    ])
    expect(first?.nodes[1]).toMatchObject({ box: { width: expect.any(Number) } })
    expect(first?.nodes[0]).toEqual({ id: 'absent-id', status: 'absent' })
    expect(assetUrls[0]).toContain('data:image/png')
    expect(assetUrls[0]).toBe(assetUrls[1])
    expect(result.sourceIdentity).toBe(project.sourceIdentity)
    expect((await load()).sourceIdentity).not.toBe(result.sourceIdentity)
    expect(await readFile(screenFile, 'utf8')).toContain('id="new-body"')
    await expect(access(join(folder, '.cache', 'screenshots'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(result).not.toHaveProperty('text')
  }, 60_000)

  it('captures reproducibly and separates changed themes and applied styles', async () => {
    const { project, folder, load } = await fixture()
    const ctx = context()
    const capture = (theme: string) =>
      captureScreenshot(ctx, project, 'review', { breakpoint: 'mobile', theme, highlight: 'focus' })
    const base = await capture('base')
    const first = await readFile(base.path)
    const repeat = await capture('base')
    const dark = await capture('dark')
    expect(repeat.path).toBe(base.path)
    expect(await readFile(repeat.path)).toEqual(first)
    expect(dark.theme).toBe('dark')
    expect(dark.path).not.toBe(base.path)
    await writeFile(join(folder, 'styles', 'shared.css'), '.focus-width { width: 120px; }')
    const changed = await captureScreenshot(ctx, await load(), 'review', {
      breakpoint: 'mobile',
      theme: 'base',
      highlight: 'focus',
    })
    expect(changed.path).not.toBe(base.path)
    expect(await readFile(base.path)).toEqual(first)
    const lint = await runLint(ctx, project, 'review', { theme: 'dark', breakpoint: 'mobile' })
    expect(lint).toMatchObject({ theme: 'dark', breakpoints: ['mobile'] })
  }, 60_000)

  it('runs separate split actions, observes typed values, and keeps theme across the route', async () => {
    const { folder, load } = await fixture()
    const start =
      '<Tap target="second-trigger" /><ExpectVisible target="second-body" visible={true} /><Tap target="pin" /><ExpectValue target="pin" value={true} /><Choose target="mode" value="list" /><ExpectValue target="mode" value="list" />'
    for (const [id, steps] of [
      [
        'alternate',
        start +
          '<Tap target="actions" part="menu" /><Choose target="actions" part="menu" value="draft" /><ExpectScreen screen="draft" />',
      ],
      ['primary', start + '<Tap target="actions" part="primary" /><ExpectScreen screen="done" />'],
      ['missing', start + '<Tap target="first-trigger" /><Tap target="actions" part="primary" />'],
    ] as const) {
      await writeFile(
        join(folder, 'journeys', id + '.dsx'),
        '<Journey id="' + id + '" start="review" breakpoint="mobile" theme="dark">' + steps + '</Journey>',
      )
    }
    const project = await load()
    const ctx = context()
    const alternate = await runJourney(ctx, project, 'alternate')
    expect(alternate.diagnostics).toBeUndefined()
    expect(alternate.ok, JSON.stringify(alternate.steps)).toBe(true)
    expect(alternate.theme).toBe('dark')
    expect(alternate.steps.at(-1)).toMatchObject({ status: 'passed', expected: 'draft' })
    const primary = await runJourney(ctx, project, 'primary')
    expect(primary).toMatchObject({ ok: true, theme: 'dark' })
    expect(primary.steps.at(-1)).toMatchObject({ status: 'passed', expected: 'done' })
    const missing = await runJourney(ctx, project, 'missing')
    expect(missing).toMatchObject({ ok: false, theme: 'dark', snapshot: { screen: 'review', theme: 'dark' } })
    expect(missing.steps.at(-1)).toMatchObject({
      index: 7,
      target: 'actions',
      status: 'failed',
      observed: 'target missing',
    })
  }, 60_000)
})
