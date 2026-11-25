/** Diagnostic ordering, text formatting, and nearest-name helpers. */
import type { Diagnostic } from './types.ts'

/** Stable generic edit distance between two strings. */
export function editDistance(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  const rows = a.length + 1
  const cols = b.length + 1
  const table: number[] = Array.from({ length: rows * cols }, () => 0)
  const at = (row: number, col: number): number => table[row * cols + col] as number
  const set = (row: number, col: number, value: number): void => {
    table[row * cols + col] = value
  }
  for (let row = 0; row < rows; row += 1) set(row, 0, row)
  for (let col = 0; col < cols; col += 1) set(0, col, col)
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1
      set(row, col, Math.min(at(row - 1, col) + 1, at(row, col - 1) + 1, at(row - 1, col - 1) + cost))
    }
  }
  return at(rows - 1, cols - 1)
}

/**
 * Closest candidate by case-insensitive edit distance.
 * @param value - misspelled value.
 * @param candidates - accepted names.
 * @returns the closest candidate when it is reasonably close, otherwise undefined.
 */
export function nearest(value: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const distance = editDistance(value, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  if (best === undefined) return undefined
  const threshold = Math.max(2, Math.floor(Math.max(value.length, best.length) / 3))
  return bestDistance <= threshold ? best : undefined
}

/** Sort diagnostics by file, line, then column, keeping insertion order on ties. */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics
    .map((diagnostic, index) => ({ diagnostic, index }))
    .sort(
      (left, right) =>
        left.diagnostic.file.localeCompare(right.diagnostic.file) ||
        left.diagnostic.line - right.diagnostic.line ||
        left.diagnostic.column - right.diagnostic.column ||
        left.index - right.index,
    )
    .map(({ diagnostic }) => diagnostic)
}

/** Count diagnostics by severity. */
export function countDiagnostics(diagnostics: readonly Diagnostic[]): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') errors += 1
    else warnings += 1
  }
  return { errors, warnings }
}

/** Render one diagnostic as `severity file:line:column message`. */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`
  const suggestion = diagnostic.suggestion === undefined ? '' : ` (${diagnostic.suggestion})`
  return `${diagnostic.severity} ${location} ${diagnostic.message}${suggestion}`
}

/** Render diagnostics as one text block, capped by the caller. */
export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join('\n')
}
