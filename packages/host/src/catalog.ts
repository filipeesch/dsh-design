/** Model-facing references: derive component details from the kit and curate actual DSX examples. */
import { editDistance, propsOf, type PropMeta } from '@filipeesch/dsh-design-core'
import { componentNames, kitMetadata } from '@filipeesch/dsh-design-kit/meta'

export const MAX_CATALOG_NAMES = 8
const MAX_NAME_LENGTH = 80

type CatalogKind = 'component' | 'construct' | 'recipe'
type ExampleContext = 'screen-child' | 'tabs-child' | 'screen-file' | 'journey-file' | 'preview-file'
interface CatalogEntry {
  readonly name: string
  readonly description: string
  readonly kind: CatalogKind
  readonly props?: readonly PropMeta[]
  readonly exampleContext: ExampleContext
  readonly example: string
  /** Additional files relative to design/. */
  readonly exampleFiles?: Readonly<Record<string, string>>
}

const listExample = `<List id="resources" items={fixture("resources")}>
  <ItemTemplate><ListItem><Text>{item("name")}</Text></ListItem></ItemTemplate>
</List>`
const fixtureFiles = { 'fixtures/resources.json': '[{"id":"guide","name":"Getting started"}]' }
const variantExample = `<Variants id="layout" chosen="compact">
  <Variant branch="compact"><Text>Compact view</Text></Variant>
  <Variant branch="spacious"><Card><Text>Spacious view</Text></Card></Variant>
</Variants>`
const disclosureScreen = `<Screen id="home" title="Help" states={{ "details-open": { disclosures: { details: true } } }}>
  <Disclosure id="details" label="Delivery details"><Text>Allow two days.</Text></Disclosure>
</Screen>`
const detailsFile = '<Screen id="details" title="Details"><Text>Here are the details.</Text></Screen>'
const references: readonly CatalogEntry[] = [
  ...[
    ['ItemTemplate', 'Direct child of a fixture-bound List; repeats its children for each item.'],
    ['fixture', 'Bind fictitious records from design/fixtures/<name>.json to a collection prop.'],
    ['item', 'Read a scalar field of the current fixture item inside ItemTemplate.'],
  ].map(([name, description]): CatalogEntry => ({
    name: name!,
    description: description!,
    kind: 'construct',
    exampleContext: 'screen-child',
    example: listExample,
    exampleFiles: fixtureFiles,
  })),
  ...[
    ['Variants', 'Group two or more visual alternatives with a chosen branch.'],
    ['Variant', 'One branch of a Variants group.'],
  ].map(([name, description]): CatalogEntry => ({
    name: name!,
    description: description!,
    kind: 'construct',
    exampleContext: 'screen-child',
    example: variantExample,
  })),
  {
    name: 'states',
    description: 'Screen prop assigning initial values, tabs, overlays, or Disclosure expansion by stable node id.',
    kind: 'construct',
    exampleContext: 'screen-file',
    example: `<Screen id="home" states={{ "filter-open": { open: ["filters"], values: { search: "guide" } } }}>
  <Drawer id="filters" title="Filters"><Input id="search" label="Search" /></Drawer>
</Screen>`,
  },
  {
    name: 'Journey',
    description: 'Define an acceptance flow with actions and assertions targeting stable design ids.',
    kind: 'construct',
    exampleContext: 'journey-file',
    example: `<Journey id="confirm" start="home">
  <Tap target="continue" />
  <ExpectScreen screen="details" />
</Journey>`,
    exampleFiles: {
      'screens/home.dsx':
        '<Screen id="home"><Button id="continue" onPress={navigate("details")}>Continue</Button></Screen>',
      'screens/details.dsx': detailsFile,
    },
  },
  {
    name: 'responsive-layout',
    description: 'Use one semantic layout whose direction changes with the viewport.',
    kind: 'recipe',
    exampleContext: 'screen-child',
    example: `<Stack direction={{ mobile: "column", desktop: "row" }} gap="spacing.md">
  <Card><Text>Summary</Text></Card>
  <Card><Text>Details</Text></Card>
</Stack>`,
  },
  {
    name: 'screen-navigation',
    description: 'Connect a primary action to an existing local screen.',
    kind: 'recipe',
    exampleContext: 'screen-child',
    example: '<Button id="continue" onPress={navigate("details")}>Continue</Button>',
    exampleFiles: { 'screens/details.dsx': detailsFile },
  },
  {
    name: 'named-disclosure',
    description: 'Reveal content in place and link to a named initially expanded state.',
    kind: 'recipe',
    exampleContext: 'screen-file',
    example: disclosureScreen,
  },
  {
    name: 'preview-context',
    description: 'Give a screen a durable summary and a named, repeatable review situation.',
    kind: 'recipe',
    exampleContext: 'preview-file',
    example: `{
  "screens": {"home": {"summary": "Explain delivery options."}},
  "situations": [{"id": "delivery-explained", "label": "Delivery details open", "parent": "home", "target": {"screen": "home", "state": "details-open"}}]
}`,
    exampleFiles: { 'screens/home.dsx': disclosureScreen },
  },
]

const components = componentNames.map((name) => {
  const { description, category, tier } = kitMetadata[name]!
  return { name, description, category, tier }
})
const referenceIndex = (kind: CatalogKind) =>
  references.filter((entry) => entry.kind === kind).map(({ name, description }) => ({ name, description }))
const index = { components, constructs: referenceIndex('construct'), recipes: referenceIndex('recipe') }
const byName = new Map(references.map((entry) => [entry.name, entry]))

const strings = { type: 'array', items: { type: 'string' } }
const indexedEntries = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: true,
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
    },
  },
}
const lookupProperties = {
  name: { type: 'string' },
  kind: { type: 'string', enum: ['component', 'construct', 'recipe'] },
  description: { type: 'string' },
  props: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
  example: { type: 'string' },
  exampleContext: { type: 'string' },
  exampleFiles: { type: 'object', additionalProperties: true, properties: {} },
  error: { type: 'string' },
  closest: strings,
}

export const catalogOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...lookupProperties,
    components: indexedEntries,
    constructs: indexedEntries,
    recipes: indexedEntries,
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { ...lookupProperties, requested: { type: 'string', required: true } },
      },
    },
  },
}

interface CatalogMiss {
  readonly error: string
  readonly closest: readonly string[]
}

type CatalogLookup = CatalogEntry | CatalogMiss
type CatalogResult = typeof index | CatalogLookup | { results: readonly ({ requested: string } & CatalogLookup)[] }

function lookup(name: string, batch: boolean): CatalogLookup {
  if (Object.hasOwn(kitMetadata, name)) {
    const meta = kitMetadata[name]!
    return {
      name: meta.name,
      description: meta.description,
      kind: 'component',
      props: propsOf(meta),
      example: meta.example,
      exampleContext: name === 'Screen' ? 'screen-file' : name === 'Tab' ? 'tabs-child' : 'screen-child',
      ...(name === 'Button' ? { exampleFiles: { 'screens/details.dsx': detailsFile } } : {}),
    }
  }
  const reference = byName.get(name)
  if (reference !== undefined) return reference
  // Keep the single-name component error and component-only matches for legacy callers.
  const candidates = batch ? [...componentNames, ...byName.keys()] : componentNames
  const closest = candidates
    .map((candidate) => ({ candidate, distance: editDistance(name, candidate) }))
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))
    .slice(0, 3)
    .map((entry) => entry.candidate)
  return { error: 'Unknown ' + (batch ? 'catalog entry ' : 'component ') + JSON.stringify(name) + '.', closest }
}

export function designCatalog(args: { name?: string; names?: readonly string[] }): CatalogResult {
  const { name, names } = args
  if (name !== undefined && names !== undefined) throw new Error('design_catalog: use either name or names, not both')
  if (names !== undefined && (names.length < 1 || names.length > MAX_CATALOG_NAMES)) {
    throw new Error('design_catalog: names must contain 1–' + String(MAX_CATALOG_NAMES) + ' entries')
  }
  const requested = names ?? (name === undefined ? [] : [name])
  if (requested.some((entry) => entry.length > MAX_NAME_LENGTH)) {
    throw new Error('design_catalog: names must be at most ' + String(MAX_NAME_LENGTH) + ' characters each')
  }
  if (names !== undefined) return { results: names.map((entry) => ({ requested: entry, ...lookup(entry, true) })) }
  return name === undefined ? index : lookup(name, false)
}

const contexts: Readonly<Record<ExampleContext, string>> = {
  'screen-child': 'inside a Screen in design/screens/*.dsx',
  'tabs-child': 'inside a Tabs with an id, within a Screen',
  'screen-file': 'complete design/screens/*.dsx file',
  'journey-file': 'complete design/journeys/*.dsx file',
  'preview-file': 'complete design/preview.json file',
}

function formatLookup(entry: CatalogLookup): string {
  if ('error' in entry)
    return (
      entry.error +
      ' Closest: ' +
      entry.closest.join(', ') +
      '. Use one of these names or call with no arguments for the index.'
    )
  const props =
    entry.props?.map(
      (prop) =>
        '  ' +
        prop.name +
        ': ' +
        prop.kind +
        (prop.values === undefined ? '' : ' (' + prop.values.join(' | ') + ')') +
        (prop.required === true ? ' required' : '') +
        (prop.default === undefined ? '' : '; default ' + JSON.stringify(prop.default)) +
        ' — ' +
        prop.description,
    ) ?? []
  return [
    (entry.kind === 'component' ? '<' + entry.name + '>' : entry.name) + ' (' + entry.kind + ') — ' + entry.description,
    ...props,
    '',
    'Example (' + contexts[entry.exampleContext] + '):',
    entry.example,
    ...Object.entries(entry.exampleFiles ?? {}).flatMap(([path, source]) => ['', 'design/' + path + ':', source]),
  ].join('\n')
}

export function formatCatalog(value: CatalogResult): string {
  if ('results' in value) return value.results.map(formatLookup).join('\n\n')
  if (!('components' in value)) return formatLookup(value)
  const lines = (entries: readonly { name: string; description: string }[]) =>
    entries.map(({ name, description }) => name + ' — ' + description).join('\n')
  return [
    'Components:\n' + lines(value.components),
    'DSX constructs:\n' + lines(value.constructs),
    'Composition recipes:\n' + lines(value.recipes),
  ].join('\n\n')
}
