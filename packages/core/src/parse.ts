/**
 * Parser for the `.dsx` design DSL.
 *
 * The file is parsed by Babel's JSX parser in error-recovery mode, then walked
 * by an allowlist that converts accepted nodes into the design tree. Nothing is
 * evaluated: identifiers, operators, template literals, spreads, imports, and
 * arbitrary calls all become diagnostics.
 */
import { parse as babelParse } from '@babel/parser'
import type {
  CallExpression,
  Expression,
  JSXAttribute,
  JSXElement,
  JSXText,
  Node,
  ObjectExpression,
  ObjectProperty,
  Program,
} from '@babel/types'
import type {
  DesignChild,
  DesignElement,
  DesignScreenNode,
  DesignProps,
  DesignPropValue,
  Diagnostic,
  FixtureRef,
  InteractionAction,
  InteractionRef,
  ItemRef,
  ParsedScreen,
  SourceLocation,
  StructuralAddress,
} from './types.ts'

const INTERACTION_ACTIONS = new Set<InteractionAction>(['open', 'close', 'toggle', 'navigate'])
const JSX_NAME = /^[A-Z][A-Za-z0-9]*$/

interface ParserContext {
  readonly file: string
  readonly diagnostics: Diagnostic[]
}

/** Source position of a Babel node, defaulting to the start of the file. */
function locationOf(node: Node | null | undefined, file: string): SourceLocation {
  const loc = node?.loc
  if (loc === null || loc === undefined) return { file, line: 1, column: 1 }
  return {
    file,
    line: loc.start.line,
    column: loc.start.column + 1,
    endLine: loc.end.line,
    endColumn: loc.end.column + 1,
  }
}

/** Report one diagnostic at a Babel node. */
function report(
  ctx: ParserContext,
  node: Node | null | undefined,
  code: string,
  message: string,
  suggestion?: string,
): void {
  const location = locationOf(node, ctx.file)
  ctx.diagnostics.push({
    severity: 'error',
    code,
    file: ctx.file,
    line: location.line,
    column: location.column,
    message,
    ...(suggestion === undefined ? {} : { suggestion }),
  })
}

/** Reject one expression that the DSL does not allow, naming the construct. */
function rejectExpression(ctx: ParserContext, expression: Expression | Node, message?: string): undefined {
  const kind = expression.type
  const friendly: Record<string, string> = {
    Identifier: 'an identifier',
    TemplateLiteral: 'a template literal',
    BinaryExpression: 'an operator expression',
    LogicalExpression: 'an operator expression',
    UnaryExpression: 'an operator expression',
    ConditionalExpression: 'a conditional expression',
    ArrowFunctionExpression: 'a function',
    FunctionExpression: 'a function',
    MemberExpression: 'a member access',
    OptionalMemberExpression: 'a member access',
    AssignmentExpression: 'an assignment',
    SequenceExpression: 'a sequence expression',
    TaggedTemplateExpression: 'a tagged template',
    NewExpression: 'a constructor call',
    ThisExpression: 'this',
    SpreadElement: 'a spread',
    ObjectMethod: 'an object method',
    RegExpLiteral: 'a regular expression',
    AwaitExpression: 'await',
    YieldExpression: 'yield',
    JSXElement: 'a nested element',
    JSXFragment: 'a fragment',
  }
  report(
    ctx,
    expression,
    'expression-not-allowed',
    message ??
      `Expressions are not allowed in the design DSL; ${friendly[kind] ?? kind} is not accepted. Use a literal value instead.`,
  )
  return undefined
}

/** Parse `fixture("id")` or `item("field")` into a declarative reference. */
function parseDeclarativeRef(
  ctx: ParserContext,
  node: CallExpression,
  callee: 'fixture' | 'item',
): FixtureRef | ItemRef | undefined {
  if (node.arguments.length !== 1 || node.arguments[0]?.type === 'SpreadElement') {
    report(ctx, node, callee + '-arguments', callee + '() takes exactly one quoted string.')
    return undefined
  }
  const argument = node.arguments[0]
  if (argument?.type !== 'StringLiteral') {
    report(ctx, node, callee + '-argument', callee + '() requires a quoted string.')
    return undefined
  }
  return callee === 'fixture' ? { $fixture: argument.value } : { $item: argument.value }
}

/** Parse any allowed call value: a declarative reference or an interaction. */
function parseCallValue(ctx: ParserContext, node: CallExpression): DesignPropValue | undefined {
  const callee = node.callee
  if (callee.type === 'Identifier' && (callee.name === 'fixture' || callee.name === 'item')) {
    return parseDeclarativeRef(ctx, node, callee.name)
  }
  return parseInteraction(ctx, node)
}

/** Parse an interaction reference call such as `open("filters")`. */
function parseInteraction(ctx: ParserContext, node: CallExpression): InteractionRef | undefined {
  const callee = node.callee
  if (callee.type !== 'Identifier' || !INTERACTION_ACTIONS.has(callee.name as InteractionAction)) {
    return rejectExpression(
      ctx,
      node,
      'Only open("id"), close("id"), toggle("id"), and navigate("screen") calls are allowed; arbitrary calls are not executed.',
    )
  }
  if (node.arguments.length !== 1 || node.arguments[0]?.type === 'SpreadElement') {
    report(ctx, node, 'interaction-arguments', `${callee.name}() takes exactly one string target.`)
    return undefined
  }
  const argument = node.arguments[0]
  if (argument?.type !== 'StringLiteral') {
    report(ctx, node, 'interaction-target', `${callee.name}() requires a quoted target id.`)
    return undefined
  }
  return { $interaction: callee.name as InteractionAction, target: argument.value }
}

/** Convert an object literal of literals into a plain object. */
function parseObject(ctx: ParserContext, node: ObjectExpression): Record<string, DesignPropValue> | undefined {
  const result: Record<string, DesignPropValue> = {}
  for (const property of node.properties) {
    if (property.type !== 'ObjectProperty') {
      rejectExpression(
        ctx,
        property,
        'Only object literals of literal values are allowed; spreads and methods are rejected.',
      )
      continue
    }
    const prop = property as ObjectProperty
    if (prop.computed) {
      report(ctx, prop, 'expression-not-allowed', 'Computed object keys are not allowed.')
      continue
    }
    const key =
      prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'StringLiteral' ? prop.key.value : undefined
    if (key === undefined) {
      report(ctx, prop, 'expression-not-allowed', 'Object keys must be plain names or string literals.')
      continue
    }
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      report(
        ctx,
        prop,
        'duplicate-object-key',
        `Duplicate object key "${key}"; later values do not override earlier ones silently.`,
      )
      continue
    }
    const value = parseValue(ctx, prop.value as Expression)
    if (value !== undefined) result[key] = value
  }
  return result
}

/** Convert one literal expression into a prop value. */
function parseValue(ctx: ParserContext, expression: Node): DesignPropValue | undefined {
  switch (expression.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return expression.value
    case 'NullLiteral':
      return null
    case 'UnaryExpression': {
      if (expression.operator === '-' && expression.argument.type === 'NumericLiteral') {
        return -expression.argument.value
      }
      return rejectExpression(ctx, expression, 'Only a negative number literal is allowed as a unary value.')
    }
    case 'ArrayExpression': {
      const values: DesignPropValue[] = []
      for (const element of expression.elements) {
        if (element === null) {
          report(ctx, expression, 'expression-not-allowed', 'Array holes are not allowed.')
          continue
        }
        if (element.type === 'SpreadElement') {
          report(ctx, element, 'expression-not-allowed', 'Spread elements are not allowed in the design DSL.')
          continue
        }
        const value = parseValue(ctx, element)
        if (value !== undefined) values.push(value)
      }
      return values
    }
    case 'ObjectExpression':
      return parseObject(ctx, expression)
    case 'CallExpression':
      return parseCallValue(ctx, expression)
    case 'JSXElement':
    case 'JSXFragment':
      return rejectExpression(ctx, expression, 'Elements are not allowed inside a prop value; pass them as children.')
    case 'TemplateLiteral':
      return rejectExpression(ctx, expression, 'Template literals are not allowed; use a quoted string.')
    default:
      return rejectExpression(ctx, expression)
  }
}

/** Convert a JSX attribute value into a design prop value. */
function parseAttributeValue(ctx: ParserContext, attribute: JSXAttribute): DesignPropValue | undefined {
  const value = attribute.value
  if (value === null || value === undefined) return true
  if (value.type === 'StringLiteral') return value.value
  if (value.type === 'JSXExpressionContainer') {
    if (value.expression.type === 'JSXEmptyExpression') return undefined
    return parseValue(ctx, value.expression)
  }
  report(
    ctx,
    value,
    'expression-not-allowed',
    'This attribute value is not allowed; use a string or a literal expression.',
  )
  return undefined
}

/** Normalize JSX text the way JSX treats whitespace: collapse runs and trim edges. */
export function cleanJsxText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Convert one JSX element into a design element, recursing into children. */
function parseElement(ctx: ParserContext, node: JSXElement, address: StructuralAddress): DesignElement | undefined {
  const opening = node.openingElement
  const name = opening.name
  if (name.type === 'JSXMemberExpression') {
    report(ctx, name, 'component-name', 'Component names must be a single capitalised name, not a member expression.')
    return undefined
  }
  if (name.type === 'JSXNamespacedName') {
    report(ctx, name, 'component-name', 'Namespaced component names are not allowed.')
    return undefined
  }
  if (!JSX_NAME.test(name.name)) {
    const message = /^[a-z]/.test(name.name)
      ? `Unknown HTML element <${name.name}>; use a kit component such as <Box> or <Text>.`
      : `Component names must start with a capital letter; "${name.name}" is not a valid component name.`
    report(ctx, name, 'component-name', message)
    return undefined
  }

  const props: DesignProps = {}
  const propLocations: Record<string, SourceLocation> = {}
  for (const attribute of opening.attributes) {
    if (attribute.type === 'JSXSpreadAttribute') {
      report(ctx, attribute, 'expression-not-allowed', 'Spread attributes are not allowed in the design DSL.')
      continue
    }
    const key = attribute.name.type === 'JSXIdentifier' ? attribute.name.name : attribute.name.name.name
    if (attribute.value !== null && attribute.value !== undefined && attribute.value.type === 'JSXElement') {
      report(ctx, attribute.value, 'expression-not-allowed', 'Elements are not allowed inside a prop value.')
      continue
    }
    const value = parseAttributeValue(ctx, attribute)
    if (value !== undefined) {
      props[key] = value
      propLocations[key] = locationOf(attribute, ctx.file)
    }
  }

  const children: DesignChild[] = []
  let elementIndex = 0
  for (const child of node.children) {
    if (child.type === 'JSXText') {
      const text = cleanJsxText((child as JSXText).value)
      if (text.length > 0) {
        children.push({ kind: 'text', value: text, source: locationOf(child, ctx.file) })
      }
      continue
    }
    if (child.type === 'JSXElement') {
      const path = [...address.path, elementIndex]
      elementIndex += 1
      const parsed = parseElement(ctx, child, { path, label: formatAddress(path) })
      if (parsed !== undefined) children.push(parsed)
      continue
    }
    if (child.type === 'JSXFragment') {
      report(ctx, child, 'fragment-not-allowed', 'Fragments are not allowed; use a single component element instead.')
      continue
    }
    if (child.type === 'JSXExpressionContainer') {
      if (child.expression.type === 'JSXEmptyExpression') continue
      if (
        child.expression.type === 'CallExpression' &&
        child.expression.callee.type === 'Identifier' &&
        child.expression.callee.name === 'item'
      ) {
        const reference = parseDeclarativeRef(ctx, child.expression, 'item')
        if (reference !== undefined && '$item' in reference) {
          children.push({
            kind: 'text',
            value: '',
            itemField: reference.$item,
            source: locationOf(child, ctx.file),
          })
        }
        continue
      }
      if (child.expression.type === 'StringLiteral' || child.expression.type === 'NumericLiteral') {
        children.push({ kind: 'text', value: String(child.expression.value), source: locationOf(child, ctx.file) })
        continue
      }
      report(
        ctx,
        child,
        'expression-not-allowed',
        'Expressions are not allowed as children; write literal text or another component.',
      )
      continue
    }
    report(ctx, child, 'expression-not-allowed', 'This child is not allowed in the design DSL.')
  }

  const id = typeof props.id === 'string' ? props.id : undefined
  return {
    kind: 'element',
    type: name.name,
    ...(id === undefined ? {} : { id }),
    props,
    children,
    source: locationOf(node, ctx.file),
    address,
    ...(Object.keys(propLocations).length === 0 ? {} : { propLocations }),
  }
}

/** Format a structural address path as `#0.2`. */
export function formatAddress(path: readonly number[]): string {
  return path.length === 0 ? '#' : `#${path.join('.')}`
}

/** Report a Babel recovery error as a diagnostic. */
function reportParseError(
  ctx: ParserContext,
  error: { loc?: { line: number; column: number }; message: string; reasonCode?: string },
): void {
  ctx.diagnostics.push({
    severity: 'error',
    code: 'syntax-error',
    file: ctx.file,
    line: error.loc?.line ?? 1,
    column: (error.loc?.column ?? 0) + 1,
    message: 'Syntax error: ' + error.message,
  })
}

/**
 * Parse one `.dsx` file into a design tree and diagnostics. Never evaluates
 * source. A file with syntax errors still yields whatever tree Babel recovered,
 * so the preview can show the last valid render beside the errors.
 * @param source - file text.
 * @param file - project-relative path used in diagnostics.
 */
export function parseScreen(source: string, file: string): ParsedScreen {
  const ctx: ParserContext = { file, diagnostics: [] }
  let program: Program | undefined
  let fileErrors: unknown[] | undefined
  try {
    const ast = babelParse(source, {
      sourceType: 'module',
      plugins: ['jsx'],
      errorRecovery: true,
      attachComment: false,
      tokens: false,
    })
    program = ast.program
    fileErrors = ast.errors ?? []
  } catch (error) {
    const caught = error as { loc?: { line: number; column: number }; message?: string }
    reportParseError(ctx, { loc: caught.loc, message: caught.message ?? 'Invalid syntax' })
    return { file, diagnostics: ctx.diagnostics }
  }
  for (const error of fileErrors ?? []) {
    reportParseError(ctx, error as unknown as { loc?: { line: number; column: number }; message: string })
  }

  const roots: JSXElement[] = []
  for (const statement of program.body) {
    if (statement.type === 'ExpressionStatement' && statement.expression.type === 'JSXElement') {
      roots.push(statement.expression)
      continue
    }
    if (
      statement.type === 'ImportDeclaration' ||
      statement.type === 'ExportNamedDeclaration' ||
      statement.type === 'ExportDefaultDeclaration' ||
      statement.type === 'ExportAllDeclaration'
    ) {
      report(
        ctx,
        statement,
        'import-not-allowed',
        'Imports and exports are not allowed; a screen file contains exactly one Screen element.',
      )
      continue
    }
    if (statement.type === 'EmptyStatement') continue
    report(
      ctx,
      statement,
      'statement-not-allowed',
      'Only a single Screen element is allowed in a screen file; JavaScript statements are rejected.',
    )
  }
  if (program.directives.length > 0) {
    report(
      ctx,
      program.directives[0] as unknown as Node,
      'statement-not-allowed',
      'Directives are not allowed in a screen file.',
    )
  }
  if (roots.length === 0) {
    if (ctx.diagnostics.length === 0) {
      report(ctx, program, 'missing-screen', 'A screen file must contain exactly one Screen root element.')
    }
    return { file, diagnostics: ctx.diagnostics }
  }
  if (roots.length > 1) {
    for (const extra of roots.slice(1)) {
      report(ctx, extra, 'multiple-screens', 'A screen file must contain exactly one Screen root element.')
    }
  }
  const rootNode = parseElement(ctx, roots[0] as JSXElement, { path: [], label: '#' })
  if (rootNode === undefined) return { file, diagnostics: ctx.diagnostics }
  if (rootNode.type === 'Variants') {
    // A whole-screen variant group wraps one Screen per branch. Its structure
    // is validated by the variant resolver before any kit rendering.
    return { file, document: rootNode, diagnostics: ctx.diagnostics }
  }
  if (rootNode.type !== 'Screen') {
    report(ctx, roots[0], 'missing-screen', `The root element must be <Screen>, not <${rootNode.type}>.`)
    return { file, diagnostics: ctx.diagnostics }
  }
  const root: DesignScreenNode = { ...rootNode, type: 'Screen', id: rootNode.id ?? '' }
  return {
    file,
    root,
    document: root,
    diagnostics: ctx.diagnostics,
  }
}
