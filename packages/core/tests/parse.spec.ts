import { describe, expect, it } from 'vitest'
import { parseScreen } from '../src/parse.ts'
import type { DesignElement, InteractionRef } from '../src/types.ts'

const file = 'screens/home.dsx'

function onlyRoot(source: string) {
  const parsed = parseScreen(source, file)
  expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
  expect(parsed.root).toBeDefined()
  return parsed.root!
}

describe('DSL parser', () => {
  it('accepts every declared literal value kind and interaction reference', () => {
    const root = onlyRoot(`<Screen id="home" title="Home">
      <Box number={3} negative={-2.5} enabled={true} empty={null} list={["a", 1, false]} object={{ a: "b", n: 2 }} />
      <Button id="save" onPress={open("filters")}>Save</Button>
      <Drawer id="filters" title="Filters" />
    </Screen>`)
    const box = root.children.find((child): child is DesignElement => child.kind === 'element' && child.type === 'Box')
    expect(box?.props).toEqual({
      number: 3,
      negative: -2.5,
      enabled: true,
      empty: null,
      list: ['a', 1, false],
      object: { a: 'b', n: 2 },
    })
    const button = root.children.find(
      (child): child is DesignElement => child.kind === 'element' && child.type === 'Button',
    )
    expect(button?.props.onPress).toEqual({ $interaction: 'open', target: 'filters' } satisfies InteractionRef)
  })

  it('accepts all four interaction verbs', () => {
    const root = onlyRoot(`<Screen id="home">
      <Button id="a" onPress={open("x")} />
      <Button id="b" onPress={close("x")} />
      <Button id="c" onPress={toggle("x")} />
      <Button id="d" onPress={navigate("next")} />
      <Drawer id="x" />
    </Screen>`)
    const actions = root.children
      .filter((child): child is DesignElement => child.kind === 'element' && child.type === 'Button')
      .map((button) => (button.props.onPress as InteractionRef).$interaction)
    expect(actions).toEqual(['open', 'close', 'toggle', 'navigate'])
  })

  it('rejects imports and JavaScript statements without evaluating them', () => {
    ;(globalThis as Record<string, unknown>).__dsx_pwned = false
    const parsed = parseScreen(
      `import x from 'x'
globalThis.__dsx_pwned = true;
const value = 1;
<Screen id="home" />;`,
      file,
    )
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['import-not-allowed', 'statement-not-allowed']),
    )
    expect((globalThis as Record<string, unknown>).__dsx_pwned).toBe(false)
  })

  it.each([
    ['identifier', '<Screen id="home"><Text>{items}</Text></Screen>', 'expression-not-allowed'],
    ['operator', '<Screen id="home"><Text count={1 + 2} /></Screen>', 'expression-not-allowed'],
    ['member', '<Screen id="home"><Text title={user.name} /></Screen>', 'expression-not-allowed'],
    ['call', '<Screen id="home"><Text title={format("x")} /></Screen>', 'expression-not-allowed'],
    ['template', '<Screen id="home"><Text title={`x`} /></Screen>', 'expression-not-allowed'],
    ['arrow', '<Screen id="home"><Text title={() => 1} /></Screen>', 'expression-not-allowed'],
    ['spread attribute', '<Screen id="home"><Box {...props} /></Screen>', 'expression-not-allowed'],
    ['spread child', '<Screen id="home"><Text>{...items}</Text></Screen>', 'expression-not-allowed'],
  ])('rejects %s', (_name, source, code) => {
    const parsed = parseScreen(source, file)
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === code)).toBe(true)
  })

  it('rejects a missing, multiple, or non-Screen root', () => {
    expect(parseScreen('', file).diagnostics[0]?.code).toBe('missing-screen')
    expect(
      parseScreen('<Screen id="a" />;\n<Screen id="b" />', file).diagnostics.some(
        (diagnostic) => diagnostic.code === 'multiple-screens',
      ),
    ).toBe(true)
    expect(parseScreen('<div />', file).diagnostics.some((diagnostic) => diagnostic.code === 'component-name')).toBe(
      true,
    )
    expect(
      parseScreen('<Box id="a" />', file).diagnostics.some((diagnostic) => diagnostic.code === 'missing-screen'),
    ).toBe(true)
  })

  it('recovers syntax errors instead of throwing', () => {
    const parsed = parseScreen('<Screen id="home"><Text>unclosed</Screen>', file)
    expect(parsed.diagnostics.length).toBeGreaterThan(0)
    expect(parsed.diagnostics.every((diagnostic) => diagnostic.line >= 1 && diagnostic.column >= 1)).toBe(true)
  })

  it('keeps text literal and assigns structural addresses to element children', () => {
    const root = onlyRoot('<Screen id="home"><Box><Text>A &amp; B</Text></Box><Box /></Screen>')
    const boxes = root.children.filter((child): child is DesignElement => child.kind === 'element')
    expect(boxes.map((box) => box.address.label)).toEqual(['#0', '#1'])
    const textNode = boxes[0]?.children.find((child) => child.kind === 'element' && child.type === 'Text')
    expect(textNode?.kind).toBe('element')
    const literal = textNode?.kind === 'element' ? textNode.children[0] : undefined
    expect(literal?.kind).toBe('text')
    if (literal?.kind === 'text') expect(literal.value).toContain('&')
  })
})
