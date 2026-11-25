import { describe, expect, it } from 'vitest'
import { parseCssDeclarations, cssRuleText, collectCssRules } from '../src/css.ts'
import { parseScreen } from '../src/parse.ts'
import { normalizeFolderName } from '../src/project.ts'

describe('css escape parser', () => {
  it('parses declarations and rejects selectors, at-rules, important, markup, and external URLs', () => {
    const valid = parseCssDeclarations('border-left: 4px solid #f00; color: rgb(1, 2, 3);')
    expect(valid.issues).toEqual([])
    expect(valid.declarations).toEqual([
      { property: 'border-left', value: '4px solid #f00' },
      { property: 'color', value: 'rgb(1, 2, 3)' },
    ])
    expect(parseCssDeclarations('.x { color: red }').issues[0]?.code).toBe('css-selector')
    expect(parseCssDeclarations('@import url(x)').issues[0]?.code).toBe('css-at-rule')
    expect(parseCssDeclarations('color: red !important').issues[0]?.code).toBe('css-important')
    expect(parseCssDeclarations('background: url(https://example.com/a.png)').issues[0]?.code).toBe('css-url-external')
    expect(parseCssDeclarations('background: url(../a.png)').issues[0]?.code).toBe('css-url-external')
    expect(parseCssDeclarations('content: "</style>"').issues[0]?.code).toBe('css-unsafe')
  })

  it('rewrites local URLs and collects one rule per node', () => {
    const root = parseScreen(
      `<Screen id="home">
      <Card id="card" css="border-left: 4px solid red; background: url(images/a.png)"><Text>Hi</Text></Card>
      <Text>Plain</Text>
    </Screen>`,
      'screens/home.dsx',
    ).root!
    const rules = collectCssRules(root, (path) => '/design/s/files/' + path)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toContain('.dsx-css-card')
    expect(rules[0]).toContain('border-left: 4px solid red !important;')
    expect(rules[0]).toContain('url("/design/s/files/images/a.png")')
    expect(cssRuleText(root, () => 'x')).toBeUndefined()
  })
})

describe('folder names', () => {
  it('accepts one safe segment and rejects escapes', () => {
    expect(normalizeFolderName('design')).toBe('design')
    expect(normalizeFolderName('specs.v2')).toBe('specs.v2')
    expect(() => normalizeFolderName('../outside')).toThrow()
    expect(() => normalizeFolderName('a/b')).toThrow()
    expect(() => normalizeFolderName('..')).toThrow()
  })
})
