import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, callTool, type HostHarness } from './harness.ts'
import { diffGitRevisions, diffProjections } from '../src/diff.ts'
import { loadProject, scaffoldProject } from '@filipeesch/dsh-design-core'
import { kitMetadata } from '@filipeesch/dsh-design-kit/meta'

const run = promisify(execFile)
const harnesses: HostHarness[] = []
async function harness(): Promise<HostHarness> {
  const created = await createHarness()
  harnesses.push(created)
  return created
}
afterEach(() => {
  for (const created of harnesses.splice(0)) created.close()
})

function tree(source: string) {
  // Imported lazily to keep this spec's top-level imports focused.
  return import('../src/diff.ts')
    .then(() => import('@filipeesch/dsh-design-core'))
    .then((core) => {
      const parsed = core.parseScreen(source, 'screens/home.dsx')
      if (parsed.root === undefined) throw new Error('parse failed: ' + JSON.stringify(parsed.diagnostics))
      return parsed.root
    })
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run('git', ['-C', cwd, ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout
}

async function commit(cwd: string, message: string): Promise<string> {
  await git(cwd, ['add', '-A'])
  await git(cwd, ['commit', '-m', message])
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
}

async function gitProject(): Promise<{ root: string; folder: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-diff-'))
  await scaffoldProject(root, { kitVersion: '1.0.0' })
  await git(root, ['init', '-b', 'main'])
  await git(root, ['config', 'user.email', 'review@example.invalid'])
  await git(root, ['config', 'user.name', 'Review'])
  return { root, folder: join(root, 'design') }
}

const left = [
  '<Screen id="home" title="Home">',
  '  <Stack id="actions" gap="spacing.sm"><Button id="save" variant="primary">Save</Button></Stack>',
  '  <Stack id="footer" gap="spacing.sm"><Text>Footer</Text><Input id="field" label="Name" /></Stack>',
  '</Screen>',
].join('\n')

const right = [
  '<Screen id="home" title="Home">',
  '  <Stack id="actions" gap="spacing.sm"></Stack>',
  '  <Stack id="footer" gap="spacing.sm"><Text>Footer</Text><Input id="field" label="Name" disabled /><Button id="save" variant="secondary">Save now</Button></Stack>',
  '</Screen>',
].join('\n')

describe('semantic projection diff', () => {
  it('reports a stable move without claiming it as removed and added', async () => {
    const diff = diffProjections(await tree(left), await tree(right))
    expect(diff.removals).toEqual([])
    expect(diff.additions).toEqual([])
    expect(diff.moves).toContainEqual(expect.objectContaining({ node: 'save', reason: 'parent', match: 'stable' }))
    expect(diff.changes).toContainEqual(
      expect.objectContaining({ node: 'save', kind: 'prop', prop: 'variant', before: 'primary', after: 'secondary' }),
    )
    expect(diff.changes).toContainEqual(
      expect.objectContaining({ node: 'save', kind: 'text', before: 'Save', after: 'Save now' }),
    )
    expect(diff.changes).toContainEqual(
      expect.objectContaining({
        node: 'field',
        kind: 'prop',
        prop: 'disabled',
        beforeType: 'undefined',
        afterType: 'boolean',
      }),
    )
  })

  it('does not treat insertion shifts as moving every following node', async () => {
    const before = await tree(
      '<Screen id="home"><Stack id="list"><Button id="a">A</Button><Button id="b">B</Button><Button id="c">C</Button></Stack></Screen>',
    )
    const after = await tree(
      '<Screen id="home"><Stack id="list"><Button id="x">X</Button><Button id="a">A</Button><Button id="b">B</Button><Button id="c">C</Button></Stack></Screen>',
    )
    const diff = diffProjections(before, after)
    expect(diff.moves).toEqual([])
    expect(diff.additions.map((entry) => entry.node)).toEqual(['x'])
    expect(diff.removals).toEqual([])
  })

  it('reports reordered stable siblings and labels anonymous fallback', async () => {
    const before = await tree(
      '<Screen id="home"><Stack id="list"><Button id="a">A</Button><Button id="b">B</Button><Button id="c">C</Button></Stack></Screen>',
    )
    const after = await tree(
      '<Screen id="home"><Stack id="list"><Button id="a">A</Button><Button id="c">C</Button><Button id="b">B</Button></Stack></Screen>',
    )
    const diff = diffProjections(before, after)
    expect(diff.moves).toHaveLength(1)
    expect(diff.moves[0]?.reason).toBe('order')
    const anonBefore = await tree('<Screen id="home"><Stack><Text>One</Text></Stack></Screen>')
    const anonAfter = await tree('<Screen id="home"><Stack><Text>Two</Text></Stack></Screen>')
    const anonDiff = diffProjections(anonBefore, anonAfter)
    expect(anonDiff.changes[0]).toMatchObject({ kind: 'text', match: 'structural', before: 'One', after: 'Two' })
  })

  it('reports removals and additions deterministically', async () => {
    const before = await tree('<Screen id="home"><Stack id="list"><Button id="gone">Gone</Button></Stack></Screen>')
    const after = await tree('<Screen id="home"><Stack id="list"><Button id="fresh">Fresh</Button></Stack></Screen>')
    const diff = diffProjections(before, after)
    expect(diff.removals.map((entry) => entry.node)).toEqual(['gone'])
    expect(diff.additions.map((entry) => entry.node)).toEqual(['fresh'])
  })
})

describe('design_diff tool', () => {
  it('compares two branches of one screen deterministically', async () => {
    const h = await harness()
    const source = [
      '<Screen id="home" title="Home">',
      '  <Variants id="layout" chosen="compact">',
      '    <Variant branch="compact"><Stack id="actions"><Button id="save" variant="primary">Save</Button></Stack><Stack id="footer"><Text>Footer</Text></Stack></Variant>',
      '    <Variant branch="spacious"><Stack id="actions"></Stack><Stack id="footer"><Button id="save" variant="secondary">Save now</Button></Stack></Variant>',
      '  </Variants>',
      '</Screen>',
    ].join('\n')
    await writeFile(join(h.root, 'design', 'screens', 'home.dsx'), source)
    const first = await callTool(
      h,
      'design_diff',
      { screen: 'home', group: 'layout', from: 'compact', to: 'spacious' },
      h.root,
    )
    const second = await callTool(
      h,
      'design_diff',
      { screen: 'home', group: 'layout', from: 'compact', to: 'spacious' },
      h.root,
    )
    expect(first).toEqual(second)
    expect(first.mode).toBe('variants')
    expect(first.moves).toContainEqual(expect.objectContaining({ node: 'save', reason: 'parent' }))
    expect(first.changes).toContainEqual(expect.objectContaining({ node: 'save', kind: 'text' }))
    await expect(
      callTool(h, 'design_diff', { screen: 'home', group: 'layout', from: 'compact', to: 'missing' }, h.root),
    ).resolves.toMatchObject({ ok: false })
  })
})

describe('git revision diff', () => {
  it('compares committed revisions without touching the worktree, index, or branch', async () => {
    const { root, folder } = await gitProject()
    await writeFile(join(folder, 'screens', 'home.dsx'), left)
    const first = await commit(root, 'initial')
    await writeFile(join(folder, 'screens', 'home.dsx'), right)
    const second = await commit(root, 'move and rename')
    await writeFile(join(folder, 'screens', 'home.dsx'), right.replace('Save now', 'Uncommitted worktree edit'))
    const beforeStatus = await git(root, ['status', '--porcelain'])
    const beforeIndex = await git(root, ['diff', '--cached'])
    const beforeBranch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const project = await loadProject({ folder, kit: kitMetadata, installedKitVersion: '1.0.0' })
    const diff = await diffGitRevisions(project, 'home', first, second)
    expect(diff.ok).toBe(true)
    expect(diff.mode).toBe('revisions')
    expect(diff.from).toBe(first)
    expect(diff.to).toBe(second)
    expect(diff.moves).toContainEqual(expect.objectContaining({ node: 'save', reason: 'parent' }))
    expect(diff.changes).toContainEqual(expect.objectContaining({ node: 'save', kind: 'text', after: 'Save now' }))
    expect(JSON.stringify(diff)).not.toContain('Uncommitted worktree edit')
    expect(await git(root, ['status', '--porcelain'])).toBe(beforeStatus)
    expect(await git(root, ['diff', '--cached'])).toBe(beforeIndex)
    expect(await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(beforeBranch)
    expect((await readFile(join(folder, 'screens', 'home.dsx'), 'utf8')).includes('Uncommitted worktree edit')).toBe(
      true,
    )
  })

  it('reports unavailable revisions and missing historic inputs without substitution', async () => {
    const { root, folder } = await gitProject()
    await writeFile(join(folder, 'screens', 'home.dsx'), left)
    const first = await commit(root, 'initial')
    const project = await loadProject({ folder, kit: kitMetadata, installedKitVersion: '1.0.0' })
    const unavailable = await diffGitRevisions(project, 'home', first, 'does-not-exist')
    expect(unavailable.ok).toBe(false)
    expect(unavailable.diagnostics[0]?.code).toBe('revision-unavailable')
    await git(root, ['rm', 'design/tokens.json'])
    const broken = await commit(root, 'drop tokens')
    const missing = await diffGitRevisions(project, 'home', first, broken)
    expect(missing.ok).toBe(false)
    expect(missing.diagnostics[0]?.code).toBe('history-missing-input')
    expect(missing.diagnostics[0]?.message).toContain('tokens.json')
  })

  it('honors malformed committed config and tokens diagnostics', async () => {
    const { root, folder } = await gitProject()
    await writeFile(join(folder, 'screens', 'home.dsx'), left)
    const first = await commit(root, 'initial')
    await writeFile(join(folder, 'design.json'), '{')
    const brokenConfig = await commit(root, 'break config')
    const project = await loadProject({ folder, kit: kitMetadata, installedKitVersion: '1.0.0' })
    const configDiff = await diffGitRevisions(project, 'home', first, brokenConfig)
    expect(configDiff.ok).toBe(false)
    expect(configDiff.diagnostics[0]?.code).toBe('config-json')

    await writeFile(join(folder, 'design.json'), JSON.stringify({ kitVersion: '1.0.0' }))
    await writeFile(join(folder, 'tokens.json'), '{')
    const brokenTokens = await commit(root, 'break tokens')
    const tokenDiff = await diffGitRevisions(project, 'home', first, brokenTokens)
    expect(tokenDiff.ok).toBe(false)
    expect(tokenDiff.diagnostics[0]?.code).toBe('tokens-json')
  })

  it('rejects duplicate committed screen ids and ignores nested archive screens', async () => {
    const { root, folder } = await gitProject()
    await writeFile(join(folder, 'screens', 'home.dsx'), left)
    const first = await commit(root, 'initial')
    await writeFile(join(folder, 'screens', 'copy.dsx'), left)
    const duplicate = await commit(root, 'duplicate screen')
    const project = await loadProject({ folder, kit: kitMetadata, installedKitVersion: '1.0.0' })
    const duplicateDiff = await diffGitRevisions(project, 'home', first, duplicate)
    expect(duplicateDiff.ok).toBe(false)
    expect(duplicateDiff.diagnostics[0]?.code).toBe('history-duplicate-screen')

    await git(root, ['rm', 'design/screens/copy.dsx'])
    await mkdir(join(folder, 'archive', 'screens'), { recursive: true })
    await writeFile(join(folder, 'archive', 'screens', 'broken.dsx'), '<Screen id="home">')
    const archived = await commit(root, 'archive screen')
    const archivedDiff = await diffGitRevisions(project, 'home', first, archived)
    expect(archivedDiff.ok).toBe(true)
  })

  it('reports an absent screen at one revision', async () => {
    const { root, folder } = await gitProject()
    await writeFile(join(folder, 'screens', 'home.dsx'), left)
    const first = await commit(root, 'initial')
    await writeFile(join(folder, 'screens', 'home.dsx'), left.replace('id="home"', 'id="renamed"'))
    const second = await commit(root, 'rename screen')
    const project = await loadProject({ folder, kit: kitMetadata, installedKitVersion: '1.0.0' })
    const diff = await diffGitRevisions(project, 'home', first, second)
    expect(diff.ok).toBe(false)
    expect(diff.diagnostics[0]?.code).toBe('history-screen-missing')
  })
})
