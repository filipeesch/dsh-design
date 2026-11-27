/**
 * Named initial screen state: a reserved `states` prop on Screen that maps
 * kebab-case names to overlay, tab, field, and disclosure assignments by stable node id.
 *
 * The prop is validated against the expanded tree and removed from the
 * renderable tree. Only validated metadata travels with the screen.
 */
import type { KitMetadata } from './metadata.ts'
import { isReference } from './refs.ts'
import { declaredOption } from './kit-controls.ts'
import type {
  Breakpoint,
  DesignChild,
  DesignElement,
  DesignPropValue,
  DesignProps,
  DesignScreenNode,
  DesignStateValue,
  Diagnostic,
  NamedState,
  SourceLocation,
} from './types.ts'

/** Maximum named states per screen. */
export const MAX_NAMED_STATES = 50
const MAX_STATE_ENTRIES = 100
const ID_PATTERN = /^[a-z][a-z0-9-]*$/

/** Outcome of reading the reserved `states` prop. */
export interface StateExtraction {
  /** The screen tree without the reserved prop. */
  readonly root: DesignScreenNode
  readonly states: readonly NamedState[]
  readonly diagnostics: readonly Diagnostic[]
}

/** Element types whose value state accepts a plain string. */
const STRING_VALUE_TYPES = new Set(['Input', 'TextArea', 'Select', 'Combobox'])
/** Element types whose value state accepts a boolean. */
const BOOLEAN_VALUE_TYPES = new Set(['Checkbox', 'Switch', 'ToggleButton'])
/** Element types whose value state accepts a string array. */
const STRING_ARRAY_VALUE_TYPES = new Set(['MultiSelect'])

function locationOf(root: DesignScreenNode, file: string): SourceLocation {
  return root.propLocations?.states ?? { file, line: root.source.line, column: root.source.column }
}

function pushState(
  diagnostics: Diagnostic[],
  root: DesignScreenNode,
  source: SourceLocation,
  code: string,
  message: string,
  suggestion?: string,
): void {
  diagnostics.push({
    severity: 'error',
    code,
    file: source.file,
    line: source.line,
    column: source.column,
    ...(root.id === '' ? {} : { nodeId: root.id }),
    address: root.address.label,
    message,
    ...(suggestion === undefined ? {} : { suggestion }),
  })
}

/** Index every element in a screen tree by explicit id. */
function indexNodes(root: DesignScreenNode): Map<string, DesignElement | DesignScreenNode> {
  const index = new Map<string, DesignElement | DesignScreenNode>()
  const visit = (node: DesignElement | DesignScreenNode): void => {
    if (node.id !== undefined && node.id !== '') index.set(node.id, node)
    for (const child of node.children) if (child.kind === 'element') visit(child)
  }
  visit(root)
  return index
}

/** Values a Tabs node can select. */
function tabValues(node: DesignElement): string[] {
  const values: string[] = []
  for (const child of node.children) {
    if (child.kind !== 'element' || child.type !== 'Tab') continue
    const value = child.props.value
    if (typeof value === 'string' && value !== '') values.push(value)
    else if (child.id !== undefined && child.id !== '') values.push(child.id)
  }
  return values
}

/** Parse one state assignment object; returns undefined after reporting errors. */
function readState(
  diagnostics: Diagnostic[],
  root: DesignScreenNode,
  source: SourceLocation,
  name: string,
  raw: unknown,
  nodes: ReadonlyMap<string, DesignElement | DesignScreenNode>,
  kit: KitMetadata,
): NamedState | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || isReference(raw)) {
    pushState(
      diagnostics,
      root,
      source,
      'state-shape',
      `State "${name}" must be an object with optional open, tabs, values, and disclosures.`,
    )
    return undefined
  }
  const record = raw as Record<string, unknown>
  let valid = true
  for (const key of Object.keys(record)) {
    if (key !== 'open' && key !== 'tabs' && key !== 'values' && key !== 'disclosures') {
      pushState(
        diagnostics,
        root,
        source,
        'state-key',
        `State "${name}" declares unsupported field "${key}".`,
        'Use open, tabs, values, or disclosures.',
      )
      valid = false
    }
  }

  const open: string[] = []
  if (record.open !== undefined) {
    if (!Array.isArray(record.open) || record.open.length > MAX_STATE_ENTRIES) {
      pushState(
        diagnostics,
        root,
        source,
        'state-open-shape',
        `State "${name}" field "open" must be an array of at most ${String(MAX_STATE_ENTRIES)} overlay ids.`,
      )
      valid = false
    } else {
      for (const entry of record.open) {
        if (typeof entry !== 'string' || entry === '') {
          pushState(
            diagnostics,
            root,
            source,
            'state-open-shape',
            `State "${name}" field "open" accepts string overlay ids only.`,
          )
          valid = false
          continue
        }
        if (open.includes(entry)) {
          pushState(
            diagnostics,
            root,
            source,
            'state-open-duplicate',
            `State "${name}" opens "${entry}" more than once.`,
          )
          valid = false
          continue
        }
        const target = nodes.get(entry)
        if (target === undefined) {
          pushState(
            diagnostics,
            root,
            source,
            'state-open-missing',
            `State "${name}" opens "${entry}", which does not exist in this screen.`,
          )
          valid = false
          continue
        }
        const meta = kit[target.type]
        if (meta === undefined || !meta.overlay) {
          pushState(
            diagnostics,
            root,
            source,
            'state-open-not-overlay',
            `State "${name}" opens <${target.type}> "${entry}", which is not an overlay.`,
            'Only Drawer, Modal, Popover, Menu, and Toast can be opened.',
          )
          valid = false
          continue
        }
        open.push(entry)
      }
    }
  }

  const tabs: Record<string, string> = {}
  if (record.tabs !== undefined) {
    if (
      record.tabs === null ||
      typeof record.tabs !== 'object' ||
      Array.isArray(record.tabs) ||
      isReference(record.tabs)
    ) {
      pushState(
        diagnostics,
        root,
        source,
        'state-tabs-shape',
        `State "${name}" field "tabs" must map Tabs ids to tab values.`,
      )
      valid = false
    } else {
      const entries = Object.entries(record.tabs as Record<string, unknown>)
      if (entries.length > MAX_STATE_ENTRIES) {
        pushState(
          diagnostics,
          root,
          source,
          'state-tabs-shape',
          `State "${name}" declares more than ${String(MAX_STATE_ENTRIES)} tab assignments.`,
        )
        valid = false
      }
      for (const [id, value] of entries.slice(0, MAX_STATE_ENTRIES)) {
        const target = nodes.get(id)
        if (target === undefined) {
          pushState(
            diagnostics,
            root,
            source,
            'state-tab-missing',
            `State "${name}" selects a tab on "${id}", which does not exist in this screen.`,
          )
          valid = false
          continue
        }
        if (target.type !== 'Tabs') {
          pushState(
            diagnostics,
            root,
            source,
            'state-tab-not-tabs',
            `State "${name}" selects a tab on <${target.type}> "${id}", which is not a Tabs node.`,
          )
          valid = false
          continue
        }
        if (typeof value !== 'string' || value === '') {
          pushState(
            diagnostics,
            root,
            source,
            'state-tab-value',
            `State "${name}" tab assignment for "${id}" must be a non-empty string value.`,
          )
          valid = false
          continue
        }
        const values = tabValues(target as DesignElement)
        if (values.length > 0 && !values.includes(value)) {
          pushState(
            diagnostics,
            root,
            source,
            'state-tab-value',
            `State "${name}" selects tab value "${value}" on "${id}", which declares: ${values.join(', ')}.`,
            'Use one of the declared Tab values.',
          )
          valid = false
          continue
        }
        tabs[id] = value
      }
    }
  }

  const values: Record<string, DesignStateValue> = {}
  if (record.values !== undefined) {
    if (
      record.values === null ||
      typeof record.values !== 'object' ||
      Array.isArray(record.values) ||
      isReference(record.values)
    ) {
      pushState(
        diagnostics,
        root,
        source,
        'state-values-shape',
        `State "${name}" field "values" must map input ids to scalar or string-array values.`,
      )
      valid = false
    } else {
      const entries = Object.entries(record.values as Record<string, unknown>)
      if (entries.length > MAX_STATE_ENTRIES) {
        pushState(
          diagnostics,
          root,
          source,
          'state-values-shape',
          `State "${name}" declares more than ${String(MAX_STATE_ENTRIES)} value assignments.`,
        )
        valid = false
      }
      for (const [id, value] of entries.slice(0, MAX_STATE_ENTRIES)) {
        const target = nodes.get(id)
        if (target === undefined) {
          pushState(
            diagnostics,
            root,
            source,
            'state-value-missing',
            `State "${name}" assigns a value to "${id}", which does not exist in this screen.`,
          )
          valid = false
          continue
        }
        const type = target.type
        if (STRING_VALUE_TYPES.has(type)) {
          if (typeof value !== 'string') {
            pushState(
              diagnostics,
              root,
              source,
              'state-value-type',
              `State "${name}" assigns a non-string value to <${type}> "${id}".`,
            )
            valid = false
            continue
          }
          values[id] = value
          continue
        }
        if (type === 'SelectButton') {
          if (typeof value !== 'string' || declaredOption(target.props.options, value) === undefined) {
            pushState(
              diagnostics,
              root,
              source,
              'state-value-option',
              `State "${name}" assigns an undeclared option value to <SelectButton> "${id}".`,
            )
            valid = false
            continue
          }
          values[id] = value
          continue
        }
        if (BOOLEAN_VALUE_TYPES.has(type)) {
          if (typeof value !== 'boolean') {
            pushState(
              diagnostics,
              root,
              source,
              'state-value-type',
              `State "${name}" assigns a non-boolean value to <${type}> "${id}".`,
            )
            valid = false
            continue
          }
          values[id] = value
          continue
        }
        if (STRING_ARRAY_VALUE_TYPES.has(type)) {
          if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
            pushState(
              diagnostics,
              root,
              source,
              'state-value-type',
              `State "${name}" assigns a non-string-array value to <${type}> "${id}".`,
            )
            valid = false
            continue
          }
          values[id] = [...(value as string[])]
          continue
        }
        if (type === 'Pagination') {
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            pushState(
              diagnostics,
              root,
              source,
              'state-value-type',
              `State "${name}" assigns a non-number page to <${type}> "${id}".`,
            )
            valid = false
            continue
          }
          values[id] = value
          continue
        }
        pushState(
          diagnostics,
          root,
          source,
          'state-value-target',
          `State "${name}" assigns a value to <${type}> "${id}", which does not accept a seeded value.`,
          'Seed Input, TextArea, Select, SelectButton, Combobox, MultiSelect, Checkbox, Switch, ToggleButton, or Pagination values.',
        )
        valid = false
      }
    }
  }

  const disclosures: Record<string, boolean> = Object.create(null) as Record<string, boolean>
  const rawDisclosures = record.disclosures
  if (rawDisclosures !== undefined) {
    if (
      rawDisclosures === null ||
      typeof rawDisclosures !== 'object' ||
      Array.isArray(rawDisclosures) ||
      isReference(rawDisclosures)
    ) {
      pushState(
        diagnostics,
        root,
        source,
        'state-disclosures-shape',
        `State "${name}" field "disclosures" must map Disclosure ids to boolean expansion values.`,
      )
      valid = false
    } else {
      const entries = Object.entries(rawDisclosures)
      if (entries.length > MAX_STATE_ENTRIES) {
        pushState(
          diagnostics,
          root,
          source,
          'state-disclosures-shape',
          `State "${name}" declares more than ${String(MAX_STATE_ENTRIES)} disclosure assignments.`,
        )
        valid = false
      }
      for (const [id, expanded] of entries.slice(0, MAX_STATE_ENTRIES)) {
        const target = nodes.get(id)
        if (target === undefined) {
          pushState(
            diagnostics,
            root,
            source,
            'state-disclosure-missing',
            `State "${name}" seeds disclosure "${id}", which does not exist in this screen.`,
          )
          valid = false
        } else if (target.type !== 'Disclosure') {
          pushState(
            diagnostics,
            root,
            source,
            'state-disclosure-target',
            `State "${name}" seeds <${target.type}> "${id}", which is not a Disclosure.`,
          )
          valid = false
        } else if (typeof expanded !== 'boolean') {
          pushState(
            diagnostics,
            root,
            source,
            'state-disclosure-value',
            `State "${name}" disclosure assignment for "${id}" must be true or false.`,
          )
          valid = false
        } else {
          disclosures[id] = expanded
        }
      }
    }
  }

  if (!valid) return undefined
  return { name, open, tabs, values, ...(Object.keys(disclosures).length === 0 ? {} : { disclosures }), source }
}

/**
 * Read and validate the reserved Screen `states` prop.
 * @param root - expanded, parsed screen tree.
 * @param file - project-relative screen file.
 * @param kit - component metadata used to classify overlays.
 */
export function extractNamedStates(root: DesignScreenNode, file: string, kit: KitMetadata): StateExtraction {
  const raw = root.props.states
  const props: DesignProps = {}
  for (const [key, value] of Object.entries(root.props)) if (key !== 'states') props[key] = value
  const propLocations = root.propLocations === undefined ? undefined : { ...root.propLocations }
  if (propLocations !== undefined) delete propLocations.states
  const stripped: DesignScreenNode = {
    ...root,
    props,
    ...(propLocations === undefined || Object.keys(propLocations).length === 0 ? {} : { propLocations }),
  }
  if (raw === undefined) return { root: stripped, states: [], diagnostics: [] }

  const diagnostics: Diagnostic[] = []
  const source = locationOf(root, file)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || isReference(raw)) {
    pushState(
      diagnostics,
      root,
      source,
      'state-shape',
      'The Screen "states" prop must be an object mapping state names to assignments.',
    )
    return { root: stripped, states: [], diagnostics }
  }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_NAMED_STATES) {
    pushState(
      diagnostics,
      root,
      source,
      'state-limit',
      `The screen declares more than ${String(MAX_NAMED_STATES)} named states.`,
    )
    return { root: stripped, states: [], diagnostics }
  }
  const nodes = indexNodes(root)
  const states: NamedState[] = []
  for (const [name, assignment] of entries) {
    if (!ID_PATTERN.test(name)) {
      pushState(diagnostics, root, source, 'state-name', `State name "${name}" must match [a-z][a-z0-9-]*.`)
      continue
    }
    const state = readState(diagnostics, root, source, name, assignment, nodes, kit)
    if (state !== undefined) states.push(state)
  }
  return { root: stripped, states, diagnostics }
}

/**
 * Report named-state targets that are not compatible with one resolved
 * projection. The chosen projection is validated on load; an alternate
 * projection can lack a target, which is diagnosed instead of silently
 * substituting a different state.
 */
export function stateCompatibility(root: DesignScreenNode, named: NamedState, kit: KitMetadata): string[] {
  const nodes = indexNodes(root)
  const issues: string[] = []
  for (const id of named.open) {
    const target = nodes.get(id)
    if (target === undefined) {
      issues.push('opens "' + id + '", which this projection does not render')
      continue
    }
    const meta = kit[target.type]
    if (meta === undefined || !meta.overlay)
      issues.push('opens "' + id + '", which is not an overlay in this projection')
  }
  for (const [id, value] of Object.entries(named.tabs)) {
    const target = nodes.get(id)
    if (target === undefined) {
      issues.push('selects tab "' + id + '", which this projection does not render')
      continue
    }
    if (target.type !== 'Tabs') {
      issues.push('selects tab "' + id + '", which is not a Tabs node in this projection')
      continue
    }
    const values = tabValues(target as DesignElement)
    if (values.length > 0 && !values.includes(value)) {
      issues.push('selects tab "' + id + '" value "' + value + '", which this projection does not declare')
    }
  }
  for (const [id, value] of Object.entries(named.values)) {
    const target = nodes.get(id)
    if (target === undefined) {
      issues.push('assigns value to "' + id + '", which this projection does not render')
      continue
    }
    const type = target.type
    if (STRING_VALUE_TYPES.has(type)) {
      if (typeof value !== 'string') issues.push('assigns a non-string value to <' + type + '> "' + id + '"')
      continue
    }
    if (type === 'SelectButton') {
      if (typeof value !== 'string' || declaredOption(target.props.options, value) === undefined)
        issues.push('assigns an undeclared option value to <SelectButton> "' + id + '"')
      continue
    }
    if (BOOLEAN_VALUE_TYPES.has(type)) {
      if (typeof value !== 'boolean') issues.push('assigns a non-boolean value to <' + type + '> "' + id + '"')
      continue
    }
    if (STRING_ARRAY_VALUE_TYPES.has(type)) {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        issues.push('assigns a non-string-array value to <' + type + '> "' + id + '"')
      }
      continue
    }
    if (type === 'Pagination') {
      if (typeof value !== 'number' || !Number.isFinite(value)) issues.push('assigns a non-number page to "' + id + '"')
      continue
    }
    issues.push('assigns a value to <' + type + '> "' + id + '", which does not accept a seeded value')
  }
  for (const [id, expanded] of Object.entries(named.disclosures ?? {})) {
    const target = nodes.get(id)
    if (target === undefined) issues.push('seeds disclosure "' + id + '", which this projection does not render')
    else if (target.type !== 'Disclosure')
      issues.push('seeds "' + id + '", which is not a Disclosure in this projection')
    else if (typeof expanded !== 'boolean') issues.push('assigns a non-boolean expansion to "' + id + '"')
  }
  return issues
}

/** Pick the responsive value that applies at the active breakpoint. */
export function resolveResponsive(
  value: DesignPropValue | undefined,
  breakpoints: readonly Breakpoint[],
  activeBreakpoint: string,
): DesignPropValue | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || '$interaction' in value) return value
  const object = value as Record<string, DesignPropValue>
  const ordered = [...breakpoints].sort((left, right) => left.width - right.width)
  const active = ordered.find((breakpoint) => breakpoint.name === activeBreakpoint)
  if (active === undefined) return value
  let chosen: DesignPropValue | undefined
  for (const breakpoint of ordered) {
    if (breakpoint.width > active.width) break
    if (object[breakpoint.name] !== undefined) chosen = object[breakpoint.name]
  }
  if (chosen === undefined) {
    const first = ordered.find((breakpoint) => object[breakpoint.name] !== undefined)
    chosen = first === undefined ? undefined : object[first.name]
  }
  return chosen
}

/** Find one named state in a screen's metadata. */
export function findNamedState(states: readonly NamedState[], name: string | undefined): NamedState | undefined {
  if (name === undefined) return undefined
  return states.find((state) => state.name === name)
}

/** Whether a text child is a template placeholder rather than literal text. */
export function isItemText(child: DesignChild): boolean {
  return child.kind === 'text' && child.itemField !== undefined
}
