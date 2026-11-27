/** Resolve effective palettes by merging raw definitions before alias expansion. */
import { parseRawTokens, resolveTokenValues } from './tokens.ts'
import type { SourceInventory } from './sources.ts'
import type { DesignProject, Diagnostic, ResolvedTheme, ResolvedTokens } from './types.ts'

export function loadThemes(inventory: SourceInventory, previous?: DesignProject) {
  const config = inventory.config.config
  const source = inventory.entries.get('tokens.json')?.source
  const diagnostics: Diagnostic[] = []
  const base = source === undefined ? undefined : parseRawTokens(source, 'tokens.json')
  const baseResolved = resolveTokenValues(base?.raw ?? [], 'tokens.json')
  const tokens: ResolvedTokens = {
    ...baseResolved,
    diagnostics: [
      ...(inventory.entries.get('tokens.json')?.issue === undefined
        ? []
        : [inventory.entries.get('tokens.json')!.issue!]),
      ...(base?.diagnostics ?? []),
      ...baseResolved.diagnostics,
    ],
  }
  diagnostics.push(...(base?.diagnostics ?? []), ...baseResolved.diagnostics)
  const themes: Record<string, ResolvedTheme> = Object.create(null) as Record<string, ResolvedTheme>
  if (tokens.diagnostics.every((item) => item.severity !== 'error')) themes.base = { name: 'base', tokens }
  for (const [name, file] of Object.entries(config.themes ?? {})) {
    const themeSource = inventory.entries.get(file)?.source
    if (themeSource === undefined) continue
    const override = parseRawTokens(themeSource, file, true)
    const issues = [...override.diagnostics]
    const merged = new Map(base?.raw.map((token) => [token.path, token]))
    for (const token of override.raw) {
      const original = merged.get(token.path)
      if (original === undefined || original.type !== token.type) {
        issues.push({
          ...token.source,
          severity: 'error',
          code: original === undefined ? 'theme-token-unknown' : 'theme-token-type',
          message:
            original === undefined
              ? 'Cannot override undeclared base token "' + token.path + '".'
              : 'Theme token "' + token.path + '" must retain the base type ' + original.type + '.',
        })
      } else merged.set(token.path, token)
    }
    if (themes.base !== undefined) {
      const palette = resolveTokenValues([...merged.values()], file)
      issues.push(...palette.diagnostics)
      if (issues.every((item) => item.severity !== 'error')) {
        themes[name] = {
          name,
          tokens: palette,
          ...(override.colorScheme === undefined ? {} : { colorScheme: override.colorScheme }),
        }
      }
    }
    diagnostics.push(...issues)
  }
  const defaultTheme = config.defaultTheme ?? 'base'
  const lastValidThemes: Record<string, ResolvedTheme> = Object.assign(
    Object.create(null) as Record<string, ResolvedTheme>,
    themes,
  )
  for (const name of ['base', ...Object.keys(config.themes ?? {})]) {
    const last = Object.hasOwn(previous?.lastValidThemes ?? {}, name) ? previous?.lastValidThemes[name] : undefined
    if (themes[name] === undefined && last !== undefined) lastValidThemes[name] = last
  }
  return { tokens, themes, defaultTheme, lastValidThemes, diagnostics }
}

/** Resolve a current selection. Preview-only retained palettes are deliberately excluded. */
export function resolveProjectTheme(project: DesignProject, requested?: string): ResolvedTheme {
  const name = requested ?? project.defaultTheme
  if (Object.hasOwn(project.themes, name)) return project.themes[name]!
  const file =
    name === 'base'
      ? 'tokens.json'
      : Object.hasOwn(project.config.themes ?? {}, name)
        ? project.config.themes?.[name]
        : undefined
  if (file !== undefined) {
    const first = project.diagnostics.find((item) => item.file === file && item.severity === 'error')
    throw new Error('Theme "' + name + '" is invalid; check ' + file + '.' + (first ? ' ' + first.message : ''))
  }
  throw new Error(
    'Unknown theme "' + name + '". Available themes: ' + (Object.keys(project.themes).join(', ') || 'none') + '.',
  )
}
