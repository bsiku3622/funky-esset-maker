/* Editing a label where it is drawn.
 *
 * The technique is the one Excalidraw and tldraw use, and the reason it is
 * worth copying is what it does *not* require: a real field with the same font,
 * the same size and the same colour is laid over the drawing with a
 * transparent background and no border, and the browser draws the glyphs. That
 * hands back the caret, the selection, select-all, drag-select, IME
 * composition, spellcheck and screen-reader support — every one of which has to
 * be built by hand if the app draws the text and hides the field, which is the
 * route Google Docs and CodeMirror 5 take because they have documents this
 * would not scale to. A label on a shape is not that.
 *
 * ⚠️ Two things have to stay true or it stops being in-place editing:
 *   · the figure must not draw the same text (see BodyProps.editing), or the
 *     two renderings sit a pixel apart and the label looks doubled;
 *   · nothing here may have a background, a border or a shadow.
 *
 * LaTeX mode cannot use it at all, because there the source and the drawing are
 * different pictures — `\sigma` against σ. That goes to MathLive, which owns a
 * caret and a selection over the *rendered* formula. It is ~800 kB, so it
 * arrives on first use, the same bargain latex.ts strikes with MathJax. */

import { Suspense, lazy } from 'react'
import type { Style } from './types'
import { FONT_STACK } from './presets'

const MathField = lazy(() => import('./MathField'))

export interface EditorBox {
  left: number
  top: number
  width: number
  height: number
  /** degrees, about the centre the caller nominates */
  rotation?: number
  origin?: string
}

interface Props {
  value: string
  /** the style the text is drawn in — the field copies it so it matches */
  text: Style
  /** what the drawn text is coloured, once 'none' has been resolved */
  color: string
  zoom: number
  box: EditorBox
  /** false for a neuron, whose circle holds one line */
  multiline: boolean
  onChange: (v: string) => void
  onStart: () => void
  onDone: () => void
  onTab?: (shift: boolean) => void
}

export default function LabelEditor({
  value,
  text,
  color,
  zoom,
  box,
  multiline,
  onChange,
  onStart,
  onDone,
  onTab,
}: Props) {
  const place: React.CSSProperties = {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
    transformOrigin: box.origin,
  }

  if (text.fontFamily === 'latex')
    return (
      // nothing to show for the frame or two the editor takes to arrive
      <Suspense fallback={null}>
        <MathField
          value={value}
          fontSize={Math.max(9, text.fontSize * zoom)}
          color={color}
          style={place}
          onChange={onChange}
          onStart={onStart}
          onDone={onDone}
          onTab={onTab}
        />
      </Suspense>
    )

  const Tag = multiline ? 'textarea' : 'input'
  return (
    <Tag
      className="af-textedit"
      autoFocus
      value={value}
      style={{
        ...place,
        // everything the drawing does with this text, done again in CSS
        color,
        fontFamily: FONT_STACK[text.fontFamily],
        fontSize: text.fontSize * zoom,
        fontWeight: text.fontWeight,
        fontStyle: text.italic ? 'italic' : undefined,
        lineHeight: text.lineHeight,
        textAlign: text.align,
      }}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onFocus={(e) => {
        onStart()
        // caret after the text, so typing extends the label rather than
        // landing in front of it
        const el = e.currentTarget
        el.setSelectionRange(el.value.length, el.value.length)
      }}
      onKeyDown={(e) => {
        /* The editor listens for single keys on window — r, e, t and friends
           make shapes. Every keystroke here is text. */
        e.stopPropagation()
        if (e.key === 'Tab' && onTab) {
          e.preventDefault()
          onTab(e.shiftKey)
          return
        }
        // Enter breaks the line in a block label; ⌘Enter finishes either way
        const finish = multiline ? e.metaKey || e.ctrlKey : true
        if (e.key === 'Escape' || (e.key === 'Enter' && finish)) {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  )
}
