import { describe, expect, it } from 'vitest'
import { errors, validateSource, validScreen, warnings } from './helpers.ts'
import { parseTokens } from '../src/tokens.ts'

describe('screen validation', () => {
  it('accepts the sample screen with no errors', () => {
    expect(errors(validateSource(validScreen).diagnostics)).toEqual([])
  })

  it('suggests the closest component', () => {
    const diagnostics = errors(validateSource('<Screen id="home"><Buton id="x">Hi</Buton></Screen>').diagnostics)
    expect(diagnostics[0]?.code).toBe('unknown-component')
    expect(diagnostics[0]?.suggestion).toContain('Button')
  })

  it('rejects an unknown prop with a suggestion', () => {
    const diagnostics = errors(
      validateSource('<Screen id="home"><Button id="x" variant="primary" varient="ghost">Go</Button></Screen>')
        .diagnostics,
    )
    const unknown = diagnostics.find((diagnostic) => diagnostic.code === 'unknown-prop')
    expect(unknown?.message).toContain('varient')
    expect(unknown?.suggestion).toContain('variant')
  })

  it('rejects an unknown enum value and lists valid values', () => {
    const diagnostics = errors(
      validateSource('<Screen id="home"><Button id="x" variant="prim">Go</Button></Screen>').diagnostics,
    )
    const diagnostic = diagnostics.find((candidate) => candidate.code === 'prop-enum')
    expect(diagnostic?.suggestion).toContain('primary')
    expect(diagnostic?.suggestion).toContain('secondary')
  })

  it('requires ids on interactive nodes and overlays', () => {
    const drawer = errors(validateSource('<Screen id="home"><Drawer title="Filters" /></Screen>').diagnostics)
    expect(drawer.some((diagnostic) => diagnostic.code === 'id-required')).toBe(true)
    const button = errors(validateSource('<Screen id="home"><Button>Go</Button></Screen>').diagnostics)
    expect(button.some((diagnostic) => diagnostic.code === 'id-required')).toBe(true)
    const input = errors(validateSource('<Screen id="home"><Input /></Screen>').diagnostics)
    expect(input.some((diagnostic) => diagnostic.code === 'id-required')).toBe(true)
  })

  it('rejects duplicate and malformed ids', () => {
    const duplicate = errors(
      validateSource('<Screen id="home"><Box id="same" /><Box id="same" /></Screen>').diagnostics,
    )
    expect(duplicate.filter((diagnostic) => diagnostic.code === 'duplicate-id')).toHaveLength(1)
    const malformed = errors(validateSource('<Screen id="Home!"><Box id="Bad_Id" /></Screen>').diagnostics)
    expect(malformed.filter((diagnostic) => diagnostic.code === 'id-format')).toHaveLength(2)
  })

  it('requires the screen id and required component props', () => {
    expect(
      errors(validateSource('<Screen />').diagnostics).some((diagnostic) => diagnostic.code === 'screen-id-required'),
    ).toBe(true)
    expect(
      errors(validateSource('<Screen id="home"><Select id="s" /></Screen>').diagnostics).some(
        (diagnostic) => diagnostic.code === 'prop-required',
      ),
    ).toBe(true)
  })

  it('enforces children rules', () => {
    const diagnostics = errors(
      validateSource('<Screen id="home"><Text><Button id="x">Nested</Button></Text></Screen>').diagnostics,
    )
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'children-not-allowed')).toBe(true)
    const screenText = errors(validateSource('<Screen id="home">raw text</Screen>').diagnostics)
    expect(screenText.some((diagnostic) => diagnostic.code === 'children-not-allowed')).toBe(true)
  })

  it('reports unknown tokens with the nearest token and off-token literals as warnings', () => {
    const unknown = errors(validateSource('<Screen id="home"><Stack gap="spacing.huge" /></Screen>').diagnostics)
    const diagnostic = unknown.find((candidate) => candidate.code === 'unknown-token')
    expect(diagnostic?.suggestion).toContain('spacing.')
    const offToken = warnings(validateSource('<Screen id="home"><Box background="#ff0000" /></Screen>').diagnostics)
    expect(offToken.some((candidate) => candidate.code === 'off-token')).toBe(true)
  })

  it('rejects a token of the wrong type', () => {
    const diagnostics = errors(validateSource('<Screen id="home"><Stack gap="color.action" /></Screen>').diagnostics)
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'token-type-mismatch')).toBe(true)
  })

  it('validates responsive objects and rejects unknown breakpoints', () => {
    const valid = validateSource(
      '<Screen id="home"><Stack direction={{ mobile: "column", desktop: "row" }} /></Screen>',
    )
    expect(errors(valid.diagnostics)).toEqual([])
    const invalid = errors(
      validateSource('<Screen id="home"><Stack direction={{ phone: "column" }} /></Screen>').diagnostics,
    )
    expect(invalid.some((diagnostic) => diagnostic.code === 'breakpoint-unknown')).toBe(true)
  })

  it('validates interaction targets across overlays and screens', () => {
    const valid = validateSource(
      `<Screen id="home">
      <Button id="open" onPress={open("filters")}>Open</Button>
      <Button id="next" onPress={navigate("details")}>Next</Button>
      <Drawer id="filters" />
    </Screen>`,
      { screens: ['home', 'details'] },
    )
    expect(errors(valid.diagnostics)).toEqual([])
    const missingOverlay = errors(
      validateSource('<Screen id="home"><Button id="open" onPress={open("nope")}>Open</Button></Screen>').diagnostics,
    )
    expect(missingOverlay.some((diagnostic) => diagnostic.code === 'interaction-target-missing')).toBe(true)
    const notOverlay = errors(
      validateSource('<Screen id="home"><Box id="x" /><Button id="open" onPress={open("x")}>Open</Button></Screen>')
        .diagnostics,
    )
    expect(notOverlay.some((diagnostic) => diagnostic.code === 'interaction-target-not-overlay')).toBe(true)
    const missingScreen = errors(
      validateSource('<Screen id="home"><Button id="next" onPress={navigate("checkout")}>Next</Button></Screen>', {
        screens: ['home'],
      }).diagnostics,
    )
    expect(missingScreen.some((diagnostic) => diagnostic.code === 'interaction-target-missing')).toBe(true)
  })

  it('validates the css escape hatch and always warns', () => {
    const valid = validateSource('<Screen id="home"><Card css="border-left: 4px solid red">x</Card></Screen>')
    expect(errors(valid.diagnostics)).toEqual([])
    expect(warnings(valid.diagnostics).some((diagnostic) => diagnostic.code === 'raw-css')).toBe(true)
    expect(
      errors(
        validateSource('<Screen id="home"><Card css="color: red; .x { color: blue }">x</Card></Screen>').diagnostics,
      ).some((diagnostic) => diagnostic.code === 'css-selector'),
    ).toBe(true)
    expect(
      errors(validateSource('<Screen id="home"><Card css="@import url(x)">x</Card></Screen>').diagnostics).some(
        (diagnostic) => diagnostic.code === 'css-at-rule',
      ),
    ).toBe(true)
    expect(
      errors(
        validateSource('<Screen id="home"><Card css="background: url(https://example.com/a.png)">x</Card></Screen>')
          .diagnostics,
      ).some((diagnostic) => diagnostic.code === 'css-url-external'),
    ).toBe(true)
  })

  it('accepts local images and rejects remote or escaping images', () => {
    expect(
      errors(validateSource('<Screen id="home"><Image src="placeholder: product" /></Screen>').diagnostics),
    ).toEqual([])
    expect(errors(validateSource('<Screen id="home"><Image src="images/a.png" /></Screen>').diagnostics)).toEqual([])
    expect(
      errors(validateSource('<Screen id="home"><Image src="https://example.com/a.png" /></Screen>').diagnostics).some(
        (diagnostic) => diagnostic.code === 'image-remote',
      ),
    ).toBe(true)
    expect(
      errors(validateSource('<Screen id="home"><Image src="../secret.png" /></Screen>').diagnostics).some(
        (diagnostic) => diagnostic.code === 'image-outside',
      ),
    ).toBe(true)
  })

  it('reports every independent error in one pass in source order', () => {
    const diagnostics = errors(
      validateSource(`<Screen id="home">
      <Buton />
      <Button id="x" variant="prim">Go</Button>
      <Text title="bad" />
    </Screen>`).diagnostics,
    )
    expect(diagnostics.length).toBeGreaterThanOrEqual(3)
    const sorted = [...diagnostics].sort((left, right) => left.line - right.line || left.column - right.column)
    expect(diagnostics.map((diagnostic) => diagnostic.line)).toEqual(sorted.map((diagnostic) => diagnostic.line))
  })

  it('reports a corpus of typical model mistakes with message and suggestion', () => {
    const corpus = [
      ['<Screen id="home"><Buton /></Screen>', 'unknown-component', 'Button'],
      ['<Screen id="home"><Button id="x" variant="prim">Go</Button></Screen>', 'prop-enum', 'primary'],
      ['<Screen id="home"><Stack gap="spacing.hug" /></Screen>', 'unknown-token', 'spacing.'],
      [
        '<Screen id="home"><Button id="x" onPress={open("missing")}>Go</Button></Screen>',
        'interaction-target-missing',
        'Overlays',
      ],
      ['<Screen id="home"><Image src="https://example.com/a.png" /></Screen>', 'image-remote', 'design folder'],
    ] as const
    for (const [source, code, suggestion] of corpus) {
      const diagnostic = errors(validateSource(source).diagnostics).find((candidate) => candidate.code === code)
      expect(diagnostic, code + ' present').toBeDefined()
      expect(diagnostic?.message.length ?? 0).toBeGreaterThan(0)
      expect(diagnostic?.suggestion ?? '').toContain(suggestion)
    }
  })

  it('reports a broken token alias from tokens.json', () => {
    const tokens = parseTokens(
      JSON.stringify({ color: { bad: { $value: '{color.missing}', $type: 'color' } } }),
      'tokens.json',
    )
    expect(tokens.diagnostics.some((diagnostic) => diagnostic.code === 'token-alias-missing')).toBe(true)
  })
})
