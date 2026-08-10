/* Small form primitives shared by the toolbar and the inspector.
 *
 * They are deliberately dumb (value + onChange) so every panel stays a pure
 * function of the document — the editor never keeps a second copy of a field's
 * state that could go stale after an undo. */

import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Field({
  label,
  children,
  wide,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <label className={`af-field${wide ? ' af-field--wide' : ''}`}>
      <span className="af-field__label">{label}</span>
      <span className="af-field__body">{children}</span>
    </label>
  )
}

export function Group({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="af-group">
      <header className="af-group__head">
        <span>{title}</span>
        {right}
      </header>
      <div className="af-group__body">{children}</div>
    </section>
  )
}

/* ---------- number ---------- */

export function Num({
  value,
  onChange,
  step = 1,
  min = -100000,
  max = 100000,
  suffix,
  width,
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
  width?: number
}) {
  const [text, setText] = useState(String(round(value)))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(String(round(value)))
  }, [value])

  const commit = (raw: string) => {
    const v = parseFloat(raw)
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
    else setText(String(round(value)))
  }
  return (
    <span className="af-num">
      <input
        type="text"
        inputMode="decimal"
        className="af-num__input"
        style={width ? { width } : undefined}
        value={text}
        onFocus={() => (focused.current = true)}
        onBlur={(e) => {
          focused.current = false
          commit(e.target.value)
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit((e.target as HTMLInputElement).value)
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? step * 10 : step)
            const next = Math.min(max, Math.max(min, round(value + d)))
            setText(String(next))
            onChange(next)
          }
          e.stopPropagation()
        }}
      />
      {suffix ? <span className="af-num__suffix">{suffix}</span> : null}
    </span>
  )
}

const round = (v: number) => Math.round(v * 100) / 100

/* ---------- number list ---------- */

/* A comma-separated list of counts — "4, 5, 3".
 *
 * Local text for the same reason `Num` keeps it: the field has to show what was
 * typed, not a re-print of the parsed value. Parsing on every keystroke and
 * feeding the array straight back in made the field impossible to edit — the
 * separator you had just typed was dropped before it could be followed by a
 * digit, and clearing the field snapped it back to a number.
 *
 * Unlike `Num` it reports while you type rather than on the way out. Blur
 * arrives after the click that caused it has already moved the selection, so a
 * deferred commit lands the number on whichever node was clicked next. */
export function NumList({
  value,
  onChange,
  min = 1,
  max = 24,
  maxItems = 12,
  placeholder,
}: {
  value: number[]
  onChange: (v: number[]) => void
  min?: number
  max?: number
  maxItems?: number
  placeholder?: string
}) {
  const joined = value.join(', ')
  const [text, setText] = useState(joined)
  const focused = useRef(false)
  /* What the document is known to hold, in the field's own formatting. A ref
     rather than the `value` prop so a keystroke can compare against the edit
     before it without waiting for the re-render that would carry it back. */
  const last = useRef(joined)
  useEffect(() => {
    last.current = joined
    if (!focused.current) setText(joined)
  }, [joined])

  const type = (raw: string) => {
    setText(raw)
    const list = raw
      .split(/[,\s]+/)
      .map((v) => parseInt(v, 10))
      .filter((v) => Number.isFinite(v))
      .map((v) => Math.min(max, Math.max(min, v)))
      .slice(0, maxItems)
    /* An empty or unreadable field reports nothing, so the document keeps what
       it had — clearing the field to retype is not a request for one layer.
       Reporting only on a real change also keeps the undo stack to one step per
       number instead of one per keystroke. */
    const next = list.join(', ')
    if (list.length && next !== last.current) {
      last.current = next
      onChange(list)
    }
  }
  /* Leaving shows what the document actually holds: the kept value if the field
     was left empty, the clamped one if a number was out of range. */
  const normalise = () => {
    focused.current = false
    setText(last.current)
  }
  return (
    <input
      type="text"
      className="af-input"
      value={text}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onBlur={normalise}
      onChange={(e) => type(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        e.stopPropagation()
      }}
    />
  )
}

/* ---------- segmented ---------- */

export function Seg<T extends string>({
  value,
  options,
  onChange,
  compact,
}: {
  value: T
  options: { key: T; label: string; title?: string }[]
  onChange: (v: T) => void
  compact?: boolean
}) {
  return (
    <span className={`af-seg${compact ? ' af-seg--compact' : ''}`}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          title={o.title ?? o.label}
          className={`af-seg__btn${value === o.key ? ' is-on' : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
}

/* ---------- select ---------- */

export function Sel<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { key: T; label: string; group?: string }[]
  onChange: (v: T) => void
}) {
  const groups = new Map<string, typeof options>()
  for (const o of options) {
    const g = o.group ?? ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(o)
  }
  return (
    <select
      className="af-select"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {[...groups.entries()].map(([g, items]) =>
        g ? (
          <optgroup key={g} label={g}>
            {items.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : (
          items.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))
        ),
      )}
    </select>
  )
}

/* ---------- checkbox ---------- */

export function Chk({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="af-chk">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/* ---------- colour ---------- */

const GRAYS = ['#000000', '#222222', '#4A4A4A', '#8C8C8C', '#BFBFBF', '#D9D9D9', '#EDEDED', '#ffffff']

export function ColorBtn({
  value,
  onChange,
  swatches,
  allowNone,
  title,
}: {
  value: string
  onChange: (v: string) => void
  swatches: string[]
  allowNone?: boolean
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <span className="af-color" ref={ref}>
      <button
        type="button"
        title={title ?? value}
        className={`af-color__btn${value === 'none' ? ' is-none' : ''}`}
        style={value === 'none' ? undefined : { background: value }}
        onClick={() => setOpen((o) => !o)}
      />
      {open ? (
        <div className="af-color__pop">
          <div className="af-color__rows">
            {[swatches, GRAYS].map((row, i) => (
              <div className="af-color__row" key={i}>
                {row.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    className={`af-color__chip${value.toLowerCase() === c.toLowerCase() ? ' is-on' : ''}`}
                    style={{ background: c }}
                    onClick={() => {
                      onChange(c)
                      setOpen(false)
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="af-color__foot">
            <input
              type="color"
              className="af-color__native"
              value={value === 'none' ? '#ffffff' : value}
              onChange={(e) => onChange(e.target.value)}
            />
            <input
              type="text"
              className="af-color__hex"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            {allowNone ? (
              <button type="button" className="af-color__none" onClick={() => { onChange('none'); setOpen(false) }}>
                없음
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </span>
  )
}

/* ---------- icon button ---------- */

export function IconBtn({
  onClick,
  title,
  children,
  active,
  disabled,
}: {
  onClick: () => void
  title: string
  children: ReactNode
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={`af-icon${active ? ' is-on' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
