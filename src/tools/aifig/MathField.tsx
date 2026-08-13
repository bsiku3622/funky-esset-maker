/* LaTeX editing, in place and without a frame.
 *
 * MathLive draws the formula and puts a caret and a selection *inside* it, so
 * `\frac{a}{b}` can be moved through as a fraction rather than as eleven
 * characters. That is the one thing a plain field cannot do here, because in
 * this mode the source and the drawing are different pictures.
 *
 * ⚠️ Every frame is stripped — no background, no border, no shadow. It used to
 * have all three, and the box was the whole complaint: an editor that covers
 * the figure is not editing in place, it is a dialog standing on top of it.
 * If you add a background here, you have put the dialog back.
 *
 * The remaining seam is that MathLive typesets with its own fonts and the
 * figure with MathJax's, so a formula shifts very slightly at the moment
 * editing starts and ends. Nothing can close that except rendering the figure
 * with MathLive too, which would cost the SVG export its real glyph paths. */

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
  color: string
  style: React.CSSProperties
  onChange: (v: string) => void
  /** editing has begun — the caller opens its undo transaction here */
  onStart: () => void
  /** editing is over: blur, Escape or Enter */
  onDone: () => void
  /** Tab, when the caller has somewhere to send it */
  onTab?: (shift: boolean) => void
}

export default function MathField({
  value,
  fontSize,
  color,
  style,
  onChange,
  onStart,
  onDone,
  onTab,
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  /* The element is created once and lives outside React's render, so the
     handlers it captures have to be read through a ref or they freeze at their
     first values. */
  const cb = useRef({ onChange, onStart, onDone, onTab })
  const seed = useRef(value)
  const field = useRef<MathfieldElement | null>(null)
  // declared before the mount effect so it has run by the time that one fires
  useEffect(() => {
    cb.current = { onChange, onStart, onDone, onTab }
  })

  useEffect(() => {
    const h = host.current
    if (!h) return
    const el = new MathfieldElement()
    field.current = el
    el.className = 'af-mathfield'
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
      if (ev.key === 'Tab' && cb.current.onTab) {
        ev.preventDefault()
        cb.current.onTab(ev.shiftKey)
        return
      }
      if (ev.key === 'Escape' || (ev.key === 'Enter' && !ev.shiftKey)) {
        ev.preventDefault()
        el.blur()
      }
    })
    cb.current.onStart()
    el.focus()
    // caret after the formula, so typing extends it rather than preceding it
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
    const el = field.current
    if (!el) return
    el.style.fontSize = `${fontSize}px`
    el.style.color = color
  }, [fontSize, color])

  return <div ref={host} className="af-mathhost" style={style} />
}
