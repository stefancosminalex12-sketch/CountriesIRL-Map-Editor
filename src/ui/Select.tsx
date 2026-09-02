/**
 * A labelled dropdown.
 *
 * The control is a real `<select>` and stays one: the popup, the type-ahead, the
 * keyboard behaviour and the screen-reader semantics are the browser's, and none of
 * them is reimplemented. All this adds is a wrapper the stylesheet can hang a chevron
 * on, since the platform's own arrow disappears with `appearance: none` and an SVG
 * baked into a background image could not follow the theme.
 */
import type { ReactNode } from 'react'

export interface SelectFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}

export function SelectField({ label, value, onChange, children }: SelectFieldProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="select">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {children}
        </select>
      </span>
    </label>
  )
}
