import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadProject,
  scaffoldProject,
  parsePreviewMetadata,
  MAX_PREVIEW_ITEMS,
  MAX_PREVIEW_METADATA_BYTES,
  navigationRelationships,
  navigationTargets,
  parseScreen,
} from '../src/index.ts'

const roots: string[] = []
const directories = async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preview-meta-'))
  roots.push(root)
  await scaffoldProject(root, { kitVersion: KIT_VERSION })
  const folder = join(root, 'design')
  await writeFile(
    join(folder, 'screens', 'home.dsx'),
    '<Screen id="home" title="Review" states={{ "filter-open": { open: ["filter"] } }}><Drawer id="filter" title="Filter" /><Button id="filters" onPress={open("filter")}>Filter</Button></Screen>',
  )
  await writeFile(join(folder, 'screens', 'orders.dsx'), '<Screen id="orders" title="Orders" />')
  await writeFile(join(folder, 'screens', 'settings.dsx'), '<Screen id="settings" />')
  return { root, folder, get: () => loadProject({ folder, kit: kitMetadata, installedKitVersion: KIT_VERSION }) }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const detail = {
  id: 'filtering',
  label: 'Filter orders',
  parent: 'home',
  target: { screen: 'home', state: 'filter-open' },
}
const alternateEntry = { id: 'review-orders', label: 'Review orders', parent: 'home', target: { screen: 'orders' } }

describe('versioned preview metadata', () => {
  it('preserves legacy loading and resolves authored review selections after named states', async () => {
    const { folder, get } = await directories()
    const legacy = await get()
    expect(legacy.preview).toBeUndefined()
    expect(legacy.diagnostics.filter((issue) => issue.severity === 'error')).toEqual([])
    const summary = 'Compare <pending> orders.'
    const groups = [
      { id: 'first', label: 'First', screens: ['orders', 'home'] },
      { id: 'second', label: 'Second', screens: ['settings'] },
    ]
    await writeFile(
      join(folder, 'preview.json'),
      JSON.stringify({
        screens: { home: { summary, details: ' Look at the Filter control. ' } },
        groups,
        situations: [detail, alternateEntry],
        relationships: [
          {
            id: 'approve',
            label: 'Approval',
            kind: 'simulated',
            from: { situation: 'filtering' },
            to: { situation: 'review-orders' },
          },
        ],
      }),
    )
    const loaded = await get()
    expect(loaded.diagnostics.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(loaded.preview).toEqual({
      screens: { home: { summary, details: 'Look at the Filter control.' } },
      groups,
      situations: [detail, alternateEntry],
      relationships: [
        {
          id: 'approve',
          label: 'Approval',
          kind: 'simulated',
          from: { screen: 'home', state: 'filter-open', situation: 'filtering' },
          to: { screen: 'orders', situation: 'review-orders' },
        },
      ],
    })
    expect(loaded.screens).toEqual(legacy.screens)
  })

  it('omits ambiguous entries and dangling, external, or executable endpoints with source locations', async () => {
    const { get } = await directories()
    const project = await get()
    const source = JSON.stringify(
      {
        screens: { home: { summary: 'Keep this' }, settings: { summary: 'x'.repeat(321) } },
        situations: [
          detail,
          { ...detail, id: 'duplicate-destination', parent: 'orders' },
          { ...alternateEntry, id: 'home' },
          { ...alternateEntry, id: 'same', target: { screen: 'home' } },
          { ...alternateEntry, id: 'stale', target: { screen: 'orders', state: 'removed' } },
          alternateEntry,
        ],
        relationships: [
          {
            id: 'old',
            label: 'Removed',
            kind: 'illustrative',
            from: { screen: 'home' },
            to: { situation: 'filtering' },
          },
          {
            id: 'remote',
            label: 'External',
            kind: 'illustrative',
            from: { screen: 'home' },
            to: { screen: 'https://example.com/' },
          },
          {
            id: 'dangling',
            label: 'Removed screen',
            kind: 'simulated',
            from: { screen: 'home' },
            to: { screen: 'removed' },
          },
          {
            id: 'both',
            label: 'Ambiguous',
            kind: 'simulated',
            from: { screen: 'home', situation: 'review-orders' },
            to: { screen: 'orders' },
          },
          {
            id: 'outside',
            label: 'Separate project',
            kind: 'simulated',
            from: { screen: 'home' },
            to: { screen: '../orders' },
          },
          {
            id: 'action',
            label: 'No code',
            kind: 'simulated',
            from: { screen: 'home' },
            to: { screen: 'orders' },
            script: 'navigate()',
          },
          {
            id: 'valid',
            label: 'Local reference',
            kind: 'illustrative',
            from: { screen: 'home' },
            to: { situation: 'review-orders' },
          },
        ],
      },
      null,
      2,
    )
    const result = parsePreviewMetadata(source, project.screens)
    expect(result.preview).toMatchObject({
      screens: { home: { summary: 'Keep this' } },
      situations: [alternateEntry],
      relationships: [{ id: 'valid' }],
    })
    expect(Object.keys(result.preview!.screens)).toEqual(['home'])
    expect(result.diagnostics.filter((issue) => issue.code === 'preview-duplicate-destination')).toHaveLength(2)
    expect(result.diagnostics.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'preview-state',
        'preview-situation-alias',
        'preview-endpoint',
        'preview-screen',
        'preview-id',
        'preview-field',
        'preview-text',
      ]),
    )
    const external = result.diagnostics.find((issue) => issue.message.includes('$.relationships[1].to.screen'))!
    expect(external.file).toBe('preview.json')
    expect(source.split('\n')[external.line - 1]).toContain('https://example.com/')
    expect(external.column).toBeGreaterThan(1)
  })

  it('bounds input and reports syntax, duplicate keys, and non-local files without blocking valid design', async () => {
    const { root, folder, get } = await directories()
    const preview = join(folder, 'preview.json')
    const external = join(root, 'external.json')
    await writeFile(external, '{"screens":{"home":{"summary":"Outside"}}}')
    await symlink(external, preview)
    const inaccessible = await get()
    expect(inaccessible.preview).toBeUndefined()
    expect(inaccessible.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'preview-read', file: 'preview.json' }),
    )
    expect(inaccessible.screens.find((screen) => screen.id === 'home')?.blockingErrors).toBe(0)
    await rm(preview)
    await writeFile(preview, '{\n  "screens": {"home": }\n}')
    const broken = await get()
    expect(broken.diagnostics).toContainEqual(expect.objectContaining({ code: 'preview-json', line: 2 }))
    expect(broken.preview).toBeUndefined()
    await writeFile(preview, ' '.repeat(MAX_PREVIEW_METADATA_BYTES + 1))
    expect((await get()).diagnostics).toContainEqual(expect.objectContaining({ code: 'preview-limit' }))
    const duplicate = parsePreviewMetadata(
      '{"screens":{"home":{"summary":"First","summary":"Duplicate"},"orders":{"summary":"Valid"}}}',
      broken.screens,
    )
    expect(duplicate.preview?.screens).toEqual({ orders: { summary: 'Valid' } })
    expect(duplicate.diagnostics).toContainEqual(expect.objectContaining({ code: 'preview-duplicate-key' }))
    const list = parsePreviewMetadata(
      JSON.stringify({
        groups: Array.from({ length: MAX_PREVIEW_ITEMS + 1 }, (_, i) => ({
          id: 'group-' + i,
          label: 'Group',
          screens: ['home'],
        })),
      }),
      broken.screens,
    )
    expect(list.diagnostics).toContainEqual(expect.objectContaining({ code: 'preview-limit' }))
    expect(list.preview?.groups.map((group) => group.id)).toEqual(['group-0'])
  })
})

describe('resolved navigation edges', () => {
  it('shares destination discovery with edge identities and labels, excluding local actions', () => {
    const make = (copy: string, target: string) =>
      parseScreen(
        '<Screen id="home"><Button id="go" onPress={navigate("' +
          target +
          '") }>' +
          copy +
          '</Button><IconButton id="info" label="About us" icon="info" onPress={navigate("about")} /><Button id="trigger" onPress={open("options")}>Open settings</Button><Drawer id="options" title="Options"><Card id="buy" onPress={navigate("cart")} /></Drawer><Tabs id="tabs"><Tab id="first" label="First" /></Tabs><Table columns={["Label"]} rows={[[navigate("non-action")]]} /></Screen>',
        'screens/home.dsx',
      ).root!
    const root = make('Review order', 'orders')
    const edges = navigationRelationships(root, kitMetadata)
    expect(edges).toMatchObject([
      { kind: 'prototype', nodeId: 'go', label: 'Review order', from: { screen: 'home' }, to: { screen: 'orders' } },
      { kind: 'prototype', nodeId: 'info', label: 'About us', to: { screen: 'about' } },
      { kind: 'prototype', nodeId: 'buy', label: 'buy', to: { screen: 'cart' } },
    ])
    expect(navigationTargets(root)).toEqual(['orders', 'about', 'cart'])
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(3)
    expect(navigationRelationships(make('Review the cart', 'cart'))[0]?.id).toBe(edges[0]?.id)
  })
})
