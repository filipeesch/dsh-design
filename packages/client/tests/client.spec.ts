// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  DESIGN_TAB_ID,
  DESIGN_TAB_KIND,
  DesignAction,
  DesignPanel,
  DesignTitle,
  previewUrl,
} from '../src/client.tsx'

interface Registration {
  kind: 'type' | 'body' | 'title' | 'action'
  options?: any
  component?: any
  definition?: any
}

function fakeContext(registrations: Registration[]) {
  const openTab = vi.fn()
  const setExpanded = vi.fn()
  const ctx: any = {
    effect(callback: () => unknown) {
      return callback()
    },
    slots: {
      inject(name: string, callback: () => unknown) {
        const disposer = callback()
        return disposer
      },
      register(options: any, component: any) {
        const kind =
          options.name === 'sidebar.right.pane.tab'
            ? 'body'
            : options.name === 'sidebar.right.pane.tab.title'
              ? 'title'
              : 'action'
        registrations.push({ kind, options, component })
        return () => undefined
      },
    },
    sidebarRightTabs: {
      register(definition: any) {
        registrations.push({ kind: 'type', definition })
        return () => undefined
      },
    },
    sidebarRight: {
      openTab,
      forSession: vi.fn(() => ({ setExpanded })),
    },
  }
  return { ctx, openTab, setExpanded }
}

const originalFetch = globalThis.fetch

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

describe('design client registration', () => {
  it('registers the native tab, its body and title, and the session action', () => {
    const registrations: Registration[] = []
    const { ctx } = fakeContext(registrations)
    apply(ctx)
    const type = registrations.find((entry) => entry.kind === 'type')?.definition
    expect(type).toMatchObject({ id: DESIGN_TAB_ID, kind: DESIGN_TAB_KIND, priority: 'extension', keepMounted: true })
    const body = registrations.find((entry) => entry.kind === 'body')
    expect(body?.options.key).toBe(DESIGN_TAB_ID)
    expect(body?.options.inject('session-a')).toMatchObject({ sessionId: 'session-a' })
    expect(registrations.find((entry) => entry.kind === 'title')?.options.key).toBe(DESIGN_TAB_ID)
    const action = registrations.find((entry) => entry.kind === 'action')
    expect(action?.options).toMatchObject({ id: 'design-panel', label: 'Design' })
    action?.options.inject().openDesign()
    expect(ctx.sidebarRight.openTab).toHaveBeenCalledWith('design')
  })

  it('renders the header action and opens the tab kind', () => {
    const openDesign = vi.fn()
    render(React.createElement(DesignAction, { openDesign }))
    fireEvent.click(screen.getByRole('button', { name: 'Design' }))
    expect(openDesign).toHaveBeenCalledTimes(1)
  })

  it('renders the tab title', () => {
    render(React.createElement(DesignTitle))
    expect(screen.getByText('Design')).toBeTruthy()
  })
})

describe('design panel', () => {
  it('frames the session preview and offers a separate-tab link and back to chat', async () => {
    let release: ((value: unknown) => void) | undefined
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    globalThis.fetch = fetchMock as any
    const setExpanded = vi.fn()
    const sidebar = { forSession: vi.fn(() => ({ setExpanded })) }
    render(React.createElement(DesignPanel, { sessionId: 'session-a', sidebar }))
    expect(await screen.findByText('Loading design preview…')).toBeTruthy()
    release?.({ ok: true, status: 200 })
    const frame = (await screen.findByTitle('Design preview for session-a')) as HTMLIFrameElement
    expect(frame.src).toBe('http://localhost:3000/design/session-a/')
    expect(frame.style.width).toBe('100%')
    expect(frame.style.height).toBe('100%')
    const link = screen.getByRole('link', { name: 'Open in tab' }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(previewUrl('session-a'))
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation' }))
    expect(sidebar.forSession).toHaveBeenCalledWith('session-a')
    expect(setExpanded).toHaveBeenCalledWith(false)
    expect(fetchMock).toHaveBeenCalledWith(
      '/design/session-a/',
      expect.objectContaining({ method: 'HEAD', credentials: 'same-origin' }),
    )
  })

  it('follows the session instead of caching one preview', async () => {
    const requested: string[] = []
    globalThis.fetch = vi.fn(async (url: any) => {
      requested.push(String(url))
      return { ok: true, status: 200 }
    }) as any
    const { rerender } = render(React.createElement(DesignPanel, { sessionId: 'session-a' }))
    expect(await screen.findByTitle('Design preview for session-a')).toBeTruthy()
    rerender(React.createElement(DesignPanel, { sessionId: 'session-b' }))
    const frame = (await screen.findByTitle('Design preview for session-b')) as HTMLIFrameElement
    expect(frame.src).toBe('http://localhost:3000/design/session-b/')
    expect(requested).toEqual(['/design/session-a/', '/design/session-b/'])
  })

  it('shows useful missing-project guidance and retries', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }))
    globalThis.fetch = fetchMock as any
    render(React.createElement(DesignPanel, { sessionId: 'session-a' }))
    expect(await screen.findByText('No design project yet')).toBeTruthy()
    expect(screen.getByText(/design_init/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('shows a clear error when the preview cannot be reached', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 })) as any
    render(React.createElement(DesignPanel, { sessionId: 'session-a' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('500')
  })
})
