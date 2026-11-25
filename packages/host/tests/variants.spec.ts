import { createServer, type Server } from 'node:http'
import { access, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, callTool, type HostHarness } from './harness.ts'
import { buildPayload } from '../src/payload.ts'
import { diffVariantBranches } from '../src/diff.ts'
import { payloadFor } from '../src/checks.ts'
import { loadProject } from '@filipeesch/dsh-design-core'
import { kitMetadata } from '@filipeesch/dsh-design-kit/meta'

const assetsDir = fileURLToPath(new URL('../../renderer/dist/', import.meta.url))

async function findChromium(): Promise<string | undefined> {
  if (process.env.DSH_DESIGN_CHROMIUM_PATH !== undefined) return process.env.DSH_DESIGN_CHROMIUM_PATH
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
const harnesses: HostHarness[] = []
async function harness(options: Parameters<typeof createHarness>[0] = {}): Promise<HostHarness> {
  const created = await createHarness({
    assetsDir,
    ...(chromiumPath === undefined ? {} : { chromiumPath }),
    ...options,
  })
  harnesses.push(created)
  return created
}
afterEach(() => {
  for (const created of harnesses.splice(0)) created.close()
})

const variantScreen = [
  '<Screen id="home" title="Home" states={{ "drawer-open": { open: ["compact-drawer"] } }}>',
  '  <Header title="Acme" />',
  '  <Variants id="layout" chosen="compact">',
  '    <Variant branch="compact">',
  '      <Stack gap="spacing.sm">',
  '        <Text>Compact branch</Text>',
  '        <Button id="compact-only">Compact action</Button>',
  '        <Drawer id="compact-drawer" title="Compact"><Text>Compact drawer</Text></Drawer>',
  '      </Stack>',
  '    </Variant>',
  '    <Variant branch="spacious">',
  '      <Stack gap="spacing.lg">',
  '        <Text>Spacious branch</Text>',
  '        <Button id="spacious-only">Spacious action</Button>',
  '      </Stack>',
  '    </Variant>',
  '  </Variants>',
  '</Screen>',
].join('\n')

async function setup(h: HostHarness, source = variantScreen): Promise<void> {
  await writeFile(join(h.root, 'design', 'screens', 'home.dsx'), source)
}

async function listen(
  route: (req: any, res: any, peer: any) => Promise<void>,
): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    void route(req, res, { principal: { kind: 'owner' } })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { server, base: 'http://127.0.0.1:' + String(address.port) }
}

describe('variant-aware project payload', () => {
  it('serves the chosen projection by default and an explicit branch on request', async () => {
    const h = await harness()
    await setup(h)
    h.registry.learnSession('one', h.root)
    const project = await h.registry.forSession('one')!.then((runtime) => runtime!.get())
    const chosen = buildPayload('s', 1, '1.0.0', project)
    expect(JSON.stringify((chosen.screens[0] as any).root)).toContain('Compact branch')
    const alternate = buildPayload('s', 1, '1.0.0', project, undefined, {
      screen: 'home',
      group: 'layout',
      branch: 'spacious',
    })
    const screen = alternate.screens[0] as any
    expect(JSON.stringify(screen.root)).toContain('Spacious branch')
    expect(screen.variant.branch).toBe('spacious')
    expect(screen.variant.chosen).toBe(false)
    expect(JSON.stringify(screen.root)).not.toContain('Compact branch')
  })

  it('diagnoses an unknown group or branch instead of substituting the chosen branch', async () => {
    const h = await harness()
    await setup(h)
    h.registry.learnSession('one', h.root)
    const project = await h.registry.forSession('one')!.then((runtime) => runtime!.get())
    const unknownGroup = buildPayload('s', 1, '1.0.0', project, undefined, {
      screen: 'home',
      group: 'missing',
      branch: 'compact',
    })
    expect(unknownGroup.variantError).toContain('does not declare variant group')
    expect((unknownGroup.screens[0] as any).root).toBeUndefined()
    const unknownBranch = buildPayload('s', 1, '1.0.0', project, undefined, {
      screen: 'home',
      group: 'layout',
      branch: 'tiny',
    })
    expect(unknownBranch.variantError).toContain('does not declare branch')
    expect((unknownBranch.screens[0] as any).root).toBeUndefined()
  })

  it('exposes the selection through the project route', async () => {
    const h = await harness()
    await setup(h)
    h.sessions.set('session-test', { id: 'session-test', header: { cwd: h.root } })
    const { server, base } = await listen(h.route)
    try {
      const chosen = (await (await fetch(base + '/design/session-test/_/project?screen=home')).json()) as any
      expect(JSON.stringify(chosen.screens[0].root)).toContain('Compact branch')
      const alternate = (await (
        await fetch(base + '/design/session-test/_/project?screen=home&variant=layout%3Aspacious')
      ).json()) as any
      expect(JSON.stringify(alternate.screens[0].root)).toContain('Spacious branch')
      expect(alternate.screens[0].variant.path).toBe('layout')
      const invalid = (await (
        await fetch(base + '/design/session-test/_/project?screen=home&variant=layout%3Atiny')
      ).json()) as any
      expect(invalid.variantError).toContain('does not declare branch')
      expect(invalid.screens[0].root).toBeUndefined()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('variant-aware design tools', () => {
  it('reports groups and choices in design_status', async () => {
    const h = await harness()
    await setup(h)
    const status = await callTool(h, 'design_status', {}, h.root)
    expect(status.variants).toHaveLength(1)
    expect(status.variants[0]).toMatchObject({
      screen: 'home',
      id: 'layout',
      path: 'layout',
      chosen: 'compact',
    })
    expect(status.variants[0].branches.map((branch: any) => branch.id)).toEqual(['compact', 'spacious'])
  })

  it('surfaces branch diagnostics through design_validate without blocking the chosen projection', async () => {
    const h = await harness()
    await setup(
      h,
      [
        '<Screen id="home">',
        '  <Variants id="layout" chosen="ok">',
        '    <Variant branch="ok"><Text>Chosen</Text></Variant>',
        '    <Variant branch="broken"><Button id="bad" onPress={open("missing")}>Bad</Button></Variant>',
        '  </Variants>',
        '</Screen>',
      ].join('\n'),
    )
    const validation = await callTool(h, 'design_validate', {}, h.root)
    const branchDiagnostic = validation.diagnostics.find((diagnostic: any) => diagnostic.branch === 'broken')
    expect(branchDiagnostic).toBeDefined()
    expect(branchDiagnostic.code).toBe('interaction-target-missing')
    const view = await callTool(h, 'design_view', {}, h.root)
    expect(view.text).toContain('Chosen')
    const groups = await callTool(h, 'design_status', {}, h.root)
    expect(groups.variants[0].branches.find((branch: any) => branch.id === 'broken').valid).toBe(false)
  })

  it('reaches both disjoint nested groups through status and an explicit tool read', async () => {
    const h = await harness()
    await setup(
      h,
      `<Screen id="home">
  <Variants id="layout" chosen="one">
    <Variant branch="one"><Stack><Variants id="left" chosen="a"><Variant branch="a"><Text>Left A</Text></Variant><Variant branch="b"><Text>Left B</Text></Variant></Variants></Stack></Variant>
    <Variant branch="two"><Stack><Variants id="right" chosen="a"><Variant branch="a"><Text>Right A</Text></Variant><Variant branch="b"><Text>Right B</Text></Variant></Variants></Stack></Variant>
  </Variants>
</Screen>`,
    )
    const status = await callTool(h, 'design_status', {}, h.root)
    const groups = new Map(status.variants.map((group: any) => [group.path, group]))
    expect(groups.get('layout/left').branches.every((branch: any) => branch.valid)).toBe(true)
    expect(groups.get('layout/right').branches.every((branch: any) => branch.valid)).toBe(true)
    const right = await callTool(h, 'design_view', { variant: 'layout/right:b' }, h.root)
    expect(right.text).toContain('Right B')
    expect(right.variant).toMatchObject({ path: 'layout/right', branch: 'b', chosen: false })
    const left = await callTool(h, 'design_view', { variant: 'layout/left:b' }, h.root)
    expect(left.text).toContain('Left B')
  })

  it('uses the selected whole-screen projection states for view, screenshot, and payload', async () => {
    const h = await harness()
    await setup(
      h,
      `<Variants id="layout" chosen="compact">
  <Variant branch="compact"><Screen id="home" title="Home" states={{ "compact-open": { open: ["compact-drawer"] } }}><Stack><Text>Compact screen</Text><Drawer id="compact-drawer" title="Compact"><Text>Compact drawer</Text></Drawer></Stack></Screen></Variant>
  <Variant branch="spacious"><Screen id="home" title="Home" states={{ "exclusive": { open: ["spacious-drawer"] } }}><Stack><Text>Spacious screen</Text><Drawer id="spacious-drawer" title="Spacious"><Text>Spacious drawer</Text></Drawer></Stack></Screen></Variant>
</Variants>`,
    )
    const alternate = await callTool(h, 'design_view', { variant: 'layout:spacious', state: 'exclusive' }, h.root)
    expect(alternate.error).toBeUndefined()
    expect(alternate.text).toContain('Spacious drawer')
    const wrong = await callTool(h, 'design_view', { variant: 'layout:compact', state: 'exclusive' }, h.root)
    expect(wrong.error).toContain('does not declare state')
    if (chromiumPath !== undefined) {
      const shot = await callTool(
        h,
        'design_screenshot',
        { screen: 'home', variant: 'layout:spacious', state: 'exclusive' },
        h.root,
      )
      expect(shot.variant.branch).toBe('spacious')
    }
    const project = await loadProject({
      folder: join(h.root, 'design'),
      kit: kitMetadata,
      installedKitVersion: '1.0.0',
    })
    const payload = buildPayload('s', 1, '1.0.0', project, undefined, {
      screen: 'home',
      group: 'layout',
      branch: 'spacious',
    })
    expect((payload.screens[0] as any).states.map((state: any) => state.name)).toEqual(['exclusive'])
    expect((payload.screens[0] as any).variantStale).toBeUndefined()
  })

  it('keeps a stale preview snapshot but rejects it for current agent checks', async () => {
    const h = await harness()
    const valid = [
      '<Screen id="home">',
      '  <Variants id="layout" chosen="compact">',
      '    <Variant branch="compact"><Text>Chosen compact</Text></Variant>',
      '    <Variant branch="spacious"><Text>Last valid alternate</Text></Variant>',
      '  </Variants>',
      '</Screen>',
    ].join('\n')
    await setup(h, valid)
    h.registry.learnSession('one', h.root)
    const runtime = (await h.registry.forSession('one'))!
    await runtime.get()
    await writeFile(
      join(h.root, 'design', 'screens', 'home.dsx'),
      [
        '<Screen id="home">',
        '  <Variants id="layout" chosen="compact">',
        '    <Variant branch="compact"><Text>Chosen compact</Text></Variant>',
        '    <Variant branch="spacious"><Button id="broken" onPress={open("missing")}>Broken</Button></Variant>',
        '  </Variants>',
        '</Screen>',
      ].join('\n'),
    )
    const project = await runtime.reload()
    const screen = project.screens[0]!
    const spacious = screen.variants?.[0]?.branches.find((branch) => branch.id === 'spacious')
    expect(spacious?.valid).toBe(false)
    expect(spacious?.stale).toBe(true)
    const status = await callTool(h, 'design_status', {}, h.root)
    expect(status.variants[0].branches.find((branch: any) => branch.id === 'spacious').stale).toBe(true)
    const rejected = await callTool(h, 'design_view', { variant: 'layout:spacious' }, h.root)
    expect(rejected.error).toContain('validation errors')
    const payload = buildPayload('s', 1, '1.0.0', project, undefined, {
      screen: 'home',
      group: 'layout',
      branch: 'spacious',
    })
    expect(JSON.stringify((payload.screens[0] as any).root)).toContain('Last valid alternate')
    expect((payload.screens[0] as any).variantStale).toBe(true)
  })

  it('keeps inactive nested defaults and good siblings through invalid then repair', async () => {
    const h = await harness()
    await setup(
      h,
      `<Screen id="home">
  <Variants id="layout" chosen="one">
    <Variant branch="one"><Stack><Variants id="left" chosen="a"><Variant branch="a"><Text>Left A</Text></Variant><Variant branch="b"><Text>Left B</Text></Variant></Variants></Stack></Variant>
    <Variant branch="two"><Stack><Variants id="right" chosen="a"><Variant branch="a"><Text>Right A</Text></Variant><Variant branch="b"><Text>Right B</Text></Variant></Variants></Stack></Variant>
  </Variants>
</Screen>`,
    )
    h.registry.learnSession('one', h.root)
    const runtime = (await h.registry.forSession('one'))!
    await runtime.get()
    const initial = await callTool(h, 'design_view', { variant: 'layout/right:a' }, h.root)
    expect(initial.text).toContain('Right A')
    expect(initial.variant).toMatchObject({ path: 'layout/right', branch: 'a', chosen: true })

    await writeFile(
      join(h.root, 'design', 'screens', 'home.dsx'),
      `<Screen id="home">
  <Variants id="layout" chosen="one">
    <Variant branch="one"><Stack><Variants id="left" chosen="a"><Variant branch="a"><Text>Left A</Text></Variant><Variant branch="b"><Text>Left B</Text></Variant></Variants></Stack></Variant>
    <Variant branch="two"><Stack><Variants id="right" chosen="a"><Variant branch="a"><Text>Right A</Text></Variant><Variant branch="b"><Button id="broken-right" onPress={open("missing")}>Broken right</Button></Variant></Variants></Stack></Variant>
  </Variants>
</Screen>`,
    )
    await runtime.reload()
    const status = await callTool(h, 'design_status', {}, h.root)
    const right = status.variants.find((group: any) => group.path === 'layout/right')
    expect(right.branches.find((branch: any) => branch.id === 'a').valid).toBe(true)
    expect(right.branches.find((branch: any) => branch.id === 'b').valid).toBe(false)
    expect(right.branches.find((branch: any) => branch.id === 'b').stale).toBe(true)
    const goodSibling = await callTool(h, 'design_view', { variant: 'layout/right:a' }, h.root)
    expect(goodSibling.text).toContain('Right A')
    const broken = await callTool(h, 'design_view', { variant: 'layout/right:b' }, h.root)
    expect(broken.error).toContain('validation errors')

    await writeFile(
      join(h.root, 'design', 'screens', 'home.dsx'),
      `<Screen id="home">
  <Variants id="layout" chosen="one">
    <Variant branch="one"><Stack><Variants id="left" chosen="a"><Variant branch="a"><Text>Left A</Text></Variant><Variant branch="b"><Text>Left B</Text></Variant></Variants></Stack></Variant>
    <Variant branch="two"><Stack><Variants id="right" chosen="a"><Variant branch="a"><Text>Right A</Text></Variant><Variant branch="b"><Text>Right B</Text></Variant></Variants></Stack></Variant>
  </Variants>
</Screen>`,
    )
    await runtime.reload()
    const repaired = await callTool(h, 'design_view', { variant: 'layout/right:b' }, h.root)
    expect(repaired.text).toContain('Right B')
  })

  it('rejects retained projections for every current dispatcher and restores after repair', async () => {
    const h = await harness()
    const valid = [
      '<Screen id="home">',
      '  <Variants id="layout" chosen="compact">',
      '    <Variant branch="compact"><Text>Chosen compact</Text></Variant>',
      '    <Variant branch="spacious"><Text>Spacious current</Text></Variant>',
      '  </Variants>',
      '</Screen>',
    ].join('\n')
    await setup(h, valid)
    h.registry.learnSession('one', h.root)
    const runtime = (await h.registry.forSession('one'))!
    await runtime.get()
    await writeFile(
      join(h.root, 'design', 'screens', 'home.dsx'),
      '<Screen id="home"><Variants id="layout" chosen="missing"></Variants></Screen>',
    )
    const broken = await runtime.reload()
    const screen = broken.screens[0]!
    expect(screen.variantDocumentCurrent).toBe(false)
    expect(screen.variantStale).toBe(true)
    const status = await callTool(h, 'design_status', {}, h.root)
    const layout = status.variants.find((group: any) => group.path === 'layout')
    expect(layout.branches.every((branch: any) => branch.stale === true)).toBe(true)
    const payload = buildPayload('s', 1, '1.0.0', broken, undefined, {
      screen: 'home',
      group: 'layout',
      branch: 'spacious',
    })
    expect(JSON.stringify((payload.screens[0] as any).root)).toContain('Spacious current')
    expect((payload.screens[0] as any).variantStale).toBe(true)
    expect((payload.screens[0] as any).diagnostics.some((entry: any) => entry.severity === 'error')).toBe(true)

    const view = await callTool(h, 'design_view', { variant: 'layout:spacious' }, h.root)
    expect(view.error).toContain('retained variant data')
    const query = callTool(h, 'design_query', { id: 'action', variant: 'layout:spacious' }, h.root)
    await expect(query).rejects.toThrow(/retained variant data/)
    const diff = await callTool(
      h,
      'design_diff',
      { screen: 'home', group: 'layout', from: 'compact', to: 'spacious' },
      h.root,
    )
    expect(diff.ok).toBe(false)
    expect(JSON.stringify(diff.diagnostics)).toContain('retained variant data')
    await expect(
      callTool(h, 'design_screenshot', { screen: 'home', variant: 'layout:spacious' }, h.root),
    ).rejects.toThrow(/retained variant data/)

    await writeFile(
      join(h.root, 'design', 'screens', 'home.dsx'),
      valid.replace('Spacious current', 'Spacious repaired'),
    )
    await runtime.reload()
    const repaired = await callTool(h, 'design_view', { variant: 'layout:spacious' }, h.root)
    expect(repaired.text).toContain('Spacious repaired')
    expect(repaired.variant.branch).toBe('spacious')
  })

  it.skipIf(chromiumPath === undefined)(
    'renders the prior valid nested default with diagnostics after an invalid drawer reference and recovers',
    async () => {
      const h = await harness()
      const valid = [
        '<Screen id="home">',
        '  <Variants id="layout" chosen="one">',
        '    <Variant branch="one"><Text>Layout one</Text></Variant>',
        '    <Variant branch="two"><Stack><Variants id="right" chosen="a">',
        '      <Variant branch="a"><Stack><Text>Prior valid right</Text><Drawer id="right-drawer" title="Right"><Text>Right drawer</Text></Drawer></Stack></Variant>',
        '      <Variant branch="b"><Text>Right B</Text></Variant>',
        '    </Variants></Stack></Variant>',
        '  </Variants>',
        '</Screen>',
      ].join('\n')
      const invalid = valid.replace(
        '<Variant branch="a"><Stack><Text>Prior valid right</Text><Drawer id="right-drawer" title="Right"><Text>Right drawer</Text></Drawer></Stack></Variant>',
        '<Variant branch="a"><Stack><Text>Invalid right body</Text><Button id="broken-right" onPress={open("missing-right")}>Broken</Button></Stack></Variant>',
      )
      await setup(h, valid)
      h.registry.learnSession('one', h.root)
      const runtime = (await h.registry.forSession('one'))!
      const first = await runtime.get()
      const firstPayload = await payloadFor(first, 'nested-render', {
        screen: 'home',
        group: 'layout/right',
        branch: 'a',
      })
      const firstText = await h.service.browsers.run(
        {
          sessionId: 'nested-render',
          payload: firstPayload,
          assetsDir,
          screen: 'home',
          breakpoint: 'desktop',
          breakpointWidth: 1280,
        },
        async (page) => (await page.locator('.dsx-frame').innerText()).trim(),
      )
      expect(firstText).toContain('Prior valid right')

      await writeFile(join(h.root, 'design', 'screens', 'home.dsx'), invalid)
      const broken = await runtime.reload()
      const brokenPayload = await payloadFor(broken, 'nested-render', {
        screen: 'home',
        group: 'layout/right',
        branch: 'a',
      })
      expect((brokenPayload.screens[0] as any).variantStale).toBe(true)
      const rendered = await h.service.browsers.run(
        {
          sessionId: 'nested-render',
          payload: brokenPayload,
          assetsDir,
          screen: 'home',
          breakpoint: 'desktop',
          breakpointWidth: 1280,
        },
        async (page) => ({
          text: (await page.locator('.dsx-frame').innerText()).trim(),
          overlay: (await page.locator('.dsx-overlay').innerText()).trim(),
        }),
      )
      expect(rendered.text).toContain('Prior valid right')
      expect(rendered.text).not.toContain('Invalid right body')
      expect(rendered.overlay).toContain('missing-right')

      await writeFile(
        join(h.root, 'design', 'screens', 'home.dsx'),
        valid.replace('Prior valid right', 'Repaired right'),
      )
      const repaired = await runtime.reload()
      const repairedPayload = await payloadFor(repaired, 'nested-render', {
        screen: 'home',
        group: 'layout/right',
        branch: 'a',
      })
      const repairedText = await h.service.browsers.run(
        {
          sessionId: 'nested-render',
          payload: repairedPayload,
          assetsDir,
          screen: 'home',
          breakpoint: 'desktop',
          breakpointWidth: 1280,
        },
        async (page) => (await page.locator('.dsx-frame').innerText()).trim(),
      )
      expect(repairedText).toContain('Repaired right')
    },
  )

  it('projects and queries the chosen or an explicit branch', async () => {
    const h = await harness()
    await setup(h)
    const chosen = await callTool(h, 'design_view', {}, h.root)
    expect(chosen.text).toContain('Compact branch')
    expect(chosen.text).not.toContain('Spacious branch')
    const alternate = await callTool(h, 'design_view', { variant: 'layout:spacious' }, h.root)
    expect(alternate.text).toContain('Spacious branch')
    expect(alternate.variant).toMatchObject({ group: 'layout', path: 'layout', branch: 'spacious', chosen: false })
    const chosenOnly = await callTool(h, 'design_query', { id: 'compact-only' }, h.root)
    expect(chosenOnly.total).toBe(1)
    const missing = await callTool(h, 'design_query', { id: 'spacious-only' }, h.root)
    expect(missing.total).toBe(0)
    const alternateOnly = await callTool(h, 'design_query', { id: 'spacious-only', variant: 'layout:spacious' }, h.root)
    expect(alternateOnly.total).toBe(1)
    expect(alternateOnly.variant.branch).toBe('spacious')
  })

  it('rejects unknown selections and incompatible states with actionable diagnostics', async () => {
    const h = await harness()
    await setup(h)
    const unknown = await callTool(h, 'design_view', { variant: 'layout:tiny' }, h.root)
    expect(unknown.error).toContain('does not declare branch')
    await expect(
      callTool(h, 'design_screenshot', { screen: 'home', variant: 'layout:spacious', state: 'drawer-open' }, h.root),
    ).rejects.toThrow(/incompatible/i)
  })

  it('captures distinct deterministic screenshots for chosen and alternate branches', async () => {
    if (chromiumPath === undefined) return
    const h = await harness()
    await setup(h)
    const chosen = await callTool(h, 'design_screenshot', { screen: 'home', breakpoint: 'mobile' }, h.root)
    const alternate = await callTool(
      h,
      'design_screenshot',
      { screen: 'home', breakpoint: 'mobile', variant: 'layout:spacious' },
      h.root,
    )
    expect(chosen.path).not.toBe(alternate.path)
    expect(alternate.variant.branch).toBe('spacious')
    expect(alternate.path).toContain('layout-spacious')
    expect(alternate.width).toBe(390)
    expect(chosen.bytes).not.toBe(alternate.bytes)
  })
})

describe('synthetic variants example', () => {
  it('loads with zero errors and diffs the visible branch move', async () => {
    const folder = fileURLToPath(new URL('../../../examples/synthetic-variants/design', import.meta.url))
    const project = await loadProject({ folder, kit: kitMetadata, installedKitVersion: '1.0.0' })
    expect(project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
    const screen = project.screens.find((candidate) => candidate.id === 'catalog')!
    expect(screen.variants?.[0]?.chosen).toBe('compact')
    expect(screen.variants?.[0]?.branches.every((branch) => branch.valid)).toBe(true)
    const diff = diffVariantBranches(project, 'catalog', 'layout', 'compact', 'spacious')
    expect(diff.ok).toBe(true)
    expect(diff.moves).toContainEqual(expect.objectContaining({ node: 'checkout', reason: 'parent' }))
    expect(diff.changes).toContainEqual(expect.objectContaining({ node: 'checkout', kind: 'text', after: 'Continue' }))
  })
})
