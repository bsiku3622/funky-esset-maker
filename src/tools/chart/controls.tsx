/* The small controls the chart inspector is built from.
 *
 * Separate from the panels so the panels read as a list of properties rather
 * than as a wall of <select> markup, and so a control's behaviour — an empty
 * option meaning "auto", a number field that commits on blur — is decided once. */

import type { ReactNode } from 'react'
import type { Column } from '../../cores'
import SharedNumField from '../NumField'

export interface Opt<T extends string> {
  v: T
  l: string
}

export function Sel<T extends string>({
  value,
  onChange,
  opts,
  title,
}: {
  value: T
  onChange: (v: T) => void
  opts: Opt<T>[]
  title?: string
}) {
  return (
    <select value={value} title={title} onChange={(e) => onChange(e.target.value as T)}>
      {opts.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  )
}

/** A column picker. The empty option is "not bound", which for most fields
 *  means the mark falls back to row order rather than failing. */
export function ColSel({
  value,
  onChange,
  columns,
  none = '—',
  numericOnly,
}: {
  value: string | undefined
  onChange: (v: string | undefined) => void
  columns: Column[]
  none?: string
  numericOnly?: boolean
}) {
  const list = numericOnly ? columns.filter((c) => c.numeric) : columns
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{none}</option>
      {list.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
      {/* a binding whose column disappeared stays selectable, so retyping the
          header does not silently drop the series */}
      {value && !list.some((c) => c.name === value) && (
        <option value={value}>{`${value} (없음)`}</option>
      )}
    </select>
  )
}

export function Txt({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** A number that may be left blank to mean "work it out". */
export function AutoNum({
  value,
  onChange,
  integer,
}: {
  value: number | null | undefined
  onChange: (v: number | null) => void
  integer?: boolean
}) {
  if (value === null || value === undefined)
    return (
      <button type="button" className="fx-insp__btn" onClick={() => onChange(0)}>
        자동
      </button>
    )
  return (
    <>
      <SharedNumField value={value} onCommit={onChange} integer={integer} />
      <button
        type="button"
        className="fx-insp__btn"
        title="자동으로"
        onClick={() => onChange(null)}
      >
        ↺
      </button>
    </>
  )
}

export function Num({
  value,
  onChange,
  integer,
}: {
  value: number
  onChange: (v: number) => void
  integer?: boolean
}) {
  return <SharedNumField value={value} onCommit={onChange} integer={integer} />
}

export function Toggle({
  on,
  onChange,
  children,
  title,
}: {
  on: boolean
  onChange: (v: boolean) => void
  children: ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      className={`fx-insp__btn${on ? ' is-on' : ''}`}
      aria-pressed={on}
      title={title}
      onClick={() => onChange(!on)}
    >
      {children}
    </button>
  )
}
