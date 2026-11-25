import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { parseTokens } from '../src/tokens.ts'
import { parseConfig, checkKitVersion } from '../src/config.ts'
import { discoverProject, loadProject } from '../src/project.ts'
import { scaffoldProject, SAMPLE_SCREEN, type ScaffoldIO } from '../src/scaffold.ts'
import { parseScreen } from '../src/parse.ts'
import { projectScreen } from '../src/view.ts'

const kitVersion = '1.0.0'

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-design-'))
  await scaffoldProject(root, { kitVersion })
  return root
}

describe('tokens', () => {
  it('expands aliases and emits CSS custom properties', () => {
    const tokens = parseTokens(
      JSON.stringify({
        color: { blue: { $value: '#2563eb', $type: 'color' }, action: { $value: '{color.blue}', $type: 'color' } },
        spacing: { md: { $value: '16px', $type: 'dimension' } },
      }),
      'tokens.json',
    )
    expect(tokens.diagnostics).toEqual([])
    expect(tokens.tokens['color.action']?.value).toBe('#2563eb')
    expect(tokens.tokens['color.action']?.cssVar).toBe('--dsx-color-action')
    expect(tokens.cssText).toContain('--dsx-spacing-md: 16px;')
  })

  it('reports broken aliases and cycles', () => {
    const broken = parseTokens(
      JSON.stringify({ color: { bad: { $value: '{color.nope}', $type: 'color' } } }),
      'tokens.json',
    )
    expect(broken.diagnostics.map((diagnostic) => diagnostic.code)).toContain('token-alias-missing')
    const cycle = parseTokens(
      JSON.stringify({
        a: { $value: '{b}', $type: 'color' },
        b: { $value: '{a}', $type: 'color' },
      }),
      'tokens.json',
    )
    expect(cycle.diagnostics.map((diagnostic) => diagnostic.code)).toContain('token-cycle')
  })

  it('reports type mismatch and invalid values', () => {
    const mismatch = parseTokens(
      JSON.stringify({
        color: { a: { $value: '#000', $type: 'color' } },
        border: { b: { $value: '{color.a}', $type: 'dimension' } },
      }),
      'tokens.json',
    )
    expect(mismatch.diagnostics.map((diagnostic) => diagnostic.code)).toContain('token-alias-type')
    const invalid = parseTokens(JSON.stringify({ color: { a: { $value: 12, $type: 'color' } } }), 'tokens.json')
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain('token-value-type')
    const noType = parseTokens(JSON.stringify({ color: { a: { $value: '#000' } } }), 'tokens.json')
    expect(noType.diagnostics.map((diagnostic) => diagnostic.code)).toContain('token-type-missing')
  })
})

describe('project config', () => {
  it('applies documented defaults', () => {
    const { config, diagnostics } = parseConfig(JSON.stringify({ kitVersion: '1.x' }), 'design.json')
    expect(diagnostics).toEqual([])
    expect(config.breakpoints).toEqual([
      { name: 'mobile', width: 390 },
      { name: 'tablet', width: 768 },
      { name: 'desktop', width: 1280 },
    ])
    expect(config.entry).toBeUndefined()
  })

  it('reports type errors and invalid JSON', () => {
    expect(parseConfig('{', 'design.json').diagnostics[0]?.code).toBe('config-json')
    const bad = parseConfig(JSON.stringify({ kitVersion: 1, breakpoints: { mobile: 'wide' }, entry: 2 }), 'design.json')
    expect(bad.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['config-kit-version', 'config-breakpoint-width', 'config-entry']),
    )
  })

  it('checks the kit version pin', () => {
    expect(checkKitVersion('1.x', '1.0.0', 'design.json')).toBeUndefined()
    expect(checkKitVersion('2.x', '1.4.0', 'design.json')?.code).toBe('kit-version-mismatch')
  })
})

describe('project loading', () => {
  it('discovers a project folder and reports an absent one', async () => {
    const root = await tempProject()
    expect((await discoverProject(root)).found).toBe(true)
    const empty = await mkdtemp(join(tmpdir(), 'dsh-empty-'))
    expect((await discoverProject(empty)).found).toBe(false)
  })

  it('loads defaults and uses the alphabetically first screen as entry', async () => {
    const root = await tempProject()
    await writeFile(join(root, 'design', 'screens', 'zeta.dsx'), '<Screen id="zeta" />\n')
    const project = await loadProject({
      folder: join(root, 'design'),
      kit: kitMetadata,
      installedKitVersion: kitVersion,
    })
    expect(project.config.breakpoints).toHaveLength(3)
    expect(project.entry).toBe('home')
    expect(project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
  })

  it('reports duplicate screen ids across files', async () => {
    const root = await tempProject()
    await writeFile(join(root, 'design', 'screens', 'other.dsx'), '<Screen id="home" />\n')
    const project = await loadProject({
      folder: join(root, 'design'),
      kit: kitMetadata,
      installedKitVersion: kitVersion,
    })
    const duplicate = project.diagnostics.find((diagnostic) => diagnostic.code === 'duplicate-screen')
    expect(duplicate?.message).toContain('home.dsx')
    expect(duplicate?.message).toContain('other.dsx')
  })

  it('reports a kit version mismatch and keeps the last valid tree', async () => {
    const root = await tempProject()
    const folder = join(root, 'design')
    const first = await loadProject({ folder, kit: kitMetadata, installedKitVersion: kitVersion })
    expect(first.screens[0]?.lastValidRoot).toBeDefined()
    await writeFile(join(folder, 'screens', 'home.dsx'), '<Screen id="home"><Nope /></Screen>\n')
    const second = await loadProject({ folder, kit: kitMetadata, installedKitVersion: kitVersion, previous: first })
    expect(second.screens[0]?.lastValidRoot).toBeDefined()
    await writeFile(join(folder, 'design.json'), JSON.stringify({ kitVersion: '2.x' }))
    const mismatch = await loadProject({ folder, kit: kitMetadata, installedKitVersion: kitVersion })
    expect(mismatch.diagnostics.some((diagnostic) => diagnostic.code === 'kit-version-mismatch')).toBe(true)
  })

  it('keeps screen identity and the last valid tree through a fatal parse error', async () => {
    const root = await tempProject()
    const folder = join(root, 'design')
    const first = await loadProject({ folder, kit: kitMetadata, installedKitVersion: kitVersion })
    await writeFile(join(folder, 'screens', 'home.dsx'), '<Screen id="home"><Stack><Text>unclosed</Screen>\n')
    const broken = await loadProject({ folder, kit: kitMetadata, installedKitVersion: kitVersion, previous: first })
    const screen = broken.screens.find((candidate) => candidate.file === 'screens/home.dsx')
    expect(screen?.id).toBe('home')
    expect(screen?.root).toBeUndefined()
    expect(screen?.lastValidRoot).toBeDefined()
    expect(broken.entry).toBe('home')
  })

  it('refuses an existing config before writing any missing sibling', async () => {
    const root = await tempProject()
    const folder = join(root, 'design')
    const missing = ['tokens.json', 'screens/home.dsx', '.gitignore']
    await Promise.all(missing.map((file) => import('node:fs/promises').then((fs) => fs.rm(join(folder, file)))))
    const result = await scaffoldProject(root, { kitVersion })
    expect(result.alreadyExists).toBe(true)
    expect(result.created).toEqual([])
    for (const file of missing) await expect(access(join(folder, file))).rejects.toThrow()
  })

  it('rejects a symlinked design directory without writing outside', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-design-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'dsh-design-outside-'))
    await symlink(outside, join(root, 'design'))
    await expect(scaffoldProject(root, { kitVersion })).rejects.toThrow(/not a plain directory/)
    await expect(access(join(outside, 'design.json'))).rejects.toThrow()
  })

  it('rejects a regular file at screens before claiming the config, then retries after clearing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-design-screen-conflict-'))
    const folder = join(root, 'design')
    await mkdir(folder)
    await writeFile(join(folder, 'screens'), 'not a directory')
    await expect(scaffoldProject(root, { kitVersion })).rejects.toThrow(/not a plain directory/)
    for (const file of ['design.json', 'tokens.json', 'screens/home.dsx', '.gitignore']) {
      await expect(access(join(folder, file))).rejects.toThrow()
    }
    await rm(join(folder, 'screens'))
    const retry = await scaffoldProject(root, { kitVersion })
    expect(retry.alreadyExists).toBe(false)
    expect(retry.created).toContain('design/design.json')
    expect((await lstat(join(folder, 'design.json'))).isFile()).toBe(true)
  })

  function failingIO(target: string, removed: Map<string, string>, closed: Set<string>): ScaffoldIO {
    return {
      async open(path, flags) {
        const handle = await openFile(path, flags)
        if (!path.endsWith(target)) return handle
        return {
          async writeFile() {
            await handle.writeFile('PARTIAL')
            throw new Error('injected write failure')
          },
          close: async () => {
            closed.add(path)
            await handle.close()
          },
        }
      },
      async remove(path) {
        removed.set(path, await readFile(path, 'utf8'))
        await rm(path, { force: true })
      },
    }
  }

  it('rolls back a partially written config and succeeds on retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-design-partial-config-'))
    const folder = join(await realpath(root), 'design')
    const removed = new Map<string, string>()
    const closed = new Set<string>()
    await expect(scaffoldProject(root, { kitVersion, io: failingIO('design.json', removed, closed) })).rejects.toThrow(
      /injected write failure/,
    )
    expect(removed.get(join(folder, 'design.json'))).toBe('PARTIAL')
    expect(closed.has(join(folder, 'design.json'))).toBe(true)
    await expect(access(join(folder, 'design.json'))).rejects.toThrow()
    await expect(access(join(folder, 'tokens.json'))).rejects.toThrow()
    await expect(access(join(folder, 'screens', 'home.dsx'))).rejects.toThrow()
    const retry = await scaffoldProject(root, { kitVersion })
    expect(retry.alreadyExists).toBe(false)
    expect((await lstat(join(folder, 'design.json'))).isFile()).toBe(true)
  })

  it('rolls back only partially written files while preserving existing content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-design-partial-sibling-'))
    const folder = join(await realpath(root), 'design')
    await mkdir(folder)
    await writeFile(join(folder, '.gitignore'), 'keep me')
    const removed = new Map<string, string>()
    const closed = new Set<string>()
    await expect(scaffoldProject(root, { kitVersion, io: failingIO('tokens.json', removed, closed) })).rejects.toThrow(
      /injected write failure/,
    )
    expect(removed.get(join(folder, 'tokens.json'))).toBe('PARTIAL')
    expect(closed.has(join(folder, 'tokens.json'))).toBe(true)
    expect(removed.has(join(folder, 'design.json'))).toBe(true)
    await expect(access(join(folder, 'design.json'))).rejects.toThrow()
    await expect(access(join(folder, 'tokens.json'))).rejects.toThrow()
    await expect(access(join(folder, 'screens', 'home.dsx'))).rejects.toThrow()
    expect(await readFile(join(folder, '.gitignore'), 'utf8')).toBe('keep me')
    const retry = await scaffoldProject(root, { kitVersion })
    expect(retry.alreadyExists).toBe(false)
    expect(await readFile(join(folder, '.gitignore'), 'utf8')).toBe('keep me')
  })

  it('lets exactly one concurrent scaffold claim the config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-design-race-'))
    const [left, right] = await Promise.all([
      scaffoldProject(root, { kitVersion }),
      scaffoldProject(root, { kitVersion }),
    ])
    const winners = [left, right].filter((result) => !result.alreadyExists)
    expect(winners).toHaveLength(1)
    expect(winners[0]?.created).toContain('design/design.json')
    expect((await lstat(join(root, 'design', 'design.json'))).isFile()).toBe(true)
  })

  it('carries only a previously validated root across two invalid revisions', async () => {
    const root = await tempProject()
    const folder = join(root, 'design')
    const first = await loadProject({ folder, kit: kitMetadata, installedKitVersion: kitVersion })
    const valid = first.screens.find((screen) => screen.id === 'home')?.root
    expect(valid).toBeDefined()
    await writeFile(join(folder, 'screens', 'home.dsx'), '<Screen id="home"><Stack>\n')
    const second = await loadProject({ folder, kit: kitMetadata, installedKitVersion: kitVersion, previous: first })
    expect(second.screens[0]?.lastValidRoot).toEqual(valid)
    await writeFile(join(folder, 'screens', 'home.dsx'), '<Screen id="home"><Buton /></Screen>')
    const third = await loadProject({ folder, kit: kitMetadata, installedKitVersion: kitVersion, previous: second })
    expect(third.screens[0]?.lastValidRoot).toEqual(valid)
    await writeFile(join(folder, 'screens', 'home.dsx'), SAMPLE_SCREEN)
    const repaired = await loadProject({ folder, kit: kitMetadata, installedKitVersion: kitVersion, previous: third })
    expect(repaired.screens[0]?.root).toBeDefined()
    expect(repaired.screens[0]?.lastValidRoot).toEqual(repaired.screens[0]?.root)
  })

  it('never invents a last valid root for a cold invalid project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-design-cold-'))
    const folder = join(root, 'design')
    await import('node:fs/promises').then((fs) => fs.mkdir(join(folder, 'screens'), { recursive: true }))
    await writeFile(join(folder, 'design.json'), JSON.stringify({ kitVersion, entry: 'home' }))
    await writeFile(
      join(folder, 'tokens.json'),
      JSON.stringify({ color: { text: { $value: '#000', $type: 'color' } } }),
    )
    await writeFile(join(folder, 'screens', 'home.dsx'), '<Screen id="home"><Stack>\n')
    const cold = await loadProject({ folder, kit: kitMetadata, installedKitVersion: kitVersion })
    expect(cold.screens[0]?.lastValidRoot).toBeUndefined()
  })

  it('scaffolds a zero-diagnostic project and refuses a second write', async () => {
    const root = await tempProject()
    const folder = join(root, 'design')
    const loaded = await loadProject({ folder, kit: kitMetadata, installedKitVersion: kitVersion })
    expect(loaded.diagnostics).toEqual([])
    const before = await readFile(join(folder, 'screens', 'home.dsx'), 'utf8')
    const second = await scaffoldProject(root, { kitVersion })
    expect(second.alreadyExists).toBe(true)
    expect(second.created).toEqual([])
    expect(await readFile(join(folder, 'screens', 'home.dsx'), 'utf8')).toBe(before)
    expect(await readFile(join(folder, '.gitignore'), 'utf8')).toContain('.cache/')
  })
})

describe('view projection', () => {
  const source = `<Screen id="home" title="Home">
  <Stack gap="spacing.md">
    <Text>Hello</Text>
    <Button id="open-filters" onPress={open("filters")}>Filters</Button>
  </Stack>
  <Drawer id="filters" title="Filters">
    <Text>Inside</Text>
  </Drawer>
</Screen>`

  it('prints one line per node and closes overlays by default', () => {
    const root = parseScreen(source, 'screens/home.dsx').root!
    const closed = projectScreen(root)
    expect(closed.lines).toMatchSnapshot()
    expect(closed.lines).toContain('  <Stack #0 gap="spacing.md">')
    expect(closed.lines.some((line) => line.includes('<Drawer #filters') && line.includes('(closed)'))).toBe(true)
    expect(closed.text).not.toContain('Inside')
    const open = projectScreen(root, { openOverlays: true })
    expect(open.text).toContain('Inside')
  })

  it('supports depth limits and subtree selection', () => {
    const root = parseScreen(source, 'screens/home.dsx').root!
    const shallow = projectScreen(root, { depth: 1 })
    expect(shallow.text).toContain('…')
    const subtree = projectScreen(root, { node: 'filters', openOverlays: true })
    expect(subtree.text.startsWith('<Drawer #filters')).toBe(true)
    expect(subtree.text).toContain('Inside')
    expect(subtree.text).not.toContain('<Screen')
  })
})
