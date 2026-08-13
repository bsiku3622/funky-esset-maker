/* In-place LaTeX editing for a label.
 *
 * The point is that editing and the finished figure look like the same thing:
 * a label in LaTeX mode is a formula on the canvas, so editing it shows a
 * formula too, not the source that produced it. The source is still one glance
 * away — the right panel's text box is always the raw string.
 *
 * MathLive ships `<math-field>` as a custom element. It is built here with
 * `new MathfieldElement()` rather than written as JSX, because the JSX route
 * means widening React's `IntrinsicElements`, which is a program-wide change
 * declared from whichever file happens to need it first. */

import { useEffect, useRef } from 'react'
import { MathfieldElement } from 'mathlive'

/* Vite does not serve MathLive's fonts out of node_modules, so they come from
 * the CDN — the same pin Cartesian Plotter uses. */
MathfieldElement.fontsDirectory = 'https://cdn.jsdelivr.net/npm/mathlive@0.110.0/fonts/'
MathfieldElement.soundsDirectory = null

interface Props {
  value: string
  /** px, already multiplied by the zoom — the formula tracks the canvas */
  fontSize: number
  style: React.CSSProperties
  onChange: (v: string) => void
  /** editing has begun — the caller opens its undo transaction here */
  onStart: () => void
  /** editing is over: blur, Escape or Enter */
  onDone: () => void
}

export default function MathInput({ value, fontSize, style, onChange, onStart, onDone }: Props) {
  const host = useRef<HTMLDivElement>(null)
  /* The element is created once and lives outside React's render, so the
     handlers it captures have to be read through a ref or they freeze at their
     first values. */
  const cb = useRef({ onChange, onStart, onDone })
  const seed = useRef(value)
  const field = useRef<MathfieldElement | null>(null)
  // declared before the mount effect so it has run by the time that one fires
  useEffect(() => {
    cb.current = { onChange, onStart, onDone }
  })

  useEffect(() => {
    const h = host.current
    if (!h) return
    const el = new MathfieldElement()
    field.current = el
    el.className = 'af-mathedit__field'
    /* ⚠️ Into the DOM first. A mathfield refuses to take `menuItems` before it
       has connected — the setter throws "Mathfield not mounted" and the whole
       component goes down with it. */
    h.appendChild(el)
    // no popup menu and no on-screen keyboard: this is an overlay on a canvas,
    // and either one would cover the figure it is being typed into
    el.menuItems = []
    el.mathVirtualKeyboardPolicy = 'manual'
    el.value = seed.current
    el.addEventListener('input', () => cb.current.onChange(el.value))
    el.addEventListener('blur', () => cb.current.onDone())
    el.addEventListener('keydown', (ev: KeyboardEvent) => {
      /* The editor listens for single keys on window — r, e, t and friends make
         shapes. Every keystroke here is text, so none of them may escape. */
      ev.stopPropagation()
      if (ev.key === 'Escape' || (ev.key === 'Enter' && !ev.shiftKey)) {
        ev.preventDefault()
        el.blur()
      }
    })
    cb.current.onStart()
    el.focus()
    // put the caret at the end rather than selecting the lot, so typing adds to
    // an existing formula instead of replacing it
    el.executeCommand('moveToMathfieldEnd')
    return () => {
      field.current = null
      el.remove()
    }
  }, [])

  /* An edit from the right panel has to land here too — the two boxes are two
     views of one string. Writing back what MathLive already holds would reset
     the caret mid-typing, so only a genuine difference is pushed. */
  useEffect(() => {
    const el = field.current
    if (el && el.value !== value) el.value = value
  }, [value])

  useEffect(() => {
    if (field.current) field.current.style.fontSize = `${fontSize}px`
  }, [fontSize])

  return <div ref={host} className="af-mathedit" style={style} />
}
