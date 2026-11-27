import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findNode, loadProject, propsOf, scaffoldProject } from '@filipeesch/dsh-design-core'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { BrowserSessions } from '../src/browser.ts'
import { payloadFor } from '../src/checks.ts'
import { designCatalog, formatCatalog, MAX_CATALOG_NAMES, MAX_CATALOG_QUERY_LENGTH } from '../src/catalog.ts'
import { findChromium } from './chromium.ts'
import { callTool, createHarness } from './harness.ts'

const toolName = 'design_catalog'

describe('authoring catalog', () => {
  it('keeps the legacy index and single-name props while indexing constructs and recipes', async () => {
    const h = await createHarness({ withProject: false })
    try {
      const tool = h.tools.get(toolName)
      const index = await callTool(h, toolName, {}, h.root)
      expect(index.components).toContainEqual(expect.objectContaining({ name: 'Select', category: 'form' }))
      expect(index.constructs).toContainEqual(expect.objectContaining({ name: 'ItemTemplate' }))
      expect(index.recipes).toContainEqual(expect.objectContaining({ name: 'named-disclosure' }))
      const detail = await callTool(h, toolName, { name: 'Select' }, h.root)
      expect(detail.props).toEqual(propsOf(kitMetadata.Select!))
      expect(detail.kind).toBe('component')
      expect(tool.output.render({}, detail)[0].text).toContain('options: array required')
      const button = await callTool(h, toolName, { name: 'Button' }, h.root)
      expect(tool.output.render({}, button)[0].text).toContain('default')
      const miss = await callTool(h, toolName, { name: 'Seleect' }, h.root)
      expect(miss.error).toContain('Unknown component')
      expect(miss.closest[0]).toBe('Select')
    } finally {
      h.close()
    }
  })

  it('exposes compact intent results and rejects conflicting modes on the registered tool', async () => {
    const h = await createHarness({ withProject: false })
    try {
      const tool = h.tools.get(toolName)
      expect(tool.parameters.properties.query).toMatchObject({ type: 'string' })
      expect(tool.output.schema.properties.matches).toMatchObject({ type: 'array' })
      const query = 'Tabela com dados fictícios'
      const result = await callTool(h, toolName, { query }, h.root)
      expect(result).toEqual(intent(query))
      const text = tool.output.render({ query }, result)[0].text
      expect(text).toContain('fixture-table (recipe)')
      expect(text).not.toContain('Example (')
      await expect(callTool(h, toolName, { query, name: 'Table' }, h.root)).rejects.toThrow('design_catalog:')
    } finally {
      h.close()
    }
  })

  it('preserves requested order and duplicates and limits suggestions to misses', async () => {
    const h = await createHarness({ withProject: false })
    try {
      const names = ['Tabs', 'ItemTemplate', 'named-disclosure', 'ItemTemplte', 'Tabs']
      const result = await callTool(h, toolName, { names }, h.root)
      expect(result.results.map((entry: { requested: string }) => entry.requested)).toEqual(names)
      expect(result.results.map((entry: { kind?: string }) => entry.kind)).toEqual([
        'component',
        'construct',
        'recipe',
        undefined,
        'component',
      ])
      expect(result.results.filter((entry: { closest?: string[] }) => entry.closest !== undefined)).toEqual([
        expect.objectContaining({ requested: 'ItemTemplte', closest: expect.arrayContaining(['ItemTemplate']) }),
      ])
      const text = h.tools.get(toolName).output.render({ names }, result)[0].text
      expect(text).toContain('Example (inside a Screen')
      expect(text).toContain('design/fixtures/resources.json')
      expect(text).toContain('call with no arguments for the index')
      expect(text.indexOf('<Tabs> (component)')).toBeLessThan(text.indexOf('ItemTemplate (construct)'))
    } finally {
      h.close()
    }
  })

  it('rejects ambiguous and oversized batches and handles inherited-looking names', async () => {
    const h = await createHarness({ withProject: false })
    try {
      for (const args of [
        { names: [], name: 'Tabs' },
        { names: [] },
        { names: Array.from({ length: MAX_CATALOG_NAMES + 1 }, () => 'Tabs') },
        { names: [5] },
        { names: ['a'.repeat(81)] },
      ])
        await expect(callTool(h, toolName, args, h.root)).rejects.toThrow('design_catalog:')
      const miss = await callTool(h, toolName, { name: 'constructor' }, h.root)
      expect(miss.error).toContain('Unknown component')
    } finally {
      h.close()
    }
  })
})

const index = designCatalog({})
if (!('components' in index)) throw new Error('Missing catalog index')
const indexed = [...index.components, ...index.constructs, ...index.recipes]

function intent(query: string) {
  const result = designCatalog({ query })
  if (!('matches' in result)) throw new Error('Missing intent results')
  return result
}

it.each([
  ['How can I make a table with fictitious data?', 'fixture-table'],
  ['Como fazer uma tabela com dados fictícios?', 'fixture-table'],
  ['Shared layout with sidebar navigation', 'shared-sidebar'],
  ['navegação lateral partilhada', 'shared-sidebar'],
  ['campo ao lado do botão', 'action-bar'],
  ['gaveta de filtros', 'filter-drawer'],
  ['bloco de código', 'CodeBlock'],
  ['aviso em linha', 'Callout'],
  ['controlo segmentado', 'SelectButton'],
  ['botão de alternância', 'ToggleButton'],
  ['interruptor visual', 'Switch'],
  ['button with menu', 'SplitButton'],
  ['popover ancorado', 'Popover'],
  ['SELECTBUTTON', 'SelectButton'],
])('ranks %s first as %s without expanding examples', (query, name) => {
  const result = intent(query)
  expect(result.matches[0]?.name).toBe(name)
  expect(Object.keys(result.matches[0] ?? {}).sort()).toEqual(['description', 'kind', 'name'])
  expect(formatCatalog(result)).toContain(name + ' (')
  expect(formatCatalog(result)).not.toContain('Example (')
})

it('normalizes accents, capitalization, punctuation, and equivalent Unicode', () => {
  expect(intent('     TABELA COM DADOS FICTÍCIOS!!! ').matches).toEqual(intent('tabela com dados ficticios').matches)
  expect(intent('navegação lateral'.normalize('NFD')).matches).toEqual(intent('Navegacao lateral').matches)
  expect(intent('TaBeLa cOM DaDoS FiCTíCiOs').matches).toEqual(intent('tabela com dados ficticios').matches)
  expect(intent('show me a SelectButton').matches[0]?.name).toBe('SelectButton')
})

it('uses canonical order for tied matches and caps broad searches at eight', () => {
  const names = indexed.filter((entry) => 'category' in entry && entry.category === 'form').map(({ name }) => name)
  expect(names.length).toBeGreaterThan(8)
  const first = intent('form')
  expect(first.matches.map(({ name }) => name)).toEqual(names.sort().slice(0, 8))
  expect(intent('form form form').matches).toEqual(first.matches)
  expect(intent('form')).toEqual(first)
})

it('returns an explicit no match, rejects conflicting modes, and enforces the query bound', () => {
  for (const query of ['xylophonic quasar', '???', 'que como e']) {
    expect(intent(query)).toEqual({ query, matches: [] })
    expect(formatCatalog(intent(query))).toContain('No relevant catalog match')
  }
  for (const args of [
    { name: 'Tabs', query: 'layout' },
    { names: ['Tabs'], query: '' },
    { names: [], query: 'layout' },
  ]) {
    expect(() => designCatalog(args)).toThrow('use query alone')
  }
  expect(intent('x'.repeat(MAX_CATALOG_QUERY_LENGTH)).matches).toEqual([])
  expect(() => designCatalog({ query: 'x'.repeat(MAX_CATALOG_QUERY_LENGTH + 1) })).toThrow('at most')
  expect(() => designCatalog({ query: '   ' })).toThrow('non-blank')
  expect(designCatalog({ name: 'tabela com dados fictícios' })).toMatchObject({
    error: 'Unknown component "tabela com dados fictícios".',
  })
})

it('links exact references in details without expanding the compact index', () => {
  expect(designCatalog({ name: 'Drawer' })).toMatchObject({ related: ['filter-drawer', 'states'] })
  const linked = designCatalog({ names: ['filter-drawer', 'CodeBlock', 'shared-sidebar'] })
  expect(formatCatalog(linked)).toContain('Related (exact names): Drawer, states, Select, Journey')
  for (const { name } of indexed) {
    const entry = designCatalog({ name })
    if (!('related' in entry) || entry.related === undefined) continue
    for (const related of entry.related) {
      expect(related).not.toBe(name)
      expect(designCatalog({ name: related })).toMatchObject({ name: related })
    }
  }
  expect(indexed.every((entry) => !('example' in entry) && !('related' in entry))).toBe(true)
})

async function withExample<T>(
  name: string,
  check: (project: Awaited<ReturnType<typeof loadProject>>) => Promise<T> | T,
) {
  const entry = designCatalog({ name })
  if (!('example' in entry)) throw new Error('Missing catalog example for ' + name)
  const root = await mkdtemp(join(tmpdir(), 'dsh-design-catalog-'))
  const folder = join(root, 'design')
  try {
    await scaffoldProject(root, { kitVersion: KIT_VERSION })
    const files: Record<string, string> = { ...entry.exampleFiles }
    switch (entry.exampleContext) {
      case 'screen-file':
        files['screens/home.dsx'] = entry.example
        break
      case 'screen-child':
        files['screens/home.dsx'] = '<Screen id="home">' + entry.example + '</Screen>'
        break
      case 'journey-file':
        files['journeys/confirm.dsx'] = entry.example
        break
      case 'preview-file':
        files['preview.json'] = entry.example
        break
    }
    for (const [path, source] of Object.entries(files)) {
      const full = join(folder, path)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, source)
    }
    const project = await loadProject({ folder, kit: kitMetadata, installedKitVersion: KIT_VERSION })
    expect(project.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([])
    if (entry.exampleContext === 'journey-file') expect(project.journeys).toHaveLength(1)
    if (entry.exampleContext === 'preview-file') expect(project.preview?.situations).toHaveLength(1)
    return await check(project)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

it.each(indexed)('validates the $name example in context', async ({ name }) => {
  await withExample(name, () => undefined)
})

it('composes one shared sidebar with two distinct screen bodies', async () => {
  await withExample('shared-sidebar', (project) => {
    for (const [screen, body, absent] of [
      ['home', 'overview-body', 'reports-body'],
      ['reports', 'reports-body', 'overview-body'],
    ]) {
      const root = project.screens.find(({ id }) => id === screen)?.lastValidRoot
      if (root === undefined) throw new Error('Missing composed screen ' + screen)
      expect(findNode(root, 'sidebar')?.source.file).toBe('layouts/workspace.dsx')
      expect(findNode(root, body!)?.source.file).toBe('screens/' + screen + '.dsx')
      expect(findNode(root, absent!)).toBeUndefined()
    }
  })
})

const chromiumPath = await findChromium()
const assetsDir = fileURLToPath(new URL('../../renderer/dist/', import.meta.url))

it.skipIf(chromiumPath === undefined)(
  'navigates shared screens, grows the action bar, opens the drawer, and renders fixture rows in Chromium',
  async () => {
    const sessionId = 'catalog-recipes'
    const browsers = new BrowserSessions(chromiumPath === undefined ? {} : { executablePath: chromiumPath })
    try {
      await withExample('shared-sidebar', async (project) => {
        const payload = await payloadFor(project, sessionId)
        await browsers.run(
          { payload, sessionId, assetsDir, screen: 'home', breakpoint: 'desktop', breakpointWidth: 1280 },
          async (page) => {
            await page.getByRole('button', { name: 'Reports' }).click()
            await page.locator('[data-dsx-id="reports-body"]').waitFor()
            await page.getByRole('button', { name: 'Overview' }).click()
            await page.locator('[data-dsx-id="overview-body"]').waitFor()
          },
        )
      })
      await withExample('action-bar', async (project) => {
        const payload = await payloadFor(project, sessionId)
        await browsers.run(
          { payload, sessionId, assetsDir, screen: 'home', breakpoint: 'desktop', breakpointWidth: 1280 },
          async (page) => {
            const field = page.getByRole('textbox', { name: 'Repository' })
            const button = page.getByRole('button', { name: 'Continue' })
            const fieldBox = await field.boundingBox()
            const buttonBox = await button.boundingBox()
            expect(fieldBox?.width).toBeGreaterThan(640)
            expect((fieldBox?.x ?? 0) + (fieldBox?.width ?? 0)).toBeLessThanOrEqual(buttonBox?.x ?? 0)
            await field.fill('Synthetic repository')
            await button.click()
            await page.getByText('Ready to review.').waitFor()
          },
        )
      })
      await withExample('filter-drawer', async (project) => {
        const payload = await payloadFor(project, sessionId)
        await browsers.run(
          { payload, sessionId, assetsDir, screen: 'home', breakpoint: 'mobile', breakpointWidth: 390 },
          async (page) => {
            const drawer = page.getByRole('dialog', { name: 'Filters' })
            expect(await drawer.isVisible()).toBe(false)
            await page.getByRole('button', { name: 'Filter orders' }).click()
            await drawer.waitFor()
            await drawer.getByRole('combobox', { name: 'Status' }).selectOption('closed')
            await drawer.getByRole('button', { name: 'Done' }).click()
            await drawer.waitFor({ state: 'hidden' })
          },
        )
      })
      await withExample('fixture-table', async (project) => {
        const payload = await payloadFor(project, sessionId)
        await browsers.run(
          { payload, sessionId, assetsDir, screen: 'home', breakpoint: 'mobile', breakpointWidth: 390 },
          async (page) => {
            const table = page.getByRole('table')
            expect(await table.getByRole('row').count()).toBe(3)
            expect(await table.getByRole('cell').allTextContents()).toEqual([
              'Sample order A',
              'Active',
              'Sample order B',
              'Closed',
            ])
          },
        )
      })
    } finally {
      await browsers.disposeAll()
    }
  },
  30_000,
)
