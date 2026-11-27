/** `design.json` parsing, defaults, and kit version compatibility. */
import { satisfies, validRange } from 'semver'
import type { Breakpoint, DesignConfig, Diagnostic } from './types.ts'

/** Default breakpoints required by the design spec. */
export const DEFAULT_BREAKPOINTS: readonly Breakpoint[] = [
  { name: 'mobile', width: 390 },
  { name: 'tablet', width: 768 },
  { name: 'desktop', width: 1280 },
]

/** Names must be usable as a DSL identifier and a URL query value. */
const BREAKPOINT_NAME = /^[a-z][a-z0-9-]*$/
export const SOURCE_NAME = /^[a-z][a-z0-9-]{0,79}$/
const MAX_THEMES = 16
const MAX_STYLESHEETS = 16

function declaredPath(value: unknown, directory: string, extension: string): value is string {
  if (typeof value !== 'string' || value.length > 240 || !value.startsWith(directory + '/')) return false
  const segments = value.slice(directory.length + 1).split('/')
  return (
    segments.length <= 8 &&
    segments.every((segment, index) => {
      if (index < segments.length - 1) return SOURCE_NAME.test(segment)
      return segment.endsWith(extension) && SOURCE_NAME.test(segment.slice(0, -extension.length))
    })
  )
}

/** Parse and validate a `design.json` document. */
export function parseConfig(source: string, file: string): { config: DesignConfig; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  let document: unknown
  try {
    document = JSON.parse(source)
  } catch (error) {
    return {
      config: { kitVersion: '', breakpoints: DEFAULT_BREAKPOINTS },
      diagnostics: [
        {
          severity: 'error',
          code: 'config-json',
          file,
          line: 1,
          column: 1,
          message: `design.json is not valid JSON: ${(error as Error).message}`,
        },
      ],
    }
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return {
      config: { kitVersion: '', breakpoints: DEFAULT_BREAKPOINTS },
      diagnostics: [
        {
          severity: 'error',
          code: 'config-shape',
          file,
          line: 1,
          column: 1,
          message: 'design.json must be a JSON object.',
        },
      ],
    }
  }
  const record = document as Record<string, unknown>
  let kitVersion = ''
  if (typeof record.kitVersion !== 'string' || record.kitVersion.trim() === '') {
    diagnostics.push({
      severity: 'error',
      code: 'config-kit-version',
      file,
      line: 1,
      column: 1,
      message: 'design.json field "kitVersion" is required and must be a non-empty string, for example "1.x".',
    })
  } else {
    kitVersion = record.kitVersion.trim()
    if (validRange(kitVersion) === null) {
      diagnostics.push({
        severity: 'error',
        code: 'config-kit-version',
        file,
        line: 1,
        column: 1,
        message: `design.json field "kitVersion" is not a valid semver range: "${kitVersion}".`,
        suggestion: 'Pin a range such as "1.x" or a version such as "1.0.0".',
      })
    }
  }

  let breakpoints: Breakpoint[] = [...DEFAULT_BREAKPOINTS]
  if (record.breakpoints !== undefined) {
    if (record.breakpoints === null || typeof record.breakpoints !== 'object' || Array.isArray(record.breakpoints)) {
      diagnostics.push({
        severity: 'error',
        code: 'config-breakpoints',
        file,
        line: 1,
        column: 1,
        message: 'design.json field "breakpoints" must be an object mapping a name to a viewport width in CSS pixels.',
      })
    } else {
      const entries: Breakpoint[] = []
      for (const [name, width] of Object.entries(record.breakpoints as Record<string, unknown>)) {
        if (!BREAKPOINT_NAME.test(name)) {
          diagnostics.push({
            severity: 'error',
            code: 'config-breakpoint-name',
            file,
            line: 1,
            column: 1,
            message: `Breakpoint name "${name}" must match [a-z][a-z0-9-]*.`,
          })
          continue
        }
        if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
          diagnostics.push({
            severity: 'error',
            code: 'config-breakpoint-width',
            file,
            line: 1,
            column: 1,
            message: `Breakpoint "${name}" must have a positive numeric width in CSS pixels.`,
          })
          continue
        }
        entries.push({ name, width })
      }
      if (entries.length > 0) breakpoints = entries
      if (entries.length !== Object.keys(record.breakpoints as Record<string, unknown>).length) {
        // Invalid entries already produced errors; keep the valid subset for later checks.
      }
    }
  }

  let entry: string | undefined
  if (record.entry !== undefined) {
    if (typeof record.entry !== 'string' || record.entry.trim() === '') {
      diagnostics.push({
        severity: 'error',
        code: 'config-entry',
        file,
        line: 1,
        column: 1,
        message: 'design.json field "entry" must be a screen id string.',
      })
    } else {
      entry = record.entry.trim()
    }
  }
  function invalid(code: string, message: string): void {
    diagnostics.push({ severity: 'error', code, file, line: 1, column: 1, message })
  }
  let themes: Record<string, string> | undefined
  if (record.themes !== undefined) {
    themes = {}
    if (record.themes === null || typeof record.themes !== 'object' || Array.isArray(record.themes)) {
      invalid('config-themes', 'design.json field "themes" must map theme names to local JSON files.')
    } else {
      const entries = Object.entries(record.themes)
      if (entries.length > MAX_THEMES) invalid('config-themes', 'Declare at most 16 theme overrides.')
      for (const [name, value] of entries.slice(0, MAX_THEMES)) {
        if (!SOURCE_NAME.test(name) || name === 'base') {
          invalid('config-theme-name', 'Theme names must be kebab-case; "base" is reserved.')
        } else if (!declaredPath(value, 'themes', '.json')) {
          invalid('config-theme-path', 'Theme "' + name + '" must use a project-relative JSON path under themes/.')
        } else themes[name] = value
      }
    }
  }
  let defaultTheme: string | undefined
  if (record.defaultTheme !== undefined) {
    if (typeof record.defaultTheme !== 'string' || !SOURCE_NAME.test(record.defaultTheme)) {
      invalid('config-default-theme', 'design.json field "defaultTheme" must name a declared theme or "base".')
    } else {
      defaultTheme = record.defaultTheme
      if (defaultTheme !== 'base' && !Object.hasOwn(themes ?? {}, defaultTheme)) {
        invalid('config-default-theme', 'Default theme "' + defaultTheme + '" is not declared.')
      }
    }
  }
  let stylesheets: string[] | undefined
  if (record.stylesheets !== undefined) {
    stylesheets = []
    if (!Array.isArray(record.stylesheets)) {
      invalid('config-stylesheets', 'design.json field "stylesheets" must be an ordered list of local CSS files.')
    } else {
      if (record.stylesheets.length > MAX_STYLESHEETS) invalid('config-stylesheets', 'Declare at most 16 stylesheets.')
      for (const [index, value] of record.stylesheets.slice(0, MAX_STYLESHEETS).entries()) {
        if (!declaredPath(value, 'styles', '.css')) {
          invalid(
            'config-stylesheet-path',
            'stylesheets[' + index + '] must use a project-relative CSS path under styles/.',
          )
        } else if (stylesheets.includes(value)) {
          invalid('config-stylesheet-path', 'Stylesheet "' + value + '" is declared more than once.')
        } else stylesheets.push(value)
      }
    }
  }
  for (const key of Object.keys(record)) {
    if (!['kitVersion', 'breakpoints', 'entry', 'themes', 'defaultTheme', 'stylesheets'].includes(key)) {
      diagnostics.push({
        severity: 'warning',
        code: 'config-unknown-field',
        file,
        line: 1,
        column: 1,
        message: `design.json field "${key}" is not recognised and is ignored.`,
      })
    }
  }
  return {
    config: {
      kitVersion,
      breakpoints,
      ...(entry === undefined ? {} : { entry }),
      ...(themes === undefined ? {} : { themes }),
      ...(defaultTheme === undefined ? {} : { defaultTheme }),
      ...(stylesheets === undefined ? {} : { stylesheets }),
    },
    diagnostics,
  }
}

/**
 * Check the project pin against the installed kit version.
 * @param pin - semver range from design.json.
 * @param installed - installed kit version.
 */
export function checkKitVersion(pin: string, installed: string, file: string): Diagnostic | undefined {
  if (validRange(pin) === null) {
    return {
      severity: 'error',
      code: 'kit-version-pin',
      file,
      line: 1,
      column: 1,
      message: `The kit version pin "${pin}" is not a valid semver range.`,
    }
  }
  if (satisfies(installed, pin)) return undefined
  return {
    severity: 'error',
    code: 'kit-version-mismatch',
    file,
    line: 1,
    column: 1,
    message: `The project pins kit "${pin}" but the installed kit is ${installed}; rendering is stopped until the pin matches.`,
    suggestion: `Change design.json kitVersion to "${installed}" or install a compatible kit.`,
  }
}
