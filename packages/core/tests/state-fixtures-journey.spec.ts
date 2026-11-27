import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { expandScreen } from '../src/fixtures.ts'
import { parseJourney, validateJourney } from '../src/journey.ts'
import { parseScreen } from '../src/parse.ts'
import { loadProject } from '../src/project.ts'
import { extractNamedStates, stateCompatibility } from '../src/state.ts'
import { projectScreen } from '../src/view.ts'
import type { DesignChild, DesignElement } from '../src/types.ts'

const kitVersion = '1.0.0'

interface TempProject {
  readonly root: string
  readonly folder: string
}

async function project(): Promise<TempProject> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-design-model-'))
  const folder = join(root, 'design')
  await mkdir(join(folder, 'screens'), { recursive: true })
  await writeFile(join(folder, 'design.json'), JSON.stringify({ kitVersion, entry: 'orders' }))
  await writeFile(
    join(folder, 'tokens.json'),
    JSON.stringify({
      color: { text: { $value: '#334155', $type: 'color' }, surface: { $value: '#ffffff', $type: 'color' } },
      spacing: { md: { $value: '16px', $type: 'dimension' }, sm: { $value: '8px', $type: 'dimension' } },
    }),
  )
  return { root, folder }
}

async function load(folder: string, previous?: Awaited<ReturnType<typeof loadProject>>) {
  return loadProject({
    folder,
    kit: kitMetadata,
    installedKitVersion: kitVersion,
    ...(previous === undefined ? {} : { previous }),
  })
}

function walk(node: DesignChild | DesignElement, visit: (element: DesignElement) => void): void {
  if (node.kind === 'text') return
  visit(node as DesignElement)
  for (const child of node.children) walk(child, visit)
}

function screenSource(states: string): string {
  return `<Screen id="orders" title="Orders" states={${states}}>
  <Stack gap="spacing.md">
    <Input id="search" label="Search" value="initial" />
    <Tabs id="sections" value="all">
      <Tab id="tab-all" label="All" value="all"><Text>All orders</Text></Tab>
      <Tab id="tab-open" label="Open" value="open"><Text>Open orders</Text></Tab>
    </Tabs>
    <Button id="open-filters" onPress={open("filters")}>Filters</Button>
  </Stack>
  <Drawer id="filters" title="Filters"><Text>Filter body</Text></Drawer>
</Screen>`
}

describe('named screen states', () => {
  it('validates and keeps only declared metadata', async () => {
    const { folder } = await project()
    await writeFile(
      join(folder, 'screens', 'orders.dsx'),
      screenSource('{ "filter-open": { open: ["filters"], tabs: { sections: "open" }, values: { search: "acme" } } }'),
    )
    const loaded = await load(folder)
    expect(loaded.diagnostics).toEqual([])
    const screen = loaded.screens[0]!
    expect(screen.states).toHaveLength(1)
    expect(screen.states[0]).toMatchObject({
      name: 'filter-open',
      open: ['filters'],
      tabs: { sections: 'open' },
      values: { search: 'acme' },
    })
    expect(screen.root?.props.states).toBeUndefined()
  })

  it('reports invalid assignments with source locations and without applying them', async () => {
    const { folder } = await project()
    await writeFile(
      join(folder, 'screens', 'orders.dsx'),
      screenSource(
        '{ "bad-state": { open: ["search", "missing"], tabs: { sections: "nope", search: "x" }, values: { filters: "x", search: 4 } } }',
      ),
    )
    const loaded = await load(folder)
    const codes = loaded.diagnostics.map((diagnostic) => diagnostic.code)
    expect(codes).toEqual(
      expect.arrayContaining([
        'state-open-not-overlay',
        'state-open-missing',
        'state-tab-value',
        'state-tab-not-tabs',
        'state-value-type',
        'state-value-target',
      ]),
    )
    const diagnostic = loaded.diagnostics.find((entry) => entry.code === 'state-open-missing')!
    expect(diagnostic.file).toBe('screens/orders.dsx')
    expect(diagnostic.line).toBeGreaterThan(0)
    expect(loaded.screens[0]?.states).toEqual([])
  })

  it('rejects missing, incompatible, non-boolean, and non-map disclosure assignments', async () => {
    const { folder } = await project()
    const source = screenSource(
      '{ "invalid": { disclosures: { "missing": true, "search": true, "details": "true" } }, "wrong-shape": { disclosures: ["details"] }, "overlay": { open: ["details"] }, "field": { values: { details: true } } }',
    ).replace('</Screen>', '<Disclosure id="details" label="Details" /></Screen>')
    await writeFile(join(folder, 'screens', 'orders.dsx'), source)
    const loaded = await load(folder)
    expect(loaded.screens[0]?.states).toEqual([])
    expect(loaded.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'state-disclosure-missing',
        'state-disclosure-target',
        'state-disclosure-value',
        'state-disclosures-shape',
        'state-open-not-overlay',
        'state-value-target',
      ]),
    )
    for (const diagnostic of loaded.diagnostics) {
      expect(diagnostic.file).toBe('screens/orders.dsx')
      expect(diagnostic.line).toBeGreaterThan(0)
      expect(diagnostic.column).toBeGreaterThan(0)
    }
  })

  it('checks disclosure seed compatibility with the resolved projection', () => {
    const parsed = parseScreen('<Screen id="orders"><Input id="details" /></Screen>', 'screens/orders.dsx')
    expect(
      stateCompatibility(
        parsed.root!,
        {
          name: 'expanded',
          open: [],
          tabs: {},
          values: {},
          disclosures: { details: true, absent: false },
          source: { file: 'screens/orders.dsx', line: 1, column: 1 },
        },
        kitMetadata,
      ),
    ).toEqual([
      'seeds "details", which is not a Disclosure in this projection',
      'seeds disclosure "absent", which this projection does not render',
    ])
  })

  it('projects authored defaults, responsive defaults, and explicit disclosure seeds', () => {
    const parsed = parseScreen(
      '<Screen id="orders"><Disclosure id="price" label="Price">Price answer</Disclosure>' +
        '<Disclosure id="shipping" label="Shipping" defaultOpen={{ mobile: false, desktop: true }}>' +
        '<Text>Shipping answer</Text></Disclosure></Screen>',
      'screens/orders.dsx',
    )
    const breakpoints = [
      { name: 'mobile', width: 390 },
      { name: 'desktop', width: 1280 },
    ]
    const mobile = projectScreen(parsed.root!, { breakpoints, breakpoint: 'mobile' }).text
    expect(mobile).not.toContain('Price answer')
    expect(mobile).not.toContain('Shipping answer')
    expect(projectScreen(parsed.root!, { breakpoints }).text).toContain('Shipping answer')
    const seeded = projectScreen(parsed.root!, { breakpoints, disclosures: { price: true, shipping: false } }).text
    expect(seeded).toContain('Price answer')
    expect(seeded).not.toContain('Shipping answer')
  })

  it('reports duplicate state names at the states prop', async () => {
    const { folder } = await project()
    await writeFile(
      join(folder, 'screens', 'orders.dsx'),
      screenSource('{ "filter-open": { open: ["filters"] }, "filter-open": { open: [] } }'),
    )
    const loaded = await load(folder)
    const duplicate = loaded.diagnostics.find((diagnostic) => diagnostic.code === 'duplicate-object-key')
    expect(duplicate).toBeDefined()
    expect(duplicate?.file).toBe('screens/orders.dsx')
    expect(duplicate?.line).toBeGreaterThan(0)
  })

  it('retains the last valid states with the last valid tree', async () => {
    const { folder } = await project()
    await writeFile(join(folder, 'screens', 'orders.dsx'), screenSource('{ "filter-open": { open: ["filters"] } }'))
    const first = await load(folder)
    expect(first.screens[0]?.states).toHaveLength(1)
    await writeFile(join(folder, 'screens', 'orders.dsx'), screenSource('{ "filter-open": { open: ["missing"] } }'))
    const second = await load(folder, first)
    expect(second.screens[0]?.states.map((state) => state.name)).toEqual(['filter-open'])
    expect(second.screens[0]?.states[0]?.open).toEqual(['filters'])
    expect(second.screens[0]?.lastValidRoot).toBeDefined()
  })

  it('extracts a cold invalid screen with no invented states', async () => {
    const { folder } = await project()
    await writeFile(join(folder, 'screens', 'orders.dsx'), screenSource('{ "filter-open": { open: ["missing"] } }'))
    const loaded = await load(folder)
    expect(loaded.screens[0]?.states).toEqual([])
    expect(loaded.screens[0]?.lastValidRoot).toBeUndefined()
  })
})

const fixtureList =
  '<List id="orders-list" items={fixture("orders")} gap="spacing.md"><ItemTemplate><Card id="order-row"><Text>{item("name")}</Text><Text color="color.text">{item("status")}</Text><Button id="order-open" onPress={navigate("orders")}>Open</Button></Card></ItemTemplate></List>'

function fixtureScreen(extra = ''): string {
  return `<Screen id="orders" title="Orders">
  <Stack gap="spacing.md">
    ${fixtureList}
    <Table columns={[{ label: "Name", field: "name" }, { label: "Status", field: "status" }]} rows={fixture("orders")} />
    <Select id="status" label="Status" options={fixture("plans")} />
    <List gap="spacing.sm"><ListItem>Inline row</ListItem></List>
    ${extra}
  </Stack>
</Screen>`
}

const orders = [
  { id: 'order-1', name: 'Ada', status: 'open' },
  { id: 'order-2', name: 'Linus', status: 'closed' },
]
const plans = [
  { id: 'basic', label: 'Basic' },
  { id: 'pro', label: 'Pro' },
]

async function writeFixtures(
  folder: string,
  ordersValue: unknown = orders,
  plansValue: unknown = plans,
): Promise<void> {
  await mkdir(join(folder, 'fixtures'), { recursive: true })
  await writeFile(join(folder, 'fixtures', 'orders.json'), JSON.stringify(ordersValue, null, 2))
  await writeFile(join(folder, 'fixtures', 'plans.json'), JSON.stringify(plansValue, null, 2))
}

describe('fixtures and collection binding', () => {
  it('normalizes lists, tables, and selects into the kit tree', async () => {
    const { folder } = await project()
    await writeFixtures(folder)
    await writeFile(join(folder, 'screens', 'orders.dsx'), fixtureScreen())
    const loaded = await load(folder)
    expect(loaded.diagnostics).toEqual([])
    const root = loaded.screens[0]!.root!
    const elements: DesignElement[] = []
    walk(root, (element) => elements.push(element))
    const list = elements.find((element) => element.id === 'orders-list')!
    expect(list.props.items).toBeUndefined()
    const wrappers = list.children.filter((child): child is DesignElement => child.kind === 'element')
    expect(wrappers).toHaveLength(2)
    expect(wrappers.every((wrapper) => wrapper.type === 'ListItem' && wrapper.props.bare === true)).toBe(true)
    expect(wrappers[0]?.children.filter((child) => child.kind === 'element')).toHaveLength(1)
    const ids = elements.map((element) => element.id).filter((id): id is string => id !== undefined)
    expect(ids).toContain('orders-list-order-1')
    expect(ids).toContain('orders-list-order-2')
    expect(ids).toContain('orders-list-order-1-order-row')
    expect(ids).toContain('orders-list-order-1-order-open')
    expect(elements.some((element) => element.type === 'ItemTemplate')).toBe(false)
    const text = JSON.stringify(root)
    expect(text).toContain('Ada')
    expect(text).toContain('Linus')
    const table = elements.find((element) => element.type === 'Table')!
    expect(table.props.columns).toEqual(['Name', 'Status'])
    expect(table.props.rows).toEqual([
      ['Ada', 'open'],
      ['Linus', 'closed'],
    ])
    const select = elements.find((element) => element.type === 'Select')!
    expect(select.props.options).toEqual([
      { value: 'basic', label: 'Basic' },
      { value: 'pro', label: 'Pro' },
    ])
    expect(JSON.stringify(root)).toContain('Inline row')
  })

  it('seeds independent fixture-expanded disclosure ids and keeps boolean seeds after reordering', async () => {
    const { folder } = await project()
    const path = join(folder, 'screens', 'orders.dsx')
    await writeFixtures(folder)
    const source =
      '<Screen id="orders" states={{ expanded: { disclosures: { "rows-order-2-details": true, "rows-order-1-details": false } } }}>' +
      '<List id="rows" items={fixture("orders")}><ItemTemplate>' +
      '<Disclosure id="details" label="Details"><Text>{item("name")}</Text></Disclosure>' +
      '</ItemTemplate></List></Screen>'
    await writeFile(path, source)
    const first = await load(folder)
    expect(first.diagnostics).toEqual([])
    const states = first.screens[0]!.states
    expect(states[0]?.disclosures).toEqual({ 'rows-order-2-details': true, 'rows-order-1-details': false })
    await writeFixtures(folder, [...orders].reverse())
    const second = await load(folder)
    expect(second.diagnostics).toEqual([])
    expect(second.screens[0]!.states[0]?.disclosures).toEqual(states[0]?.disclosures)
  })

  it('keeps repeated identities stable across fixture reordering', async () => {
    const { folder } = await project()
    await writeFixtures(folder)
    await writeFile(join(folder, 'screens', 'orders.dsx'), fixtureScreen())
    const first = await load(folder)
    const firstIds = new Set<string>()
    walk(first.screens[0]!.root!, (element) => {
      if (element.id !== undefined) firstIds.add(element.id)
    })
    await writeFixtures(folder, [...orders].reverse())
    const second = await load(folder)
    const secondIds = new Set<string>()
    walk(second.screens[0]!.root!, (element) => {
      if (element.id !== undefined) secondIds.add(element.id)
    })
    expect([...secondIds].sort()).toEqual([...firstIds].sort())
    const row = JSON.parse(JSON.stringify(second.screens[0]!.root)) as DesignElement
    const order = JSON.parse(JSON.stringify(second.screens[0]!.root)) as DesignElement
    void row
    void order
  })

  it('keeps exactly one semantic listitem when the template root is a ListItem', async () => {
    const { folder } = await project()
    await writeFixtures(folder)
    await writeFile(
      join(folder, 'screens', 'orders.dsx'),
      '<Screen id="orders"><List id="rows" items={fixture("orders")}><ItemTemplate><ListItem id="row"><Text>{item("name")}</Text></ListItem></ItemTemplate></List></Screen>',
    )
    const loaded = await load(folder)
    expect(loaded.diagnostics).toEqual([])
    const list = loaded.screens[0]!.root!.children[0] as DesignElement
    const rows = list.children.filter((child): child is DesignElement => child.kind === 'element')
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.type === 'ListItem')).toBe(true)
    expect(rows.map((row) => row.id)).toEqual(['rows-order-1', 'rows-order-2'])
    expect(rows.every((row) => row.props.bare === undefined)).toBe(true)
  })

  it('renders an empty fixture collection without items', async () => {
    const { folder } = await project()
    await writeFixtures(folder, [], [])
    await writeFile(join(folder, 'screens', 'orders.dsx'), fixtureScreen())
    const loaded = await load(folder)
    expect(loaded.diagnostics).toEqual([])
    const elements: DesignElement[] = []
    walk(loaded.screens[0]!.root!, (element) => elements.push(element))
    const list = elements.find((element) => element.id === 'orders-list')!
    expect(list.children.filter((child) => child.kind === 'element')).toHaveLength(0)
    const table = elements.find((element) => element.type === 'Table')!
    expect(table.props.rows).toEqual([])
    const select = elements.find((element) => element.type === 'Select')!
    expect(select.props.options).toEqual([])
  })

  it('reports missing fixtures, fields, and invalid items with locations', async () => {
    const { folder } = await project()
    await writeFixtures(folder, [{ id: 'order-1', status: 'open' }])
    await writeFile(
      join(folder, 'screens', 'orders.dsx'),
      `<Screen id="orders"><List id="rows" items={fixture("nope")}><ItemTemplate><Text>{item("name")}</Text></ItemTemplate></List><List id="rows-2" items={fixture("orders")}><ItemTemplate><Text>{item("name")}</Text></ItemTemplate></List></Screen>`,
    )
    const loaded = await load(folder)
    const codes = loaded.diagnostics.map((diagnostic) => diagnostic.code)
    expect(codes).toContain('fixture-missing')
    expect(codes).toContain('fixture-field-missing')
    for (const diagnostic of loaded.diagnostics) {
      expect(diagnostic.line).toBeGreaterThan(0)
      expect(diagnostic.column).toBeGreaterThan(0)
    }
  })

  it('rejects invalid fixture files and configures no real data', async () => {
    const { folder } = await project()
    await mkdir(join(folder, 'fixtures'), { recursive: true })
    await writeFile(join(folder, 'fixtures', 'orders.json'), JSON.stringify([{ id: 'one', nested: { bad: true } }]))
    await writeFile(
      join(folder, 'fixtures', 'plans.json'),
      JSON.stringify([
        { id: 'a', label: 'A' },
        { id: 'a', label: 'B' },
      ]),
    )
    await writeFile(join(folder, 'screens', 'orders.dsx'), fixtureScreen())
    const loaded = await load(folder)
    const codes = loaded.diagnostics.map((diagnostic) => diagnostic.code)
    expect(codes).toContain('fixture-field-value')
    expect(codes).toContain('fixture-duplicate-id')
  })

  it('rejects a fixture binding on an unsupported prop and inline conflicts', async () => {
    const { folder } = await project()
    await writeFixtures(folder)
    await writeFile(
      join(folder, 'screens', 'orders.dsx'),
      `<Screen id="orders"><Box background={fixture("orders")} /><List id="rows" items={fixture("orders")}><ItemTemplate><Text>Row</Text></ItemTemplate><ListItem>Inline</ListItem></List></Screen>`,
    )
    const loaded = await load(folder)
    const codes = loaded.diagnostics.map((diagnostic) => diagnostic.code)
    expect(codes).toEqual(expect.arrayContaining(['fixture-unsupported', 'fixture-inline-conflict']))
  })

  it('expands a parsed tree directly and is deterministic', () => {
    const parsed = parseScreen(fixtureScreen(), 'screens/orders.dsx')
    expect(parsed.root).toBeDefined()
    const fixtures = {
      orders: {
        id: 'orders',
        file: 'fixtures/orders.json',
        items: [
          { id: 'order-2', fields: { name: 'Linus', status: 'closed' } },
          { id: 'order-1', fields: { name: 'Ada', status: 'open' } },
        ],
      },
      plans: { id: 'plans', file: 'fixtures/plans.json', items: [{ id: 'basic', fields: { label: 'Basic' } }] },
    }
    const first = expandScreen(parsed.root!, fixtures, 'screens/orders.dsx')
    const second = expandScreen(parsed.root!, fixtures, 'screens/orders.dsx')
    expect(first.diagnostics).toEqual([])
    expect(second.root).toEqual(first.root)
    const ids: string[] = []
    walk(first.root, (element) => {
      if (element.id !== undefined) ids.push(element.id)
    })
    expect(ids).toContain('orders-list-order-1')
    expect(ids).toContain('orders-list-order-2')
  })
})

const validJourney = `<Journey id="checkout-flow" start="orders" state="filter-open" breakpoint="mobile">
  <Tap target="open-filters" />
  <ExpectVisible target="filters" visible={true} />
  <Choose target="status" value="open" />
  <Type target="search" value="acme" />
  <ExpectValue target="search" value="acme" />
  <Navigate screen="checkout" />
  <ExpectScreen screen="checkout" />
  <ExpectCount target="checkout-confirm" count={1} />
</Journey>`

function journeyScreen(): string {
  return `<Screen id="orders" title="Orders" states={{ "filter-open": { open: ["filters"], values: { search: "", status: "open" } } }}>
  <Stack gap="spacing.md">
    <Input id="search" label="Search" />
    <Select id="status" label="Status" options={["open", "closed"]} />
    <Button id="open-filters" onPress={open("filters")}>Filters</Button>
    <Button id="go-checkout" onPress={navigate("checkout")}>Checkout</Button>
  </Stack>
  <Drawer id="filters" title="Filters"><Text>Filter body</Text></Drawer>
</Screen>`
}

const checkoutScreen = `<Screen id="checkout" title="Checkout"><Button id="checkout-confirm">Confirm</Button></Screen>`

describe('journey files', () => {
  it('parses typed steps and validates a journey against screens and states', async () => {
    const { folder } = await project()
    await mkdir(join(folder, 'journeys'), { recursive: true })
    await writeFile(join(folder, 'screens', 'orders.dsx'), journeyScreen())
    await writeFile(join(folder, 'screens', 'checkout.dsx'), checkoutScreen)
    await writeFile(join(folder, 'journeys', 'checkout-flow.dsx'), validJourney)
    const loaded = await load(folder)
    expect(loaded.diagnostics).toEqual([])
    const journey = loaded.journeys[0]!
    expect(journey.id).toBe('checkout-flow')
    expect(journey.journey?.steps.map((step) => step.kind)).toEqual([
      'tap',
      'expect-visible',
      'choose',
      'type',
      'expect-value',
      'navigate',
      'expect-screen',
      'expect-count',
    ])
  })

  it('rejects unknown steps, missing targets, expressions, and unknown screens before any browser action', async () => {
    const { folder } = await project()
    await mkdir(join(folder, 'journeys'), { recursive: true })
    await writeFile(join(folder, 'screens', 'orders.dsx'), journeyScreen())
    await writeFile(join(folder, 'screens', 'checkout.dsx'), checkoutScreen)
    await writeFile(
      join(folder, 'journeys', 'broken.dsx'),
      `<Journey id="broken" start="missing">
  <Tap target="nope" />
  <Type target="search" value={someVariable} />
  <ExpectVisible target="filters" visible="yes" />
  <Fly target="search" />
  <Navigate screen="ghost" />
</Journey>`,
    )
    const loaded = await load(folder)
    const codes = loaded.diagnostics.map((diagnostic) => diagnostic.code)
    expect(codes).toEqual(
      expect.arrayContaining([
        'journey-start-missing',
        'journey-expression',
        'journey-argument',
        'journey-step-unknown',
      ]),
    )
    for (const diagnostic of loaded.journeys[0]!.diagnostics) {
      expect(diagnostic.file).toBe('journeys/broken.dsx')
      expect(diagnostic.line).toBeGreaterThan(0)
    }
  })

  it('reports duplicate journey ids and missing declared states', async () => {
    const { folder } = await project()
    await mkdir(join(folder, 'journeys'), { recursive: true })
    await writeFile(join(folder, 'screens', 'orders.dsx'), journeyScreen())
    await writeFile(join(folder, 'screens', 'checkout.dsx'), checkoutScreen)
    await writeFile(
      join(folder, 'journeys', 'a.dsx'),
      '<Journey id="same" start="orders" state="nope"><ExpectScreen screen="orders" /></Journey>',
    )
    await writeFile(
      join(folder, 'journeys', 'b.dsx'),
      '<Journey id="same" start="orders"><ExpectScreen screen="orders" /></Journey>',
    )
    const loaded = await load(folder)
    const codes = loaded.diagnostics.map((diagnostic) => diagnostic.code)
    expect(codes).toContain('journey-state-missing')
    expect(codes).toContain('journey-duplicate-id')
  })

  it('parses one journey without a browser and rejects a stray root', () => {
    const parsed = parseJourney(validJourney, 'journeys/checkout-flow.dsx')
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.journey?.steps).toHaveLength(8)
    const stray = parseJourney('<Screen id="home" />', 'journeys/stray.dsx')
    expect(stray.diagnostics.map((diagnostic) => diagnostic.code)).toContain('journey-root')
    const screen = parseScreen(journeyScreen(), 'screens/orders.dsx').root!
    const validation = validateJourney(parseJourney(validJourney, 'journeys/checkout-flow.dsx'), {
      projectScreens: ['orders', 'checkout'],
      breakpoints: ['mobile', 'desktop'],
      rootOf: (id) => (id === 'orders' ? screen : undefined),
      statesOf: (id) => (id === 'orders' ? extractNamedStates(screen, 'screens/orders.dsx', kitMetadata).states : []),
    })
    expect(validation.map((diagnostic) => diagnostic.code)).toEqual([])
  })
})
