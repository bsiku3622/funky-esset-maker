/* Label placement and shape bounds — the measuring half of the renderer.
 *
 * Split out of shapes.tsx so the pure geometry can be imported by the editor,
 * the exporter and the hit layer without dragging a component module along. */

import type { CanvasCfg, FigDoc, FigNode, Rect, Style } from './types'
import { FONT_STACK } from './presets'
import { rotatePt } from './geometry'
import { layoutLabel, type LabelLayout } from './latex'

export function labelFont(s: Style) {
  return {
    family: FONT_STACK[s.fontFamily],
    size: s.fontSize,
    weight: s.fontWeight,
    italic: s.italic,
    lineHeight: s.lineHeight,
  }
}

/** px → printed points, given the canvas' intended physical width. */
export const ptOf = (px: number, c: CanvasCfg) => (px * c.printWidthIn * 72) / c.w

const PAD = 6 // gap between a shape and an outside label

export interface PlacedLabel {
  layout: LabelLayout
  x: number
  y: number
}

/** Where a node's label block sits, in the node's local frame (origin = the
 *  node's top-left). Returns null for an empty label. */
export function placeLabel(n: FigNode): PlacedLabel | null {
  if (!n.label) return null
  const s = n.style
  const inside =
    n.labelPos === 'center' || n.labelPos === 'inside-top' || n.labelPos === 'inside-bottom'
  /* An auto-fitting text node takes its width *from* the text, so wrapping it
     to that width would be circular — the box would ratchet narrower on every
     pass. Only an explicit \n breaks the line there. */
  const maxW = autoFits(n) ? Infinity : inside ? Math.max(24, n.w - 10) : Math.max(60, n.w * 2)
  const layout = layoutLabel(n.label, labelFont(s), maxW)
  if (!layout.lines.length) return null

  const cx = n.w / 2
  let x = cx
  let y = 0
  switch (n.labelPos) {
    case 'center':
      y = n.h / 2 - layout.h / 2
      break
    case 'inside-top':
      y = PAD
      break
    case 'inside-bottom':
      y = n.h - layout.h - PAD
      break
    case 'top':
      y = -layout.h - PAD
      break
    case 'bottom':
      y = n.h + PAD
      break
    case 'left':
      return { layout, x: -PAD, y: n.h / 2 - layout.h / 2 }
    case 'right':
      return { layout, x: n.w + PAD, y: n.h / 2 - layout.h / 2 }
  }
  if (s.align === 'left') x = inside ? 6 : cx - layout.w / 2
  else if (s.align === 'right') x = inside ? n.w - 6 : cx + layout.w / 2
  return { layout, x, y }
}

/** Side labels always face outward, regardless of the style alignment. */
export function labelStyle(n: FigNode): Style {
  if (n.labelPos === 'left') return { ...n.style, align: 'right' }
  if (n.labelPos === 'right') return { ...n.style, align: 'left' }
  return n.style
}

/* ---------- ink bounds ---------- */

/** Text nodes that size themselves to their glyphs. Absent on nodes from an
 *  older file, so those keep the fixed box they were saved with. */
export const autoFits = (n: FigNode) => n.kind === 'text' && n.props.autoFit === true

/** The box a node's label occupies, in the node's local frame. */
function labelRect(n: FigNode): Rect | null {
  const p = placeLabel(n)
  if (!p || !p.layout.w) return null
  const align = labelStyle(n).align
  const left = align === 'center' ? p.x - p.layout.w / 2 : align === 'right' ? p.x - p.layout.w : p.x
  return { x: left, y: p.y, w: p.layout.w, h: p.layout.h }
}

/* What a node actually paints, in world coordinates.
 *
 * Two kinds have never matched their box. An `op` inscribes its circle in the
 * *shorter* axis, so a box that is not square holds dead space on the long one;
 * a text node is a fixed rectangle with the glyphs floated inside it. Aligning
 * either by the node box lines up something invisible — which is exactly what
 * made snapping feel like it had a mind of its own. Alignment reads this; the
 * handles still drive the box, because the box is what you resize. */
export function inkRect(n: FigNode): Rect {
  const r = localInk(n)
  if (!n.rotation) return r
  const c = { x: n.x + n.w / 2, y: n.y + n.h / 2 }
  const pts = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ].map((p) => rotatePt(p, c, n.rotation))
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }
}

function localInk(n: FigNode): Rect {
  const box = { x: n.x, y: n.y, w: n.w, h: n.h }
  if (n.kind === 'op') {
    const d = Math.min(n.w, n.h)
    return { x: n.x + (n.w - d) / 2, y: n.y + (n.h - d) / 2, w: d, h: d }
  }
  if (n.kind === 'text') {
    const r = labelRect(n)
    // an empty text node paints nothing; its box is all there is to grab
    return r ? { x: n.x + r.x, y: n.y + r.y, w: r.w, h: r.h } : box
  }
  const o = shapeOverflow(n)
  return { x: n.x - o.l, y: n.y - o.t, w: n.w + o.l + o.r, h: n.h + o.t + o.b }
}

/** Resize auto-fitting text nodes to their glyphs, keeping the anchor the
 *  alignment implies so the text does not crawl as you type. Returns the same
 *  document object when nothing moved, so callers can treat it as a no-op. */
export function refitText(doc: FigDoc): FigDoc {
  let changed = false
  const nodes = doc.nodes.map((n) => {
    if (!autoFits(n)) return n
    const r = labelRect(n)
    const w = Math.max(8, Math.round(r?.w ?? 8))
    const h = Math.max(8, Math.round(r?.h ?? 8))
    if (w === n.w && h === n.h) return n
    const align = labelStyle(n).align
    // keep the edge the text grows away from: centred text grows both ways
    const x = Math.round(
      align === 'center' ? n.x + (n.w - w) / 2 : align === 'right' ? n.x + n.w - w : n.x,
    )
    const y = Math.round(n.y + (n.h - h) / 2)
    changed = true
    return { ...n, x, y, w, h }
  })
  return changed ? { ...doc, nodes } : doc
}

/** Isometric offset vector for a cuboid's depth. */
export function isoOff(n: FigNode) {
  const d = n.props.depth ?? 24
  const a = ((n.props.skew ?? 32) * Math.PI) / 180
  return { dx: d * Math.cos(a), dy: -d * Math.sin(a) }
}

/** How far a shape paints outside its w/h box (cuboids and stacks lean out).
 *  Drives the click target and the selection outline. */
export function shapeOverflow(n: FigNode): { l: number; t: number; r: number; b: number } {
  if (n.kind === 'cuboid') {
    const { dx, dy } = isoOff(n)
    return { l: 0, t: -dy, r: dx, b: 0 }
  }
  if (n.kind === 'stack') {
    const c = Math.max(1, n.props.count ?? 3) - 1
    const o = n.props.offset ?? 5
    return { l: 0, t: c * o, r: c * o, b: 0 }
  }
  return { l: 0, t: 0, r: 0, b: 0 }
}
