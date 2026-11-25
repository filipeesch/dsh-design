import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { designPrompt } from '../src/prompt.ts'
import { designPresetPlugins } from '../src/plugins.ts'

const bundleRoot = new URL('../../bundle/', import.meta.url).pathname

describe('design prompt', () => {
  it('stays under 6,000 characters and points at design_catalog', () => {
    const prompt = designPrompt()
    expect(prompt.length).toBeLessThan(6000)
    expect(prompt).toContain('design_catalog')
    expect(prompt).toContain('design_status')
    expect(prompt).toContain('design_init')
    expect(prompt).toContain('design_view')
    expect(prompt).toContain('tokens.json')
    expect(prompt).toContain('css')
    expect(prompt).toContain('design_run_journey')
    expect(prompt).toContain('design_lint')
    expect(prompt).toContain('design_screenshot')
    expect(prompt).toContain('design_query')
    expect(prompt).toContain('fixture(')
    expect(prompt).toContain('<Journey')
    expect(prompt).toContain('FICTITIOUS')
  })

  it('keeps checks opt-in and fixtures fictitious', () => {
    const prompt = designPrompt()
    expect(prompt).toContain('Never use real data')
    expect(prompt).toContain('only when visual evidence is needed')
    expect(prompt).toContain('Do not turn checks into a mandatory checklist')
  })

  it('does not embed per-component prop tables', () => {
    const prompt = designPrompt()
    expect(prompt).not.toContain('| Prop |')
    expect(prompt).not.toContain('options: array')
    expect((prompt.match(/required/g) ?? []).length).toBeLessThan(20)
  })
})

describe('design preset composition', () => {
  it('contains standard tools plus the design session plugin', () => {
    const plugins = designPresetPlugins()
    const names = plugins.map((entry) => entry.name)
    for (const standard of [
      '@deepseek-ai/dsh-tool-bash',
      '@deepseek-ai/dsh-tool-fs',
      '@deepseek-ai/dsh-tool-fs-search',
      '@deepseek-ai/dsh-tool-web',
      '@deepseek-ai/dsh-tool-todo',
      '@deepseek-ai/dsh-tool-skill',
    ])
      expect(names).toContain(standard)
    expect(plugins.at(-1)).toMatchObject({ id: 'design-session' })
  })

  it('drifts only when the shipped standard composition changes', async () => {
    const checkout = process.env.DSH_CHECKOUT
    if (checkout === undefined) {
      // The public repository has no private DSH checkout; the drift check runs
      // in an environment that provides one.
      expect(true).toBe(true)
      return
    }
    const source = await readFile(join(checkout, 'packages/bundle/web-app/presets/standard.patch.yml'), 'utf8')
    const doc = parse(source) as any[]
    const standard = doc[0].insert.find((row: any) => row.id === 'preset-standard').config.plugins as any[]
    const ours = designPresetPlugins().filter((entry) => entry.id !== 'design-session')
    const flatten = (entries: any[]): { id?: string; name: string }[] =>
      entries.flatMap((entry) => [
        { ...(entry.id === undefined ? {} : { id: entry.id }), name: entry.name },
        ...(Array.isArray(entry.config) ? flatten(entry.config) : []),
      ])
    expect(flatten(ours)).toEqual(flatten(standard))
  })
})

describe('bundle package', () => {
  it('declares a bundle patch and an embedded client package', async () => {
    const pkg = JSON.parse(await readFile(join(bundleRoot, 'package.json'), 'utf8'))
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(pkg.exports['./host']).toBe('./lib/host.js')
    const patch = await readFile(join(bundleRoot, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('./lib/host.js')
    expect(patch).toContain('./lib/preset.js')
    expect(patch).toContain('./lib/client-plugin/index.js')
  })
})
