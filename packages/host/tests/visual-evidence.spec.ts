import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from 'playwright-core'
import { BrowserSessions } from '../src/browser.ts'
import { callTool, createHarness, writeScreen, type HostHarness } from './harness.ts'

const assetsDir = fileURLToPath(new URL('../../renderer/dist/', import.meta.url))
const chromiumPath = process.env.DSH_DESIGN_CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_PATH
const active: HostHarness[] = []
afterEach(() => {
  for (const harness of active.splice(0)) harness.close()
})
async function harness(options: Parameters<typeof createHarness>[0] = {}) {
  const result = await createHarness({ assetsDir, chromiumPath, ...options })
  active.push(result)
  return result
}
const branches = [
  '<Variants id="layout" chosen="compact">',
  '  <Variant branch="compact"><Screen id="home" title="Home"><Text id="chosen">Compact</Text></Screen></Variant>',
  '  <Variant branch="wide"><Screen id="home" title="Home" states={{ focused: { values: { title: "Seeded" } } }}>',
  '    <Box width={{ mobile: "800px", tablet: "100%", desktop: "100%" }}><Input id="title" label="Title" /></Box>',
  '  </Screen></Variant>',
  '</Variants>',
].join('\n')

function describeOutput(h: HostHarness, tool: string, args: Record<string, unknown>, result: unknown): string {
  return h.tools.get(tool).output.render(args, result)[0].text
}

describe('visual evidence contracts', () => {
  it('provides copyable selectors and reports an unverified host without launching Chromium', async () => {
    const h = await harness({ chromiumPath: '/not/installed', extraServices: { profileContext: { name: 'review' } } })
    await writeScreen(h.root, 'home.dsx', branches)
    const result = await callTool(h, 'design_status', {}, h.root)
    expect(result.browser).toMatchObject({
      status: 'unverified',
      source: 'design-host chromiumPath',
      profile: 'review',
      executablePath: '/not/installed',
    })
    const content = describeOutput(h, 'design_status', {}, result)
    for (const text of [
      'screen="home"',
      'state="focused"',
      'variant="layout:wide"',
      'breakpoint="mobile"',
      'DSH review profile host',
      'not in the target project',
    ]) {
      expect(content).toContain(text)
    }
    const missing = await harness({ withProject: false })
    const absent = await callTool(missing, 'design_status', {}, missing.root)
    expect(absent).toMatchObject({ exists: false, screens: [], breakpoints: [] })
    expect(describeOutput(missing, 'design_status', {}, absent)).toContain('design_init')
    expect(h.service.browsers.size).toBe(0)
    expect(missing.service.browsers.size).toBe(0)
  })

  it('observes successful and failed launches, rather than inferring readiness from configured paths', async () => {
    const launch = vi.fn(async () => ({ isConnected: () => true, close: async () => undefined }) as unknown as Browser)
    const ready = new BrowserSessions({ launch })
    const failed = new BrowserSessions({
      launch: async () => {
        throw new Error('sandbox initialization failed')
      },
    })
    try {
      expect(ready.readiness().status).toBe('unverified')
      expect(launch).not.toHaveBeenCalled()
      await ready.prewarm('one')
      expect(ready.readiness().status).toBe('ready')
      await expect(failed.prewarm('two')).rejects.toMatchObject({ code: 'browser-failed' })
      expect(failed.readiness()).toMatchObject({ status: 'failed', error: 'sandbox initialization failed' })
    } finally {
      await ready.disposeAll()
      await failed.disposeAll()
    }
  })

  it('rejects unknown and incompatible selections before touching a browser', async () => {
    const h = await harness({ chromiumPath: '/not/installed' })
    await writeScreen(h.root, 'home.dsx', branches)
    for (const [name, args] of [
      ['design_lint', { screen: 'home', breakPoint: 'mobile' }],
      ['design_view', { screen: 'home', alternate: 'wide' }],
      ['design_run_journey', { journey: 'main', state: 'focused' }],
      ['design_screenshot', { screen: 'home', device: 'mobile' }],
    ] as const)
      await expect(callTool(h, name, args, h.root)).rejects.toThrow('unknown argument')
    for (const [name, args, message] of [
      ['design_lint', { screen: 'home', breakpoint: 'unknown' }, 'Unknown breakpoint'],
      ['design_lint', { screen: 'home', variant: '' }, 'group:branch'],
      ['design_screenshot', { screen: 'home', state: 'focused' }, 'does not declare state'],
    ] as const) {
      const result = await callTool(h, name, args, h.root)
      expect(result).toMatchObject({ errorCode: 'invalid-selection', error: expect.stringContaining(message) })
    }
    expect(
      await callTool(h, 'design_view', { screen: 'home', breakpoint: 'mobile', node: 'not-found' }, h.root),
    ).toMatchObject({ errorCode: 'invalid-selection' })
    expect(h.service.browsers.readiness().status).toBe('unverified')
  })

  it.skipIf(chromiumPath === undefined)(
    'identifies clean, responsive, and measured alternate/state selections',
    async () => {
      const h = await harness()
      await writeScreen(h.root, 'home.dsx', branches)
      const clean = await callTool(h, 'design_lint', { screen: 'home' }, h.root)
      expect(clean).toMatchObject({
        screen: 'home',
        selection: { layout: 'compact' },
        breakpoints: ['mobile', 'tablet', 'desktop'],
        findings: [],
      })
      const wide = { screen: 'home', variant: 'layout:wide', state: 'focused', breakpoint: 'mobile' }
      const lint = await callTool(h, 'design_lint', wide, h.root)
      expect(lint).toMatchObject({
        screen: 'home',
        state: 'focused',
        variant: { branch: 'wide' },
        breakpoints: ['mobile'],
      })
      expect(lint.findings).toContainEqual(expect.objectContaining({ rule: 'canvas-overflow', breakpoint: 'mobile' }))
      expect(describeOutput(h, 'design_lint', wide, lint)).toContain('variant="layout:wide"')
      const view = await callTool(h, 'design_view', wide, h.root)
      expect(view).toMatchObject({
        screen: 'home',
        state: 'focused',
        selection: { layout: 'wide' },
        layout: { breakpoint: 'mobile' },
      })
      expect(view.layout.nodes).toContainEqual(expect.objectContaining({ id: 'title' }))
      expect(view.layout.nodes).not.toContainEqual(expect.objectContaining({ id: 'chosen' }))
    },
    30000,
  )

  it.skipIf(chromiumPath === undefined)(
    'reports unavailable media without blaming fallback text or masking real overflow',
    async () => {
      const h = await harness()
      const media = join(h.root, 'design', 'media')
      await mkdir(media, { recursive: true })
      await writeFile(join(media, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
      await writeFile(join(media, 'broken.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
      const source = (initials: string) =>
        [
          '<Screen id="home" title="Home">',
          '  <Avatar id="icon" src={{ mobile: "media/icon.svg", desktop: "placeholder: Icon" }}' + initials + ' />',
          '  <Image id="missing" src="media/absent.png" alt="" />',
          '  <Image id="broken" src="media/broken.png" alt="" />',
          '  <Box width="800px"><Text>Real overflow</Text></Box>',
          '</Screen>',
        ].join('\n')
      const args = { screen: 'home', breakpoint: 'mobile' }
      await writeScreen(h.root, 'home.dsx', source(' initials="Unable-to-render-this-intentionally-long-icon-label"'))
      const first = await callTool(h, 'design_lint', args, h.root)
      expect(first.error, 'The media measurement must complete in Chromium.').toBeUndefined()
      expect(first.media).toMatchObject([
        { code: 'unsupported', node: 'icon', reference: 'media/icon.svg', file: 'screens/home.dsx' },
        { code: 'missing', node: 'missing', reference: 'media/absent.png' },
        { code: 'undecodable', node: 'broken', reference: 'media/broken.png' },
      ])
      expect(first.findings).toContainEqual(expect.objectContaining({ rule: 'canvas-overflow' }))
      expect(first.findings).not.toContainEqual(expect.objectContaining({ nodes: ['icon'] }))
      await writeScreen(h.root, 'home.dsx', source(''))
      const second = await callTool(h, 'design_lint', args, h.root)
      expect(second.media).toEqual(first.media)
      expect(second.media.every((item: { breakpoint: string }) => item.breakpoint === 'mobile')).toBe(true)
      const desktop = await callTool(h, 'design_lint', { ...args, breakpoint: 'desktop' }, h.root)
      expect(desktop.media.map((item: { node: string }) => item.node)).toEqual(['missing', 'broken'])
      expect(describeOutput(h, 'design_lint', args, second)).toContain('Media issues (3; separate from geometry)')
    },
    30000,
  )

  it.skipIf(chromiumPath === undefined)('reports only media for an isolated broken avatar', async () => {
    const h = await harness()
    const folder = join(h.root, 'design', 'media')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    for (const [file, code] of [
      ['icon.svg', 'unsupported'],
      ['absent.png', 'missing'],
    ]) {
      await writeScreen(
        h.root,
        'home.dsx',
        '<Screen id="home"><Avatar id="icon" src="media/' + file + '" initials="A-very-long-fallback-name" /></Screen>',
      )
      const result = await callTool(h, 'design_lint', { screen: 'home', breakpoint: 'mobile' }, h.root)
      expect(result.error, 'The avatar measurement must complete in Chromium.').toBeUndefined()
      expect(result.media).toMatchObject([{ code, node: 'icon', reference: 'media/' + file }])
      expect(result.findings).toEqual([])
    }
  })

  it.skipIf(chromiumPath === undefined)(
    'returns the actual persisted PNG inline only on an image-capable route',
    async () => {
      const saveImage = vi.fn(async ({ data }: { data: Buffer }) => ({
        attachmentId: 'synthetic-attachment',
        mediaType: 'image/png',
        bytes: data.length,
        width: data.readUInt32BE(16),
        height: data.readUInt32BE(20),
      }))
      const resolveModelInfo = vi.fn(async (_provider: string, model: string) => ({
        inputModalities: model === 'vision' ? ['text', 'image'] : ['text'],
      }))
      const h = await harness({ extraServices: { attachments: { saveImage }, llm: { resolveModelInfo } } })
      await writeScreen(h.root, 'home.dsx', branches)
      const capture = h.tools.get('design_screenshot')
      const exec = h.exec(capture.name, h.root)
      exec.agent.options = { provider: 'fallback', model: 'fallback' }
      const args = {
        screen: 'home',
        state: 'focused',
        variant: 'layout:wide',
        breakpoint: 'desktop',
        highlight: 'title',
      }
      exec.agent.session.requestHeader = () => ({ config: { provider: 'current', model: 'vision' } })
      const lint = await callTool(h, 'design_lint', { screen: 'home', breakpoint: 'desktop' }, h.root)
      expect(lint.error).toBeUndefined()
      expect(lint.findings).toEqual([])
      expect(saveImage).not.toHaveBeenCalled()
      const inline = await capture.execute(args, exec)
      expect(inline.error, 'The screenshot must be persisted before checking attachment delivery.').toBeUndefined()
      expect(resolveModelInfo).toHaveBeenCalledWith('current', 'vision', exec.signal)
      expect(inline).toMatchObject({
        imageDelivery: 'inline',
        screen: 'home',
        state: 'focused',
        variant: { branch: 'wide' },
        breakpoint: 'desktop',
        highlight: 'title',
      })
      const saved = await readFile(inline.path)
      expect(saved.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(saveImage.mock.calls[0]?.[0].data).toEqual(saved)
      expect(JSON.stringify(inline)).not.toContain(saved.toString('base64'))
      expect(capture.output.render(args, inline)).toEqual([
        { type: 'text', text: expect.stringContaining(inline.path) },
        { type: 'image', attachment: inline.attachment },
      ])
      exec.agent.session.requestHeader = () => ({ config: { provider: 'current', model: 'text' } })
      const fallback = await capture.execute(args, exec)
      expect(fallback).toMatchObject({ path: inline.path, imageDelivery: 'path-only' })
      expect(capture.output.render(args, fallback)).toEqual([
        { type: 'text', text: expect.stringContaining('Path-only fallback') },
      ])
      exec.agent.session.requestHeader = () => ({ config: { provider: 'current', model: 'vision' } })
      saveImage.mockRejectedValueOnce(new Error('attachment store unavailable'))
      const unavailable = await capture.execute(args, exec)
      expect(unavailable).toMatchObject({ path: inline.path, imageDelivery: 'path-only' })
      expect(await readFile(unavailable.path)).toEqual(saved)
      expect(saveImage).toHaveBeenCalledTimes(2)
    },
    30000,
  )
})
