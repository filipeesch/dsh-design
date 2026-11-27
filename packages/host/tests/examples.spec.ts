import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { loadProject } from '@filipeesch/dsh-design-core'
import { kitMetadata } from '@filipeesch/dsh-design-kit/meta'
import { BrowserSessions } from '../src/browser.ts'
import { payloadFor, runGeometry, runJourney, runLint } from '../src/checks.ts'
import { findChromium } from './chromium.ts'

const assetsDir = fileURLToPath(new URL('../../renderer/dist/', import.meta.url))
const chromiumPath = await findChromium()
const browsers = new BrowserSessions(chromiumPath === undefined ? {} : { executablePath: chromiumPath })
afterAll(() => browsers.disposeAll())

const examples = [
  { name: 'synthetic-help-center', screens: ['help'], journeys: ['help-faq'] },
  {
    name: 'synthetic-checkout',
    screens: ['catalog', 'checkout', 'confirmation'],
    journeys: ['catalog-to-confirmation', 'checkout-price-details', 'checkout-review'],
  },
  {
    name: 'document-outcomes',
    screens: ['document', 'review'],
    journeys: ['document-approved', 'document-correction', 'document-submit'],
  },
  { name: 'release-console', screens: ['history', 'overview'], journeys: ['review-release'] },
]

function projectFor(name: string) {
  const folder = fileURLToPath(new URL('../../../examples/' + name + '/design/', import.meta.url))
  return loadProject({ folder, kit: kitMetadata, installedKitVersion: '1.0.0' })
}

describe.each(examples)('$name', ({ name, screens, journeys }) => {
  it('loads every screen, preview description, and journey without diagnostics', async () => {
    const project = await projectFor(name)
    expect(project.diagnostics).toEqual([])
    expect(project.screens.map((screen) => screen.id)).toEqual(screens)
    expect(Object.keys(project.preview?.screens ?? {})).toEqual(screens)
    expect(project.journeys.map((journey) => journey.id)).toEqual(journeys)
  })

  it.skipIf(chromiumPath === undefined).each(journeys)(
    'runs %s in Chromium',
    async (journey) => {
      const project = await projectFor(name)
      const result = await runJourney({ sessionId: name, browsers, assetsDir }, project, journey)
      expect(result.ok, JSON.stringify(result.steps)).toBe(true)
      expect(result.steps).toHaveLength(
        project.journeys.find((entry) => entry.id === journey)?.journey?.steps.length ?? 0,
      )
    },
    30_000,
  )
})

it('composes the release console layout twice and resolves its named palettes', async () => {
  const project = await projectFor('release-console')
  expect(project.entry).toBe('overview')
  expect(project.defaultTheme).toBe('light')
  expect(Object.keys(project.themes).sort()).toEqual(['base', 'dark', 'light'])
  expect(project.themes.light?.tokens.tokens['color.panel']?.value).toBe('#ffffff')
  expect(project.themes.dark?.tokens.tokens['color.panel']?.value).toBe('#202d43')
  for (const screen of project.screens) {
    expect(screen.root?.children).toEqual([
      expect.objectContaining({
        id: 'console-shell',
        source: expect.objectContaining({ file: 'layouts/console-shell.dsx' }),
        children: [
          expect.objectContaining({ id: 'release-nav' }),
          expect.objectContaining({
            id: screen.id === 'overview' ? 'release-card' : 'history-card',
            classCss: expect.arrayContaining([
              { property: 'background-color', value: 'var(--dsx-color-panel)' },
              { property: 'padding', value: 'var(--dsx-spacing-md)' },
            ]),
          }),
          ...(screen.id === 'overview'
            ? [expect.objectContaining({ id: 'release-menu' }), expect.objectContaining({ id: 'review-drawer' })]
            : []),
        ],
      }),
    ])
  }
})

it.skipIf(chromiumPath === undefined)('measures the release console with temporary review coordinates', async () => {
  const project = await projectFor('release-console')
  const result = await runGeometry({ sessionId: 'release-console', browsers, assetsDir }, project, 'overview', {
    nodes: ['review-drawer', 'release-note', 'build-log'],
    cases: [
      { breakpoint: 'mobile', state: 'review-open', theme: 'dark' },
      {
        breakpoint: 'mobile',
        state: 'review-open',
        theme: 'dark',
        reviewContext: {
          screen: 'overview',
          selection: '',
          theme: 'dark',
          open: [],
          tabs: { 'release-tabs': 'logs' },
          disclosures: { 'release-details': false },
        },
      },
      { breakpoint: 'mobile', state: 'review-open', theme: 'dark' },
    ],
  })
  expect(result.cases.map((entry) => entry.nodes.map((node) => node.status))).toEqual([
    ['visible', 'visible', 'hidden'],
    ['hidden', 'hidden', 'visible'],
    ['visible', 'visible', 'hidden'],
  ])
  expect(result.cases[1]).toMatchObject({
    breakpoint: 'mobile',
    theme: 'dark',
    rendition: 'current',
    reviewContext: true,
  })
})

it('resolves both manual outcomes from the waiting screen to different local situations', async () => {
  const project = await projectFor('document-outcomes')
  expect(project.preview?.relationships).toMatchObject([
    {
      kind: 'simulated',
      label: 'Approval',
      from: { screen: 'review' },
      to: { situation: 'document-approved', screen: 'review', state: 'approved' },
    },
    {
      kind: 'simulated',
      label: 'Correction request',
      from: { screen: 'review' },
      to: { situation: 'correction-requested', screen: 'review', state: 'needs-correction' },
    },
    {
      kind: 'illustrative',
      label: 'Revise and resubmit',
      from: { situation: 'correction-requested', screen: 'review', state: 'needs-correction' },
      to: { screen: 'document' },
    },
  ])
})

it.skipIf(chromiumPath === undefined)(
  'measures all checkout catalog breakpoints and renders the three fixture list items',
  async () => {
    const project = await projectFor('synthetic-checkout')
    const sessionId = 'synthetic-checkout'
    const lint = await runLint({ sessionId, browsers, assetsDir }, project, 'catalog', {})
    expect(lint.errors).toBe(0)
    expect(lint.findings.every((finding) => finding.severity === 'warning')).toBe(true)
    expect(lint.breakpoints).toEqual(['mobile', 'tablet', 'desktop'])
    const payload = await payloadFor(project, sessionId)
    const listitems = await browsers.run(
      { sessionId, payload, assetsDir, screen: 'catalog', breakpoint: 'mobile', breakpointWidth: 390 },
      (page) => page.locator('[role="listitem"]').count(),
    )
    expect(listitems).toBe(3)
  },
  60_000,
)
