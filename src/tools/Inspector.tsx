/* The property panel, shared by the tools that let you click a thing in the
 * figure and edit it.
 *
 * AI Figure Maker had the only one of these, and it was the reason that tool
 * felt finished: a figure has properties, and typing them into a text grammar
 * is fine for creating but miserable for adjusting. The panel is deliberately
 * dumb — it renders whatever rows a tool gives it — because the tools disagree
 * about what a "thing" is (a bar, an interval, a curve) and only agree about
 * how editing one should look.
 *
 * It stays in the funky look even in paper mode: this is app chrome, not part
 * of the figure. */

import type { ReactNode } from 'react'
import './Inspector.css'

export interface InspectorProps {
  /** what is selected, e.g. "막대 3" */
  title: string
  /** one line under the title — usually the value being edited */
  hint?: string
  onClose?: () => void
  children: ReactNode
}

export default function Inspector({ title, hint, onClose, children }: InspectorProps) {
  return (
    <aside className="fx-insp" aria-label="속성">
      <header className="fx-insp__head">
        <div className="fx-insp__titles">
          <span className="fx-insp__title">{title}</span>
          {hint && <span className="fx-insp__hint">{hint}</span>}
        </div>
        {onClose && (
          <button
            type="button"
            className="fx-insp__close"
            onClick={onClose}
            title="선택 해제"
            aria-label="선택 해제"
          >
            ✕
          </button>
        )}
      </header>
      <div className="fx-insp__body">{children}</div>
    </aside>
  )
}

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="fx-insp__group">
      <h3 className="fx-insp__grouplabel">{label}</h3>
      {children}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="fx-insp__field">
      <span className="fx-insp__fieldlabel">{label}</span>
      <span className="fx-insp__control">{children}</span>
    </label>
  )
}

/** Same row shape as Field, for controls that are not a single input and so
 *  must not sit inside a <label>. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fx-insp__field">
      <span className="fx-insp__fieldlabel">{label}</span>
      <span className="fx-insp__control">{children}</span>
    </div>
  )
}

export function Swatches({
  colors,
  value,
  onChange,
}: {
  colors: string[]
  value: string
  onChange: (hex: string) => void
}) {
  return (
    <span className="fx-insp__swatches">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          aria-label={c}
          aria-pressed={value.toLowerCase() === c.toLowerCase()}
          className={`fx-insp__swatch${
            value.toLowerCase() === c.toLowerCase() ? ' is-on' : ''
          }`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </span>
  )
}

/** Shown in place of the panel when nothing is selected — the tools that have
 *  an inspector should say so even while it is empty, or clicking the figure
 *  looks like it does nothing. */
export function InspectorTip({ children }: { children: ReactNode }) {
  return <p className="fx-insp-tip">{children}</p>
}
