/* The MLP lattice — where every circle, wire and caption of a network glyph is.
 *
 * One function answers that, and everything else reads it: the renderer draws
 * from it, the hit layer picks from it, and an edge that lands on a single
 * neuron resolves through it. A second opinion about where a neuron is would
 * show up immediately as a connector attached to thin air.
 *
 * Two placement modes, and the difference is the whole point of the rewrite:
 *
 *   stretch   Columns are spread to fill the box, so a column of three and a
 *             column of five end up with different spacing. This is what the
 *             shape always did, and files written before this module keep it —
 *             their figures must not move.
 *   lattice   One `pitch` down every column and one `layerGap` across, each
 *             column centred. Equal spacing, and the box follows the lattice
 *             instead of the other way round.
 *
 * ⚠️ Lattice mode is what makes neurons land on the grid, and it does so by
 * arithmetic rather than by rounding each circle into place. Everything is
 * measured from the node's centre: a column of `s` slots puts its dots at
 * `cy + (k - (s-1)/2) * pitch`, so the offsets are whole multiples of `pitch`
 * for odd `s` and of `pitch/2` for even `s`. Since the editor's position
 * lattice is the half-cell, keeping
 *
 *     r        a multiple of grid/2
 *     pitch    a multiple of grid
 *     layerGap a multiple of grid  (and every entry of `gaps`, if uneven)
 *
 * puts every centre on it, in every column, at once — the columns are placed by
 * a running total of the gaps, so whole-cell steps keep every prefix on the
 * lattice and the centred run on the half-cell. See `mlpSnapProps`, and
 * `mlp.test.ts` for the proof. Rounding the circles individually instead would
 * have broken the equal spacing that requirement asked for in the first place. */

import type { Anchor, FigNode, NeuronGroup, NodeProps, Pt, Rect } from './types'
import { distToSeg, rectCenter, rotateDir, rotatePt, type AnchorPoint } from './geometry'

/* ---------- defaults ---------- */

/* ⚠️ These three are interlocked: `mlpSnapProps` will not let a spacing fall
 * below `2 * r`, so raising the radius without raising the spacings just gets
 * them clamped back up and the defaults stop describing what you actually get.
 * A circle of r 16 is 32 across, which is why the pitch starts at 40. */
export const MLP_R = 16
export const MLP_PITCH = 48
export const MLP_GAP = 56
/** Drawn circles per column before the rest collapse into a ⋮. */
export const MLP_MAX_DOTS = 4
/** Hard ceiling on drawn circles, ellipsis or not — the old shape's clamp. */
export const MLP_SLOT_CAP = 24
export const MLP_MAX_LAYERS = 12
/** A column may *stand for* far more units than it draws. */
export const MLP_MAX_UNITS = 4096

/* A network worth drawing rather than the smallest one that fits: real figures
 * have wide hidden layers, and the point of the ellipsis is that a 64-unit layer
 * costs the same four circles as a 4-unit one. Starting here shows both at once. */
export const MLP_DEFAULT_LAYERS = [4, 64, 64, 64, 1]

/* ---------- keys ---------- */

/* Parts are addressed by *logical* index, not by drawn slot. A neuron keeps its
 * key when the column grows, when the ellipsis threshold moves, and when the
 * layer above it changes size — so the colour you gave it, and the connector
 * you attached to it, stay where you put them. */
export const dotKey = (li: number, n: number) => `l${li}n${n}`
export const wireKey = (li: number, a: number, b: number) => `l${li}n${a}-n${b}`
export const gapKey = (li: number) => `l${li}gap`

/* Group keys share the part namespace with neurons and synapses, so they are
 * spelled so they cannot be mistaken for either: `g0` matches neither `l0n2`
 * nor `l0n2-n1`. An endpoint stores one exactly the way it stores a unit. */
export const groupKey = (i: number) => `g${i}`
export const isGroupKey = (k: string) => /^g\d+$/.test(k)

/** The next unused group key, so removing one does not strand the numbering. */
export function freshGroupKey(p: NodeProps): string {
  const used = new Set(Object.keys(p.groups ?? {}))
  for (let i = 0; ; i++) if (!used.has(groupKey(i))) return groupKey(i)
}

const KEY_RE = /^l(\d+)n(\d+)$/
/** Read a neuron key back, or null if it is not one. */
export function parseDotKey(key: string): { li: number; n: number } | null {
  const m = KEY_RE.exec(key)
  return m ? { li: +m[1], n: +m[2] } : null
}

/* ---------- shape ---------- */

export interface MlpDot {
  key: string
  /** layer index */
  li: number
  /** drawn slot within the column */
  slot: number
  /** the unit this circle is, or -1 when it is the ⋮ standing in for a run */
  n: number
  x: number
  y: number
  r: number
}

export interface MlpWire {
  key: string
  li: number
  a: MlpDot
  b: MlpDot
}

export interface MlpCol {
  li: number
  x: number
  /** logical units in this layer, which may exceed what is drawn */
  count: number
  /** the drawn column's extent, circle edges included */
  top: number
  bottom: number
}

export interface MlpLattice {
  /** real units only */
  dots: MlpDot[]
  /** the ⋮ marks, one per elided column */
  gaps: MlpDot[]
  wires: MlpWire[]
  cols: MlpCol[]
  r: number
}

/* ---------- reading the props ---------- */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Layer sizes, cleaned up: at least one layer, each of at least one unit. */
export function mlpLayers(p: NodeProps): number[] {
  const raw = p.layers?.length ? p.layers : MLP_DEFAULT_LAYERS
  return raw
    .slice(0, MLP_MAX_LAYERS)
    .map((v) => clamp(Math.round(v) || 1, 1, MLP_MAX_UNITS))
}

/** True when this node places its circles on a fixed pitch. */
export const isLattice = (p: NodeProps) => typeof p.pitch === 'number' && p.pitch > 0

/** The width of every gap between columns — `count - 1` of them. */
export function mlpGaps(p: NodeProps, count = mlpLayers(p).length): number[] {
  const r = Math.max(0.5, p.neuronR ?? MLP_R)
  const even = Math.max(2 * r, p.layerGap ?? MLP_GAP)
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) =>
    Math.max(2 * r, p.gaps?.[i] ?? even),
  )
}

/** True when every gap is the same, which is the default and the usual case. */
export const evenGaps = (p: NodeProps) => {
  const g = mlpGaps(p)
  return g.every((v) => v === g[0])
}

/* How a column of `count` units is drawn: which units get a circle, and where
 * the ⋮ goes. Short columns are drawn whole; a long one keeps its first units
 * and its last, because the last is the one figures label `n`. */
function slotsOf(count: number, maxDots: number): number[] {
  const cap = clamp(maxDots, 2, MLP_SLOT_CAP)
  if (count <= cap) return Array.from({ length: count }, (_, i) => i)
  // head units, then -1 for the ⋮, then the final unit
  const head = Array.from({ length: cap - 1 }, (_, i) => i)
  return [...head, -1, count - 1]
}

/** How many slots each column occupies once the ellipsis has had its say. */
export function mlpSlots(p: NodeProps): number[][] {
  const maxDots = p.maxDots ?? MLP_SLOT_CAP
  return mlpLayers(p).map((c) => slotsOf(c, maxDots))
}

/* ---------- the lattice ---------- */

/* Where everything in an MLP node is, in the node's *local* frame — origin at
 * its top-left, before any rotation. That is the frame the renderer draws in,
 * because the surrounding <g> already carries the node's translate and rotate.
 * Anything that needs canvas coordinates goes through `mlpPartCentre`. */
export function mlpLattice(n: FigNode): MlpLattice {
  const p = n.props
  const counts = mlpLayers(p)
  const slots = mlpSlots(p)
  const r = Math.max(0.5, p.neuronR ?? MLP_R)
  const lattice = isLattice(p)
  const pitch = Math.max(2 * r, p.pitch ?? MLP_PITCH)
  const cx = n.w / 2
  const cy = n.h / 2
  const L = counts.length

  /* Stretch mode spreads across the box; lattice mode steps out from the
     centre. Both give a column's x and a slot's y, so the rest of the function
     does not care which is in play.

     ⚠️ The gaps need not all be the same. `mlpGaps` gives one width per gap, so
     a column's x is the running total rather than a multiple — which is what
     lets the input layer stand off further than the hidden ones. The lattice
     still lands on the grid: every gap is a multiple of `grid`, so every prefix
     is too, and the whole run is centred on a multiple of `grid/2`. */
  const widths = mlpGaps(p, L)
  const prefix: number[] = [0]
  for (const w of widths) prefix.push(prefix[prefix.length - 1] + w)
  const span = prefix[L - 1]
  const colX = (li: number) =>
    lattice
      ? cx - span / 2 + prefix[li]
      : L === 1
        ? cx
        : r + (li * (n.w - 2 * r)) / (L - 1)

  const slotY = (li: number, k: number) => {
    const s = slots[li].length
    if (lattice) return cy + (k - (s - 1) / 2) * pitch
    if (s === 1) return cy
    /* Legacy spread. Every column fills the box, which is exactly the
       behaviour requirement 1 replaced — kept so old files do not shift. */
    return r + (k * (n.h - 2 * r)) / (s - 1)
  }

  const dots: MlpDot[] = []
  const gaps: MlpDot[] = []
  const cols: MlpCol[] = []
  /** drawn units of a layer, by logical index, for wiring */
  const byLayer: MlpDot[][] = []

  for (let li = 0; li < L; li++) {
    const x = colX(li)
    const mine: MlpDot[] = []
    slots[li].forEach((unit, k) => {
      const dot: MlpDot = {
        key: unit < 0 ? gapKey(li) : dotKey(li, unit),
        li,
        slot: k,
        n: unit,
        x,
        y: slotY(li, k),
        r,
      }
      if (unit < 0) gaps.push(dot)
      else {
        dots.push(dot)
        mine.push(dot)
      }
    })
    byLayer.push(mine)
    const ys = slots[li].map((_, k) => slotY(li, k))
    cols.push({
      li,
      x,
      count: counts[li],
      top: Math.min(...ys) - r,
      bottom: Math.max(...ys) + r,
    })
  }

  const wires: MlpWire[] = []
  if (p.showEdges !== false)
    for (let li = 0; li < L - 1; li++)
      for (const a of byLayer[li])
        for (const b of byLayer[li + 1])
          wires.push({ key: wireKey(li, a.n, b.n), li, a, b })

  return { dots, gaps, wires, cols, r }
}

/** One neuron by key, or null when the key names a unit that is not drawn. */
export function mlpDot(n: FigNode, key: string): MlpDot | null {
  return mlpLattice(n).dots.find((d) => d.key === key) ?? null
}

/** How far a group's outline stands off the units it holds, by default. */
export const GROUP_PAD = 7
/** A grip may push a side in until it touches the circles, and no further. */
export const GROUP_PAD_MAX = 400

/** How far a group's name floats above its box. */
export const GROUP_CAP_GAP = 4

/** A group's four paddings — top, right, bottom, left — filled in. */
export const groupPad = (g: NeuronGroup | undefined): [number, number, number, number] =>
  g?.pad ?? [GROUP_PAD, GROUP_PAD, GROUP_PAD, GROUP_PAD]

/* The box a part occupies, in the node's local frame: a unit's own square, or
 * everything a group holds. Null when the key names nothing that is drawn —
 * a unit the ellipsis swallowed, or a group whose members have all gone. */
export function mlpPartRect(n: FigNode, key: string): Rect | null {
  const lat = mlpLattice(n)
  if (isGroupKey(key)) {
    const g = n.props.groups?.[key]
    if (!g) return null
    const held = lat.dots.filter((d) => g.parts.includes(d.key))
    if (!held.length) return null
    const xs = held.flatMap((d) => [d.x - d.r, d.x + d.r])
    const ys = held.flatMap((d) => [d.y - d.r, d.y + d.r])
    const [pt, pr, pb, pl] = groupPad(g)
    const x = Math.min(...xs) - pl
    const y = Math.min(...ys) - pt
    return { x, y, w: Math.max(...xs) + pr - x, h: Math.max(...ys) + pb - y }
  }
  const d = lat.dots.find((x) => x.key === key)
  return d ? { x: d.x - d.r, y: d.y - d.r, w: d.r * 2, h: d.r * 2 } : null
}

/* How far a group's outline reaches past the node's own box, per side.
 *
 * The lattice sizes the node from its circles, so a group's padding hangs
 * outside it by construction — even the default 7. Anything that has to contain
 * what the node paints (the selection outline, the hit rect, the export frame)
 * asks this. */
export function mlpGroupOverflow(n: FigNode): { l: number; t: number; r: number; b: number } {
  const out = { l: 0, t: 0, r: 0, b: 0 }
  for (const [key, g] of Object.entries(n.props.groups ?? {})) {
    const r = mlpPartRect(n, key)
    if (!r) continue
    // the name sits above the box, so it counts as part of what the group paints
    const cap = g.label ? (g.fontSize ?? n.style.fontSize) * 1.3 + GROUP_CAP_GAP : 0
    out.l = Math.max(out.l, -r.x)
    out.t = Math.max(out.t, -r.y + cap)
    out.r = Math.max(out.r, r.x + r.w - n.w)
    out.b = Math.max(out.b, r.y + r.h - n.h)
  }
  return { l: Math.max(0, out.l), t: Math.max(0, out.t), r: Math.max(0, out.r), b: Math.max(0, out.b) }
}

/** A part's centre in canvas coordinates, rotation included — what a connector
 *  attaches to and what the hit layer measures against. */
export function mlpPartCentre(n: FigNode, key: string): Pt | null {
  const r = mlpPartRect(n, key)
  if (!r) return null
  const p = { x: n.x + r.x + r.w / 2, y: n.y + r.y + r.h / 2 }
  return n.rotation ? rotatePt(p, rectCenter(n), n.rotation) : p
}

/** Where a connector meets one neuron: on its rim, facing the other end. */
/* ⚠️ The anchor is honoured, not ignored.
 *
 * This used to take only "is it the centre?" and otherwise always face the
 * other end, so picking 위/오른쪽/아래/왼쪽 for an end attached to a neuron did
 * nothing at all — the panel offered a choice that the geometry threw away.
 * Two wires leaving the same unit then left from the same point and lay on top
 * of each other, which is exactly what those four are for. */
export function mlpAnchorPoint(
  n: FigNode,
  key: string,
  anchor: Anchor,
  toward: Pt,
): AnchorPoint | null {
  const rect = mlpPartRect(n, key)
  const c = mlpPartCentre(n, key)
  if (!rect || !c) return null
  if (anchor === 'c') return { p: c, dir: { x: 0, y: 0 } }

  let dir: Pt
  if (anchor === 'auto') {
    const raw = { x: toward.x - c.x, y: toward.y - c.y }
    const len = Math.hypot(raw.x, raw.y)
    // a connector aimed at its own origin has no direction to leave in; point
    // it along +x so the arrowhead still has something to sit on
    dir = len < 1e-6 ? { x: 1, y: 0 } : { x: raw.x / len, y: raw.y / len }
  } else {
    /* A neuron is a circle, so a fixed side is a point on its rim rather than
       a corner of a box — the diagonals are real directions here, not the
       awkward compromise they are on a rectangle. */
    const u = FIXED[anchor] ?? { x: 1, y: 0 }
    dir = n.rotation ? rotateDir(u, n.rotation) : u
  }
  /* Where that direction leaves the part. A unit is round, so it is simply the
     radius; a group is a box, so the ray has to be stopped by whichever side it
     reaches first — otherwise a wire into a tall group would start floating
     out beyond its corner. */
  const local = n.rotation ? rotateDir(dir, -n.rotation) : dir
  const half = isGroupKey(key)
    ? (() => {
        const sx = local.x === 0 ? Infinity : rect.w / 2 / Math.abs(local.x)
        const sy = local.y === 0 ? Infinity : rect.h / 2 / Math.abs(local.y)
        return Math.min(sx, sy)
      })()
    : rect.w / 2
  return { p: { x: c.x + dir.x * half, y: c.y + dir.y * half }, dir }
}

const SQ = Math.SQRT1_2
const FIXED: Record<string, Pt> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
  ne: { x: SQ, y: -SQ },
  nw: { x: -SQ, y: -SQ },
  se: { x: SQ, y: SQ },
  sw: { x: -SQ, y: SQ },
}

/* Picking inside a network.
 *
 * The editor's hit layer is a plain rectangle per node, so a click that lands
 * on a neuron arrives as a click on the network. These two say which part of it
 * was meant, in the same coordinates the drawing used — the alternative is
 * fishing `data-mlp-*` out of the DOM, which only works for whatever happens to
 * be on top and disagrees with the geometry the moment two parts overlap. */

/** Undo the node's placement so a canvas point can be compared to the lattice. */
export const mlpToLocal = (n: FigNode, p: Pt): Pt => {
  const q = n.rotation ? rotatePt(p, rectCenter(n), -n.rotation) : p
  return { x: q.x - n.x, y: q.y - n.y }
}
const toLocal = mlpToLocal

const DIRS: Record<string, Pt> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
}

/* Connection dots around one neuron, floated `out` past its rim.
 *
 * A unit that can be *landed on* but not *left from* is only half connected,
 * and until these existed the only way to start a wire at a neuron was connect
 * mode. They sit outside the circle for the same reason the shape ones sit
 * outside a box: a dot on the rim covers the thing it is attached to, and then
 * the two gestures fight over one point. */
export function mlpPartAnchors(n: FigNode, key: string, out: number): { anchor: string; p: Pt }[] {
  const rect = mlpPartRect(n, key)
  if (!rect) return []
  const c = rectCenter(n)
  const mid = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
  return Object.entries(DIRS).map(([anchor, u]) => {
    // the side of the part, then `out` further along the same direction
    const p = {
      x: n.x + mid.x + u.x * (rect.w / 2 + out),
      y: n.y + mid.y + u.y * (rect.h / 2 + out),
    }
    return { anchor, p: n.rotation ? rotatePt(p, c, n.rotation) : p }
  })
}

/* A group is picked anywhere inside it, not just on its outline.
 *
 * ⚠️ It used to be the outline alone, on the theory that a group swallowing
 * presses on its own members would put them out of reach. That theory was
 * wrong, because the caller asks about the *circles first*: a press on a unit
 * never gets here. What outline-only actually produced was a box you had to
 * hit within a few pixels to select at all — one more layer of the network is
 * how it reads on screen, and that is how it should behave.
 *
 * The smallest group wins, so a group nested inside another stays reachable. */
export function mlpGroupAt(n: FigNode, p: Pt, tol = 4): string | null {
  const local = toLocal(n, p)
  let best: string | null = null
  let bestArea = Infinity
  for (const key of Object.keys(n.props.groups ?? {})) {
    const r = mlpPartRect(n, key)
    if (!r) continue
    const inside =
      local.x >= r.x - tol &&
      local.x <= r.x + r.w + tol &&
      local.y >= r.y - tol &&
      local.y <= r.y + r.h + tol
    if (!inside) continue
    const area = r.w * r.h
    if (area < bestArea) {
      best = key
      bestArea = area
    }
  }
  return best
}

/* The group whose *name* is under the point.
 *
 * A caption is the one thing on a figure with nothing else beneath it, so
 * double-clicking it can go straight to editing rather than climbing the
 * select-then-select-again ladder the circles need. One line's worth of band
 * above the box, the same estimate `shapeOverflow` uses — a real text layout
 * lives a layer above this one. */
export function mlpGroupLabelAt(n: FigNode, p: Pt, tol = 4): string | null {
  const local = toLocal(n, p)
  for (const [key, g] of Object.entries(n.props.groups ?? {})) {
    if (!g.label) continue
    const r = mlpPartRect(n, key)
    if (!r) continue
    const h = (g.fontSize ?? n.style.fontSize) * 1.3
    if (
      Math.abs(local.x - (r.x + r.w / 2)) <= r.w / 2 + tol &&
      local.y >= r.y - GROUP_CAP_GAP - h - tol &&
      local.y <= r.y - GROUP_CAP_GAP + tol
    )
      return key
  }
  return null
}

/** The neuron under a point, in canvas coordinates. `pad` widens the circle. */
export function mlpDotAt(n: FigNode, p: Pt, pad = 0): MlpDot | null {
  const local = toLocal(n, p)
  for (const d of mlpLattice(n).dots) {
    const rr = d.r + pad
    if ((local.x - d.x) ** 2 + (local.y - d.y) ** 2 <= rr * rr) return d
  }
  return null
}

/* The wire under a point. Circles win ties: a synapse ends underneath the
 * neuron it joins, and at a junction the neuron is the thing being aimed at. */
export function mlpWireAt(n: FigNode, p: Pt, tol = 3): MlpWire | null {
  const local = toLocal(n, p)
  const lat = mlpLattice(n)
  for (const d of lat.dots) if ((local.x - d.x) ** 2 + (local.y - d.y) ** 2 <= d.r * d.r) return null
  let best: MlpWire | null = null
  let bestD = tol
  for (const w of lat.wires) {
    if (n.props.wires?.[w.key]?.hidden) continue
    const dist = distToSeg(local, w.a, w.b)
    if (dist <= bestD) {
      best = w
      bestD = dist
    }
  }
  return best
}

/* Is the pointer on the network at all?
 *
 * ⚠️ A network is mostly holes, and it used to be picked by its bounding box.
 * Anything placed over the space between two columns — a caption, an arrow's
 * label, a small block sitting inside the diagram — became unclickable the
 * moment the network was drawn later or lay above it, because every press
 * within the rectangle was answered by the network first. It is drawn as
 * circles, lines and boxes, so that is what it is grabbed by; the gaps between
 * them belong to whatever is underneath, the same way an unfilled shape's
 * middle does in `pointOnNode`. */
export function mlpHit(n: FigNode, p: Pt, tol = 0): boolean {
  const local = toLocal(n, p)
  const lat = mlpLattice(n)
  const near = (d: MlpDot, extra: number) => {
    const rr = d.r + extra
    return (local.x - d.x) ** 2 + (local.y - d.y) ** 2 <= rr * rr
  }
  for (const d of lat.dots) if (near(d, tol)) return true
  // the ⋮ is a short stack of pips; its own little circle is target enough
  for (const g of lat.gaps) if (near(g, tol - g.r * 0.2)) return true
  /* Wires get a thinner allowance than the circles do. They criss-cross the
     whole box, so a generous one turns the network back into the net that
     caught every press — the circles are what you are reaching for. */
  const wireTol = Math.max(2, Math.min(tol, 4))
  for (const w of lat.wires) {
    if (n.props.wires?.[w.key]?.hidden) continue
    if (distToSeg(local, w.a, w.b) <= wireTol) return true
  }
  /* Captions and group names are ink too. Their exact extent needs a text
     layout, which lives a layer above this one, so they get the same one-line
     estimate `shapeOverflow` uses — a band the width of the thing they label. */
  const line = n.style.fontSize * 1.3
  const gap = Math.max(2 * lat.r, n.props.layerGap ?? MLP_GAP)
  for (const c of lat.cols) {
    const { top, bottom } = mlpCaps(n.props, c.li)
    const band = (y0: number, y1: number) =>
      Math.abs(local.x - c.x) <= gap / 2 && local.y >= y0 - tol && local.y <= y1 + tol
    if (top && band(c.top - line, c.top)) return true
    if (bottom && band(c.bottom, c.bottom + line)) return true
  }
  for (const key of Object.keys(n.props.groups ?? {})) {
    const g = n.props.groups?.[key]
    const r = mlpPartRect(n, key)
    if (!g || !r) continue
    if (
      g.label &&
      Math.abs(local.x - (r.x + r.w / 2)) <= r.w / 2 &&
      local.y >= r.y - GROUP_CAP_GAP - (g.fontSize ?? n.style.fontSize) * 1.3 - tol &&
      local.y <= r.y
    )
      return true
    if (g.bare) continue
    /* The whole box, not just its outline — a drawn group is one more layer of
       the network, and the gap between two of its units belongs to it rather
       than to whatever is behind the network. The band is symmetric about the
       edge so the outermost pixel of the line belongs to somebody. */
    const band = Math.max(tol, 4)
    if (
      local.x >= r.x - band &&
      local.x <= r.x + r.w + band &&
      local.y >= r.y - band &&
      local.y <= r.y + r.h + band
    )
      return true
  }
  return false
}

/* ---------- size ---------- */

/* In lattice mode the box is a *result*: the circles are placed by pitch, and
 * whatever they span is how big the node is. Dragging a resize handle therefore
 * cannot stretch the drawing — it changes the pitch, and the box follows. That
 * is what "positions are forced by the algorithm" has to mean; leaving w/h free
 * would let the box and the lattice disagree, and the box would win on screen
 * while the lattice won everywhere else. */
export function mlpNaturalSize(p: NodeProps): { w: number; h: number } | null {
  if (!isLattice(p)) return null
  const slots = mlpSlots(p)
  const r = Math.max(0.5, p.neuronR ?? MLP_R)
  const pitch = Math.max(2 * r, p.pitch ?? MLP_PITCH)
  const widest = Math.max(...slots.map((s) => s.length))
  return {
    w: 2 * r + mlpGaps(p, slots.length).reduce((a, b) => a + b, 0),
    h: 2 * r + (widest - 1) * pitch,
  }
}

/* Put the lattice parameters on the grid.
 *
 * This is the whole of requirement 4: get `r`, `pitch` and `layerGap` onto the
 * right multiples and every circle is on the position lattice for free, in
 * every column, without rounding any circle individually. */
export function mlpSnapProps(p: NodeProps, grid: number): Partial<NodeProps> {
  const half = grid / 2
  const r = Math.max(half, Math.round((p.neuronR ?? MLP_R) / half) * half)
  const floor = Math.ceil((2 * r) / grid) * grid
  const snap = (v: number, min: number) => Math.max(min, Math.round(v / grid) * grid)
  return {
    neuronR: r,
    pitch: snap(p.pitch ?? MLP_PITCH, floor),
    layerGap: snap(p.layerGap ?? MLP_GAP, floor),
    /* Each gap on its own, for the same reason: uneven columns still land on
       the lattice as long as every step is a whole number of cells. */
    gaps: p.gaps?.length ? p.gaps.map((v) => snap(v, floor)) : undefined,
  }
}

/* ---------- editing the layer list ---------- */

/* ⚠️ Inserting a layer renumbers every layer after it, and the keys do not
 * follow on their own.
 *
 * Part keys carry the layer index — `l4n0` is the first unit of layer 4 — which
 * survives a layer changing *size*, and that was the case the keys were
 * designed for. It does not survive the layer *axis* being spliced: add a
 * hidden layer to [4,64,64,64,1] and the output unit is layer 5, while its
 * colour and its label are still filed under layer 4. On screen the labelled
 * circle jumps backwards into the middle of the network. `capTop` and
 * `capBottom` are plain arrays indexed the same way, so they slide too.
 *
 * The change arrives as a whole new array, so the insertion point has to be
 * recovered by comparison. Scanning from the front finds the first index that
 * differs, which keeps the longest run of keys where they were. Inserting a
 * layer whose size equals its neighbour's is genuinely ambiguous — [4,64,64]
 * to [4,64,64,64] could be a new layer at any of three places — and the front
 * scan simply picks the earliest reading. */
function layerSplice(prev: number[], next: number[]): { at: number; delta: 1 | -1 } | null {
  if (Math.abs(next.length - prev.length) !== 1) return null
  const delta = next.length > prev.length ? 1 : -1
  const short = delta === 1 ? prev : next
  let at = short.length
  for (let i = 0; i < short.length; i++)
    if (prev[i] !== next[i]) {
      at = i
      break
    }
  return { at, delta }
}

/** Move a layer index across a splice; -1 means the layer is gone. */
const shiftLayer = (li: number, at: number, delta: 1 | -1) =>
  delta === 1 ? (li >= at ? li + 1 : li) : li === at ? -1 : li > at ? li - 1 : li

/* `span` marks a bag whose keys name a *pair* of layers — the synapses, which
 * run from their own layer to the next one. Those have a second way of going
 * stale: a layer dropped into the gap they crossed leaves them pointing at
 * something that was not there before. The connection they were describing no
 * longer exists, so neither should they; carrying them over would silently
 * repaint a different synapse than the one that was coloured. */
const rekey = <T,>(
  bag: Record<string, T> | undefined,
  at: number,
  delta: 1 | -1,
  span = false,
) => {
  if (!bag) return undefined
  const out: Record<string, T> = {}
  for (const [key, v] of Object.entries(bag)) {
    const m = /^l(\d+)(n.*)$/.exec(key)
    if (!m) continue
    const from = +m[1]
    if (span && from === at - 1) continue
    const li = shiftLayer(from, at, delta)
    if (li >= 0) out[`l${li}${m[2]}`] = v
  }
  return Object.keys(out).length ? out : undefined
}

/* A group's key says nothing about layers — its *members* do. Splicing moves
 * each member and drops the ones whose layer went; a group left holding nothing
 * goes with them, since an empty group is a rectangle around no units. */
const regroup = (
  groups: Record<string, NeuronGroup> | undefined,
  at: number,
  delta: 1 | -1,
) => {
  if (!groups) return undefined
  const out: Record<string, NeuronGroup> = {}
  for (const [key, g] of Object.entries(groups)) {
    const parts = g.parts.flatMap((k) => {
      const m = parseDotKey(k)
      if (!m) return []
      const li = shiftLayer(m.li, at, delta)
      return li >= 0 ? [dotKey(li, m.n)] : []
    })
    if (parts.length) out[key] = { ...g, parts }
  }
  return Object.keys(out).length ? out : undefined
}

const spliceCaps = (caps: string[] | undefined, at: number, delta: 1 | -1) => {
  if (!caps) return undefined
  const out = [...caps]
  if (delta === 1) out.splice(at, 0, '')
  else out.splice(at, 1)
  return out.some(Boolean) ? out : undefined
}

/* The gaps are filed *between* layers, so a splice adds or removes one of them
 * rather than shifting an index. A new layer arrives with the even spacing, and
 * a removed one takes its gap with it. */
function spliceGaps(p: NodeProps, next: number[], at: number, delta: 1 | -1) {
  if (!p.gaps?.length) return undefined
  const out = mlpGaps(p)
  if (delta === 1) out.splice(Math.min(at, out.length), 0, Math.max(2 * (p.neuronR ?? MLP_R), p.layerGap ?? MLP_GAP))
  else out.splice(Math.min(at, out.length - 1), 1)
  return out.slice(0, Math.max(0, next.length - 1))
}

/** A new layer list, with every key, caption and gap moved to match. */
export function retypeLayers(p: NodeProps, next: number[]): Partial<NodeProps> {
  const move = layerSplice(mlpLayers(p), next)
  if (!move) return { layers: next, gaps: p.gaps?.slice(0, Math.max(0, next.length - 1)) }
  const { at, delta } = move
  return {
    layers: next,
    neurons: rekey(p.neurons, at, delta),
    wires: rekey(p.wires, at, delta, true),
    groups: regroup(p.groups, at, delta),
    capTop: spliceCaps(p.capTop, at, delta),
    capBottom: spliceCaps(p.capBottom, at, delta),
    gaps: spliceGaps(p, next, at, delta),
  }
}

/* ---------- captions ---------- */

/** The caption above and below a column, if either was written. */
export const mlpCaps = (p: NodeProps, li: number) => ({
  top: p.capTop?.[li] ?? '',
  bottom: p.capBottom?.[li] ?? '',
})

/** True when any column carries a caption — lets callers skip the layout. */
export const hasCaps = (p: NodeProps) =>
  !!p.capTop?.some(Boolean) || !!p.capBottom?.some(Boolean)
