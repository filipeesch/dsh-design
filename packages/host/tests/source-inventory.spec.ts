import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseConfig, resolveProjectTheme } from '@filipeesch/dsh-design-core'
import { KIT_VERSION, kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { expect, it } from 'vitest'
import { changedFiles, ProjectRuntime } from '../src/runtime.ts'

it('shares bounded fingerprints with the loader for create/edit/delete, excluding unrelated edits', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'dsh-inventory-'))
  const runtime = new ProjectRuntime(folder, { kit: kitMetadata, installedKitVersion: KIT_VERSION })
  const path = (name: string) => join(folder, name)
  const put = (name: string, source: string) => writeFile(path(name), source)
  try {
    await Promise.all(['screens', 'layouts', 'themes', 'styles', 'assets'].map((name) => mkdir(path(name))))
    const files = ['layouts/shell.dsx', 'styles/base.css', 'themes/dark.json']
    await put(
      'design.json',
      JSON.stringify({ kitVersion: KIT_VERSION, stylesheets: [files[1]], themes: { dark: files[2] } }),
    )
    await put('tokens.json', '{}')
    await put('screens/home.dsx', '<Screen id="home" layout="shell"><Text styleClass="banner">Home</Text></Screen>')
    const missing = await runtime.get()
    const revision = runtime.currentRevision
    expect(missing.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'layout-missing', file: 'screens/home.dsx' }),
        ...files.slice(1).map((file) => expect.objectContaining({ code: 'source-missing', file })),
      ]),
    )
    let before = await runtime.fingerprint()
    async function verifyDelta(expected: readonly string[]) {
      const after = await runtime.fingerprint()
      expect(changedFiles(before, after)).toEqual(expected)
      before = after
    }
    await put('styles/undeclared.css', '.banner { padding: 100px; }')
    await put('themes/undeclared.json', '{"tokens":{}}')
    await put('assets/other.txt', 'unrelated')
    await verifyDelta([])
    await Promise.all([
      put(files[0]!, '<Layout><Text id="shared">A</Text><ContentSlot /></Layout>'),
      put(files[1]!, '.banner { padding: 5px; }'),
      put(files[2]!, '{"colorScheme":"dark","tokens":{}}'),
    ])
    await verifyDelta(files)
    const valid = await runtime.readCurrent()
    expect(runtime.currentRevision).toBe(revision)
    expect(runtime.peek()).toBe(missing)
    expect(valid.sourceFiles).toEqual(expect.arrayContaining(files))
    expect(valid.screens[0]?.root?.children[1]).toMatchObject({ classCss: [{ property: 'padding', value: '5px' }] })
    expect(resolveProjectTheme(valid, 'dark').colorScheme).toBe('dark')
    expect(valid.sourceIdentity).not.toBe(missing.sourceIdentity)
    await runtime.reload()
    await Promise.all([
      put(files[0]!, '<Layout><Text id="shared">B</Text><ContentSlot /></Layout>'),
      put(files[1]!, '.banner { padding: 6px; }'),
      put(files[2]!, '{"colorScheme":"light","tokens":{}}'),
    ])
    await verifyDelta(files)
    const edited = await runtime.reload()
    expect(edited.sourceIdentity).not.toBe(valid.sourceIdentity)
    expect(edited.screens[0]?.root?.children).toMatchObject([
      { children: [{ value: 'B' }] },
      { classCss: [{ property: 'padding', value: '6px' }] },
    ])
    expect(resolveProjectTheme(edited, 'dark').colorScheme).toBe('light')
    await Promise.all(files.map((file) => unlink(path(file))))
    await verifyDelta(files)
    const deleted = await runtime.readCurrent()
    expect(deleted.sourceIdentity).toBe(missing.sourceIdentity)
    expect(deleted.screens[0]?.blockingErrors).toBeGreaterThan(0)
    expect(deleted.screens[0]?.lastValidRoot).toBe(edited.screens[0]?.root)
    expect(() => resolveProjectTheme(deleted, 'dark')).toThrow('invalid')
    expect(deleted.lastValidThemes.dark).toBe(edited.themes.dark)
    await put(
      'design.json',
      JSON.stringify({
        kitVersion: KIT_VERSION,
        stylesheets: ['styles/../escape.css'],
        themes: { out: '../escape.json' },
      }),
    )
    await verifyDelta(['design.json', 'styles/base.css', 'themes/dark.json'])
    expect(
      parseConfig(JSON.stringify({ kitVersion: KIT_VERSION, stylesheets: ['styles/../escape.css'] }), 'design.json')
        .config.stylesheets,
    ).toEqual([])
  } finally {
    runtime.dispose()
    await rm(folder, { recursive: true, force: true })
  }
})
