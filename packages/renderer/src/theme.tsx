/** Palette selection and diagnostics belong to the chrome, outside the canvas. */
import { selectTheme, type PreviewRoute } from './route.ts'
import type { ProjectPayload, WireTheme } from './wire.ts'

type ThemeProps = { readonly project: ProjectPayload; readonly route: PreviewRoute }

export function selectPalette(project: ProjectPayload, route: PreviewRoute): { name: string; palette?: WireTheme } {
  const name = route.theme ?? project.theme ?? 'base'
  if (project.themes === undefined && name === 'base') {
    return { name, palette: { tokens: project.tokens, cssVariables: project.cssVariables } }
  }
  const palette = Object.hasOwn(project.themes ?? {}, name) ? project.themes?.[name] : undefined
  return palette === undefined ? { name } : { name, palette }
}

export function ThemeSelector({ project, route }: ThemeProps) {
  const names = Object.keys(project.themes ?? { base: true })
  const { name, palette } = selectPalette(project, route)
  // Always provide a recovery control for an invalid explicit selection.
  if (names.length < 2 && palette !== undefined && palette.stale !== true) return null
  return (
    <label className={route.compare === undefined ? 'dsx-chrome-select' : 'dsx-compare-field'}>
      Theme
      <select aria-label="Theme" value={name} onChange={(event) => selectTheme(event.currentTarget.value)}>
        {palette === undefined ? (
          <option value={name} disabled>
            {name || '(empty)'} (unavailable)
          </option>
        ) : null}
        {names.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
            {project.themes?.[entry]?.stale === true ? ' (last valid)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

export function ThemeNotice({ project, route }: ThemeProps) {
  const { name, palette } = selectPalette(project, route)
  if (palette !== undefined && palette.stale !== true) return null
  const known = project.declaredThemes?.includes(name) ?? false
  const diagnostics = project.diagnostics
    .filter(
      (entry) =>
        entry.severity === 'error' &&
        (entry.file === 'tokens.json' || entry.file.startsWith('themes/') || entry.file === 'design.json'),
    )
    .slice(0, 8)
  return (
    <div className="dsx-notice error" role="alert">
      <strong>{known ? 'Invalid theme' : 'Unknown theme'}</strong>
      <p>
        Theme "{name}" is {known ? 'invalid in the current source' : 'not declared'}.{' '}
        {palette === undefined ? 'No other palette was substituted.' : 'Showing its last valid palette.'}
      </p>
      {!known || diagnostics.length === 0 ? null : (
        <ul>
          {diagnostics.map((entry, index) => (
            <li key={index}>
              {entry.file}:{entry.line}:{entry.column} {entry.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
