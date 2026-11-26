import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadProject, propsOf, scaffoldProject } from '@filipeesch/dsh-design-core'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { designCatalog, MAX_CATALOG_NAMES } from '../src/catalog.ts'
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

it.each([...index.components, ...index.constructs, ...index.recipes])(
  'validates the $name example in context',
  async ({ name }) => {
    const entry = designCatalog({ name })
    if (!('example' in entry)) throw new Error('Missing catalog example for ' + name)
    const root = await mkdtemp(join(tmpdir(), 'dsh-design-catalog-'))
    const folder = join(root, 'design')
    await scaffoldProject(root, { kitVersion: KIT_VERSION })
    const files: Record<string, string> = { ...entry.exampleFiles }
    switch (entry.exampleContext) {
      case 'screen-file':
        files['screens/home.dsx'] = entry.example
        break
      case 'screen-child':
        files['screens/home.dsx'] = '<Screen id="home">' + entry.example + '</Screen>'
        break
      case 'tabs-child':
        files['screens/home.dsx'] = '<Screen id="home"><Tabs id="tabs">' + entry.example + '</Tabs></Screen>'
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
  },
)
