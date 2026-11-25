/**
 * Declarative variant groups: discovery, resolution, and bounded projection
 * enumeration.
 *
 * A Variants wrapper groups mutually exclusive Variant branches. Resolution is
 * pure and structural: it replaces every wrapper with the selected branch's
 * ordinary children, so validation, fixtures, rendering, tools, comments, and
 * the handoff all consume one resolved screen tree. Wrappers never reach the
 * kit renderer.
 */
import type {
  DesignChild,
  DesignElement,
  DesignScreenNode,
  Diagnostic,
  SourceLocation,
  StructuralAddress,
} from './types.ts'

/** Maximum variant groups in one screen file. */
export const MAX_VARIANT_GROUPS = 32
/** Maximum branches in one variant group. */
export const MAX_VARIANT_BRANCHES = 8
/** Maximum reachable projections validated for one screen. */
export const MAX_VARIANT_PROJECTIONS = 64

const ID_PATTERN = /^[a-z][a-z0-9-]*$/
const VARIANT_PROPS = new Set(['id', 'chosen'])
const BRANCH_PROPS = new Set(['branch'])

/** Format a structural address path as #0.2. */
function formatAddress(path: readonly number[]): string {
  return path.length === 0 ? '#' : '#' + path.join('.')
}

/** One selected branch declaration inside a group. */
export interface DiscoveredVariantBranch {
  readonly id: string
  readonly source: SourceLocation
  readonly node: DesignElement
}

/** One discovered group before projection validation. */
export interface DiscoveredVariantGroup {
  readonly id: string
  /** Screen-local path: ancestor group paths joined with a slash. */
  readonly path: string
  readonly source: SourceLocation
  readonly chosen: string
  readonly wholeScreen: boolean
  readonly parentPath?: string
  readonly parentBranch?: string
  readonly node: DesignElement
  readonly branches: readonly DiscoveredVariantBranch[]
}

/** Discovery output. */
export interface VariantDiscovery {
  readonly groups: readonly DiscoveredVariantGroup[]
  readonly diagnostics: readonly Diagnostic[]
}

/** Group path to selected branch id. */
export interface VariantSelection {
  readonly [groupPath: string]: string | undefined
}

/** One resolved projection. */
export interface VariantProjection {
  /** Effective selection, including auto-selected ancestors. */
  readonly selection: Readonly<Record<string, string>>
  readonly screen?: DesignScreenNode
  readonly diagnostics: readonly Diagnostic[]
  /** Whether every explicit selection identified a reachable branch. */
  readonly valid: boolean
}

interface GroupParent {
  readonly path: string
  readonly branch: string
}

interface DiscoveryContext {
  readonly document: DesignElement | DesignScreenNode
  readonly file: string
  readonly diagnostics: Diagnostic[]
  readonly groups: DiscoveredVariantGroup[]
  readonly byPath: Map<string, DiscoveredVariantGroup>
  readonly byNode: Map<DesignElement, DiscoveredVariantGroup>
  readonly seenGroupIds: Set<string>
}

function diagnostic(
  file: string,
  source: SourceLocation,
  code: string,
  message: string,
  extra: { group?: string; branch?: string; nodeId?: string; address?: string; suggestion?: string } = {},
): Diagnostic {
  return {
    severity: 'error',
    code,
    file,
    line: source.line,
    column: source.column,
    ...(extra.group === undefined ? {} : { group: extra.group }),
    ...(extra.branch === undefined ? {} : { branch: extra.branch }),
    ...(extra.nodeId === undefined ? {} : { nodeId: extra.nodeId }),
    ...(extra.address === undefined ? {} : { address: extra.address }),
    message,
    ...(extra.suggestion === undefined ? {} : { suggestion: extra.suggestion }),
  }
}

function propLocation(node: DesignElement, name: string): SourceLocation {
  return node.propLocations?.[name] ?? node.source
}

/** Collect every variant group, including nested and non-chosen ones. */
export function collectVariantGroups(document: DesignElement | DesignScreenNode): VariantDiscovery {
  const ctx: DiscoveryContext = {
    document,
    file: document.source.file,
    diagnostics: [],
    groups: [],
    byPath: new Map(),
    byNode: new Map(),
    seenGroupIds: new Set(),
  }
  const visit = (node: DesignChild | DesignScreenNode, parent: GroupParent | undefined): void => {
    if (node.kind === 'text') return
    if (node.type === 'Variants') {
      readGroup(ctx, node, parent, visit)
      return
    }
    if (node.type === 'Variant') {
      ctx.diagnostics.push(
        diagnostic(ctx.file, node.source, 'variant-outside-group', '<Variant> must be a direct child of <Variants>.', {
          ...(parent === undefined ? {} : { group: parent.path, branch: parent.branch }),
          address: node.address.label,
        }),
      )
      for (const child of node.children) visit(child, parent)
      return
    }
    for (const child of node.children) visit(child, parent)
  }
  visit(document, undefined)
  return { groups: ctx.groups, diagnostics: ctx.diagnostics }
}

/** Read one group and recurse into all of its branches. */
function readGroup(
  ctx: DiscoveryContext,
  node: DesignElement,
  parent: GroupParent | undefined,
  visit: (node: DesignChild | DesignScreenNode, parent: GroupParent | undefined) => void,
): void {
  for (const name of Object.keys(node.props)) {
    if (VARIANT_PROPS.has(name)) continue
    ctx.diagnostics.push(
      diagnostic(
        ctx.file,
        propLocation(node, name),
        'variant-unknown-prop',
        '<Variants> does not accept prop "' + name + '".',
        {
          ...(parent === undefined ? {} : { group: parent.path, branch: parent.branch }),
          address: node.address.label,
          suggestion: 'Declare the group with id and chosen, and each branch with branch.',
        },
      ),
    )
  }
  const rawId = node.props.id
  const rawChosen = node.props.chosen
  const id = typeof rawId === 'string' && rawId !== '' ? rawId : undefined
  const chosen = typeof rawChosen === 'string' && rawChosen !== '' ? rawChosen : undefined
  if (id === undefined) {
    ctx.diagnostics.push(
      diagnostic(ctx.file, node.source, 'variant-id-missing', '<Variants> requires a stable id.', {
        ...(parent === undefined ? {} : { group: parent.path, branch: parent.branch }),
        address: node.address.label,
        suggestion: 'Add id="layout".',
      }),
    )
  } else if (!ID_PATTERN.test(id)) {
    ctx.diagnostics.push(
      diagnostic(
        ctx.file,
        propLocation(node, 'id'),
        'variant-id-format',
        'Group id "' + id + '" must match [a-z][a-z0-9-]*.',
        {
          ...(parent === undefined ? {} : { group: parent.path, branch: parent.branch }),
        },
      ),
    )
  }
  if (chosen === undefined) {
    ctx.diagnostics.push(
      diagnostic(ctx.file, node.source, 'variant-chosen-missing', '<Variants> requires chosen to name one branch.', {
        ...(parent === undefined ? {} : { group: parent.path, branch: parent.branch }),
        address: node.address.label,
        suggestion: 'Add chosen="compact" and declare a <Variant branch="compact">.',
      }),
    )
  }
  const branchNodes: DesignElement[] = []
  for (const child of node.children) {
    if (child.kind === 'text') {
      if (child.value.trim() !== '') {
        ctx.diagnostics.push(
          diagnostic(
            ctx.file,
            child.source,
            'variant-branch-extra-child',
            '<Variants> accepts only <Variant> children.',
            {
              ...(parent === undefined ? {} : { group: parent.path, branch: parent.branch }),
            },
          ),
        )
      }
      continue
    }
    if (child.type !== 'Variant') {
      ctx.diagnostics.push(
        diagnostic(
          ctx.file,
          child.source,
          'variant-branch-extra-child',
          '<Variants> accepts only <Variant> children, not <' + child.type + '>.',
          {
            ...(parent === undefined ? {} : { group: parent.path, branch: parent.branch }),
          },
        ),
      )
      continue
    }
    branchNodes.push(child)
  }
  if (branchNodes.length < 2) {
    ctx.diagnostics.push(
      diagnostic(
        ctx.file,
        node.source,
        'variant-branch-min',
        'A <Variants> group requires at least two <Variant> children.',
        {
          ...(parent === undefined ? {} : { group: parent.path, branch: parent.branch }),
          address: node.address.label,
        },
      ),
    )
  }
  if (branchNodes.length > MAX_VARIANT_BRANCHES) {
    ctx.diagnostics.push(
      diagnostic(
        ctx.file,
        node.source,
        'variant-branch-limit',
        'A <Variants> group declares ' +
          String(branchNodes.length) +
          ' branches; the limit is ' +
          String(MAX_VARIANT_BRANCHES) +
          '.',
        {
          ...(parent === undefined ? {} : { group: parent.path, branch: parent.branch }),
          address: node.address.label,
        },
      ),
    )
  }
  if (ctx.groups.length >= MAX_VARIANT_GROUPS) {
    ctx.diagnostics.push(
      diagnostic(
        ctx.file,
        node.source,
        'variant-group-limit',
        'This screen declares more than ' + String(MAX_VARIANT_GROUPS) + ' variant groups.',
        { ...(parent === undefined ? {} : { group: parent.path, branch: parent.branch }) },
      ),
    )
    return
  }
  const basePath = id ?? '@' + String(node.source.line) + ':' + String(node.source.column)
  const path = parent === undefined ? basePath : parent.path + '/' + basePath
  const branches: DiscoveredVariantBranch[] = []
  const branchIds = new Set<string>()
  for (const branchNode of branchNodes) {
    const rawBranch = branchNode.props.branch
    const branchId = typeof rawBranch === 'string' && rawBranch !== '' ? rawBranch : undefined
    if (branchId === undefined) {
      ctx.diagnostics.push(
        diagnostic(ctx.file, branchNode.source, 'variant-branch-id', '<Variant> requires a stable branch id.', {
          group: path,
          address: branchNode.address.label,
          suggestion: 'Add branch="compact".',
        }),
      )
      continue
    }
    if (!ID_PATTERN.test(branchId)) {
      ctx.diagnostics.push(
        diagnostic(
          ctx.file,
          propLocation(branchNode, 'branch'),
          'variant-branch-format',
          'Branch id "' + branchId + '" must match [a-z][a-z0-9-]*.',
          {
            group: path,
          },
        ),
      )
      continue
    }
    if (branchIds.has(branchId)) {
      ctx.diagnostics.push(
        diagnostic(
          ctx.file,
          propLocation(branchNode, 'branch'),
          'variant-branch-duplicate',
          'Group #' + (id ?? path) + ' repeats branch id "' + branchId + '".',
          {
            group: path,
            branch: branchId,
          },
        ),
      )
      continue
    }
    for (const name of Object.keys(branchNode.props)) {
      if (BRANCH_PROPS.has(name)) continue
      ctx.diagnostics.push(
        diagnostic(
          ctx.file,
          propLocation(branchNode, name),
          'variant-branch-unknown-prop',
          '<Variant> does not accept prop "' + name + '".',
          {
            group: path,
            branch: branchId,
            suggestion: 'Only branch is accepted on <Variant>.',
          },
        ),
      )
    }
    branchIds.add(branchId)
    branches.push({ id: branchId, source: branchNode.source, node: branchNode })
  }
  if (chosen !== undefined && branches.length > 0 && !branchIds.has(chosen)) {
    ctx.diagnostics.push(
      diagnostic(
        ctx.file,
        propLocation(node, 'chosen'),
        'variant-chosen-unknown',
        'Group #' + (id ?? path) + ' chooses "' + chosen + '", which no branch declares.',
        {
          group: path,
          suggestion: 'Known branches: ' + [...branchIds].join(', ') + '.',
        },
      ),
    )
  }
  if (id !== undefined && ctx.seenGroupIds.has(id)) {
    ctx.diagnostics.push(
      diagnostic(
        ctx.file,
        propLocation(node, 'id'),
        'variant-duplicate-group',
        'Duplicate variant group id "#' + id + '"; group ids are screen-local.',
        {
          group: path,
        },
      ),
    )
  } else if (id !== undefined) {
    ctx.seenGroupIds.add(id)
  }

  const wholeScreen = node === ctx.document
  if (wholeScreen) validateWholeScreenBranches(ctx, node, path, branches)

  const group: DiscoveredVariantGroup = {
    id: id ?? path,
    path,
    source: node.source,
    chosen: chosen ?? '',
    wholeScreen,
    ...(parent === undefined ? {} : { parentPath: parent.path, parentBranch: parent.branch }),
    node,
    branches,
  }
  if (id !== undefined && !ctx.byPath.has(path)) {
    ctx.groups.push(group)
    ctx.byPath.set(path, group)
    ctx.byNode.set(node, group)
  }
  for (const branch of branches) {
    for (const child of branch.node.children) visit(child, { path, branch: branch.id })
  }
}

/** Check whole-screen branch shape and identity agreement. */
function validateWholeScreenBranches(
  ctx: DiscoveryContext,
  groupNode: DesignElement,
  path: string,
  branches: readonly DiscoveredVariantBranch[],
): void {
  const ids: { id: string; source: SourceLocation; branch: string }[] = []
  for (const branch of branches) {
    const elements = branch.node.children.filter((child): child is DesignElement => child.kind === 'element')
    const text = branch.node.children.filter((child) => child.kind === 'text' && child.value.trim() !== '')
    if (text.length > 0) {
      ctx.diagnostics.push(
        diagnostic(
          ctx.file,
          text[0]!.source,
          'variant-screen-branch-shape',
          'A whole-screen <Variant> branch accepts one <Screen> element only.',
          {
            group: path,
            branch: branch.id,
          },
        ),
      )
    }
    if (elements.length === 0) {
      ctx.diagnostics.push(
        diagnostic(
          ctx.file,
          branch.source,
          'variant-screen-missing',
          'Whole-screen branch "' + branch.id + '" must contain one <Screen>.',
          {
            group: path,
            branch: branch.id,
          },
        ),
      )
      continue
    }
    if (elements.length > 1) {
      ctx.diagnostics.push(
        diagnostic(
          ctx.file,
          branch.source,
          'variant-screen-multiple',
          'Whole-screen branch "' +
            branch.id +
            '" contains ' +
            String(elements.length) +
            ' elements; exactly one <Screen> is required.',
          {
            group: path,
            branch: branch.id,
          },
        ),
      )
    }
    const screen = elements.find((element) => element.type === 'Screen')
    if (screen === undefined) {
      ctx.diagnostics.push(
        diagnostic(
          ctx.file,
          elements[0]!.source,
          'variant-screen-missing',
          'Whole-screen branch "' + branch.id + '" must contain one <Screen>.',
          {
            group: path,
            branch: branch.id,
          },
        ),
      )
      continue
    }
    const id = typeof screen.props.id === 'string' ? screen.props.id : ''
    if (id === '') {
      ctx.diagnostics.push(
        diagnostic(
          ctx.file,
          screen.source,
          'variant-screen-identity',
          'Whole-screen branch "' + branch.id + '" needs a Screen id.',
          {
            group: path,
            branch: branch.id,
          },
        ),
      )
      continue
    }
    ids.push({ id, source: screen.source, branch: branch.id })
  }
  const first = ids[0]
  if (first === undefined) return
  for (const entry of ids.slice(1)) {
    if (entry.id !== first.id) {
      ctx.diagnostics.push(
        diagnostic(
          ctx.file,
          entry.source,
          'variant-screen-identity',
          'Whole-screen branches must share one Screen id; branch "' +
            entry.branch +
            '" declares "' +
            entry.id +
            '" but "' +
            first.branch +
            '" declares "' +
            first.id +
            '".',
          { group: path, branch: entry.branch },
        ),
      )
    }
  }
  void groupNode
}

function diagnosticAtNode(
  file: string,
  node: DesignElement,
  group: DiscoveredVariantGroup | undefined,
  branch: string | undefined,
  code: string,
  message: string,
  suggestion?: string,
): Diagnostic {
  return diagnostic(file, node.source, code, message, {
    ...(group === undefined ? {} : { group: group.path }),
    ...(branch === undefined ? {} : { branch }),
    ...(node.id === undefined || node.id === '' ? { address: node.address.label } : { nodeId: node.id }),
    ...(suggestion === undefined ? {} : { suggestion }),
  })
}

/** Recompute structural addresses after wrappers are removed. */
function reindexTree(node: DesignChild | DesignScreenNode, path: readonly number[]): DesignChild | DesignScreenNode {
  if (node.kind === 'text') return node
  let index = 0
  const children: DesignChild[] = []
  for (const child of node.children) {
    if (child.kind === 'text') {
      children.push(child)
      continue
    }
    children.push(reindexTree(child, [...path, index]))
    index += 1
  }
  return { ...node, address: { path, label: formatAddress(path) } as StructuralAddress, children }
}

interface ResolutionState {
  readonly file: string
  readonly groups: Map<string, DiscoveredVariantGroup>
  readonly byNode: Map<DesignElement, DiscoveredVariantGroup>
  readonly requested: Map<string, string>
  readonly explicit: Set<string>
  readonly effective: Map<string, string>
  readonly visited: Set<string>
  readonly diagnostics: Diagnostic[]
  valid: boolean
}

function selectionFromContext(state: ResolutionState, path: string, group: DiscoveredVariantGroup): string {
  return state.requested.get(path) ?? group.chosen
}

/**
 * Resolve one projection from a parsed document.
 * @param document - parsed screen or whole-screen Variants wrapper.
 * @param selection - group path to branch id overrides; empty uses chosen.
 */
export function resolveVariantDocument(
  document: DesignElement | DesignScreenNode,
  selection: VariantSelection = {},
): VariantProjection {
  const discovery = collectVariantGroups(document)
  const byPath = new Map(discovery.groups.map((group) => [group.path, group]))
  const state: ResolutionState = {
    file: document.source.file,
    groups: byPath,
    byNode: new Map(discovery.groups.map((group) => [group.node, group])),
    requested: new Map(),
    explicit: new Set(),
    effective: new Map(),
    visited: new Set(),
    diagnostics: [...discovery.diagnostics],
    valid: true,
  }
  for (const [path, branch] of Object.entries(selection)) {
    if (branch === undefined) continue
    const group = byPath.get(path)
    if (group === undefined) {
      state.valid = false
      state.diagnostics.push(
        diagnostic(
          state.file,
          document.source,
          'variant-selection-unknown',
          'Variant selection names group "' + path + '", which this screen does not declare.',
          { group: path, suggestion: 'Known groups: ' + [...byPath.keys()].join(', ') + '.' },
        ),
      )
      continue
    }
    if (!group.branches.some((candidate) => candidate.id === branch)) {
      state.valid = false
      state.diagnostics.push(
        diagnostic(
          state.file,
          group.source,
          'variant-selection-branch',
          'Group "#' + group.id + '" does not declare branch "' + branch + '".',
          {
            group: path,
            branch,
            suggestion: 'Known branches: ' + group.branches.map((entry) => entry.id).join(', ') + '.',
          },
        ),
      )
      continue
    }
    state.requested.set(path, branch)
    state.explicit.add(path)
  }

  // Selecting a nested group chooses the ancestor branches that expose it,
  // unless an explicit ancestor choice contradicts the required path.
  for (const path of [...state.explicit]) {
    let group = byPath.get(path)
    while (group?.parentPath !== undefined) {
      const parent = byPath.get(group.parentPath)
      if (parent === undefined || group.parentBranch === undefined) break
      const requestedParent = state.requested.get(parent.path)
      if (requestedParent !== undefined && requestedParent !== group.parentBranch) {
        state.valid = false
        state.diagnostics.push(
          diagnostic(
            state.file,
            group.source,
            'variant-selection-unreachable',
            'Group "' +
              group.path +
              '" is reachable only through branch "' +
              group.parentBranch +
              '" of "#' +
              parent.id +
              '", but the selection chooses "' +
              requestedParent +
              '".',
            { group: group.path, branch: state.requested.get(group.path) },
          ),
        )
        break
      }
      if (requestedParent === undefined) state.requested.set(parent.path, group.parentBranch)
      group = parent
    }
  }

  const resolveNode = (node: DesignChild | DesignScreenNode, parent: GroupParent | undefined): DesignChild[] => {
    if (node.kind === 'text') return [node]
    if (node.type === 'Variants') {
      const group = state.byNode.get(node)
      if (group === undefined) return []
      const branchId = selectionFromContext(state, group.path, group)
      const branch = group.branches.find((candidate) => candidate.id === branchId)
      if (branch === undefined) {
        state.valid = false
        state.diagnostics.push(
          diagnosticAtNode(
            state.file,
            node,
            group,
            branchId,
            'variant-branch-missing',
            'Group "#' + group.id + '" cannot resolve branch "' + branchId + '".',
          ),
        )
        return []
      }
      state.visited.add(group.path)
      state.effective.set(group.path, branchId)
      const resolvedChildren: DesignChild[] = []
      for (const child of branch.node.children) {
        for (const resolved of resolveNode(child, { path: group.path, branch: branchId }))
          resolvedChildren.push(resolved)
      }
      if (!group.wholeScreen) return resolvedChildren
      const screens = resolvedChildren.filter(
        (child): child is DesignElement => child.kind === 'element' && child.type === 'Screen',
      )
      if (screens.length !== 1) {
        state.valid = false
        state.diagnostics.push(
          diagnosticAtNode(
            state.file,
            node,
            group,
            branchId,
            'variant-screen-missing',
            'Whole-screen branch "' + branchId + '" did not resolve to exactly one <Screen>.',
          ),
        )
        return []
      }
      return [screens[0] as DesignChild]
    }
    const children: DesignChild[] = []
    for (const child of node.children) {
      for (const resolved of resolveNode(child, parent)) children.push(resolved)
    }
    return [{ ...node, children } as DesignChild]
  }

  const resolved = resolveNode(document, undefined)
  const screens = resolved.filter(
    (child): child is DesignElement => child.kind === 'element' && child.type === 'Screen',
  )
  let screen: DesignScreenNode | undefined
  if (screens.length === 1) {
    const candidate = reindexTree(screens[0] as DesignChild, []) as DesignScreenNode
    screen = { ...candidate, type: 'Screen', id: candidate.id ?? '' }
  }
  if (screen === undefined && state.diagnostics.every((entry) => entry.code !== 'variant-screen-missing')) {
    state.valid = false
    state.diagnostics.push(
      diagnostic(
        state.file,
        document.source,
        'variant-screen-missing',
        'The projection does not resolve to one <Screen>.',
        {},
      ),
    )
  }
  for (const path of state.explicit) {
    if (state.visited.has(path)) continue
    const group = byPath.get(path)
    state.valid = false
    state.diagnostics.push(
      diagnostic(
        state.file,
        group?.source ?? document.source,
        'variant-selection-unreachable',
        'Variant selection for group "' +
          path +
          '" is not reachable in this projection; choose its ancestor branch first.',
        { group: path },
      ),
    )
  }
  const effective: Record<string, string> = {}
  for (const [path, branch] of state.effective) effective[path] = branch
  return {
    selection: effective,
    ...(state.valid && screen !== undefined ? { screen } : {}),
    diagnostics: state.diagnostics,
    valid: state.valid,
  }
}

/** Stable key for one effective selection. */
export function variantSelectionKey(selection: Readonly<Record<string, string | undefined>>): string {
  return Object.entries(selection)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, branch]) => path + ':' + branch)
    .join('|')
}

/** Human-readable selection summary, for diagnostics. */
export function formatVariantSelection(selection: Readonly<Record<string, string | undefined>>): string {
  const entries = Object.entries(selection)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) return 'chosen branches'
  return entries.map(([path, branch]) => path + '=' + branch).join(', ')
}

/** Enumerate every reachable branch combination, bounded by a limit. */
export function enumerateVariantSelections(
  document: DesignElement | DesignScreenNode,
  limit = MAX_VARIANT_PROJECTIONS,
): { selections: Readonly<Record<string, string>>[]; truncated: boolean } {
  const discovery = collectVariantGroups(document)
  const byNode = new Map(discovery.groups.map((group) => [group.node, group]))
  const out: Record<string, string>[] = []
  let truncated = false
  const expandNode = (
    node: DesignChild | DesignScreenNode,
    current: Record<string, string>,
  ): Record<string, string>[] => {
    if (node.kind === 'text') return [current]
    if (node.type === 'Variants') {
      const group = byNode.get(node)
      if (group === undefined) return [current]
      const results: Record<string, string>[] = []
      for (const branch of group.branches) {
        const selected = { ...current, [group.path]: branch.id }
        let children: Record<string, string>[] = [selected]
        for (const child of branch.node.children) {
          if (child.kind === 'text') continue
          const next: Record<string, string>[] = []
          for (const base of children) {
            for (const expanded of expandNode(child, base)) {
              next.push(expanded)
              if (next.length >= limit) {
                truncated = true
                break
              }
            }
            if (next.length >= limit) break
          }
          children = next
          if (children.length >= limit) break
        }
        for (const entry of children) {
          if (results.length >= limit) {
            truncated = true
            break
          }
          results.push(entry)
        }
        if (results.length >= limit) break
      }
      return results
    }
    let combinations: Record<string, string>[] = [current]
    for (const child of node.children) {
      if (child.kind === 'text') continue
      const next: Record<string, string>[] = []
      for (const base of combinations) {
        for (const expanded of expandNode(child, base)) {
          if (next.length >= limit) {
            truncated = true
            break
          }
          next.push(expanded)
        }
        if (next.length >= limit) break
      }
      combinations = next
      if (combinations.length >= limit) {
        truncated = true
        break
      }
    }
    return combinations
  }
  for (const selection of expandNode(document, {})) {
    out.push(selection)
    if (out.length >= limit) {
      truncated = true
      break
    }
  }
  return { selections: out, truncated }
}

/** Baseline selection plus one explicitly chosen branch. */
export function branchSelection(
  baseline: Readonly<Record<string, string>>,
  group: DiscoveredVariantGroup,
  branch: string,
): VariantSelection {
  return { ...baseline, [group.path]: branch }
}
/** Maximum canonical variant identity length carried by a comment context. */
export const VARIANT_IDENTITY_MAX = 120

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Bounded canonical identity for one effective selection. Normal and explicit
 * views of the same projection share it; alternate selections differ. Long
 * selections keep a readable group/branch prefix plus a stable hash.
 */
export function canonicalVariantIdentity(selection: Readonly<Record<string, string | undefined>>): string | undefined {
  const entries = Object.entries(selection)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) return undefined
  const full = entries.map(([path, branch]) => path + ':' + branch).join('|')
  if (full.length <= VARIANT_IDENTITY_MAX) return full
  const prefix = entries
    .slice(0, 2)
    .map(([path, branch]) => path + ':' + branch)
    .join('|')
  return prefix + '|#' + fnv1a(full)
}
