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
 *     layerGap a multiple of grid
 *
 * puts every centre on it, in every column, at once — see `mlpSnapProps`, and
 * `mlp.test.ts` for the proof. Rounding the circles individually instead would
 * have broken the equal spacing that requirement asked for in the first place. */

import type { FigNode, NodeProps, Pt } from './types'
import { distToSeg, rectCenter, rotatePt, type AnchorPoint } from './geometry'

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
 * Anything that needs canvas coordinates goes through `mlpDotPoint`. */
export function mlpLattice(n: FigNode): MlpLattice {
  const p = n.props
  const counts = mlpLayers(p)
  const slots = mlpSlots(p)
  const r = Math.max(0.5, p.neuronR ?? MLP_R)
  const lattice = isLattice(p)
  const pitch = Math.max(2 * r, p.pitch ?? MLP_PITCH)
  const gap = Math.max(2 * r, p.layerGap ?? MLP_GAP)
  const cx = n.w / 2
  const cy = n.h / 2
  const L = counts.length

  /* Stretch mode spreads across the box; lattice mode steps out from the
     centre. Both give a column's x and a slot's y, so the rest of the function
     does not care which is in play. */
  const colX = (li: number) =>
    lattice
      ? cx + (li - (L - 1) / 2) * gap
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

/** A neuron's centre in canvas coordinates, rotation included — what a
 *  connector attaches to and what the hit layer measures against. */
export function mlpDotPoint(n: FigNode, key: string): Pt | null {
  const d = mlpDot(n, key)
  if (!d) return null
  const p = { x: n.x + d.x, y: n.y + d.y }
  return n.rotation ? rotatePt(p, rectCenter(n), n.rotation) : p
}

/** Where a connector meets one neuron: on its rim, facing the other end. */
export function mlpAnchorPoint(
  n: FigNode,
  key: string,
  toward: Pt,
  atCentre = false,
): AnchorPoint | null {
  const d = mlpDot(n, key)
  const c = mlpDotPoint(n, key)
  if (!d || !c) return null
  if (atCentre) return { p: c, dir: { x: 0, y: 0 } }
  const raw = { x: toward.x - c.x, y: toward.y - c.y }
  const len = Math.hypot(raw.x, raw.y)
  // a connector aimed at its own origin has no direction to leave in; point it
  // along +x so the arrowhead still has something to sit on
  const dir = len < 1e-6 ? { x: 1, y: 0 } : { x: raw.x / len, y: raw.y / len }
  return { p: { x: c.x + dir.x * d.r, y: c.y + dir.y * d.r }, dir }
}

/* Picking inside a network.
 *
 * The editor's hit layer is a plain rectangle per node, so a click that lands
 * on a neuron arrives as a click on the network. These two say which part of it
 * was meant, in the same coordinates the drawing used — the alternative is
 * fishing `data-mlp-*` out of the DOM, which only works for whatever happens to
 * be on top and disagrees with the geometry the moment two parts overlap. */

/** Undo the node's placement so a canvas point can be compared to the lattice. */
const toLocal = (n: FigNode, p: Pt): Pt => {
  const q = n.rotation ? rotatePt(p, rectCenter(n), -n.rotation) : p
  return { x: q.x - n.x, y: q.y - n.y }
}

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
export function mlpDotAnchors(n: FigNode, key: string, out: number): { anchor: string; p: Pt }[] {
  const d = mlpDot(n, key)
  if (!d) return []
  const c = rectCenter(n)
  return Object.entries(DIRS).map(([anchor, u]) => {
    const p = { x: n.x + d.x + u.x * (d.r + out), y: n.y + d.y + u.y * (d.r + out) }
    return { anchor, p: n.rotation ? rotatePt(p, c, n.rotation) : p }
  })
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
  const gap = Math.max(2 * r, p.layerGap ?? MLP_GAP)
  const widest = Math.max(...slots.map((s) => s.length))
  return {
    w: 2 * r + (slots.length - 1) * gap,
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
  const snap = (v: number, min: number) =>
    Math.max(min, Math.round(v / grid) * grid)
  return {
    neuronR: r,
    pitch: snap(p.pitch ?? MLP_PITCH, Math.ceil((2 * r) / grid) * grid),
    layerGap: snap(p.layerGap ?? MLP_GAP, Math.ceil((2 * r) / grid) * grid),
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

const spliceCaps = (caps: string[] | undefined, at: number, delta: 1 | -1) => {
  if (!caps) return undefined
  const out = [...caps]
  if (delta === 1) out.splice(at, 0, '')
  else out.splice(at, 1)
  return out.some(Boolean) ? out : undefined
}

/** A new layer list, with every key and caption moved to match. */
export function retypeLayers(p: NodeProps, next: number[]): Partial<NodeProps> {
  const move = layerSplice(mlpLayers(p), next)
  if (!move) return { layers: next }
  const { at, delta } = move
  return {
    layers: next,
    neurons: rekey(p.neurons, at, delta),
    wires: rekey(p.wires, at, delta, true),
    capTop: spliceCaps(p.capTop, at, delta),
    capBottom: spliceCaps(p.capBottom, at, delta),
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
