import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  extractNamedStates,
  fingerprintDesignTree,
  loadProject,
  parseScreen,
  resolveHandoffPlan,
} from '@filipeesch/dsh-design-core'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { callTool, createHarness, type HostHarness } from './harness.ts'
import { runHandoff } from '../src/handoff.ts'
import { fingerprintFolder } from '../src/runtime.ts'

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
const assetsDir = fileURLToPath(new URL('../../renderer/dist/', import.meta.url))
const harnesses: HostHarness[] = []

async function harness(): Promise<HostHarness> {
  const created = await createHarness({
    assetsDir,
    ...(chromiumPath === undefined ? {} : { chromiumPath }),
  })
  harnesses.push(created)
  return created
}

afterEach(() => {
  for (const created of harnesses.splice(0)) created.close()
})

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3nWQAAAABJRU5ErkJggg==',
  'base64',
)

const checkoutSource = `<Screen id="checkout" title="Checkout" states={{ "review-open": { open: ["review-drawer"], values: { email: "ada@example.com" } } }}>
  <Header title="Checkout" />
  <Stack id="form" gap="spacing.md" padding="spacing.md" background="color.canvas">
    <Image id="logo" src="logo.png" alt="Synthetic logo" />
    <Input id="email" label="Email" type="email" placeholder="you@example.com" />
    <Button id="place-order" variant="primary" size="lg" onPress={navigate("confirmation")}>Place order</Button>
  </Stack>
  <Variants id="layout" chosen="compact">
    <Variant branch="compact"><Stack gap="spacing.sm"><Text id="compact-copy">Compact chosen</Text></Stack></Variant>
    <Variant branch="spacious"><Stack gap="spacing.lg"><Text id="spacious-copy">Spacious discarded</Text></Stack></Variant>
  </Variants>
  <Drawer id="review-drawer" title="Order review">
    <Stack gap="spacing.sm"><Text>Review chosen</Text><Button id="close-review" onPress={close("review-drawer")}>Keep editing</Button></Stack>
  </Drawer>
</Screen>`

const confirmationSource = '<Screen id="confirmation" title="Confirmation"><Text id="thanks">Thanks</Text></Screen>'

const catalogSource =
  '<Screen id="catalog" title="Catalog"><Text id="catalog-title">Catalog</Text><Button id="open-cart" onPress={navigate("checkout")}>Review order</Button></Screen>'

const settingsSource = '<Screen id="settings" title="Settings"><Text>Unrelated settings</Text></Screen>'

const tokens = {
  color: { action: { $value: '#2563eb', $type: 'color' }, canvas: { $value: '#f8fafc', $type: 'color' } },
  spacing: { sm: { $value: '8px', $type: 'dimension' }, md: { $value: '16px', $type: 'dimension' } },
}

async function setupProject(root: string, options: { invalid?: boolean } = {}): Promise<void> {
  const design = join(root, 'design')
  await mkdir(join(design, 'screens'), { recursive: true })
  await mkdir(join(design, 'journeys'), { recursive: true })
  await mkdir(join(design, '.cache', 'capture'), { recursive: true })
  await mkdir(join(design, '.discarded'), { recursive: true })
  await writeFile(
    join(design, 'design.json'),
    JSON.stringify({ kitVersion: '1.0.0', breakpoints: { mobile: 390, desktop: 1280 }, entry: 'checkout' }, null, 2),
  )
  await writeFile(join(design, 'tokens.json'), JSON.stringify(tokens, null, 2))
  await writeFile(
    join(design, 'screens', 'checkout.dsx'),
    options.invalid ? '<Screen id="checkout"><Buton /></Screen>' : checkoutSource,
  )
  await writeFile(join(design, 'screens', 'confirmation.dsx'), confirmationSource)
  await writeFile(join(design, 'screens', 'catalog.dsx'), catalogSource)
  await writeFile(join(design, 'screens', 'settings.dsx'), settingsSource)
  await writeFile(join(design, 'logo.png'), ONE_PIXEL_PNG)
  await writeFile(
    join(design, 'journeys', 'checkout-review.dsx'),
    '<Journey id="checkout-review" start="checkout" state="review-open" breakpoint="mobile"><ExpectVisible target="review-drawer" visible={true} /><ExpectValue target="email" value="ada@example.com" /><Tap target="close-review" /><ExpectVisible target="review-drawer" visible={false} /></Journey>',
  )
  await writeFile(
    join(design, 'journeys', 'checkout-to-confirmation.dsx'),
    '<Journey id="checkout-to-confirmation" start="checkout" breakpoint="desktop"><Tap target="place-order" /><ExpectScreen screen="confirmation" /></Journey>',
  )
  await writeFile(
    join(design, 'journeys', 'catalog-to-confirmation.dsx'),
    '<Journey id="catalog-to-confirmation" start="catalog" breakpoint="mobile"><Tap target="open-cart" /><ExpectScreen screen="checkout" /><Tap target="place-order" /><ExpectScreen screen="confirmation" /></Journey>',
  )
  await writeFile(
    join(design, 'journeys', 'settings-flow.dsx'),
    '<Journey id="settings-flow" start="settings" breakpoint="mobile"><ExpectScreen screen="settings" /></Journey>',
  )
  await writeFile(join(design, '.cache', 'capture', 'poison.json'), 'SHOULD NOT APPEAR IN HANDOFF')
  await writeFile(
    join(design, '.discarded', 'rejected.dsx'),
    '<Screen id="rejected"><Text>SHOULD NOT APPEAR IN HANDOFF</Text></Screen>',
  )
}

async function filesBelow(root: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>()
  const visit = async (directory: string, prefix = ''): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = prefix === '' ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) await visit(join(directory, entry.name), path)
      else if (entry.isFile()) result.set(path, await readFile(join(directory, entry.name)))
    }
  }
  await visit(root)
  return result
}

function verifyManifestFiles(manifest: any, files: Map<string, Buffer>): void {
  const expected = manifest.files.map((file: any) => file.path)
  expect(expected).toEqual([...expected].sort((left: string, right: string) => left.localeCompare(right)))
  const actual = [...files.keys()]
    .filter((path) => path !== 'manifest.json')
    .sort((left, right) => left.localeCompare(right))
  expect(actual).toEqual(expected)
  for (const entry of manifest.files) {
    const buffer = files.get(entry.path)
    expect(buffer).toBeDefined()
    expect(buffer!.length).toBe(entry.bytes)
  }
}

describe('design handoff', () => {
  it('resolves explicit and bounded selections without rendering', async () => {
    const h = await harness()
    await setupProject(h.root)
    const explicit = await callTool(h, 'design_handoff', { screens: ['missing'], breakpoints: ['mobile'] }, h.root)
    expect(explicit.status).toBe('error')
    expect(explicit.errorCode).toBe('unknown-screen')
    const missingState = await callTool(
      h,
      'design_handoff',
      { screens: ['checkout'], states: ['nope'], breakpoints: ['mobile'] },
      h.root,
    )
    expect(missingState.errorCode).toBe('unknown-state')
    const missingBreakpoint = await callTool(
      h,
      'design_handoff',
      { screens: ['checkout'], breakpoints: ['print'] },
      h.root,
    )
    expect(missingBreakpoint.errorCode).toBe('unknown-breakpoint')
  })

  it.skipIf(chromiumPath === undefined)(
    'publishes chosen-only DSX, support inputs, journeys, boxes and matching screenshots with a verified round trip',
    async () => {
      const h = await harness()
      await setupProject(h.root)
      const before = await fingerprintFolder(join(h.root, 'design'))
      const result = await callTool(
        h,
        'design_handoff',
        { screens: ['checkout'], states: ['review-open'], breakpoints: ['mobile'] },
        h.root,
      )
      expect(result).toMatchObject({ status: 'ok' })
      expect(JSON.stringify(result).length).toBeLessThan(4000)
      expect(result.package).toMatch(/^design\/\.cache\/handoff\/[a-f0-9]{64}$/)
      expect(result.projections).toBe(1)
      expect(result.manifest).toBe(result.package + '/manifest.json')
      expect(result.warnings.some((warning: string) => warning.includes('confirmation'))).toBe(true)

      const packageDir = join(h.root, result.package)
      const files = await filesBelow(packageDir)
      const manifest = JSON.parse(await readFile(join(packageDir, 'manifest.json'), 'utf8'))
      expect(manifest.format).toBe('dsh-design-handoff/v1')
      expect(manifest.selection.screens).toEqual(['checkout'])
      expect(manifest.selection.states).toEqual(['review-open'])
      expect(manifest.selection.breakpoints).toEqual(['mobile'])
      expect(manifest.projections).toHaveLength(1)
      expect(manifest.projections[0]).toMatchObject({
        screen: 'checkout',
        state: 'review-open',
        stateName: 'review-open',
        breakpoint: { name: 'mobile', width: 390, height: 900 },
        canvas: { width: 390 },
        layout: 'layout/8_checkout_11_review-open_6_mobile.json',
        screenshot: 'screenshots/8_checkout_11_review-open_6_mobile.png',
      })
      expect(manifest.kit).toMatchObject({ pin: '1.0.0' })
      expect(manifest.renderer.pipeline).toBe('deterministic-preview')
      expect(manifest.environment).toMatchObject({
        engine: 'chromium',
        viewportHeight: 900,
        locale: 'en-US',
        timezone: 'UTC',
      })
      expect(manifest.journeys.map((journey: any) => journey.id)).toEqual([
        'catalog-to-confirmation',
        'checkout-review',
        'checkout-to-confirmation',
      ])
      const crossScreen = manifest.journeys.find((journey: any) => journey.id === 'checkout-to-confirmation')
      expect(crossScreen.outsideScreens).toEqual(['confirmation'])
      expect(manifest.support.screens.map((screen: any) => screen.id)).toEqual(['catalog', 'confirmation'])
      expect(manifest.support.screens.every((screen: any) => screen.reasons.length > 0)).toBe(true)
      expect(manifest.support.breakpoints).toEqual([
        { name: 'mobile', width: 390 },
        { name: 'desktop', width: 1280 },
      ])
      expect(
        manifest.screens.filter((screen: any) => screen.role === 'supporting').map((screen: any) => screen.id),
      ).toEqual(['catalog', 'confirmation'])
      expect(files.has('screens/catalog.dsx')).toBe(true)
      expect(files.has('screens/confirmation.dsx')).toBe(true)
      expect(files.has('screens/settings.dsx')).toBe(false)
      expect(manifest.journeys.some((journey: any) => journey.id === 'settings-flow')).toBe(false)
      expect(crossScreen.steps).toEqual([
        { kind: 'tap', target: 'place-order' },
        { kind: 'expect-screen', screen: 'confirmation' },
      ])
      verifyManifestFiles(manifest, files)
      expect(JSON.stringify(manifest)).not.toContain(h.root)
      expect(JSON.stringify(manifest)).not.toContain('SHOULD NOT APPEAR')
      expect(JSON.stringify(manifest)).not.toContain('createdAt')
      expect(manifest.files.some((file: any) => file.path.includes('.cache') || file.path.includes('.discarded'))).toBe(
        false,
      )

      const dsx = await readFile(join(packageDir, 'screens', 'checkout.dsx'), 'utf8')
      expect(dsx).toContain('Compact chosen')
      expect(dsx).not.toContain('Spacious discarded')
      expect(dsx).not.toContain('<Variants')
      expect(dsx).not.toContain('SHOULD NOT APPEAR')
      expect(dsx).toContain('close("review-drawer")')
      expect(dsx).toContain('states={')
      const parsed = parseScreen(dsx, 'screens/checkout.dsx')
      expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toHaveLength(0)
      const extracted = extractNamedStates(parsed.root!, 'screens/checkout.dsx', kitMetadata)
      expect(extracted.states.map((state) => state.name)).toEqual(['review-open'])
      expect(extracted.states[0]!.values).toMatchObject({ email: 'ada@example.com' })
      const loaded = await loadProject({
        folder: join(h.root, 'design'),
        kit: kitMetadata,
        installedKitVersion: KIT_VERSION,
      })
      const chosen = loaded.screens.find((screen) => screen.id === 'checkout')!
      expect(fingerprintDesignTree(extracted.root)).toBe(fingerprintDesignTree(chosen.root!))

      expect(await readFile(join(packageDir, 'tokens.json'), 'utf8')).toBe(
        await readFile(join(h.root, 'design', 'tokens.json'), 'utf8'),
      )
      const resolved = JSON.parse(await readFile(join(packageDir, 'tokens.resolved.json'), 'utf8'))
      expect(resolved.tokens.map((token: any) => token.path)).toEqual([
        'color.action',
        'color.canvas',
        'spacing.md',
        'spacing.sm',
      ])
      expect(files.has('logo.png')).toBe(true)
      const generatedConfig = JSON.parse(await readFile(join(packageDir, 'design.json'), 'utf8'))
      expect(generatedConfig.breakpoints).toEqual({ mobile: 390, desktop: 1280 })
      expect(generatedConfig.entry).toBe('checkout')

      const layout = JSON.parse(await readFile(join(packageDir, manifest.projections[0].layout), 'utf8'))
      expect(layout.canvas).toMatchObject({ width: 390 })
      expect(layout.nodes.length).toBeGreaterThan(0)
      expect(layout.truncated).toBe(false)
      const png = await readFile(join(packageDir, manifest.projections[0].screenshot))
      expect(png.toString('ascii', 1, 4)).toBe('PNG')
      expect(png.readUInt32BE(16)).toBe(390)

      const reopen = await harness()
      await rm(join(reopen.root, 'design'), { recursive: true, force: true })
      await cp(packageDir, join(reopen.root, 'design'), { recursive: true })
      const validation = await callTool(reopen, 'design_validate', {}, reopen.root)
      expect(validation.errors).toBe(0)
      expect(validation.diagnostics).toEqual([])
      const reviewJourney = await callTool(reopen, 'design_run_journey', { journey: 'checkout-review' }, reopen.root)
      expect(reviewJourney.ok).toBe(true)
      const catalogJourney = await callTool(
        reopen,
        'design_run_journey',
        { journey: 'catalog-to-confirmation' },
        reopen.root,
      )
      expect(catalogJourney.ok).toBe(true)

      const after = await fingerprintFolder(join(h.root, 'design'))
      expect([...after.entries()]).toEqual([...before.entries()])
      expect(await readFile(join(h.root, 'design', '.cache', 'capture', 'poison.json'), 'utf8')).toContain(
        'SHOULD NOT APPEAR',
      )

      const repeated = await callTool(
        h,
        'design_handoff',
        { screens: ['checkout'], states: ['review-open'], breakpoints: ['mobile'] },
        h.root,
      )
      expect(repeated.status).toBe('ok')
      expect(repeated.id).toBe(result.id)
      expect(repeated.reused).toBe(true)
      expect([...(await filesBelow(packageDir)).entries()]).toEqual([...files.entries()])

      await rm(packageDir, { recursive: true, force: true })
      const regenerated = await callTool(
        h,
        'design_handoff',
        { screens: ['checkout'], states: ['review-open'], breakpoints: ['mobile'] },
        h.root,
      )
      expect(regenerated.id).toBe(result.id)
      expect([...(await filesBelow(join(h.root, regenerated.package))).entries()]).toEqual([...files.entries()])

      const desktop = await callTool(
        h,
        'design_handoff',
        { screens: ['checkout'], states: ['$default'], breakpoints: ['desktop'] },
        h.root,
      )
      expect(desktop.status).toBe('ok')
      expect(desktop.id).not.toBe(result.id)
      expect(await readFile(join(h.root, result.package, 'manifest.json'), 'utf8')).toBeTruthy()

      await writeFile(
        join(h.root, 'design', 'screens', 'checkout.dsx'),
        checkoutSource.replace('Compact chosen', 'Compact changed'),
      )
      const changed = await callTool(
        h,
        'design_handoff',
        { screens: ['checkout'], states: ['review-open'], breakpoints: ['mobile'] },
        h.root,
      )
      expect(changed.status).toBe('ok')
      expect(changed.id).not.toBe(result.id)
      expect(await readFile(join(h.root, result.package, 'manifest.json'), 'utf8')).toBeTruthy()
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'produces identical package bytes in a different synthetic workspace',
    async () => {
      const first = await harness()
      const second = await harness()
      await setupProject(first.root)
      await setupProject(second.root)
      const selection = { screens: ['checkout'], states: ['$default'], breakpoints: ['mobile'] }
      const one = await callTool(first, 'design_handoff', selection, first.root)
      const two = await callTool(second, 'design_handoff', selection, second.root)
      expect(one.status).toBe('ok')
      expect(two.status).toBe('ok')
      expect(two.id).toBe(one.id)
      expect(two.manifest).toBe(two.package + '/manifest.json')
      const oneFiles = await filesBelow(join(first.root, one.package))
      const twoFiles = await filesBelow(join(second.root, two.package))
      expect([...twoFiles.keys()]).toEqual([...oneFiles.keys()])
      for (const [path, bytes] of oneFiles) expect(twoFiles.get(path)!.equals(bytes)).toBe(true)
    },
  )

  it('rejects support bytes that changed after the project snapshot was validated', async () => {
    const tokenHarness = await harness()
    await setupProject(tokenHarness.root)
    const tokenFolder = join(tokenHarness.root, 'design')
    const tokenProject = await loadProject({
      folder: tokenFolder,
      kit: kitMetadata,
      installedKitVersion: KIT_VERSION,
    })
    const tokenPlan = resolveHandoffPlan(tokenProject, {
      screens: ['checkout'],
      states: ['review-open'],
      breakpoints: ['mobile'],
      kit: kitMetadata,
    })
    const tokenJson = JSON.parse(await readFile(join(tokenFolder, 'tokens.json'), 'utf8'))
    tokenJson.color.action.$value = '#000000'
    await writeFile(join(tokenFolder, 'tokens.json'), JSON.stringify(tokenJson, null, 2))
    await expect(
      runHandoff({
        folder: tokenFolder,
        project: tokenProject,
        plan: tokenPlan,
        ctx: {
          sessionId: 'token-mutation',
          browsers: tokenHarness.service.browsers,
          assetsDir: tokenHarness.service.assetsDir,
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid-source' })

    const journeyHarness = await harness()
    await setupProject(journeyHarness.root)
    const journeyFolder = join(journeyHarness.root, 'design')
    const journeyProject = await loadProject({
      folder: journeyFolder,
      kit: kitMetadata,
      installedKitVersion: KIT_VERSION,
    })
    const journeyPlan = resolveHandoffPlan(journeyProject, {
      screens: ['checkout'],
      states: ['review-open'],
      breakpoints: ['mobile'],
      kit: kitMetadata,
    })
    await writeFile(
      join(journeyFolder, 'journeys', 'checkout-review.dsx'),
      '<Journey id="checkout-review" start="checkout" state="review-open" breakpoint="mobile"><ExpectVisible target="missing" visible={true} /></Journey>',
    )
    await expect(
      runHandoff({
        folder: journeyFolder,
        project: journeyProject,
        plan: journeyPlan,
        ctx: {
          sessionId: 'journey-mutation',
          browsers: journeyHarness.service.browsers,
          assetsDir: journeyHarness.service.assetsDir,
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid-source' })
    await expect(readdir(join(journeyFolder, '.cache', 'handoff'))).rejects.toThrow()
  })

  it.skipIf(chromiumPath === undefined)(
    'distinguishes a named default state from the explicit unnamed selector',
    async () => {
      const h = await harness()
      const design = join(h.root, 'design')
      await writeFile(
        join(design, 'design.json'),
        JSON.stringify({ kitVersion: '1.0.0', breakpoints: { mobile: 390 }, entry: 'stateful' }, null, 2),
      )
      await writeFile(join(design, 'tokens.json'), '{}')
      await writeFile(
        join(design, 'screens', 'stateful.dsx'),
        '<Screen id="stateful" states={{ "default": {} }}><Text>Stateful</Text></Screen>',
      )
      const named = await callTool(
        h,
        'design_handoff',
        { screens: ['stateful'], states: ['default'], breakpoints: ['mobile'] },
        h.root,
      )
      expect(named.status).toBe('ok')
      const namedManifest = JSON.parse(await readFile(join(h.root, named.manifest), 'utf8'))
      expect(named.states).toEqual(['default'])
      expect(namedManifest.projections[0]).toMatchObject({ state: 'default', stateName: 'default' })
      const unnamed = await callTool(
        h,
        'design_handoff',
        { screens: ['stateful'], states: ['$default'], breakpoints: ['mobile'] },
        h.root,
      )
      expect(unnamed.status).toBe('ok')
      const unnamedManifest = JSON.parse(await readFile(join(h.root, unnamed.manifest), 'utf8'))
      expect(unnamed.states).toEqual(['$default'])
      expect(unnamedManifest.projections[0]).toMatchObject({ state: null, stateName: '$default' })
      expect(unnamed.id).not.toBe(named.id)
    },
  )

  it.skipIf(chromiumPath === undefined)(
    'rejects an invalid current source and refuses to reuse a corrupted partial package',
    async () => {
      const h = await harness()
      await setupProject(h.root)
      const ok = await callTool(
        h,
        'design_handoff',
        { screens: ['checkout'], states: ['$default'], breakpoints: ['mobile'] },
        h.root,
      )
      expect(ok.status).toBe('ok')
      await rm(join(h.root, ok.package, 'manifest.json'))
      const corrupt = await callTool(
        h,
        'design_handoff',
        { screens: ['checkout'], states: ['$default'], breakpoints: ['mobile'] },
        h.root,
      )
      expect(corrupt.status).toBe('error')
      expect(corrupt.errorCode).toBe('package-invalid')

      await setupProject(h.root, { invalid: true })
      const invalid = await callTool(
        h,
        'design_handoff',
        { screens: ['checkout'], states: ['$default'], breakpoints: ['mobile'] },
        h.root,
      )
      expect(invalid.status).toBe('error')
      expect(invalid.errorCode).toBe('invalid-screen')
    },
  )

  it.skipIf(chromiumPath === undefined)('rejects a matrix over the documented bound before rendering', async () => {
    const h = await harness()
    await setupProject(h.root)
    for (const id of ['alpha', 'beta', 'gamma']) {
      await writeFile(
        join(h.root, 'design', 'screens', id + '.dsx'),
        '<Screen id="' + id + '" states={{ "s1": {}, "s2": {}, "s3": {} }}><Text>' + id + '</Text></Screen>',
      )
    }
    const result = await callTool(h, 'design_handoff', {}, h.root)
    expect(result.status).toBe('error')
    expect(result.errorCode).toBe('projection-limit')
    expect(result.error).toContain('24')
  })
})
