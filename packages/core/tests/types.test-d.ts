/** Compile-time checks for the design tree value kinds (run by tsc, not vitest). */
import type {
  DesignChild,
  DesignElement,
  DesignPropValue,
  DesignScreenNode,
  InteractionRef,
  ResolvedToken,
  SourceLocation,
  StructuralAddress,
  TokenType,
} from '../src/types.ts'

const source: SourceLocation = { file: 'screens/home.dsx', line: 1, column: 1 }
const address: StructuralAddress = { path: [0, 1], label: '#0.1' }
const interaction: InteractionRef = { $interaction: 'open', target: 'filters' }
const token: ResolvedToken = { path: 'color.action', type: 'color', value: '#2563eb', cssVar: '--dsx-color-action' }
const tokenType: TokenType = 'dimension'

const values: DesignPropValue[] = ['text', 12, true, null, ['a', 1, false], { nested: { ok: true } }, interaction]

const element: DesignElement = {
  kind: 'element',
  type: 'Button',
  id: 'save',
  props: { variant: 'primary', onPress: interaction, meta: values[5] as DesignPropValue },
  children: [{ kind: 'text', value: 'Save', source }],
  source,
  address,
}

const screen: DesignScreenNode = {
  kind: 'element',
  type: 'Screen',
  id: 'home',
  props: { title: 'Home' },
  children: [element],
  source,
  address: { path: [], label: '#' },
}
const child: DesignChild = screen

// @ts-expect-error an interaction verb outside the DSL is rejected
const badInteraction: InteractionRef = { $interaction: 'destroy', target: 'x' }
// @ts-expect-error token types are a closed union
const badToken: TokenType = 'gradient'

void [values, child, token, tokenType, badInteraction, badToken]
