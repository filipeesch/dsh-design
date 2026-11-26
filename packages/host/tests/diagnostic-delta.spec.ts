import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type Diagnostic } from '@filipeesch/dsh-design-core'
import { summarizeDiagnosticDelta } from '../src/diagnostic-delta.ts'
import { callTool, createHarness, runPipeline, writeScreen, type HostHarness } from './harness.ts'

let h: HostHarness
const notice = (decision: any): string | undefined => decision.additionalContexts?.[0]?.content?.[0]?.text
const invalid = '<Screen id="home"><Text bogus="yes">Hello</Text></Screen>'
const valid = '<Screen id="home"><Text>Hello</Text></Screen>'
const edit = (source: string) => runPipeline(h, h.exec('edit', h.root), () => writeScreen(h.root, 'home.dsx', source))

afterEach(() => h?.close())

describe('post-edit diagnostic deltas', () => {
  it('reports new and resolved diagnostics once and ignores a line shift, repeat, and clean edits', async () => {
    h = await createHarness()
    const persistent = '<Screen id="other"><OtherBadComponent /></Screen>'
    await writeScreen(h.root, 'other.dsx', persistent)
    const introduced = notice(await edit(invalid))
    expect(introduced).toContain('New: 1 error(s), 0 warning(s).')
    expect(introduced).toContain('screens/home.dsx:1:')
    expect(introduced).toContain('does not declare prop "bogus"')
    expect(introduced).not.toContain('OtherBadComponent')
    expect(notice(await edit('\n\n' + invalid))).toBeUndefined()
    expect(notice(await edit('\n\n' + invalid))).toBeUndefined()
    const explicit = await callTool(h, 'design_validate', {}, h.root)
    expect(explicit.errors).toBe(2)
    expect(explicit.diagnostics).toEqual([
      expect.objectContaining({ file: 'screens/home.dsx', code: 'unknown-prop', line: 3 }),
      expect.objectContaining({ file: 'screens/other.dsx', code: 'unknown-component' }),
    ])
    const fixed = notice(await edit(valid))
    expect(fixed).toContain('Resolved (previous locations): 1 error(s), 0 warning(s).')
    expect(fixed).toContain('screens/home.dsx:3:')
    expect(fixed).not.toContain('OtherBadComponent')
    expect(notice(await edit(valid.replace('Hello', 'Hi')))).toBeUndefined()
    expect(
      notice(await runPipeline(h, h.exec('bash', h.root), () => writeFile(join(h.root, 'README.md'), 'unrelated'))),
    ).toBeUndefined()
  })

  it('reports changed diagnostics in dependent source when a shell edit adds or repairs a reference', async () => {
    h = await createHarness()
    await writeScreen(
      h.root,
      'home.dsx',
      '<Screen id="home"><Button id="next" onPress={navigate("details")}>Next</Button></Screen>',
    )
    const fixed = await runPipeline(h, h.exec('bash', h.root), () =>
      writeScreen(h.root, 'details.dsx', '<Screen id="details"><Text>Details</Text></Screen>'),
    )
    expect(notice(fixed)).toContain('Resolved (previous locations): 1 error(s)')
    expect(notice(fixed)).toContain('screens/home.dsx:1:')
    const broken = await runPipeline(h, h.exec('bash', h.root), () =>
      writeScreen(h.root, 'details.dsx', '<Screen id="something-else"><Text>Details</Text></Screen>'),
    )
    expect(notice(broken)).toContain('New: 1 error(s)')
    expect(notice(broken)).toContain('screens/home.dsx:1:')
  })

  it('reports preview metadata diagnostics as design source changes', async () => {
    h = await createHarness()
    const path = join(h.root, 'design', 'preview.json')
    const broken = await runPipeline(h, h.exec('write', h.root), () => writeFile(path, '{invalid'))
    expect(notice(broken)).toContain('New: 1 error(s)')
    expect(notice(broken)).toContain('preview.json:1:')
    const fixed = await runPipeline(h, h.exec('write', h.root), () => writeFile(path, '{}'))
    expect(notice(fixed)).toContain('Resolved (previous locations): 1 error(s)')
  })

  it('compares only the outer end state for nested edits and omits transient issues', async () => {
    h = await createHarness()
    const outer = h.exec('run_code', h.root)
    const middle = h.exec('run_code', h.root, { parent: outer.token })
    const child = () => h.exec('edit', h.root, { parent: middle.token })
    const netClean = await runPipeline(h, outer, async () => {
      const mid = await runPipeline(h, middle, async () => {
        expect(notice(await runPipeline(h, child(), () => writeScreen(h.root, 'home.dsx', invalid)))).toBeUndefined()
        expect(notice(await runPipeline(h, child(), () => writeScreen(h.root, 'home.dsx', valid)))).toBeUndefined()
      })
      expect(notice(mid)).toBeUndefined()
    })
    expect(notice(netClean)).toBeUndefined()
    const netChange = await runPipeline(h, outer, async () => {
      expect(
        notice(
          await runPipeline(h, middle, async () => {
            expect(
              notice(await runPipeline(h, child(), () => writeScreen(h.root, 'home.dsx', invalid))),
            ).toBeUndefined()
          }),
        ),
      ).toBeUndefined()
    })
    expect(netChange.additionalContexts).toHaveLength(1)
    expect(notice(netChange)).toContain('New: 1 error(s)')
  })

  it('does not mistake syntax coordinates for identity or hide issues at stable ids', () => {
    const input: Diagnostic = {
      file: 'screens/home.dsx',
      line: 1,
      column: 12,
      severity: 'error',
      code: 'syntax-error',
      message: 'Syntax error: Unexpected token (1:11)',
    }
    expect(
      summarizeDiagnosticDelta([input], [{ ...input, line: 20, message: 'Syntax error: Unexpected token (20:11)' }]),
    ).toBeUndefined()
    const first = { ...input, code: 'unknown-prop', message: 'Unknown prop: missing', nodeId: 'first' }
    const second = { ...first, nodeId: 'second', line: 2 }
    const swapped = summarizeDiagnosticDelta([first], [second])
    expect(swapped).toContain('New: 1 error(s)')
    expect(swapped).toContain('Resolved (previous locations): 1 error(s)')
  })
})
