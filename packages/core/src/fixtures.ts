/**
 * Project-local JSON fixtures and declarative collection binding.
 *
 * Fixtures live in the design folder's optional `fixtures/` directory as
 * `<id>.json` arrays of flat objects with a unique kebab-case `id` and bounded
 * scalar fields. Bindings on List, Table, Select, MultiSelect, and Combobox are
 * normalized into the existing kit tree before validation and rendering, so the
 * preview, static tools, and headless checks share one representation.
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { formatAddress } from './parse.ts'
import { isFixtureRef, isItemRef, isReference } from './refs.ts'
import type {
  DesignChild,
  DesignElement,
  DesignProps,
  DesignPropValue,
  DesignScreenNode,
  Diagnostic,
  FixtureCollection,
  FixtureCollections,
  FixtureItem,
  StructuralAddress,
} from './types.ts'

/** Maximum fixture files in one project. */
export const MAX_FIXTURES = 32
/** Maximum items in one fixture collection. */
export const MAX_FIXTURE_ITEMS = 200
/** Maximum bytes of one fixture file. */
export const MAX_FIXTURE_FILE_BYTES = 64 * 1024
/** Maximum fields on one fixture item. */
export const MAX_FIXTURE_FIELDS = 20
/** Maximum characters in one fixture string field. */
export const MAX_FIXTURE_STRING = 200
/** Maximum expanded nodes produced for one screen. */
export const MAX_EXPANDED_NODES = 2000

const ID_PATTERN = /^[a-z][a-z0-9-]*$/
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

/** Fixtures loaded from disk plus their diagnostics. */
export interface LoadedFixtures {
  readonly collections: FixtureCollections
  readonly diagnostics: readonly Diagnostic[]
}

function diagnostic(file: string, code: string, message: string, suggestion?: string): Diagnostic {
  return {
    severity: 'error',
    code,
    file,
    line: 1,
    column: 1,
    message,
    ...(suggestion === undefined ? {} : { suggestion }),
  }
}

/** Read one fixture source into a validated collection. */
export function parseFixtureCollection(
  id: string,
  file: string,
  source: string,
  diagnostics: Diagnostic[],
): FixtureCollection | undefined {
  let document: unknown
  try {
    document = JSON.parse(source)
  } catch (error) {
    diagnostics.push(diagnostic(file, 'fixture-json', `Fixture "${id}" is not valid JSON: ${(error as Error).message}`))
    return undefined
  }
  if (!Array.isArray(document)) {
    diagnostics.push(
      diagnostic(file, 'fixture-shape', `Fixture "${id}" must be a JSON array of flat objects with a unique "id".`),
    )
    return undefined
  }
  if (document.length > MAX_FIXTURE_ITEMS) {
    diagnostics.push(
      diagnostic(
        file,
        'fixture-items-limit',
        `Fixture "${id}" has ${String(document.length)} items; the limit is ${String(MAX_FIXTURE_ITEMS)}.`,
      ),
    )
    return undefined
  }
  const items: FixtureItem[] = []
  const seen = new Set<string>()
  for (const [index, entry] of document.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      diagnostics.push(diagnostic(file, 'fixture-item', `Fixture "${id}" item ${String(index)} must be an object.`))
      continue
    }
    const record = entry as Record<string, unknown>
    const itemId = record.id
    if (typeof itemId !== 'string' || !ID_PATTERN.test(itemId)) {
      diagnostics.push(
        diagnostic(
          file,
          'fixture-item-id',
          `Fixture "${id}" item ${String(index)} needs an "id" matching [a-z][a-z0-9-]*.`,
        ),
      )
      continue
    }
    if (seen.has(itemId)) {
      diagnostics.push(diagnostic(file, 'fixture-duplicate-id', `Fixture "${id}" repeats item id "${itemId}".`))
      continue
    }
    const fields: Record<string, string | number | boolean> = {}
    let valid = true
    const keys = Object.keys(record).filter((key) => key !== 'id')
    if (keys.length > MAX_FIXTURE_FIELDS) {
      diagnostics.push(
        diagnostic(
          file,
          'fixture-field-limit',
          `Fixture "${id}" item "${itemId}" has more than ${String(MAX_FIXTURE_FIELDS)} fields.`,
        ),
      )
      valid = false
    }
    for (const key of keys.slice(0, MAX_FIXTURE_FIELDS)) {
      if (!FIELD_PATTERN.test(key)) {
        diagnostics.push(
          diagnostic(
            file,
            'fixture-field',
            `Fixture "${id}" item "${itemId}" field "${key}" must match [A-Za-z][A-Za-z0-9_]*.`,
          ),
        )
        valid = false
        continue
      }
      const value = record[key]
      if (typeof value === 'string') {
        if (value.length > MAX_FIXTURE_STRING) {
          diagnostics.push(
            diagnostic(
              file,
              'fixture-field-value',
              `Fixture "${id}" item "${itemId}" field "${key}" exceeds ${String(MAX_FIXTURE_STRING)} characters.`,
            ),
          )
          valid = false
          continue
        }
        fields[key] = value
        continue
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        fields[key] = value
        continue
      }
      if (typeof value === 'boolean') {
        fields[key] = value
        continue
      }
      diagnostics.push(
        diagnostic(
          file,
          'fixture-field-value',
          `Fixture "${id}" item "${itemId}" field "${key}" must be a string, number, or boolean.`,
        ),
      )
      valid = false
    }
    if (!valid) continue
    seen.add(itemId)
    items.push({ id: itemId, fields })
  }
  return { id, file, items }
}

/**
 * Load and validate every fixture collection under `<design-folder>/fixtures`.
 * The directory is optional; a missing directory is an empty set, not an error.
 */
export async function loadFixtures(folder: string): Promise<LoadedFixtures> {
  const diagnostics: Diagnostic[] = []
  const collections: Record<string, FixtureCollection> = {}
  const directory = join(folder, 'fixtures')
  let entries: { name: string; isFile(): boolean; isSymbolicLink(): boolean }[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return { collections, diagnostics }
  }
  const files = entries
    .filter((entry) => entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
  if (files.length > MAX_FIXTURES) {
    diagnostics.push(
      diagnostic(
        'fixtures',
        'fixture-limit',
        `The project has ${String(files.length)} fixture files; the limit is ${String(MAX_FIXTURES)}.`,
      ),
    )
  }
  const realFolder = await realpath(folder).catch(() => undefined)
  for (const entry of files.slice(0, MAX_FIXTURES)) {
    const file = 'fixtures/' + entry.name
    const id = entry.name.slice(0, -'.json'.length)
    if (!ID_PATTERN.test(id)) {
      diagnostics.push(
        diagnostic(file, 'fixture-name', `Fixture file name "${entry.name}" must be a kebab-case id plus ".json".`),
      )
      continue
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      diagnostics.push(
        diagnostic(file, 'fixture-not-file', `Fixture "${file}" must be a plain file inside the design folder.`),
      )
      continue
    }
    const absolute = join(directory, entry.name)
    if (realFolder !== undefined) {
      const real = await realpath(absolute).catch(() => undefined)
      if (real === undefined || (real !== realFolder && !real.startsWith(realFolder + sep))) {
        diagnostics.push(diagnostic(file, 'fixture-outside', `Fixture "${file}" resolves outside the design folder.`))
        continue
      }
    }
    const info = await stat(absolute).catch(() => undefined)
    if (info === undefined || !info.isFile() || info.size > MAX_FIXTURE_FILE_BYTES) {
      diagnostics.push(
        diagnostic(
          file,
          'fixture-size',
          `Fixture "${file}" must be a file of at most ${String(MAX_FIXTURE_FILE_BYTES)} bytes.`,
        ),
      )
      continue
    }
    const source = await readFile(absolute, 'utf8').catch(() => undefined)
    if (source === undefined) {
      diagnostics.push(diagnostic(file, 'fixture-read', `Fixture "${file}" could not be read.`))
      continue
    }
    const collection = parseFixtureCollection(id, file, source, diagnostics)
    if (collection !== undefined) collections[id] = collection
  }
  return { collections, diagnostics }
}

/** Internal mutable view of a parsed element during expansion. */
type MutableElement = DesignElement & { props: DesignProps; children: DesignChild[]; id?: string }

/** Context for one screen expansion. */
interface ExpandContext {
  readonly fixtures: FixtureCollections
  readonly file: string
  readonly diagnostics: Diagnostic[]
  expanded: number
}

function errorAt(
  ctx: ExpandContext,
  node: { source: { file: string; line: number; column: number }; id?: string; address: StructuralAddress },
  code: string,
  message: string,
  suggestion?: string,
): void {
  ctx.diagnostics.push({
    severity: 'error',
    code,
    file: node.source.file,
    line: node.source.line,
    column: node.source.column,
    ...(node.id === undefined || node.id === '' ? {} : { nodeId: node.id }),
    address: node.address.label,
    message,
    ...(suggestion === undefined ? {} : { suggestion }),
  })
}

/** Clone props, substituting direct template field references. */
function instantiateProps(ctx: ExpandContext, node: DesignElement, item: FixtureItem): DesignProps {
  const props: DesignProps = {}
  for (const [name, value] of Object.entries(node.props)) {
    if (isFixtureRef(value)) {
      errorAt(
        ctx,
        node,
        'fixture-nested',
        `Prop "${name}" uses a fixture binding inside an item template; nested fixture bindings are not supported.`,
      )
      continue
    }
    if (isItemRef(value)) {
      const resolved = item.fields[value.$item]
      if (resolved === undefined) {
        errorAt(
          ctx,
          node,
          'fixture-field-missing',
          `Item template refers to fixture field "${value.$item}", which this item does not declare.`,
        )
        continue
      }
      props[name] = resolved
      continue
    }
    if (containsReference(value)) {
      errorAt(
        ctx,
        node,
        'fixture-nested',
        `Prop "${name}" nests a fixture or item reference inside a literal; use a direct reference.`,
      )
      continue
    }
    props[name] = value
  }
  return props
}

/** Whether a literal structure still contains a fixture or template reference. */
function containsReference(value: DesignPropValue): boolean {
  if (isFixtureRef(value) || isItemRef(value)) return true
  if (Array.isArray(value)) return value.some(containsReference)
  if (value !== null && typeof value === 'object' && !isReference(value)) {
    return Object.values(value).some(containsReference)
  }
  return false
}

/** Scalar field converted to the string literal a text child needs. */
function itemText(ctx: ExpandContext, node: DesignElement, field: string, item: FixtureItem): string | undefined {
  const resolved = item.fields[field]
  if (resolved === undefined) {
    errorAt(
      ctx,
      node,
      'fixture-field-missing',
      `Item template text refers to fixture field "${field}", which this item does not declare.`,
    )
    return undefined
  }
  return String(resolved)
}

/** Derived id for one repeated template node. */
function derivedId(listId: string, key: string, identity: string): string {
  return listId + '-' + key + '-' + identity
}

/** Clone one template element for one fixture item, deriving stable ids. */
function instantiateNode(
  ctx: ExpandContext,
  template: DesignElement,
  item: FixtureItem,
  listId: string,
  rootIndex: number,
  roots: number,
  path: readonly number[],
): DesignElement {
  const identity =
    path.length === 0
      ? template.id !== undefined && template.id !== ''
        ? template.id
        : roots === 1
          ? 'item'
          : 'item-' + String(rootIndex)
      : template.id !== undefined && template.id !== ''
        ? template.id
        : 'item-' + String(rootIndex) + '-n-' + path.join('-')
  const children: DesignChild[] = []
  let elementIndex = 0
  for (const child of template.children) {
    if (child.kind === 'text') {
      if (child.itemField === undefined) {
        children.push(child)
        continue
      }
      const text = itemText(ctx, template, child.itemField, item)
      if (text !== undefined) children.push({ kind: 'text', value: text, source: child.source })
      continue
    }
    const instantiated = instantiateNode(ctx, child, item, listId, rootIndex, roots, [...path, elementIndex])
    elementIndex += 1
    children.push(instantiated)
  }
  ctx.expanded += 1
  return {
    ...template,
    id: derivedId(listId, item.id, identity),
    props: instantiateProps(ctx, template, item),
    children,
  }
}

/** Append expanded copies of the template's roots for every fixture item. */
function expandList(ctx: ExpandContext, node: DesignElement, fixtures: FixtureCollections): DesignChild[] {
  const binding = node.props.items
  if (!isFixtureRef(binding)) return [...node.children]
  if (node.id === undefined || !ID_PATTERN.test(node.id)) {
    errorAt(
      ctx,
      node,
      'fixture-list-id',
      '<List> with a fixture binding requires an explicit id matching [a-z][a-z0-9-]* so repeated rows get stable identities.',
    )
    return []
  }
  const templates = node.children.filter(
    (child): child is DesignElement => child.kind === 'element' && child.type === 'ItemTemplate',
  )
  if (templates.length === 0) {
    errorAt(
      ctx,
      node,
      'item-template-missing',
      '<List> with a fixture binding requires exactly one <ItemTemplate> child.',
    )
    return []
  }
  if (templates.length > 1) {
    errorAt(ctx, node, 'item-template-multiple', '<List> accepts exactly one <ItemTemplate> child.')
    return []
  }
  const others = node.children.filter((child) => child.kind === 'element' && child.type !== 'ItemTemplate')
  if (others.length > 0) {
    errorAt(
      ctx,
      node,
      'fixture-inline-conflict',
      '<List> cannot combine a fixture binding with inline element children; move them inside <ItemTemplate>.',
    )
  }
  const collection = fixtures[binding.$fixture]
  if (collection === undefined) {
    errorAt(
      ctx,
      node,
      'fixture-missing',
      `List binding refers to fixture "${binding.$fixture}", which does not exist in design/fixtures.`,
      'Create design/fixtures/' + binding.$fixture + '.json.',
    )
    return []
  }
  const template = templates[0] as DesignElement
  const roots = template.children.filter((child): child is DesignElement => child.kind === 'element')
  if (roots.length === 0) {
    errorAt(ctx, node, 'item-template-empty', '<ItemTemplate> must contain at least one element.')
    return []
  }
  const perItem = countNodes(template) + 1
  if (ctx.expanded + perItem * collection.items.length > MAX_EXPANDED_NODES) {
    errorAt(
      ctx,
      node,
      'fixture-expansion-limit',
      `Fixture "${collection.id}" would expand beyond ${String(MAX_EXPANDED_NODES)} nodes on this screen.`,
    )
    return []
  }
  const expanded: DesignChild[] = []
  for (const item of collection.items) {
    const children: DesignChild[] = []
    let rootIndex = 0
    for (const child of template.children) {
      if (child.kind === 'text') continue
      children.push(instantiateNode(ctx, child, item, node.id, rootIndex, roots.length, []))
      rootIndex += 1
    }
    // A template that is already one ListItem keeps exactly one semantic row;
    // other templates get one bare ListItem wrapper per key.
    if (roots.length === 1 && children.length === 1) {
      const only = children[0] as DesignElement
      if (only.type === 'ListItem') {
        ;(only as { id?: string }).id = node.id + '-' + item.id
        expanded.push(only)
        continue
      }
    }
    ctx.expanded += 1
    expanded.push({
      kind: 'element',
      type: 'ListItem',
      id: node.id + '-' + item.id,
      props: { bare: true },
      children,
      source: template.source,
      address: template.address,
    })
  }
  return expanded
}

/** Count element nodes in a subtree. */
function countNodes(node: DesignElement): number {
  let total = 1
  for (const child of node.children) if (child.kind === 'element') total += countNodes(child)
  return total
}

/** Resolve Table columns into label/field pairs. */
function tableColumns(ctx: ExpandContext, node: DesignElement): { label: string; field: string }[] | undefined {
  const columns = node.props.columns
  if (!Array.isArray(columns)) {
    errorAt(ctx, node, 'fixture-columns', '<Table> with a fixture binding requires an explicit columns array.')
    return undefined
  }
  const resolved: { label: string; field: string }[] = []
  for (const column of columns) {
    if (typeof column === 'string') {
      resolved.push({ label: column, field: column })
      continue
    }
    if (column !== null && typeof column === 'object' && !Array.isArray(column) && !isReference(column)) {
      const record = column as Record<string, DesignPropValue>
      const field = record.field
      if (typeof field !== 'string' || field === '') {
        errorAt(ctx, node, 'fixture-columns', 'A Table fixture column object requires a string "field".')
        return undefined
      }
      const label = typeof record.label === 'string' ? record.label : field
      resolved.push({ label, field })
      continue
    }
    errorAt(ctx, node, 'fixture-columns', 'Table fixture columns must be field names or { label, field } objects.')
    return undefined
  }
  if (resolved.length === 0) {
    errorAt(ctx, node, 'fixture-columns', '<Table> with a fixture binding requires at least one column.')
    return undefined
  }
  return resolved
}

/** Expand Table rows from a fixture collection. */
function expandTable(ctx: ExpandContext, node: DesignElement, fixtures: FixtureCollections): void {
  const binding = node.props.rows
  if (!isFixtureRef(binding)) return
  const collection = fixtures[binding.$fixture]
  if (collection === undefined) {
    errorAt(
      ctx,
      node,
      'fixture-missing',
      `Table binding refers to fixture "${binding.$fixture}", which does not exist in design/fixtures.`,
    )
    return
  }
  const columns = tableColumns(ctx, node)
  if (columns === undefined) return
  const rows: DesignPropValue[][] = []
  for (const item of collection.items) {
    const row: DesignPropValue[] = []
    for (const column of columns) {
      const value = item.fields[column.field]
      if (value === undefined) {
        errorAt(
          ctx,
          node,
          'fixture-field-missing',
          `Fixture "${collection.id}" item "${item.id}" does not declare column field "${column.field}".`,
        )
        row.push('')
        continue
      }
      row.push(String(value))
    }
    rows.push(row)
  }
  const mutable = node as MutableElement
  mutable.props.columns = columns.map((column) => column.label)
  mutable.props.rows = rows
}

/** Expand select options from a fixture collection. */
function expandOptions(ctx: ExpandContext, node: DesignElement, fixtures: FixtureCollections): void {
  const binding = node.props.options
  if (!isFixtureRef(binding)) return
  const collection = fixtures[binding.$fixture]
  if (collection === undefined) {
    errorAt(
      ctx,
      node,
      'fixture-missing',
      `Select binding refers to fixture "${binding.$fixture}", which does not exist in design/fixtures.`,
    )
    return
  }
  const options: DesignPropValue[] = []
  for (const item of collection.items) {
    const label = item.fields.label
    if (label === undefined) {
      errorAt(
        ctx,
        node,
        'fixture-field-missing',
        `Fixture "${collection.id}" item "${item.id}" needs a "label" field for select options.`,
      )
      continue
    }
    options.push({ value: item.id, label: String(label) })
  }
  ;(node as MutableElement).props.options = options
}

/** Walk and normalize one element, returning its replacement children. */
function walk(ctx: ExpandContext, node: DesignElement, fixtures: FixtureCollections): DesignElement {
  const props: DesignProps = {}
  for (const [name, value] of Object.entries(node.props)) {
    if (isFixtureRef(value)) {
      const bound =
        (node.type === 'List' && name === 'items') ||
        (node.type === 'Table' && name === 'rows') ||
        ((node.type === 'Select' || node.type === 'MultiSelect' || node.type === 'Combobox') && name === 'options')
      if (!bound) {
        errorAt(
          ctx,
          node,
          'fixture-unsupported',
          `Prop "${name}" on <${node.type}> cannot bind fixture "${value.$fixture}".`,
          'Fixture bindings are supported on List items, Table rows, and Select/MultiSelect/Combobox options.',
        )
        continue
      }
      props[name] = value
      continue
    }
    if (isItemRef(value)) {
      errorAt(
        ctx,
        node,
        'item-outside-template',
        `Prop "${name}" uses item("${value.$item}") outside an <ItemTemplate>.`,
      )
      continue
    }
    if (containsReference(value)) {
      errorAt(
        ctx,
        node,
        'fixture-nested',
        `Prop "${name}" nests a fixture or item reference inside a literal; use a direct reference.`,
      )
      continue
    }
    props[name] = value
  }
  const mutable = node as MutableElement
  mutable.props = props

  // Collection bindings replace children/props before recursing.
  if (node.type === 'List' && isFixtureRef(node.props.items)) {
    const children = expandList(ctx, node, fixtures)
    delete (mutable.props as Record<string, DesignPropValue>).items
    return { ...mutable, props: mutable.props, children }
  }
  expandTable(ctx, node, fixtures)
  expandOptions(ctx, node, fixtures)

  const children: DesignChild[] = []
  for (const child of node.children) {
    if (child.kind === 'text') {
      if (child.itemField !== undefined) {
        errorAt(
          ctx,
          node,
          'item-outside-template',
          `Text item("${child.itemField}") is only valid inside an <ItemTemplate>.`,
        )
        continue
      }
      children.push(child)
      continue
    }
    if (child.type === 'ItemTemplate') {
      errorAt(
        ctx,
        child,
        'item-template-outside-list',
        '<ItemTemplate> is only valid as a direct child of a fixture-bound <List>.',
      )
      continue
    }
    children.push(walk(ctx, child, fixtures))
  }
  return { ...node, props: node.props, children }
}

/** Recompute structural addresses after children changed. */
function reindex(node: DesignScreenNode | DesignElement, path: readonly number[]): void {
  const next = { ...node, address: { path, label: formatAddress(path) } } as DesignScreenNode | DesignElement
  const mutable = next as unknown as { children?: DesignChild[] }
  if (mutable.children !== undefined) {
    const children: DesignChild[] = []
    let index = 0
    for (const child of mutable.children) {
      if (child.kind === 'text') {
        children.push(child)
        continue
      }
      reindex(child, [...path, index])
      index += 1
      children.push(child)
    }
  }
  // The caller replaces the node in place by returning the new object.
  Object.assign(node, next)
}

/** Outcome of expanding one screen. */
export interface ExpandedScreen {
  readonly root: DesignScreenNode
  readonly diagnostics: readonly Diagnostic[]
}

/**
 * Expand fixture bindings in one parsed screen tree.
 * @param root - parsed screen root.
 * @param fixtures - validated collections.
 * @param file - project-relative screen file.
 */
export function expandScreen(root: DesignScreenNode, fixtures: FixtureCollections, file: string): ExpandedScreen {
  const ctx: ExpandContext = { fixtures, file, diagnostics: [], expanded: 0 }
  const clone: DesignScreenNode = structuredClone(root)
  const expanded = walk(ctx, clone, fixtures) as DesignScreenNode
  const mutable = expanded as unknown as { id: string; type: 'Screen' }
  mutable.id = clone.id
  mutable.type = 'Screen'
  reindex(expanded, [])
  return { root: expanded, diagnostics: ctx.diagnostics }
}

/** Find a fixture collection by id, for tools and checks. */
export function fixtureOf(fixtures: FixtureCollections, id: string): FixtureCollection | undefined {
  return fixtures[id]
}
