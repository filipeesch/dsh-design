// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseScreen } from '../../core/src/parse.ts'
import { fingerprintDesignTree } from '../../core/src/fingerprint.ts'
import { App } from '../src/app.tsx'
import type { ProjectPayload } from '../src/wire.ts'

class MockEventSource {
  static instances: MockEventSource[] = []
  readonly listeners = new Map<string, ((event: unknown) => void)[]>()
  closed = false
  constructor(readonly url: string) {
    MockEventSource.instances.push(this)
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }
  close(): void {
    this.closed = true
  }
  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) })
  }
}

interface FakeDraft {
  id: string
  revision: number
  text: string
  anchor: { id: string; kind: 'stable' | 'structural'; type: string; revision: number }
  context: {
    screen: string
    breakpoint: string
    state?: string
    overlays: string[]
    tabs: Record<string, string>
  }
  createdAt: number
  updatedAt: number
}

let current: ProjectPayload
let drafts: FakeDraft[] = []
let storeRevision = 0
let nextDraft = 1
let submitMode: 'accept' | 'reject' | 'accept-with-new' | 'accept-edited-in-flight' = 'accept'
let submitCalls: any[] = []
let updateCalls: any[] = []
let createCalls: any[] = []
let commentRequests = 0
const originalFetch = globalThis.fetch
const originalEventSource = (globalThis as Record<string, unknown>).EventSource

function responseJson(status: number, value: unknown): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  }
}

function commentSnapshot() {
  return { session: 'session-test', revision: storeRevision, drafts: drafts.map((draft) => ({ ...draft })) }
}

function addDraft(body: any): FakeDraft {
  const draft: FakeDraft = {
    id: 'draft-' + String(nextDraft++),
    revision: 1,
    text: body.text,
    anchor: body.anchor,
    context: body.context,
    createdAt: 1,
    updatedAt: 1,
  }
  drafts.push(draft)
  storeRevision += 1
  return draft
}

function seedDraft(partial: Partial<FakeDraft> = {}): FakeDraft {
  const draft: FakeDraft = {
    id: 'seed-' + String(nextDraft++),
    revision: 1,
    text: 'Seed comment',
    anchor: { id: 'open', kind: 'stable', type: 'Button', revision: 1 },
    context: { screen: 'home', breakpoint: 'desktop', overlays: [], tabs: {} },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
  drafts.push(draft)
  storeRevision += 1
  return draft
}

function screenOf(source: string, id: string = 'home', states: any[] = []): ProjectPayload['screens'][number] {
  const parsed = parseScreen(source, 'screens/' + id + '.dsx')
  return {
    id,
    file: 'screens/' + id + '.dsx',
    root: parsed.root,
    lastValidRoot: parsed.root,
    diagnostics: parsed.diagnostics,
    errors: parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    warnings: parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    states,
  }
}

function payload(revision: number, screens: ProjectPayload['screens']): ProjectPayload {
  return {
    session: 'session-test',
    revision,
    config: {
      kitVersion: '1.0.0',
      breakpoints: [
        { name: 'mobile', width: 390 },
        { name: 'tablet', width: 768 },
        { name: 'desktop', width: 1280 },
      ],
      entry: screens[0]?.id,
    },
    kitVersion: '1.0.0',
    tokens: {},
    cssVariables: {},
    diagnostics: [],
    screens,
  }
}

const home = (states = '') =>
  '<Screen id="home" title="Home"' +
  states +
  '><Stack gap="spacing.md"><Text>Hello preview</Text><Box><Text>Anonymous boxed text</Text></Box><Button id="open" onPress={open("filters")}>Open</Button><Button id="plain">Plain</Button></Stack><Drawer id="filters" title="Filters"><Text>Drawer body</Text><Box><Text>Anonymous drawer text</Text></Box></Drawer></Screen>'

const namedStates = [
  {
    name: 'review-open',
    open: ['filters'],
    tabs: {},
    values: {},
    source: { file: 'screens/home.dsx', line: 1, column: 1 },
  },
]

beforeEach(() => {
  drafts = []
  storeRevision = 0
  nextDraft = 1
  submitMode = 'accept'
  submitCalls = []
  updateCalls = []
  createCalls = []
  commentRequests = 0
  current = payload(1, [screenOf(home(), 'home', namedStates)])
  sessionStorage.clear()
  MockEventSource.instances = []
  ;(globalThis as Record<string, unknown>).EventSource = MockEventSource
  delete (globalThis as Record<string, unknown>).__DSX_PROJECT__
  ;(globalThis as Record<string, unknown>).fetch = vi.fn(async (input: unknown, init?: any) => {
    const url = String(input)
    if (url.includes('/_/comments')) {
      commentRequests += 1
      const method = init?.method ?? 'GET'
      if (method === 'GET') return responseJson(200, commentSnapshot())
      const body = JSON.parse(String(init?.body))
      if (url.endsWith('/create')) {
        createCalls.push(body)
        addDraft(body)
        return responseJson(200, commentSnapshot())
      }
      if (url.endsWith('/update')) {
        updateCalls.push(body)
        const draft = drafts.find((candidate) => candidate.id === body.id)
        if (draft === undefined || draft.revision !== body.revision) {
          return responseJson(409, { error: 'stale', message: 'comment draft changed; refresh and try again' })
        }
        draft.text = body.text
        draft.revision += 1
        storeRevision += 1
        return responseJson(200, commentSnapshot())
      }
      if (url.endsWith('/remove')) {
        const draft = drafts.find((candidate) => candidate.id === body.id)
        if (draft === undefined || draft.revision !== body.revision) {
          return responseJson(409, { error: 'stale', message: 'comment draft changed; refresh and try again' })
        }
        drafts = drafts.filter((candidate) => candidate.id !== body.id)
        storeRevision += 1
        return responseJson(200, commentSnapshot())
      }
      if (url.endsWith('/submit')) {
        submitCalls.push(body)
        if (submitMode === 'reject') {
          return responseJson(502, {
            error: 'delivery-rejected',
            message: 'The session rejected the comment batch; your comments were kept, retry to send again',
            retryable: true,
          })
        }
        if (submitMode === 'accept-with-new') {
          seedDraft({ text: 'Added during send', anchor: { id: 'plain', kind: 'stable', type: 'Button', revision: 2 } })
        }
        if (submitMode === 'accept-edited-in-flight') {
          const current = drafts.find((candidate) => candidate.id === body.versions[0].id)
          if (current !== undefined) {
            current.text = current.text + ' (edited)'
            current.revision += 1
            storeRevision += 1
          }
        }
        const cleared: string[] = []
        for (const version of body.versions) {
          const draft = drafts.find((candidate) => candidate.id === version.id)
          if (draft !== undefined && draft.revision === version.revision) {
            cleared.push(version.id)
            drafts = drafts.filter((candidate) => candidate.id !== version.id)
          }
        }
        storeRevision += 1
        return responseJson(200, {
          accepted: true,
          requestId: body.requestId,
          acceptedAt: 5,
          replayed: false,
          versions: body.versions,
          cleared,
          snapshot: commentSnapshot(),
        })
      }
    }
    const match = /rev=(\d+)/.exec(url)
    return responseJson(200, match === null ? current : { ...current, revision: Number(match[1]) })
  })
  history.replaceState(null, '', '/design/session-test/')
})

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  if (originalEventSource === undefined) delete (globalThis as Record<string, unknown>).EventSource
  else (globalThis as Record<string, unknown>).EventSource = originalEventSource
  delete (globalThis as Record<string, unknown>).__DSX_PROJECT__
})

async function ready(): Promise<void> {
  await screen.findByText('Hello preview')
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Comment' })).not.toBeNull())
}

async function openComments(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
}

function mockRect(element: Element, rect: { left: number; top: number; width: number; height: number }): void {
  ;(element as HTMLElement).getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect
}

describe('review layer', () => {
  it('selects without activating a kit control and creates a stable draft', async () => {
    render(React.createElement(App))
    await ready()
    await openComments()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.queryByText('Drawer body')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Comment composer' })).toBeTruthy()
    expect(screen.getByText(/Button · open/)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment text' }), { target: { value: 'Make this primary' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))
    await waitFor(() => expect(createCalls).toHaveLength(1))
    expect(createCalls[0]).toMatchObject({
      text: 'Make this primary',
      anchor: { id: 'open', kind: 'stable', type: 'Button', revision: 1 },
      context: { screen: 'home', breakpoint: 'desktop' },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /Pending \(1\)/ })).toBeTruthy())
  })

  it('keeps normal preview interactions unchanged outside review mode', async () => {
    render(React.createElement(App))
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText('Drawer body')).toBeTruthy()
  })

  it('selects a component inside an open drawer and focuses the composer', async () => {
    history.replaceState(null, '', '/design/session-test/?state=review-open')
    render(React.createElement(App))
    await ready()
    expect(await screen.findByText('Drawer body')).toBeTruthy()
    await openComments()
    fireEvent.click(screen.getByText('Drawer body'))
    const composer = await screen.findByRole('dialog', { name: 'Comment composer' })
    expect(composer).toBeTruthy()
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Comment text'))
  })

  it('selects an anonymous structural node by keyboard and marks it unstable', async () => {
    render(React.createElement(App))
    await ready()
    await openComments()
    await waitFor(() => expect(document.querySelector('[data-dsx-review-target]')).not.toBeNull())
    let structural: Element | null = null
    for (let index = 0; index < 40; index += 1) {
      const highlighted = document.querySelector('[data-dsx-review-target]')
      if (highlighted !== null && highlighted.getAttribute('data-dsx-address') !== null) {
        structural = highlighted
        break
      }
      fireEvent.keyDown(document, { key: 'ArrowDown' })
      await waitFor(() => expect(document.querySelector('[data-dsx-review-target]')).not.toBeNull())
    }
    expect(structural).not.toBeNull()
    const address = structural!.getAttribute('data-dsx-address')
    fireEvent.keyDown(document, { key: 'Enter' })
    const composer = await screen.findByRole('dialog', { name: 'Comment composer' })
    expect(composer).toBeTruthy()
    expect(composer.textContent).toContain('(unstable address)')
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment text' }), { target: { value: 'Align this' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))
    await waitFor(() => expect(createCalls).toHaveLength(1))
    expect(createCalls[0].anchor.kind).toBe('structural')
    expect(createCalls[0].anchor.id).toBe(address)
    expect(createCalls[0].anchor.fingerprint).toMatch(/^fp-[0-9a-f]{16}-[0-9a-f]{1,8}$/)
  })

  it('edits and removes drafts, then sends the remaining batch', async () => {
    const seeded = seedDraft()
    seedDraft({ text: 'Remove me', anchor: { id: 'plain', kind: 'stable', type: 'Button', revision: 1 } })
    render(React.createElement(App))
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Pending \(2\)/ }))
    await screen.findByText('Seed comment')
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment text' }), { target: { value: 'Edited comment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))
    await waitFor(() => expect(updateCalls).toHaveLength(1))
    expect(updateCalls[0]).toMatchObject({ id: seeded.id, revision: 1, text: 'Edited comment' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]!)
    await waitFor(() => expect(screen.queryByText('Remove me')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 comment' }))
    await waitFor(() => expect(submitCalls).toHaveLength(1))
    expect(submitCalls[0].versions).toEqual([{ id: seeded.id, revision: 2 }])
    await waitFor(() => expect(screen.getByText(/Sent 1 comment as one message/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /Pending \(0\)/ })).toBeTruthy()
  })

  it('keeps drafts when delivery is rejected and reuses the request id on retry', async () => {
    seedDraft()
    submitMode = 'reject'
    render(React.createElement(App))
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Pending \(1\)/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send 1 comment' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByRole('alert').textContent).toContain('retry')
    expect(screen.getByRole('button', { name: /Pending \(1\)/ })).toBeTruthy()
    submitMode = 'accept'
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 comment' }))
    await waitFor(() => expect(submitCalls).toHaveLength(2))
    expect(submitCalls[0].requestId).toBe(submitCalls[1].requestId)
    await waitFor(() => expect(screen.getByRole('button', { name: /Pending \(0\)/ })).toBeTruthy())
  })

  it('preserves drafts added while a batch is sending', async () => {
    seedDraft()
    submitMode = 'accept-with-new'
    render(React.createElement(App))
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Pending \(1\)/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send 1 comment' }))
    await waitFor(() => expect(screen.getByText(/newer draft\(s\) kept/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /Pending \(1\)/ })).toBeTruthy()
    expect(await screen.findByText('Added during send')).toBeTruthy()
  })

  it('refreshes on window focus and tab visibility', async () => {
    seedDraft()
    render(React.createElement(App))
    await ready()
    await waitFor(() => expect(screen.getByRole('button', { name: /Pending \(1\)/ })).toBeTruthy())
    seedDraft({ text: 'Added from another tab', anchor: { id: 'plain', kind: 'stable', type: 'Button', revision: 1 } })
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(screen.getByRole('button', { name: /Pending \(2\)/ })).toBeTruthy())
    seedDraft({ text: 'Added while visible', anchor: { id: 'open', kind: 'stable', type: 'Button', revision: 1 } })
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(screen.getByRole('button', { name: /Pending \(3\)/ })).toBeTruthy())
  })

  it('marks an anchor whose component disappeared as unanchored', async () => {
    seedDraft({ anchor: { id: 'ghost', kind: 'stable', type: 'Button', revision: 1 } })
    render(React.createElement(App))
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Pending \(1\)/ }))
    await screen.findByText('Seed comment')
    expect(screen.getByText('unanchored')).toBeTruthy()
  })

  it('aligns a pin from current geometry across resize and reload', async () => {
    seedDraft()
    render(React.createElement(App))
    await ready()
    await waitFor(() => expect(document.querySelector('.dsx-pin')).not.toBeNull())
    const frame = document.querySelector('.dsx-frame') as HTMLElement
    const target = document.querySelector('[data-dsx-id="open"]') as HTMLElement
    mockRect(frame, { left: 0, top: 0, width: 1280, height: 800 })
    mockRect(target, { left: 100, top: 100, width: 100, height: 40 })
    fireEvent(window, new Event('resize'))
    await waitFor(() => expect((document.querySelector('.dsx-pin') as HTMLElement).style.left).toBe('191px'))
    expect((document.querySelector('.dsx-pin') as HTMLElement).style.top).toBe('91px')
    mockRect(target, { left: 300, top: 200, width: 100, height: 40 })
    fireEvent(window, new Event('resize'))
    await waitFor(() => expect((document.querySelector('.dsx-pin') as HTMLElement).style.left).toBe('391px'))
    cleanup()
    render(React.createElement(App))
    await ready()
    await waitFor(() => expect(document.querySelector('.dsx-pin')).not.toBeNull())
  })

  it('keeps a pin attached to a stable id through a live edit', async () => {
    seedDraft()
    render(React.createElement(App))
    await ready()
    await waitFor(() => expect(document.querySelector('.dsx-pin')).not.toBeNull())
    current = payload(2, [
      screenOf(
        '<Screen id="home" title="Home"><Stack gap="spacing.md"><Text>New first row</Text><Text>Hello preview</Text><Box><Text>Anonymous boxed text</Text></Box><Button id="open" onPress={open("filters")}>Open</Button><Button id="plain">Plain</Button></Stack><Drawer id="filters" title="Filters"><Text>Drawer body</Text></Drawer></Screen>',
        'home',
        namedStates,
      ),
    ])
    MockEventSource.instances[0]!.emit('revision', { rev: 2 })
    expect(await screen.findByText('New first row')).toBeTruthy()
    await waitFor(() => expect(document.querySelectorAll('.dsx-pin')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: /Pending \(1\)/ }))
    expect(screen.queryByText('unanchored')).toBeNull()
  })

  it('drives the keyboard picker from the Comment button and exits mode without closing an open drawer', async () => {
    history.replaceState(null, '', '/design/session-test/?state=review-open')
    render(React.createElement(App))
    await ready()
    expect(await screen.findByText('Drawer body')).toBeTruthy()
    const toggle = screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement
    toggle.focus()
    fireEvent.click(toggle)
    await waitFor(() => expect(document.querySelector('[data-dsx-review-target]')).not.toBeNull())
    toggle.focus()
    const before = document.querySelector('[data-dsx-review-target]')
    fireEvent.keyDown(toggle, { key: 'ArrowDown' })
    await waitFor(() => expect(document.querySelector('[data-dsx-review-target]')).not.toBe(before))
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    const composer = await screen.findByRole('dialog', { name: 'Comment composer' })
    expect(composer.textContent).not.toContain('Screen · #')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment text' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Comment composer' })).toBeNull())
    expect(screen.getByText('Drawer body')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(document.querySelector('[data-dsx-review-target]')).not.toBeNull())
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy())
    expect(screen.getByText('Drawer body')).toBeTruthy()
    await waitFor(() => expect(document.querySelector('[data-dsx-review-target]')).toBeNull())
  })

  it('freezes selection context when the composer opens', async () => {
    render(React.createElement(App))
    await ready()
    await openComments()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await screen.findByRole('dialog', { name: 'Comment composer' })
    fireEvent.click(screen.getByRole('button', { name: /mobile/ }))
    await waitFor(() => expect(document.querySelector('.dsx-frame')?.getAttribute('data-breakpoint')).toBe('mobile'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment text' }), { target: { value: 'Check this' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))
    await waitFor(() => expect(createCalls).toHaveLength(1))
    expect(createCalls[0].context.breakpoint).toBe('desktop')
    expect(createCalls[0].context.screen).toBe('home')
  })

  it('keeps a structural anchor with unchanged content across revisions and drops it after an edit', async () => {
    const original = screenOf(home(), 'home', namedStates)
    seedDraft({
      anchor: {
        id: '#0.0',
        kind: 'structural',
        type: 'Text',
        revision: 1,
        fingerprint: fingerprintDesignTree(original.root!),
      },
      context: { screen: 'home', breakpoint: 'desktop', overlays: [], tabs: {} },
    })
    render(React.createElement(App))
    await ready()
    await waitFor(() => expect(document.querySelectorAll('.dsx-pin')).toHaveLength(1))
    current = payload(2, [screenOf(home(), 'home', namedStates)])
    MockEventSource.instances[0]!.emit('revision', { rev: 2 })
    await waitFor(() => expect(document.querySelectorAll('.dsx-pin')).toHaveLength(1))
    const edited = screenOf(home().replace('Hello preview', 'Hello edited'), 'home', namedStates)
    current = payload(3, [edited])
    MockEventSource.instances[0]!.emit('revision', { rev: 3 })
    await waitFor(() => expect(document.querySelectorAll('.dsx-pin')).toHaveLength(0))
    fireEvent.click(screen.getByRole('button', { name: /Pending \(1\)/ }))
    expect(await screen.findByText('content changed')).toBeTruthy()
    expect(screen.queryByText('unanchored')).toBeNull()
  })

  it('distinguishes another screen or state from an unresolved anchor', async () => {
    seedDraft({
      anchor: { id: 'open', kind: 'stable', type: 'Button', revision: 1 },
      context: { screen: 'details', breakpoint: 'desktop', overlays: [], tabs: {} },
    })
    seedDraft({
      anchor: { id: 'plain', kind: 'stable', type: 'Button', revision: 1 },
      context: { screen: 'home', breakpoint: 'desktop', state: 'review-open', overlays: [], tabs: {} },
    })
    render(React.createElement(App))
    await ready()
    expect(document.querySelectorAll('.dsx-pin')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /Pending \(2\)/ }))
    expect(await screen.findByText('different screen')).toBeTruthy()
    expect(screen.getByText('different state')).toBeTruthy()
  })

  it('reports the accepted version count when a draft changes during send', async () => {
    seedDraft()
    submitMode = 'accept-edited-in-flight'
    render(React.createElement(App))
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Pending \(1\)/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send 1 comment' }))
    const message = await screen.findByText(/edited during send stayed pending/)
    expect(message.textContent).toContain('Sent 1 comment as one message.')
    expect(message.textContent).not.toContain('Sent 0')
    expect(screen.getByRole('button', { name: /Pending \(1\)/ })).toBeTruthy()
  })

  it('disables adding comments at the live-draft limit', async () => {
    for (let index = 0; index < 50; index += 1) {
      seedDraft({ text: 'Draft ' + String(index), anchor: { id: 'open', kind: 'stable', type: 'Button', revision: 1 } })
    }
    render(React.createElement(App))
    await ready()
    const toggle = screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
    expect(toggle.title).toContain('full')
    fireEvent.click(screen.getByRole('button', { name: /Pending \(50\)/ }))
    expect(await screen.findByText(/50 of 50 pending/)).toBeTruthy()
  })

  it('renders no review controls and requests no comments in deterministic mode', async () => {
    history.replaceState(null, '', '/design/session-test/?deterministic=1')
    ;(globalThis as Record<string, unknown>).__DSX_PROJECT__ = current
    render(React.createElement(App))
    await screen.findByText('Hello preview')
    expect(document.querySelector('[data-dsx-review]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull()
    expect(commentRequests).toBe(0)
  })
})
