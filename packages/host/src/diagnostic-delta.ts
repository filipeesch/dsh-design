/** Compare complete validation snapshots so changes in dependent files are not missed. */
import { countDiagnostics, formatDiagnostic, sortDiagnostics, type Diagnostic } from '@filipeesch/dsh-design-core'

const MAX_ATTACHED = 10
const MAX_LINE_LENGTH = 600

function identity(diagnostic: Diagnostic): string {
  // Parser messages can include coordinates as well as the structured source position.
  let message = diagnostic.message
  if (diagnostic.code === 'syntax-error' || diagnostic.code === 'journey-syntax') {
    message = message.replace(/ \(\d+:\d+\)$/u, '')
  } else if (['fixture-json', 'config-json', 'tokens-json'].includes(diagnostic.code)) {
    message = message.replace(/ at position \d+ \(line \d+ column \d+\)$/u, '')
  }
  return JSON.stringify([
    diagnostic.file,
    diagnostic.code,
    diagnostic.severity,
    diagnostic.nodeId,
    diagnostic.group,
    diagnostic.branch,
    message,
  ])
}

function group(diagnostics: readonly Diagnostic[]): Map<string, Diagnostic[]> {
  const buckets = new Map<string, Diagnostic[]>()
  for (const diagnostic of sortDiagnostics(diagnostics)) {
    const id = identity(diagnostic)
    const bucket = buckets.get(id)
    if (bucket === undefined) buckets.set(id, [diagnostic])
    else bucket.push(diagnostic)
  }
  return buckets
}

/** For indistinguishable repeated issues, prefer to match the same structural address first. */
function surplus(left: readonly Diagnostic[], right: readonly Diagnostic[]): Diagnostic[] {
  if (left.length <= right.length) return []
  const locations = new Map<string, number>()
  const location = (item: Diagnostic) => item.address ?? JSON.stringify([item.line, item.column])
  for (const item of right) {
    const key = location(item)
    locations.set(key, (locations.get(key) ?? 0) + 1)
  }
  return left
    .filter((item) => {
      const key = location(item)
      const count = locations.get(key) ?? 0
      if (count === 0) return true
      locations.set(key, count - 1)
      return false
    })
    .slice(0, left.length - right.length)
}

export function summarizeDiagnosticDelta(
  before: readonly Diagnostic[],
  after: readonly Diagnostic[],
): string | undefined {
  const missingBefore = before.some((diagnostic) => diagnostic.code === 'project-missing')
  const missingAfter = after.some((diagnostic) => diagnostic.code === 'project-missing')
  // Creating a project is not itself a repair; removing its config can hide other findings.
  const previous = group(missingBefore && !missingAfter ? [] : before)
  const current = group(after)
  const added: Diagnostic[] = []
  const resolved: Diagnostic[] = []
  for (const [id, diagnostics] of current) added.push(...surplus(diagnostics, previous.get(id) ?? []))
  if (!missingAfter) {
    for (const [id, diagnostics] of previous) resolved.push(...surplus(diagnostics, current.get(id) ?? []))
  }
  if (added.length + resolved.length === 0) return undefined

  const lines = ['Design validation changes:']
  let remaining = MAX_ATTACHED
  for (const [label, diagnostics] of [
    ['New', added],
    ['Resolved (previous locations)', resolved],
  ] as const) {
    if (diagnostics.length === 0) continue
    const { errors, warnings } = countDiagnostics(diagnostics)
    lines.push(label + ': ' + String(errors) + ' error(s), ' + String(warnings) + ' warning(s).')
    const visible = sortDiagnostics(diagnostics).slice(0, remaining)
    for (const diagnostic of visible) {
      const line = formatDiagnostic(diagnostic).replace(/\s+/gu, ' ')
      lines.push('  ' + (line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '…' : line))
    }
    remaining -= visible.length
    if (visible.length < diagnostics.length) lines.push('  … ' + String(diagnostics.length - visible.length) + ' more')
  }
  return lines.join('\n')
}
