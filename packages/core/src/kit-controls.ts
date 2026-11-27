/** Focused semantic validation for the kit's compound controls. */
import { isDesignObject, isInteraction } from './refs.ts'
import type { DesignElement, DesignPropValue, Diagnostic, InteractionRef } from './types.ts'

const OPTION_ID = /^[a-z][a-z0-9-]{0,63}$/
const MAX_OPTIONS = 24
const MAX_CODE_LENGTH = 16_384

/** Find an explicit option without implicitly coercing a value or falling back. */
export function declaredOption(options: DesignPropValue | undefined, value: string) {
  if (!Array.isArray(options)) return undefined
  return options.find((entry) => isDesignObject(entry) && entry.value === value)
}

export function validateKitControl(
  node: DesignElement,
  ids: ReadonlySet<string>,
  diagnostics: Diagnostic[],
  addInteraction: (ref: InteractionRef) => void,
): void {
  const report = (prop: string, code: string, message: string) => {
    const { file, line, column } = node.propLocations?.[prop] ?? node.source
    diagnostics.push({
      severity: 'error',
      code,
      file,
      line,
      column,
      message,
      address: node.address.label,
      ...(node.id === undefined ? {} : { nodeId: node.id }),
    })
  }
  if (node.type === 'CodeBlock') {
    const text = node.props.text
    if (text !== undefined && (typeof text !== 'string' || text.length > MAX_CODE_LENGTH))
      report('text', 'code-block-text', '<CodeBlock> text must be a literal string of at most 16,384 characters.')
  }
  if (node.type === 'Popover' && node.props.anchor !== undefined) {
    const anchor = node.props.anchor
    if (typeof anchor !== 'string' || anchor === node.id || !ids.has(anchor))
      report('anchor', 'popover-anchor', '<Popover> anchor must identify another node on this screen.')
  }
  if (node.type !== 'ToggleButton' && node.type !== 'SelectButton' && node.type !== 'SplitButton') return
  const label = node.props.label
  if (label !== undefined && (typeof label !== 'string' || label.trim() === ''))
    report('label', 'control-label', '<' + node.type + '> requires a non-empty literal label.')
  if (node.type === 'ToggleButton') return
  const split = node.type === 'SplitButton'
  const options = node.props.options
  if (!Array.isArray(options) || options.length === 0 || options.length > MAX_OPTIONS) {
    report('options', 'control-options', '<' + node.type + '> requires 1–24 declared option objects.')
    return
  }
  const seen = new Set<string>()
  for (const [index, entry] of options.entries()) {
    const prefix = '<' + node.type + '> option ' + String(index + 1)
    if (
      !isDesignObject(entry) ||
      Object.keys(entry).some((key) => !['value', 'label', 'disabled', ...(split ? ['onClick'] : [])].includes(key))
    ) {
      report(
        'options',
        'control-option-shape',
        prefix + ' must declare only value, label, optional disabled' + (split ? ', and onClick.' : '.'),
      )
      continue
    }
    const { value, label, disabled, onClick } = entry
    if (typeof value !== 'string' || !OPTION_ID.test(value) || seen.has(value)) {
      report('options', 'control-option-id', prefix + ' requires a unique value matching [a-z][a-z0-9-]{0,63}.')
    } else {
      seen.add(value)
    }
    if (typeof label !== 'string' || label.trim() === '')
      report('options', 'control-option-label', prefix + ' requires a non-empty literal label.')
    if (disabled !== undefined && typeof disabled !== 'boolean')
      report('options', 'control-option-disabled', prefix + ' disabled must be true or false.')
    if (split) {
      if (isInteraction(onClick)) addInteraction(onClick)
      else report('options', 'control-option-action', prefix + ' onClick must be a declarative interaction.')
    }
  }
  const value = node.props.value
  if (!split && value !== undefined && (typeof value !== 'string' || !seen.has(value)))
    report('value', 'control-option-value', '<SelectButton> value must be one of its declared options.')
}
