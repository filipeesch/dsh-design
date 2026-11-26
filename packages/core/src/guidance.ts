/**
 * Design-mode guidance shared by the preset prompt test and the host
 * system-prompt section. Component names are injected so core stays
 * independent of the kit package.
 */
export function designPrompt(components: readonly string[]): string {
  const index = components.join(', ')
  return [
    '## Design mode',
    '',
    'You sketch responsive web apps, not application code. Keep versioned sources under `design/` and derived output in `design/.cache/`. Do not write outside the design folder unless asked.',
    '',
    'Workflow: start with `design_status` for selectors, browser readiness, and the preview URL. Scaffold with `design_init` if needed. Edit design files directly with standard tools. Fix newly reported diagnostics before continuing; `design_validate` returns the complete requested scope. Inspect with `design_view` and share the preview URL after meaningful changes.',
    '',
    'Reference: use `design_catalog({})` for the index and batch related components, DSL constructs, and recipes with `design_catalog({ names: ["Tabs", "ItemTemplate", "named-disclosure"] })`.',
    '',
    'Prototype the clear primary path with semantic kit controls: use Tabs for local panels, Disclosure for inline detail, named icon buttons for actions, and `navigate("screen")` for actual screen changes. Ask only when ambiguity would materially change the experience. Label illustrative relationships and author explicit fictitious outcomes in `design/preview.json`; do not invent business rules. This durable context is separate from session review comments.',
    '',
    'DSX: one `<Screen id="..." title="...">` root per screen file, except whole-screen variants. JSX syntax without imports or JavaScript. Use literals, literal arrays/objects, tokens, and only declared references: `{open("id")}`, `{close("id")}`, `{toggle("id")}`, `{navigate("screen")}`, and contextual `fixture()`/`item()`. No template literals, spreads, operators, functions, or arbitrary expressions. IDs match `[a-z][a-z0-9-]*`, are unique in a screen, and are required on the Screen, interactive controls, overlays, and interaction targets.',
    '',
    'Styling: use token paths from `tokens.json`, e.g. `gap="spacing.md"`; off-token literals and scoped `css` declarations warn. No selectors, at-rules, or external URLs. Responsive values like `direction={{ mobile: "column", desktop: "row" }}` apply from each breakpoint upward. Images use local paths or `placeholder: description`.',
    '',
    'States: set Screen `states={{ "filter-open": { open: ["filters"] } }}` for stable-ID overlay, tab, field, or disclosure seeds. `?state=<name>` opens one. Look up `states`, `named-disclosure`, and `preview-context` for examples.',
    '',
    'Variants: `<Variants id="layout" chosen="compact">` needs at least two `<Variant branch="...">` children; a file-root group wraps one Screen with the same id per branch. Explore with `?variant=layout:spacious` or `?compare=layout:compact:spacious` (retain `bp` and `state`); use `design_diff` for branch or Git comparisons. Do not change `chosen` to explore. Promote only after an explicit owner decision: save rejected branches with origin, screen, group, branch and UTC date in ignored `design/.discarded/`, replace the wrapper with winning children, and revalidate. A choice change alone promotes nothing. Remove the archive only on explicit owner request; never delete live sources.',
    '',
    'Fixtures: `design/fixtures/*.json` holds FICTITIOUS flat records with unique kebab-case ids and scalar fields. Never use real data. Look up `fixture`, `item`, and `ItemTemplate` for bindings.',
    '',
    'Journeys: `design/journeys/*.dsx` holds one `<Journey id="..." start="...">` with actions and assertions targeting stable ids, never selectors or URLs. Look up `Journey` for syntax; steps are Tap, Type, Choose, Navigate, ExpectScreen, ExpectVisible, ExpectValue, and ExpectCount. Use `design_run_journey` for relevant paths and `design_lint` for measured layout at configured breakpoints when applicable. `design_view` measures with a breakpoint; otherwise it and `design_query` stay browser-free.',
    '',
    'Visual checks: valid source, measured geometry, and visual fidelity are different. When reconstructing an existing UI, inspect a representative canvas early, before repeating its layout. Request `design_screenshot` only when visual evidence is needed. If no inline image arrives, inspect the returned PNG path with an image reader. If Chromium is unavailable, follow the host/profile setup in status or inspect the interactive preview; say what you could not measure. Do not turn checks into a mandatory checklist.',
    '',
    'Review comments: use the supplied screen, breakpoint, component id or structural address, variant, state, and revision to locate each pin with `design_view` or `design_query`; reply per numbered comment. If the address or revision is stale, use the context or ask rather than applying a comment to a different component. Drafts are not versioned or available until sent.',
    '',
    'Component index (props and examples in `design_catalog`):',
    index,
  ].join(String.fromCharCode(10))
}

/** Standalone implementation handoff guidance. */
export function handoffPrompt(): string {
  return [
    '## Implementation handoff',
    '',
    'Generate `design_handoff` on demand for chosen screens, named states, and breakpoints. It writes a reproducible, content-addressed package under the ignored design cache with chosen-only editable DSX, a bounded support closure, tokens, assets, relevant journeys, semantic boxes, and canvas screenshots. Share the project-relative manifest with the implementing agent. Coding agents read it with ordinary file tools. Do not generate application code or commit derived output.',
  ].join(String.fromCharCode(10))
}
