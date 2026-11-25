/**
 * W3C Design Tokens subset reader: nested groups, `$value`, `$type`, and
 * `{group.token}` aliases, expanded with cycle detection and type checks.
 */
import type { Diagnostic, RawToken, ResolvedToken, ResolvedTokens, TokenType } from './types.ts'
import { nearest } from './diagnostics.ts'

const TOKEN_TYPES = new Set<TokenType>([
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'number',
  'shadow',
  'duration',
])
const ALIAS = /^\{([^{}]+)\}$/
const DIMENSION = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|pt|ch)$|^0$/
const DURATION = /^-?(?:\d+\.?\d*|\.\d+)(?:ms|s)$/
const COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([^)]*\)|[a-z]+)$/i
const SHADOW = /^[^;{}]+$/

/** CSS custom property for one token path. */
export function cssVariableFor(path: string): string {
  return `--dsx-${path.replace(/\./g, '-').replace(/[^a-zA-Z0-9-]/g, '-')}`
}

/** Read one token value as a CSS string, or return undefined for a structural type error. */
function checkTokenValue(type: TokenType, value: unknown): string | number | undefined {
  if (typeof value === 'string' && ALIAS.test(value)) return value
  switch (type) {
    case 'color':
      return typeof value === 'string' && COLOR.test(value) ? value : undefined
    case 'dimension':
      if (typeof value === 'number' && value === 0) return '0'
      if (typeof value === 'string' && DIMENSION.test(value)) return value
      if (value !== null && typeof value === 'object' && 'value' in value) {
        const candidate = value as { value?: unknown; unit?: unknown }
        const unit = typeof candidate.unit === 'string' ? candidate.unit : ''
        if (typeof candidate.value === 'number' && DIMENSION.test(`${candidate.value}${unit}`)) {
          return `${candidate.value}${unit}`
        }
      }
      return undefined
    case 'duration':
      if (typeof value === 'string' && DURATION.test(value)) return value
      if (value !== null && typeof value === 'object' && 'value' in value) {
        const candidate = value as { value?: unknown; unit?: unknown }
        const unit = typeof candidate.unit === 'string' ? candidate.unit : 'ms'
        if (typeof candidate.value === 'number' && DURATION.test(`${candidate.value}${unit}`)) {
          return `${candidate.value}${unit}`
        }
      }
      return undefined
    case 'fontFamily':
      if (typeof value === 'string' && value.trim().length > 0) return value
      if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value.join(', ')
      return undefined
    case 'fontWeight':
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string' && /^(normal|bold|bolder|lighter|[1-9]00)$/.test(value)) return value
      return undefined
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined
    case 'shadow':
      if (typeof value === 'string' && SHADOW.test(value)) return value
      if (value !== null && typeof value === 'object') {
        const shadow = value as Record<string, unknown>
        if (
          typeof shadow.offsetX === 'string' &&
          typeof shadow.offsetY === 'string' &&
          typeof shadow.blur === 'string' &&
          typeof shadow.color === 'string'
        ) {
          const spread = typeof shadow.spread === 'string' ? ` ${shadow.spread}` : ''
          return `${shadow.offsetX} ${shadow.offsetY} ${shadow.blur}${spread} ${shadow.color}`
        }
      }
      return undefined
    default:
      return undefined
  }
}

interface WalkContext {
  readonly file: string
  readonly tokens: RawToken[]
  readonly diagnostics: Diagnostic[]
}

/** Recursively collect leaf tokens from a group. */
function walkGroup(
  ctx: WalkContext,
  group: Record<string, unknown>,
  prefix: string[],
  inheritedType?: TokenType,
): void {
  for (const [key, raw] of Object.entries(group)) {
    if (key === '$type' || key === '$description' || key === '$extensions' || key === '$value') continue
    const path = [...prefix, key]
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      ctx.diagnostics.push({
        severity: 'error',
        code: 'token-shape',
        file: ctx.file,
        line: 1,
        column: 1,
        message: `Token "${path.join('.')}" must be an object with a $value or nested tokens.`,
      })
      continue
    }
    const record = raw as Record<string, unknown>
    const declaredType = record.$type
    const type =
      typeof declaredType === 'string' && TOKEN_TYPES.has(declaredType as TokenType)
        ? (declaredType as TokenType)
        : inheritedType
    if ('$value' in record) {
      const tokenPath = path.join('.')
      if (type === undefined) {
        ctx.diagnostics.push({
          severity: 'error',
          code: 'token-type-missing',
          file: ctx.file,
          line: 1,
          column: 1,
          message: `Token "${tokenPath}" has no $type and inherits none from its group.`,
        })
        continue
      }
      if (typeof declaredType === 'string' && !TOKEN_TYPES.has(declaredType as TokenType)) {
        ctx.diagnostics.push({
          severity: 'error',
          code: 'token-type-unknown',
          file: ctx.file,
          line: 1,
          column: 1,
          message: `Token "${tokenPath}" has unsupported type "${declaredType}".`,
          suggestion: `Use one of: ${[...TOKEN_TYPES].join(', ')}`,
        })
        continue
      }
      const checked = checkTokenValue(type, record.$value)
      if (checked === undefined) {
        ctx.diagnostics.push({
          severity: 'error',
          code: 'token-value-type',
          file: ctx.file,
          line: 1,
          column: 1,
          message: `Token "${tokenPath}" has a value that is not a valid ${type}.`,
        })
        continue
      }
      ctx.tokens.push({ path: tokenPath, type, value: record.$value, source: { file: ctx.file, line: 1, column: 1 } })
      continue
    }
    if (typeof declaredType === 'string' && !TOKEN_TYPES.has(declaredType as TokenType)) {
      ctx.diagnostics.push({
        severity: 'error',
        code: 'token-type-unknown',
        file: ctx.file,
        line: 1,
        column: 1,
        message: `Group "${path.join('.')}" has unsupported $type "${declaredType}".`,
      })
      continue
    }
    walkGroup(ctx, record, path, type)
  }
}

/** Resolve aliases and type checks into final token values and CSS text. */
export function resolveTokenValues(raw: readonly RawToken[], file: string): ResolvedTokens {
  const byPath = new Map(raw.map((token) => [token.path, token]))
  const resolved = new Map<string, { value: string | number; type: TokenType }>()
  const diagnostics: Diagnostic[] = []

  const resolve = (
    token: RawToken,
    stack: readonly string[],
  ): { value: string | number; type: TokenType } | undefined => {
    const done = resolved.get(token.path)
    if (done !== undefined) return done
    if (stack.includes(token.path)) {
      diagnostics.push({
        severity: 'error',
        code: 'token-cycle',
        file,
        line: 1,
        column: 1,
        message: `Token alias cycle: ${[...stack, token.path].join(' -> ')}.`,
      })
      return undefined
    }
    const alias = typeof token.value === 'string' ? ALIAS.exec(token.value) : null
    if (alias === null) {
      const checked = checkTokenValue(token.type, token.value)
      if (checked === undefined) {
        diagnostics.push({
          severity: 'error',
          code: 'token-value-type',
          file,
          line: 1,
          column: 1,
          message: `Token "${token.path}" has a value that is not a valid ${token.type}.`,
        })
        return undefined
      }
      const result = { value: checked, type: token.type }
      resolved.set(token.path, result)
      return result
    }
    const targetPath = alias[1]?.trim() ?? ''
    const target = byPath.get(targetPath)
    if (target === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'token-alias-missing',
        file,
        line: 1,
        column: 1,
        message: `Token "${token.path}" aliases "${targetPath}", which does not exist.`,
        ...(nearest(targetPath, [...byPath.keys()]) === undefined
          ? {}
          : { suggestion: `Did you mean ${nearest(targetPath, [...byPath.keys()])}?` }),
      })
      return undefined
    }
    const resolvedTarget = resolve(target, [...stack, token.path])
    if (resolvedTarget === undefined) return undefined
    if (resolvedTarget.type !== token.type) {
      diagnostics.push({
        severity: 'error',
        code: 'token-alias-type',
        file,
        line: 1,
        column: 1,
        message: `Token "${token.path}" is ${token.type} but its alias "${targetPath}" is ${resolvedTarget.type}.`,
      })
      return undefined
    }
    const result = { value: resolvedTarget.value, type: token.type }
    resolved.set(token.path, result)
    return result
  }

  const tokens: Record<string, ResolvedToken> = {}
  for (const token of raw) {
    const value = resolve(token, [])
    if (value === undefined) continue
    tokens[token.path] = { path: token.path, type: token.type, value: value.value, cssVar: cssVariableFor(token.path) }
  }
  const cssText = Object.values(tokens)
    .map((token) => `${token.cssVar}: ${String(token.value)};`)
    .join('\n')
  return { tokens, cssText, diagnostics }
}

/**
 * Parse a `tokens.json` document.
 * @param source - JSON text.
 * @param file - project-relative path used in diagnostics.
 */
export function parseTokens(source: string, file: string): ResolvedTokens {
  let document: unknown
  try {
    document = JSON.parse(source)
  } catch (error) {
    return {
      tokens: {},
      cssText: '',
      diagnostics: [
        {
          severity: 'error',
          code: 'tokens-json',
          file,
          line: 1,
          column: 1,
          message: `tokens.json is not valid JSON: ${(error as Error).message}`,
        },
      ],
    }
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return {
      tokens: {},
      cssText: '',
      diagnostics: [
        {
          severity: 'error',
          code: 'tokens-shape',
          file,
          line: 1,
          column: 1,
          message: 'tokens.json must be an object of token groups.',
        },
      ],
    }
  }
  const ctx: WalkContext = { file, tokens: [], diagnostics: [] }
  walkGroup(ctx, document as Record<string, unknown>, [])
  const resolved = resolveTokenValues(ctx.tokens, file)
  return { ...resolved, diagnostics: [...ctx.diagnostics, ...resolved.diagnostics] }
}
