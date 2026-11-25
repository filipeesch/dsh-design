import { createServer, type Server } from 'node:http'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommentStore, CommentStoreError } from '../src/comments.ts'
import { createHarness, type HostHarness } from './harness.ts'

const harnesses: HostHarness[] = []

async function harness(options: Parameters<typeof createHarness>[0] = {}): Promise<HostHarness> {
  const created = await createHarness(options)
  harnesses.push(created)
  return created
}

afterEach(() => {
  for (const created of harnesses.splice(0)) created.close()
})

const anchor = { id: 'filters', kind: 'stable' as const, type: 'Drawer', revision: 3 }
const context = {
  screen: 'checkout',
  breakpoint: 'mobile',
  state: 'review-open',
  overlays: ['filters'],
  tabs: { sections: 'open' },
}
const input = { text: 'Tighten the heading', anchor, context }

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('comment store', () => {
  it('stores bounded drafts per session with revision-aware edits', () => {
    const store = new CommentStore({ now: () => 10 })
    const created = store.create('session-a', input)
    expect(created.drafts).toHaveLength(1)
    const draft = created.drafts[0]!
    expect(draft.id.length).toBeGreaterThan(8)
    expect(draft.revision).toBe(1)
    expect(draft.anchor).toEqual(anchor)
    expect(store.create('session-b', { ...input, text: 'Other session' }).drafts[0]?.text).toBe('Other session')
    expect(store.snapshot('session-a').drafts).toHaveLength(1)
    const edited = store.update('session-a', { id: draft.id, revision: 1, text: 'Edited text' })
    expect(edited.drafts[0]?.text).toBe('Edited text')
    expect(edited.drafts[0]?.revision).toBe(2)
    expect(() => store.update('session-a', { id: draft.id, revision: 1, text: 'Stale' })).toThrow(CommentStoreError)
    expect(() => store.remove('session-a', { id: draft.id, revision: 1 })).toThrow(CommentStoreError)
    expect(store.remove('session-a', { id: draft.id, revision: 2 }).drafts).toHaveLength(0)
    store.clearSession('session-b')
    expect(store.snapshot('session-b').drafts).toHaveLength(0)
    store.dispose()
  })

  it('enforces the per-session draft bound', () => {
    const store = new CommentStore({ maxDrafts: 1 })
    store.create('session-a', input)
    expect(() => store.create('session-a', { ...input, text: 'Second' })).toThrow(/maximum/)
    expect(store.snapshot('session-a').drafts).toHaveLength(1)
  })

  it('sends exact versions once and replays an accepted request id', async () => {
    const prompt = vi.fn(async () => ({ accepted: true as const }))
    const store = new CommentStore({ prompt: () => ({ prompt }), now: () => 50 })
    store.create('session-a', input)
    const second = store.create('session-a', { ...input, text: 'Second note' })
    const versions = second.drafts.map((draft) => ({ id: draft.id, revision: draft.revision }))
    const accepted = await store.submit('session-a', 'review-request-1', versions)
    expect(accepted.accepted).toBe(true)
    expect(accepted.replayed).toBe(false)
    expect(accepted.cleared).toHaveLength(2)
    expect(accepted.snapshot.drafts).toHaveLength(0)
    expect(prompt).toHaveBeenCalledTimes(1)
    const sent = prompt.mock.calls[0]![0] as { sessionId: string; mode: string; content: { text: string }[] }
    expect(sent.sessionId).toBe('session-a')
    expect(sent.mode).toBe('queue')
    expect(sent.content[0]?.text).toContain('Design review comments (2 comments)')
    expect(sent.content[0]?.text).toContain('Tighten the heading')
    expect(sent.content[0]?.text).toContain('Second note')
    const replay = await store.submit('session-a', 'review-request-1', versions)
    expect(replay.replayed).toBe(true)
    expect(replay.acceptedAt).toBe(accepted.acceptedAt)
    expect(prompt).toHaveBeenCalledTimes(1)
    await expect(
      store.submit('session-a', 'review-request-1', [{ id: versions[0]!.id, revision: 99 }]),
    ).rejects.toMatchObject({ code: 'stale' })
  })

  it('keeps drafts on rejection and preserves drafts added during a send', async () => {
    const gate = deferred<{ accepted: true }>()
    const prompt = vi.fn(() => gate.promise)
    const store = new CommentStore({ prompt: () => ({ prompt }), now: () => 5 })
    const first = store.create('session-a', input)
    const versions = first.drafts.map((draft) => ({ id: draft.id, revision: draft.revision }))
    const pending = store.submit('session-a', 'review-request-2', versions)
    const added = store.create('session-a', { ...input, text: 'Added during send' })
    gate.resolve({ accepted: true })
    const accepted = await pending
    expect(accepted.cleared).toEqual([first.drafts[0]!.id])
    expect(accepted.snapshot.drafts.map((draft) => draft.id)).toEqual([added.drafts.at(-1)!.id])
    expect(accepted.snapshot.drafts[0]?.text).toBe('Added during send')
  })

  it('keeps drafts when admission fails or is unavailable', async () => {
    const rejecting = vi.fn(async () => ({ ok: false as const, error: { code: 'agent-busy', message: 'busy' } }))
    const store = new CommentStore({ prompt: () => ({ prompt: rejecting }) })
    const first = store.create('session-a', input)
    const versions = first.drafts.map((draft) => ({ id: draft.id, revision: draft.revision }))
    await expect(store.submit('session-a', 'review-request-3', versions)).rejects.toMatchObject({
      code: 'delivery-rejected',
      retryable: true,
    })
    expect(store.snapshot('session-a').drafts).toHaveLength(1)
    const unavailable = new CommentStore({})
    unavailable.create('session-a', input)
    const version = unavailable
      .snapshot('session-a')
      .drafts.map((draft) => ({ id: draft.id, revision: draft.revision }))
    await expect(unavailable.submit('session-a', 'review-request-4', version)).rejects.toMatchObject({
      code: 'delivery-unavailable',
    })
  })

  it('retries the same request id after an explicit rejection', async () => {
    const prompt = vi
      .fn()
      .mockRejectedValueOnce(new Error('rejected once'))
      .mockResolvedValueOnce({ accepted: true as const })
    const store = new CommentStore({ prompt: () => ({ prompt }) })
    const first = store.create('session-a', input)
    const versions = first.drafts.map((draft) => ({ id: draft.id, revision: draft.revision }))
    await expect(store.submit('session-a', 'review-reject-retry', versions)).rejects.toMatchObject({
      code: 'delivery-rejected',
      retryable: true,
    })
    expect(store.snapshot('session-a').drafts).toHaveLength(1)
    const accepted = await store.submit('session-a', 'review-reject-retry', versions)
    expect(accepted.replayed).toBe(false)
    expect(accepted.cleared).toEqual([first.drafts[0]!.id])
    expect(prompt).toHaveBeenCalledTimes(2)
  })

  it('keeps a later draft when replaying an accepted request id', async () => {
    const gate = deferred<{ accepted: true }>()
    const prompt = vi.fn(() => gate.promise)
    const store = new CommentStore({ prompt: () => ({ prompt }) })
    const first = store.create('session-a', input)
    const versions = first.drafts.map((draft) => ({ id: draft.id, revision: draft.revision }))
    const pending = store.submit('session-a', 'review-later-draft', versions)
    const later = store.create('session-a', { ...input, text: 'Written while sending' })
    gate.resolve({ accepted: true })
    const accepted = await pending
    expect(accepted.cleared).toEqual([first.drafts[0]!.id])
    const replay = await store.submit('session-a', 'review-later-draft', versions)
    expect(replay.replayed).toBe(true)
    expect(replay.snapshot.drafts.map((draft) => draft.id)).toEqual([later.drafts.at(-1)!.id])
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('submits every accepted live draft in one batch', async () => {
    const prompt = vi.fn(async () => ({ accepted: true as const }))
    const store = new CommentStore({ prompt: () => ({ prompt }) })
    let snapshot = store.create('session-a', input)
    for (let index = 1; index < 50; index += 1) {
      snapshot = store.create('session-a', { ...input, text: 'Draft ' + String(index) })
    }
    expect(snapshot.drafts).toHaveLength(50)
    expect(() => store.create('session-a', { ...input, text: 'Over the limit' })).toThrow(/maximum/)
    const versions = snapshot.drafts.map((draft) => ({ id: draft.id, revision: draft.revision }))
    const accepted = await store.submit('session-a', 'review-full-batch', versions)
    expect(accepted.cleared).toHaveLength(50)
    expect(accepted.snapshot.drafts).toHaveLength(0)
  })

  it('serializes submissions per session', async () => {
    const gate = deferred<{ accepted: true }>()
    const prompt = vi.fn(() => gate.promise)
    const store = new CommentStore({ prompt: () => ({ prompt }) })
    const first = store.create('session-a', input)
    const versions = first.drafts.map((draft) => ({ id: draft.id, revision: draft.revision }))
    const one = store.submit('session-a', 'review-request-5', versions)
    const two = store.submit('session-a', 'review-request-5', versions)
    gate.resolve({ accepted: true })
    const [firstResult, secondResult] = await Promise.all([one, two])
    expect(firstResult.replayed).toBe(false)
    expect(secondResult.replayed).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
  })
})

async function listen(
  route: (req: any, res: any, peer: any) => Promise<void>,
  peer: any = { principal: { kind: 'owner' } },
): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    void route(req, res, peer)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { server, base: 'http://127.0.0.1:' + String(address.port) }
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', 'x-dsh-design-comments': '1', ...extra }
}

async function routeHarness(options: Parameters<typeof createHarness>[0] = {}): Promise<{
  h: HostHarness
  server: Server
  base: string
}> {
  const h = await harness(options)
  h.sessions.set('session-test', { id: 'session-test', header: { cwd: h.root } })
  const { server, base } = await listen(h.route)
  return { h, server, base }
}

describe('comment routes', () => {
  it('lists comments for the owner and refuses another principal', async () => {
    const { h, server, base } = await routeHarness()
    try {
      const list = await fetch(base + '/design/session-test/_/comments')
      expect(list.status).toBe(200)
      expect(await list.json()).toEqual({ session: 'session-test', revision: 0, drafts: [] })
      const created = await fetch(base + '/design/session-test/_/comments/create', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(input),
      })
      expect(created.status).toBe(200)
      const snapshot = (await created.json()) as any
      expect(snapshot.drafts).toHaveLength(1)
      expect(snapshot.drafts[0].text).toBe('Tighten the heading')
      expect(snapshot.drafts[0].anchor).toEqual(anchor)
      expect(snapshot.drafts[0].context.overlays).toEqual(['filters'])
      const again = (await (await fetch(base + '/design/session-test/_/comments')).json()) as any
      expect(again.drafts).toHaveLength(1)
    } finally {
      await close(server)
    }
    void h
  })

  it('refuses a non-owner before reading comment state', async () => {
    const h = await harness()
    h.sessions.set('session-test', { id: 'session-test', header: { cwd: h.root } })
    const { server, base } = await listen(h.route, { principal: { kind: 'subagent' } })
    try {
      const response = await fetch(base + '/design/session-test/_/comments')
      expect(response.status).toBe(403)
      expect(await response.text()).toBe('owner access required')
    } finally {
      await close(server)
    }
  })

  it('requires deliberate same-origin JSON mutations and route-scoped sessions', async () => {
    const { h, server, base } = await routeHarness()
    try {
      const path = base + '/design/session-test/_/comments/create'
      const noIntent = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      expect(noIntent.status).toBe(403)
      const crossOrigin = await fetch(path, {
        method: 'POST',
        headers: headers({ origin: 'https://example.invalid' }),
        body: JSON.stringify(input),
      })
      expect(crossOrigin.status).toBe(403)
      const notJson = await fetch(path, {
        method: 'POST',
        headers: { 'x-dsh-design-comments': '1', 'content-type': 'text/plain' },
        body: JSON.stringify(input),
      })
      expect(notJson.status).toBe(415)
      const withSession = await fetch(path, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ ...input, session: 'session-other' }),
      })
      expect(withSession.status).toBe(400)
      const invalid = await fetch(path, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ ...input, text: '' }),
      })
      expect(invalid.status).toBe(400)
      const oversized = await fetch(path, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ ...input, text: 'x'.repeat(70 * 1024) }),
      })
      expect(oversized.status).toBe(413)
      const sameOrigin = await fetch(path, {
        method: 'POST',
        headers: headers({ origin: base, 'sec-fetch-site': 'same-origin' }),
        body: JSON.stringify(input),
      })
      expect(sameOrigin.status).toBe(200)
      expect((await sameOrigin.json()) as any).toMatchObject({ session: 'session-test' })
    } finally {
      await close(server)
    }
    void h
  })

  it('edits and removes only the reviewed revision', async () => {
    const { h, server, base } = await routeHarness()
    try {
      const created = (await (
        await fetch(base + '/design/session-test/_/comments/create', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(input),
        })
      ).json()) as any
      const draft = created.drafts[0]
      const edited = await fetch(base + '/design/session-test/_/comments/update', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ id: draft.id, revision: draft.revision, text: 'Edited' }),
      })
      expect(edited.status).toBe(200)
      const editedSnapshot = (await edited.json()) as any
      expect(editedSnapshot.drafts[0].text).toBe('Edited')
      expect(editedSnapshot.drafts[0].revision).toBe(2)
      const stale = await fetch(base + '/design/session-test/_/comments/remove', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ id: draft.id, revision: draft.revision }),
      })
      expect(stale.status).toBe(409)
      const removed = await fetch(base + '/design/session-test/_/comments/remove', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ id: draft.id, revision: 2 }),
      })
      expect(removed.status).toBe(200)
      expect(((await removed.json()) as any).drafts).toHaveLength(0)
    } finally {
      await close(server)
    }
    void h
  })

  it('submits once, replays idempotently, and keeps drafts on rejection', async () => {
    const prompt = vi.fn(async () => ({ accepted: true as const }))
    const { h, server, base } = await routeHarness({ sessionController: { prompt } })
    try {
      const created = (await (
        await fetch(base + '/design/session-test/_/comments/create', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(input),
        })
      ).json()) as any
      const versions = created.drafts.map((draft: any) => ({ id: draft.id, revision: draft.revision }))
      const submit = () =>
        fetch(base + '/design/session-test/_/comments/submit', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ requestId: 'review-request-route', versions }),
        })
      const accepted = await submit()
      expect(accepted.status).toBe(200)
      const acceptedBody = (await accepted.json()) as any
      expect(acceptedBody).toMatchObject({ accepted: true, replayed: false })
      expect(acceptedBody.snapshot.drafts).toHaveLength(0)
      expect(prompt).toHaveBeenCalledTimes(1)
      const replayed = (await (await submit()).json()) as any
      expect(replayed.replayed).toBe(true)
      expect(prompt).toHaveBeenCalledTimes(1)

      const rejecting = vi.fn(async () => {
        throw new Error('simulated rejection')
      })
      const second = await routeHarness({ sessionController: { prompt: rejecting } })
      try {
        const kept = (await (
          await fetch(second.base + '/design/session-test/_/comments/create', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify(input),
          })
        ).json()) as any
        const keptVersions = kept.drafts.map((draft: any) => ({ id: draft.id, revision: draft.revision }))
        const rejected = await fetch(second.base + '/design/session-test/_/comments/submit', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ requestId: 'review-request-rejected', versions: keptVersions }),
        })
        expect(rejected.status).toBe(502)
        expect(((await rejected.json()) as any).retryable).toBe(true)
        const list = (await (await fetch(second.base + '/design/session-test/_/comments')).json()) as any
        expect(list.drafts).toHaveLength(1)
      } finally {
        await close(second.server)
      }
    } finally {
      await close(server)
    }
    void h
  })

  it('answers concurrent panel and tab submissions from one admission', async () => {
    const gate = deferred<{ accepted: true }>()
    const prompt = vi.fn(() => gate.promise)
    const { h, server, base } = await routeHarness({ sessionController: { prompt } })
    try {
      const created = (await (
        await fetch(base + '/design/session-test/_/comments/create', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(input),
        })
      ).json()) as any
      const versions = created.drafts.map((draft: any) => ({ id: draft.id, revision: draft.revision }))
      const submit = () =>
        fetch(base + '/design/session-test/_/comments/submit', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ requestId: 'review-concurrent-1', versions }),
        })
      const first = submit()
      const second = submit()
      gate.resolve({ accepted: true })
      const answers = await Promise.all([first, second])
      const bodies = await Promise.all(
        answers.map(async (answer) => ({ status: answer.status, body: (await answer.json()) as any })),
      )
      expect(bodies.map((answer) => answer.status)).toEqual([200, 200])
      expect(bodies.filter((answer) => answer.body.replayed === true)).toHaveLength(1)
      expect(bodies.filter((answer) => answer.body.replayed === false)).toHaveLength(1)
      expect(bodies[0]!.body.versions).toEqual(versions)
      expect(prompt).toHaveBeenCalledTimes(1)
      const later = (await (
        await fetch(base + '/design/session-test/_/comments/create', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ ...input, text: 'Later draft' }),
        })
      ).json()) as any
      const replay = await fetch(base + '/design/session-test/_/comments/submit', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ requestId: 'review-concurrent-1', versions }),
      })
      const replayBody = (await replay.json()) as any
      expect(replayBody.replayed).toBe(true)
      expect(replayBody.snapshot.drafts.map((draft: any) => draft.id)).toEqual(
        later.drafts.map((draft: any) => draft.id),
      )
      expect(prompt).toHaveBeenCalledTimes(1)
    } finally {
      await close(server)
    }
    void h
  })

  it('never writes comment state into the design repository', async () => {
    const { h, server, base } = await routeHarness({
      sessionController: { prompt: async () => ({ accepted: true as const }) },
    })
    const design = join(h.root, 'design')
    const before = await readdir(design, { recursive: true })
    const tokensBefore = await readFile(join(design, 'tokens.json'), 'utf8')
    try {
      const created = (await (
        await fetch(base + '/design/session-test/_/comments/create', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(input),
        })
      ).json()) as any
      const versions = created.drafts.map((draft: any) => ({ id: draft.id, revision: draft.revision }))
      await fetch(base + '/design/session-test/_/comments/submit', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ requestId: 'review-request-writes', versions }),
      })
      const after = await readdir(design, { recursive: true })
      expect(after.sort()).toEqual(before.sort())
      expect(await readFile(join(design, 'tokens.json'), 'utf8')).toBe(tokensBefore)
    } finally {
      await close(server)
    }
  })

  it('keeps the deterministic document unembeddable and the interactive shell same-origin', async () => {
    const assets = await mkdtemp(join(tmpdir(), 'dsh-comment-assets-'))
    await writeFile(
      join(assets, 'index.html'),
      '<!doctype html><html><head></head><body><div id="root"></div><script src="./app.js"></script></body></html>',
    )
    await writeFile(join(assets, 'app.js'), 'console.log(1)')
    await writeFile(join(assets, 'app.css'), '')
    const { h, server, base } = await routeHarness({ assetsDir: assets })
    try {
      const interactive = await fetch(base + '/design/session-test/')
      expect(interactive.headers.get('content-security-policy')).toBe("frame-ancestors 'self'")
      expect(interactive.headers.get('x-frame-options')).toBe('SAMEORIGIN')
      const deterministic = await fetch(base + '/design/session-test/?deterministic=1')
      expect(deterministic.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
      expect(deterministic.headers.get('x-frame-options')).toBe('DENY')
      const body = await deterministic.text()
      expect(body).toContain('window.__DSX_DETERMINISTIC__=true')
    } finally {
      await close(server)
    }
    void h
  })
})
