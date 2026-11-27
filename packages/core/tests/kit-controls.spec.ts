import { describe, expect, it } from 'vitest'
import { kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { parseJourney, validateJourney } from '../src/journey.ts'
import { parseScreen } from '../src/parse.ts'
import { extractNamedStates, stateCompatibility } from '../src/state.ts'
import { errors, validateSource } from './helpers.ts'

const options = '[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }]'
const controls = `<ToggleButton id="pin" label="Pin" /><SelectButton id="mode" label="Mode" options={${options}} />`
const source = (values: string) =>
  `<Screen id="example" states={{ seeded: { values: ${values} } }}>${controls}</Screen>`
const parse = (dsx: string) => parseScreen(dsx, 'screens/example.dsx').root!

describe('compound kit control validation', () => {
  it('accepts typed named seeds, but checks values again on each alternate projection', () => {
    const root = parse(source('{ pin: true, mode: "list" }'))
    const result = extractNamedStates(root, root.source.file, kitMetadata)
    expect(result.diagnostics).toEqual([])
    expect(result.states[0]?.values).toEqual({ pin: true, mode: 'list' })
    const variant = parse('<Screen id="example">' + controls.replace('value: "list"', 'value: "other"') + '</Screen>')
    expect(stateCompatibility(variant, result.states[0]!, kitMetadata)).toEqual([
      'assigns an undeclared option value to <SelectButton> "mode"',
    ])
  })

  it('reports incompatible and missing named seed targets at the authored state', () => {
    const root = parse(source('{ pin: "true", mode: "unknown", missing: false }'))
    const result = extractNamedStates(root, root.source.file, kitMetadata)
    expect(result.states).toEqual([])
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      'state-value-type',
      'state-value-option',
      'state-value-missing',
    ])
    expect(result.diagnostics.every((item) => item.file === 'screens/example.dsx' && item.column > 1)).toBe(true)
  })

  it('rejects unbounded code, undeclared anchors and malformed options and action references', () => {
    const result = validateSource(
      `<Screen id="example">
      <CodeBlock text={${JSON.stringify('a'.repeat(16_385))}} />
      <Popover id="popover" anchor="missing" />
      <SelectButton id="mode" label="Mode" value="unknown" options={[{ value: "grid", label: "Grid", disabled: "yes" }, { value: "grid", label: "Repeated" }]} />
      <SplitButton id="save" label="Save" onClick={navigate("example")} options={[{ value: "draft", label: "Draft", onClick: open("missing") }]} />
    </Screen>`,
      { file: 'screens/example.dsx', screens: ['example'] },
    )
    expect(errors(result.diagnostics).map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'code-block-text',
        'popover-anchor',
        'control-option-disabled',
        'control-option-id',
        'control-option-value',
        'interaction-target-missing',
      ]),
    )
  })
})

describe('themed typed journeys', () => {
  const root = parse(`<Screen id="example">${controls}
    <Tabs id="tabs"><Tab id="one" label="One" /><Tab id="two" label="Two" /></Tabs>
    <SplitButton id="save" label="Save" onClick={navigate("details")} options={[{ value: "draft", label: "Draft", onClick: navigate("details") }]} />
  </Screen>`)
  const ctx = {
    projectScreens: ['example', 'details'],
    breakpoints: ['mobile'],
    themes: ['base', 'dark'],
    rootOf: (id: string) => (id === 'example' ? root : parse('<Screen id="details" />')),
    statesOf: () => [],
  }

  it('supports an inactive Tab, selection and pressed values, and restricted split parts', () => {
    const parsed = parseJourney(
      `<Journey id="flow" start="example" breakpoint="mobile" theme="dark">
      <Tap target="two" /><Tap target="pin" /><ExpectValue target="pin" value={true} />
      <Choose target="mode" value="list" /><ExpectValue target="mode" value="list" />
      <Tap target="save" part="menu" /><Choose target="save" part="menu" value="draft" />
      <ExpectScreen screen="details" />
    </Journey>`,
      'journeys/flow.dsx',
    )
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.journey?.theme).toBe('dark')
    expect(parsed.journey?.steps[6]).toMatchObject({ kind: 'choose', target: 'save', part: 'menu', value: 'draft' })
    expect(validateJourney(parsed, ctx)).toEqual([])
  })

  it('rejects unknown themes, wrong split targets, and undeclared options with step locations', () => {
    const parsed = parseJourney(
      `<Journey id="flow" start="example" theme="unknown">
      <Tap target="save" />
      <Tap target="two" part="primary" />
      <Choose target="save" part="menu" value="missing" />
      <Tap target="not-found" />
    </Journey>`,
      'journeys/flow.dsx',
    )
    expect(validateJourney(parsed, ctx)).toEqual([
      expect.objectContaining({ code: 'journey-theme-missing', line: 1 }),
      expect.objectContaining({ code: 'journey-target-part', line: 2, message: expect.stringContaining('Step 1') }),
      expect.objectContaining({ code: 'journey-target-type', line: 3, message: expect.stringContaining('step 2') }),
      expect.objectContaining({ code: 'journey-option-missing', line: 4, message: expect.stringContaining('Step 3') }),
      expect.objectContaining({
        code: 'journey-target-missing',
        line: 5,
        message: expect.stringContaining('not-found'),
      }),
    ])
    expect(
      parseJourney(
        '<Journey id="flow" start="example"><Tap target="save" part="[role=button]" /></Journey>',
        'journeys/flow.dsx',
      ).diagnostics,
    ).toEqual([expect.objectContaining({ code: 'journey-argument' })])
  })
})
