import { describe, expect, it } from 'vitest'
import {
  formatCommentBatch,
  parseCommentAnchor,
  parseCommentContext,
  parseCommentCreate,
  parseCommentRemove,
  parseCommentSubmit,
  parseCommentUpdate,
  sameCommentVersions,
  validateCommentText,
  type CommentDraft,
} from '../src/comments.ts'

const anchor = { id: 'filters', kind: 'stable', type: 'Drawer', revision: 3 } as const
const context = {
  screen: 'checkout',
  breakpoint: 'mobile',
  state: 'review-open',
  overlays: ['filters', 'toast'],
  tabs: { sections: 'open' },
} as const

describe('comment validation', () => {
  it('accepts a bounded typed comment and trims text', () => {
    const parsed = parseCommentCreate({ text: '  Tighten the heading  ', anchor, context })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.text).toBe('Tighten the heading')
    expect(parsed.value.anchor).toEqual(anchor)
    expect(parsed.value.context.overlays).toEqual(['filters', 'toast'])
  })

  it('rejects empty text, control characters, and oversized bodies', () => {
    expect(validateCommentText('   ').ok).toBe(false)
    expect(validateCommentText('bad\u0000text').ok).toBe(false)
    expect(validateCommentText('x'.repeat(2001)).ok).toBe(false)
    expect(validateCommentText('line one\nline two').ok).toBe(true)
  })

  it('rejects unknown fields instead of accepting free-form context', () => {
    expect(parseCommentCreate({ text: 'x', anchor, context, session: 'other' }).ok).toBe(false)
    expect(parseCommentContext({ ...context, values: { email: 'ada@example.com' } }).ok).toBe(false)
    expect(parseCommentAnchor({ ...anchor, content: 'secret' }).ok).toBe(false)
    expect(
      parseCommentCreate({
        text: 'x',
        anchor,
        context: { ...context, extra: true },
      }).ok,
    ).toBe(false)
  })

  it('accepts structural anchors and rejects malformed identities', () => {
    expect(
      parseCommentAnchor({
        id: '#0.2',
        kind: 'structural',
        type: 'Box',
        revision: 1,
        fingerprint: 'fp-0123456789abcdef-1a',
      }).ok,
    ).toBe(true)
    expect(parseCommentAnchor({ id: '#0.2', kind: 'structural', type: 'Box', revision: 1 }).ok).toBe(false)
    expect(parseCommentAnchor({ ...anchor, fingerprint: 'fp-0123456789abcdef-1a' }).ok).toBe(false)
    expect(parseCommentAnchor({ id: 'Button', kind: 'stable', type: 'Button', revision: 1 }).ok).toBe(false)
    expect(parseCommentAnchor({ id: '#0.2', kind: 'stable', type: 'Box', revision: 1 }).ok).toBe(false)
    expect(parseCommentAnchor({ id: 'box', kind: 'structural', type: 'Box', revision: 1 }).ok).toBe(false)
  })

  it('bounds overlays and tab selections and keeps only typed identifiers', () => {
    expect(parseCommentContext({ ...context, overlays: ['bad id'] }).ok).toBe(false)
    expect(
      parseCommentContext({ ...context, overlays: Array.from({ length: 21 }, (_, i) => 'overlay-' + String(i)) }).ok,
    ).toBe(false)
    expect(parseCommentContext({ ...context, tabs: { 'bad key': 'x' } }).ok).toBe(false)
    expect(parseCommentContext({ ...context, tabs: { 'radio:plan': 'x' } }).ok).toBe(false)
  })

  it('requires the exact draft revision for edits and removal', () => {
    const update = parseCommentUpdate({ id: 'draft-1', revision: 2, text: 'Changed' })
    expect(update.ok).toBe(true)
    expect(parseCommentUpdate({ id: 'draft-1', text: 'Changed' }).ok).toBe(false)
    expect(parseCommentUpdate({ id: 'draft-1', revision: -1, text: 'Changed' }).ok).toBe(false)
    expect(parseCommentRemove({ id: 'draft-1', revision: 1 }).ok).toBe(true)
  })

  it('validates a submission and rejects duplicate versions', () => {
    expect(parseCommentSubmit({ requestId: 'review-request-1', versions: [{ id: 'a', revision: 1 }] }).ok).toBe(true)
    expect(parseCommentSubmit({ requestId: 'short', versions: [{ id: 'a', revision: 1 }] }).ok).toBe(false)
    expect(
      parseCommentSubmit({
        requestId: 'review-request-1',
        versions: [
          { id: 'a', revision: 1 },
          { id: 'a', revision: 1 },
        ],
      }).ok,
    ).toBe(false)
    expect(parseCommentSubmit({ requestId: 'review-request-1', versions: [] }).ok).toBe(false)
  })
})

describe('comment batch formatting', () => {
  const draft = (overrides: Partial<CommentDraft> = {}): CommentDraft => ({
    id: 'draft-1',
    revision: 1,
    text: 'Make this primary',
    anchor,
    context,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  })

  it('numbers items and separates comment text from metadata', () => {
    const message = formatCommentBatch([
      draft(),
      draft({
        id: 'draft-2',
        anchor: { id: '#0.1', kind: 'structural', type: 'Button', revision: 4 },
        text: 'Align left',
      }),
    ])
    expect(message).toContain('Design review comments (2 comments). Design revision 3, 4.')
    expect(message).toContain('1. Comment: Make this primary')
    expect(message).toContain('2. Comment: Align left')
    expect(message).toContain(
      'Context: screen=checkout; breakpoint=mobile; component=Drawer; anchor=stable id "filters"',
    )
    expect(message).toContain('structural address "#0.1" (unstable)')
    expect(message).toContain('named state=review-open')
    expect(message).toContain('overlays=filters,toast')
    expect(message).toContain('tabs=sections=open')
    expect(message).not.toContain('ada@example.com')
  })

  it('keeps metadata on its own line and preserves multi-line comment text', () => {
    const message = formatCommentBatch([draft({ text: 'First line\nSecond line' })])
    const lines = message.split('\n')
    expect(lines).toContain('1. Comment: First line')
    expect(lines).toContain('   Second line')
    expect(lines.some((line) => line.startsWith('   Context: '))).toBe(true)
  })

  it('carries the effective variant in the sent batch', () => {
    const message = formatCommentBatch([draft({ context: { ...context, variant: 'layout:spacious' } })])
    expect(message).toContain('variant=layout:spacious')
    expect(parseCommentContext({ ...context, variant: 'layout:spacious' }).ok).toBe(true)
    expect(parseCommentContext({ ...context, variant: 'bad\u0000id' }).ok).toBe(false)
  })

  it('returns an empty message for an empty batch', () => {
    expect(formatCommentBatch([])).toBe('')
  })

  it('compares exact version sets independent of ordering', () => {
    expect(
      sameCommentVersions(
        [
          { id: 'a', revision: 1 },
          { id: 'b', revision: 2 },
        ],
        [
          { id: 'b', revision: 2 },
          { id: 'a', revision: 1 },
        ],
      ),
    ).toBe(true)
    expect(sameCommentVersions([{ id: 'a', revision: 1 }], [{ id: 'a', revision: 2 }])).toBe(false)
    expect(
      sameCommentVersions(
        [{ id: 'a', revision: 1 }],
        [
          { id: 'a', revision: 1 },
          { id: 'b', revision: 1 },
        ],
      ),
    ).toBe(false)
  })
})
