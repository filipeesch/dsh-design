import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, callTool, type HostHarness } from './harness.ts'
import { BrowserSessions } from '../src/browser.ts'
import { runLint } from '../src/checks.ts'
import { findChromium } from './chromium.ts'

const assetsDir = fileURLToPath(new URL('../../renderer/dist/', import.meta.url))

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

const checkoutSource = `<Screen id="checkout" title="Checkout" states={{ "plan-open": { open: ["plans-drawer"], values: { name: "Ada" } } }}>
  <Header title="Checkout" />
  <Stack gap="spacing.md" padding="spacing.md">
    <Input id="name" label="Name" />
    <Select id="plan" label="Plan" options={fixture("plans")} />
    <Button id="confirm" onPress={navigate("done")}>Confirm</Button>
  </Stack>
  <Drawer id="plans-drawer" title="Plans"><Text>Plan details</Text><Button id="close-plans" onPress={close("plans-drawer")}>Close</Button></Drawer>
</Screen>`

const doneSource = '<Screen id="done" title="Done"><Text>Thanks</Text></Screen>'

const layoutSource = `<Screen id="layout" title="Layout">
  <Stack gap="spacing.sm" padding="spacing.sm">
    <Box id="wide" width={{ mobile: "500px", desktop: "400px" }} css="height: 40px" />
    <Box id="clip" css="width: 80px; height: 18px; overflow: hidden; white-space: nowrap"><Text>This label is much longer than its box</Text></Box>
    <Button id="tiny" css="width: 20px; height: 20px; padding: 0">T</Button>
    <Box id="overlap-a" margin={{ mobile: "0px 0px -20px 0px", desktop: "0px" }} css="width: 120px; height: 40px" />
    <Box id="overlap-b" css="width: 120px; height: 40px" />
    <Box id="nest-parent" css="padding: 12px"><Text>Nested text</Text></Box>
    <Button id="open-plans" onPress={open("plans")}>Plans</Button>
    <Box id="contain-a" css="width: 120px; height: 60px" />
    <Box id="contain-b" margin={{ mobile: "-50px 0px 0px 0px", desktop: "0px" }} css="width: 40px; height: 20px" />
  </Stack>
  <Drawer id="plans" title="Plans"><Text>Drawer body</Text></Drawer>
</Screen>`

const journeySource = `<Journey id="checkout-flow" start="checkout" state="plan-open" breakpoint="mobile">
  <ExpectVisible target="plans-drawer" visible={true} />
  <ExpectValue target="name" value="Ada" />
  <Tap target="close-plans" />
  <ExpectVisible target="plans-drawer" visible={false} />
  <Choose target="plan" value="pro" />
  <ExpectValue target="plan" value="pro" />
  <Tap target="confirm" />
  <ExpectScreen screen="done" />
</Journey>
<Journey id="failing-flow" start="checkout" state="plan-open" breakpoint="mobile">
  <ExpectVisible target="plans-drawer" visible={false} />
  <Tap target="confirm" />
</Journey>`

async function setup(h: HostHarness): Promise<void> {
  await writeFile(join(h.root, 'design', 'screens', 'checkout.dsx'), checkoutSource)
  await writeFile(join(h.root, 'design', 'screens', 'done.dsx'), doneSource)
  await writeFile(join(h.root, 'design', 'screens', 'layout.dsx'), layoutSource)
  await mkdir(join(h.root, 'design', 'fixtures'), { recursive: true })
  await writeFile(
    join(h.root, 'design', 'fixtures', 'plans.json'),
    JSON.stringify([
      { id: 'basic', label: 'Basic' },
      { id: 'pro', label: 'Pro' },
    ]),
  )
  await mkdir(join(h.root, 'design', 'journeys'), { recursive: true })
  // Two journeys cannot share one file; split them.
  await writeFile(
    join(h.root, 'design', 'journeys', 'checkout-flow.dsx'),
    journeySource.slice(0, journeySource.indexOf('<Journey id="failing-flow"')),
  )
  await writeFile(
    join(h.root, 'design', 'journeys', 'failing-flow.dsx'),
    journeySource.slice(journeySource.indexOf('<Journey id="failing-flow"')),
  )
  await writeFile(
    join(h.root, 'design', 'journeys', 'blocked-flow.dsx'),
    '<Journey id="blocked-flow" start="checkout" state="plan-open" breakpoint="mobile"><Tap target="confirm" /><ExpectScreen screen="done" /></Journey>',
  )
}

describe('browser-backed checks', () => {
  it.skipIf(chromiumPath === undefined)(
    'measures stable geometry and lint findings across breakpoints',
    async () => {
      const h = await harness()
      await setup(h)
      const mobile = await callTool(h, 'design_lint', { screen: 'layout', breakpoint: 'mobile' }, h.root)
      const rules = mobile.findings.map((finding: any) => finding.rule)
      expect(rules).toContain('canvas-overflow')
      expect(rules).toContain('container-overflow')
      expect(rules).toContain('clipped-text')
      expect(rules).toContain('tap-target')
      expect(rules).toContain('peer-overlap')
      const overlaps = mobile.findings.filter((finding: any) => finding.rule === 'peer-overlap')
      expect(
        overlaps.some((finding: any) => ['overlap-a', 'overlap-b'].every((node) => finding.nodes.includes(node))),
      ).toBe(true)
      expect(
        overlaps.some((finding: any) => ['contain-a', 'contain-b'].every((node) => finding.nodes.includes(node))),
      ).toBe(true)
      for (const finding of overlaps) expect(finding.nodes).not.toContain('nest-parent')
      const desktop = await callTool(h, 'design_lint', { screen: 'layout', breakpoint: 'desktop' }, h.root)
      const desktopRules = desktop.findings.map((finding: any) => finding.rule)
      expect(desktopRules).not.toContain('canvas-overflow')
      expect(desktopRules).not.toContain('peer-overlap')

      const desktopView = await callTool(h, 'design_view', { screen: 'layout', breakpoint: 'desktop' }, h.root)
      expect(desktopView.breakpoint).toBe('desktop')
      expect(desktopView.layout.canvas.width).toBe(1280)
      const mobileView = await callTool(h, 'design_view', { screen: 'layout', breakpoint: 'mobile' }, h.root)
      expect(mobileView.layout.canvas.width).toBe(390)
      const wide = mobileView.layout.nodes.find((node: any) => node.id === 'wide')
      expect(wide.width).toBe(500)
      const mobileNode = desktopView.layout.nodes.find((node: any) => node.id === 'wide')
      expect(mobileNode.width).toBe(400)
      expect(mobileView.text).toContain('<Box #wide')
    },
    60000,
  )

  it.skipIf(chromiumPath === undefined)(
    'does not report intentional overlay or ancestor containment',
    async () => {
      const h = await harness()
      await setup(h)
      const plain = await callTool(h, 'design_lint', { screen: 'checkout', breakpoint: 'mobile' }, h.root)
      expect(plain.findings.filter((finding: any) => finding.rule === 'peer-overlap')).toEqual([])
      const opened = await callTool(
        h,
        'design_lint',
        { screen: 'checkout', breakpoint: 'mobile', state: 'plan-open' },
        h.root,
      )
      expect(opened.findings.filter((finding: any) => finding.rule === 'peer-overlap')).toEqual([])
      expect(opened.state).toBe('plan-open')
    },
    60000,
  )

  it.skipIf(chromiumPath === undefined)(
    'runs a passing cross-screen journey and a failing journey without later steps',
    async () => {
      const h = await harness()
      await setup(h)
      const passed = await callTool(h, 'design_run_journey', { journey: 'checkout-flow' }, h.root)
      expect(passed.ok).toBe(true)
      expect(passed.steps).toHaveLength(8)
      expect(passed.steps.every((step: any) => step.status === 'passed')).toBe(true)
      expect(passed.snapshot).toBeUndefined()
      const failed = await callTool(h, 'design_run_journey', { journey: 'failing-flow' }, h.root)
      expect(failed.ok).toBe(false)
      expect(failed.steps).toHaveLength(1)
      expect(failed.steps[0]).toMatchObject({
        kind: 'expect-visible',
        status: 'failed',
        expected: 'hidden',
        observed: 'visible',
      })
      expect(failed.snapshot).toBeDefined()
      expect(failed.snapshot.screen).toBe('checkout')
      expect(failed.snapshot.nodes.length).toBeGreaterThan(0)
    },
    60000,
  )

  it.skipIf(chromiumPath === undefined)(
    'reports measurement truncation instead of silently shrinking the sample',
    async () => {
      const h = await harness()
      await setup(h)
      const boxes = Array.from(
        { length: 305 },
        (_, index) => '<Box id="cell-' + String(index) + '" css="width: 2px; height: 2px" />',
      ).join('')
      await writeFile(
        join(h.root, 'design', 'screens', 'dense.dsx'),
        '<Screen id="dense" title="Dense"><Stack gap="spacing.xs">' + boxes + '</Stack></Screen>',
      )
      const dense = await callTool(h, 'design_lint', { screen: 'dense', breakpoint: 'mobile' }, h.root)
      const truncated = dense.findings.find((finding: any) => finding.rule === 'measurement-truncated')
      expect(truncated).toBeDefined()
      expect(truncated.severity).toBe('warning')
      expect(truncated.evidence.candidates).toBeGreaterThan(300)
    },
    60000,
  )

  it('refuses symlinked screenshot cache directories before writing', async () => {
    const h = await harness()
    await setup(h)
    const outside = await mkdtemp(join(tmpdir(), 'dsh-cache-outside-'))
    const project = await h.registry.forFolder(join(h.root, 'design')).get()
    const check = { sessionId: 'cache-session', browsers: h.service.browsers, assetsDir }
    const { captureScreenshot } = await import('../src/checks.ts')
    await symlink(outside, join(h.root, 'design', '.cache'))
    await expect(captureScreenshot(check, project, 'layout', { breakpoint: 'mobile' })).rejects.toThrow(
      /plain directory|canonical/,
    )
    await rm(join(h.root, 'design', '.cache'), { force: true })
    await mkdir(join(h.root, 'design', '.cache'))
    await symlink(outside, join(h.root, 'design', '.cache', 'screenshots'))
    await expect(captureScreenshot(check, project, 'layout', { breakpoint: 'mobile' })).rejects.toThrow(
      /plain directory|canonical/,
    )
    expect(await readdir(outside)).toEqual([])
  })

  it('preflights validated screens before any browser or screenshot work', async () => {
    const h = await harness({ chromiumPath: '/definitely/not/a/chromium' })
    await setup(h)
    await writeFile(join(h.root, 'design', 'screens', 'broken.dsx'), '<Screen id="broken"><Buton /></Screen>')
    await writeFile(
      join(h.root, 'design', 'journeys', 'broken-start.dsx'),
      '<Journey id="broken-start" start="broken"><ExpectScreen screen="broken" /></Journey>',
    )
    await writeFile(
      join(h.root, 'design', 'journeys', 'broken-target.dsx'),
      '<Journey id="broken-target" start="home"><Navigate screen="broken" /></Journey>',
    )
    const lint = await callTool(h, 'design_lint', { screen: 'broken', breakpoint: 'mobile' }, h.root).catch(
      (error: unknown) => error,
    )
    expect(String((lint as Error).message)).toContain('has validation errors')
    const shot = await callTool(h, 'design_screenshot', { screen: 'broken', breakpoint: 'mobile' }, h.root).catch(
      (error: unknown) => error,
    )
    expect(String((shot as Error).message)).toContain('has validation errors')
    const journey = await callTool(h, 'design_run_journey', { journey: 'broken-start' }, h.root).catch(
      (error: unknown) => error,
    )
    expect(String((journey as Error).message)).toContain('has validation errors')
    const target = await callTool(h, 'design_run_journey', { journey: 'broken-target' }, h.root).catch(
      (error: unknown) => error,
    )
    expect(String((target as Error).message)).toContain('has validation errors')
    const layout = await callTool(h, 'design_view', { screen: 'broken', breakpoint: 'mobile' }, h.root)
    expect(layout.error).toContain('validation error')
    const staticView = await callTool(h, 'design_view', { screen: 'broken' }, h.root)
    expect(staticView.text).toContain('<Screen')
  })

  it.skipIf(chromiumPath === undefined)(
    'returns ordinary actionability failures as a failed step with a snapshot',
    async () => {
      const h = await harness()
      await setup(h)
      const blocked = await callTool(h, 'design_run_journey', { journey: 'blocked-flow' }, h.root)
      expect(blocked.ok).toBe(false)
      expect(blocked.steps).toHaveLength(1)
      expect(blocked.steps[0]).toMatchObject({
        kind: 'tap',
        status: 'failed',
        observed: 'action unavailable',
      })
      expect(blocked.steps[0].message).toContain('did not accept this action')
      expect(blocked.snapshot?.screen).toBe('checkout')
      expect(blocked.snapshot?.nodes.length).toBeGreaterThan(0)
    },
    60000,
  )

  it.skipIf(chromiumPath === undefined)(
    'writes deterministic canvas-only screenshots with an optional highlight',
    async () => {
      const h = await harness()
      await setup(h)
      const before = (await readdir(join(h.root, 'design'), { recursive: true })).sort()
      const sourceBefore = await readFile(join(h.root, 'design', 'screens', 'layout.dsx'), 'utf8')
      const first = await callTool(
        h,
        'design_screenshot',
        { screen: 'layout', breakpoint: 'mobile', highlight: 'clip' },
        h.root,
      )
      const second = await callTool(
        h,
        'design_screenshot',
        { screen: 'layout', breakpoint: 'mobile', highlight: 'clip' },
        h.root,
      )
      expect(first.path).toBe(second.path)
      expect(first.path).toContain(join('.cache', 'screenshots'))
      const png = await readFile(first.path)
      const again = await readFile(second.path)
      expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      expect(again.equals(png)).toBe(true)
      expect(first.width).toBe(390)
      expect(first.height).toBeGreaterThan(0)
      const different = await callTool(h, 'design_screenshot', { screen: 'layout', breakpoint: 'mobile' }, h.root)
      expect(different.path).not.toBe(first.path)
      await expect(access(different.path)).resolves.toBeUndefined()
      expect((await readFile(different.path)).equals(png)).toBe(false)
      expect(await readFile(join(h.root, 'design', 'screens', 'layout.dsx'), 'utf8')).toBe(sourceBefore)
      const stateFirst = await callTool(
        h,
        'design_screenshot',
        { screen: 'checkout', breakpoint: 'mobile', state: 'plan-open' },
        h.root,
      )
      const stateAgain = await callTool(
        h,
        'design_screenshot',
        { screen: 'checkout', breakpoint: 'mobile', state: 'plan-open' },
        h.root,
      )
      expect(stateAgain.path).toBe(stateFirst.path)
      const checkoutFile = join(h.root, 'design', 'screens', 'checkout.dsx')
      const checkoutSource = await readFile(checkoutFile, 'utf8')
      await writeFile(checkoutFile, checkoutSource.replace('name: "Ada"', 'name: "Grace"'))
      const stateChanged = await callTool(
        h,
        'design_screenshot',
        { screen: 'checkout', breakpoint: 'mobile', state: 'plan-open' },
        h.root,
      )
      expect(stateChanged.path).not.toBe(stateFirst.path)
      await writeFile(checkoutFile, checkoutSource)
      const after = (await readdir(join(h.root, 'design'), { recursive: true })).sort()
      const written = after.filter((entry) => !before.includes(entry))
      for (const entry of written) expect(entry.startsWith('.cache')).toBe(true)
    },
    60000,
  )

  it.skipIf(chromiumPath === undefined)(
    'reuses one browser per session and disposes on session end and shutdown',
    async () => {
      const h = await harness()
      await setup(h)
      const lint = h.tools.get('design_lint')!
      const exec = h.exec('design_lint', h.root)
      const first = await lint.execute({ screen: 'layout', breakpoint: 'mobile' }, exec)
      expect(first.findings.length).toBeGreaterThan(0)
      expect(h.service.browsers.size).toBe(1)
      await lint.execute({ screen: 'layout', breakpoint: 'mobile' }, exec)
      expect(h.service.browsers.size).toBe(1)
      const sessionId = [...h.sessions.keys()][0] as string
      expect(h.service.browsers.has(sessionId)).toBe(true)
      await h.handlers['session/disposed']({ id: sessionId })
      expect(h.service.browsers.has(sessionId)).toBe(false)
      h.close()
      await expect.poll(() => h.service.browsers.size, { timeout: 5000 }).toBe(0)
    },
    60000,
  )

  it.skipIf(chromiumPath === undefined)(
    'isolates concurrent sessions in separate browsers',
    async () => {
      const h = await harness()
      await setup(h)
      const project = await h.registry.forFolder(join(h.root, 'design')).get()
      const left = { sessionId: 'parallel-left', browsers: h.service.browsers, assetsDir }
      const right = { sessionId: 'parallel-right', browsers: h.service.browsers, assetsDir }
      const [first, second] = await Promise.all([
        runLint(left, project, 'layout', { breakpoint: 'mobile' }),
        runLint(right, project, 'layout', { breakpoint: 'mobile' }),
      ])
      expect(first.errors).toBeGreaterThan(0)
      expect(second.errors).toBe(first.errors)
      expect(h.service.browsers.size).toBe(2)
      expect(h.service.browsers.has('parallel-left')).toBe(true)
      expect(h.service.browsers.has('parallel-right')).toBe(true)
    },
    60000,
  )

  it('keeps static inspection and queries available without a browser', async () => {
    const h = await harness({ chromiumPath: '/definitely/not/a/chromium' })
    await setup(h)
    const view = await callTool(h, 'design_view', { screen: 'layout' }, h.root)
    expect(view.text).toContain('<Screen')
    const stated = await callTool(h, 'design_view', { screen: 'checkout', state: 'plan-open' }, h.root)
    expect(stated.state).toBe('plan-open')
    expect(stated.text).toContain('Plan details')
    const unknown = await callTool(h, 'design_view', { screen: 'checkout', state: 'ghost' }, h.root)
    expect(unknown.error).toContain('does not declare state')
    const query = await callTool(h, 'design_query', { screen: 'checkout', component: 'Input', id: 'na*' }, h.root)
    expect(query.total).toBe(1)
    expect(query.matches[0]).toMatchObject({ screen: 'checkout', node: 'name', component: 'Input' })
    expect(query.matches[0].file).toBe('screens/checkout.dsx')
    const prop = await callTool(h, 'design_query', { component: 'Input', prop: 'label', value: 'Name' }, h.root)
    expect(prop.matches.map((match: any) => match.node)).toEqual(['name'])
    const failed = await callTool(h, 'design_lint', { screen: 'layout', breakpoint: 'mobile' }, h.root).catch(
      (error: unknown) => error,
    )
    expect(failed).toMatchObject({ code: 'chromium-missing' })
    expect(String((failed as Error).message)).toContain('Headless Chromium could not launch')
    expect(String((failed as Error).message)).toContain('install chromium')
  }, 60000)

  it('includes fixture and journey diagnostics in validation and edit summaries', async () => {
    const h = await harness()
    await setup(h)
    await writeFile(
      join(h.root, 'design', 'fixtures', 'plans.json'),
      JSON.stringify([
        { id: 'basic', label: 'A' },
        { id: 'basic', label: 'B' },
      ]),
    )
    await writeFile(
      join(h.root, 'design', 'journeys', 'broken.dsx'),
      '<Journey id="broken" start="ghost"><Tap target="x" /></Journey>',
    )
    const journey = await callTool(h, 'design_validate', { scope: 'file', file: 'journeys/broken.dsx' }, h.root)
    expect(journey.diagnostics.some((diagnostic: any) => diagnostic.code === 'journey-start-missing')).toBe(true)
    const fixture = await callTool(h, 'design_validate', { scope: 'file', file: 'fixtures/plans.json' }, h.root)
    expect(fixture.errors).toBeGreaterThan(0)
    const edit = h.exec('edit', h.root)
    const execute = h.handlers['tools/execute']
    const post = h.handlers['tools/post-execute']
    let result: any = { isError: false, content: [] }
    result = await execute(edit, async () => {
      await writeFile(
        join(h.root, 'design', 'fixtures', 'plans.json'),
        JSON.stringify([
          { id: 'a', label: 'A' },
          { id: 'a', label: 'B' },
        ]),
      )
      return result
    })
    const decision = await post(edit, result, async () => ({ kind: 'accept' }))
    const context = decision.additionalContexts?.[0]?.content?.[0]?.text ?? ''
    expect(context).toContain('Design validation')
    expect(context).toContain('repeats item id')
  }, 60000)
})

describe('browser cancellation and timeout', () => {
  it('reports cancellation and timeout explicitly', async () => {
    if (chromiumPath === undefined) return
    const h = await harness()
    await setup(h)
    const controller = new AbortController()
    controller.abort()
    const context = {
      sessionId: 'cancel-session',
      browsers: h.service.browsers,
      assetsDir,
      signal: controller.signal,
    }
    const { runJourney } = await import('../src/checks.ts')
    await expect(
      runJourney(context, await h.registry.forFolder(join(h.root, 'design')).get(), 'checkout-flow'),
    ).rejects.toMatchObject({
      code: 'cancelled',
    })
    const timed = {
      sessionId: 'timeout-session',
      browsers: h.service.browsers,
      assetsDir,
      timeoutMs: 1,
    }
    await expect(
      runJourney(timed, await h.registry.forFolder(join(h.root, 'design')).get(), 'checkout-flow'),
    ).rejects.toMatchObject({
      code: 'timeout',
    })
  }, 60000)

  it('reports a missing browser for a fake launcher', async () => {
    const sessions = new BrowserSessions({
      launch: async () => {
        throw new Error('Executable not found')
      },
    })
    await expect(sessions.prewarm('one')).rejects.toMatchObject({ code: 'chromium-missing' })
  })
})
