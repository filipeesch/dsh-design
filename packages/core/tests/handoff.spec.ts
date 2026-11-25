import { describe, expect, it } from 'vitest'
import { extractNamedStates } from '../src/state.ts'
import { parseScreen } from '../src/parse.ts'
import { fingerprintDesignTree } from '../src/fingerprint.ts'
import { handoffProjectionId, renderDesignValue, serializeScreen } from '../src/handoff.ts'
import { kitMetadata } from '@filipeesch/dsh-design-kit/meta'

const source = `<Screen id="checkout" title="Checkout" states={{ "review-open": { open: ["drawer"], values: { email: "ada@example.com" } } }}>
  <Header title="Checkout" />
  <Stack gap={{ mobile: "spacing.sm", desktop: "spacing.md" }} padding="spacing.md">
    <Input id="email" label="Email" placeholder="you@example.com" />
    <Text>He said "hi" & left braces.</Text>
    <Button id="open" onPress={open("drawer")}>Open</Button>
    <Button id="close" onPress={close("drawer")}>Close</Button>
  </Stack>
  <Drawer id="drawer" title="Review"><Text>Body</Text></Drawer>
</Screen>`

describe('handoff DSX serialization', () => {
  it('round-trips ids, behavior, text, literal props, and named states', () => {
    const parsed = parseScreen(source, 'screens/checkout.dsx')
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toHaveLength(0)
    const extracted = extractNamedStates(parsed.root!, 'screens/checkout.dsx', kitMetadata)
    const printed = serializeScreen(extracted.root, extracted.states)
    expect(printed).toContain('open("drawer")')
    expect(printed).toContain('close("drawer")')
    expect(printed).toContain('states={{"review-open":')
    expect(printed).not.toContain('<Variants')
    expect(printed).toContain('mobile')
    expect(printed).toContain('spacing.md')
    const reparsed = parseScreen(printed, 'screens/checkout.dsx')
    expect(reparsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toHaveLength(0)
    const roundTripped = extractNamedStates(reparsed.root!, 'screens/checkout.dsx', kitMetadata)
    expect(fingerprintDesignTree(roundTripped.root)).toBe(fingerprintDesignTree(extracted.root))
    expect(
      roundTripped.states.map((state) => ({
        name: state.name,
        open: state.open,
        tabs: state.tabs,
        values: state.values,
      })),
    ).toEqual(
      extracted.states.map((state) => ({ name: state.name, open: state.open, tabs: state.tabs, values: state.values })),
    )
    expect(printed).toContain('{"He said \\"hi\\" & left braces."}')
  })

  it('uses collision-free projection identities for tuple components containing delimiters', () => {
    const first = handoffProjectionId('a--b', 'c', 'd')
    const second = handoffProjectionId('a', 'b--c', 'd')
    expect(first).not.toBe(second)
    expect(first).toBe('4_a--b_1_c_1_d')
    expect(second).toBe('1_a_4_b--c_1_d')
  })

  it('renders negative, null, object, array, and reference values deterministically', () => {
    expect(renderDesignValue(-3)).toBe('-3')
    expect(renderDesignValue(null)).toBe('null')
    expect(renderDesignValue({ b: 2, a: 'x' })).toBe('{"a": "x", "b": 2}')
    expect(renderDesignValue([1, true, 'x'])).toBe('[1, true, "x"]')
    expect(renderDesignValue({ $interaction: 'navigate', target: 'done' })).toBe('navigate("done")')
  })
})
