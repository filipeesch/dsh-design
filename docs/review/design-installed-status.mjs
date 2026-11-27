/** Task 4.1 assertions for the installed bundle, using the shared native dispatcher. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const pinnedKit = '^1.0.0'
const installedKit = '1.0.0'
const layoutFile = 'layouts/dispatch-shell.dsx'
const status = (id) => [id, 'design_status', {}]

export async function runStatusContract(scope, evidence, root, cwd, stableTools, dispatch) {
  const provenance = await json(join(root, 'provenance.json'))
  const { original, replacement, statusMode } = provenance
  assert.equal(provenance.bundleSha256, evidence.tarballSha256)
  assert.equal(statusMode, process.env.DESIGN_EVAL_STATUS)
  assert.equal(original.host.id, original.tools.id)
  const home = await realpath(scope.profileContext.home)
  const pkg = join(home, 'profiles', scope.profileContext.name, 'node_modules/@filipeesch/dsh-design-bundle')
  const diskBefore = await diskBuild(pkg)
  assert.deepEqual(diskBefore, {
    version: original.version,
    host: original.host.sha256,
    tools: (statusMode === 'mixed' ? replacement : original).tools.sha256,
  })
  evidence.statusContract = { mode: statusMode, diskBefore }
  await prepareProject(cwd)
  const { workspace } = await scope.workspaceController.create({ path: cwd })
  for (const preset of ['standard', 'design']) {
    const sessionId = 'status-contract-' + preset
    const created = await scope.sessionController.create({
      sessionId,
      workspaceId: workspace.workspaceId,
      agentPreset: preset,
    })
    assert.equal(created.agentPreset, preset)
    const agent = scope.agents.get(sessionId)
    assert.ok(agent)
    const schemas = scope.tools.schemas(agent).filter(({ name }) => name.startsWith('design_'))
    assert.deepEqual(schemas.map(({ name }) => name).sort(), preset === 'design' ? [...stableTools].sort() : [])
    const rows = []
    evidence.sessions[preset] = { sessionId, schemas, calls: rows }
    const call = async (calls) => {
      const start = rows.length
      await dispatch(scope, agent, rows, calls)
      return Object.fromEntries(rows.slice(start).map(({ id, result }) => [id, result]))
    }
    const before = (await call([status('status-before')]))['status-before']
    if (preset === 'standard') {
      nativeError(before, /unknown tool "design_status"/i)
      continue
    }
    const expectedTools = statusMode === 'mixed' ? replacement.tools : undefined
    assertStatus(before, original.host, expectedTools, scope.profileContext.name)
    if (statusMode === 'mixed') continue

    // The first call above has already exercised both modules in this Design session.
    // Replace the *entire* installed package in this private profile, not only the manifest.
    const staged = await realpath(join(root, 'replacement'))
    assert.equal(relative(await realpath(root), staged), 'replacement')
    assert.equal(await realpath(pkg), pkg)
    await rename(pkg, join(root, 'original-loaded-package'))
    await rename(staged, pkg)
    const diskAfter = await diskBuild(pkg)
    assert.deepEqual(diskAfter, {
      version: replacement.version,
      host: replacement.host.sha256,
      tools: replacement.tools.sha256,
    })
    evidence.statusContract.diskAfter = diskAfter
    const after = (await call([status('status-after-replacement')]))['status-after-replacement']
    assertStatus(after, original.host, undefined, scope.profileContext.name)
    assert.deepEqual(after.value, before.value)
    assert.equal(ordinary(after), ordinary(before))
    assert.ok(!ordinary(after).includes(replacement.host.id) && !ordinary(after).includes(replacement.version))

    const validations = [
      ['validate-missing-screen', { screen: 'no-such-screen' }, /unknown screen "no-such-screen"/i],
      [
        'validate-conflicting-inference',
        { file: layoutFile, screen: 'dispatch-shell' },
        /provide only file, only screen/i,
      ],
      ['validate-project-with-target', { scope: 'project', file: layoutFile }, /provide only file, only screen/i],
      ['validate-file-without-target', { scope: 'file' }, /provide only file, only screen/i],
      [
        'validate-nonexistent-file',
        { file: 'screens/no-such-file.dsx' },
        /unknown source file.*no-such-file.*relative/i,
      ],
      ['validate-outside-file', { file: '../outside.dsx' }, /unknown source file.*\.\.\/outside\.dsx.*relative/i],
    ]
    const nativeInputs = [
      [
        'validate-invalid-enum',
        'design_validate',
        { scope: 'workspace' },
        /scope.*(?:project.*file.*screen|allowed values)/i,
      ],
      ['query-variant-without-screen', 'design_query', { variant: 'layout:alternate' }, /variant requires screen/i],
      ['query-breakpoint', 'design_query', { breakpoint: 'mobile' }, /(?:unknown|unexpected|additional).*breakpoint/i],
      ['query-state', 'design_query', { state: 'prices-open' }, /(?:unknown|unexpected|additional).*state/i],
      ['query-theme', 'design_query', { theme: 'dispatch-dark' }, /(?:unknown|unexpected|additional).*theme/i],
      [
        'query-unknown-branch',
        'design_query',
        { screen: 'dispatch-variants', variant: 'layout:no-such-branch' },
        /does not declare branch "no-such-branch"/i,
      ],
      [
        'query-malformed-variant',
        'design_query',
        { screen: 'checkout', variant: 'alternate' },
        /variant must be "group:branch"/i,
      ],
      ['query-unknown-screen', 'design_query', { screen: 'no-such-screen' }, /unknown screen "no-such-screen"/i],
      ['query-prop-without-value', 'design_query', { prop: 'id' }, /"prop" and "value" must be provided together/i],
      [
        'query-nonscalar-value',
        'design_query',
        { prop: 'id', value: [] },
        /(?:value.*(?:oneOf|string|number|boolean)|match exactly one schema)/i,
      ],
    ]
    const cases = await call([
      ...validations.map(([id, args]) => [id, 'design_validate', args]),
      ...nativeInputs.map(([id, tool, args]) => [id, tool, args]),
      ['validate-layout-file', 'design_validate', { file: layoutFile }],
      ['validate-layout-consumer', 'design_validate', { screen: 'dispatch-shell' }],
      ['validate-unrelated-screen', 'design_validate', { screen: 'checkout' }],
      ['validate-project', 'design_validate', {}],
      ['query-valid', 'design_query', { screen: 'checkout', prop: 'id', value: 'place-order' }],
      [
        'query-valid-branch',
        'design_query',
        { screen: 'dispatch-variants', variant: 'layout:alternate', component: 'Text', id: 'dispatch-*' },
      ],
      status('status-after-inputs'),
    ])
    for (const [id, , pattern] of validations) {
      const result = cases[id]
      const value = canonical(result)
      assert.equal(value.errorCode, 'invalid-selection', id)
      assert.deepEqual(value.diagnostics, [], id)
      assert.match(value.error, pattern, id)
      assert.match(ordinary(result), /^invalid-selection:/, id)
      assert.match(ordinary(result), pattern, id)
    }
    for (const [id, , , pattern] of nativeInputs) nativeError(cases[id], pattern)
    for (const [id, expectedScope] of [
      ['validate-layout-file', 'file'],
      ['validate-layout-consumer', 'screen'],
      ['validate-project', 'project'],
    ]) {
      const value = canonical(cases[id])
      assert.equal(value.scope, expectedScope)
      assert.equal(value.errorCode, undefined)
      const diagnostic = value.diagnostics.find(({ code }) => code === 'fixture-missing')
      assert.equal(diagnostic?.severity, 'error')
      assert.equal(diagnostic.file, layoutFile)
      assert.equal(diagnostic.line, 3)
      assert.equal(diagnostic.column, 5)
      assert.match(ordinary(cases[id]), /^error layouts\/dispatch-shell\.dsx:3:5 .*dispatch-missing/m)
    }
    const unrelated = cases['validate-unrelated-screen']
    assert.ok(canonical(unrelated).diagnostics.every(({ file }) => file !== layoutFile))
    assert.ok(!ordinary(unrelated).includes(layoutFile))
    const query = cases['query-valid']
    const result = canonical(query)
    assert.equal(result.screen, 'checkout')
    assert.equal(result.total, 1)
    assert.equal(result.matches[0].node, 'place-order')
    assert.match(ordinary(query), /screen="checkout".*variant=\(chosen\)/)
    assert.match(ordinary(query), /checkout place-order <Button> screens\/checkout\.dsx:\d+:\d+/)
    const alternate = cases['query-valid-branch']
    assert.equal(canonical(alternate).variant.branch, 'alternate')
    assert.equal(alternate.value.variant.chosen, false)
    assert.deepEqual(alternate.value.variant.selection, { layout: 'alternate' })
    assert.deepEqual(
      alternate.value.matches.map(({ node }) => node),
      ['dispatch-alternate'],
    )
    assert.match(ordinary(alternate), /screen="dispatch-variants".*variant="layout:alternate"/)
    assertStatus(cases['status-after-inputs'], original.host, undefined, scope.profileContext.name)
    assert.deepEqual(cases['status-after-inputs'].value.browser, before.value.browser)
  }
}

function canonical(result) {
  assert.equal(result?.isError, false)
  assert.ok(result.value && typeof result.value === 'object', 'Expected a canonical value')
  return result.value
}

function ordinary(result) {
  const text = result?.content
    ?.filter(({ type }) => type === 'text')
    .map((part) => part.text)
    .join('\n')
  assert.ok(text?.trim(), 'Expected model-facing text')
  return text
}

function nativeError(result, pattern) {
  assert.equal(result?.isError, true)
  assert.equal(result.value, undefined, 'Native input failure must not return a successful value')
  assert.match(result.error?.message ?? '', pattern)
  assert.match(ordinary(result), pattern)
}

function assertStatus(result, host, tools, profile) {
  const value = canonical(result)
  const text = ordinary(result)
  assert.equal(value.exists, true)
  assert.deepEqual(value.activeBuild, { id: host.id, version: host.version })
  assert.ok(text.includes('Active plugin build: ' + host.version + ' (' + host.id + ')'))
  if (tools) {
    assert.deepEqual(value.toolsBuild, { id: tools.id, version: tools.version })
    assert.ok(text.includes('Tools build differs from host: ' + tools.version + ' (' + tools.id + ')'))
  } else {
    assert.equal(value.toolsBuild, undefined)
    assert.ok(!text.includes('Tools build differs from host'))
  }
  assert.equal(value.installedKitVersion, installedKit)
  assert.equal(value.kitVersion, pinnedKit)
  assert.notEqual(host.version, installedKit)
  assert.ok(text.includes('Kit pinned: ' + pinnedKit + '; installed: ' + installedKit + '.'))
  assert.equal(value.entry, 'catalog')
  assert.ok(value.breakpoints.some(({ name, width }) => name === 'mobile' && width === 390))
  assert.match(text, /breakpoint="mobile" \(390px\)/)
  assert.ok(value.screens.find(({ id }) => id === 'checkout').states.includes('prices-open'))
  assert.match(text, /screen="checkout" .*state="prices-open"/)
  assert.ok(
    value.screens
      .find(({ id }) => id === 'dispatch-variants')
      .selectors.some(({ selector }) => selector === 'layout:alternate'),
  )
  assert.match(text, /variant="layout:alternate"/)
  assert.deepEqual(value.themes, ['base', 'dispatch-dark'])
  assert.equal(value.defaultTheme, 'dispatch-dark')
  assert.match(text, /Themes: base, dispatch-dark; default: dispatch-dark/)
  const usable = value.journeys.find(({ id }) => id === 'dispatch-usable')
  assert.deepEqual(usable, {
    id: 'dispatch-usable',
    file: 'journeys/dispatch-usable.dsx',
    usable: true,
    screen: 'checkout',
    breakpoint: 'mobile',
    state: 'prices-open',
    theme: 'dispatch-dark',
  })
  assert.equal(value.journeys.find(({ id }) => id === 'dispatch-blocked')?.usable, false)
  assert.match(
    text,
    /journey="dispatch-usable" .*: usable screen="checkout" state="prices-open" breakpoint="mobile" theme="dispatch-dark"/,
  )
  assert.match(text, /journey="dispatch-blocked" .*: blocked/)
  assert.equal(value.browser.status, 'unverified')
  assert.equal(value.browser.error, undefined)
  assert.equal(value.browser.executablePath, process.env.DSH_DESIGN_CHROMIUM_PATH)
  assert.ok(value.browser.guidance.includes('DSH ' + profile + ' profile'))
  assert.ok(value.browser.guidance.includes(process.platform + '/' + process.arch))
  assert.match(text, /Browser: unverified/)
  assert.ok(text.includes(value.browser.guidance))
}

async function prepareProject(cwd) {
  const folder = join(cwd, 'design')
  const manifest = join(folder, 'design.json')
  const config = await json(manifest)
  await writeFile(
    manifest,
    JSON.stringify(
      {
        ...config,
        kitVersion: pinnedKit,
        themes: { 'dispatch-dark': 'themes/dispatch-dark.json' },
        defaultTheme: 'dispatch-dark',
      },
      null,
      2,
    ) + '\n',
  )
  await mkdir(join(folder, 'themes'))
  await mkdir(join(folder, 'layouts'))
  const add = (file, ...lines) => writeFile(join(folder, file), lines.join('\n') + '\n', { flag: 'wx' })
  await add('themes/dispatch-dark.json', '{"colorScheme":"dark","tokens":{}}')
  await add(
    layoutFile,
    '<Layout>',
    '  <Stack>',
    '    <List id="dispatch-rows" items={fixture("dispatch-missing")}><ItemTemplate><Text>Row</Text></ItemTemplate></List>',
    '    <ContentSlot />',
    '  </Stack>',
    '</Layout>',
  )
  await add(
    'screens/dispatch-shell.dsx',
    '<Screen id="dispatch-shell" layout="dispatch-shell"><Text>Review</Text></Screen>',
  )
  await add(
    'screens/dispatch-variants.dsx',
    '<Screen id="dispatch-variants">',
    '  <Variants id="layout" chosen="default">',
    '    <Variant branch="default"><Text id="dispatch-default">Chosen</Text></Variant>',
    '    <Variant branch="alternate"><Text id="dispatch-alternate">Alternate</Text></Variant>',
    '  </Variants>',
    '</Screen>',
  )
  await add(
    'journeys/dispatch-usable.dsx',
    '<Journey id="dispatch-usable" start="checkout" breakpoint="mobile" state="prices-open" theme="dispatch-dark">',
    '  <ExpectVisible target="price-breakdown" visible={true} />',
    '</Journey>',
  )
  await add(
    'journeys/dispatch-blocked.dsx',
    '<Journey id="dispatch-blocked" start="no-such-screen" breakpoint="mobile">',
    '  <ExpectScreen screen="no-such-screen" />',
    '</Journey>',
  )
  // Declared as a valid-looking DSX source outside the design directory; never eligible for file scope.
  await writeFile(join(cwd, 'outside.dsx'), '<Screen id="outside"><Text>Outside</Text></Screen>\n', { flag: 'wx' })
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function diskBuild(pkg) {
  const { version } = await json(join(pkg, 'package.json'))
  const sha = async (file) =>
    createHash('sha256')
      .update(await readFile(join(pkg, 'lib', file)))
      .digest('hex')
  return { version, host: await sha('host.js'), tools: await sha('tools.js') }
}
