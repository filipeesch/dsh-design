/** Bounded, non-executable, versioned review metadata for a design project. */
import { parseExpression } from '@babel/parser'
import type { Expression } from '@babel/types'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { countDiagnostics } from './diagnostics.ts'
import type { Diagnostic, ProjectScreen } from './types.ts'

export const PREVIEW_METADATA_FILE = 'preview.json'
export const MAX_PREVIEW_METADATA_BYTES = 64 * 1024
export const MAX_PREVIEW_ITEMS = 64

const ID = /^[a-z][a-z0-9-]*$/
const MAX_ID = 80
const MAX_LABEL = 120
const MAX_SUMMARY = 320
const MAX_DETAILS = 2400

/** A local selection. Situation identity accompanies an explicit situation reference. */
export interface PreviewTarget {
  readonly screen: string
  readonly state?: string
  readonly situation?: string
}

/** Durable plain text for one screen. */
export interface PreviewScreenContext {
  readonly summary: string
  readonly details?: string
}

/** An ordered set of screens, shown under a single navigator label. */
export interface PreviewGroup {
  readonly id: string
  readonly label: string
  readonly screens: readonly string[]
}

/** An authored starting point presented under its parent screen. */
export interface PreviewSituation {
  readonly id: string
  readonly label: string
  readonly parent: string
  readonly target: PreviewTarget
}

/** A descriptive edge or a navigation action derived from a resolved projection. */
export interface PreviewRelationship {
  readonly id: string
  readonly label: string
  readonly kind: 'prototype' | 'illustrative' | 'simulated'
  readonly from: PreviewTarget
  readonly to: PreviewTarget
  readonly nodeId?: string
}

/** Project-authored metadata, containing only validated entries and resolved targets. */
export interface PreviewMetadata {
  readonly screens: Readonly<Record<string, PreviewScreenContext>>
  readonly groups: readonly PreviewGroup[]
  readonly situations: readonly PreviewSituation[]
  readonly relationships: readonly PreviewRelationship[]
}

interface PreviewMetadataResult {
  readonly preview?: PreviewMetadata
  readonly diagnostics: Diagnostic[]
}

type RecordValue = Record<string, unknown>
type JsonPath = readonly (string | number)[]
type Location = { readonly line: number; readonly column: number }
type Report = (path: JsonPath, code: string, message: string) => void

function diagnostic(code: string, message: string, location: Location = { line: 1, column: 1 }): Diagnostic {
  return { severity: 'error', file: PREVIEW_METADATA_FILE, code: 'preview-' + code, ...location, message }
}

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function pathLabel(path: JsonPath): string {
  return (
    '$' +
    path
      .map((key) =>
        typeof key === 'string' && /^[a-z][a-z0-9-]*$/i.test(key) ? '.' + key : '[' + JSON.stringify(key) + ']',
      )
      .join('')
  )
}

/** Index positions and duplicate keys in input already accepted as strict JSON. */
function sourceIndex(root: Expression): {
  locations: Map<string, Location>
  duplicatePaths: JsonPath[]
} {
  const locations = new Map<string, Location>()
  const duplicatePaths: JsonPath[] = []
  const visit = (node: Expression, path: JsonPath): void => {
    if (node.loc !== null && node.loc !== undefined) {
      locations.set(pathLabel(path), { line: node.loc.start.line, column: node.loc.start.column + 1 })
    }
    if (node.type === 'ObjectExpression') {
      const keys = new Set<string>()
      for (const property of node.properties) {
        if (property.type !== 'ObjectProperty' || property.key.type !== 'StringLiteral' || !('type' in property.value))
          continue
        const key = property.key.value
        const child = [...path, key]
        if (keys.has(key)) duplicatePaths.push(child)
        keys.add(key)
        // Strict JSON parsing already ensures these values are expressions.
        visit(property.value as Expression, child)
      }
    } else if (node.type === 'ArrayExpression') {
      node.elements.forEach((entry, index) => {
        if (entry !== null && entry.type !== 'SpreadElement') visit(entry, [...path, index])
      })
    }
  }
  visit(root, [])
  return { locations, duplicatePaths }
}

function failed(code: string, message: string, location?: Location): PreviewMetadataResult {
  return { diagnostics: [diagnostic(code, message, location)] }
}

/** Parse and normalize preview metadata against the current validated chosen screens. */
export function parsePreviewMetadata(source: string, screens: readonly ProjectScreen[]): PreviewMetadataResult {
  if (Buffer.byteLength(source) > MAX_PREVIEW_METADATA_BYTES) {
    return failed('limit', 'preview.json must not exceed ' + MAX_PREVIEW_METADATA_BYTES + ' bytes.')
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    const message = (error as Error).message
    const position = /\(line (\d+) column (\d+)\)/.exec(message)
    let location: Location | undefined
    if (position !== null) {
      location = { line: Number(position[1]), column: Number(position[2]) }
    } else {
      try {
        parseExpression(source)
      } catch (syntax) {
        const loc = (syntax as { loc?: Location }).loc
        if (loc !== undefined) location = { line: loc.line, column: loc.column + 1 }
      }
    }
    return failed(
      'json',
      'preview.json is not valid JSON. Check for JSON strings, commas, and matching brackets.',
      location,
    )
  }
  if (!record(value)) return failed('shape', 'preview.json must be a JSON object.')
  let index: ReturnType<typeof sourceIndex>
  try {
    index = sourceIndex(parseExpression(source, { errorRecovery: true }))
  } catch {
    return failed('shape', 'preview.json must contain only bounded review metadata objects and arrays.')
  }
  const diagnostics: Diagnostic[] = []
  const report: Report = (path, code, message) => {
    let nearest = path
    while (nearest.length > 0 && !index.locations.has(pathLabel(nearest))) nearest = nearest.slice(0, -1)
    diagnostics.push(diagnostic(code, pathLabel(path) + ': ' + message, index.locations.get(pathLabel(nearest))))
  }
  const duplicateKeys = new Set(index.duplicatePaths.map(pathLabel))
  for (const path of index.duplicatePaths) report(path, 'duplicate-key', 'Duplicate JSON key. Keep one declaration.')
  const entries = (value: unknown, path: JsonPath): unknown[] => {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
      report(path, 'shape', 'Expected an array.')
      return []
    }
    if (value.length > MAX_PREVIEW_ITEMS) report(path, 'limit', 'Keep at most ' + MAX_PREVIEW_ITEMS + ' entries.')
    return value.slice(0, MAX_PREVIEW_ITEMS) as unknown[]
  }
  const shape = (value: unknown, path: JsonPath, keys: readonly string[]): value is RecordValue => {
    if (!record(value)) {
      report(path, 'shape', 'Expected an object with ' + keys.join(', ') + '.')
      return false
    }
    let valid = true
    for (const key of Object.keys(value)) {
      if (duplicateKeys.has(pathLabel([...path, key]))) valid = false
      if (!keys.includes(key)) {
        report([...path, key], 'field', 'Unknown field. Allowed fields: ' + keys.join(', ') + '.')
        valid = false
      }
    }
    return valid
  }
  const text = (value: unknown, path: JsonPath, max: number): string | undefined => {
    if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
      report(path, 'text', 'Expected non-empty plain text of at most ' + max + ' characters.')
      return undefined
    }
    return value.trim()
  }
  const id = (value: unknown, path: JsonPath): string | undefined => {
    if (typeof value !== 'string' || !ID.test(value) || value.length > MAX_ID) {
      report(path, 'id', 'Expected a local identifier matching [a-z][a-z0-9-]*, at most ' + MAX_ID + ' characters.')
      return undefined
    }
    return value
  }
  const allIds = new Set<string>()
  const duplicates = new Set<string>()
  for (const screen of screens) {
    if (allIds.has(screen.id)) duplicates.add(screen.id)
    else allIds.add(screen.id)
  }
  const current = new Map(
    screens
      .filter(
        (screen) =>
          screen.id !== '' &&
          screen.root !== undefined &&
          !duplicates.has(screen.id) &&
          screen.variantDocumentCurrent !== false &&
          (screen.blockingErrors ?? countDiagnostics(screen.diagnostics).errors) === 0,
      )
      .map((screen) => [screen.id, screen]),
  )
  const screenId = (value: unknown, path: JsonPath): string | undefined => {
    const name = id(value, path)
    if (name === undefined) return undefined
    if (!current.has(name)) {
      report(
        path,
        'screen',
        'No current valid screen with ID "' + name + '". Reference a local screen from screens/*.dsx.',
      )
      return undefined
    }
    return name
  }
  shape(value, [], ['screens', 'groups', 'situations', 'relationships'])
  const section = (name: string): unknown => (duplicateKeys.has(pathLabel([name])) ? undefined : value[name])
  const contexts: [string, PreviewScreenContext][] = []
  const rawContexts = section('screens')
  if (rawContexts !== undefined) {
    if (!record(rawContexts)) {
      report(['screens'], 'shape', 'Expected an object keyed by screen ID.')
    } else {
      const contextEntries = Object.entries(rawContexts)
      if (contextEntries.length > MAX_PREVIEW_ITEMS)
        report(['screens'], 'limit', 'Keep at most ' + MAX_PREVIEW_ITEMS + ' screen contexts.')
      for (const [name, context] of contextEntries.slice(0, MAX_PREVIEW_ITEMS)) {
        const path = ['screens', name]
        if (
          duplicateKeys.has(pathLabel(path)) ||
          screenId(name, path) === undefined ||
          !shape(context, path, ['summary', 'details'])
        )
          continue
        const summary = text(context.summary, [...path, 'summary'], MAX_SUMMARY)
        const details =
          context.details === undefined ? undefined : text(context.details, [...path, 'details'], MAX_DETAILS)
        if (summary !== undefined && (context.details === undefined || details !== undefined)) {
          contexts.push([name, { summary, ...(details === undefined ? {} : { details }) }])
        }
      }
    }
  }

  function unique<T>(
    candidates: readonly { value: T; path: JsonPath }[],
    keyOf: (candidate: T) => string,
    code: string,
    message: string,
  ): T[] {
    const counts = new Map<string, number>()
    for (const candidate of candidates) {
      const key = keyOf(candidate.value)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return candidates.flatMap(({ value, path }) => {
      if (counts.get(keyOf(value)) === 1) return [value]
      report(path, code, message)
      return []
    })
  }

  const groupCandidates: { value: PreviewGroup; path: JsonPath }[] = []
  for (const [position, group] of entries(section('groups'), ['groups']).entries()) {
    const path = ['groups', position]
    if (!shape(group, path, ['id', 'label', 'screens'])) continue
    const name = id(group.id, [...path, 'id'])
    const label = text(group.label, [...path, 'label'], MAX_LABEL)
    const members = entries(group.screens, [...path, 'screens']).flatMap(
      (value, i) => screenId(value, [...path, 'screens', i]) ?? [],
    )
    if (group.screens === undefined || (Array.isArray(group.screens) && group.screens.length === 0)) {
      report([...path, 'screens'], 'shape', 'A group requires at least one screen ID.')
    }
    if (name !== undefined && label !== undefined && members.length > 0)
      groupCandidates.push({ value: { id: name, label, screens: members }, path })
  }
  const groupPaths = new Map(groupCandidates.map(({ value, path }) => [value.id, path]))
  const grouped = new Set<string>()
  const groups = unique(
    groupCandidates,
    (group) => group.id,
    'duplicate-group',
    'Duplicate group ID. Use a unique ID for each group.',
  ).flatMap((group) => {
    const members = group.screens.filter((member) => {
      if (grouped.has(member)) {
        report(
          [...(groupPaths.get(group.id) ?? []), 'screens'],
          'duplicate-member',
          'Screen "' + member + '" may appear only once in the group list.',
        )
        return false
      }
      grouped.add(member)
      return true
    })
    return members.length === 0 ? [] : [{ ...group, screens: members }]
  })

  const situationCandidates: { value: PreviewSituation; path: JsonPath }[] = []
  for (const [position, situation] of entries(section('situations'), ['situations']).entries()) {
    const path = ['situations', position]
    if (!shape(situation, path, ['id', 'label', 'parent', 'target'])) continue
    const name = id(situation.id, [...path, 'id'])
    const label = text(situation.label, [...path, 'label'], MAX_LABEL)
    const parent = screenId(situation.parent, [...path, 'parent'])
    const targetPath = [...path, 'target']
    if (!shape(situation.target, targetPath, ['screen', 'state'])) continue
    const screen = screenId(situation.target.screen, [...targetPath, 'screen'])
    const state =
      situation.target.state === undefined ? undefined : id(situation.target.state, [...targetPath, 'state'])
    if (
      name === undefined ||
      label === undefined ||
      parent === undefined ||
      screen === undefined ||
      (situation.target.state !== undefined && state === undefined)
    )
      continue
    if (allIds.has(name)) {
      report(
        [...path, 'id'],
        'situation-alias',
        'Situation ID "' + name + '" is also a screen ID. Name the situation distinctly.',
      )
      continue
    }
    if (state !== undefined && !current.get(screen)?.states.some((candidate) => candidate.name === state)) {
      report([...targetPath, 'state'], 'state', 'Screen "' + screen + '" has no valid chosen state "' + state + '".')
      continue
    }
    if (state === undefined && screen === parent) {
      report(
        targetPath,
        'situation-alias',
        'This situation duplicates its parent screen. Specify a named state or a different screen.',
      )
      continue
    }
    situationCandidates.push({
      value: { id: name, label, parent, target: { screen, ...(state === undefined ? {} : { state }) } },
      path,
    })
  }
  const situationPaths = new Map(situationCandidates.map(({ value, path }) => [value.id, path]))
  const distinctSituations = unique(
    situationCandidates,
    (item) => item.id,
    'duplicate-situation',
    'Duplicate situation ID. Use a unique ID for each situation.',
  )
  const situations = unique(
    distinctSituations.map((value) => ({ value, path: [...(situationPaths.get(value.id) ?? []), 'target'] })),
    (item) => JSON.stringify([item.target.screen, item.target.state]),
    'duplicate-destination',
    'Another situation resolves to the same screen and state. Keep one situation for that destination.',
  )
  const bySituation = new Map(situations.map((situation) => [situation.id, situation]))

  const endpoint = (value: unknown, path: JsonPath): PreviewTarget | undefined => {
    if (!shape(value, path, ['screen', 'situation'])) return undefined
    if (Object.keys(value).length !== 1) {
      report(
        path,
        'endpoint',
        'Use exactly one local endpoint: {"screen":"screen-id"} or {"situation":"situation-id"}.',
      )
      return undefined
    }
    if (Object.hasOwn(value, 'screen')) {
      const screen = screenId(value.screen, [...path, 'screen'])
      return screen === undefined ? undefined : { screen }
    }
    const situation = id(value.situation, [...path, 'situation'])
    if (situation === undefined) return undefined
    const match = bySituation.get(situation)
    if (match !== undefined) return { ...match.target, situation }
    report(
      [...path, 'situation'],
      'endpoint',
      'No valid situation with ID "' + situation + '". Reference a declared local situation.',
    )
    return undefined
  }
  const relationshipCandidates: { value: PreviewRelationship; path: JsonPath }[] = []
  for (const [position, relationship] of entries(section('relationships'), ['relationships']).entries()) {
    const path = ['relationships', position]
    if (!shape(relationship, path, ['id', 'label', 'kind', 'from', 'to'])) continue
    const name = id(relationship.id, [...path, 'id'])
    const label = text(relationship.label, [...path, 'label'], MAX_LABEL)
    const from = endpoint(relationship.from, [...path, 'from'])
    const to = endpoint(relationship.to, [...path, 'to'])
    const kind = relationship.kind
    if (kind !== 'illustrative' && kind !== 'simulated') {
      report([...path, 'kind'], 'kind', 'Expected "illustrative" or "simulated".')
    } else if (name !== undefined && label !== undefined && from !== undefined && to !== undefined) {
      relationshipCandidates.push({ value: { id: name, label, kind, from, to }, path })
    }
  }
  const relationships = unique(
    relationshipCandidates,
    (item) => item.id,
    'duplicate-relationship',
    'Duplicate relationship ID. Use a unique ID for each relationship.',
  )
  return { preview: { screens: Object.fromEntries(contexts), groups, situations, relationships }, diagnostics }
}

/** Load optional, regular project input without following a symlink or reading beyond the byte limit. */
export async function loadPreviewMetadata(
  folder: string,
  screens: readonly ProjectScreen[],
): Promise<PreviewMetadataResult> {
  try {
    const file = await open(
      join(folder, PREVIEW_METADATA_FILE),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const info = await file.stat()
      if (!info.isFile()) return failed('read', 'preview.json must be a regular file in the design folder.')
      if (info.size > MAX_PREVIEW_METADATA_BYTES)
        return failed('limit', 'preview.json must not exceed ' + MAX_PREVIEW_METADATA_BYTES + ' bytes.')
      const buffer = Buffer.alloc(MAX_PREVIEW_METADATA_BYTES + 1)
      let used = 0
      while (used < buffer.length) {
        const { bytesRead } = await file.read(buffer, used, buffer.length - used, used)
        if (bytesRead === 0) break
        used += bytesRead
      }
      if (used > MAX_PREVIEW_METADATA_BYTES)
        return failed('limit', 'preview.json must not exceed ' + MAX_PREVIEW_METADATA_BYTES + ' bytes.')
      return parsePreviewMetadata(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used)), screens)
    } finally {
      await file.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { diagnostics: [] }
    return failed('read', 'Could not read preview.json. Use a regular, readable UTF-8 file in the design folder.')
  }
}
