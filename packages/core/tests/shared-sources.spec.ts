import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KIT_VERSION, kitMetadata } from '../../kit/src/meta.ts'
import {
  loadProject,
  parseStylesheet,
  parseTokens,
  resolveProjectTheme,
  type DesignElement,
  type DesignProject,
} from '../src/index.ts'

const temps: string[] = []
afterEach(async () => {
  for (const folder of temps.splice(0)) await rm(folder, { recursive: true, force: true })
})
const baseTokens = JSON.stringify({
  color: { $type: 'color', surface: { $value: '#abc' }, action: { $value: '{color.surface}' } },
})
async function setup(config = {}) {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-shared-sources-'))
  temps.push(temp)
  const folder = join(temp, 'design')
  await Promise.all(
    ['screens', 'styles', 'themes', 'layouts', 'fixtures'].map((name) =>
      mkdir(join(folder, name), { recursive: true }),
    ),
  )
  const put = (file: string, source: string) => writeFile(join(folder, file), source)
  await put('design.json', JSON.stringify({ kitVersion: KIT_VERSION, ...config }))
  await put('tokens.json', baseTokens)
  return {
    temp,
    folder,
    put,
    load: (previous?: DesignProject) =>
      loadProject({ folder, kit: kitMetadata, installedKitVersion: KIT_VERSION, previous }),
  }
}
function nodes(node: DesignElement): DesignElement[] {
  return [node, ...node.children.flatMap((child) => (child.kind === 'element' ? nodes(child) : []))]
}
function screen(project: DesignProject, id: string) {
  return project.screens.find((entry) => entry.id === id)!
}

describe('shared layouts', () => {
  it('splices each consumer independently before fixtures and named states, preserving authored locations', async () => {
    const h = await setup()
    await h.put(
      'layouts/workspace.dsx',
      [
        '<Layout>',
        ' <Stack id="body">',
        '  <Button id="jump" onPress={navigate("orders")}>Orders</Button>',
        '  <List id="rows" items={fixture("orders")}><ItemTemplate><Disclosure id="details" label="Details"><Text>{item("name")}</Text></Disclosure></ItemTemplate></List>',
        '  <ContentSlot />',
        ' </Stack>',
        '</Layout>',
      ].join('\n'),
    )
    await h.put('fixtures/orders.json', JSON.stringify([{ id: 'sample', name: 'Sample' }]))
    await h.put(
      'screens/home.dsx',
      '<Screen id="home" layout="workspace" states={{ expanded: { disclosures: { "rows-sample-details": true } } }}><Text id="home-title">Home</Text></Screen>',
    )
    await h.put(
      'screens/orders.dsx',
      '<Screen id="orders" layout="workspace"><Text id="orders-title">Orders</Text></Screen>',
    )
    const project = await h.load()
    expect(project.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    for (const id of ['home', 'orders']) {
      const result = screen(project, id)
      const elements = nodes(result.root!)
      expect(elements.some((node) => ['Layout', 'ContentSlot', 'ItemTemplate'].includes(node.type))).toBe(false)
      expect(elements.find((node) => node.id === id + '-title')).toMatchObject({
        source: { file: 'screens/' + id + '.dsx' },
        address: { label: '#0.2' },
      })
      expect(elements.find((node) => node.id === 'jump')).toMatchObject({
        source: { file: 'layouts/workspace.dsx', line: 3, column: 3, endLine: 3 },
        address: { label: '#0.0' },
      })
      expect(result.sourceDependencies).toEqual(['fixtures/orders.json', 'layouts/workspace.dsx'])
    }
    expect(screen(project, 'home').states[0]?.disclosures).toEqual({ 'rows-sample-details': true })
    await h.put(
      'layouts/workspace.dsx',
      '<Layout>\n<List id="rows" items={fixture("missing")}><ItemTemplate><Text>Row</Text></ItemTemplate></List><ContentSlot /></Layout>',
    )
    const broken = await h.load(project)
    expect(screen(broken, 'home').diagnostics).toContainEqual(
      expect.objectContaining({ code: 'fixture-missing', file: 'layouts/workspace.dsx', line: 2 }),
    )
  })

  it.each([
    [undefined, 'layout-missing'],
    ['<Layout><Stack /></Layout>', 'layout-slot-count'],
    ['<Layout><ContentSlot /><ContentSlot /></Layout>', 'layout-slot-count'],
    ['<Layout><Stack layout="other"><ContentSlot /></Stack></Layout>', 'layout-nested'],
    ['<Layout><Screen id="hidden"><ContentSlot /></Screen></Layout>', 'layout-nested'],
    ['<Layout><ContentSlot>Not empty</ContentSlot></Layout>', 'layout-slot-empty'],
  ])('isolates invalid layout dependencies: %s', async (layout, code) => {
    const h = await setup()
    if (layout !== undefined) await h.put('layouts/workspace.dsx', layout)
    await h.put('screens/home.dsx', '<Screen id="home"\n  layout="workspace" />')
    await h.put('screens/plain.dsx', '<Screen id="plain"><Text>Plain</Text></Screen>')
    const project = await h.load()
    expect(screen(project, 'plain').blockingErrors).toBe(0)
    expect(screen(project, 'home').diagnostics).toContainEqual(
      expect.objectContaining({ code, file: layout === undefined ? 'screens/home.dsx' : 'layouts/workspace.dsx' }),
    )
    expect(screen(project, 'home').diagnostics).toContainEqual(
      expect.objectContaining({
        code: layout === undefined ? 'layout-missing' : 'layout-invalid',
        file: 'screens/home.dsx',
        line: 2,
        column: 3,
      }),
    )
  })

  it('reports collisions introduced by both the slot and expanded fixtures without renaming nodes', async () => {
    const h = await setup()
    await h.put(
      'layouts/workspace.dsx',
      '<Layout>\n<Text id="same">Shared</Text><Text id="rows-sample">Collision</Text><ContentSlot />\n</Layout>',
    )
    await h.put(
      'screens/home.dsx',
      '<Screen id="home" layout="workspace"><Text id="same">Body</Text><List id="rows" items={fixture("orders")}><ItemTemplate><ListItem id="row">Row</ListItem></ItemTemplate></List></Screen>',
    )
    await h.put('fixtures/orders.json', JSON.stringify([{ id: 'sample', name: 'Sample' }]))
    const home = screen(await h.load(), 'home')
    const duplicates = home.diagnostics.filter((d) => d.code === 'duplicate-id')
    expect(duplicates, JSON.stringify(home.diagnostics)).toHaveLength(2)
    expect(
      duplicates.every((d) => d.file === 'screens/home.dsx' && d.message.includes('layouts/workspace.dsx:2:')),
    ).toBe(true)
    expect(nodes(home.root!).filter((node) => node.id === 'same')).toHaveLength(2)
  })
})

describe('named token palettes', () => {
  it('keeps the base unchanged and resolves aliases after typed overrides', async () => {
    const legacy = await setup()
    const legacyConfig = await readFile(join(legacy.folder, 'design.json'), 'utf8')
    const plain = await legacy.load()
    expect(resolveProjectTheme(plain)).toMatchObject({ name: 'base', tokens: parseTokens(baseTokens, 'tokens.json') })
    expect(Object.keys(plain.themes)).toEqual(['base'])
    expect(await readFile(join(legacy.folder, 'design.json'), 'utf8')).toBe(legacyConfig)
    const h = await setup({ themes: { dark: 'themes/dark.json' }, defaultTheme: 'dark' })
    await h.put(
      'themes/dark.json',
      JSON.stringify({ colorScheme: 'dark', tokens: { color: { $type: 'color', surface: { $value: '#121212' } } } }),
    )
    const project = await h.load()
    expect(project.sourceFiles).toContain('themes/dark.json')
    expect(resolveProjectTheme(project)).toMatchObject({
      name: 'dark',
      colorScheme: 'dark',
      tokens: { tokens: { 'color.action': { value: '#121212' } } },
    })
    expect(resolveProjectTheme(project, 'base').tokens.cssText).toBe(plain.tokens.cssText)
    expect(() => resolveProjectTheme(project, 'unknown')).toThrow('Unknown theme')
    await h.put('themes/dark.json', '{')
    const invalid = await h.load(project)
    expect(invalid.lastValidThemes.dark).toEqual(project.themes.dark)
    expect(() => resolveProjectTheme(invalid)).toThrow('themes/dark.json')
  })

  it.each([
    [undefined, 'source-missing', 'themes/dark.json'],
    ['{}', 'theme-shape', 'themes/dark.json'],
    ['{"colorScheme":"auto","tokens":{}}', 'theme-color-scheme', 'themes/dark.json'],
    ['{"tokens":{"color":{"surface":{"$type":"dimension","$value":"1px"}}}}', 'theme-token-type', 'themes/dark.json'],
    ['{"tokens":{"color":{"surface":{"$type":"color","$value":"{color.action}"}}}}', 'token-cycle', 'themes/dark.json'],
    [
      '{"tokens":{"color":{"surface":{"$type":"color","$value":"{color.missing}"}}}}',
      'token-alias-missing',
      'themes/dark.json',
    ],
  ])('rejects rather than substitutes an invalid declared palette: %s', async (source, code, file) => {
    const h = await setup({ themes: { dark: file }, defaultTheme: 'dark' })
    if (source !== undefined) await h.put(file, source)
    const project = await h.load()
    expect(project.diagnostics).toContainEqual(expect.objectContaining({ code, file }))
    expect(() => resolveProjectTheme(project)).toThrow('Theme "dark" is invalid')
    expect(resolveProjectTheme(project, 'base').name).toBe('base')
  })
})

describe('confined stylesheets', () => {
  it('resolves only opted-in roots in stylesheet order and retains node CSS separately', async () => {
    const h = await setup({ stylesheets: ['styles/one.css', 'styles/two.css'] })
    await h.put('styles/one.css', '.strong { padding: 1px; }\n.soft { padding: 2px; color: var(--dsx-color-surface); }')
    await h.put('styles/two.css', '.strong { padding: 3px; }')
    await h.put(
      'screens/home.dsx',
      '<Screen id="home"><Text id="styled" styleClass="soft strong" css="padding: 4px">A</Text><Text id="plain">B</Text></Screen>',
    )
    const project = await h.load()
    expect(project.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const tree = nodes(screen(project, 'home').root!)
    const node = tree.find((n) => n.id === 'styled')!
    expect(node.classCss).toEqual([
      { property: 'padding', value: '1px' },
      { property: 'padding', value: '2px' },
      { property: 'color', value: 'var(--dsx-color-surface)' },
      { property: 'padding', value: '3px' },
    ])
    expect(node.props.css).toBe('padding: 4px')
    expect(tree.find((n) => n.id === 'plain')?.classCss).toBeUndefined()
    await h.put('screens/home.dsx', '<Screen id="home">\n <Text id="styled" styleClass="missing">A</Text>\n</Screen>')
    expect(screen(await h.load(), 'home').diagnostics).toContainEqual(
      expect.objectContaining({ code: 'style-class-unknown', line: 2, column: 20, file: 'screens/home.dsx' }),
    )
    await h.put('styles/one.css', '.soft { color: red; }\n.soft:hover { color: blue; }')
    await h.put('screens/home.dsx', '<Screen id="home"><Text id="styled" styleClass="soft">A</Text></Screen>')
    const blocked = screen(await h.load(project), 'home')
    expect(blocked.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'stylesheet-selector', file: 'styles/one.css', line: 2 }),
    )
    expect(nodes(blocked.root!).find((n) => n.id === 'styled')?.classCss).toBeUndefined()
    expect(nodes(blocked.lastValidRoot!).find((n) => n.id === 'styled')?.classCss).toEqual(node.classCss)
  })

  it.each([
    '.a, .b { color: red; }',
    '.a .b { color: red; }',
    '.a:hover { color: red; }',
    'a { color: red; }',
    '@media (min-width: 1px) { .a { color: red; } }',
    '@import "https://example.invalid/style.css";',
    '.a { background-image: url(local.png); }',
    '.a { --dsx-color-surface: red; }',
    '.a { color: red !important; }',
    '.a { color: var(--dsx-color-unknown); }',
    '.a { width: var(--dsx-color-surface); }',
    '.a { position: fixed; }',
    '.a { padding: 1px; }'.repeat(129),
    '.a {' + 'padding: 1px;'.repeat(25) + '}',
  ])('rejects an unsound or oversized AST: %.65s', (source) => {
    const parsed = parseStylesheet(source, 'styles/invalid.css', parseTokens(baseTokens, 'tokens.json'))
    expect(parsed.rules).toEqual([])
    expect(parsed.diagnostics[0]).toMatchObject({ file: 'styles/invalid.css', severity: 'error' })
  })

  it('does not read escaping paths, linked ancestor directories, or oversized sources', async () => {
    const h = await setup({
      themes: { outside: 'themes/../outside.json', linked: 'themes/linked/override.json' },
      stylesheets: ['../outside.css', 'styles/huge.css'],
    })
    await mkdir(join(h.temp, 'external'))
    await symlink(join(h.temp, 'external'), join(h.folder, 'themes', 'linked'))
    await writeFile(join(h.temp, 'external', 'override.json'), '{"tokens":{}}')
    await h.put('styles/huge.css', ' '.repeat(65537))
    const project = await h.load()
    expect(project.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['config-theme-path', 'config-stylesheet-path', 'source-unsupported', 'source-oversized']),
    )
    expect(Object.keys(project.themes)).toEqual(['base'])
    expect(project.sourceFiles).not.toContain('../outside.css')
  })
})
