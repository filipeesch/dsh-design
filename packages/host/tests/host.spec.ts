import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHarness, callTool, runPipeline, writeScreen, type HostHarness } from './harness.ts'
import { fingerprintDesignTree, scaffoldProject } from '@filipeesch/dsh-design-core'
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
    const h = await harness()
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

  it('resets the revision after idle eviction while unchanged content keeps its fingerprint', async () => {
    const h = await harness()
    vi.useFakeTimers()
    try {
      h.registry.learnSession('one', h.root)
      const first = (await h.registry.forSession('one'))!
      const projectA = await first.get()
      expect(first.currentRevision).toBe(1)
      const fingerprintA = fingerprintDesignTree(projectA.screens[0]!.root!)
      const unsubscribe = first.subscribe(() => undefined)
      unsubscribe()
      await vi.advanceTimersByTimeAsync(120)
      expect(h.registry.size).toBe(0)
      const second = (await h.registry.forSession('one'))!
      expect(second).not.toBe(first)
      const projectB = await second.get()
      expect(second.currentRevision).toBe(1)
      expect(fingerprintDesignTree(projectB.screens[0]!.root!)).toBe(fingerprintA)
      await writeScreen(h.root, 'home.dsx', '<Screen id="home"><Text>Edited after idle</Text></Screen>')
      const projectC = await second.reload()
      expect(second.currentRevision).toBe(2)
      expect(fingerprintDesignTree(projectC.screens[0]!.root!)).not.toBe(fingerprintA)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops the watcher after the idle window', async () => {
    const h = await harness()
    h.registry.learnSession('one', h.root)
    const runtime = (await h.registry.forSession('one'))!
    await runtime.get()
    const unsubscribe = runtime.subscribe(() => undefined)
    unsubscribe()
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect((runtime as unknown as { watcher?: unknown }).watcher).toBeUndefined()
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
      const response = await fetch(base + '/design/session-test/')
      expect(response.status).toBe(403)
      expect(await response.text()).toBe('owner access required')
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
      expect(await shell.text()).toContain('/design/session-test/_/assets/app.js')
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
  it('registers Design and handoff guidance in the design session scope', async () => {
    const h = await harness()
    const names = h.promptSections.map((section) => section.name)
    expect(names).toContain('design:guidance')
    expect(names).toContain('design:handoff')
    const guidance = h.promptSections.find((section) => section.name === 'design:guidance')?.text ?? ''
    const handoff = h.promptSections.find((section) => section.name === 'design:handoff')?.text ?? ''
    expect(guidance).toContain('design_status')
    expect(guidance).toContain('Variants')
    expect(handoff).toContain('design_handoff')
    expect(handoff).not.toContain('design_capture')
    expect(handoff).toContain('manifest')
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
  })

  it('projects a screen and a subtree', async () => {
    const h = await harness()
    await writeScreen(
      h.root,
      'home.dsx',
      '<Screen id="home"><Stack gap="spacing.md"><Text>Hi</Text><Button id="open" onPress={open("filters")}>Open</Button></Stack><Drawer id="filters" title="Filters"><Text>Inside</Text></Drawer></Screen>',
    )
    const full = await callTool(h, 'design_view', {}, h.root)
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
