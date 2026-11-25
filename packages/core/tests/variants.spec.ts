import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { loadProject } from '../src/project.ts'
import { parseScreen } from '../src/parse.ts'
import { scaffoldProject } from '../src/scaffold.ts'
import {
  canonicalVariantIdentity,
  collectVariantGroups,
  enumerateVariantSelections,
  resolveVariantDocument,
} from '../src/variants.ts'

const kitVersion = '1.0.0'

const subtree = `<Screen id="home" title="Home">
  <Header title="Acme" />
  <Variants id="layout" chosen="compact">
    <Variant branch="compact">
      <Stack gap="spacing.sm"><Text>Compact</Text><Button id="action">Go</Button></Stack>
    </Variant>
    <Variant branch="spacious">
      <Stack gap="spacing.lg"><Text>Spacious</Text><Button id="action">Continue</Button></Stack>
    </Variant>
  </Variants>
</Screen>`

const whole = `<Variants id="layout" chosen="compact">
  <Variant branch="compact"><Screen id="home" title="Home"><Text>Compact</Text></Screen></Variant>
  <Variant branch="spacious"><Screen id="home" title="Home"><Text>Spacious</Text></Screen></Variant>
</Variants>`

const nested = `<Screen id="home" title="Home">
  <Variants id="layout" chosen="compact">
    <Variant branch="compact"><Text>Compact</Text></Variant>
    <Variant branch="spacious">
      <Stack gap="spacing.sm">
        <Variants id="sidebar" chosen="open">
          <Variant branch="open"><Text>Open</Text></Variant>
          <Variant branch="closed"><Text>Closed</Text></Variant>
        </Variants>
      </Stack>
    </Variant>
  </Variants>
</Screen>`

function parsed(source: string) {
  const result = parseScreen(source, 'screens/home.dsx')
  if (result.document === undefined) throw new Error('no document: ' + JSON.stringify(result.diagnostics))
  return result
}

function resolve(source: string, selection: Record<string, string> = {}) {
  return resolveVariantDocument(parsed(source).document!, selection)
}

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-variants-'))
  await scaffoldProject(root, { kitVersion })
  return join(root, 'design')
}

async function load(folder: string, previous?: Awaited<ReturnType<typeof loadProject>>) {
  return loadProject({
    folder,
    kit: kitMetadata,
    installedKitVersion: kitVersion,
    ...(previous === undefined ? {} : { previous }),
  })
}

describe('variant discovery and resolution', () => {
  it('parses subtree and whole-screen groups with preserved source locations', () => {
    const subtreeResult = parsed(subtree)
    const groups = collectVariantGroups(subtreeResult.document!)
    expect(groups.diagnostics).toEqual([])
    expect(groups.groups).toHaveLength(1)
    expect(groups.groups[0]?.id).toBe('layout')
    expect(groups.groups[0]?.chosen).toBe('compact')
    expect(groups.groups[0]?.branches.map((branch) => branch.id)).toEqual(['compact', 'spacious'])
    expect(groups.groups[0]?.source.line).toBe(3)
    expect(groups.groups[0]?.branches[1]?.source.line).toBe(7)

    const wholeResult = parsed(whole)
    expect(wholeResult.root).toBeUndefined()
    const wholeGroups = collectVariantGroups(wholeResult.document!)
    expect(wholeGroups.diagnostics).toEqual([])
    expect(wholeGroups.groups[0]?.wholeScreen).toBe(true)
    const projection = resolveVariantDocument(wholeResult.document!, {})
    expect(projection.screen?.id).toBe('home')
    expect(projection.screen?.type).toBe('Screen')
  })

  it('removes wrappers from the resolved tree and reindexes addresses', () => {
    const projection = resolve(subtree)
    expect(projection.valid).toBe(true)
    const text = JSON.stringify(projection.screen)
    expect(text).not.toContain('"Variants"')
    expect(text).not.toContain('"Variant"')
    expect(text).toContain('Compact')
    expect(projection.screen?.children[0]?.kind).toBe('element')
  })

  it('resolves an explicit branch without touching the chosen source', () => {
    const chosen = resolve(subtree)
    const alternate = resolve(subtree, { layout: 'spacious' })
    expect(JSON.stringify(chosen.screen)).toContain('Compact')
    expect(JSON.stringify(alternate.screen)).toContain('Spacious')
    expect(alternate.selection).toEqual({ layout: 'spacious' })
    expect(chosen.selection).toEqual({ layout: 'compact' })
  })

  it('chooses required ancestors for a nested selection and rejects contradictions', () => {
    const auto = resolve(nested, { 'layout/sidebar': 'closed' })
    expect(auto.valid).toBe(true)
    expect(auto.selection).toEqual({ layout: 'spacious', 'layout/sidebar': 'closed' })
    expect(JSON.stringify(auto.screen)).toContain('Closed')
    const contradiction = resolve(nested, { layout: 'compact', 'layout/sidebar': 'closed' })
    expect(contradiction.valid).toBe(false)
    expect(contradiction.screen).toBeUndefined()
    expect(contradiction.diagnostics.map((diagnostic) => diagnostic.code)).toContain('variant-selection-unreachable')
  })

  it('rejects unknown groups and branches with actionable diagnostics', () => {
    const unknownGroup = resolve(subtree, { missing: 'compact' })
    expect(unknownGroup.screen).toBeUndefined()
    expect(unknownGroup.diagnostics[0]?.code).toBe('variant-selection-unknown')
    const unknownBranch = resolve(subtree, { layout: 'tiny' })
    expect(unknownBranch.screen).toBeUndefined()
    expect(unknownBranch.diagnostics[0]?.code).toBe('variant-selection-branch')
    expect(unknownBranch.diagnostics[0]?.suggestion).toContain('compact')
  })

  it('builds a bounded canonical identity from the effective selection', () => {
    expect(canonicalVariantIdentity({})).toBeUndefined()
    expect(canonicalVariantIdentity({ b: 'two', a: 'one' })).toBe('a:one|b:two')
    const long: Record<string, string> = {}
    for (let index = 0; index < 20; index += 1) {
      long['group-' + String(index)] = 'branch-' + String(index)
    }
    const identity = canonicalVariantIdentity(long)!
    expect(identity.length).toBeLessThanOrEqual(120)
    expect(identity).toContain('group-0:branch-0')
    expect(identity).toMatch(/#[0-9a-f]{8}$/)
    expect(canonicalVariantIdentity({ a: 'one' })).not.toBe(canonicalVariantIdentity({ a: 'two' }))
  })

  it('enumerates reachable projections and bounds them', () => {
    const result = enumerateVariantSelections(parsed(nested).document!, 10)
    expect(result.selections.map((selection) => JSON.stringify(selection))).toEqual(
      expect.arrayContaining([
        JSON.stringify({ layout: 'compact' }),
        JSON.stringify({ layout: 'spacious', 'layout/sidebar': 'open' }),
        JSON.stringify({ layout: 'spacious', 'layout/sidebar': 'closed' }),
      ]),
    )
    expect(result.truncated).toBe(false)
  })

  it('reports malformed and empty groups with source locations', () => {
    const empty = resolve('<Screen id="home"><Variants id="layout" chosen="a"></Variants></Screen>')
    expect(empty.diagnostics.map((diagnostic) => diagnostic.code)).toContain('variant-branch-min')
    const missingChosen = resolve(
      '<Screen id="home"><Variants id="layout"><Variant branch="a"><Text>A</Text></Variant><Variant branch="b"><Text>B</Text></Variant></Variants></Screen>',
    )
    expect(missingChosen.diagnostics.map((diagnostic) => diagnostic.code)).toContain('variant-chosen-missing')
    const duplicateGroup = resolve(
      '<Screen id="home"><Variants id="layout" chosen="a"><Variant branch="a"><Text>A</Text></Variant><Variant branch="b"><Text>B</Text></Variant></Variants><Variants id="layout" chosen="a"><Variant branch="a"><Text>C</Text></Variant><Variant branch="b"><Text>D</Text></Variant></Variants></Screen>',
    )
    expect(duplicateGroup.diagnostics.map((diagnostic) => diagnostic.code)).toContain('variant-duplicate-group')
    const duplicateBranch = resolve(
      '<Screen id="home"><Variants id="layout" chosen="a"><Variant branch="a"><Text>A</Text></Variant><Variant branch="a"><Text>B</Text></Variant></Variants></Screen>',
    )
    expect(duplicateBranch.diagnostics.map((diagnostic) => diagnostic.code)).toContain('variant-branch-duplicate')
    expect(duplicateBranch.diagnostics[0]?.line).toBeGreaterThan(0)
  })

  it('validates whole-screen branch identity and shape', () => {
    const mismatch = resolve(`<Variants id="layout" chosen="a">
      <Variant branch="a"><Screen id="home"><Text>A</Text></Screen></Variant>
      <Variant branch="b"><Screen id="other"><Text>B</Text></Screen></Variant>
    </Variants>`)
    expect(mismatch.diagnostics.map((diagnostic) => diagnostic.code)).toContain('variant-screen-identity')
    const missing = resolve(`<Variants id="layout" chosen="a">
      <Variant branch="a"><Stack><Text>A</Text></Stack></Variant>
      <Variant branch="b"><Screen id="home"><Text>B</Text></Screen></Variant>
    </Variants>`)
    expect(missing.diagnostics.map((diagnostic) => diagnostic.code)).toContain('variant-screen-missing')
  })
})

describe('project-level variant validation', () => {
  it('publishes the chosen projection and validates alternate branches', async () => {
    const folder = await tempProject()
    await writeFile(join(folder, 'screens', 'home.dsx'), subtree)
    const project = await load(folder)
    const screen = project.screens[0]!
    expect(screen.id).toBe('home')
    expect(screen.blockingErrors).toBe(0)
    expect(screen.variants?.[0]?.branches.every((branch) => branch.valid)).toBe(true)
    expect(JSON.stringify(screen.root)).toContain('Compact')
    expect(screen.variantDocument).toBeDefined()
  })

  it('identifies an invalid unchosen branch without blocking the chosen render', async () => {
    const folder = await tempProject()
    await writeFile(
      join(folder, 'screens', 'home.dsx'),
      `<Screen id="home"><Variants id="layout" chosen="ok">
        <Variant branch="ok"><Text>Fine</Text></Variant>
        <Variant branch="broken"><Button id="bad" onPress={open("missing")}>Bad</Button></Variant>
      </Variants></Screen>`,
    )
    const project = await load(folder)
    const screen = project.screens[0]!
    expect(screen.blockingErrors).toBe(0)
    expect(JSON.stringify(screen.root)).toContain('Fine')
    const broken = screen.variants?.[0]?.branches.find((branch) => branch.id === 'broken')
    expect(broken?.valid).toBe(false)
    const diagnostic = screen.diagnostics.find(
      (entry) => entry.branch === 'broken' && entry.code === 'interaction-target-missing',
    )
    expect(diagnostic).toBeDefined()
    expect(diagnostic?.message).toContain('broken')
  })

  it('allows shared stable ids in exclusive branches and rejects duplicates in a combination', async () => {
    const folder = await tempProject()
    await writeFile(
      join(folder, 'screens', 'home.dsx'),
      `<Screen id="home">
        <Variants id="one" chosen="a">
          <Variant branch="a"><Text>A</Text></Variant>
          <Variant branch="b"><Button id="shared">One</Button></Variant>
        </Variants>
        <Variants id="two" chosen="a">
          <Variant branch="a"><Text>C</Text></Variant>
          <Variant branch="b"><Button id="shared">Two</Button></Variant>
        </Variants>
      </Screen>`,
    )
    const project = await load(folder)
    const screen = project.screens[0]!
    expect(screen.blockingErrors).toBe(0)
    const duplicate = screen.diagnostics.find((entry) => entry.code === 'duplicate-id')
    expect(duplicate).toBeDefined()
    expect(duplicate?.message).toContain('Variant combination')
    expect(screen.variants?.every((group) => group.branches.every((branch) => branch.valid))).toBe(true)
  })

  it('expands fixtures inside an alternate branch during validation', async () => {
    const folder = await tempProject()
    await mkdir(join(folder, 'fixtures'), { recursive: true })
    await writeFile(
      join(folder, 'fixtures', 'items.json'),
      JSON.stringify([
        { id: 'one', name: 'One' },
        { id: 'two', name: 'Two' },
      ]),
    )
    await writeFile(
      join(folder, 'screens', 'home.dsx'),
      `<Screen id="home"><Variants id="layout" chosen="simple">
        <Variant branch="simple"><Text>Simple</Text></Variant>
        <Variant branch="list"><List id="rows" items={fixture("items")}><ItemTemplate><ListItem><Text>{item("name")}</Text></ListItem></ItemTemplate></List></Variant>
      </Variants></Screen>`,
    )
    const project = await load(folder)
    const screen = project.screens[0]!
    const list = screen.variants?.[0]?.branches.find((branch) => branch.id === 'list')
    expect(list?.valid).toBe(true)
    expect(screen.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([])
  })

  it('validates a nested branch exposed only by an unchosen ancestor', async () => {
    const folder = await tempProject()
    await writeFile(
      join(folder, 'screens', 'home.dsx'),
      `<Screen id="home">
        <Variants id="layout" chosen="compact">
          <Variant branch="compact"><Text>Compact</Text></Variant>
          <Variant branch="spacious">
            <Stack>
              <Variants id="sidebar" chosen="open">
                <Variant branch="open"><Text>Open</Text></Variant>
                <Variant branch="closed"><Text>Closed</Text></Variant>
              </Variants>
            </Stack>
          </Variant>
        </Variants>
      </Screen>`,
    )
    const project = await load(folder)
    const screen = project.screens[0]!
    const layout = screen.variants?.find((group) => group.path === 'layout')
    const sidebar = screen.variants?.find((group) => group.path === 'layout/sidebar')
    expect(layout?.branches.every((branch) => branch.valid)).toBe(true)
    expect(sidebar?.branches.every((branch) => branch.valid)).toBe(true)
    const projection = resolveVariantDocument(screen.variantDocument!, { 'layout/sidebar': 'closed' })
    expect(projection.screen).toBeDefined()
    expect(JSON.stringify(projection.screen)).toContain('Closed')
  })

  it('validates disjoint nested groups independently of the chosen sibling', async () => {
    const folder = await tempProject()
    await writeFile(
      join(folder, 'screens', 'home.dsx'),
      `<Screen id="home">
  <Variants id="layout" chosen="one">
    <Variant branch="one"><Stack><Variants id="left" chosen="a"><Variant branch="a"><Text>Left A</Text></Variant><Variant branch="b"><Text>Left B</Text></Variant></Variants></Stack></Variant>
    <Variant branch="two"><Stack><Variants id="right" chosen="a"><Variant branch="a"><Text>Right A</Text></Variant><Variant branch="b"><Text>Right B</Text></Variant></Variants></Stack></Variant>
  </Variants>
</Screen>`,
    )
    const project = await load(folder)
    const screen = project.screens[0]!
    expect(screen.blockingErrors).toBe(0)
    expect(screen.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
    for (const group of screen.variants ?? []) {
      expect(group.branches.every((branch) => branch.valid)).toBe(true)
    }
    expect(screen.variantSnapshots?.['layout/right|a']).toBeDefined()
    expect(screen.variantSnapshots?.['layout/right|b']).toBeDefined()
    const direct = resolveVariantDocument(screen.variantDocument!, { 'layout/right': 'b' })
    expect(direct.screen).toBeDefined()
    expect(JSON.stringify(direct.screen)).toContain('Right B')
  })

  it('keeps whole-screen branch-local states with each alternative', async () => {
    const folder = await tempProject()
    await writeFile(
      join(folder, 'screens', 'home.dsx'),
      `<Variants id="layout" chosen="compact">
  <Variant branch="compact"><Screen id="home" title="Home" states={{ "compact-open": { open: ["compact-drawer"] } }}><Stack><Text>Compact screen</Text><Drawer id="compact-drawer" title="Compact"><Text>Compact drawer</Text></Drawer></Stack></Screen></Variant>
  <Variant branch="spacious"><Screen id="home" title="Home" states={{ "exclusive": { open: ["spacious-drawer"] } }}><Stack><Text>Spacious screen</Text><Drawer id="spacious-drawer" title="Spacious"><Text>Spacious drawer</Text></Drawer></Stack></Screen></Variant>
</Variants>`,
    )
    const project = await load(folder)
    const screen = project.screens[0]!
    expect(screen.blockingErrors).toBe(0)
    expect(screen.states.map((state) => state.name)).toEqual(['compact-open'])
    const spacious = screen.variants?.[0]?.branches.find((branch) => branch.id === 'spacious')
    expect(spacious?.valid).toBe(true)
    expect(spacious?.states?.map((state) => state.name)).toEqual(['exclusive'])
    const projection = resolveVariantDocument(screen.variantDocument!, { layout: 'spacious' })
    expect(projection.screen).toBeDefined()
    expect(JSON.stringify(projection.screen)).toContain('Spacious drawer')
  })

  it('keeps a coherent expanded snapshot when a later alternate edit and fixtures are invalid', async () => {
    const folder = await tempProject()
    await mkdir(join(folder, 'fixtures'), { recursive: true })
    await writeFile(join(folder, 'fixtures', 'items.json'), JSON.stringify([{ id: 'one', name: 'Old item' }]))
    await writeFile(
      join(folder, 'screens', 'home.dsx'),
      `<Screen id="home"><Variants id="layout" chosen="compact">
        <Variant branch="compact"><Text>Compact</Text></Variant>
        <Variant branch="spacious"><List id="rows" items={fixture("items")}><ItemTemplate><ListItem><Text>{item("name")}</Text></ListItem></ItemTemplate></List></Variant>
      </Variants></Screen>`,
    )
    const first = await load(folder)
    const firstScreen = first.screens[0]!
    expect(firstScreen.variants?.[0]?.branches.find((branch) => branch.id === 'spacious')?.valid).toBe(true)
    expect(firstScreen.variantSnapshots?.['layout|spacious']).toBeDefined()

    // Change fixtures and make only the alternate branch invalid.
    await writeFile(join(folder, 'fixtures', 'items.json'), JSON.stringify([{ id: 'one', name: 'New item' }]))
    await writeFile(
      join(folder, 'screens', 'home.dsx'),
      `<Screen id="home"><Variants id="layout" chosen="compact">
        <Variant branch="compact"><Text>Compact</Text></Variant>
        <Variant branch="spacious"><Stack><Button id="broken" onPress={open("missing")}>Broken</Button></Stack></Variant>
      </Variants></Screen>`,
    )
    const second = await load(folder, first)
    const screen = second.screens[0]!
    const spacious = screen.variants?.[0]?.branches.find((branch) => branch.id === 'spacious')
    expect(spacious?.valid).toBe(false)
    expect(spacious?.stale).toBe(true)
    expect(screen.variantStale).toBe(true)
    const snapshot = screen.variantSnapshots?.['layout|spacious']
    expect(snapshot).toBeDefined()
    expect(JSON.stringify(snapshot?.root)).toContain('Old item')
    expect(JSON.stringify(snapshot?.root)).not.toContain('New item')
    expect(snapshot?.fixtures.items?.items?.[0]?.fields.name).toBe('Old item')
  })

  it('keeps the last valid variant set after a structural edit fails', async () => {
    const folder = await tempProject()
    await writeFile(join(folder, 'screens', 'home.dsx'), subtree)
    const first = await load(folder)
    await writeFile(
      join(folder, 'screens', 'home.dsx'),
      '<Screen id="home"><Variants id="layout" chosen="missing"></Variants></Screen>',
    )
    const broken = await load(folder, first)
    const screen = broken.screens[0]!
    expect(screen.id).toBe('home')
    expect(screen.lastValidRoot).toBeDefined()
    expect(screen.variantDocument).toBeDefined()
    expect(JSON.stringify(screen.variantDocument)).toContain('spacious')
    const projection = resolveVariantDocument(screen.variantDocument!, { layout: 'spacious' })
    expect(projection.screen).toBeDefined()
    expect(projection.screen?.id).toBe('home')
  })

  it('ignores the discard folder for discovery and extends the scaffold ignore rule', async () => {
    const folder = await tempProject()
    await mkdir(join(folder, '.discarded'), { recursive: true })
    await writeFile(join(folder, '.discarded', 'rejected.dsx'), '<Screen id="discarded"><Buton /></Screen>')
    const project = await load(folder)
    expect(project.screens.map((screen) => screen.id)).toEqual(['home'])
    expect(project.diagnostics.some((diagnostic) => diagnostic.message.includes('discarded'))).toBe(false)
    const ignore = await readFile(join(folder, '.gitignore'), 'utf8')
    expect(ignore).toContain('.cache/')
    expect(ignore).toContain('.discarded/')
  })
})

describe('source promotion and discard cleanup', () => {
  it('promotes by ordinary text edit, preserves unrelated source, and cleans only discard records', async () => {
    const folder = await tempProject()
    const source =
      '<Screen id="home" title="Home">\n  <Header title="Acme" />\n  <Variants id="layout" chosen="compact">\n    <Variant branch="compact"><Stack gap="spacing.sm"><Text>Compact</Text><Button id="action">Go</Button></Stack></Variant>\n    <Variant branch="spacious"><Stack gap="spacing.lg"><Text>Spacious</Text><Button id="action">Continue</Button></Stack></Variant>\n  </Variants>\n</Screen>\n'
    await writeFile(join(folder, 'screens', 'home.dsx'), source)
    const before = await load(folder)
    expect(before.screens[0]?.variants).toHaveLength(1)

    // Documented promotion workflow: record rejected source first, then replace
    // the exact group with the winning children using ordinary text edits.
    await mkdir(join(folder, '.discarded'), { recursive: true })
    const rejected = source.slice(
      source.indexOf('    <Variant branch="compact">'),
      source.indexOf('    <Variant branch="spacious">'),
    )
    await writeFile(
      join(folder, '.discarded', 'layout-compact.dsx'),
      '// origin=screens/home.dsx screen=home group=layout branch=compact discarded=2026-11-25T00:00:00Z\n' + rejected,
    )
    const winning = '      <Stack gap="spacing.lg"><Text>Spacious</Text><Button id="action">Continue</Button></Stack>\n'
    const promoted = source.replace(/ {2}<Variants[\s\S]*? {2}<\/Variants>\n/, winning)
    await writeFile(join(folder, 'screens', 'home.dsx'), promoted)

    const after = await load(folder, before)
    const screen = after.screens[0]!
    expect(screen.variants ?? []).toHaveLength(0)
    expect(screen.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
    expect(JSON.stringify(screen.root)).toContain('Spacious')
    expect(JSON.stringify(screen.root)).toContain('Acme')
    expect(JSON.stringify(screen.root)).not.toContain('Variants')
    expect(after.screens.map((candidate) => candidate.id)).toEqual(['home'])

    // Explicit cleanup is confined to the canonical discard folder and leaves
    // every live design source untouched.
    const liveBefore = await readFile(join(folder, 'screens', 'home.dsx'), 'utf8')
    await rm(join(folder, '.discarded'), { recursive: true, force: true })
    const cleaned = await load(folder, after)
    expect(await readFile(join(folder, 'screens', 'home.dsx'), 'utf8')).toBe(liveBefore)
    expect(JSON.stringify(cleaned.screens[0]?.root)).toContain('Spacious')
    expect(cleaned.screens.map((candidate) => candidate.id)).toEqual(['home'])
  })
})
