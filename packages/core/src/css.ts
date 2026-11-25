/** Shared parser for the node-scoped `css` escape hatch. */
import type { DesignElement } from './types.ts'

/** One validated CSS declaration. */
export interface CssDeclaration {
  readonly property: string
  readonly value: string
}

/** One rejected CSS construct. */
export interface CssIssue {
  readonly code: string
  readonly message: string
}

/** Result of parsing a `css` prop value. */
export interface ParsedCss {
  readonly declarations: readonly CssDeclaration[]
  readonly issues: readonly CssIssue[]
}

const PROPERTY = /^(?:--[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9-]*)$/
const URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi

/** Stable authoring class for one node's scoped declarations. */
export function cssClassForNode(node: DesignElement): string {
  const identity = node.id === undefined || node.id === '' ? node.address.label : node.id
  return 'dsx-css-' + identity.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Whether a URL target stays inside the design folder. */
export function isLocalCssUrl(target: string): boolean {
  const value = target.trim()
  if (value === '') return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false
  if (value.startsWith('//') || value.startsWith('/') || value.includes('\\')) return false
  const normalization = value.replace(/^\.\//, '')
  const segments = normalization.split('/')
  if (segments.includes('..') || segments.includes('.cache')) return false
  return true
}

/** Split a declaration list on semicolons outside quotes and parentheses. */
function splitDeclarations(css: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | undefined
  let start = 0
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index] as string
    if (quote !== undefined) {
      if (character === quote && css[index - 1] !== '\\') quote = undefined
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '(') {
      depth += 1
      continue
    }
    if (character === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (character === ';' && depth === 0) {
      parts.push(css.slice(start, index))
      start = index + 1
    }
  }
  parts.push(css.slice(start))
  return parts.map((part) => part.trim()).filter((part) => part.length > 0)
}

/**
 * Parse and validate CSS declarations. Selectors, at-rules, executable
 * values, and URLs outside the design folder are rejected, never echoed.
 */
export function parseCssDeclarations(css: string): ParsedCss {
  const issues: CssIssue[] = []
  if (/[{}]/.test(css))
    issues.push({
      code: 'css-selector',
      message: 'The css prop accepts declarations only; selectors and nested blocks are not allowed.',
    })
  if (/@/.test(css))
    issues.push({ code: 'css-at-rule', message: 'The css prop rejects at-rules such as @import and @media.' })
  if (/<|>/.test(css)) issues.push({ code: 'css-unsafe', message: 'The css prop rejects markup characters.' })
  if (/expression\s*\(|javascript:|behavior:/i.test(css)) {
    issues.push({
      code: 'css-unsafe',
      message: 'The css prop rejects executable values such as expression() and javascript: URLs.',
    })
  }
  if (/!\s*important/i.test(css)) {
    issues.push({
      code: 'css-important',
      message: 'The css prop rejects !important; the escape hatch is already authoritative for its node.',
    })
  }
  const declarations: CssDeclaration[] = []
  for (const part of splitDeclarations(css)) {
    const colon = part.indexOf(':')
    if (colon === -1) {
      issues.push({ code: 'css-declaration', message: 'Every css declaration needs a "property: value" pair.' })
      continue
    }
    const property = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim()
    if (!PROPERTY.test(property)) {
      issues.push({ code: 'css-property', message: 'Unsupported css property "' + property + '".' })
      continue
    }
    if (value === '') {
      issues.push({ code: 'css-declaration', message: 'CSS property "' + property + '" has no value.' })
      continue
    }
    let badUrl = false
    for (const match of value.matchAll(URL_PATTERN)) {
      const target = match[1] ?? match[2] ?? match[3] ?? ''
      if (!isLocalCssUrl(target)) {
        issues.push({
          code: 'css-url-external',
          message:
            'The css prop rejects url("' + target.trim() + '"); only paths inside the design folder are allowed.',
        })
        badUrl = true
      }
    }
    if (badUrl) continue
    declarations.push({ property, value })
  }
  return { declarations, issues }
}

/**
 * Render one node's declarations as an authoritative scoped rule. Local
 * `url()` targets are rebound through the preview's project-file route.
 */
export function cssRuleText(node: DesignElement, imageUrl: (path: string) => string): string | undefined {
  if (typeof node.props.css !== 'string') return undefined
  const parsed = parseCssDeclarations(node.props.css)
  if (parsed.issues.length > 0 || parsed.declarations.length === 0) return undefined
  const declarations = parsed.declarations.map(({ property, value }) => {
    const rewritten = value.replace(URL_PATTERN, (_match, doubleQuoted, singleQuoted, bare) => {
      const target = String(doubleQuoted ?? singleQuoted ?? bare ?? '')
      return 'url("' + imageUrl(target.trim().replace(/^\.\//, '')) + '")'
    })
    return property + ': ' + rewritten + ' !important;'
  })
  return '.' + cssClassForNode(node) + ' { ' + declarations.join(' ') + ' }'
}

/** Collect all scoped CSS rules for one tree. */
export function collectCssRules(root: DesignElement, imageUrl: (path: string) => string): string[] {
  const rules: string[] = []
  const visit = (node: DesignElement): void => {
    const rule = cssRuleText(node, imageUrl)
    if (rule !== undefined) rules.push(rule)
    for (const child of node.children) if (child.kind === 'element') visit(child)
  }
  visit(root)
  return rules
}
