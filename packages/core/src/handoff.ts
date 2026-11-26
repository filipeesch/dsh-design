/**
 * Chosen-only handoff planning and normalized DSX serialization.
 *
 * Handoff never reads review drafts, comparison chrome, or discarded branches.
 * It resolves one explicit projection matrix from the
 * current validated chosen design, then prints an editable DSL tree that keeps
 * stable ids, declarative interaction references, and named screen states.
 */
import type { KitMetadata } from './metadata.ts'
import { navigationRelationships, navigationTargets } from './navigation.ts'
import type { PreviewRelationship, PreviewScreenContext, PreviewSituation, PreviewTarget } from './preview.ts'
import { formatReference, isReference } from './refs.ts'
import { stateCompatibility } from './state.ts'
import type {
  Breakpoint,
  DesignChild,
  DesignElement,
  DesignProject,
  DesignPropValue,
  DesignScreenNode,
  NamedState,
  ProjectJourney,
  ProjectScreen,
} from './types.ts'

/** Maximum screen/state/breakpoint projections in one handoff. */
export const MAX_HANDOFF_PROJECTIONS = 24

/** Maximum selected plus supporting screens in one handoff closure. */
export const MAX_HANDOFF_SCREENS = 32

/**
 * Explicit selector for the unnamed default screen state. A named state may
 * itself be called "default", so a normal state name is never treated as the
 * unnamed alias. State names cannot contain "$", making this unambiguous.
 */
export const HANDOFF_UNNAMED_STATE = '$default'

/** One selected state assignment for a projection. */
export interface HandoffStateSelection {
  /** State name, or undefined for the unnamed default state. */
  readonly name?: string
  /** Validated assignment, absent for the default state. */
  readonly assignment?: NamedState
}

/** Whether a screen is part of the requested matrix or supports it. */
export type HandoffScreenRole = 'selected' | 'supporting'

/** One screen retained in the package. */
export interface HandoffScreenPlan {
  readonly id: string
  readonly file: string
  /** Requested matrix screen, or a source included only to validate it. */
  readonly role: HandoffScreenRole
  /** Why a supporting screen is present; empty for a selected screen. */
  readonly supportReasons: readonly string[]
  /** Expanded chosen projection without variant wrappers. */
  readonly root: DesignScreenNode
  /** Every validated named state declared by the chosen projection. */
  readonly states: readonly NamedState[]
  /** Effective chosen branch selection, if the screen declares groups. */
  readonly chosen: Readonly<Record<string, string>>
  /** Normalized editable DSX source. */
  readonly source: string
}

/** One requested layout/screenshot projection. */
export interface HandoffProjection {
  readonly id: string
  readonly screen: string
  /** Named state, or undefined for the unnamed default state. */
  readonly state?: string
  /** `$default` or the named state, for unambiguous manifest and file identity. */
  readonly stateName: string
  readonly stateAssignment?: NamedState
  readonly breakpoint: Breakpoint
}

/** One relevant acceptance journey and the screens it needs. */
export interface HandoffJourneyPlan {
  readonly id: string
  readonly file: string
  readonly journey: NonNullable<ProjectJourney['journey']>
  readonly requiresScreens: readonly string[]
  /** Required screens outside the requested screen selection. */
  readonly outsideScreens: readonly string[]
}

/** One relationship endpoint and whether the requested matrix renders it. */
export interface HandoffContextTarget extends PreviewTarget {
  readonly evidence: 'selected' | 'outside'
}

/** Descriptive evidence only; not a preview configuration or simulation control. */
export interface HandoffContext {
  readonly screens: Readonly<Record<string, PreviewScreenContext>>
  readonly situations: readonly (Omit<PreviewSituation, 'target'> & { target: HandoffContextTarget })[]
  readonly relationships: readonly (Omit<PreviewRelationship, 'from' | 'to'> & {
    from: HandoffContextTarget
    to: HandoffContextTarget
  })[]
}

/** A complete, validated handoff work plan. */
export interface HandoffPlan {
  /** Requested matrix screens. */
  readonly screens: readonly HandoffScreenPlan[]
  /** Bounded chosen-source closure included only to validate the matrix. */
  readonly supportingScreens: readonly HandoffScreenPlan[]
  readonly projections: readonly HandoffProjection[]
  readonly journeys: readonly HandoffJourneyPlan[]
  /** Durable descriptions and chosen-source relationships; never executable. */
  readonly context?: HandoffContext
  /** Requested evidence breakpoints. */
  readonly breakpoints: readonly Breakpoint[]
  /** Every configured breakpoint, preserved in design.json support inputs. */
  readonly allBreakpoints: readonly Breakpoint[]
}

/** Options accepted by the handoff selection resolver. */
export interface HandoffSelectionOptions {
  readonly screens?: readonly string[]
  readonly states?: readonly string[]
  readonly breakpoints?: readonly string[]
  /** Kit metadata used to validate named-state compatibility before rendering. */
  readonly kit?: KitMetadata
}

/** Why a handoff selection was rejected, with a stable machine code. */
export class HandoffSelectionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'HandoffSelectionError'
    this.code = code
  }
}

function selectionError(code: string, message: string): never {
  throw new HandoffSelectionError(code, message)
}

/** A screen whose chosen projection is safe to hand off. */
function validChosen(screen: ProjectScreen): boolean {
  return (
    screen.id !== '' &&
    screen.root !== undefined &&
    (screen.blockingErrors ?? 0) === 0 &&
    screen.variantDocumentCurrent !== false
  )
}

/** One state assignment canonical form, without source locations. */
export function canonicalState(state: NamedState | undefined): unknown {
  if (state === undefined) return null
  return {
    name: state.name,
    open: [...state.open],
    tabs: { ...state.tabs },
    values: { ...state.values },
    ...(state.disclosures === undefined
      ? {}
      : { disclosures: Object.fromEntries(Object.entries(state.disclosures).sort(([a], [b]) => a.localeCompare(b))) }),
  }
}

/** Normalize duplicate selections while preserving caller order. */
function uniqueStrings(value: readonly string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const result: string[] = []
  for (const entry of value) {
    const trimmed = entry.trim()
    if (trimmed !== '' && !result.includes(trimmed)) result.push(trimmed)
  }
  return result
}

/** Quote one DSL string literal. */
function quote(value: string): string {
  return JSON.stringify(value)
}

/** Render one declarative or literal prop value as DSL text. */
export function renderDesignValue(value: DesignPropValue): string {
  if (isReference(value)) return formatReference(value)
  if (Array.isArray(value)) return '[' + value.map(renderDesignValue).join(', ') + ']'
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort((left, right) => left.localeCompare(right))
    return (
      '{' +
      keys
        .map((key) => quote(key) + ': ' + renderDesignValue((value as Record<string, DesignPropValue>)[key]!))
        .join(', ') +
      '}'
    )
  }
  return JSON.stringify(value)
}

/** Render the reserved Screen states object from validated metadata. */
export function renderNamedStates(states: readonly NamedState[]): string {
  const entries = states.map((state) => {
    const fields: string[] = []
    if (state.open.length > 0) fields.push('open: ' + renderDesignValue([...state.open]))
    if (Object.keys(state.tabs).length > 0) fields.push('tabs: ' + renderDesignValue({ ...state.tabs }))
    if (Object.keys(state.values).length > 0) {
      const values: Record<string, DesignPropValue> = {}
      for (const [name, value] of Object.entries(state.values)) {
        values[name] = Array.isArray(value) ? [...value] : (value as DesignPropValue)
      }
      fields.push('values: ' + renderDesignValue(values))
    }
    if (state.disclosures !== undefined && Object.keys(state.disclosures).length > 0) {
      fields.push('disclosures: ' + renderDesignValue({ ...state.disclosures }))
    }
    return quote(state.name) + ': {' + fields.join(', ') + '}'
  })
  return '{' + entries.join(', ') + '}'
}

/** Render one element opening tag. */
function openingTag(node: DesignElement | DesignScreenNode, states?: readonly NamedState[]): string {
  const id = node.id !== undefined && node.id !== '' ? 'id=' + quote(node.id) : ''
  const props = Object.entries(node.props)
    .filter(([name]) => name !== 'id' && name !== 'states')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) =>
      typeof value === 'string' && !isReference(value)
        ? name + '=' + quote(value)
        : name + '={' + renderDesignValue(value) + '}',
    )
  const stateProp = states !== undefined && states.length > 0 ? 'states={' + renderNamedStates(states) + '}' : ''
  const attributes = [id, ...props, stateProp].filter((entry) => entry !== '').join(' ')
  return '<' + node.type + (attributes === '' ? '' : ' ' + attributes)
}

/** Render one node and its children with stable two-space indentation. */
function renderNode(node: DesignChild | DesignScreenNode, depth: number, states?: readonly NamedState[]): string[] {
  if (node.kind === 'text') {
    const body = node.itemField === undefined ? '{' + quote(node.value) + '}' : '{item(' + quote(node.itemField) + ')}'
    return ['  '.repeat(depth) + body]
  }
  const indent = '  '.repeat(depth)
  const opening = openingTag(node, states)
  if (node.children.length === 0) return [indent + opening + ' />']
  const lines = [indent + opening + '>']
  for (const child of node.children) lines.push(...renderNode(child, depth + 1))
  lines.push(indent + '</' + node.type + '>')
  return lines
}

/**
 * Print one expanded chosen screen as normalized, editable DSX.
 * Stable ids, interactions, and named states are preserved; source locations,
 * variant wrappers, discarded branches, and review data are not emitted.
 */
export function serializeScreen(root: DesignScreenNode, states: readonly NamedState[] = []): string {
  if (root.type !== 'Screen') throw new Error('A handoff screen must be a Screen, got <' + root.type + '>.')
  return renderNode(root, 0, states).join('\n') + '\n'
}

/** Collision-free projection identity: length-prefixed tuple components. */
export function handoffProjectionId(screen: string, stateName: string, breakpoint: string): string {
  return [screen, stateName, breakpoint].map((part) => String(part.length) + '_' + part).join('_') // state and screen names cannot contain underscores, and lengths disambiguate every tuple
}

/** Project an informational neighborhood onto the requested evidence matrix. */
function handoffContext(
  project: DesignProject,
  projections: readonly HandoffProjection[],
  kit?: KitMetadata,
): HandoffContext | undefined {
  const selected = new Set(projections.map((projection) => projection.screen))
  const selections = new Set(projections.map((projection) => JSON.stringify([projection.screen, projection.state])))
  const covered = (target: PreviewTarget): boolean => selections.has(JSON.stringify([target.screen, target.state]))
  const relevant = (target: PreviewTarget): boolean =>
    target.situation === undefined ? selected.has(target.screen) : covered(target)
  const evidence = (target: PreviewTarget, sourceAppliesToAllStates = false): HandoffContextTarget => ({
    ...target,
    evidence: (sourceAppliesToAllStates ? selected.has(target.screen) : covered(target)) ? 'selected' : 'outside',
  })
  const screens = Object.fromEntries(
    Object.entries(project.preview?.screens ?? {})
      .filter(([screen]) => selected.has(screen))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  const chosen = project.screens.flatMap((screen) =>
    screen.root !== undefined && validChosen(screen) ? navigationRelationships(screen.root, kit) : [],
  )
  const relationships = [...chosen, ...(project.preview?.relationships ?? [])].flatMap((edge) => {
    if (!relevant(edge.from) && !relevant(edge.to)) return []
    return [{ ...edge, from: evidence(edge.from, edge.kind === 'prototype'), to: evidence(edge.to) }]
  })
  const referenced = new Set(relationships.flatMap((edge) => [edge.from.situation, edge.to.situation]))
  const situations = (project.preview?.situations ?? []).flatMap((item) =>
    covered(item.target) || selected.has(item.parent) || referenced.has(item.id)
      ? [{ ...item, target: evidence(item.target) }]
      : [],
  )
  return Object.keys(screens).length === 0 && situations.length === 0 && relationships.length === 0
    ? undefined
    : { screens, situations, relationships }
}

/** Build the retained screen plan, including its normalized source. */
function screenPlan(
  screen: ProjectScreen,
  role: HandoffScreenRole,
  supportReasons: readonly string[],
): HandoffScreenPlan {
  const root = screen.root as DesignScreenNode
  return {
    id: screen.id,
    file: screen.file,
    role,
    supportReasons,
    root,
    states: screen.states,
    chosen: screen.chosenSelection ?? {},
    source: serializeScreen(root, screen.states),
  }
}

/** Validate one state assignment against the chosen tree before rendering. */
function stateSelection(
  screen: ProjectScreen,
  requested: string[] | undefined,
  kit: KitMetadata | undefined,
): HandoffStateSelection[] {
  const declarations = screen.states
  const selected =
    requested === undefined
      ? [{}, ...declarations.map((assignment) => ({ name: assignment.name, assignment }))]
      : requested.map((name) => {
          if (name === HANDOFF_UNNAMED_STATE) return {}
          const assignment = declarations.find((candidate) => candidate.name === name)
          if (assignment === undefined) {
            selectionError(
              'unknown-state',
              'Screen "' +
                screen.id +
                '" does not declare state "' +
                name +
                '". Declared states: ' +
                (declarations.map((entry) => entry.name).join(', ') || 'none') +
                '. Narrow --screens or include "' +
                HANDOFF_UNNAMED_STATE +
                '".',
            )
          }
          return { name: assignment.name, assignment }
        })
  if (kit !== undefined) {
    for (const entry of selected) {
      if (entry.assignment === undefined) continue
      const issues = stateCompatibility(screen.root as DesignScreenNode, entry.assignment, kit)
      if (issues.length > 0) {
        selectionError(
          'incompatible-state',
          'State "' + entry.name + '" is incompatible with screen "' + screen.id + '": ' + issues.join('; ') + '.',
        )
      }
    }
  }
  return selected
}

/**
 * Resolve and validate the complete requested matrix before any browser work.
 *
 * Omitted screens default to every valid chosen screen, omitted states to the
 * default plus every named state per screen, and omitted breakpoints to every
 * configured breakpoint. Explicit selectors must exist and be compatible with
 * the chosen projection.
 */
export function resolveHandoffPlan(project: DesignProject, options: HandoffSelectionOptions = {}): HandoffPlan {
  const projectErrors = project.diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === 'error' &&
      (diagnostic.file === 'design.json' ||
        diagnostic.file === 'tokens.json' ||
        diagnostic.code === 'project-missing' ||
        diagnostic.code === 'kit-version-mismatch' ||
        diagnostic.code === 'entry-missing'),
  )
  if (projectErrors.length > 0) {
    selectionError('invalid-source', 'The design project has blocking errors: ' + projectErrors[0]!.message)
  }

  const requestedScreens = uniqueStrings(options.screens)
  const allIds = project.screens.filter((screen) => screen.id !== '').map((screen) => screen.id)
  let screens: ProjectScreen[]
  if (requestedScreens === undefined) {
    screens = project.screens.filter((screen) => validChosen(screen))
  } else {
    screens = requestedScreens.map((id) => {
      const found = project.screens.find((screen) => screen.id === id)
      if (found === undefined) {
        selectionError(
          'unknown-screen',
          'Unknown screen "' + id + '". Known screens: ' + (allIds.join(', ') || 'none') + '.',
        )
      }
      if (!validChosen(found)) {
        const first = found.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
        selectionError(
          'invalid-screen',
          'Screen "' +
            id +
            '" is not a current valid chosen projection' +
            (first === undefined
              ? '.'
              : ': ' + first.file + ':' + String(first.line) + ':' + String(first.column) + ' ' + first.message),
        )
      }
      return found
    })
  }
  if (screens.length === 0) {
    selectionError('no-screens', 'No valid chosen screen is available for handoff. Fix the design diagnostics first.')
  }

  const configured = project.config.breakpoints
  const requestedBreakpoints = uniqueStrings(options.breakpoints)
  let breakpoints: Breakpoint[]
  if (requestedBreakpoints === undefined) {
    breakpoints = [...configured]
  } else {
    breakpoints = requestedBreakpoints.map((name) => {
      const found = configured.find((candidate) => candidate.name === name)
      if (found === undefined) {
        selectionError(
          'unknown-breakpoint',
          'Unknown breakpoint "' +
            name +
            '". Configured breakpoints: ' +
            (configured.map((entry) => entry.name).join(', ') || 'none') +
            '.',
        )
      }
      return found
    })
  }
  if (breakpoints.length === 0) selectionError('no-breakpoints', 'The project configures no breakpoints.')

  const requestedStates = uniqueStrings(options.states)
  const projections: HandoffProjection[] = []
  for (const screen of screens) {
    for (const state of stateSelection(screen, requestedStates, options.kit)) {
      const stateName = state.name ?? HANDOFF_UNNAMED_STATE
      for (const breakpoint of breakpoints) {
        projections.push({
          id: handoffProjectionId(screen.id, stateName, breakpoint.name),
          screen: screen.id,
          stateName,
          ...(state.name === undefined ? {} : { state: state.name }),
          ...(state.assignment === undefined ? {} : { stateAssignment: state.assignment }),
          breakpoint,
        })
      }
    }
  }
  if (projections.length > MAX_HANDOFF_PROJECTIONS) {
    selectionError(
      'projection-limit',
      'The selected matrix has ' +
        String(projections.length) +
        ' screen/state/breakpoint projections; the limit is ' +
        String(MAX_HANDOFF_PROJECTIONS) +
        '. Narrow --screens, --states, or --breakpoints.',
    )
  }
  if (new Set(projections.map((projection) => projection.id)).size !== projections.length) {
    selectionError('duplicate-projection', 'The selected matrix resolves two projections to the same identity.')
  }

  const selectedIds = new Set(screens.map((screen) => screen.id))
  const journeys: HandoffJourneyPlan[] = []
  for (const journey of project.journeys) {
    const parsed = journey.journey
    if (parsed === undefined) continue
    const required = new Set<string>([parsed.start])
    for (const step of parsed.steps) {
      if (step.kind === 'navigate' || step.kind === 'expect-screen') required.add(step.screen)
    }
    const requiresScreens = [...required]
    if (!requiresScreens.some((id) => selectedIds.has(id))) continue
    const diagnostics = journey.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    if (diagnostics.length > 0) {
      const first = diagnostics[0]!
      selectionError(
        'invalid-journey',
        'Relevant journey "' +
          parsed.id +
          '" is invalid: ' +
          first.file +
          ':' +
          String(first.line) +
          ':' +
          String(first.column) +
          ' ' +
          first.message,
      )
    }
    journeys.push({
      id: parsed.id,
      file: journey.file,
      journey: parsed,
      requiresScreens,
      outsideScreens: requiresScreens.filter((id) => !selectedIds.has(id)),
    })
  }
  journeys.sort((left, right) => left.id.localeCompare(right.id))

  // The chosen-source closure keeps the exported DSX valid and the relevant
  // journeys runnable without rendering any additional projection. It follows
  // navigate() targets in selected and supporting screens and adds every screen
  // a relevant journey requires.
  const byId = new Map(project.screens.filter((screen) => screen.id !== '').map((screen) => [screen.id, screen]))
  const supportReasons = new Map<string, Set<string>>()
  const queue: string[] = []
  const addSupport = (id: string, reason: string): void => {
    if (selectedIds.has(id)) return
    const target = byId.get(id)
    if (target === undefined) {
      selectionError(
        'missing-navigation-screen',
        'The selected source references screen "' + id + '", which is not a valid chosen screen in this project.',
      )
    }
    if (!validChosen(target)) {
      const first = target.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
      selectionError(
        'invalid-support-screen',
        'Supporting screen "' +
          id +
          '" is not a current valid chosen projection' +
          (first === undefined
            ? '.'
            : ': ' + first.file + ':' + String(first.line) + ':' + String(first.column) + ' ' + first.message),
      )
    }
    let reasons = supportReasons.get(id)
    if (reasons === undefined) {
      reasons = new Set<string>()
      supportReasons.set(id, reasons)
      queue.push(id)
    }
    reasons.add(reason)
  }
  for (const screen of screens) {
    for (const target of navigationTargets(screen.root as DesignScreenNode, options.kit))
      addSupport(target, 'navigation:' + screen.id)
  }
  for (const journey of journeys) {
    for (const id of journey.requiresScreens) addSupport(id, 'journey:' + journey.id)
  }
  while (queue.length > 0) {
    const id = queue.shift() as string
    const screen = byId.get(id)
    if (screen?.root === undefined) continue
    for (const target of navigationTargets(screen.root, options.kit)) addSupport(target, 'navigation:' + id)
  }
  if (screens.length + supportReasons.size > MAX_HANDOFF_SCREENS) {
    selectionError(
      'support-limit',
      'The chosen-source closure has ' +
        String(screens.length + supportReasons.size) +
        ' screens; the limit is ' +
        String(MAX_HANDOFF_SCREENS) +
        '. Narrow --screens or --states.',
    )
  }

  const supportingScreens = [...supportReasons.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, reasons]) => screenPlan(byId.get(id) as ProjectScreen, 'supporting', [...reasons].sort()))

  const context = handoffContext(project, projections, options.kit)
  return {
    ...(context === undefined ? {} : { context }),
    screens: screens.map((screen) => screenPlan(screen, 'selected', [])),
    supportingScreens,
    projections,
    journeys,
    breakpoints,
    allBreakpoints: [...configured],
  }
}
