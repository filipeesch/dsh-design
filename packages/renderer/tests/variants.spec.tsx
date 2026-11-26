// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseRoute } from '../src/route.ts'
import { App } from '../src/app.tsx'
import { CompareView } from '../src/compare.tsx'
import { parseScreen } from '../../core/src/parse.ts'
import { resolveVariantDocument } from '../../core/src/variants.ts'
import type { ProjectPayload, WireScreen } from '../src/wire.ts'

const variantSource =
  '<Screen id="home" title="Home"><Text>Hello preview</Text><Variants id="layout" chosen="compact"><Variant branch="compact"><Stack><Button id="open">Open</Button><Drawer id="filters" title="Filters"><Text>Drawer body</Text></Drawer></Stack></Variant><Variant branch="spacious"><Stack><Button id="open">Open</Button><Text>Spacious only</Text></Stack></Variant></Variants></Screen>'

const namedStates = [
  {
    name: 'drawer-open',
    open: ['filters'],
    tabs: {},
    values: {},
    source: { file: 'screens/home.dsx', line: 1, column: 1 },
  },
]

function variantScreen(branch: 'compact' | 'spacious', includeStates = false): WireScreen {
  const parsed = parseScreen(variantSource, 'screens/home.dsx')
  const projection = resolveVariantDocument(parsed.document!, branch === 'compact' ? {} : { layout: 'spacious' })
  if (projection.screen === undefined) throw new Error('variant projection failed')
  return {
    id: 'home',
    file: 'screens/home.dsx',
    root: projection.screen,
    lastValidRoot: projection.screen,
    diagnostics: [],
    errors: 0,
    warnings: 0,
    blockingErrors: 0,
    effectiveSelection: projection.selection,
    ...(includeStates ? { states: namedStates } : {}),
    variants: [
      {
        id: 'layout',
        path: 'layout',
        chosen: 'compact',
        source: { file: 'screens/home.dsx', line: 1, column: 1 },
        wholeScreen: false,
        branches: [
          { id: 'compact', source: { file: 'screens/home.dsx', line: 1, column: 1 }, valid: true, diagnostics: [] },
          { id: 'spacious', source: { file: 'screens/home.dsx', line: 1, column: 1 }, valid: true, diagnostics: [] },
        ],
      },
    ],
    variant: {
      group: 'layout',
      path: 'layout',
      branch,
      chosen: branch === 'compact',
      selection: branch === 'compact' ? { layout: 'compact' } : { layout: 'spacious' },
    },
  }
}

function payload(revision: number, screens: WireScreen[]): ProjectPayload {
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
      entry: 'home',
    },
    kitVersion: '1.0.0',
    tokens: {},
    cssVariables: {},
    diagnostics: [],
    screens,
  }
}

let current: ProjectPayload
const originalFetch = globalThis.fetch

beforeEach(() => {
  current = payload(1, [variantScreen('compact')])
  ;(globalThis as Record<string, unknown>).fetch = vi.fn(async (input: unknown) => {
    const url = String(input)
    const variant = /variant=([^&]+)/.exec(url)
    if (variant !== null) {
      const decoded = decodeURIComponent(variant[1]!)
      if (decoded === 'layout:spacious')
        return { ok: true, status: 200, json: async () => payload(1, [variantScreen('spacious')]) }
      if (decoded === 'layout:tiny') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...payload(1, [variantScreen('compact')]),
            variantError: 'Group "layout" does not declare branch "tiny".',
          }),
        }
      }
    }
    return { ok: true, status: 200, json: async () => current }
  })
  history.replaceState(null, '', '/design/session-test/')
})

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

describe('variant preview routes', () => {
  it('parses single-branch, comparison, and embedded pane routes', () => {
    const single = parseRoute('/design/session/home', '?variant=layout%3Aspacious&bp=mobile')
    expect(single.variant).toEqual({ group: 'layout', branch: 'spacious' })
    expect(single.embed).toBe(false)
    const compare = parseRoute('/design/session/home', '?compare=layout%3Acompact%3Aspacious&bp=mobile')
    expect(compare.compare).toEqual({ group: 'layout', left: 'compact', right: 'spacious' })
    const pane = parseRoute('/design/session/home', '?variant=layout%3Aspacious&embed=1&pane=left&bp=mobile')
    expect(pane.embed).toBe(true)
    expect(pane.pane).toBe('left')
    const malformedVariant = parseRoute('/design/session/home', '?variant=broken')
    expect(malformedVariant.variant).toBeUndefined()
    expect(malformedVariant.variantRaw).toBe('broken')
    const malformedCompare = parseRoute('/design/session/home', '?compare=broken')
    expect(malformedCompare.compare).toBeUndefined()
    expect(malformedCompare.compareRaw).toBe('broken')
  })

  it('renders an explicit branch and keeps it across a breakpoint change', async () => {
    history.replaceState(null, '', '/design/session-test/home?variant=layout:spacious')
    render(React.createElement(App))
    expect(await screen.findByText('Spacious only')).toBeTruthy()
    expect(document.querySelector('.dsx-shell')?.getAttribute('data-dsx-variant')).toBe('layout:spacious')
    expect(screen.getByText(/layout · spacious/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Breakpoint'), { target: { value: 'desktop' } })
    await waitFor(() => expect(new URL(window.location.href).searchParams.get('bp')).toBe('desktop'))
    const params = new URL(window.location.href).searchParams
    expect(params.get('variant')).toBe('layout:spacious')
    expect(screen.getByText('Spacious only')).toBeTruthy()
  })

  it('diagnoses an unknown selection instead of showing the chosen branch', async () => {
    history.replaceState(null, '', '/design/session-test/home?variant=layout:tiny')
    render(React.createElement(App))
    expect(await screen.findByText('Unknown variant selection')).toBeTruthy()
    expect(screen.getByText(/does not declare branch/)).toBeTruthy()
    expect(screen.queryByText('Hello preview')).toBeNull()
  })

  it('diagnoses a malformed variant link instead of showing the chosen branch', async () => {
    history.replaceState(null, '', '/design/session-test/home?variant=broken')
    render(React.createElement(App))
    expect(await screen.findByText('Unknown variant selection')).toBeTruthy()
    expect(screen.getByText(/not a group:branch selection/)).toBeTruthy()
    expect(screen.queryByText('Hello preview')).toBeNull()
  })

  it('diagnoses a malformed comparison link instead of rendering the chosen screen', async () => {
    history.replaceState(null, '', '/design/session-test/home?compare=broken')
    render(React.createElement(App))
    expect(await screen.findByText('Malformed comparison selection')).toBeTruthy()
    expect(document.querySelectorAll('.dsx-compare-pane')).toHaveLength(0)
    expect(screen.queryByText('Hello preview')).toBeNull()
  })

  it('diagnoses an unknown comparison state instead of applying a default', () => {
    const route = parseRoute('/design/session/home', '?compare=layout:compact:spacious&state=ghost&bp=mobile')
    render(React.createElement(CompareView, { route, project: payload(1, [variantScreen('compact')]) }))
    expect(screen.getByText('Unknown comparison state')).toBeTruthy()
    const iframes = [...document.querySelectorAll('.dsx-compare-pane iframe')] as HTMLIFrameElement[]
    expect(iframes[0]?.getAttribute('data-src')).toContain('state=ghost')
  })

  it('diagnoses an unknown screen instead of comparing another screen', () => {
    const route = parseRoute('/design/session/missing', '?compare=layout:compact:spacious&bp=mobile')
    render(React.createElement(CompareView, { route, project: payload(1, [variantScreen('compact')]) }))
    expect(screen.getByText('Screen not found')).toBeTruthy()
  })

  it('diagnoses a named state that targets a different branch', async () => {
    history.replaceState(null, '', '/design/session-test/home?variant=layout:spacious&state=drawer-open')
    current = payload(1, [variantScreen('spacious', true)])
    ;(globalThis as Record<string, unknown>).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => current,
    }))
    render(React.createElement(App))
    expect(await screen.findByText('Incompatible state for this branch')).toBeTruthy()
    expect(screen.queryByText('Drawer body')).toBeNull()
  })

  it('renders isolated comparison panes at exact breakpoint widths and updates shared controls', async () => {
    history.replaceState(null, '', '/design/session-test/home?compare=layout:compact:spacious&bp=mobile')
    render(React.createElement(App))
    await waitFor(() => expect(document.querySelectorAll('.dsx-compare-pane')).toHaveLength(2))
    const iframes = [...document.querySelectorAll('.dsx-compare-pane iframe')] as HTMLIFrameElement[]
    expect(iframes).toHaveLength(2)
    expect(iframes[0]?.getAttribute('width')).toBe('390')
    expect(iframes[0]?.getAttribute('data-src')).toContain('variant=layout%3Acompact')
    expect(iframes[0]?.getAttribute('data-src')).toContain('embed=1')
    expect(iframes[0]?.getAttribute('data-src')).toContain('pane=left')
    expect(iframes[1]?.getAttribute('data-src')).toContain('variant=layout%3Aspacious')
    expect(iframes[1]?.getAttribute('data-src')).toContain('pane=right')
    expect(document.querySelector('.dsx-compare-pane-label strong')?.textContent).toBe('compact (chosen)')
    expect(document.querySelectorAll('.dsx-compare-pane-label strong')[1]?.textContent).toBe('spacious')
    const scroller = document.querySelector('.dsx-compare-scroll') as HTMLElement
    expect(scroller.getAttribute('tabindex')).toBe('0')
    fireEvent.click(screen.getByRole('button', { name: /desktop/ }))
    await waitFor(() => {
      const next = [...document.querySelectorAll('.dsx-compare-pane iframe')] as HTMLIFrameElement[]
      expect(next[0]?.getAttribute('width')).toBe('1280')
      expect(next[0]?.getAttribute('data-src')).toContain('bp=desktop')
      expect(next[1]?.getAttribute('data-src')).toContain('bp=desktop')
    })
    fireEvent.change(screen.getByLabelText('Right branch'), { target: { value: 'compact' } })
    await waitFor(() => {
      const compare = new URL(window.location.href).searchParams.get('compare')
      expect(compare).toBe('layout:compact:compact')
    })
  })

  it('diagnoses an unknown comparison selection and keeps the chosen view one click away', () => {
    const route = parseRoute('/design/session/home', '?compare=layout:compact:missing&bp=mobile')
    render(React.createElement(CompareView, { route, project: payload(1, [variantScreen('compact')]) }))
    expect(screen.getByText('Unknown comparison selection')).toBeTruthy()
    expect(screen.getByText(/Known branches for "layout"/)).toBeTruthy()
    expect(screen.getByText('Open chosen')).toBeTruthy()
  })
})
