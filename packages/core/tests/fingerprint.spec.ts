import { describe, expect, it } from 'vitest'
import { parseScreen } from '../src/parse.ts'
import { fingerprintDesignTree } from '../src/fingerprint.ts'

function fingerprint(source: string): string {
  const root = parseScreen(source, 'screens/home.dsx').root
  expect(root).toBeDefined()
  return fingerprintDesignTree(root!)
}

describe('design tree fingerprint', () => {
  it('is stable for unchanged content and ignores source position and prop order', () => {
    const base = '<Screen id="home" title="Home"><Stack><Text>Hello</Text><Box a="1" b="2" /></Stack></Screen>'
    const shifted = '\n\n<Screen id="home" title="Home"><Stack><Text>Hello</Text><Box b="2" a="1" /></Stack></Screen>'
    expect(fingerprint(base)).toBe(fingerprint(base))
    expect(fingerprint(shifted)).toBe(fingerprint(base))
    expect(fingerprint(base)).toMatch(/^fp-[0-9a-f]{16}-[0-9a-f]{1,8}$/)
  })

  it('changes when text, structure, type, or a prop changes at the same address', () => {
    const base = '<Screen id="home" title="Home"><Stack><Text>Hello</Text></Stack></Screen>'
    const text = '<Screen id="home" title="Home"><Stack><Text>Hello there</Text></Stack></Screen>'
    const structure = '<Screen id="home" title="Home"><Stack><Text>Hello</Text><Text>Later</Text></Stack></Screen>'
    const type = '<Screen id="home" title="Home"><Stack><Box>Hello</Box></Stack></Screen>'
    const prop = '<Screen id="home" title="Home"><Stack><Text css="color: red">Hello</Text></Stack></Screen>'
    const original = fingerprint(base)
    expect(fingerprint(text)).not.toBe(original)
    expect(fingerprint(structure)).not.toBe(original)
    expect(fingerprint(type)).not.toBe(original)
    expect(fingerprint(prop)).not.toBe(original)
  })
})
