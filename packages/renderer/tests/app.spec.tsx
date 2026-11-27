// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseScreen } from '../../core/src/parse.ts'
import { parseRoute, pushRoute } from '../src/route.ts'
import { App } from '../src/app.tsx'
import { emptyState, filterState } from '../src/state.ts'
import type { ProjectPayload } from '../src/wire.ts'

function screenOf(source: string, id: string = 1): ProjectPayload['screens'][number] {
  const parsed = parseScreen(source, 'screens/' + id + '.dsx')
  return {
    id,
    file: 'screens/' + id + '.dsx',
    root: parsed.root,
    lastValidRoot: parsed.root,
    diagnostics: parsed.diagnostics,
    errors: parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    warnings: parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
  }
}

function payload(
  revision: number,
  screens: ProjectPayload['screens'],
  diagnostics: ProjectPayload['diagnostics'] = [],
): ProjectPayload {
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
    tokens: {
      'color.text': { path: 'color.text', type: 'color', value: '#334155', cssVar: '--dsx-color-text' },
      'color.surface': { path: 'color.surface', type: 'color', value: '#ffffff', cssVar: '--dsx-color-surface' },
    },
    cssVariables: { '--dsx-color-text': '#334155' },
    diagnostics,
    screens,
  }
}

const home = (extra = '') =>
  '<Screen id="home" title="Home"><Stack gap="spacing.md"><Text>Hello preview</Text><Button id="open" onPress={open("filters")}>Open</Button></Stack><Drawer id="filters" title="Filters"><Text>Drawer body</Text></Drawer>' +
  extra +
  '</Screen>'

let current: ProjectPayload = payload(1, [screenOf(home(), 'home')])

beforeEach(() => {
  current = payload(1, [screenOf(home(), 'home')])
  sessionStorage.clear()
  ;(globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string) => {
    return {
      ok: true,
      status: 200,
      json: async () => (url.endsWith('/_/revision') ? { token: String(current.revision) } : current),
    }
  })
  history.replaceState(null, '', '/design/session-test/')
})

afterEach(cleanup)

describe('preview application', () => {
  it('renders the entry screen at the widest breakpoint', async () => {
    render(React.createElement(App, { location: parseRoute('/design/session-test/', '') }))
    expect(await screen.findByText('Hello preview')).toBeTruthy()
    expect(document.querySelector('.dsx-frame')?.getAttribute('data-breakpoint')).toBe('desktop')
    expect((document.querySelector('.dsx-frame') as HTMLElement).style.width).toBe('1280px')
  })

  it('switches screens and breakpoints and updates the URL', async () => {
    current = payload(1, [
      screenOf(home(), 'home'),
      screenOf('<Screen id="details" title="Details"><Text>Details screen</Text></Screen>', 'details'),
    ])
    render(React.createElement(App, { location: parseRoute('/design/session-test/', '') }))
    await screen.findByText('Hello preview')
    fireEvent.click(screen.getByRole('link', { name: 'Details' }))
    expect(await screen.findByText('Details screen')).toBeTruthy()
    expect(window.location.pathname).toBe('/design/session-test/details')
    fireEvent.change(screen.getByLabelText('Breakpoint'), { target: { value: 'mobile' } })
    expect(new URLSearchParams(window.location.search).get('bp')).toBe('mobile')
    expect(document.querySelector('.dsx-frame')?.getAttribute('data-breakpoint')).toBe('mobile')
  })

  it('keeps the navigator and ignores a superseded projection, preserving state on return', async () => {
    const details = screenOf('<Screen id="details" title="Details"><Text>Details canvas</Text></Screen>', 'details')
    const main = screenOf(home(), 'home')
    const projection = (id: string): ProjectPayload => ({
      ...payload(
        8,
        [main, details].map((item) =>
          item.id === id
            ? item
            : {
                ...item,
                title: String(item.root?.props.title),
                root: undefined,
                lastValidRoot: undefined,
              },
        ),
      ),
      token: 'one:8',
      projectedScreen: id,
    })
    let release: (() => void) | undefined
    let obsolete: AbortSignal | undefined
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input), location.origin)
      if (url.pathname.endsWith('/_/revision')) return Response.json({ token: 'one:8' })
      const id = url.searchParams.get('screen') ?? 'home'
      if (id === 'details' && release === undefined) {
        obsolete = init?.signal ?? undefined
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return Response.json(projection(id))
    })
    render(<App />)
    await screen.findByText('Hello preview')
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await screen.findByText('Drawer body')
    act(() => pushRoute('/design/session-test/details'))
    expect(screen.getByRole('link', { name: 'Details' })).toBeTruthy()
    expect(screen.queryByText('Hello preview')).toBeNull()
    await waitFor(() => expect(release).toBeDefined())
    act(() => pushRoute('/design/session-test/home'))
    await screen.findByText('Drawer body')
    expect(obsolete?.aborted).toBe(true)
    await act(async () => release?.())
    expect(screen.queryByText('Details canvas')).toBeNull()
    act(() => pushRoute('/design/session-test/details'))
    await screen.findByText('Details canvas')
    act(() => pushRoute('/design/session-test/home'))
    await screen.findByText('Drawer body')
  })

  it('refreshes after a generation reset even when its numeric revision is lower', async () => {
    current = { ...payload(10, [screenOf(home(), 'home')]), token: 'first:10' }
    vi.mocked(fetch).mockImplementation(async (url) =>
      Response.json(String(url).endsWith('/_/revision') ? { token: current.token } : current),
    )
    render(<App />)
    await screen.findByText('Hello preview')
    current = { ...payload(1, [screenOf(home().replace('Hello preview', 'After restart'), 'home')]), token: 'second:1' }
    await screen.findByText('After restart')
  })

  it('refetches on a revision and keeps an open drawer', async () => {
    render(React.createElement(App, { location: parseRoute('/design/session-test/', '') }))
    await screen.findByText('Hello preview')
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText('Drawer body')).toBeTruthy()
    current = payload(2, [screenOf(home().replace('Hello preview', 'Hello edited'), 'home')])
    expect(await screen.findByText('Hello edited')).toBeTruthy()
    expect(screen.getByText('Drawer body')).toBeTruthy()
  })

  it('drops state for a deleted drawer without an error', async () => {
    render(React.createElement(App, { location: parseRoute('/design/session-test/', '') }))
    await screen.findByText('Hello preview')
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText('Drawer body')).toBeTruthy()
    current = payload(2, [
      screenOf(
        '<Screen id="home" title="Home"><Stack gap="spacing.md"><Text>Hello preview</Text><Button id="open">Open</Button></Stack></Screen>',
        'home',
      ),
    ])
    await waitFor(() => expect(screen.queryByText('Drawer body')).toBeNull())
    expect(screen.getByText('Hello preview')).toBeTruthy()
  })

  it('keeps the last valid render under an error overlay and clears it', async () => {
    const broken = screenOf(home(), 'home')
    broken.root = undefined
    broken.diagnostics = [
      {
        severity: 'error',
        code: 'syntax-error',
        file: 'screens/home.dsx',
        line: 2,
        column: 3,
        message: 'Unclosed tag',
      },
    ]
    broken.errors = 1
    current = payload(2, [broken])
    render(React.createElement(App, { location: parseRoute('/design/session-test/', '') }))
    expect(await screen.findByText('Hello preview')).toBeTruthy()
    expect(screen.getByText(/1 validation error/)).toBeTruthy()
    current = payload(3, [screenOf(home(), 'home')])
    await waitFor(() => expect(screen.queryByText(/1 validation error/)).toBeNull())
  })

  it('does not subscribe to revisions in deterministic mode', async () => {
    history.replaceState(null, '', '/design/session-test/?deterministic=1')
    render(React.createElement(App))
    await screen.findByText('Hello preview')
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/_/revision'))).toBe(false)
    expect(document.querySelector('.dsx-deterministic')).not.toBeNull()
  })

  it('keeps the last valid tree and identity through a fatal parse error', async () => {
    const broken = screenOf(home(), 'home')
    broken.root = undefined
    broken.lastValidRoot = screenOf(home(), 'home').root
    broken.diagnostics = [
      {
        severity: 'error',
        code: 'syntax-error',
        file: 'screens/home.dsx',
        line: 3,
        column: 1,
        message: 'Unclosed tag',
      },
    ]
    broken.errors = 1
    current = payload(2, [broken])
    render(React.createElement(App))
    expect(await screen.findByText('Hello preview')).toBeTruthy()
    expect(screen.getByText(/validation error/)).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /home/i }).length).toBeGreaterThan(0)
  })

  it('blocks rendering entirely on a project-level error', async () => {
    current = {
      ...payload(2, [screenOf(home(), 'home')]),
      projectError: 'The project pins kit "2.x" but the installed kit is 1.0.0',
    }
    render(React.createElement(App))
    expect(await screen.findByText('Project blocked')).toBeTruthy()
    expect(screen.queryByText('Hello preview')).toBeNull()
  })

  it('injects validated node-scoped css rules', async () => {
    current = payload(1, [
      screenOf(
        '<Screen id="home"><Card id="card" css="border-left: 4px solid red"><Text>Styled</Text></Card></Screen>',
        'home',
      ),
    ])
    render(React.createElement(App))
    await screen.findByText('Styled')
    const style = document.querySelector('.dsx-frame style')?.textContent ?? ''
    expect(style).toContain('.dsx-css-card')
    expect(style).toContain('border-left: 4px solid red !important')
    expect(document.querySelector('.dsx-css-card')).not.toBeNull()
  })

  it('filters persisted state against the current project', () => {
    const state = emptyState()
    state.openOverlays['home/filters'] = true
    state.openOverlays['home/gone'] = true
    state.values['home/name'] = 'Ada'
    state.values['home/radio:plan'] = 'basic'
    const filtered = filterState(state, current)
    expect(filtered.openOverlays['home/filters']).toBe(true)
    expect(filtered.openOverlays['home/gone']).toBeUndefined()
    expect(filtered.values['home/name']).toBeUndefined()
  })
})
