/** Form controls, buttons, and tabs. */
import type { CSSProperties } from 'react'
import type { DesignElement, DesignPropValue } from '@filipeesch/dsh-design-core'
import { useDesign } from './context.tsx'
import { useAct } from './interactions.ts'
import { BORDER, FONT, SURFACE, TEXT, ACTION, RADIUS, GAP_SM, type DesignComponentProps } from './primitives.tsx'
import {
  nodeAttributes,
  stringProp,
  useBooleanProp,
  useNumberProp,
  useProp,
  useStringProp,
  useStyleValue,
  useTransition,
} from './styles.ts'

function buttonColors(variant: string): CSSProperties {
  switch (variant) {
    case 'secondary':
      return { background: SURFACE, color: TEXT, border: '1px solid ' + BORDER }
    case 'ghost':
      return { background: 'transparent', color: TEXT, border: '1px solid transparent' }
    case 'danger':
      return { background: 'var(--dsx-color-danger, #dc2626)', color: '#ffffff', border: '1px solid transparent' }
    case 'link':
      return { background: 'transparent', color: ACTION, border: '1px solid transparent', textDecoration: 'underline' }
    default:
      return { background: ACTION, color: '#ffffff', border: '1px solid transparent' }
  }
}

/** Button. */
export function Button({ node, children }: DesignComponentProps) {
  const variant = useStringProp(node, 'variant') ?? 'primary'
  const size = useStringProp(node, 'size') ?? 'md'
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const fullWidth = useBooleanProp(node, 'fullWidth') ?? false
  const act = useAct(node, 'onPress')
  const transition = useTransition(node)
  const padding = size === 'sm' ? '6px 10px' : size === 'lg' ? '12px 20px' : '8px 14px'
  const fontSize = size === 'sm' ? '13px' : size === 'lg' ? '16px' : '14px'
  return (
    <button
      {...nodeAttributes(node)}
      type="button"
      role="button"
      disabled={disabled}
      onClick={disabled ? undefined : act}
      style={{
        ...buttonColors(variant),
        padding,
        borderRadius: RADIUS,
        fontFamily: FONT,
        fontSize,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? '100%' : 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        boxSizing: 'border-box',
        ...transition,
      }}
    >
      {children}
    </button>
  )
}

/** Icon-only button. */
export function IconButton({ node }: DesignComponentProps) {
  const icon = useStringProp(node, 'icon') ?? 'info'
  const label = useStringProp(node, 'label') ?? 'Button'
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const variant = useStringProp(node, 'variant') ?? 'ghost'
  const act = useAct(node, 'onPress')
  const transition = useTransition(node)
  const iconNode: DesignElement = { ...node, type: 'Icon', props: { name: icon } }
  return (
    <button
      {...nodeAttributes(node)}
      type="button"
      role="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={disabled ? undefined : act}
      style={{
        ...buttonColors(variant),
        padding: 8,
        borderRadius: RADIUS,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        ...transition,
      }}
    >
      <IconSlot node={iconNode} />
    </button>
  )
}

/** Inline icon rendered without a second data-dsx wrapper. */
function IconSlot({ node }: { node: DesignElement }) {
  const name = useStringProp(node, 'name') ?? 'info'
  const size = useStyleValue(node, 'size') ?? '20px'
  const color = useStyleValue(node, 'color') ?? 'currentColor'
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: '0 0 auto', display: 'inline-block', verticalAlign: 'middle' }}
    >
      <path d={ICONS[name] ?? ICONS.info} />
    </svg>
  )
}

/** Field label. */
function FieldLabel({ label }: { label: string | undefined }) {
  if (label === undefined) return null
  return <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: TEXT }}>{label}</span>
}

const FIELD_STYLE: CSSProperties = {
  border: '1px solid ' + BORDER,
  borderRadius: RADIUS,
  padding: '8px 10px',
  fontFamily: FONT,
  fontSize: 14,
  color: TEXT,
  background: SURFACE,
  boxSizing: 'border-box',
}

/** Single-line input. */
export function Input({ node }: DesignComponentProps) {
  const label = useStringProp(node, 'label')
  const placeholder = useStringProp(node, 'placeholder')
  const type = useStringProp(node, 'type') ?? 'text'
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const env = useDesign()
  const act = useAct(node, 'onChange')
  const id = node.id ?? node.address.label
  const value = String(env.getValue(id, useStringProp(node, 'value') ?? '') ?? '')
  return (
    <label {...nodeAttributes(node)} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: FONT }}>
      <FieldLabel label={label} />
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => {
          env.setValue(id, event.target.value)
          act()
        }}
        style={FIELD_STYLE}
      />
    </label>
  )
}

/** Multi-line input. */
export function TextArea({ node }: DesignComponentProps) {
  const label = useStringProp(node, 'label')
  const placeholder = useStringProp(node, 'placeholder')
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const rows = useNumberProp(node, 'rows') ?? 3
  const env = useDesign()
  const act = useAct(node, 'onChange')
  const id = node.id ?? node.address.label
  const value = String(env.getValue(id, useStringProp(node, 'value') ?? '') ?? '')
  return (
    <label {...nodeAttributes(node)} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: FONT }}>
      <FieldLabel label={label} />
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => {
          env.setValue(id, event.target.value)
          act()
        }}
        style={{ ...FIELD_STYLE, resize: 'vertical' }}
      />
    </label>
  )
}

interface SelectOption {
  label: string
  value: string
}

/** Read an options array into label/value pairs. */
export function optionsOf(value: DesignPropValue | undefined): SelectOption[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    if (typeof entry === 'string') return { label: entry, value: entry }
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const record = entry as Record<string, DesignPropValue>
      return { label: String(record.label ?? record.value ?? ''), value: String(record.value ?? record.label ?? '') }
    }
    return { label: String(entry), value: String(entry) }
  })
}

/** Select control. */
export function Select({ node }: DesignComponentProps) {
  const label = useStringProp(node, 'label')
  const options = optionsOf(useProp(node, 'options'))
  const placeholder = useStringProp(node, 'placeholder')
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const env = useDesign()
  const id = node.id ?? node.address.label
  const value = String(env.getValue(id, useStringProp(node, 'value') ?? '') ?? '')
  const act = useAct(node, 'onChange')
  return (
    <label {...nodeAttributes(node)} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: FONT }}>
      <FieldLabel label={label} />
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          env.setValue(id, event.target.value)
          act()
        }}
        style={FIELD_STYLE}
      >
        <option value="">{placeholder ?? 'Select…'}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Multi-choice select. */
export function MultiSelect({ node }: DesignComponentProps) {
  const label = useStringProp(node, 'label')
  const options = optionsOf(useProp(node, 'options'))
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const env = useDesign()
  const id = node.id ?? node.address.label
  const initial = node.props.values
  const value = (env.getValue(id, Array.isArray(initial) ? initial.map(String) : []) as unknown[]).map(String)
  const act = useAct(node, 'onChange')
  return (
    <label {...nodeAttributes(node)} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: FONT }}>
      <FieldLabel label={label} />
      <select
        multiple
        size={Math.min(4, Math.max(2, options.length))}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          env.setValue(
            id,
            [...event.target.selectedOptions].map((option) => option.value),
          )
          act()
        }}
        style={{ ...FIELD_STYLE, padding: 6 }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Combobox with suggestions. */
export function Combobox({ node }: DesignComponentProps) {
  const label = useStringProp(node, 'label')
  const options = optionsOf(useProp(node, 'options'))
  const placeholder = useStringProp(node, 'placeholder')
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const env = useDesign()
  const id = node.id ?? node.address.label
  const value = String(env.getValue(id, useStringProp(node, 'value') ?? '') ?? '')
  const act = useAct(node, 'onChange')
  const listId = 'dsx-combobox-' + id
  return (
    <label {...nodeAttributes(node)} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: FONT }}>
      <FieldLabel label={label} />
      <input
        list={listId}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => {
          env.setValue(id, event.target.value)
          act()
        }}
        style={FIELD_STYLE}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </datalist>
    </label>
  )
}

/** Checkbox. */
export function Checkbox({ node }: DesignComponentProps) {
  const label = useStringProp(node, 'label')
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const env = useDesign()
  const id = node.id ?? node.address.label
  const checked = Boolean(env.getValue(id, useBooleanProp(node, 'checked') ?? false))
  const act = useAct(node, 'onChange')
  return (
    <label
      {...nodeAttributes(node)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: GAP_SM, fontFamily: FONT, fontSize: 14, color: TEXT }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          env.setValue(id, event.target.checked)
          act()
        }}
      />
      {label}
    </label>
  )
}

/** Radio option. */
export function Radio({ node }: DesignComponentProps) {
  const label = useStringProp(node, 'label')
  const name = useStringProp(node, 'name') ?? 'radio'
  const own = useStringProp(node, 'value') ?? node.id ?? ''
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const env = useDesign()
  const id = node.id ?? node.address.label
  const group = 'radio:' + name
  const fallback = useBooleanProp(node, 'checked') === true ? own : ''
  const selected = String(env.getValue(group, fallback) ?? '')
  const act = useAct(node, 'onChange')
  return (
    <label
      {...nodeAttributes(node)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: GAP_SM, fontFamily: FONT, fontSize: 14, color: TEXT }}
    >
      <input
        type="radio"
        name={name}
        value={own}
        checked={selected === own}
        disabled={disabled}
        onChange={() => {
          env.setValue(group, own)
          env.setValue(id, true)
          act()
        }}
      />
      {label}
    </label>
  )
}

/** Toggle switch. */
export function Switch({ node }: DesignComponentProps) {
  const label = useStringProp(node, 'label')
  const disabled = useBooleanProp(node, 'disabled') ?? false
  const env = useDesign()
  const id = node.id ?? node.address.label
  const checked = Boolean(env.getValue(id, useBooleanProp(node, 'checked') ?? false))
  const act = useAct(node, 'onChange')
  return (
    <label
      {...nodeAttributes(node)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: GAP_SM, fontFamily: FONT, fontSize: 14, color: TEXT }}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          env.setValue(id, event.target.checked)
          act()
        }}
        style={{ width: 34, height: 20 }}
      />
      {label}
    </label>
  )
}

/** Tab list and active panel. */
export function Tabs({ node }: DesignComponentProps) {
  const env = useDesign()
  const tabs = node.children.filter((child): child is DesignElement => child.kind === 'element' && child.type === 'Tab')
  const first = tabs[0]
  const fallback =
    useStringProp(node, 'value') ??
    (first === undefined ? '' : String(stringProp(first, 'value', env) ?? first.id ?? first.address.label))
  const active = env.getTab(node.id ?? node.address.label, fallback)
  const act = useAct(node, 'onChange')
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => (tab.id ?? tab.address.label) === active || tab.props.value === active),
  )
  const activeTab = tabs[activeIndex]
  return (
    <div>
      <div
        {...nodeAttributes(node)}
        role="tablist"
        style={{ display: 'flex', gap: 4, borderBottom: '1px solid ' + BORDER }}
      >
        {tabs.map((tab, index) => {
          const selected = index === activeIndex
          const key = tab.id ?? tab.address.label
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                env.setTab(node.id ?? node.address.label, key)
                act()
              }}
              style={{
                ...buttonColors(selected ? 'primary' : 'ghost'),
                padding: '8px 12px',
                border: 'none',
                borderBottom: selected ? '2px solid ' + ACTION : '2px solid transparent',
                borderRadius: 0,
                fontFamily: FONT,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {String(stringProp(tab, 'label', env) ?? key)}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" style={{ paddingTop: 'var(--dsx-spacing-sm, 8px)' }}>
        {activeTab === undefined ? null : env.renderNode(activeTab)}
      </div>
    </div>
  )
}

/** One tab panel. */
export function Tab({ node, children }: DesignComponentProps) {
  return (
    <div {...nodeAttributes(node)} role="tabpanel" aria-label={useStringProp(node, 'label')}>
      {children}
    </div>
  )
}

// Local import kept at the bottom to avoid a cycle through primitives.
import { ICONS } from './primitives.tsx'
