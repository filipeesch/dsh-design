import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dist = new URL('../dist/', import.meta.url).pathname

describe('renderer static bundle', () => {
  it('references only relative resources from HTML and CSS', async () => {
    const html = await readFile(join(dist, 'index.html'), 'utf8')
    expect(html).not.toMatch(/(?:src|href)="https?:/)
    expect(html).not.toMatch(/(?:src|href)="\/\//)
    expect(html).toContain('./app.js')
    expect(html).toContain('./app.css')
    const css = await readFile(join(dist, 'app.css'), 'utf8')
    expect(css).not.toMatch(/url\(\s*['"]?https?:/i)
    expect(css).not.toMatch(/@import\s+url\(\s*['"]?https?:/i)
    expect(css).not.toMatch(/url\(\s*['"]?\/\//)
  })
})
