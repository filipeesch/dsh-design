/** Addressable action and selection controls. */
import { useId, useRef, useState, type CSSProperties } from 'react'
import { isInteraction, type DesignPropValue } from '@filipeesch/dsh-design-core'
import { anchoredSurface, useAnchoredPanel } from './anchored.ts'
import { useDesign } from './context.tsx'
import { useAct, useDispatchInteraction } from './interactions.ts'
import { ACTION, BORDER, FONT, RADIUS, SURFACE, TEXT, type DesignComponentProps } from './primitives.tsx'
import { nodeAttributes, useBooleanProp, useStringProp } from './styles.ts'

const controlStyle: CSSProperties = {
  border: '1px solid ' + BORDER,
  borderRadius: RADIUS,
  padding: '8px 12px',
  font: '600 14px ' + FONT,
  maxWidth: '100%',
  minWidth: 0,
  overflowWrap: 'anywhere',
}

function selectionStyle(selected: boolean, disabled: boolean): CSSProperties {
  return {
    ...controlStyle,
    background: selected ? 'var(--dsx-color-selected, ' + ACTION + ')' : 'var(--dsx-color-control, ' + SURFACE + ')',
    color: selected ? 'var(--dsx-color-selectedText, #ffffff)' : 'var(--dsx-color-controlText, ' + TEXT + ')',
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

function optionsOf(raw: DesignPropValue | undefined) {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((option) => {
    if (
      option === null ||
      typeof option !== 'object' ||
      Array.isArray(option) ||
      !('value' in option) ||
      typeof option.value !== 'string' ||
      !('label' in option) ||
      typeof option.label !== 'string'
    )
      return []
    return [
      {
        value: option.value,
        label: option.label,
        disabled: 'disabled' in option && option.disabled === true,
        action: 'onClick' in option && isInteraction(option.onClick) ? option.onClick : undefined,
      },
    ]
  })
}

/** Native pressable boolean button. */
export function ToggleButton({ node }: DesignComponentProps) {
  const env = useDesign()
  const id = node.id ?? node.address.label
  const pressed = env.getValue(id, useBooleanProp(node, 'pressed') ?? false) === true
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const label = useStringProp(node, 'label')
  const change = useAct(node, 'onChange')
  return (
    <button
      {...nodeAttributes(node)}
      type="button"
      role="button"
      aria-pressed={pressed}
      disabled={disabled}
      data-dsx-value={String(pressed)}
      style={selectionStyle(pressed, disabled)}
      onClick={() => {
        env.setValue(id, !pressed)
        change()
      }}
    >
      {label}
    </button>
  )
}

/** Single-choice radio semantics without switching tabs or navigating implicitly. */
export function SelectButton({ node }: DesignComponentProps) {
  const env = useDesign()
  const id = node.id ?? node.address.label
  const label = useStringProp(node, 'label')
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const change = useAct(node, 'onChange')
  const options = optionsOf(node.props.options)
  const enabled = options.filter((option) => !option.disabled)
  const defaultValue = useStringProp(node, 'value') ?? enabled[0]?.value ?? options[0]?.value
  const value = env.getValue(id, defaultValue)
  const focusableValue = enabled.some((option) => option.value === value) ? value : enabled[0]?.value
  const set = (next: string) => {
    if (next === value) return
    env.setValue(id, next)
    change()
  }
  return (
    <div
      {...nodeAttributes(node)}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-dsx-value={typeof value === 'string' ? value : undefined}
      style={{ display: 'inline-flex', flexWrap: 'wrap', maxWidth: '100%', gap: 2 }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          data-dsx-part="option"
          data-dsx-value={option.value}
          disabled={disabled || option.disabled}
          tabIndex={focusableValue === option.value ? 0 : -1}
          style={selectionStyle(value === option.value, disabled || option.disabled)}
          onClick={() => set(option.value)}
          onKeyDown={(event) => {
            const controls = [
              ...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
                []),
            ]
            const index = controls.indexOf(event.currentTarget)
            if (index < 0) return
            const next =
              event.key === 'Home'
                ? controls[0]
                : event.key === 'End'
                  ? controls.at(-1)
                  : event.key === 'ArrowRight' || event.key === 'ArrowDown'
                    ? controls[(index + 1) % controls.length]
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                      ? controls[(index + controls.length - 1) % controls.length]
                      : undefined
            if (next === undefined) return
            event.preventDefault()
            next.focus()
            next.click()
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const menuItems = (menu: HTMLElement) => [
  ...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
]

/** Primary action and separately operated, canvas-anchored alternate actions. */
export function SplitButton({ node }: DesignComponentProps) {
  const label = useStringProp(node, 'label')
  const menuLabel = useStringProp(node, 'menuLabel')?.trim() || 'More actions'
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const items = optionsOf(node.props.options)
  const primary = useAct(node, 'onClick')
  const dispatch = useDispatchInteraction()
  const [open, setOpen] = useState(false)
  const expanded = open && !disabled
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const focusLast = useRef(false)
  const menuId = 'dsx-split-menu-' + useId()
  useAnchoredPanel(
    expanded,
    menu,
    () => trigger.current,
    () => setOpen(false),
    (panel) => {
      const controls = menuItems(panel)
      return (focusLast.current ? controls.at(-1) : controls[0]) ?? panel
    },
  )
  return (
    <div
      {...nodeAttributes(node)}
      role="group"
      aria-label={label}
      style={{ display: 'inline-flex', alignSelf: 'flex-start', maxWidth: '100%' }}
    >
      <button
        type="button"
        data-dsx-part="primary"
        disabled={disabled}
        onClick={primary}
        style={{ ...selectionStyle(true, disabled), minHeight: 44, borderStartEndRadius: 0, borderEndEndRadius: 0 }}
      >
        {label}
      </button>
      <button
        ref={trigger}
        type="button"
        data-dsx-part="menu"
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={expanded ? menuId : undefined}
        disabled={disabled}
        style={{
          ...selectionStyle(true, disabled),
          minWidth: 44,
          minHeight: 44,
          flexShrink: 0,
          borderStartStartRadius: 0,
          borderEndStartRadius: 0,
        }}
        onClick={() => {
          focusLast.current = false
          setOpen(!expanded)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          focusLast.current = event.key === 'ArrowUp'
          setOpen(true)
        }}
      >
        <span aria-hidden="true">▾</span>
      </button>
      {expanded ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          tabIndex={-1}
          style={{ ...anchoredSurface, width: 'max-content', padding: 4 }}
          onKeyDown={(event) => {
            const controls = menuItems(event.currentTarget)
            if (controls.length === 0) return
            const index = controls.indexOf(event.target as HTMLButtonElement)
            const next =
              event.key === 'ArrowDown'
                ? controls[(index + 1) % controls.length]
                : event.key === 'ArrowUp'
                  ? controls[(index <= 0 ? controls.length : index) - 1]
                  : event.key === 'Home'
                    ? controls[0]
                    : event.key === 'End'
                      ? controls.at(-1)
                      : undefined
            if (next === undefined) return
            event.preventDefault()
            next.focus()
          }}
        >
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              data-dsx-part="option"
              data-dsx-value={item.value}
              style={{
                ...selectionStyle(false, item.disabled),
                display: 'block',
                width: '100%',
                textAlign: 'start',
                border: 0,
              }}
              onClick={() => {
                trigger.current?.focus()
                setOpen(false)
                dispatch(item.action)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
