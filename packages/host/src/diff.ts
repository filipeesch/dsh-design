/**
 * Deterministic semantic design diff.
 *
 * Projection mode compares two branch selections from the current project.
 * Revision mode reads only committed design inputs from two locally available
 * Git revisions through bounded, literal read-only commands. It never checks
 * out, stages, fetches, writes, or loads external content.
 */
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { relative, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  MAX_SOURCE_FILE_BYTES,
  projectFromSources,
  readProjectSources,
  type DesignChild,
  type DesignElement,
  type DesignProject,
  type DesignScreenNode,
  type ProjectSourceReader,
} from '@filipeesch/dsh-design-core'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { resolveScreenProjection } from './projection.ts'

const execFileAsync = promisify(execFile)

/** Maximum nodes traversed per projection. */
export const MAX_DIFF_NODES = 5000
/** Maximum bytes read from one committed file. */
export const MAX_DIFF_FILE_BYTES = MAX_SOURCE_FILE_BYTES

/** One actionable diff diagnostic. */
export interface DiffDiagnostic {
  readonly code: string
  readonly message: string
}

/** One added or removed node. */
export interface DiffNodeRecord {
  readonly node: string
  readonly address: string
  readonly type: string
  readonly match: 'stable' | 'structural'
}

/** One reported move. */
export interface DiffMove {
  readonly node: string
  readonly type: string
  readonly from: string
  readonly to: string
  readonly reason: 'parent' | 'order'
  readonly match: 'stable'
}

/** One typed change of type, prop, or text. */
export interface DiffChange {
  readonly node: string
  readonly type: string
  readonly kind: 'type' | 'prop' | 'text'
  readonly prop?: string
  readonly before: unknown
  readonly after: unknown
  readonly beforeType: string
  readonly afterType: string
  readonly match: 'stable' | 'structural'
}

/** Complete diff result. */
export interface DesignDiffResult {
  readonly ok: boolean
  readonly mode: 'variants' | 'revisions'
  readonly screen: string
  readonly from: string
  readonly to: string
  readonly additions: readonly DiffNodeRecord[]
  readonly removals: readonly DiffNodeRecord[]
  readonly moves: readonly DiffMove[]
  readonly changes: readonly DiffChange[]
  readonly diagnostics: readonly DiffDiagnostic[]
}

interface NodeRecord {
  readonly key: string
  readonly stable: boolean
  readonly label: string
  readonly address: string
  readonly type: string
  readonly parentKey: string
  readonly order: number
  readonly props: Readonly<Record<string, unknown>>
  readonly text: string
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const ordered: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) ordered[key] = canonical(record[key])
    return ordered
  }
  return value
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function valueType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return typeof value
}

function textOf(node: DesignElement | DesignScreenNode): string {
  return node.children
    .filter((child): child is Extract<DesignChild, { kind: 'text' }> => child.kind === 'text')
    .map((child) => child.value)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nodeLabel(node: DesignElement | DesignScreenNode): string {
  return node.id === undefined || node.id === '' ? node.address.label : node.id
}

function collectRecords(root: DesignScreenNode): NodeRecord[] | undefined {
  const records: NodeRecord[] = []
  let order = 0
  const visit = (node: DesignElement | DesignScreenNode, parentKey: string): boolean => {
    if (records.length >= MAX_DIFF_NODES) return false
    const stable = node.id !== undefined && node.id !== ''
    const key = stable ? 'id:' + node.id : 'address:' + node.address.label
    const props: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(node.props)) if (name !== 'id') props[name] = value
    if (node.classCss !== undefined) props.classCss = node.classCss
    records.push({
      key,
      stable,
      label: nodeLabel(node),
      address: node.address.label,
      type: node.type,
      parentKey,
      order,
      props,
      text: textOf(node),
    })
    order += 1
    for (const child of node.children) {
      if (child.kind === 'text') continue
      if (!visit(child, key)) return false
    }
    return true
  }
  if (!visit(root, '#root')) return undefined
  return records
}

interface MatchPair {
  readonly left: NodeRecord
  readonly right: NodeRecord
  readonly match: 'stable' | 'structural'
}

/** Longest increasing subsequence indices; deterministic tie-breaking. */
function lisIndices(values: readonly number[]): Set<number> {
  const tails: number[] = []
  const previous: number[] = new Array(values.length).fill(-1)
  for (let index = 0; index < values.length; index += 1) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if ((values[tails[middle] as number] as number) < (values[index] as number)) low = middle + 1
      else high = middle
    }
    if (low > 0) previous[index] = tails[low - 1] as number
    tails[low] = index
  }
  const result = new Set<number>()
  let current = tails[tails.length - 1]
  while (current !== undefined && current >= 0) {
    result.add(current)
    current = previous[current] as number
  }
  return result
}

function pairRecords(
  left: readonly NodeRecord[],
  right: readonly NodeRecord[],
): { pairs: MatchPair[]; leftMatched: Set<number>; rightMatched: Set<number> } {
  const pairs: MatchPair[] = []
  const leftMatched = new Set<number>()
  const rightMatched = new Set<number>()
  const leftById = new Map<string, number>()
  const rightById = new Map<string, number>()
  for (const [index, record] of left.entries()) if (record.stable) leftById.set(record.key, index)
  for (const [index, record] of right.entries()) if (record.stable) rightById.set(record.key, index)
  // Stable identities match first.
  for (const [key, leftIndex] of leftById) {
    const rightIndex = rightById.get(key)
    if (rightIndex === undefined) continue
    pairs.push({ left: left[leftIndex] as NodeRecord, right: right[rightIndex] as NodeRecord, match: 'stable' })
    leftMatched.add(leftIndex)
    rightMatched.add(rightIndex)
  }
  // Structural fallback only within a matched parent and an unchanged address.
  const rightByStructural = new Map<string, number[]>()
  for (const [index, record] of right.entries()) {
    if (rightMatched.has(index) || record.stable) continue
    const key = record.parentKey + '|' + record.address + '|' + record.type
    const list = rightByStructural.get(key) ?? []
    list.push(index)
    rightByStructural.set(key, list)
  }
  for (const [index, record] of left.entries()) {
    if (leftMatched.has(index) || record.stable) continue
    const key = record.parentKey + '|' + record.address + '|' + record.type
    const candidates = rightByStructural.get(key)
    const candidate = candidates?.shift()
    if (candidate === undefined) continue
    pairs.push({ left: record, right: right[candidate] as NodeRecord, match: 'structural' })
    leftMatched.add(index)
    rightMatched.add(candidate)
  }
  return { pairs, leftMatched, rightMatched }
}

function parentLabel(records: readonly NodeRecord[], key: string): string {
  if (key === '#root') return 'screen root'
  const found = records.find((record) => record.key === key)
  return found === undefined ? key : found.label
}

/**
 * Compare two resolved projections.
 * @param left - earlier projection.
 * @param right - later projection.
 */
export function diffProjections(
  left: DesignScreenNode,
  right: DesignScreenNode,
): {
  additions: DiffNodeRecord[]
  removals: DiffNodeRecord[]
  moves: DiffMove[]
  changes: DiffChange[]
  diagnostics: DiffDiagnostic[]
} {
  const leftRecords = collectRecords(left)
  const rightRecords = collectRecords(right)
  if (leftRecords === undefined || rightRecords === undefined) {
    return {
      additions: [],
      removals: [],
      moves: [],
      changes: [],
      diagnostics: [
        {
          code: 'diff-too-large',
          message:
            'One projection exceeds ' + String(MAX_DIFF_NODES) + ' nodes; narrow the screen before comparing it.',
        },
      ],
    }
  }
  const { pairs, leftMatched, rightMatched } = pairRecords(leftRecords, rightRecords)
  const additions: DiffNodeRecord[] = []
  const removals: DiffNodeRecord[] = []
  const moves: DiffMove[] = []
  const changes: DiffChange[] = []
  for (const [index, record] of leftRecords.entries()) {
    if (leftMatched.has(index)) continue
    removals.push({
      node: record.label,
      address: record.address,
      type: record.type,
      match: record.stable ? 'stable' : 'structural',
    })
  }
  for (const [index, record] of rightRecords.entries()) {
    if (rightMatched.has(index)) continue
    additions.push({
      node: record.label,
      address: record.address,
      type: record.type,
      match: record.stable ? 'stable' : 'structural',
    })
  }
  for (const pair of pairs) {
    const { left: before, right: after } = pair
    if (before.type !== after.type) {
      changes.push({
        node: before.label,
        type: after.type,
        kind: 'type',
        before: before.type,
        after: after.type,
        beforeType: 'string',
        afterType: 'string',
        match: pair.match,
      })
    }
    const propNames = new Set([...Object.keys(before.props), ...Object.keys(after.props)])
    for (const name of [...propNames].sort()) {
      if (sameValue(before.props[name], after.props[name])) continue
      changes.push({
        node: before.label,
        type: after.type,
        kind: 'prop',
        prop: name,
        before: before.props[name],
        after: after.props[name],
        beforeType: valueType(before.props[name]),
        afterType: valueType(after.props[name]),
        match: pair.match,
      })
    }
    if (before.text !== after.text) {
      changes.push({
        node: before.label,
        type: after.type,
        kind: 'text',
        before: before.text,
        after: after.text,
        beforeType: 'string',
        afterType: 'string',
        match: pair.match,
      })
    }
    if (pair.match !== 'stable') continue
    if (before.parentKey !== after.parentKey) {
      moves.push({
        node: before.label,
        type: after.type,
        from: parentLabel(leftRecords, before.parentKey),
        to: parentLabel(rightRecords, after.parentKey),
        reason: 'parent',
        match: 'stable',
      })
      continue
    }
    // Order changes are computed below for all same-parent stable matches.
  }
  // Order moves: compare matched sibling sequences and keep an LIS. Insertions
  // alone leave the LIS intact, so following nodes are not reported as moved.
  const byParent = new Map<string, MatchPair[]>()
  for (const pair of pairs) {
    if (pair.match !== 'stable' || pair.left.parentKey !== pair.right.parentKey) continue
    const list = byParent.get(pair.left.parentKey) ?? []
    list.push(pair)
    byParent.set(pair.left.parentKey, list)
  }
  for (const [parent, group] of byParent) {
    const ordered = [...group].sort((a, b) => a.left.order - b.left.order)
    const rightOrder = [...group].sort((a, b) => a.right.order - b.right.order)
    const positions = ordered.map((pair) => rightOrder.indexOf(pair))
    const keep = lisIndices(positions)
    for (const [index, pair] of ordered.entries()) {
      if (keep.has(index)) continue
      moves.push({
        node: pair.left.label,
        type: pair.right.type,
        from: parentLabel(leftRecords, parent),
        to: parentLabel(rightRecords, parent),
        reason: 'order',
        match: 'stable',
      })
    }
  }
  moves.sort((a, b) => a.node.localeCompare(b.node) || a.reason.localeCompare(b.reason))
  changes.sort(
    (a, b) =>
      a.node.localeCompare(b.node) || a.kind.localeCompare(b.kind) || (a.prop ?? '').localeCompare(b.prop ?? ''),
  )
  return { additions, removals, moves, changes, diagnostics: [] }
}

function failure(
  mode: 'variants' | 'revisions',
  screen: string,
  from: string,
  to: string,
  diagnostic: DiffDiagnostic,
): DesignDiffResult {
  return {
    ok: false,
    mode,
    screen,
    from,
    to,
    additions: [],
    removals: [],
    moves: [],
    changes: [],
    diagnostics: [diagnostic],
  }
}

/** Compare two explicit branches of one current screen. */
export function diffVariantBranches(
  project: DesignProject,
  screenId: string,
  group: string,
  fromBranch: string,
  toBranch: string,
): DesignDiffResult {
  const from = group + ':' + fromBranch
  const to = group + ':' + toBranch
  let left
  let right
  try {
    left = resolveScreenProjection(project, screenId, from)
    right = resolveScreenProjection(project, screenId, to)
  } catch (error) {
    return failure('variants', screenId, from, to, {
      code: 'variant-selection',
      message: error instanceof Error ? error.message : String(error),
    })
  }
  if (left.screen.root === undefined || right.screen.root === undefined) {
    return failure('variants', screenId, from, to, {
      code: 'variant-projection',
      message: 'One selected branch has no renderable projection.',
    })
  }
  const diff = diffProjections(left.screen.root, right.screen.root)
  return {
    ok: diff.diagnostics.length === 0,
    mode: 'variants',
    screen: screenId,
    from,
    to,
    additions: diff.additions,
    removals: diff.removals,
    moves: diff.moves,
    changes: diff.changes,
    diagnostics: diff.diagnostics,
  }
}

function safeRevision(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    !value.startsWith('-') &&
    !/[\s\0\n\r]/.test(value) &&
    /^[A-Za-z0-9._/@{}^~:+-]+$/.test(value)
  )
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ASKPASS: 'echo',
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
    env: gitEnvironment(),
  })
  return result.stdout
}

interface GitTreeEntry {
  readonly mode: string
  readonly oid: string
  readonly size: number
}

function gitTreeRows(source: string): Map<string, GitTreeEntry> {
  const entries = new Map<string, GitTreeEntry>()
  for (const row of source.split('\0')) {
    const parsed = /^(\d{6}) (?:blob|tree|commit) ([0-9a-f]{40,64}) +([\d-]+)\t([\s\S]+)$/.exec(row)
    if (parsed !== null) entries.set(parsed[4]!, { mode: parsed[1]!, oid: parsed[2]!, size: Number(parsed[3]) })
  }
  return entries
}

/** Start at the revision's literal design-directory tree, then only open admitted paths. */
async function committedSourceReader(
  cwd: string,
  commit: string,
  designRel: string,
): Promise<ProjectSourceReader | undefined> {
  const root = gitTreeRows(
    await git(cwd, ['--literal-pathspecs', 'ls-tree', '-z', '-l', '--full-tree', commit, '--', designRel]),
  ).get(designRel)
  if (root?.mode !== '040000') return undefined
  const cache = new Map<string, Promise<Map<string, GitTreeEntry>>>()
  function children(tree: GitTreeEntry): Promise<Map<string, GitTreeEntry>> {
    let listing = cache.get(tree.oid)
    if (listing === undefined) {
      listing = git(cwd, ['ls-tree', '-z', '-l', tree.oid]).then(gitTreeRows)
      cache.set(tree.oid, listing)
    }
    return listing
  }
  async function lookup(path: string): Promise<GitTreeEntry | 'unsupported' | undefined> {
    let current: GitTreeEntry | undefined = root
    for (const part of path.split('/')) {
      if (current === undefined) return undefined
      if (current.mode !== '040000') return 'unsupported'
      current = (await children(current)).get(part)
    }
    return current
  }
  return {
    async read(file, maxBytes) {
      try {
        const entry = await lookup(file)
        if (entry === undefined) return { kind: 'missing' }
        if (entry === 'unsupported' || (entry.mode !== '100644' && entry.mode !== '100755'))
          return { kind: 'unsupported' }
        if (!Number.isSafeInteger(entry.size) || entry.size > maxBytes) return { kind: 'oversized' }
        const result = await execFileAsync('git', ['-C', cwd, 'cat-file', 'blob', entry.oid], {
          timeout: 15000,
          maxBuffer: Math.max(1, maxBytes),
          encoding: 'buffer',
          env: gitEnvironment(),
        })
        return { kind: 'file', bytes: result.stdout }
      } catch {
        return { kind: 'unreadable' }
      }
    },
    async list(directory, maxEntries) {
      try {
        const entry = await lookup(directory)
        if (entry === undefined) return { kind: 'missing' }
        if (entry === 'unsupported' || entry.mode !== '040000') return { kind: 'unsupported' }
        const entries = await children(entry)
        return entries.size > maxEntries ? { kind: 'oversized' } : { kind: 'entries', names: [...entries.keys()] }
      } catch {
        return { kind: 'unreadable' }
      }
    },
  }
}

async function readCommittedProject(folder: string, cwd: string, commit: string, designRel: string) {
  const reader = await committedSourceReader(cwd, commit, designRel)
  if (reader === undefined) return undefined
  const inventory = await readProjectSources(reader)
  return projectFromSources({ folder, kit: kitMetadata, installedKitVersion: KIT_VERSION }, inventory)
}

/** Compare the chosen projection at two locally available revisions. */
export async function diffGitRevisions(
  project: DesignProject,
  screenId: string,
  fromRevision: string,
  toRevision: string,
): Promise<DesignDiffResult> {
  if (!safeRevision(fromRevision) || !safeRevision(toRevision)) {
    return failure('revisions', screenId, fromRevision, toRevision, {
      code: 'revision-invalid',
      message: 'Revision names must be literal local commit names without whitespace or option prefixes.',
    })
  }
  let repoRoot: string
  try {
    repoRoot = (await git(project.folder, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return failure('revisions', screenId, fromRevision, toRevision, {
      code: 'repository-missing',
      message: 'The design folder is not inside a local Git repository.',
    })
  }
  const canonicalFolder = await realpath(project.folder).catch(() => project.folder)
  const canonicalRoot = await realpath(repoRoot).catch(() => repoRoot)
  const designRel = relative(canonicalRoot, canonicalFolder).split(sep).join('/')
  if (designRel === '' || designRel.startsWith('..') || designRel.startsWith('/')) {
    return failure('revisions', screenId, fromRevision, toRevision, {
      code: 'design-folder-outside-repository',
      message: 'The design folder does not resolve inside the repository root.',
    })
  }
  const resolveCommit = async (rev: string): Promise<string | undefined> => {
    try {
      return (await git(repoRoot, ['rev-parse', '--verify', '--end-of-options', rev + '^{commit}'])).trim()
    } catch {
      return undefined
    }
  }
  const fromCommit = await resolveCommit(fromRevision)
  if (fromCommit === undefined) {
    return failure('revisions', screenId, fromRevision, toRevision, {
      code: 'revision-unavailable',
      message: 'Revision "' + fromRevision + '" is not available locally. Fetching is never attempted.',
    })
  }
  const toCommit = await resolveCommit(toRevision)
  if (toCommit === undefined) {
    return failure('revisions', screenId, fromRevision, toRevision, {
      code: 'revision-unavailable',
      message: 'Revision "' + toRevision + '" is not available locally. Fetching is never attempted.',
    })
  }
  const revisions = []
  for (const [label, commit] of [
    [fromRevision, fromCommit],
    [toRevision, toCommit],
  ] as const) {
    let revision
    try {
      revision = await readCommittedProject(project.folder, canonicalRoot, commit, designRel)
    } catch {
      return failure('revisions', screenId, fromRevision, toRevision, {
        code: 'history-unavailable',
        message: 'Revision "' + label + '" could not be read within the local source limits.',
      })
    }
    if (revision === undefined) {
      return failure('revisions', screenId, fromRevision, toRevision, {
        code: 'history-design-missing',
        message: 'Revision "' + label + '" has no regular design directory at ' + designRel + '.',
      })
    }
    const paletteFile = revision.config.themes?.[revision.defaultTheme]
    const globalError = revision.diagnostics.find(
      (entry) =>
        entry.severity === 'error' &&
        ((entry.file === 'design.json' && entry.code !== 'entry-missing') ||
          entry.file === 'tokens.json' ||
          entry.file === 'screens' ||
          entry.file === paletteFile ||
          entry.code === 'duplicate-screen'),
    )
    if (globalError !== undefined) {
      const codes = {
        'kit-version-mismatch': 'history-kit-incompatible',
        'duplicate-screen': 'history-duplicate-screen',
        'project-missing': 'history-missing-input',
        'tokens-missing': 'history-missing-input',
        'source-missing': 'history-missing-input',
      } as Record<string, string>
      return failure('revisions', screenId, fromRevision, toRevision, {
        code: codes[globalError.code] ?? globalError.code,
        message: 'Revision "' + label + '": ' + globalError.message + ' The worktree is never substituted.',
      })
    }
    const screen = revision.screens.find((entry) => entry.id === screenId)
    if (screen === undefined) {
      return failure('revisions', screenId, fromRevision, toRevision, {
        code: 'history-screen-missing',
        message: 'Screen "' + screenId + '" is not present in revision "' + label + '".',
      })
    }
    if (screen.root === undefined || (screen.blockingErrors ?? 0) > 0) {
      const issues = screen.diagnostics.filter((entry) => entry.severity === 'error' && entry.branch === undefined)
      const issue =
        issues.find((entry) => entry.code.startsWith('source-') || entry.code.startsWith('stylesheet-')) ?? issues[0]
      const detail =
        issue === undefined
          ? 'unknown validation error'
          : issue.file + ':' + issue.line + ':' + issue.column + ' ' + issue.message
      return failure('revisions', screenId, fromRevision, toRevision, {
        code: 'history-invalid-projection',
        message:
          'Revision "' +
          label +
          '" does not produce a valid projection: ' +
          detail +
          ' The worktree is never substituted.',
      })
    }
    const fixtureError = revision.diagnostics.find(
      (entry) =>
        entry.severity === 'error' &&
        entry.file.startsWith('fixtures/') &&
        screen.sourceDependencies?.includes(entry.file),
    )
    if (fixtureError !== undefined) {
      return failure('revisions', screenId, fromRevision, toRevision, {
        code: 'history-invalid-projection',
        message: 'Revision "' + label + '": ' + fixtureError.message,
      })
    }
    revisions.push(screen.root)
  }
  const diff = diffProjections(revisions[0]!, revisions[1]!)
  return {
    ok: diff.diagnostics.length === 0,
    mode: 'revisions',
    screen: screenId,
    from: fromCommit,
    to: toCommit,
    additions: diff.additions,
    removals: diff.removals,
    moves: diff.moves,
    changes: diff.changes,
    diagnostics: diff.diagnostics,
  }
}

/** Render a diff result as a compact deterministic text block. */
export function formatDesignDiff(result: DesignDiffResult): string {
  const lines = ['Design diff ' + result.screen + ' (' + result.mode + '): ' + result.from + ' -> ' + result.to]
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) lines.push('  [' + diagnostic.code + '] ' + diagnostic.message)
    return lines.join('\n')
  }
  lines.push(
    'Additions: ' +
      String(result.additions.length) +
      ', removals: ' +
      String(result.removals.length) +
      ', moves: ' +
      String(result.moves.length) +
      ', changes: ' +
      String(result.changes.length) +
      '.',
  )
  for (const node of result.additions) lines.push('  + ' + node.node + ' <' + node.type + '> (' + node.match + ')')
  for (const node of result.removals) lines.push('  - ' + node.node + ' <' + node.type + '> (' + node.match + ')')
  for (const move of result.moves)
    lines.push('  ~ ' + move.node + ' moved (' + move.reason + ': ' + move.from + ' -> ' + move.to + ')')
  for (const change of result.changes) {
    const detail =
      change.kind === 'prop'
        ? 'prop ' +
          String(change.prop) +
          ': ' +
          JSON.stringify(change.before) +
          ' (' +
          change.beforeType +
          ') -> ' +
          JSON.stringify(change.after) +
          ' (' +
          change.afterType +
          ')'
        : change.kind === 'text'
          ? 'text: ' + JSON.stringify(change.before) + ' -> ' + JSON.stringify(change.after)
          : 'type: ' + String(change.before) + ' -> ' + String(change.after)
    lines.push('  * ' + change.node + ' ' + detail)
  }
  return lines.join('\n')
}
