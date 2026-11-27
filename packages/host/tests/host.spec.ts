import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHarness, callTool, runPipeline, writeScreen, type HostHarness } from './harness.ts'
import { scaffoldProject } from '@filipeesch/dsh-design-core'
import { apply as applyHost } from '../src/index.ts'

const harnesses: HostHarness[] = []

async function harness(options: Parameters<typeof createHarness>[0] = {}): Promise<HostHarness> {
  const created = await createHarness(options)
  harnesses.push(created)
  return created
}

afterEach(() => {
  for (const created of harnesses.splice(0)) created.close()
})

async function assets(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-assets-'))
  await writeFile(
    join(dir, 'index.html'),
    '<!doctype html><html><head></head><body><script src="./app.js"></script></body></html>',
  )
  await writeFile(join(dir, 'app.js'), 'console.log(1)')
  return dir
}

async function listen(
  route: (req: any, res: any, peer: any) => Promise<void>,
  peer: any = { principal: { kind: 'owner' } },
): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    void route(req, res, peer)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { server, base: 'http://127.0.0.1:' + String(address.port) }
}

describe('project registry and watcher', () => {
  it('shares one runtime for two sessions in the same repository', async () => {
    const h = await harness()
    h.registry.learnSession('one', h.root)
    h.registry.learnSession('two', h.root)
    const first = await h.registry.forSession('one')
    const second = await h.registry.forSession('two')
    expect(first).toBeDefined()
    expect(second).toBe(first)
  })

  it('keeps two repositories separate and previews both', async () => {
    const h = await harness()
    const other = await mkdtemp(join(tmpdir(), 'dsh-design-other-'))
    await writeScreen(other, 'home.dsx', '<Screen id="other" title="Other"><Text>Other project</Text></Screen>')
    await writeFile(join(other, 'design', 'design.json'), JSON.stringify({ kitVersion: '1.0.0', entry: 'other' }))
    await writeFile(join(other, 'design', 'tokens.json'), '{}')
    h.registry.learnSession('one', h.root)
    h.registry.learnSession('two', other)
    const one = await h.registry.forSession('one')
    const two = await h.registry.forSession('two')
    expect(one).not.toBe(two)
    expect((await one!.get()).screens[0]?.id).toBe('home')
    expect((await two!.get()).screens[0]?.id).toBe('other')
  })

  it('increments the revision and reparses changed files incrementally', async () => {
    const h = await harness({ debounceMs: 5000 })
    h.registry.learnSession('one', h.root)
    const runtime = (await h.registry.forSession('one'))!
    const first = await runtime.get()
    expect(runtime.currentRevision).toBe(1)
    const cache = (runtime as unknown as { parseCache: Map<string, { mtimeMs: number }> }).parseCache
    const before = cache.get('screens/home.dsx')?.mtimeMs
    await writeScreen(h.root, 'home.dsx', '<Screen id="home"><Text>Updated</Text></Screen>')
    const second = await runtime.reload()
    expect(runtime.currentRevision).toBe(2)
    expect(JSON.stringify(second.screens[0]?.root)).toContain('Updated')
    expect(cache.get('screens/home.dsx')?.mtimeMs).not.toBe(before)
    expect(cache.size).toBe(1)
    expect(first.screens[0]?.id).toBe('home')
  })

  it('renews the watcher lease and reloads edits made during idle eviction', async () => {
    // This test advances the idle clock, not filesystem event delivery.
    const h = await harness({ debounceMs: 200 })
    vi.useFakeTimers()
    try {
      h.registry.learnSession('one', h.root)
      h.registry.learnSession('two', h.root)
      const first = (await h.registry.forSession('one'))!
      const snapshotA = await first.previewSnapshot()
      expect(snapshotA.revision).toBe(1)
      const readCurrent = vi.spyOn(first, 'readCurrent')
      await vi.advanceTimersByTimeAsync(30)
      const shared = (await h.registry.forSession('two'))!
      expect(await shared.previewSnapshot()).toBe(snapshotA)
      expect(readCurrent).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(30)
      expect(h.registry.size).toBe(1)
      await vi.advanceTimersByTimeAsync(30)
      expect(h.registry.size).toBe(0)
      expect((first as unknown as { watcher?: unknown }).watcher).toBeUndefined()

      await writeScreen(h.root, 'home.dsx', '<Screen id="home"><Text>Incomplete')
      const second = (await h.registry.forSession('one'))!
      const snapshotB = await second.previewSnapshot()
      expect(second).not.toBe(first)
      expect(snapshotB.revision).toBe(1)
      expect(snapshotB.token).not.toBe(snapshotA.token)
      expect(snapshotB.project.screens[0]).toMatchObject({
        id: 'home',
        lastValidRoot: snapshotA.project.screens[0]?.root,
        diagnostics: expect.arrayContaining([expect.objectContaining({ severity: 'error' })]),
      })
      await writeScreen(h.root, 'home.dsx', '<Screen id="home"><Text>Repaired after idle</Text></Screen>')
      const repaired = await second.reload()
      expect(JSON.stringify(repaired.screens[0]?.root)).toContain('Repaired after idle')
      h.close()
      expect((second as unknown as { watcher?: unknown }).watcher).toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('activation failure', () => {
  it('names the missing webServer extension point and keeps running', () => {
    const errors: string[] = []
    const ctx = {
      logger: {
        error(message: string) {
          errors.push(message)
        },
      },
    } as any
    const service = applyHost(ctx, {})
    expect(service).toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('webServer')
  })
})

describe('preview routes', () => {
  it('refuses a non-owner peer before reading any content', async () => {
    const h = await harness({ assetsDir: await assets() })
    h.sessions.set('session-test', { id: 'session-test', header: { cwd: h.root } })
    const { server, base } = await listen(h.route, { principal: { kind: 'subagent' } })
    try {
      for (const endpoint of ['', '_/revision', '_/project']) {
        const response = await fetch(base + '/design/session-test/' + endpoint)
        expect(response.status).toBe(403)
        expect(await response.text()).toBe('owner access required')
      }
      expect(h.registry.size).toBe(0)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('serves finite revision responses and publishes edits observed by the shared watcher', async () => {
    const h = await harness()
    h.sessions.set('session-test', { id: 'session-test', header: { cwd: h.root } })
    const { server, base } = await listen(h.route)
    const path = base + '/design/session-test/_/'
    const revision = async () => {
      const response = await fetch(path + 'revision', { signal: AbortSignal.timeout(1000) })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(response.headers.get('cache-control')).toBe('no-store')
      const body = (await response.json()) as { token: string }
      expect(body).toEqual({ token: expect.any(String) })
      expect(body.token).not.toBe('')
      return body.token
    }
    try {
      const initial = await revision()
      const runtime = (await h.registry.forSession('session-test'))!
      const reads = vi.spyOn(runtime, 'readCurrent')
      expect(await revision()).toBe(initial)
      expect(reads).not.toHaveBeenCalled()
      const old = await fetch(path + 'events', { signal: AbortSignal.timeout(1000) })
      expect(old.status).toBe(404)
      await old.text()
      await writeScreen(h.root, 'home.dsx', '<Screen id="home"><Text>Changed by watcher</Text></Screen>')
      const next = await vi.waitFor(
        async () => {
          const token = await revision()
          expect(token).not.toBe(initial)
          return token
        },
        { interval: 10, timeout: 1000 },
      )
      expect(reads).toHaveBeenCalled()
      const response = await fetch(path + 'project')
      const payload = (await response.json()) as { token: string; screens: unknown[] }
      expect(payload.token).toBe(next)
      expect(JSON.stringify(payload.screens)).toContain('Changed by watcher')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('serves the shell, project, assets, and 404 pages', async () => {
    const h = await harness({ assetsDir: await assets() })
    await writeFile(join(h.root, 'design', 'fake.png'), 'not an image')
    await writeFile(
      join(h.root, 'design', 'pixel.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3nWQAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
    await writeFile(join(h.root, 'design', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    h.sessions.set('session-test', { id: 'session-test', header: { cwd: h.root } })
    const { server, base } = await listen(h.route)
    try {
      const shell = await fetch(base + '/design/session-test/')
      expect(shell.status).toBe(200)
      const script = (await shell.text()).match(/src="([^"]+app\.js\?build=[^"]+)"/)?.[1]
      expect(script).toMatch(/^\/design\/session-test\/_\/assets\/app\.js\?build=[a-z0-9-]+$/)
      const versioned = await fetch(new URL(script!, base))
      expect(await versioned.text()).toBe('console.log(1)')
      const project = await fetch(base + '/design/session-test/_/project')
      expect(project.status).toBe(200)
      const payload = (await project.json()) as any
      expect(payload.screens[0].id).toBe('home')
      expect(payload.config.breakpoints).toHaveLength(3)
      const asset = await fetch(base + '/design/session-test/_/assets/app.js')
      expect(asset.status).toBe(200)
      const unknown = await fetch(base + '/design/session-test/nope')
      expect(unknown.status).toBe(404)
      expect(await unknown.text()).toContain('home')
      const unknownSession = await fetch(base + '/design/session-nope/')
      expect(unknownSession.status).toBe(404)
      const traversal = await fetch(base + '/design/session-test/_/files/%2e%2e%2fdesign.json')
      expect(traversal.status).toBe(404)
      const notMedia = await fetch(base + '/design/session-test/_/files/tokens.json')
      expect(notMedia.status).toBe(404)
      const fakePng = await fetch(base + '/design/session-test/_/files/fake.png')
      expect(fakePng.status).toBe(404)
      const svg = await fetch(base + '/design/session-test/_/files/icon.svg')
      expect(svg.status).toBe(404)
      const symlinkTarget = join(h.root, 'outside.png')
      await writeFile(
        symlinkTarget,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3nWQAAAABJRU5ErkJggg==',
          'base64',
        ),
      )
      await symlink(symlinkTarget, join(h.root, 'design', 'linked.png'))
      const escaped = await fetch(base + '/design/session-test/_/files/linked.png')
      expect(escaped.status).toBe(404)
      const media = await fetch(base + '/design/session-test/_/files/pixel.png')
      expect(media.status).toBe(200)
      expect(media.headers.get('content-type')).toBe('image/png')
      expect(media.headers.get('content-security-policy')).toContain("default-src 'none'")
      expect(media.headers.get('x-content-type-options')).toBe('nosniff')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('serves a self-contained deterministic document with a restrictive policy', async () => {
    const h = await harness({ assetsDir: fileURLToPath(new URL('../../renderer/dist/', import.meta.url)) })
    await writeFile(
      join(h.root, 'design', 'pixel.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3nWQAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
    await writeScreen(h.root, 'home.dsx', '<Screen id="home"><Image src="pixel.png" alt="Pixel" /></Screen>')
    h.sessions.set('session-test', { id: 'session-test', header: { cwd: h.root } })
    const { server, base } = await listen(h.route)
    try {
      const response = await fetch(base + '/design/session-test/?deterministic=1')
      const body = await response.text()
      expect(response.status).toBe(200)
      expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'")
      expect(body).toContain('window.__DSX_PROJECT__=')
      expect(body).not.toContain('"projectedScreen":')
      expect(body).toContain('data:font/woff2;base64,')
      expect(body).toContain('data:image/png;base64,')
      expect(body).not.toContain('_/assets/app.js')
      expect(body).not.toContain('./fonts/')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('configured folder and effective cwd', () => {
  it('shares the configured folder and effective session cwd everywhere', async () => {
    const h = await harness({ withProject: false, folderName: 'specs' })
    const initial = await callTool(h, 'design_init', {}, h.root)
    expect(initial.created).toContain('specs/design.json')
    expect(initial.created.some((file: string) => file.startsWith('design/'))).toBe(false)
    const status = await callTool(h, 'design_status', {}, h.root)
    expect(status.exists).toBe(true)
    expect(status.folder.endsWith('/specs')).toBe(true)
    const edit = h.exec('edit', h.root)
    const decision = await runPipeline(h, edit, async () => {
      await writeFile(join(h.root, 'specs', 'screens', 'home.dsx'), '<Screen id="home"><Buton /></Screen>')
    })
    expect(decision.additionalContexts?.[0]?.content?.[0]?.text ?? '').toContain('1 error')
    const again = await callTool(h, 'design_init', {}, h.root)
    expect(again.alreadyExists).toBe(true)
    expect(again.created).toEqual([])
    expect(await readFile(join(h.root, 'specs', 'design.json'), 'utf8')).toBeTruthy()
  })

  it('uses the effective working directory rather than the original header', async () => {
    const effective = await mkdtemp(join(tmpdir(), 'dsh-effective-'))
    await scaffoldProject(effective, { kitVersion: '1.0.0' })
    const h = await harness({ withProject: false, effectiveCwd: () => effective })
    const status = await callTool(h, 'design_status', {}, h.root)
    expect(status.exists).toBe(true)
    expect(status.folder).toBe(join(effective, 'design'))
  })
})

describe('project payload safety', () => {
  it('retains the last valid tree and identity while a screen is invalid', async () => {
    const h = await harness()
    h.registry.learnSession('one', h.root)
    const first = await h.registry.forSession('one')
    expect(first).toBeDefined()
    await first!.get()
    await writeScreen(h.root, 'home.dsx', '<Screen id="home"><Buton /></Screen>')
    await first!.reload()
    const project = await first!.get()
    const screen = project.screens.find((candidate) => candidate.file === 'screens/home.dsx')
    expect(screen?.id).toBe('home')
    expect(screen?.root).toBeDefined()
    expect(screen?.lastValidRoot).toBeDefined()
  })
})

describe('agent tools', () => {
  it('registers path-only delivery guidance in the Design session', async () => {
    const h = await harness()
    const guidance = h.promptSections.find((section) => section.name === 'design:guidance')?.text ?? ''
    expect(guidance).toContain('design_status')
    expect(guidance).toContain('Variants')
    expect(guidance).toContain('share accessible project-relative source and evidence paths')
    expect(guidance).not.toContain('design_handoff')
  })

  it('registers static Design prompts as literal text without breaking DSX examples', async () => {
    const h = await harness()
    expect(h.promptSections).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'design:guidance', interpolate: false })]),
    )
    const guidance = h.promptSections.find((section) => section.name === 'design:guidance')?.text
    expect(guidance).toContain('direction={{ mobile: "column", desktop: "row" }}')
    expect(guidance).toContain('states={{ "filter-open":')
  })

  it('offers ten local design tools without export or live app capture', async () => {
    const h = await harness()
    expect(h.tools.has('design_view')).toBe(true)
    expect(h.tools.size).toBe(10)
    expect(h.tools.has('design_handoff')).toBe(false)
    expect(h.tools.has('design_capture')).toBe(false)
    expect(h.promptSections.map((section) => section.name)).not.toContain('design:capture')
    for (const section of h.promptSections) expect(section.text).not.toContain('design_capture')
  })

  it('reports a missing project and scaffolds one', async () => {
    const h = await harness({ withProject: false })
    h.registry.learnSession('one', h.root)
    const missing = await callTool(h, 'design_status', {}, h.root)
    expect(missing.exists).toBe(false)
    expect(missing.message).toContain('design_init')
    expect(missing.previewUrl).toContain('/design/')
    const init = await callTool(h, 'design_init', {}, h.root)
    expect(init.created).toContain('design/design.json')
    const status = await callTool(h, 'design_status', {}, h.root)
    expect(status.exists).toBe(true)
    expect(status.screens).toHaveLength(1)
    expect(status.errors).toBe(0)
  })

  it('validates project, file, and screen scopes deterministically', async () => {
    const h = await harness()
    await writeScreen(h.root, 'home.dsx', '<Screen id="home"><Buton /></Screen>')
    const first = await callTool(h, 'design_validate', {}, h.root)
    const second = await callTool(h, 'design_validate', {}, h.root)
    expect(first.diagnostics).toEqual(second.diagnostics)
    expect(first.errors).toBeGreaterThan(0)
    const file = await callTool(h, 'design_validate', { scope: 'file', file: 'screens/home.dsx' }, h.root)
    expect(file.diagnostics.some((diagnostic: any) => diagnostic.file === 'tokens.json')).toBe(false)
    const screen = await callTool(h, 'design_validate', { scope: 'screen', screen: 'home' }, h.root)
    expect(screen.diagnostics.length).toBe(first.diagnostics.length)
    expect(await callTool(h, 'design_validate', { screen: 'home' }, h.root)).toEqual(screen)
    expect(await callTool(h, 'design_validate', { file: 'screens/home.dsx' }, h.root)).toEqual(file)
    for (const args of [
      { screen: 'missing' },
      { scope: 'screen' },
      { file: '../screens/home.dsx' },
      { scope: 'project', file: 'screens/home.dsx' },
    ]) {
      const result = await callTool(h, 'design_validate', args, h.root)
      expect(result).toMatchObject({ errorCode: 'invalid-selection', error: expect.any(String) })
    }
  })

  it('searches authored nodes without broadening an invalid branch selection', async () => {
    const h = await harness()
    await writeScreen(h.root, 'other.dsx', '<Screen id="other"><Text id="title">Other</Text></Screen>')
    const result = await callTool(h, 'design_query', { id: 'title' }, h.root)
    expect(result.matches).toEqual([expect.objectContaining({ screen: 'other' })])
    await expect(callTool(h, 'design_query', { variant: 'layout:wide' }, h.root)).rejects.toThrow('requires screen')
    await expect(callTool(h, 'design_query', { prop: 'label' }, h.root)).rejects.toThrow('provided together')
  })

  it('emits standard JSON Schema for required geometry case fields', async () => {
    const h = await harness()
    const items = h.tools.get('design_view').parameters.properties.cases.items
    expect(items.required).toEqual(['breakpoint'])
    expect(items.properties.breakpoint).toEqual({ type: 'string' })
  })

  it('projects a screen and a subtree', async () => {
    const h = await harness()
    await writeScreen(
      h.root,
      'home.dsx',
      '<Screen id="home"><Stack gap="spacing.md"><Text>Hi</Text><Button id="open" onPress={open("filters")}>Open</Button></Stack><Drawer id="filters" title="Filters"><Text>Inside</Text></Drawer></Screen>',
    )
    const full = await callTool(h, 'design_view', {}, h.root)
    expect(full.error).toBeUndefined()
    expect(full.text).toContain('(closed)')
    expect(full.text).not.toContain('Inside')
    const subtree = await callTool(h, 'design_view', { node: 'filters', open: true }, h.root)
    expect(subtree.text).toContain('Inside')
    expect(subtree.text.startsWith('<Drawer')).toBe(true)
    const shallow = await callTool(h, 'design_view', { depth: 1 }, h.root)
    expect(shallow.text).toContain('…')
  })

  it('lists and details components with closest-name suggestions', async () => {
    const h = await harness()
    const list = await callTool(h, 'design_catalog', {}, h.root)
    expect(list.components.length).toBeGreaterThanOrEqual(39)
    const detail = await callTool(h, 'design_catalog', { name: 'Select' }, h.root)
    expect(detail.props.some((prop: any) => prop.name === 'options' && prop.required === true)).toBe(true)
    expect(detail.example).toContain('<Select')
    for (const name of list.components.map((component: any) => component.name)) {
      const one = await callTool(h, 'design_catalog', { name }, h.root)
      expect(one.name).toBe(name)
      expect(one.example.length).toBeGreaterThan(0)
      expect(one.description.length).toBeGreaterThan(0)
    }
    const misspelled = await callTool(h, 'design_catalog', { name: 'Seleect' }, h.root)
    expect(misspelled.error).toContain('Unknown component')
    expect(misspelled.closest).toContain('Select')
  })
})

describe('automatic validation', () => {
  it('attaches a summary to a direct edit and none to unrelated calls', async () => {
    const h = await harness()
    const edit = h.exec('edit', h.root)
    const decision = await runPipeline(h, edit, async () => {
      await writeScreen(h.root, 'home.dsx', '<Screen id="home"><Buton /></Screen>')
    })
    const contextText = decision.additionalContexts?.[0]?.content?.[0]?.text ?? ''
    expect(contextText).toContain('Design validation')
    expect(contextText).toContain('1 error')
    const unrelated = h.exec('bash', h.root)
    const none = await runPipeline(h, unrelated, async () => {
      await writeFile(join(h.root, 'README.md'), 'not a design file')
    })
    expect(none.additionalContexts).toBeUndefined()
  })

  it('detects a screen changed by a shell command', async () => {
    const h = await harness()
    const shell = h.exec('bash', h.root)
    const decision = await runPipeline(h, shell, async () => {
      await writeScreen(h.root, 'home.dsx', '<Screen id="home"><Buton /></Screen>')
    })
    expect(decision.additionalContexts?.[0]?.content?.[0]?.text ?? '').toContain('1 error')
  })

  it('caps attached diagnostics at ten', async () => {
    const h = await harness()
    const many = Array.from({ length: 12 }, (_, index) => '<Buton' + String(index) + ' />').join('')
    const edit = h.exec('write', h.root)
    const decision = await runPipeline(h, edit, async () => {
      await writeScreen(h.root, 'home.dsx', '<Screen id="home">' + many + '</Screen>')
    })
    const text = decision.additionalContexts?.[0]?.content?.[0]?.text ?? ''
    expect((text.match(/error /g) ?? []).length).toBe(10)
    expect(text).toContain('2 more')
  })

  it('aggregates a nested edit onto the enclosing run_code call', async () => {
    const h = await harness()
    const outer = h.exec('run_code', h.root)
    const inner = h.exec('edit', h.root, { parent: outer.token })
    let innerDecision: any
    const outerDecision = await runPipeline(h, outer, async () => {
      innerDecision = await runPipeline(h, inner, async () => {
        await writeScreen(h.root, 'home.dsx', '<Screen id="home"><Buton /></Screen>')
      })
    })
    expect(innerDecision.additionalContexts).toBeUndefined()
    const text = outerDecision.additionalContexts?.[0]?.content?.[0]?.text ?? ''
    expect(text).toContain('Design validation')
    expect(text).toContain('1 error')
  })
})
