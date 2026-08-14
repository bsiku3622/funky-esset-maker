/* Label placement and shape bounds — the measuring half of the renderer.
 *
 * Split out of shapes.tsx so the pure geometry can be imported by the editor,
 * the exporter and the hit layer without dragging a component module along. */

import type {
  CanvasCfg,
  CapBits,
  EdgeStyle,
  FigDoc,
  FigEdge,
  FigNode,
  NeuronBits,
  Rect,
  Style,
} from './types'
import { FONT_STACK } from './presets'
import { atLength, rotatePt, snapPos, snapSize } from './geometry'
import { layoutLabel, type LabelLayout } from './latex'
import {
  GROUP_CAP_GAP,
  hasCaps,
  isGroupKey,
  mlpCaps,
  mlpGroupOverflow,
  mlpLattice,
  mlpNaturalSize,
  mlpPartRect,
} from './mlp'
import type { ResolvedEdge } from './resolve'

export function labelFont(s: Style) {
  return {
    family: FONT_STACK[s.fontFamily],
    size: s.fontSize,
    weight: s.fontWeight,
    italic: s.italic,
    lineHeight: s.lineHeight,
    latex: s.fontFamily === 'latex',
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
      /* Centre what is drawn, not the line box around it. A formula's box is
         padded to the font's ascent and descent whatever the formula is, so
         centring the box leaves a fraction sitting low and a superscript
         sitting high — visible the moment the shape is large. `ink` is only
         set when the whole label is math, i.e. when the extent is known
         exactly; prose keeps the font baseline so sibling labels stay level. */
      y = layout.ink
        ? n.h / 2 - (layout.ink.top + layout.ink.bottom) / 2
        : n.h / 2 - layout.h / 2
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

/* ---------- connector labels ---------- */

/** Edge labels reuse the node label renderer, which wants a full node Style. */
export function edgeLabelStyle(s: EdgeStyle): Style {
  return {
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    dash: 'solid',
    opacity: 1,
    radius: 0,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: 400,
    italic: false,
    textColor: s.textColor,
    align: s.align ?? 'center',
    lineHeight: 1.2,
  }
}

/** Where an edge's label sits, in world coordinates. The editor puts a grab
 *  target here, so it has to be the *same* box the renderer draws from or the
 *  text and the thing you grab drift apart. */
export function edgeLabelBox(e: FigEdge, r: ResolvedEdge): Rect | null {
  if (!e.label || e.hidden) return null
  const style = edgeLabelStyle(e.style)
  const l = layoutLabel(e.label, labelFont(style))
  if (!l.w) return null
  const { p } = atLength(r.info, e.labelT)
  const x = p.x + e.labelDx
  const y = p.y + e.labelDy
  const left = style.align === 'left' ? x : style.align === 'right' ? x - l.w : x - l.w / 2
  return { x: left, y: y - l.h / 2, w: l.w, h: l.h }
}

/* ---------- text inside a neuron ---------- */

/* A neuron's inner label is measured here rather than in the renderer, because
 * the renderer is no longer the only thing that needs it: the in-place editor
 * wears this style so the field it opens draws the same text at the same size
 * as the circle it covers. */
/* ⚠️ The captions round a network are prose even when its own label is not.
 *
 * They annotate the drawing rather than name a quantity — "input", "no bias",
 * "Input Layer" — and in LaTeX mode "no bias" would be typeset as maths, where
 * spaces do not exist, and come out as `nobias` in italics. So they keep the
 * dollar convention: words are words, and `$\sigma$` is still one fence away.
 * Layer captions and group names share this, and so does the field you type
 * them into — asking twice is what keeps the two in step. */
export function mlpCapStyle(n: FigNode, size?: number): Style {
  const s = n.style
  return {
    ...s,
    align: 'center',
    fontFamily: s.fontFamily === 'latex' ? 'serif' : s.fontFamily,
    fontSize: size ?? s.fontSize,
    /* Their own ink: a network drawn in one accent still wants its annotations
       readable, and `none` — which is how a shape says "pick a colour that
       reads on the fill" — would leave a caption with no fill at all outside
       the circles. */
    textColor: n.props.capColor ?? (s.textColor === 'none' ? s.stroke : s.textColor),
  }
}

export function neuronLabelStyle(n: FigNode, r: number, bits?: NeuronBits): Style {
  return {
    ...n.style,
    // a unit may read its label its own way; absent, it reads the network's
    fontFamily: bits?.fontFamily ?? n.style.fontFamily,
    /* An inherited size is capped to the circle, because the network's size was
       chosen for its own label and would swamp a 32px circle. A size asked for
       *on this unit* is meant, so it is used as given — overflowing a circle is
       a thing figures do on purpose. */
    fontSize: bits?.fontSize ?? Math.min(n.style.fontSize, r * 1.5),
    fontWeight: bits?.fontWeight ?? n.style.fontWeight,
    italic: bits?.italic ?? n.style.italic,
    align: 'center',
  }
}

export interface NeuronLabel {
  layout: LabelLayout
  style: Style
  /** centre the block is drawn about, in the node's local frame */
  x: number
  /** baseline-block top, in the node's local frame */
  y: number
  /** true when the source is being shown because TeX would not take it */
  raw: boolean
}

/** Lay out what a neuron draws inside itself, or null when it draws nothing. */
export function neuronLabel(
  n: FigNode,
  dot: { x: number; y: number; r: number },
  bits?: NeuronBits,
): NeuronLabel | null {
  const text = bits?.label ?? ''
  if (!text) return null
  const style = neuronLabelStyle(n, dot.r, bits)
  /* Half-typed maths is rejected maths — `\sig` on the way to `\sigma` — and
     layoutLabel answers a rejection with the source itself, so a circle being
     typed into shows what was typed rather than going blank or red. */
  const layout = layoutLabel(text, labelFont(style))
  const raw = layout.error
  if (!layout.lines.length) return null
  const y = layout.ink
    ? dot.y - (layout.ink.top + layout.ink.bottom) / 2
    : dot.y - layout.h / 2
  // the nudge rides on top of the centring, so clearing it re-centres exactly
  return { layout, style, x: dot.x + (bits?.dx ?? 0), y: y + (bits?.dy ?? 0), raw }
}

/* ---------- the text around a network ---------- */

export interface MlpText {
  /** `g0` for a group's name, `cap:t:2` / `cap:b:2` for a layer caption */
  key: string
  text: string
  layout: LabelLayout
  style: Style
  color: string
  /** centre of the block and its top, in the node's local frame */
  x: number
  y: number
  /** the block's box, for hit-testing and for placing a field over it */
  rect: Rect
  /** true once it has been dragged off its default spot */
  moved: boolean
}

/* Every caption a network draws, measured — the layer captions and the group
 * names, in one list.
 *
 * ⚠️ The renderer draws from this and the editor picks from it, which is the
 * only way the two can agree about where a caption *is*. They did not: the hit
 * test guessed the box from the group's width, and a name wider than the column
 * it sits over — "Input Layer" above a single column of circles — could only be
 * double-clicked in the middle. Both ends of the word missed. */
/* What one caption has been told about itself.
 *
 * ⚠️ `capOffsets` is the old name of this bag, from when it held only
 * positions. Documents saved with it are still out there, so it is read as a
 * fallback rather than migrated — a load that rewrote the file would make the
 * old version unreadable in the other direction. */
export function capBits(n: FigNode, key: string): CapBits {
  const now = n.props.caps?.[key]
  if (now) return now
  const was = n.props.capOffsets?.[key]
  return was ? { dx: was.dx, dy: was.dy } : {}
}

export function mlpTextBoxes(n: FigNode): MlpText[] {
  if (n.kind !== 'mlp') return []
  const out: MlpText[] = []
  const put = (key: string, base: string, baseStyle: Style, x0: number, top: number, above: boolean) => {
    const text = base
    /* Each caption may say its own colour, size and font — a "no bias" note is
       not the same voice as a layer's name, and one shared ink for the whole
       row could not tell them apart. */
    const off = capBits(n, key)
    const style: Style = {
      ...baseStyle,
      fontSize: off.fontSize ?? baseStyle.fontSize,
      fontFamily: off.fontFamily ?? baseStyle.fontFamily,
      textColor: off.textColor ?? baseStyle.textColor,
    }
    const layout = layoutLabel(text, labelFont(style))
    if (!layout.lines.length) return
    // the nudge rides on top of the default placement, so clearing it re-homes
    const x = x0 + (off.dx ?? 0)
    const y = (above ? top - layout.h : top) + (off.dy ?? 0)
    out.push({
      key,
      text,
      layout,
      style,
      color: style.textColor,
      x,
      y,
      rect: { x: x - layout.w / 2, y, w: layout.w, h: layout.h },
      moved: !!(off.dx || off.dy),
    })
  }
  const lat = mlpLattice(n)
  if (hasCaps(n.props)) {
    const style = mlpCapStyle(n)
    for (const c of lat.cols) {
      const { top, bottom } = mlpCaps(n.props, c.li)
      if (top) put(capKey('t', c.li), top, style, c.x, c.top - MLP_CAP_GAP, true)
      if (bottom) put(capKey('b', c.li), bottom, style, c.x, c.bottom + MLP_CAP_GAP, false)
    }
  }
  for (const [key, g] of Object.entries(n.props.groups ?? {})) {
    if (!g.label) continue
    const r = mlpPartRect(n, key)
    if (!r) continue
    const style = mlpCapStyle(n, g.fontSize)
    put(key, g.label, { ...style, textColor: g.textColor ?? style.textColor }, r.x + r.w / 2, r.y - GROUP_CAP_GAP, true)
    /* ⚠️ A group over a whole column wants the same air as that column's own
       caption, and both were drawn there — one on top of the other, so the
       words overlapped and a double-click could only ever reach whichever came
       first in the list. Lift the newcomer clear of anything already placed. */
    const mine = out[out.length - 1]
    if (mine?.key !== key || mine.moved) continue
    for (const other of out) {
      if (other === mine) continue
      const overlaps =
        mine.rect.x < other.rect.x + other.rect.w &&
        other.rect.x < mine.rect.x + mine.rect.w &&
        mine.rect.y < other.rect.y + other.rect.h &&
        other.rect.y < mine.rect.y + mine.rect.h
      if (!overlaps) continue
      const lift = mine.rect.y + mine.rect.h - other.rect.y + GROUP_CAP_GAP
      mine.y -= lift
      mine.rect = { ...mine.rect, y: mine.rect.y - lift }
    }
  }
  return out
}

/** How far a layer caption floats off the column it labels. */
export const MLP_CAP_GAP = 5

const CAP_RE = /^cap:([tb]):(\d+)$/
/** Is this the key of a layer caption? — `cap:t:2` is the top one on layer 2. */
export const isCapKey = (k: string) => CAP_RE.test(k)
export const capKey = (which: 't' | 'b', li: number) => `cap:${which}:${li}`
export const readCapKey = (k: string) => {
  const m = CAP_RE.exec(k)
  return m ? { which: m[1] === 't' ? ('capTop' as const) : ('capBottom' as const), li: +m[2] } : null
}

/* Where a caption *would* be drawn if it had anything in it.
 *
 * Only the empty case needs this — a caption with text is in `mlpTextBoxes`.
 * It matters while one is being typed into: clear the field and the caption
 * stops existing, and without somewhere to stand the field would jump away
 * mid-edit and take the caret with it. */
export function mlpCapSpot(n: FigNode, key: string): { x: number; y: number } | null {
  const style = mlpCapStyle(n)
  const h = style.fontSize * style.lineHeight
  if (isGroupKey(key)) {
    const r = mlpPartRect(n, key)
    return r ? { x: r.x + r.w / 2, y: r.y - GROUP_CAP_GAP - h } : null
  }
  const at = readCapKey(key)
  if (!at) return null
  const col = mlpLattice(n).cols.find((c) => c.li === at.li)
  if (!col) return null
  return at.which === 'capTop'
    ? { x: col.x, y: col.top - MLP_CAP_GAP - h }
    : { x: col.x, y: col.bottom + MLP_CAP_GAP }
}

/** What a caption currently says. */
export function mlpCapText(n: FigNode, key: string): string {
  if (isGroupKey(key)) return n.props.groups?.[key]?.label ?? ''
  const at = readCapKey(key)
  return at ? (n.props[at.which]?.[at.li] ?? '') : ''
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
  // a formula's real extent when we have it, so an auto-fitting box hugs it
  const ink = p.layout.ink
  return ink
    ? { x: left, y: p.y + ink.top, w: p.layout.w, h: ink.bottom - ink.top }
    : { x: left, y: p.y, w: p.layout.w, h: p.layout.h }
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

/* Put a node on the grid: a whole number of cells across, on the half-cell
 * position lattice, without wandering off from where it already is.
 *
 * Whole cells is the part that matters. A box 3.4 cells wide can put neither
 * its edges nor its centre on the lattice, so every rule for placing it looks
 * arbitrary — the ambiguity is a property of the *size*, and this is where it
 * gets fixed. */
export function fitNodeToGrid(n: FigNode, grid: number): Partial<FigNode> {
  // an op is a circle: one measurement, or it stops being one
  const w = autoFits(n) ? n.w : n.kind === 'op' ? snapSize(Math.min(n.w, n.h), grid) : snapSize(n.w, grid)
  const h = autoFits(n) ? n.h : n.kind === 'op' ? w : snapSize(n.h, grid)
  return {
    x: Math.round(snapPos(n.x + (n.w - w) / 2, grid)),
    y: Math.round(snapPos(n.y + (n.h - h) / 2, grid)),
    w,
    h,
  }
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
  if (n.kind === 'frame' && n.props.title) {
    // the title sits above the top edge, so it is part of what the frame paints
    return { l: 0, t: n.style.fontSize * 1.15, r: 0, b: 0 }
  }
  if (n.kind === 'stack') {
    const c = Math.max(1, n.props.count ?? 3) - 1
    const o = n.props.offset ?? 5
    return { l: 0, t: c * o, r: c * o, b: 0 }
  }
  if (n.kind === 'mlp') {
    /* Captions sit outside the lattice, so they are part of what the node
       paints — and therefore of what you can click, what the selection outline
       has to contain and what the export frame has to hold. Group boxes hang
       outside it too, by their padding.

       ⚠️ Measured, not estimated. A caption is as wide as its words, and a name
       like "Input Layer" over one narrow column reaches well past both sides of
       the network — an estimate that only counted its *height* left the ends of
       it outside every box that was supposed to contain it, so they could not
       be clicked and were cropped out of a trimmed export. */
    const g = n.props.groups ? mlpGroupOverflow(n) : { l: 0, t: 0, r: 0, b: 0 }
    const out = { ...g }
    if (hasCaps(n.props) || n.props.groups)
      for (const t of mlpTextBoxes(n)) {
        out.l = Math.max(out.l, -t.rect.x)
        out.t = Math.max(out.t, -t.rect.y)
        out.r = Math.max(out.r, t.rect.x + t.rect.w - n.w)
        out.b = Math.max(out.b, t.rect.y + t.rect.h - n.h)
      }
    return {
      l: Math.max(0, out.l),
      t: Math.max(0, out.t),
      r: Math.max(0, out.r),
      b: Math.max(0, out.b),
    }
  }
  return { l: 0, t: 0, r: 0, b: 0 }
}

/* Keep a lattice-mode MLP's box equal to what its circles actually span.
 *
 * In lattice mode the drawing is the input and the box is the output, so the
 * two can only disagree by being out of date. Running this on every change is
 * what makes "the positions are forced" true rather than aspirational: there is
 * no state in which the box has been stretched and the lattice has not. */
export function refitMlp(doc: FigDoc): FigDoc {
  let changed = false
  const nodes = doc.nodes.map((n) => {
    if (n.kind !== 'mlp') return n
    const size = mlpNaturalSize(n.props)
    if (!size || (size.w === n.w && size.h === n.h)) return n
    changed = true
    // grow about the centre, so nudging the pitch does not walk the node away
    return { ...n, x: n.x + (n.w - size.w) / 2, y: n.y + (n.h - size.h) / 2, ...size }
  })
  return changed ? { ...doc, nodes } : doc
}
