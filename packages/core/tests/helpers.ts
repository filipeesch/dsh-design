import { kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { DEFAULT_TOKENS } from '../src/scaffold.ts'
import { parseTokens } from '../src/tokens.ts'
import { parseScreen } from '../src/parse.ts'
import { validateTree, type ValidationContext } from '../src/validate.ts'
import type { Diagnostic, ParsedScreen, ResolvedTokens } from '../src/types.ts'

export const tokensSource = JSON.stringify(DEFAULT_TOKENS)
export const resolvedTokens: ResolvedTokens = parseTokens(tokensSource, 'tokens.json')

export interface ValidateOptions {
  readonly screens?: readonly string[]
  readonly tokens?: ResolvedTokens
  readonly breakpoints?: readonly string[]
  readonly file?: string
}

export function context(options: ValidateOptions = {}): ValidationContext {
  return {
    kit: kitMetadata,
    tokens: (options.tokens ?? resolvedTokens).tokens,
    breakpoints: options.breakpoints ?? ['mobile', 'tablet', 'desktop'],
    projectScreens: options.screens ?? ['home'],
    designFolder: '/tmp/design',
    kitVersionPin: '1.0.0',
    installedKitVersion: '1.0.0',
  }
}

export interface Validated {
  readonly parsed: ParsedScreen
  readonly diagnostics: Diagnostic[]
}

export function validateSource(source: string, options: ValidateOptions = {}): Validated {
  const parsed = parseScreen(source, options.file ?? 'screens/home.dsx')
  if (parsed.root === undefined) return { parsed, diagnostics: parsed.diagnostics }
  const semantic = validateTree(parsed.root, parsed.file, context(options))
  return { parsed, diagnostics: [...parsed.diagnostics, ...semantic] }
}

export function errors(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
}

export function warnings(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')
}

export const validScreen = `<Screen id="home" title="Home">
  <Header title="Acme" />
  <Stack gap="spacing.md" padding="spacing.lg">
    <Text variant="heading">Welcome</Text>
    <Text color="color.text">Body</Text>
    <Button id="go" variant="primary">Go</Button>
  </Stack>
</Screen>`
