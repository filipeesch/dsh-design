/** Restrict shared styles to bounded, typed declarations for opted-in roots. */
import type { CssDeclaration } from './css.ts'
import type { SourceInventory } from './sources.ts'
import type { DesignElement, DesignScreenNode, Diagnostic, ResolvedTokens, SourceLocation } from './types.ts'

export type CssBlock = readonly CssDeclaration[]
const CLASS = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const MAX_RULES = 128
const MAX_DECLARATIONS = 24
const MAX_NODE_DECLARATIONS = 96
const COLORS = new Set('color background-color border-color outline-color text-decoration-color'.split(' '))
const LENGTHS = new Set(
  (
    'width height min-width min-height max-width max-height flex-basis gap row-gap column-gap ' +
    'padding padding-top padding-bottom padding-left padding-right padding-inline padding-block margin margin-top margin-bottom ' +
    'margin-left margin-right margin-inline margin-block border-width border-radius outline-width font-size line-height letter-spacing'
  ).split(' '),
)
const ENUMS = new Map(
  Object.entries({
    display: 'block inline inline-block flex inline-flex grid inline-grid none',
    'flex-direction': 'row row-reverse column column-reverse',
    'flex-wrap': 'nowrap wrap wrap-reverse',
    'align-items': 'normal stretch start end center flex-start flex-end baseline',
    'align-self': 'auto normal stretch start end center flex-start flex-end baseline',
    'justify-content': 'normal start end center flex-start flex-end space-between space-around space-evenly',
    'text-align': 'start end left right center justify',
    'font-style': 'normal italic oblique',
    'white-space': 'normal nowrap pre pre-wrap pre-line break-spaces',
    'overflow-wrap': 'normal break-word anywhere',
    'text-overflow': 'clip ellipsis',
    overflow: 'visible hidden clip auto scroll',
    'border-style': 'none solid dashed dotted double',
    'box-sizing': 'border-box content-box',
  }),
)
const DIMENSION = /^-?(?:[0-9]{1,5}(?:\.[0-9]{1,4})?|\.[0-9]{1,4})(?:px|rem|em|%|vh|vw|vmin|vmax|ch|pt)$/i
const COLOR = /^(?:#[a-f0-9]{3,8}|[a-z]{1,32}|(?:rgb|rgba|hsl|hsla)\([0-9.,%/ +-]+\))$/i

function allowed(property: string, value: string, variables: ReadonlyMap<string, string>): boolean {
  const variable = /^var\((--dsx-[a-zA-Z0-9-]+)\)$/.exec(value)
  const type = variable === null ? undefined : variables.get(variable[1]!)
  if (COLORS.has(property)) return variable === null ? COLOR.test(value) : type === 'color'
  if (LENGTHS.has(property)) {
    if (variable !== null) return type === 'dimension' || (property === 'line-height' && type === 'number')
    const parts = value.split(/\s+/)
    return (
      parts.length <= 4 &&
      parts.every(
        (part) =>
          ['0', 'auto', 'none', 'min-content', 'max-content', 'fit-content', 'normal'].includes(part) ||
          DIMENSION.test(part) ||
          (property === 'line-height' && /^[0-9](?:\.[0-9]+)?$/.test(part)),
      )
    )
  }
  if (property === 'font-weight')
    return variable === null ? /^(?:normal|bold|bolder|lighter|[1-9]00)$/.test(value) : type === 'fontWeight'
  if (property === 'font-family')
    return variable === null
      ? /^[A-Za-z][A-Za-z0-9 -]*(?:,\s*[A-Za-z][A-Za-z0-9 -]*)*$/.test(value)
      : type === 'fontFamily'
  if (['opacity', 'flex-grow', 'flex-shrink'].includes(property))
    return variable === null
      ? /^\d{1,2}(?:\.\d{1,4})?$/.test(value) && (property !== 'opacity' || Number(value) <= 1)
      : type === 'number'
  if (property === 'box-shadow') return variable === null ? value === 'none' : type === 'shadow'
  return ENUMS.get(property)?.split(' ').includes(value) === true
}

interface Rule {
  readonly name: string
  readonly declarations: CssBlock
}
function diagnostic(source: SourceLocation, code: string, message: string): Diagnostic {
  return { file: source.file, line: source.line, column: source.column, severity: 'error', code, message }
}

export function parseStylesheet(source: string, file: string, tokens: ResolvedTokens) {
  const diagnostics: Diagnostic[] = []
  const rules: Rule[] = []
  const variables = new Map(Object.values(tokens.tokens).map((token) => [token.cssVar, token.type]))
  const issue = (at: number, code: string, message: string): void => {
    if (diagnostics.length >= 32) return
    const prefix = source.slice(0, at)
    diagnostics.push(
      diagnostic({ file, line: prefix.split('\n').length, column: at - prefix.lastIndexOf('\n') }, code, message),
    )
  }
  const input = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
  const unsafe = /[@\\<>!]|\b(?:url|expression|image-set)\s*\(/i.exec(input)
  const control = [...input].findIndex((character) => {
    const code = character.charCodeAt(0)
    return (code < 32 && character !== '\t' && character !== '\n' && character !== '\r') || code === 127
  })
  if (unsafe !== null || control !== -1 || input.includes('/*')) {
    issue(
      unsafe?.index ?? (control !== -1 ? control : input.indexOf('/*')),
      'stylesheet-unsafe',
      'Stylesheets do not allow at-rules, resources, escapes, markup, !important, or unclosed comments.',
    )
    return { rules, diagnostics }
  }
  let offset = 0
  while (offset < input.length) {
    offset += /^\s*/.exec(input.slice(offset))![0].length
    if (offset >= input.length) break
    const block = /^\.([A-Za-z][A-Za-z0-9_-]{0,63})\s*\{([^{}]*)\}/.exec(input.slice(offset))
    if (block === null) {
      issue(
        offset,
        'stylesheet-selector',
        'Each stylesheet rule must be a single simple class followed by a declaration block.',
      )
      break
    }
    if (rules.length >= MAX_RULES) {
      issue(offset, 'stylesheet-limit', 'A stylesheet allows at most ' + MAX_RULES + ' rules.')
      break
    }
    const declarations: CssDeclaration[] = []
    let at = offset + block[0].indexOf('{') + 1
    let count = 0
    for (const part of block[2]!.split(';')) {
      const start = at + /^\s*/.exec(part)![0].length
      at += part.length + 1
      if (part.trim() === '') continue
      if (++count > MAX_DECLARATIONS) {
        issue(start, 'stylesheet-limit', 'A rule allows at most ' + MAX_DECLARATIONS + ' declarations.')
        break
      }
      const colon = part.indexOf(':')
      const property = part.slice(0, colon).trim().toLowerCase()
      const value = part
        .slice(colon + 1)
        .trim()
        .replace(/\s+/g, ' ')
      if (colon < 0 || value.length > 160 || !allowed(property, value, variables)) {
        issue(
          start,
          'stylesheet-declaration',
          'Unsupported stylesheet declaration for "' + property.slice(0, 64) + '" or unknown typed token variable.',
        )
      } else declarations.push({ property, value })
    }
    rules.push({ name: block[1]!, declarations })
    offset += block[0].length
  }
  return { rules: diagnostics.length === 0 ? rules : [], diagnostics }
}

export function loadStylesheets(inventory: SourceInventory, tokens: ResolvedTokens) {
  const diagnostics: Diagnostic[] = []
  const unusable: Diagnostic[] = []
  const rules: Rule[] = []
  for (const file of inventory.config.config.stylesheets ?? []) {
    const entry = inventory.entries.get(file)
    if (entry?.source === undefined) {
      if (entry?.issue !== undefined) unusable.push(entry.issue)
      continue
    }
    const parsed = parseStylesheet(entry.source, file, tokens)
    diagnostics.push(...parsed.diagnostics)
    unusable.push(...parsed.diagnostics)
    rules.push(...parsed.rules)
  }
  for (const entry of inventory.config.diagnostics) {
    if (entry.code.startsWith('config-stylesheet') && entry.severity === 'error') unusable.push(entry)
  }
  return { rules, diagnostics, unusable, names: new Set(rules.map((rule) => rule.name)) }
}

export type StylesheetCatalog = ReturnType<typeof loadStylesheets>

export function applyStyleClasses(root: DesignScreenNode, styles: StylesheetCatalog) {
  const diagnostics: Diagnostic[] = []
  let blockedByStylesheet = false
  function visit<T extends DesignElement>(node: T): T {
    const children = node.children.map((child) => (child.kind === 'text' ? child : visit(child)))
    if (!Object.hasOwn(node.props, 'styleClass')) return { ...node, children }
    const value = node.props.styleClass
    const source = node.propLocations?.styleClass ?? node.source
    const classes = typeof value === 'string' && value.length <= 520 ? value.trim().split(/\s+/) : []
    if (classes.length === 0 || classes.length > 8 || classes.some((name) => !CLASS.test(name))) {
      diagnostics.push(
        diagnostic(
          source,
          'style-class-value',
          'styleClass must be a literal string of one to eight simple class names.',
        ),
      )
      return { ...node, children }
    }
    if (styles.unusable.length > 0 && !blockedByStylesheet) {
      diagnostics.push(...styles.unusable)
      blockedByStylesheet = true
    }
    const requested = new Set(classes)
    for (const name of requested) {
      if (!styles.names.has(name))
        diagnostics.push(diagnostic(source, 'style-class-unknown', 'Unknown stylesheet class "' + name + '".'))
    }
    if (blockedByStylesheet) return { ...node, children }
    const declarations: CssDeclaration[] = []
    for (const rule of styles.rules) {
      if (!requested.has(rule.name)) continue
      if (declarations.length + rule.declarations.length > MAX_NODE_DECLARATIONS) {
        diagnostics.push(
          diagnostic(
            source,
            'style-class-limit',
            'The selected classes exceed ' + MAX_NODE_DECLARATIONS + ' declarations on this node.',
          ),
        )
        return { ...node, children }
      }
      declarations.push(...rule.declarations)
    }
    return { ...node, children, ...(declarations.length === 0 ? {} : { classCss: declarations }) }
  }
  return { root: visit(root), diagnostics }
}
