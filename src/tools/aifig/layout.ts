/* Label placement and shape bounds — the measuring half of the renderer.
 *
 * Split out of shapes.tsx so the pure geometry can be imported by the editor,
 * the exporter and the hit layer without dragging a component module along. */

import type { CanvasCfg, FigNode, Style } from './types'
import { FONT_STACK } from './presets'
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
  const maxW = inside ? Math.max(24, n.w - 10) : Math.max(60, n.w * 2)
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
