/** Semantic validation of a parsed screen against kit metadata, tokens, and the project. */
import { nearest } from './diagnostics.ts'
import { parseCssDeclarations } from './css.ts'
import { isFixtureRef, isInteraction, isItemRef, isReference } from './refs.ts'
import { propsOf, type ComponentMeta, type KitMetadata, type PropMeta } from './metadata.ts'
import type {
  DesignChild,
  DesignElement,
  DesignScreenNode,
  Diagnostic,
  InteractionRef,
  ResolvedTokens,
} from './types.ts'

/** Everything semantic validation needs beyond the screen tree. */
export interface ValidationContext {
  readonly kit: KitMetadata
  readonly tokens: ResolvedTokens['tokens']
  readonly breakpoints: readonly string[]
  readonly projectScreens: readonly string[]
  readonly designFolder: string
  readonly kitVersionPin: string
  readonly installedKitVersion: string
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/
const LITERAL_PATTERNS: Readonly<Record<string, RegExp>> = {
  color: /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([^)]*\)|transparent|currentColor|var\(--[^)]+\)|[a-z]+)$/i,
  dimension: /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|pt|ch)$|^(?:0|auto|none)$/,
  duration: /^-?(?:\d+\.?\d*|\.\d+)(?:ms|s)$|^0$/,
  fontWeight: /^(normal|bold|bolder|lighter|[1-9]00)$/,
  number: /^-?\d+(?:\.\d+)?$/,
  shadow: /(?:^|\s)\d+(?:\.\d+)?(?:px|rem)/,
}

/** Re-exported for callers that classify parsed values. */
export { isInteraction }

/** Whether a value is a responsive object keyed by breakpoint. */
export function isResponsiveObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !isReference(value)
}

/** Whether a string is a plausible raw CSS literal rather than a token path. */
function looksLikeLiteral(prop: PropMeta, value: string): boolean {
  if (prop.kind === 'token' && prop.tokenType !== undefined) {
    const pattern = LITERAL_PATTERNS[prop.tokenType]
    if (pattern !== undefined && pattern.test(value.trim())) return true
  }
  if (!value.includes('.')) return true
  return /^[#\d]/.test(value) || /\(/.test(value)
}

/** Suggested token names of the matching type. */
function tokenCandidates(ctx: ValidationContext, prop: PropMeta): string[] {
  const type = prop.tokenType
  return Object.values(ctx.tokens)
    .filter((token) => type === undefined || token.type === type)
    .map((token) => token.path)
}

/** Add a node-scoped diagnostic. */
function push(
  diagnostics: Diagnostic[],
  node: DesignElement | DesignScreenNode,
  file: string,
  severity: 'error' | 'warning',
  code: string,
  message: string,
  suggestion?: string,
): void {
  diagnostics.push({
    severity,
    code,
    file,
    line: node.source.line,
    column: node.source.column,
    ...(node.id === undefined || node.id === '' ? {} : { nodeId: node.id }),
    address: node.address.label,
    message,
    ...(suggestion === undefined ? {} : { suggestion }),
  })
}

/** Validate one token-backed prop value. */
function validateTokenProp(
  diagnostics: Diagnostic[],
  node: DesignElement | DesignScreenNode,
  file: string,
  prop: PropMeta,
  value: unknown,
  ctx: ValidationContext,
): void {
  if (typeof value !== 'string') {
    push(diagnostics, node, file, 'error', 'prop-type', `Prop "${prop.name}" must be a token path string.`)
    return
  }
  const token = ctx.tokens[value]
  if (token !== undefined) {
    if (prop.tokenType !== undefined && token.type !== prop.tokenType) {
      push(
        diagnostics,
        node,
        file,
        'error',
        'token-type-mismatch',
        `Token "${value}" is ${token.type}, but prop "${prop.name}" requires a ${prop.tokenType} token.`,
        `Use one of: ${tokenCandidates(ctx, prop).slice(0, 8).join(', ')}`,
      )
    }
    return
  }
  if (looksLikeLiteral(prop, value)) {
    push(
      diagnostics,
      node,
      file,
      'warning',
      'off-token',
      `Off-token literal "${value}" on prop "${prop.name}"; the value is applied but bypasses the token set.`,
      'Replace the literal with a token path, or accept the warning.',
    )
    return
  }
  const candidates = tokenCandidates(ctx, prop)
  const suggestion = nearest(value, candidates)
  push(
    diagnostics,
    node,
    file,
    'error',
    'unknown-token',
    `Unknown token "${value}" on prop "${prop.name}"${prop.tokenType === undefined ? '' : ` (expected a ${prop.tokenType} token)`}.`,
    suggestion === undefined ? undefined : `Did you mean "${suggestion}"?`,
  )
}

/** Validate the `css` escape hatch: scoped declarations only. */
function validateCssProp(
  diagnostics: Diagnostic[],
  node: DesignElement | DesignScreenNode,
  file: string,
  value: unknown,
): void {
  if (typeof value !== 'string') {
    push(diagnostics, node, file, 'error', 'css-type', 'Prop "css" must be a CSS declaration string.')
    return
  }
  const parsed = parseCssDeclarations(value)
  for (const issue of parsed.issues) push(diagnostics, node, file, 'error', issue.code, issue.message)
  push(
    diagnostics,
    node,
    file,
    'warning',
    'raw-css',
    'Raw css prop used; the value is scoped to this node but bypasses tokens and responsive props.',
    'Prefer token-backed props; keep raw CSS as a visible escape hatch.',
  )
}

/** Validate an image source: local design-folder path or placeholder. */
function validateImageProp(
  diagnostics: Diagnostic[],
  node: DesignElement | DesignScreenNode,
  file: string,
  prop: PropMeta,
  value: unknown,
): void {
  if (typeof value !== 'string') {
    push(
      diagnostics,
      node,
      file,
      'error',
      'image-type',
      `Prop "${prop.name}" must be a local path string or placeholder.`,
    )
    return
  }
  if (value.startsWith('placeholder:')) return
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    push(
      diagnostics,
      node,
      file,
      'error',
      'image-remote',
      `Image source "${value}" is remote; the DSL allows only local files inside the design folder or a placeholder.`,
      'Copy the file into the design folder and use a relative path, or use "placeholder: description".',
    )
    return
  }
  if (value.startsWith('/')) {
    push(
      diagnostics,
      node,
      file,
      'error',
      'image-outside',
      `Image source "${value}" is an absolute path; use a path relative to the design folder.`,
    )
    return
  }
  const normalized = value.replace(/^\.\//, '')
  if (normalized.split('/').includes('..')) {
    push(diagnostics, node, file, 'error', 'image-outside', `Image source "${value}" escapes the design folder.`)
  }
}

/** Validate one value against a prop declaration. */
function validatePropValue(
  diagnostics: Diagnostic[],
  node: DesignElement | DesignScreenNode,
  file: string,
  prop: PropMeta,
  value: unknown,
  ctx: ValidationContext,
): void {
  if (isFixtureRef(value) || isItemRef(value)) {
    push(
      diagnostics,
      node,
      file,
      'error',
      'reference-unresolved',
      `Prop "${prop.name}" contains a ${isFixtureRef(value) ? 'fixture' : 'template'} reference that was not resolved before validation.`,
      'Fixtures are resolved on load; references are only valid in documented collection bindings.',
    )
    return
  }
  if (prop.kind === 'event') {
    if (!isInteraction(value)) {
      push(
        diagnostics,
        node,
        file,
        'error',
        'event-value',
        `Prop "${prop.name}" must be an interaction reference such as {open("filters")} or {navigate("checkout")}.`,
      )
      return
    }
    return
  }
  if (prop.kind === 'css') {
    validateCssProp(diagnostics, node, file, value)
    return
  }
  if (isResponsiveObject(value)) {
    if (prop.kind === 'object' || prop.kind === 'array') {
      // A genuine object/array value is not a responsive map.
      validateBaseValue(diagnostics, node, file, prop, value, ctx)
      return
    }
    for (const [key, entry] of Object.entries(value)) {
      if (!ctx.breakpoints.includes(key)) {
        push(
          diagnostics,
          node,
          file,
          'error',
          'breakpoint-unknown',
          `Responsive prop "${prop.name}" uses breakpoint "${key}", which is not configured.`,
          `Configured breakpoints: ${ctx.breakpoints.join(', ')}.`,
        )
        continue
      }
      if (isResponsiveObject(entry) && !isInteraction(entry)) {
        push(
          diagnostics,
          node,
          file,
          'error',
          'responsive-nested',
          `Responsive prop "${prop.name}" nests another responsive object under "${key}".`,
        )
        continue
      }
      validateBaseValue(diagnostics, node, file, prop, entry, ctx)
    }
    return
  }
  validateBaseValue(diagnostics, node, file, prop, value, ctx)
}

/** Validate a single (non-responsive) prop value. */
function validateBaseValue(
  diagnostics: Diagnostic[],
  node: DesignElement | DesignScreenNode,
  file: string,
  prop: PropMeta,
  value: unknown,
  ctx: ValidationContext,
): void {
  switch (prop.kind) {
    case 'string':
      if (typeof value !== 'string')
        push(diagnostics, node, file, 'error', 'prop-type', `Prop "${prop.name}" must be a string.`)
      return
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        push(diagnostics, node, file, 'error', 'prop-type', `Prop "${prop.name}" must be a number.`)
      }
      return
    case 'boolean':
      if (typeof value !== 'boolean')
        push(diagnostics, node, file, 'error', 'prop-type', `Prop "${prop.name}" must be true or false.`)
      return
    case 'enum': {
      if (typeof value !== 'string') {
        push(
          diagnostics,
          node,
          file,
          'error',
          'prop-type',
          `Prop "${prop.name}" must be one of: ${(prop.values ?? []).join(', ')}.`,
        )
        return
      }
      if (!(prop.values ?? []).includes(value)) {
        const suggestion = nearest(value, prop.values ?? [])
        push(
          diagnostics,
          node,
          file,
          'error',
          'prop-enum',
          `Prop "${prop.name}" does not accept "${value}".`,
          `Valid values: ${(prop.values ?? []).join(', ')}.${suggestion === undefined ? '' : ` Did you mean "${suggestion}"?`}`,
        )
      }
      return
    }
    case 'token':
      validateTokenProp(diagnostics, node, file, prop, value, ctx)
      return
    case 'image':
      validateImageProp(diagnostics, node, file, prop, value)
      return
    case 'array':
      if (!Array.isArray(value))
        push(diagnostics, node, file, 'error', 'prop-type', `Prop "${prop.name}" must be an array.`)
      return
    case 'object':
      if (!isResponsiveObject(value))
        push(diagnostics, node, file, 'error', 'prop-type', `Prop "${prop.name}" must be an object literal.`)
      return
    case 'event':
    case 'css':
      return
    default:
      return
  }
}

interface IdRecord {
  readonly node: DesignElement | DesignScreenNode
}

/** Validate one parsed screen tree. */
export function validateTree(root: DesignScreenNode, file: string, ctx: ValidationContext): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const ids = new Map<string, IdRecord>()
  const elements: (DesignElement | DesignScreenNode)[] = []
  const overlays = new Set<string>()
  const interactions: { node: DesignElement; prop: string; ref: InteractionRef }[] = []

  if (root.id === '' || typeof root.props.id !== 'string') {
    push(
      diagnostics,
      root,
      file,
      'error',
      'screen-id-required',
      'The Screen root requires an explicit id, for example <Screen id="orders" title="Orders">.',
    )
  } else {
    if (!ID_PATTERN.test(root.id)) {
      push(diagnostics, root, file, 'error', 'id-format', `Screen id "${root.id}" must match [a-z][a-z0-9-]*.`)
    }
    ids.set(root.id, { node: root })
  }

  const visit = (node: DesignElement | DesignScreenNode, path: string): void => {
    elements.push(node)
    if (node.kind === 'element' && node.type !== 'Screen') {
      const meta = ctx.kit[node.type]
      const componentName = node.type
      if (meta === undefined) {
        const suggestion = nearest(componentName, Object.keys(ctx.kit))
        push(
          diagnostics,
          node,
          file,
          'error',
          'unknown-component',
          `Unknown component <${componentName}>.`,
          suggestion === undefined ? undefined : `Did you mean <${suggestion}>?`,
        )
      } else {
        validateComponent(diagnostics, node, file, meta, ctx, ids, overlays, interactions)
      }
    } else if (node.type === 'Screen') {
      const meta = ctx.kit.Screen
      if (meta === undefined) {
        push(diagnostics, node, file, 'error', 'unknown-component', 'Kit metadata is missing the Screen component.')
      } else {
        validatePropsOnly(diagnostics, node, file, meta, ctx, interactions)
        validateChildren(diagnostics, node, file, meta, path)
      }
    }
    for (const child of node.children) {
      if (child.kind === 'element') visit(child, `${path}/${child.address.label}`)
    }
  }
  visit(root, 'root')

  // Duplicate ids, in source order.
  for (const [id, record] of ids) {
    const same = elements.filter((element) => element.id === id)
    if (same.length > 1) {
      for (const duplicate of same.slice(1)) {
        push(
          diagnostics,
          duplicate,
          file,
          'error',
          'duplicate-id',
          `Duplicate id "${id}"; first declared at line ${String(record.node.source.line)}.`,
          'Give every addressable node a unique id.',
        )
      }
    }
  }

  for (const interaction of interactions) {
    const { ref } = interaction
    if (ref.$interaction === 'navigate') {
      if (!ctx.projectScreens.includes(ref.target)) {
        const suggestion = nearest(ref.target, [...ctx.projectScreens])
        push(
          diagnostics,
          interaction.node,
          file,
          'error',
          'interaction-target-missing',
          `navigate("${ref.target}") targets a screen that does not exist in this project.`,
          suggestion === undefined
            ? `Known screens: ${ctx.projectScreens.join(', ')}.`
            : `Did you mean "${suggestion}"?`,
        )
      }
      continue
    }
    const target = elements.find((element) => element.id === ref.target)
    if (target === undefined) {
      push(
        diagnostics,
        interaction.node,
        file,
        'error',
        'interaction-target-missing',
        `${ref.$interaction}("${ref.target}") targets a node that does not exist in this screen.`,
        `Overlays in this screen: ${[...overlays].join(', ') || 'none'}.`,
      )
      continue
    }
    if (!overlays.has(ref.target)) {
      push(
        diagnostics,
        interaction.node,
        file,
        'error',
        'interaction-target-not-overlay',
        `${ref.$interaction}("${ref.target}") targets <${(target as DesignElement).type}>, which is not an overlay.`,
        'Only Drawer, Modal, Popover, Menu, and Toast can be opened, closed, or toggled.',
      )
    }
  }
  return diagnostics
}

/** Validate the props of one component. */
function validateComponent(
  diagnostics: Diagnostic[],
  node: DesignElement,
  file: string,
  meta: ComponentMeta,
  ctx: ValidationContext,
  ids: Map<string, IdRecord>,
  overlays: Set<string>,
  interactions: { node: DesignElement; prop: string; ref: InteractionRef }[],
): void {
  if (meta.requiredId || meta.interactive || meta.overlay) {
    if (node.id === undefined) {
      push(
        diagnostics,
        node,
        file,
        'error',
        'id-required',
        `<${meta.name}> requires an explicit id because it is ${meta.overlay ? 'an overlay' : 'interactive'}.`,
        `Add id="${meta.name.toLowerCase()}-1" with a stable, unique value.`,
      )
    }
  }
  if (node.id !== undefined) {
    if (node.id === '') {
      push(diagnostics, node, file, 'error', 'id-required', `<${meta.name}> has an empty id.`)
    } else if (!ID_PATTERN.test(node.id)) {
      push(diagnostics, node, file, 'error', 'id-format', `Id "${node.id}" must match [a-z][a-z0-9-]*.`)
    } else {
      ids.set(node.id, { node })
      if (meta.overlay) overlays.add(node.id)
    }
  }
  validatePropsOnly(diagnostics, node, file, meta, ctx, interactions)
  validateChildren(diagnostics, node, file, meta, node.address.label)
}

/** Validate props, including unknown props and interaction parsing. */
function validatePropsOnly(
  diagnostics: Diagnostic[],
  node: DesignElement | DesignScreenNode,
  file: string,
  meta: ComponentMeta,
  ctx: ValidationContext,
  interactions: { node: DesignElement; prop: string; ref: InteractionRef }[],
): void {
  const declared = new Map(propsOf(meta).map((prop) => [prop.name, prop]))
  for (const [name, value] of Object.entries(node.props)) {
    const prop = declared.get(name)
    if (prop === undefined) {
      const suggestion = nearest(name, [...declared.keys()])
      push(
        diagnostics,
        node,
        file,
        'error',
        'unknown-prop',
        `<${meta.name}> does not declare prop "${name}".`,
        suggestion === undefined
          ? `Declared props: ${[...declared.keys()].join(', ')}.`
          : `Did you mean "${suggestion}"?`,
      )
      continue
    }
    validatePropValue(diagnostics, node, file, prop, value, ctx)
    if (prop.kind === 'event' && isInteraction(value)) {
      interactions.push({ node: node as DesignElement, prop: name, ref: value })
    }
  }
  for (const prop of propsOf(meta)) {
    if (prop.required === true && node.props[prop.name] === undefined && prop.name !== 'id') {
      push(diagnostics, node, file, 'error', 'prop-required', `<${meta.name}> requires prop "${prop.name}".`)
    }
  }
}

/** Enforce the component's children rule. */
function validateChildren(
  diagnostics: Diagnostic[],
  node: DesignElement | DesignScreenNode,
  file: string,
  meta: ComponentMeta,
  path: string,
): void {
  for (const child of node.children as readonly DesignChild[]) {
    if (child.kind === 'text') {
      if (meta.children === 'none' || meta.children === 'elements') {
        push(
          diagnostics,
          node,
          file,
          'error',
          'children-not-allowed',
          `<${meta.name}> does not accept text children; ${meta.children === 'none' ? 'it accepts none' : 'wrap the text in <Text>'}.`,
          meta.children === 'elements' ? 'Wrap the text in <Text>.' : undefined,
        )
      }
      continue
    }
    if (meta.children === 'none') {
      push(diagnostics, node, file, 'error', 'children-not-allowed', `<${meta.name}> does not accept child elements.`)
      continue
    }
    if (meta.children === 'text') {
      push(
        diagnostics,
        node,
        file,
        'error',
        'children-not-allowed',
        `<${meta.name}> accepts text children only, not <${child.type}>.`,
        `Move the child out of <${meta.name}>.`,
      )
    }
  }
  if (node.type === 'Screen' && node.children.some((child) => child.kind === 'text' && child.value.trim() !== '')) {
    push(diagnostics, node, file, 'error', 'children-not-allowed', 'The Screen root accepts only element children.')
  }
  void path
}
