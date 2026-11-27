/** A deterministic 30-screen project and an idle Design session for DSH Web. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'design-preview-transfer-fixture'
export const sessionId = 'preview-transfer'
export const sessionTitle = 'Preview transfer fixture'
export const firstScreen = 'screen-01'
export const lastScreen = 'screen-30'
const ids = Array.from({ length: 30 }, (_, i) => 'screen-' + String(i + 1).padStart(2, '0'))
const json = (value) => JSON.stringify(value, null, 2) + '\n'

function fixtureFiles() {
  const files = new Map([
    ['design.json', json({ kitVersion: '1.0.0', entry: firstScreen, breakpoints: { mobile: 390, desktop: 1280 } })],
    ['tokens.json', json({ spacing: { md: { $value: '16px', $type: 'dimension' } } })],
    [
      'preview.json',
      json({
        groups: [
          { id: 'intake', label: 'Intake', screens: ids.slice(0, 15) },
          { id: 'operations', label: 'Operations', screens: ids.slice(15) },
        ],
        situations: [
          {
            id: 'details-open',
            label: 'Details open',
            parent: lastScreen,
            target: { screen: lastScreen, state: 'details-open' },
          },
        ],
      }),
    ],
  ])
  ids.forEach((id, index) => {
    const number = id.slice(-2)
    const next = ids[(index + 1) % ids.length]
    const cards = Array.from({ length: 36 }, (_, i) => {
      const row = i + 1
      return (
        '    <Stack id="record-' +
        row +
        '" gap="spacing.md">\n' +
        '      <Text variant="heading">Case ' +
        number +
        '-' +
        row +
        '</Text>\n' +
        '      <Text>Queue ' +
        number +
        ' contains a synthetic service request for account ' +
        row +
        '.</Text>\n' +
        '      <Text>The assigned reviewer checks delivery notes and confirms the relevant operational details.</Text>\n' +
        '      <Button id="details-' +
        row +
        '" onPress={open("details")}>Review case ' +
        row +
        '</Button>\n' +
        '    </Stack>'
      )
    })
    files.set(
      'screens/' + id + '.dsx',
      [
        '<Screen id="' + id + '" title="Queue ' + number + '" states={{ "details-open": { open: ["details"] } }}>',
        '  <Stack gap="spacing.md">',
        '    <Text id="queue-heading" variant="heading">Queue dashboard ' + number + '</Text>',
        '    <Button id="next" onPress={navigate("' + next + '")}>Next queue</Button>',
        ...cards,
        '  </Stack>',
        '  <Drawer id="details" title="Case details"><Text>Fictitious case notes.</Text></Drawer>',
        '</Screen>',
        '',
      ].join('\n'),
    )
  })
  return files
}

export async function prepareFixture(root) {
  const design = join(root, 'workspace', 'design')
  await mkdir(join(design, 'screens'), { recursive: true })
  for (const [file, body] of fixtureFiles()) await writeFile(join(design, file), body, { flag: 'wx' })
}

export async function verifyFixture(root) {
  const digest = createHash('sha256')
  let sourceBytes = 0
  for (const [file, expected] of fixtureFiles()) {
    const actual = await readFile(join(root, 'workspace', 'design', file), 'utf8')
    assert.equal(actual, expected, 'Fixture changed: ' + file)
    digest.update(file + '\0' + actual + '\0')
    sourceBytes += Buffer.byteLength(actual)
  }
  return { screens: ids.length, sourceBytes, sha256: digest.digest('hex') }
}

export function apply(ctx) {
  ctx.inject(['workspaceController', 'sessionController', 'profileContext', 'agents'], (scope) => {
    run(scope).catch((error) => console.error('PREVIEW_TRANSFER_SEED_FAILED', error))
  })
}

async function run(scope) {
  const root = await realpath(process.env.PREVIEW_TRANSFER_ROOT)
  assert.equal(await realpath(scope.profileContext.home), join(root, 'home'))
  assert.equal(scope.profileContext.name, 'preview-transfer')
  await verifyFixture(root)
  const { workspace } = await scope.workspaceController.create({ path: join(root, 'workspace') })
  await scope.workspaceController.rename({ workspaceId: workspace.workspaceId, title: 'Synthetic queues' })
  await scope.sessionController.create({ sessionId, workspaceId: workspace.workspaceId, agentPreset: 'design' })
  await scope.sessionController.rename({ sessionId, title: sessionTitle })
  // The sidebar hides blank sessions. Seed one setup message without a model or credentials,
  // then wait for the isolated agent to be idle before allowing browser measurement.
  const seeded = await scope.sessionController.prompt(
    {
      requestId: 'preview-transfer-setup',
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'Synthetic preview fixture setup only.' }],
    },
    new AbortController().signal,
  )
  assert.equal(seeded.accepted, true)
  const agent = scope.agents.get(sessionId)
  assert.ok(agent)
  for (let i = 0; agent.status === 'running' && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 50))
  assert.notEqual(agent.status, 'running')
  await writeFile(join(root, 'ready'), 'idle\n', { flag: 'wx' })
}
