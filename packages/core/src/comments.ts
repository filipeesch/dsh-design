/**
 * Review-comment wire types and validation shared by the host endpoint and the
 * browser preview. Everything here is pure: no filesystem, no DOM, and no
 * dependency on the design parser.
 */

/** Maximum characters in one comment body. */
export const COMMENT_TEXT_MAX = 2000
/** Maximum characters in one identifier or context label. */
export const COMMENT_LABEL_MAX = 120
/** Maximum drafts retained for one DSH session; equal to one batch's capacity. */
export const COMMENT_DRAFT_MAX = 50
/** Maximum drafts in one submitted batch. */
export const COMMENT_BATCH_MAX = 50
/** Maximum open overlay ids captured in one comment context. */
export const COMMENT_OVERLAYS_MAX = 20
/** Maximum tab selections captured in one comment context. */
export const COMMENT_TABS_MAX = 50
/** Maximum authored Disclosure coordinates captured in one comment. */
export const COMMENT_DISCLOSURES_MAX = 50
/** Maximum accepted submission receipts retained for one session. */
export const COMMENT_RECEIPTS_MAX = 50
/** Maximum JSON body bytes accepted by a comment mutation. */
export const COMMENT_BODY_MAX = 64 * 1024

const DRAFT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/
const STABLE_ID_PATTERN = /^[a-z][a-z0-9-]*$/
const STRUCTURAL_ADDRESS_PATTERN = /^#(?:[0-9]+(?:\.[0-9]+)*)?$/
/** Canonical content fingerprint carried by structural anchors. */
export const COMMENT_FINGERPRINT_PATTERN = /^fp-[0-9a-f]{16}-[0-9a-f]{1,8}$/
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/ -]*$/

/** Whether a node identity is an explicit or key-derived design id. */
export const COMMENT_ANCHOR_KINDS = ['stable', 'structural'] as const
/** Identity quality of one anchored component. */
export type CommentAnchorKind = (typeof COMMENT_ANCHOR_KINDS)[number]

/** Where in the design a comment is attached. */
export interface CommentAnchor {
  /** Stable design id, or a structural address when no stable id exists. */
  readonly id: string
  /** Identity class; a structural address is visibly unstable. */
  readonly kind: CommentAnchorKind
  /** Kit component type, for example `Button`. */
  readonly type: string
  /** Project revision the anchor was captured at, for diagnostics only. */
  readonly revision: number
  /** Rendered-content fingerprint; required for a structural anchor. */
  readonly fingerprint?: string
}

/** Reproducible interaction context captured with a comment. */
export interface CommentContext {
  /** Screen id displayed at capture. */
  readonly screen: string
  /** Breakpoint name active at capture. */
  readonly breakpoint: string
  /** Named screen state applied at capture, when one was active. */
  readonly state?: string
  /** Complete open overlay set, omitted when unavailable. */
  readonly overlays?: readonly string[]
  /** Effective palette displayed at capture. */
  readonly theme?: string
  /** True or false effective expansions, keyed by stable Disclosure id. */
  readonly disclosures?: Readonly<Record<string, boolean>>
  /** Tab node id to selected tab value; never free-form field values. */
  readonly tabs: Readonly<Record<string, string>>
  /** Optional typed variant identity, when a renderer provides one. */
  readonly variant?: string
}

/** One pending review comment stored by the host. */
export interface CommentDraft {
  readonly id: string
  /** Per-draft revision; a mutation must name the exact revision it edited. */
  readonly revision: number
  readonly text: string
  readonly anchor: CommentAnchor
  readonly context: CommentContext
  readonly createdAt: number
  readonly updatedAt: number
}

/** One session's pending comments and store revision. */
export interface CommentSnapshot {
  readonly session: string
  /** Increments on every mutation in this session's store. */
  readonly revision: number
  readonly drafts: readonly CommentDraft[]
}

/** One exact draft revision captured by a submission. */
export interface CommentVersion {
  readonly id: string
  readonly revision: number
}

/** New-comment input accepted by the host. */
export interface CommentCreateInput {
  readonly text: string
  readonly anchor: CommentAnchor
  readonly context: CommentContext
}

/** Result of validating one untrusted value. */
export type CommentValidation<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

function invalid<T>(error: string): CommentValidation<T> {
  return { ok: false, error }
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 9 || (code > 10 && code < 13) || (code > 13 && code < 32)) return true
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) return key
  return undefined
}

function boundedLabel(value: unknown, name: string): CommentValidation<string> {
  if (typeof value !== 'string' || value.length === 0 || value.length > COMMENT_LABEL_MAX)
    return invalid(name + ' must be a non-empty string of at most ' + String(COMMENT_LABEL_MAX) + ' characters')
  if (!LABEL_PATTERN.test(value)) return invalid(name + ' contains characters that are not allowed')
  return { ok: true, value }
}

function boundedRevision(value: unknown, name: string): CommentValidation<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000_000)
    return invalid(name + ' must be a non-negative integer')
  return { ok: true, value }
}

/** Validate plain comment text, rejecting control characters and free-form markup. */
export function validateCommentText(value: unknown): CommentValidation<string> {
  if (typeof value !== 'string') return invalid('text must be a string')
  const text = value.trim()
  if (text.length === 0) return invalid('text must not be empty')
  if (text.length > COMMENT_TEXT_MAX) return invalid('text must be at most ' + String(COMMENT_TEXT_MAX) + ' characters')
  if (hasControlCharacter(text)) return invalid('text must not contain control characters')
  return { ok: true, value: text }
}

/** Validate one anchor. */
export function parseCommentAnchor(value: unknown): CommentValidation<CommentAnchor> {
  if (!isRecord(value)) return invalid('anchor must be an object')
  const extra = exactKeys(value, ['id', 'kind', 'type', 'revision', 'fingerprint'])
  if (extra !== undefined) return invalid('anchor.' + extra + ' is not allowed')
  if (value.kind !== 'stable' && value.kind !== 'structural') return invalid('anchor.kind must be stable or structural')
  if (typeof value.id !== 'string') return invalid('anchor.id must be a string')
  const pattern = value.kind === 'stable' ? STABLE_ID_PATTERN : STRUCTURAL_ADDRESS_PATTERN
  if (!pattern.test(value.id)) return invalid('anchor.id is not a valid ' + value.kind + ' identity')
  const type = boundedLabel(value.type, 'anchor.type')
  if (!type.ok) return type
  const revision = boundedRevision(value.revision, 'anchor.revision')
  if (!revision.ok) return revision
  if (value.kind === 'structural') {
    if (typeof value.fingerprint !== 'string' || !COMMENT_FINGERPRINT_PATTERN.test(value.fingerprint))
      return invalid('anchor.fingerprint must be a content fingerprint for a structural anchor')
  } else if (value.fingerprint !== undefined) {
    return invalid('anchor.fingerprint is only allowed for a structural anchor')
  }
  return {
    ok: true,
    value: {
      id: value.id,
      kind: value.kind,
      type: type.value,
      revision: revision.value,
      ...(typeof value.fingerprint === 'string' ? { fingerprint: value.fingerprint } : {}),
    },
  }
}

/** Validate reproducible interaction context; free-form field values are rejected by shape. */
export function parseCommentContext(value: unknown): CommentValidation<CommentContext> {
  if (!isRecord(value)) return invalid('context must be an object')
  const extra = exactKeys(value, [
    'screen',
    'breakpoint',
    'state',
    'theme',
    'overlays',
    'tabs',
    'disclosures',
    'variant',
  ])
  if (extra !== undefined) return invalid('context.' + extra + ' is not allowed')
  const screen = boundedLabel(value.screen, 'context.screen')
  if (!screen.ok) return screen
  const breakpoint = boundedLabel(value.breakpoint, 'context.breakpoint')
  if (!breakpoint.ok) return breakpoint
  const state = value.state === undefined ? undefined : boundedLabel(value.state, 'context.state')
  if (state !== undefined && !state.ok) return state
  const overlaysValue = value.overlays === undefined ? [] : value.overlays
  if (!Array.isArray(overlaysValue) || overlaysValue.length > COMMENT_OVERLAYS_MAX)
    return invalid('context.overlays must be an array of at most ' + String(COMMENT_OVERLAYS_MAX) + ' ids')
  const overlays: string[] = []
  for (const overlay of overlaysValue) {
    if (typeof overlay !== 'string' || !STABLE_ID_PATTERN.test(overlay))
      return invalid('context.overlays entries must be stable ids')
    if (!overlays.includes(overlay)) overlays.push(overlay)
  }
  const tabsValue = value.tabs === undefined ? {} : value.tabs
  if (!isRecord(tabsValue)) return invalid('context.tabs must be an object')
  const tabEntries = Object.entries(tabsValue)
  if (tabEntries.length > COMMENT_TABS_MAX)
    return invalid('context.tabs must contain at most ' + String(COMMENT_TABS_MAX) + ' selections')
  const tabs: Record<string, string> = {}
  for (const [key, entry] of tabEntries) {
    if (!STABLE_ID_PATTERN.test(key)) return invalid('context.tabs keys must be stable ids')
    if (typeof entry !== 'string' || entry.length > COMMENT_LABEL_MAX)
      return invalid('context.tabs values must be strings of at most ' + String(COMMENT_LABEL_MAX) + ' characters')
    if (hasControlCharacter(entry)) return invalid('context.tabs values must not contain control characters')
    tabs[key] = entry
  }
  const theme = value.theme === undefined ? undefined : boundedLabel(value.theme, 'context.theme')
  if (theme !== undefined && (!theme.ok || !STABLE_ID_PATTERN.test(theme.value)))
    return invalid('context.theme must be a valid palette name')
  const expanded = value.disclosures
  const disclosures: Record<string, boolean> = {}
  if (expanded !== undefined) {
    if (!isRecord(expanded) || Object.keys(expanded).length > COMMENT_DISCLOSURES_MAX)
      return invalid(
        'context.disclosures must be an object with at most ' + String(COMMENT_DISCLOSURES_MAX) + ' entries',
      )
    for (const [id, entry] of Object.entries(expanded)) {
      if (!STABLE_ID_PATTERN.test(id) || typeof entry !== 'boolean')
        return invalid('context.disclosures must map stable ids to booleans')
      disclosures[id] = entry
    }
  }
  // Canonical identities may contain multiple paths and a bounded hash suffix.
  const rawVariant = value.variant
  const variant =
    rawVariant === undefined
      ? undefined
      : typeof rawVariant === 'string' &&
          rawVariant.length <= COMMENT_LABEL_MAX &&
          /^[A-Za-z0-9][A-Za-z0-9._:/ |#-]*$/.test(rawVariant)
        ? { ok: true as const, value: rawVariant }
        : invalid<string>('context.variant must be a valid variant identity')
  if (variant !== undefined && !variant.ok) return variant
  return {
    ok: true,
    value: {
      screen: screen.value,
      breakpoint: breakpoint.value,
      ...(state === undefined ? {} : { state: state.value }),
      ...(value.overlays === undefined ? {} : { overlays }),
      ...(theme === undefined ? {} : { theme: theme.value }),
      tabs,
      ...(expanded === undefined ? {} : { disclosures }),
      ...(variant === undefined ? {} : { variant: variant.value }),
    },
  }
}

/** Validate one new-comment payload. */
export function parseCommentCreate(value: unknown): CommentValidation<CommentCreateInput> {
  if (!isRecord(value)) return invalid('body must be a JSON object')
  const extra = exactKeys(value, ['text', 'anchor', 'context'])
  if (extra !== undefined) return invalid(extra + ' is not allowed')
  const text = validateCommentText(value.text)
  if (!text.ok) return text
  const anchor = parseCommentAnchor(value.anchor)
  if (!anchor.ok) return anchor
  const context = parseCommentContext(value.context)
  if (!context.ok) return context
  return { ok: true, value: { text: text.value, anchor: anchor.value, context: context.value } }
}

/** Validate one edit payload. */
export function parseCommentUpdate(value: unknown): CommentValidation<CommentVersion & { readonly text: string }> {
  if (!isRecord(value)) return invalid('body must be a JSON object')
  const extra = exactKeys(value, ['id', 'revision', 'text'])
  if (extra !== undefined) return invalid(extra + ' is not allowed')
  if (typeof value.id !== 'string' || !DRAFT_ID_PATTERN.test(value.id)) return invalid('id is not a valid draft id')
  const revision = boundedRevision(value.revision, 'revision')
  if (!revision.ok) return revision
  const text = validateCommentText(value.text)
  if (!text.ok) return text
  return { ok: true, value: { id: value.id, revision: revision.value, text: text.value } }
}

/** Validate one removal payload. */
export function parseCommentRemove(value: unknown): CommentValidation<CommentVersion> {
  if (!isRecord(value)) return invalid('body must be a JSON object')
  const extra = exactKeys(value, ['id', 'revision'])
  if (extra !== undefined) return invalid(extra + ' is not allowed')
  if (typeof value.id !== 'string' || !DRAFT_ID_PATTERN.test(value.id)) return invalid('id is not a valid draft id')
  const revision = boundedRevision(value.revision, 'revision')
  if (!revision.ok) return revision
  return { ok: true, value: { id: value.id, revision: revision.value } }
}

/** Validate one submission payload. */
export function parseCommentSubmit(
  value: unknown,
): CommentValidation<{ readonly requestId: string; readonly versions: readonly CommentVersion[] }> {
  if (!isRecord(value)) return invalid('body must be a JSON object')
  const extra = exactKeys(value, ['requestId', 'versions'])
  if (extra !== undefined) return invalid(extra + ' is not allowed')
  if (typeof value.requestId !== 'string' || !REQUEST_ID_PATTERN.test(value.requestId))
    return invalid('requestId must be 8-100 URL-safe characters')
  if (!Array.isArray(value.versions) || value.versions.length === 0)
    return invalid('versions must be a non-empty array')
  if (value.versions.length > COMMENT_BATCH_MAX)
    return invalid('versions must contain at most ' + String(COMMENT_BATCH_MAX) + ' entries')
  const versions: CommentVersion[] = []
  const seen = new Set<string>()
  for (const entry of value.versions) {
    if (!isRecord(entry)) return invalid('each version must be an object')
    const versionExtra = exactKeys(entry, ['id', 'revision'])
    if (versionExtra !== undefined) return invalid('versions entries cannot contain ' + versionExtra)
    if (typeof entry.id !== 'string' || !DRAFT_ID_PATTERN.test(entry.id))
      return invalid('versions entries need a valid id')
    if (seen.has(entry.id)) return invalid('versions contains duplicate draft ids')
    seen.add(entry.id)
    const revision = boundedRevision(entry.revision, 'versions revision')
    if (!revision.ok) return revision
    versions.push({ id: entry.id, revision: revision.value })
  }
  return { ok: true, value: { requestId: value.requestId, versions } }
}

/** Compare two exact-version sets independent of ordering. */
export function sameCommentVersions(left: readonly CommentVersion[], right: readonly CommentVersion[]): boolean {
  if (left.length !== right.length) return false
  const byId = new Map(left.map((version) => [version.id, version.revision]))
  return right.every((version) => byId.get(version.id) === version.revision)
}

/**
 * Format one reviewed batch as a normal user message. Plain comment text comes
 * first under an explicit label; metadata follows on a separate labeled line.
 * @param drafts - exact reviewed drafts, in display order.
 * @returns the message body; empty for an empty batch.
 */
export function formatCommentBatch(drafts: readonly CommentDraft[]): string {
  if (drafts.length === 0) return ''
  const revisions = [...new Set(drafts.map((draft) => draft.anchor.revision))].sort((left, right) => left - right)
  const lines = [
    'Design review comments (' +
      String(drafts.length) +
      (drafts.length === 1 ? ' comment' : ' comments') +
      '). Design revision ' +
      revisions.join(', ') +
      '.',
  ]
  for (const [index, draft] of drafts.entries()) {
    const anchor =
      draft.anchor.kind === 'stable'
        ? 'stable id "' + draft.anchor.id + '"'
        : 'structural address "' + draft.anchor.id + '" (unstable)'
    const details = [
      'screen=' + draft.context.screen,
      'breakpoint=' + draft.context.breakpoint,
      'component=' + draft.anchor.type,
      'anchor=' + anchor,
      'design revision=' + String(draft.anchor.revision),
    ]
    if (draft.context.state !== undefined) details.push('named state=' + draft.context.state)
    if (draft.context.theme !== undefined) details.push('theme=' + draft.context.theme)
    if (draft.context.overlays !== undefined && draft.context.overlays.length > 0)
      details.push('overlays=' + draft.context.overlays.join(','))
    const tabs = Object.entries(draft.context.tabs)
    if (tabs.length > 0) details.push('tabs=' + tabs.map(([key, value]) => key + '=' + value).join(','))
    if (draft.context.variant !== undefined) details.push('variant=' + draft.context.variant)
    const text = draft.text.replace(/\r\n/g, '\n').replace(/\n/g, '\n   ')
    lines.push('', String(index + 1) + '. Comment: ' + text, '   Context: ' + details.join('; '))
    if (draft.context.theme !== undefined || draft.context.disclosures !== undefined) {
      lines.push(
        '   Review context: ' +
          JSON.stringify({
            screen: draft.context.screen,
            ...(draft.context.theme === undefined
              ? {}
              : { theme: draft.context.theme, selection: draft.context.variant ?? '' }),
            open: draft.context.overlays,
            tabs: draft.context.tabs,
            disclosures: draft.context.disclosures,
          }),
      )
    }
  }
  return lines.join('\n')
}
