/** Compact DSL guidance for the `design` preset (under 6,000 characters). */
import { componentNames, kitMetadata } from '@filipeesch/dsh-design-kit/meta'

/**
 * Build the design prompt section. It points at `design_catalog` for prop
 * details instead of embedding per-component prop tables.
 */
export function designPrompt(): string {
  const index = componentNames
    .map((name) => {
      const meta = kitMetadata[name] as { description: string }
      return name + ': ' + meta.description
    })
    .join('\n')
  return [
    '## Design mode',
    '',
    'You sketch a responsive web app before implementing it. Work in the `design/` folder of the working directory. Sources are versioned; derived files belong in `design/.cache/` only.',
    '',
    'Workflow: call `design_status` first. If no project exists, call `design_init`. Edit `design/screens/*.dsx`, `design/tokens.json`, or `design/design.json` with the standard file tools. Every edit that changes a design file returns a validation summary; fix every error it reports before continuing. Use `design_view` to inspect structure and `design_catalog` for component props and examples. After meaningful changes, give the user the preview URL from `design_status` (open it in a browser tab).',
    '',
    'DSL rules: one `<Screen id="..." title="...">` root per file, JSX style, no imports or JavaScript. Prop values are string/count/bool/null literals, arrays and objects of literals, token paths, responsive objects keyed by breakpoint, and interaction references `{open("id")}`, `{close("id")}`, `{toggle("id")}`, `{navigate("screen")}`. Only those four calls are allowed. Never use template literals, spreads, operators, functions, or arbitrary expressions.',
    '',
    'IDs: match `[a-z][a-z0-9-]*`; unique in a screen; required on `Screen`, every interactive component, every overlay (`Drawer`, `Modal`, `Popover`, `Menu`, `Toast`), and every node targeted by an interaction.',
    '',
    'Styling: use style props with token paths from `tokens.json` (for example `gap="spacing.md"`, `background="color.surface"`). A raw literal such as `#ff0000` or `13px` is applied but reported as an off-token warning. The `css` prop takes scoped declarations only and always warns; selectors, at-rules, and external URLs are rejected. Responsive values: `direction={{ mobile: "column", desktop: "row" }}` applies from each breakpoint upward. Images use a path inside `design/` or `placeholder: description`; remote URLs are rejected.',
    '',
    'Files: `design.json` (kitVersion pin, breakpoints, entry), `tokens.json` (W3C tokens, `$value`/`$type`, `{group.token}` aliases), `design/screens/<name>.dsx`. Do not write outside the design folder unless the user asks.',
    '',
    'Component index (details: `design_catalog({ name })`):',
    index,
  ].join('\n')
}
