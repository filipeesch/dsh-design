/**
 * Declarative user journeys: one restricted JSX `Journey` per file in
 * `journeys/`, with typed actions and assertions resolved by stable design id.
 *
 * Nothing is evaluated. Journey files are data consumed by the headless
 * renderer, never browser programs.
 */
import { parse as babelParse } from '@babel/parser'
import type { JSXAttribute, JSXElement, JSXExpressionContainer, Node, Program } from '@babel/types'
import { declaredOption } from './kit-controls.ts'
import { findNode } from './view.ts'
import type { DesignScreenNode, Diagnostic, JourneyStep, NamedState, ParsedJourney, SourceLocation } from './types.ts'

/** Maximum journey files in one project. */
export const MAX_JOURNEYS = 32
/** Maximum steps in one journey. */
export const MAX_JOURNEY_STEPS = 100

const ID_PATTERN = /^[a-z][a-z0-9-]*$/

const STEP_NAMES = new Set([
  'Tap',
  'Type',
  'Choose',
  'Navigate',
  'ExpectScreen',
  'ExpectVisible',
  'ExpectValue',
  'ExpectCount',
])

/** Element types accepted by each step kind. */
const TYPE_TARGETS = new Set(['Input', 'TextArea', 'Combobox'])
const CHOOSE_TARGETS = new Set(['Select', 'MultiSelect', 'Combobox', 'Radio', 'SelectButton'])

interface ParseContext {
  readonly file: string
  readonly diagnostics: Diagnostic[]
}

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

function report(
  ctx: ParseContext,
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

/** Read one JSX attribute as a literal: string, number, boolean, or negative number. */
function literalAttribute(ctx: ParseContext, attribute: JSXAttribute): string | number | boolean | undefined {
  const value = attribute.value
  if (value === null || value === undefined) {
    report(
      ctx,
      attribute,
      'journey-attribute',
      `Attribute "${attribute.name.name}" requires an explicit literal value.`,
    )
    return undefined
  }
  if (value.type === 'StringLiteral') return value.value
  if (value.type !== 'JSXExpressionContainer') {
    report(ctx, attribute, 'journey-attribute', `Attribute "${attribute.name.name}" must use a literal value.`)
    return undefined
  }
  return literalExpression(ctx, attribute, value)
}

function literalExpression(
  ctx: ParseContext,
  attribute: JSXAttribute,
  container: JSXExpressionContainer,
): string | number | boolean | undefined {
  const expression = container.expression
  if (expression.type === 'StringLiteral') return expression.value
  if (expression.type === 'NumericLiteral') return expression.value
  if (expression.type === 'BooleanLiteral') return expression.value
  if (
    expression.type === 'UnaryExpression' &&
    expression.operator === '-' &&
    expression.argument.type === 'NumericLiteral'
  ) {
    return -expression.argument.value
  }
  report(
    ctx,
    container,
    'journey-expression',
    `Journey values must be literals; ${expression.type} is not accepted or executed.`,
  )
  void attribute
  return undefined
}

/** Read the string attributes of one step, rejecting unknown names. */
function stepAttributes(
  ctx: ParseContext,
  element: JSXElement,
  allowed: readonly string[],
): Record<string, string | number | boolean> | undefined {
  const values: Record<string, string | number | boolean> = {}
  let valid = true
  for (const attribute of element.openingElement.attributes) {
    if (attribute.type === 'JSXSpreadAttribute') {
      report(ctx, attribute, 'journey-spread', 'Spread attributes are not allowed in a journey.')
      valid = false
      continue
    }
    const name = attribute.name.type === 'JSXIdentifier' ? attribute.name.name : attribute.name.name.name
    if (!allowed.includes(name)) {
      report(
        ctx,
        attribute,
        'journey-attribute-unknown',
        `<${elementName(element)}> does not accept attribute "${name}".`,
        'Allowed: ' + allowed.join(', ') + '.',
      )
      valid = false
      continue
    }
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      report(ctx, attribute, 'journey-attribute-duplicate', `<${elementName(element)}> repeats attribute "${name}".`)
      valid = false
      continue
    }
    const value = literalAttribute(ctx, attribute)
    if (value !== undefined) values[name] = value
    else valid = false
  }
  return valid ? values : undefined
}

function elementName(element: JSXElement): string {
  const name = element.openingElement.name
  return name.type === 'JSXIdentifier' ? name.name : 'Element'
}

/** Convert one step element into a typed journey step. */
function parseStep(ctx: ParseContext, element: JSXElement): JourneyStep | undefined {
  const name = elementName(element)
  if (!STEP_NAMES.has(name)) {
    report(
      ctx,
      element,
      'journey-step-unknown',
      `Unknown journey step <${name}>.`,
      'Use Tap, Type, Choose, Navigate, ExpectScreen, ExpectVisible, ExpectValue, or ExpectCount.',
    )
    return undefined
  }
  for (const child of element.children) {
    if (child.type === 'JSXText' && child.value.trim() === '') continue
    report(ctx, child as Node, 'journey-step-children', `<${name}> accepts attributes only, not children.`)
  }
  const source = locationOf(element, ctx.file)
  switch (name) {
    case 'Tap': {
      const values = stepAttributes(ctx, element, ['target', 'part'])
      if (values === undefined) return undefined
      if (typeof values.target !== 'string' || values.target === '') {
        report(ctx, element, 'journey-argument', '<Tap> requires a string target id.')
        return undefined
      }
      const part = values.part
      if (part !== undefined && part !== 'primary' && part !== 'menu') {
        report(ctx, element, 'journey-argument', '<Tap> part must be "primary" or "menu" when present.')
        return undefined
      }
      return { kind: 'tap', target: values.target, ...(part === undefined ? {} : { part }), source }
    }
    case 'Type': {
      const values = stepAttributes(ctx, element, ['target', 'value'])
      if (values === undefined) return undefined
      if (typeof values.target !== 'string' || values.target === '') {
        report(ctx, element, 'journey-argument', '<Type> requires a string target id.')
        return undefined
      }
      if (typeof values.value !== 'string') {
        report(ctx, element, 'journey-argument', '<Type> requires a string value.')
        return undefined
      }
      return { kind: 'type', target: values.target, value: values.value, source }
    }
    case 'Choose': {
      const values = stepAttributes(ctx, element, ['target', 'value', 'part'])
      if (values === undefined) return undefined
      if (typeof values.target !== 'string' || values.target === '') {
        report(ctx, element, 'journey-argument', '<Choose> requires a string target id.')
        return undefined
      }
      if (typeof values.value !== 'string' && typeof values.value !== 'number' && typeof values.value !== 'boolean') {
        report(ctx, element, 'journey-argument', '<Choose> requires a string, number, or boolean value.')
        return undefined
      }
      const part = values.part
      if (part !== undefined && part !== 'menu') {
        report(ctx, element, 'journey-argument', '<Choose> part must be "menu" when present.')
        return undefined
      }
      if (part === 'menu' && (typeof values.value !== 'string' || !ID_PATTERN.test(values.value))) {
        report(ctx, element, 'journey-argument', '<Choose part="menu"> requires a stable option value.')
        return undefined
      }
      return {
        kind: 'choose',
        target: values.target,
        value: String(values.value),
        ...(part === undefined ? {} : { part }),
        source,
      }
    }
    case 'Navigate': {
      const values = stepAttributes(ctx, element, ['screen'])
      if (values === undefined) return undefined
      if (typeof values.screen !== 'string' || values.screen === '') {
        report(ctx, element, 'journey-argument', '<Navigate> requires a string screen id.')
        return undefined
      }
      return { kind: 'navigate', screen: values.screen, source }
    }
    case 'ExpectScreen': {
      const values = stepAttributes(ctx, element, ['screen'])
      if (values === undefined) return undefined
      if (typeof values.screen !== 'string' || values.screen === '') {
        report(ctx, element, 'journey-argument', '<ExpectScreen> requires a string screen id.')
        return undefined
      }
      return { kind: 'expect-screen', screen: values.screen, source }
    }
    case 'ExpectVisible': {
      const values = stepAttributes(ctx, element, ['target', 'visible'])
      if (values === undefined) return undefined
      if (typeof values.target !== 'string' || values.target === '') {
        report(ctx, element, 'journey-argument', '<ExpectVisible> requires a string target id.')
        return undefined
      }
      if (typeof values.visible !== 'boolean') {
        report(ctx, element, 'journey-argument', '<ExpectVisible> requires the boolean attribute "visible".')
        return undefined
      }
      return { kind: 'expect-visible', target: values.target, visible: values.visible, source }
    }
    case 'ExpectValue': {
      const values = stepAttributes(ctx, element, ['target', 'value'])
      if (values === undefined) return undefined
      if (typeof values.target !== 'string' || values.target === '') {
        report(ctx, element, 'journey-argument', '<ExpectValue> requires a string target id.')
        return undefined
      }
      if (values.value === undefined) {
        report(ctx, element, 'journey-argument', '<ExpectValue> requires a value.')
        return undefined
      }
      return { kind: 'expect-value', target: values.target, value: String(values.value), source }
    }
    default: {
      const values = stepAttributes(ctx, element, ['target', 'count'])
      if (values === undefined) return undefined
      if (typeof values.target !== 'string' || values.target === '') {
        report(ctx, element, 'journey-argument', '<ExpectCount> requires a string target id.')
        return undefined
      }
      if (typeof values.count !== 'number' || !Number.isInteger(values.count) || values.count < 0) {
        report(ctx, element, 'journey-argument', '<ExpectCount> requires a non-negative integer count.')
        return undefined
      }
      return { kind: 'expect-count', target: values.target, count: values.count, source }
    }
  }
}

/** Read the journey root attributes. */
function parseRootAttributes(
  ctx: ParseContext,
  element: JSXElement,
): { id: string; start: string; state?: string; breakpoint?: string; theme?: string } | undefined {
  const values = stepAttributes(ctx, element, ['id', 'start', 'state', 'breakpoint', 'theme'])
  if (values === undefined) return undefined
  if (typeof values.id !== 'string' || !ID_PATTERN.test(values.id)) {
    report(ctx, element, 'journey-id', '<Journey> requires an id matching [a-z][a-z0-9-]*.')
    return undefined
  }
  if (typeof values.start !== 'string' || values.start === '') {
    report(ctx, element, 'journey-start', '<Journey> requires a string start screen id.')
    return undefined
  }
  if (values.state !== undefined && typeof values.state !== 'string') {
    report(ctx, element, 'journey-state', '<Journey> state must be a string when present.')
    return undefined
  }
  if (values.breakpoint !== undefined && typeof values.breakpoint !== 'string') {
    report(ctx, element, 'journey-breakpoint', '<Journey> breakpoint must be a string when present.')
    return undefined
  }
  if (values.theme !== undefined && (typeof values.theme !== 'string' || !ID_PATTERN.test(values.theme))) {
    report(ctx, element, 'journey-theme', '<Journey> theme must be a literal theme name when present.')
    return undefined
  }
  return {
    id: values.id,
    start: values.start,
    ...(values.theme === undefined ? {} : { theme: values.theme }),
    ...(values.state === undefined ? {} : { state: values.state as string }),
    ...(values.breakpoint === undefined ? {} : { breakpoint: values.breakpoint as string }),
  }
}

/**
 * Parse one journey file.
 * @param source - file text.
 * @param file - project-relative path used in diagnostics.
 */
export function parseJourney(source: string, file: string): ParsedJourney {
  const ctx: ParseContext = { file, diagnostics: [] }
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
    ctx.diagnostics.push({
      severity: 'error',
      code: 'journey-syntax',
      file,
      line: caught.loc?.line ?? 1,
      column: (caught.loc?.column ?? 0) + 1,
      message: 'Syntax error: ' + (caught.message ?? 'Invalid syntax'),
    })
    return { file, diagnostics: ctx.diagnostics }
  }
  for (const error of fileErrors ?? []) {
    const caught = error as { loc?: { line: number; column: number }; message?: string }
    ctx.diagnostics.push({
      severity: 'error',
      code: 'journey-syntax',
      file,
      line: caught.loc?.line ?? 1,
      column: (caught.loc?.column ?? 0) + 1,
      message: 'Syntax error: ' + (caught.message ?? 'Invalid syntax'),
    })
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
        'journey-import',
        'Imports and exports are not allowed; a journey file contains exactly one Journey element.',
      )
      continue
    }
    if (statement.type === 'EmptyStatement') continue
    report(ctx, statement, 'journey-statement', 'Only a single Journey element is allowed in a journey file.')
  }
  if (roots.length === 0) {
    if (ctx.diagnostics.length === 0)
      report(ctx, program, 'journey-root', 'A journey file must contain exactly one <Journey> root element.')
    return { file, diagnostics: ctx.diagnostics }
  }
  if (roots.length > 1) {
    for (const extra of roots.slice(1))
      report(ctx, extra, 'journey-multiple', 'A journey file must contain exactly one <Journey> root element.')
  }
  const root = roots[0] as JSXElement
  if (elementName(root) !== 'Journey') {
    report(ctx, root, 'journey-root', `The root element must be <Journey>, not <${elementName(root)}>.`)
    return { file, diagnostics: ctx.diagnostics }
  }
  const attributes = parseRootAttributes(ctx, root)
  if (attributes === undefined) return { file, diagnostics: ctx.diagnostics }
  const steps: JourneyStep[] = []
  for (const child of root.children) {
    if (child.type === 'JSXText' && child.value.trim() === '') continue
    if (child.type === 'JSXElement') {
      const step = parseStep(ctx, child)
      if (step !== undefined) steps.push(step)
      continue
    }
    report(ctx, child as Node, 'journey-child', 'Journey children must be step elements.')
  }
  if (steps.length > MAX_JOURNEY_STEPS) {
    report(
      ctx,
      root,
      'journey-step-limit',
      `Journey "${attributes.id}" has ${String(steps.length)} steps; the limit is ${String(MAX_JOURNEY_STEPS)}.`,
    )
  }
  return {
    file,
    journey: {
      ...attributes,
      steps: steps.slice(0, MAX_JOURNEY_STEPS),
      source: locationOf(root, file),
    },
    diagnostics: ctx.diagnostics,
  }
}

/** Everything journey validation needs from the loaded project. */
export interface JourneyValidationContext {
  readonly projectScreens: readonly string[]
  readonly breakpoints: readonly string[]
  readonly themes?: readonly string[]
  readonly rootOf: (screen: string) => DesignScreenNode | undefined
  readonly statesOf: (screen: string) => readonly NamedState[]
}

function push(
  diagnostics: Diagnostic[],
  file: string,
  source: SourceLocation,
  code: string,
  message: string,
  suggestion?: string,
): void {
  diagnostics.push({
    severity: 'error',
    code,
    file,
    line: source.line,
    column: source.column,
    message,
    ...(suggestion === undefined ? {} : { suggestion }),
  })
}

/** Validate one parsed journey against the loaded project. */
export function validateJourney(parsed: ParsedJourney, ctx: JourneyValidationContext): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const journey = parsed.journey
  if (journey === undefined) return diagnostics
  if (!ctx.projectScreens.includes(journey.start)) {
    push(
      diagnostics,
      parsed.file,
      journey.source,
      'journey-start-missing',
      `Journey "${journey.id}" starts on screen "${journey.start}", which does not exist.`,
      'Known screens: ' + (ctx.projectScreens.join(', ') || 'none') + '.',
    )
    return diagnostics
  }
  if (journey.state !== undefined) {
    const states = ctx.statesOf(journey.start)
    if (!states.some((state) => state.name === journey.state)) {
      push(
        diagnostics,
        parsed.file,
        journey.source,
        'journey-state-missing',
        `Journey "${journey.id}" starts in state "${journey.state}", which screen "${journey.start}" does not declare.`,
        states.length === 0
          ? 'Declare states on the Screen root first.'
          : 'Declared states: ' + states.map((state) => state.name).join(', ') + '.',
      )
    }
  }
  if (journey.breakpoint !== undefined && !ctx.breakpoints.includes(journey.breakpoint)) {
    push(
      diagnostics,
      parsed.file,
      journey.source,
      'journey-breakpoint-missing',
      `Journey "${journey.id}" uses breakpoint "${journey.breakpoint}", which is not configured.`,
      'Configured breakpoints: ' + ctx.breakpoints.join(', ') + '.',
    )
  }

  const themes = ctx.themes ?? ['base']
  if (journey.theme !== undefined && !themes.includes(journey.theme)) {
    push(
      diagnostics,
      parsed.file,
      journey.source,
      'journey-theme-missing',
      `Journey "${journey.id}" uses theme "${journey.theme}", which is not available.`,
      'Available themes: ' + themes.join(', ') + '.',
    )
  }

  let current = journey.start
  let root = ctx.rootOf(current)
  const requireTarget = (
    target: string,
    source: SourceLocation,
    allow: readonly string[] | undefined,
    purpose: string,
    index: number,
  ): ReturnType<typeof findNode> => {
    if (root === undefined) return
    const node = findNode(root, target)
    if (node === undefined) {
      push(
        diagnostics,
        parsed.file,
        source,
        'journey-target-missing',
        `Journey "${journey.id}" step ${String(index + 1)} ${purpose} target "${target}", which does not exist on screen "${current}".`,
      )
      return
    }
    if (allow !== undefined && !allow.includes(node.type)) {
      push(
        diagnostics,
        parsed.file,
        source,
        'journey-target-type',
        `Journey "${journey.id}" step ${String(index + 1)} ${purpose} "<${node.type}> ${target}", which is not a compatible control.`,
        'Use one of: ' + allow.join(', ') + '.',
      )
      return undefined
    }
    return node
  }

  for (const [index, step] of journey.steps.entries()) {
    switch (step.kind) {
      case 'navigate':
      case 'expect-screen': {
        const screen = step.screen
        if (!ctx.projectScreens.includes(screen)) {
          push(
            diagnostics,
            parsed.file,
            step.source,
            'journey-screen-missing',
            `Journey "${journey.id}" refers to screen "${screen}", which does not exist.`,
            'Known screens: ' + (ctx.projectScreens.join(', ') || 'none') + '.',
          )
          continue
        }
        current = screen
        root = ctx.rootOf(current)
        break
      }
      case 'tap': {
        const node = requireTarget(
          step.target,
          step.source,
          step.part === undefined ? undefined : ['SplitButton'],
          'taps',
          index,
        )
        if (node?.type === 'SplitButton' && step.part === undefined) {
          push(
            diagnostics,
            parsed.file,
            step.source,
            'journey-target-part',
            `Step ${String(index + 1)} taps SplitButton "${step.target}"; specify part="primary" or part="menu".`,
          )
        }
        break
      }
      case 'type':
        requireTarget(step.target, step.source, [...TYPE_TARGETS], 'types into', index)
        break
      case 'choose': {
        const allowed = step.part === 'menu' ? ['SplitButton'] : [...CHOOSE_TARGETS]
        const node = requireTarget(step.target, step.source, allowed, 'chooses in', index)
        if (node?.type === 'SelectButton' || node?.type === 'SplitButton') {
          const option = declaredOption(node.props.options, step.value)
          if (option === undefined) {
            push(
              diagnostics,
              parsed.file,
              step.source,
              'journey-option-missing',
              `Step ${String(index + 1)} chooses option "${step.value}" on "${step.target}", which does not declare it.`,
            )
          }
        }
        break
      }
      case 'expect-visible':
        requireTarget(step.target, step.source, undefined, 'looks for', index)
        break
      case 'expect-value':
        requireTarget(step.target, step.source, undefined, 'checks the value of', index)
        break
      case 'expect-count':
        requireTarget(step.target, step.source, undefined, 'counts', index)
        break
    }
  }
  return diagnostics
}
