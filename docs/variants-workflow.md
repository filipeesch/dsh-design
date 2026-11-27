# Variant workflow

Variants let one design project hold mutually exclusive alternatives while the
chosen source stays the only projection used by journeys, browser checks, and
inspection.

## Declare alternatives

A subtree group wraps ordinary children:

`<Variants id="layout" chosen="compact">
  <Variant branch="compact"><Stack gap="spacing.sm">...</Stack></Variant>
  <Variant branch="spacious"><Stack gap="spacing.lg">...</Stack></Variant>
</Variants>`

A whole-screen group is the file root and wraps one `<Screen>` per branch with
the same screen id:

`<Variants id="layout" chosen="compact">
  <Variant branch="compact"><Screen id="home" title="Home">...</Screen></Variant>
  <Variant branch="spacious"><Screen id="home" title="Home">...</Screen></Variant>
</Variants>`

Rules:

- Group ids and branch ids match `[a-z][a-z0-9-]*`; group ids are screen-local
  unique and branch ids are unique within their group.
- Each group declares exactly one `chosen` branch and at least two branches.
- Stable node ids may repeat across mutually exclusive branches, but must stay
  unique in every resolved projection.
- Nested groups are addressed by path, for example `layout/sidebar`. Selecting a
  nested branch automatically chooses the ancestor branch that exposes it; an
  explicit contradictory ancestor selection is diagnosed instead of guessed.
- Wrappers never render. Every branch is parsed and validated, including
  non-chosen branches. The project validates every reachable projection up to
  the documented budget and reports a source-located limit instead of
  publishing alternatives it did not validate.

## Preview and compare

- Chosen projection: `/design/<session>/<screen>`
- One branch: `/design/<session>/<screen>?variant=layout:spacious`
- Side by side: `/design/<session>/<screen>?compare=layout:compact:spacious`
- Add `bp=mobile` and `state=filters-open` to either link.

The comparison parent controls the group, both branches, breakpoint, and
starting state. Each pane is an isolated same-origin preview with its own
interaction state and focus, so a drawer, modal, or field edit affects only that
pane. The panes keep their exact breakpoint widths and the comparison region
scrolls horizontally (keyboard accessible) on narrow hosts instead of widening
the page.

Unknown groups, branches, and named-state targets are diagnosed. The chosen
branch is not substituted automatically, and the chosen fallback remains one
click away.

When a variant route is active, review comments record the effective branch.
A comment created on a stable id shared by both panes pins only its own branch
and stays in the session pending queue when viewed from the other branch.

## Inspect and diff

- `design_status` lists groups, choices, and per-branch validity.
- `design_view`, `design_query`, and `design_screenshot` accept
  `variant: "group:branch"`; the result identifies the effective projection.
  Screenshot names include the branch so projections never overwrite each
  other.
- `design_diff({ screen, group, from, to })` compares two branches.
- `design_diff({ screen, fromRevision, toRevision })` compares the chosen
  projection at two locally available Git revisions. It reads committed design
  inputs only, never checks out, stages, writes, fetches, or uses Chromium, and
  reports explicit diagnostics for unavailable revisions and missing historic
  inputs instead of substituting the working tree.

Moves use stable ids; an insertion shift does not mark every following node as
moved. Anonymous fallback matches are labeled structural, and prop/text changes
carry their value types.

## Promote and discard

Promotion is an ordinary source edit. There is no promotion tool and no browser
mutation.

1. Wait until the owner explicitly selects a winner. Changing `chosen` alone
   promotes and discards nothing.
2. Confirm `design/.gitignore` ignores `design/.discarded/`. New scaffolds
   already do; for an older project add the line, or verify with
   `git check-ignore -v design/.discarded/record.dsx` before writing anything.
3. Record each rejected branch under `design/.discarded/` with its source and a
   project-relative origin, screen, group, branch, and UTC discard date. A
   record is a local artifact, not a design source.
4. Replace the exact `<Variants>` block in the screen source with the winning
   branch's children using normal text edits. Preserve the surrounding tree and
   unrelated groups.
5. Validate the edited source and inspect the normal chosen preview.
6. Reply to the owner with what was promoted and where the local records live.

Discard records are excluded from discovery, preview, journeys, checks, the
the preview, and Git (when the ignore rule is present). They exist only where they
were written.

## Cleanup

Cleanup is owner-requested and confined to the canonical discard folder:

`rm -rf -- <project>/design/.discarded`

Before running it, resolve the absolute path, confirm it is exactly the design
folder's `.discarded` directory, and confirm it is not a symlink. Never delete
`design/screens`, `design/fixtures`, `design/journeys`, `design/.cache`, or any
versioned source. When the owner has not asked to finish the exploration, leave
the records in place.
