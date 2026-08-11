/* Small form primitives shared by the toolbar and the inspector.
 *
 * They are deliberately dumb (value + onChange) so every panel stays a pure
 * function of the document — the editor never keeps a second copy of a field's
 * state that could go stale after an undo. */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

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
  /* The popover is portalled out of the inspector.
   *
   * It used to be `position: absolute` inside the swatch, and the inspector
   * body scrolls — an overflow container clips absolutely positioned children
   * on *every* side, not just the scrolling one, so a swatch near the panel's
   * left edge had the left half of its popover cut off. It goes to the tool
   * root instead, which has no overflow of its own; keeping it inside
   * `.femtool` rather than on `<body>` is what preserves the scoped CSS.
   *
   * The host element doubles as the open flag, so it can be resolved in the
   * click that opens the popover rather than read off a ref during render. */
  const [host, setHost] = useState<Element | null>(null)
  const open = host !== null
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  /* Stale between openings, which never shows: the layout effect below
     repositions before the browser paints the reopened popover. */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const b = btn.current?.getBoundingClientRect()
      if (!b) return
      const p = pop.current?.getBoundingClientRect()
      const w = p?.width ?? 0
      const h = p?.height ?? 0
      const M = 8 // keep clear of the viewport edge
      const left = Math.min(
        Math.max(M, b.right - w),
        Math.max(M, window.innerWidth - w - M),
      )
      const below = b.bottom + 4
      const top = below + h > window.innerHeight - M ? Math.max(M, b.top - h - 4) : below
      setPos({ left, top })
    }
    place()
    // `true` so an ancestor scrolling — the inspector body — moves it too
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      // the popover is no longer a descendant of the button, so both count
      if (btn.current?.contains(t) || pop.current?.contains(t)) return
      setHost(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHost(null)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className="af-color">
      <button
        ref={btn}
        type="button"
        title={title ?? value}
        className={`af-color__btn${value === 'none' ? ' is-none' : ''}`}
        style={value === 'none' ? undefined : { background: value }}
        onClick={(e) => {
          // resolve the host here, not inside the updater: React re-runs the
          // updater during render, by which point `currentTarget` is null
          const root = e.currentTarget.closest('.femtool') ?? document.body
          setHost((h) => (h ? null : root))
        }}
      />
      {open && host
        ? createPortal(
        <div
          className="af-color__pop"
          ref={pop}
          style={{
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            // measured before paint, but stay invisible for the frame before
            // that in case a layout effect ever lands late
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
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
                      setHost(null)
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
              <button type="button" className="af-color__none" onClick={() => { onChange('none'); setHost(null) }}>
                없음
              </button>
            ) : null}
          </div>
        </div>,
            host,
          )
        : null}
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
