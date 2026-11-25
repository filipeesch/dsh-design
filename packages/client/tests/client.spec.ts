// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client.tsx'

describe('client plugin', () => {
  it('marks the document when applied without registering a dead action', () => {
    apply({})
    expect(document.documentElement.dataset.dshDesignClient).toBe('loaded')
  })
})
