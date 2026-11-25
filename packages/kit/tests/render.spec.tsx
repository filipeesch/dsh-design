// @vitest-environment jsdom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { kitMetadata, ALL_COMPONENT_NAMES } from './names.ts'
import { validateSource, errors } from '../../core/tests/helpers.ts'
import { DesignEnvironmentContext, type DesignEnvironment } from '../src/index.ts'
import { renderNode } from '../../renderer/src/interpreter.tsx'

afterEach(cleanup)

const allNames = Object.keys(kitMetadata)

describe('kit metadata', () => {
  it('covers the required component set', () => {
    for (const name of ALL_COMPONENT_NAMES) expect(allNames).toContain(name)
    expect(allNames.length).toBeGreaterThanOrEqual(39)
  })

  it('gives every component catalog text, props, and a valid example', () => {
    for (const name of allNames) {
      const meta = kitMetadata[name]!
      expect(meta.description.length).toBeGreaterThan(0)
      expect(meta.example.length).toBeGreaterThan(0)
      const source = name === 'Screen' ? meta.example : '<Screen id="example">' + meta.example + '</Screen>'
      const result = validateSource(source, { screens: ['example', 'details'] })
      expect(errors(result.diagnostics), name + ': ' + JSON.stringify(errors(result.diagnostics))).toEqual([])
    }
  })

  it('marks overlays and interactive components with stable ids', () => {
    for (const name of ['Drawer', 'Modal', 'Popover', 'Menu', 'Toast']) expect(kitMetadata[name]?.overlay).toBe(true)
    for (const name of ['Button', 'Input', 'Select', 'Tabs', 'Tab', 'Drawer'])
      expect(kitMetadata[name]?.requiredId).toBe(true)
  })
})

interface HarnessState {
  open: Set<string>
  tabs: Record<string, string>
  values: Record<string, unknown>
}

function Harness({
  source,
  breakpoint = 'desktop',
  deterministic = false,
  initialOpen = [],
  onNavigate,
}: {
  source: string
  breakpoint?: string
  deterministic?: boolean
  initialOpen?: string[]
  onNavigate?: (screen: string) => void
}) {
  const parsed = validateSource(source, { screens: ['example', 'details'] })
  const root = parsed.parsed.root!
  const [state, setState] = useState<HarnessState>({ open: new Set(initialOpen), tabs: {}, values: {} })
  const env: DesignEnvironment = {
    tokens: {
      'color.action': { path: 'color.action', type: 'color', value: '#2563eb', cssVar: '--dsx-color-action' },
      'color.text': { path: 'color.text', type: 'color', value: '#334155', cssVar: '--dsx-color-text' },
      'color.surface': { path: 'color.surface', type: 'color', value: '#ffffff', cssVar: '--dsx-color-surface' },
      'spacing.md': { path: 'spacing.md', type: 'dimension', value: '16px', cssVar: '--dsx-spacing-md' },
      'spacing.sm': { path: 'spacing.sm', type: 'dimension', value: '8px', cssVar: '--dsx-spacing-sm' },
      'radius.md': { path: 'radius.md', type: 'dimension', value: '8px', cssVar: '--dsx-radius-md' },
    },
    breakpoints: [
      { name: 'mobile', width: 390 },
      { name: 'tablet', width: 768 },
      { name: 'desktop', width: 1280 },
    ],
    activeBreakpoint: breakpoint,
    deterministic,
    now: () => 0,
    renderNode,
    renderChildren: (node) => (node.kind === 'text' ? node.value : node.children.map((child) => renderNode(child))),
    isOverlayOpen: (id) => state.open.has(id),
    openOverlay: (id) => setState((current) => ({ ...current, open: new Set([...current.open, id]) })),
    closeOverlay: (id) =>
      setState((current) => {
        const next = new Set(current.open)
        next.delete(id)
        return { ...current, open: next }
      }),
    toggleOverlay: (id) =>
      setState((current) => {
        const next = new Set(current.open)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return { ...current, open: next }
      }),
    navigate: (screen) => onNavigate?.(screen),
    getValue: (id, fallback) => state.values[id] ?? fallback,
    setValue: (id, value) => setState((current) => ({ ...current, values: { ...current.values, [id]: value } })),
    getTab: (id, fallback) => state.tabs[id] ?? fallback,
    setTab: (id, value) => setState((current) => ({ ...current, tabs: { ...current.tabs, [id]: value } })),
    imageUrl: (path) => '/files/' + path,
  }
  return React.createElement(DesignEnvironmentContext.Provider, { value: env }, renderNode(root))
}

function renderDesign(
  source: string,
  options: {
    breakpoint?: string
    deterministic?: boolean
    initialOpen?: string[]
    onNavigate?: (screen: string) => void
  } = {},
) {
  return render(React.createElement(Harness, { source, ...options }))
}

describe('kit rendering', () => {
  it('renders every component example with type and node attributes', () => {
    for (const name of allNames) {
      if (name === 'Screen') continue
      const meta = kitMetadata[name]!
      const source = '<Screen id="example">' + meta.example + '</Screen>'
      const id = /id="([^"]+)"/.exec(meta.example)?.[1]
      const { container, unmount } = renderDesign(source, { initialOpen: meta.overlay && id !== undefined ? [id] : [] })
      const matches = container.querySelectorAll('[data-dsx-type="' + name + '"]')
      expect(matches.length, name + ' renders its example').toBeGreaterThan(0)
      if (meta.role !== undefined)
        expect(container.querySelector('[role="' + meta.role + '"]'), name + ' role ' + meta.role).not.toBeNull()
      unmount()
    }
  })

  it('renders semantic roles and data attributes', () => {
    const { container } = renderDesign(
      '<Screen id="example"><Button id="save">Save</Button><Tabs id="tabs"><Tab id="one" label="One">A</Tab></Tabs><Progress value={10} label="Work" /><List><ListItem>Row</ListItem></List></Screen>',
    )
    expect(container.querySelector('[data-dsx-type="Button"][data-dsx-id="save"]')?.tagName).toBe('BUTTON')
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull()
    expect(container.querySelector('[role="list"]')).not.toBeNull()
    expect(container.querySelector('[role="listitem"]')).not.toBeNull()
  })

  it('switches tabs and keeps the selected panel', () => {
    const source =
      '<Screen id="example"><Tabs id="sections"><Tab id="one" label="One" value="one"><Text>Panel one</Text></Tab><Tab id="two" label="Two" value="two"><Text>Panel two</Text></Tab></Tabs></Screen>'
    renderDesign(source)
    expect(screen.getByText('Panel one')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Two' }))
    expect(screen.queryByText('Panel one')).toBeNull()
    expect(screen.getByText('Panel two')).toBeTruthy()
  })

  it('keeps select, checkbox, switch, and input values', () => {
    const source =
      '<Screen id="example"><Select id="status" options={["Open", "Closed"]} /><Checkbox id="terms" label="Terms" /><Switch id="notify" label="Notify" /><Input id="name" label="Name" /></Screen>'
    const { container } = renderDesign(source)
    const select = container.querySelector('select')!
    fireEvent.change(select, { target: { value: 'Closed' } })
    expect((select as HTMLSelectElement).value).toBe('Closed')
    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    fireEvent.click(checkboxes[0]!)
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true)
    fireEvent.click(checkboxes[1]!)
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true)
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Ada' } })
    expect(input.value).toBe('Ada')
  })

  it('opens and closes a drawer with its control and backdrop', () => {
    const source =
      '<Screen id="example"><Button id="open" onPress={open("filters")}>Open</Button><Drawer id="filters" title="Filters"><Text>Inside</Text></Drawer></Screen>'
    const { container } = renderDesign(source)
    expect(screen.queryByText('Inside')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByText('Inside')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Inside')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(container.ownerDocument.querySelector('[data-dsx-backdrop="filters"]')!)
    expect(screen.queryByText('Inside')).toBeNull()
  })

  it('navigates through an interaction reference', () => {
    const onNavigate = vi.fn()
    renderDesign('<Screen id="example"><Button id="next" onPress={navigate("details")}>Next</Button></Screen>', {
      onNavigate,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onNavigate).toHaveBeenCalledWith('details')
  })

  it('applies token variables and resolves responsive values per breakpoint', () => {
    const source =
      '<Screen id="example"><Stack direction={{ mobile: "column", desktop: "row" }} gap="spacing.md"><Box background="color.surface" /></Stack></Screen>'
    const mobile = renderDesign(source, { breakpoint: 'mobile' })
    expect(mobile.container.querySelector('[data-dsx-type="Stack"]')?.getAttribute('style')).toContain('column')
    mobile.unmount()
    const desktop = renderDesign(source, { breakpoint: 'desktop' })
    const stack = desktop.container.querySelector('[data-dsx-type="Stack"]') as HTMLElement
    expect(stack.getAttribute('style')).toContain('row')
    expect((desktop.container.querySelector('[data-dsx-type="Box"]') as HTMLElement).getAttribute('style')).toContain(
      'var(--dsx-color-surface',
    )
  })

  it('produces identical markup in deterministic mode', () => {
    const source = '<Screen id="example"><Card><Text>Hello</Text></Card><Skeleton /><Progress value={40} /></Screen>'
    const first = renderDesign(source, { deterministic: true })
    const firstHtml = first.container.innerHTML
    first.unmount()
    const second = renderDesign(source, { deterministic: true })
    expect(second.container.innerHTML).toBe(firstHtml)
  })
})
