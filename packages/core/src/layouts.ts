/** Parse independent layout declarations, then splice the selected screen's children. */
import { SOURCE_NAME } from './config.ts'
import { formatAddress, parseLayout } from './parse.ts'
import type { SourceInventory } from './sources.ts'
import type { DesignChild, DesignElement, DesignScreenNode, Diagnostic, SourceLocation } from './types.ts'

function problem(source: SourceLocation, code: string, message: string): Diagnostic {
  return { file: source.file, line: source.line, column: source.column, severity: 'error', code, message }
}

interface Layout {
  readonly root?: DesignElement
  readonly diagnostics: readonly Diagnostic[]
}

export function loadLayouts(inventory: SourceInventory) {
  const layouts = new Map<string, Layout>()
  const diagnostics: Diagnostic[] = []
  for (const file of inventory.directories.layouts) {
    const name = file.slice('layouts/'.length, -'.dsx'.length)
    if (!SOURCE_NAME.test(name)) {
      diagnostics.push(problem({ file, line: 1, column: 1 }, 'layout-name', 'Layout files require a kebab-case name.'))
      continue
    }
    const entry = inventory.entries.get(file)
    if (entry?.source === undefined) {
      layouts.set(name, { diagnostics: entry?.issue === undefined ? [] : [entry.issue] })
      continue
    }
    const parsed = parseLayout(entry.source, file)
    const errors = [...parsed.diagnostics]
    const root = parsed.document
    if (root !== undefined) {
      let slots = 0
      if (Object.keys(root.props).length !== 0) {
        errors.push(problem(root.source, 'layout-props', '<Layout> does not accept attributes or parameters.'))
      }
      const visit = (node: DesignElement, inTemplate: boolean): void => {
        if (node.type === 'ContentSlot') {
          slots += 1
          if (slots > 1)
            errors.push(problem(node.source, 'layout-slot-count', 'A layout must contain exactly one <ContentSlot />.'))
          if (inTemplate || Object.keys(node.props).length !== 0 || node.children.length !== 0) {
            errors.push(
              problem(
                node.source,
                'layout-slot-empty',
                '<ContentSlot /> must be empty, have no props, and be outside repeating templates.',
              ),
            )
          }
        } else if (
          ['Layout', 'Screen', 'Variants', 'Variant'].includes(node.type) ||
          'layout' in node.props ||
          'states' in node.props
        ) {
          errors.push(
            problem(
              node.source,
              'layout-nested',
              'Layouts cannot contain screens, variant/layout declarations, layout references, or named state.',
            ),
          )
        }
        for (const child of node.children)
          if (child.kind === 'element') visit(child, inTemplate || node.type === 'ItemTemplate')
      }
      for (const child of root.children) if (child.kind === 'element') visit(child, false)
      if (slots === 0)
        errors.push(problem(root.source, 'layout-slot-count', 'A layout must contain exactly one <ContentSlot />.'))
    }
    layouts.set(name, { root, diagnostics: errors })
    diagnostics.push(...errors)
  }
  return { layouts, diagnostics }
}

export type LayoutCatalog = ReturnType<typeof loadLayouts>['layouts']

export function composeLayout(screen: DesignScreenNode, layouts: LayoutCatalog) {
  const { layout, ...props } = screen.props
  if (layout === undefined) return { root: screen, diagnostics: [] as Diagnostic[] }
  const use = screen.propLocations?.layout ?? screen.source
  const root = { ...screen, props }
  if (typeof layout !== 'string' || !SOURCE_NAME.test(layout)) {
    return { root, diagnostics: [problem(use, 'layout-value', 'Screen layout must be a literal kebab-case name.')] }
  }
  const definition = layouts.get(layout)
  if (definition === undefined) {
    return {
      root,
      diagnostics: [
        problem(use, 'layout-missing', 'Screen "' + screen.id + '" uses missing layout layouts/' + layout + '.dsx.'),
      ],
    }
  }
  if (definition.root === undefined || definition.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return {
      root,
      diagnostics: [
        ...definition.diagnostics,
        problem(use, 'layout-invalid', 'Screen "' + screen.id + '" uses invalid layout layouts/' + layout + '.dsx.'),
      ],
    }
  }
  function address(children: readonly DesignChild[], path: readonly number[], splice: boolean): DesignChild[] {
    const expanded: DesignChild[] = []
    let elementIndex = 0
    function append(node: DesignChild, canSplice: boolean): void {
      if (node.kind === 'text') {
        expanded.push(node)
        return
      }
      if (canSplice && node.type === 'ContentSlot') {
        for (const child of screen.children) append(child, false)
        return
      }
      const next = [...path, elementIndex++]
      expanded.push({
        ...node,
        address: { path: next, label: formatAddress(next) },
        children: address(node.children, next, canSplice),
      })
    }
    for (const child of children) append(child, splice)
    return expanded
  }
  return {
    root: { ...root, children: address(definition.root.children, [], true) },
    diagnostics: [...definition.diagnostics],
  }
}
