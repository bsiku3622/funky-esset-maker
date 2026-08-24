/* Anchors, hit-testing, alignment guides and measuring — the half of the
 * geometry that knows about figure nodes.
 *
 * The half that does not lives in `src/tools/routing.ts`: path segments and
 * connector routing take anchors and rectangles, never a node, so Grapher uses
 * the same router. It is re-exported here so this file stays the one address
 * for geometry within AI Figure Maker.
 *
 * ⚠️ Anything added here that turns out not to need `FigNode` belongs there
 * instead. */

import type { Anchor, FigNode, Pt, Rect } from './types'
import type { AnchorPoint } from '../routing'

export {
  atLength,
  distToPath,
  distToSeg,
  nearestT,
  orthoCorners,
  pathD,
  pathInfo,
  route,
  trimPath,
  type AnchorPoint,
  type PathInfo,
  type PathSeg,
} from '../routing'

export const rad = (deg: number) => (deg * Math.PI) / 180

export function rotatePt(p: Pt, c: Pt, deg: number): Pt {
  if (!deg) return p
  const a = rad(deg)
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

export const nodeRect = (n: FigNode): Rect => ({ x: n.x, y: n.y, w: n.w, h: n.h })
export const rectCenter = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Axis-aligned bounds of a node after rotation. */
export function nodeBounds(n: FigNode): Rect {
  if (!n.rotation) return nodeRect(n)
  const c = rectCenter(nodeRect(n))
  const pts = [
    { x: n.x, y: n.y },
    { x: n.x + n.w, y: n.y },
    { x: n.x + n.w, y: n.y + n.h },
    { x: n.x, y: n.y + n.h },
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

export function unionRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/* ---------- anchors ---------- */

const UNIT: Record<Exclude<Anchor, 'auto' | 'c'>, Pt> = {
  n: { x: 0.5, y: 0 },
  s: { x: 0.5, y: 1 },
  e: { x: 1, y: 0.5 },
  w: { x: 0, y: 0.5 },
  ne: { x: 1, y: 0 },
  nw: { x: 0, y: 0 },
  se: { x: 1, y: 1 },
  sw: { x: 0, y: 1 },
}

/** Outward normal for a fixed anchor, in the node's own (unrotated) frame. */
const NORMAL: Record<string, Pt> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
  ne: { x: 0.7071, y: -0.7071 },
  nw: { x: -0.7071, y: -0.7071 },
  se: { x: 0.7071, y: 0.7071 },
  sw: { x: -0.7071, y: 0.7071 },
  c: { x: 0, y: 0 },
}

export const ANCHOR_KEYS: Exclude<Anchor, 'auto'>[] = [
  'nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se',
]

/** Where the shape's outline sits, for a node kind that is not a plain box.
 *  Used so arrows touch an ellipse/diamond edge rather than its bounding box. */
function outlinePoint(n: FigNode, toward: Pt): Pt {
  const c = rectCenter(nodeRect(n))
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const a = n.w / 2
  const b = n.h / 2
  switch (n.kind) {
    case 'ellipse':
    case 'op': {
      const k = 1 / Math.hypot(dx / a, dy / b)
      return { x: c.x + dx * k, y: c.y + dy * k }
    }
    case 'diamond': {
      const k = 1 / (Math.abs(dx) / a + Math.abs(dy) / b)
      return { x: c.x + dx * k, y: c.y + dy * k }
    }
    default: {
      const sx = dx === 0 ? Infinity : a / Math.abs(dx)
      const sy = dy === 0 ? Infinity : b / Math.abs(dy)
      const k = Math.min(sx, sy)
      return { x: c.x + dx * k, y: c.y + dy * k }
    }
  }
}


/** Resolve an endpoint on `n` facing `toward` (world coords). */
export function anchorPoint(n: FigNode, anchor: Anchor, toward: Pt): AnchorPoint {
  const c = rectCenter(nodeRect(n))
  if (anchor === 'auto') {
    // un-rotate the target, find the border point, rotate back
    const t = n.rotation ? rotatePt(toward, c, -n.rotation) : toward
    const p = outlinePoint(n, t)
    const raw = { x: p.x - c.x, y: p.y - c.y }
    const len = Math.hypot(raw.x, raw.y) || 1
    let dir = { x: raw.x / len, y: raw.y / len }
    // snap the direction to the dominant axis so ortho routes stay clean
    if (n.kind !== 'ellipse' && n.kind !== 'op' && n.kind !== 'diamond') {
      dir =
        Math.abs(raw.x) / (n.w / 2) > Math.abs(raw.y) / (n.h / 2)
          ? { x: Math.sign(raw.x) || 1, y: 0 }
          : { x: 0, y: Math.sign(raw.y) || 1 }
    }
    return {
      p: n.rotation ? rotatePt(p, c, n.rotation) : p,
      dir: n.rotation ? rotateDir(dir, n.rotation) : dir,
    }
  }
  if (anchor === 'c') return { p: c, dir: { x: 0, y: 0 } }
  const u = UNIT[anchor]
  const p = { x: n.x + n.w * u.x, y: n.y + n.h * u.y }
  const fixed =
    n.kind === 'ellipse' || n.kind === 'op' || n.kind === 'diamond'
      ? outlinePoint(n, { x: c.x + (u.x - 0.5) * n.w * 2, y: c.y + (u.y - 0.5) * n.h * 2 })
      : p
  const dir = NORMAL[anchor]
  return {
    p: n.rotation ? rotatePt(fixed, c, n.rotation) : fixed,
    dir: n.rotation ? rotateDir(dir, n.rotation) : dir,
  }
}

export function rotateDir(d: Pt, deg: number): Pt {
  const a = rad(deg)
  return {
    x: d.x * Math.cos(a) - d.y * Math.sin(a),
    y: d.x * Math.sin(a) + d.y * Math.cos(a),
  }
}

/* ---------- hit testing ---------- */

export function pointInRect(p: Pt, r: Rect, pad = 0) {
  return (
    p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad
  )
}

export function pointInNode(p: Pt, n: FigNode, pad = 0) {
  const c = rectCenter(nodeRect(n))
  const q = n.rotation ? rotatePt(p, c, -n.rotation) : p
  return pointInRect(q, nodeRect(n), pad)
}

/* Shapes that are grabbed anywhere inside them even with no fill: a text node
 * is its glyphs, an inline plot and an operator token are too small for an
 * outline-only target to be anything but fiddly. */
const SOLID_HIT = new Set<FigNode['kind']>(['text', 'image', 'curve', 'op'])

/** Does this node paint an interior to click on, or only an outline? */
export const hitsByOutline = (n: FigNode) =>
  !SOLID_HIT.has(n.kind) && (n.style.fill === 'none' || n.style.fill === 'transparent')

/* Is the pointer on the node — not merely inside its bounding box?
 *
 * ⚠️ An unfilled container is the whole reason this exists. A group frame is a
 * dashed outline around other shapes, but its hit area was the filled
 * rectangle, so it swallowed every click meant for what it contains: pressing a
 * node inside it grabbed the frame and dragged the entire block instead. An
 * empty interior is empty — you grab it by its edge, the way every vector
 * editor does it. */
export function pointOnNode(p: Pt, n: FigNode, pad = 0) {
  if (!pointInNode(p, n, pad)) return false
  if (!hitsByOutline(n)) return true
  const band = Math.max(pad, 6) + n.style.strokeWidth / 2
  // inside the box but not inside the hole it leaves in the middle
  return !pointInNode(p, n, -band)
}

export function rectsOverlap(a: Rect, b: Rect) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}


/* ---------- alignment guides ---------- */

export interface Guide {
  axis: 'x' | 'y'
  at: number
  /** span to draw the guide over */
  from: number
  to: number
}

export interface SnapResult {
  dx: number
  dy: number
  /* Whether an alignment was found at all, which "dx === 0" cannot answer: a
     node already lined up returns a zero delta, and the caller has to tell that
     apart from "nothing to align with" or it will grid-snap the alignment away. */
  hitX: boolean
  hitY: boolean
  guides: Guide[]
  /** the coordinate each axis locked onto; feed it back next frame as `sticky` */
  atX: number | null
  atY: number | null
}

/** What the previous frame locked onto, so the choice does not change hands
 *  while the pointer jitters between two alignments that both nearly fit. */
export interface Sticky {
  x: number | null
  y: number | null
}

/** One possible alignment: shifting the moving box by `d` puts its edge or
 *  centre exactly on `at`, a coordinate belonging to `ref`. */
interface Align {
  d: number
  at: number
  ref: Rect
}

/* Deltas this close count as the same alignment. Node coordinates are rounded
 * to whole pixels, so two edges that are "the same" routinely differ by a
 * fraction; anything tighter would split them into rival answers. */
const TIE = 0.75

/* Pick the shift for one axis.
 *
 * ⚠️ Not "the nearest single match" — that is what made the guides flicker.
 * Drag a copy of a block alongside the original and its top and bottom line up
 * at the same time, but the two deltas differ by a fraction of a pixel because
 * the boxes are not pixel-identical. Taking the nearest one made the winner
 * flip between them as the pointer moved, so the guide jumped from the top edge
 * to the bottom and back several times a second, and only ever one of the two
 * was drawn.
 *
 * So: cluster the candidate deltas and take the cluster the *most* of them
 * agree on. Alignments that hold at several places beat a lone closer one,
 * which is also the better answer — lining a block up with a block should win
 * over clipping one edge to a passing neighbour. */
/* How much closer a rival alignment has to be before it takes over from the one
 * already in force. Two alignments that cannot both hold — a block a pixel
 * taller than its neighbour can match the top or the bottom, never both — sit
 * either side of a midpoint the pointer wanders across, and without this the
 * answer changes hands every time it does. */
const STICKY = 2.5

function axisAlign(
  mCoords: number[],
  others: Rect[],
  coordsOf: (r: Rect) => number[],
  threshold: number,
  sticky: number | null,
): { d: number; hits: Align[]; at: number } | null {
  const cands: Align[] = []
  for (const o of others) {
    const oc = coordsOf(o)
    for (const a of mCoords)
      for (const b of oc) {
        const d = b - a
        if (Math.abs(d) <= threshold) cands.push({ d, at: b, ref: o })
      }
  }
  if (!cands.length) return null

  // sweep the sorted deltas for the widest agreement, nearest cluster winning ties
  cands.sort((p, q) => p.d - q.d)
  let best: { d: number; hits: Align[]; at: number; cost: number } | null = null
  let lo = 0
  for (let hi = 0; hi < cands.length; hi++) {
    while (cands[hi].d - cands[lo].d > TIE) lo++
    const hits = cands.slice(lo, hi + 1)
    // within a cluster, snap to the member that needs the smallest move
    const pick = hits.reduce((m, c) => (Math.abs(c.d) < Math.abs(m.d) ? c : m), hits[0])
    const held = sticky !== null && hits.some((h) => Math.abs(h.at - sticky) < 0.01)
    const cost = Math.abs(pick.d) - (held ? STICKY : 0)
    if (!best || hits.length > best.hits.length || (hits.length === best.hits.length && cost < best.cost))
      best = { d: pick.d, hits, at: pick.at, cost }
  }
  return best
}

/** Nudge a moving bbox so its edges/centres line up with static ones.
 *  Threshold is in world units (already divided by zoom by the caller). */
export function snapGuides(
  moving: Rect,
  others: Rect[],
  threshold: number,
  sticky: Sticky = { x: null, y: null },
): SnapResult {
  const x = axisAlign(
    [moving.x, moving.x + moving.w / 2, moving.x + moving.w],
    others,
    (o) => [o.x, o.x + o.w / 2, o.x + o.w],
    threshold,
    sticky.x,
  )
  const y = axisAlign(
    [moving.y, moving.y + moving.h / 2, moving.y + moving.h],
    others,
    (o) => [o.y, o.y + o.h / 2, o.y + o.h],
    threshold,
    sticky.y,
  )
  const dx = x?.d ?? 0
  const dy = y?.d ?? 0
  const shifted = { x: moving.x + dx, y: moving.y + dy, w: moving.w, h: moving.h }

  /* Draw every line the chosen shift actually lands on, not just the one that
     won. Two lines meaning "these two blocks agree top and bottom" is the whole
     point; one line that keeps changing its mind is noise.

     Guides are keyed by coordinate so several references sharing an edge give
     one line, spanning all of them. */
  const byKey = new Map<string, Guide>()
  const add = (axis: 'x' | 'y', hits: Align[] | undefined, d: number) => {
    for (const h of hits ?? []) {
      if (Math.abs(h.d - d) > TIE) continue
      const key = `${axis}${h.at.toFixed(1)}`
      const lo =
        axis === 'x' ? Math.min(shifted.y, h.ref.y) : Math.min(shifted.x, h.ref.x)
      const hi =
        axis === 'x'
          ? Math.max(shifted.y + shifted.h, h.ref.y + h.ref.h)
          : Math.max(shifted.x + shifted.w, h.ref.x + h.ref.w)
      const cur = byKey.get(key)
      if (cur) {
        cur.from = Math.min(cur.from, lo - 12)
        cur.to = Math.max(cur.to, hi + 12)
      } else {
        byKey.set(key, { axis, at: h.at, from: lo - 12, to: hi + 12 })
      }
    }
  }
  add('x', x?.hits, dx)
  add('y', y?.hits, dy)

  return {
    dx,
    dy,
    hitX: !!x,
    hitY: !!y,
    guides: [...byKey.values()],
    atX: x?.at ?? null,
    atY: y?.at ?? null,
  }
}

/* ---------- equal spacing ---------- */

/** A gap the snap is claiming is equal to another one, drawn as a measured bar
 *  between two shapes. `from`/`to` run along `axis`; `at` is where to draw it. */
export interface Gap {
  axis: 'x' | 'y'
  from: number
  to: number
  at: number
}

const span = (r: Rect, axis: 'x' | 'y') =>
  axis === 'x' ? { lo: r.x, hi: r.x + r.w } : { lo: r.y, hi: r.y + r.h }

/* Snap so the gaps come out equal, the way you actually lay a row of blocks
 * out: drop one between two others and it lands centred between them, or drop
 * it past the end of a row and it keeps the rhythm the row already has.
 *
 * Only shapes that overlap the moving box on the *other* axis are considered.
 * A gap to something in a different row is not a gap anyone can see. */
export function spacingSnap(
  moving: Rect,
  others: Rect[],
  axis: 'x' | 'y',
  threshold: number,
): { d: number; gaps: Gap[] } | null {
  const cross = axis === 'x' ? 'y' : 'x'
  const m = span(moving, axis)
  const mc = span(moving, cross)
  const row = others
    .filter((o) => {
      const c = span(o, cross)
      return c.lo < mc.hi && c.hi > mc.lo
    })
    .map((o) => ({ r: o, ...span(o, axis) }))
    .sort((p, q) => p.lo - q.lo)
  if (row.length < 2) return null

  const size = m.hi - m.lo
  const at = (a: Rect, b: Rect) => {
    const ca = span(a, cross)
    const cb = span(b, cross)
    return (Math.max(ca.lo, cb.lo) + Math.min(ca.hi, cb.hi)) / 2
  }
  const bar = (lo: number, hi: number, a: Rect, b: Rect): Gap => ({
    axis,
    from: lo,
    to: hi,
    at: at(a, b),
  })

  const left = row.filter((o) => o.hi <= m.lo + 0.01)
  const right = row.filter((o) => o.lo >= m.hi - 0.01)
  const L = left[left.length - 1]
  const LL = left[left.length - 2]
  const Rt = right[0]
  const RR = right[1]

  interface Cand {
    lo: number
    gaps: Gap[]
  }
  const cands: Cand[] = []

  // centred between the two it sits among
  if (L && Rt && Rt.lo - L.hi > size) {
    const lo = (L.hi + Rt.lo - size) / 2
    cands.push({
      lo,
      gaps: [bar(L.hi, lo, L.r, moving), bar(lo + size, Rt.lo, moving, Rt.r)],
    })
  }
  // carrying on a rhythm the row already has, on either side
  if (L && LL && L.lo - LL.hi > 0.5) {
    const g = L.lo - LL.hi
    cands.push({
      lo: L.hi + g,
      gaps: [bar(LL.hi, L.lo, LL.r, L.r), bar(L.hi, L.hi + g, L.r, moving)],
    })
  }
  if (Rt && RR && RR.lo - Rt.hi > 0.5) {
    const g = RR.lo - Rt.hi
    cands.push({
      lo: Rt.lo - g - size,
      gaps: [bar(Rt.lo - g, Rt.lo, moving, Rt.r), bar(Rt.hi, RR.lo, Rt.r, RR.r)],
    })
  }

  let best: { d: number; gaps: Gap[] } | null = null
  for (const c of cands) {
    const d = c.lo - m.lo
    if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d)))
      best = { d, gaps: c.gaps }
  }
  return best
}

/* ---------- measuring ---------- */

/** A distance being reported between two shapes, with the number to print. */
export interface Measure {
  /** the axis the distance is measured along */
  axis: 'x' | 'y'
  from: number
  to: number
  /** where on the other axis to draw it */
  at: number
  /** dashed run out to the far shape, when the two do not share a band */
  reach?: { from: number; to: number }
  label: string
}

/* What holding the modifier over another shape should tell you: how far apart
 * they are, and where they already agree.
 *
 * The distance is only meaningful between the facing edges, so a pair that
 * overlaps on an axis reports nothing for that axis — there is no gap to name.
 * The bar is drawn through the band the two shapes share; when they share none,
 * it sits on the selection and reaches out to the other shape with a dashed
 * line, which is how you can tell the measurement is not a straight path
 * between them. */
export function measureBetween(a: Rect, b: Rect): Measure[] {
  const out: Measure[] = []
  const ax = [a.x, a.x + a.w]
  const bx = [b.x, b.x + b.w]
  const ay = [a.y, a.y + a.h]
  const by = [b.y, b.y + b.h]

  const band = (p: number[], q: number[]) => {
    const lo = Math.max(p[0], q[0])
    const hi = Math.min(p[1], q[1])
    return hi > lo ? (lo + hi) / 2 : null
  }

  const gap = (p: number[], q: number[]) =>
    q[0] >= p[1] ? [p[1], q[0]] : p[0] >= q[1] ? [q[1], p[0]] : null

  const gx = gap(ax, bx)
  if (gx && gx[1] - gx[0] > 0.5) {
    const shared = band(ay, by)
    const at = shared ?? (ay[0] + ay[1]) / 2
    out.push({
      axis: 'x',
      from: gx[0],
      to: gx[1],
      at,
      label: `${Math.round(gx[1] - gx[0])}`,
      reach: shared ? undefined : { from: Math.min(at, by[0], by[1]), to: Math.max(at, by[0], by[1]) },
    })
  }
  const gy = gap(ay, by)
  if (gy && gy[1] - gy[0] > 0.5) {
    const shared = band(ax, bx)
    const at = shared ?? (ax[0] + ax[1]) / 2
    out.push({
      axis: 'y',
      from: gy[0],
      to: gy[1],
      at,
      label: `${Math.round(gy[1] - gy[0])}`,
      reach: shared ? undefined : { from: Math.min(at, bx[0], bx[1]), to: Math.max(at, bx[0], bx[1]) },
    })
  }
  return out
}

/* The same question asked of the page instead of a neighbour: the four margins.
 *
 * A shape's place on a page *is* its distance to each edge — its own size and
 * the page's are already in the status bar, so there is nothing else to say.
 * Each bar runs through the middle of the shape on the other axis, which is
 * what keeps the four of them from piling onto one line.
 *
 * A margin of zero is left out and the alignment guide says it instead, the
 * same way `measureBetween` stays quiet about an axis two shapes share.
 *
 * The label is signed, so a shape hanging off the page reads as −12 rather
 * than as a 12 that looks exactly like the one inside it. The bar is drawn
 * where the overhang actually is: outside the frame. */
export function measureToFrame(a: Rect, frame: Rect): Measure[] {
  const out: Measure[] = []
  const cx = a.x + a.w / 2
  const cy = a.y + a.h / 2
  const bar = (axis: 'x' | 'y', margin: number, edge: number, side: number, at: number) => {
    if (Math.abs(margin) <= 0.5) return
    out.push({
      axis,
      from: Math.min(edge, side),
      to: Math.max(edge, side),
      at,
      label: `${Math.round(margin)}`,
    })
  }
  bar('x', a.x - frame.x, frame.x, a.x, cy)
  bar('x', frame.x + frame.w - (a.x + a.w), frame.x + frame.w, a.x + a.w, cy)
  bar('y', a.y - frame.y, frame.y, a.y, cx)
  bar('y', frame.y + frame.h - (a.y + a.h), frame.y + frame.h, a.y + a.h, cx)
  return out
}

/** Which of the two shapes' edges and centres already line up exactly. */
export function alignmentsBetween(a: Rect, b: Rect): Guide[] {
  return snapGuides(a, [b], 0.5).guides
}

/* Position and size are quantised differently, and that is the whole trick.
 *
 * A box that is an even number of cells across can put its edges *and* its
 * centre on grid lines — the same positions. An odd one cannot: the centre on a
 * line puts the edges on half cells, and vice versa. There is no third answer,
 * so any single lattice has to pick a winner and gets the other case wrong.
 *
 * Splitting the two settles it. Sizes move a whole cell at a time, so a box is
 * always a whole number of cells; positions land on halves, so the box can sit
 * flush against the checker *or* centred on it, and the user says which by
 * where they drop it. Odd and even both work, with no parity rule anywhere.
 *
 * The half lattice is also exactly what the canvas draws: cell corners and the
 * dot in the middle of each cell. */
export const snapPos = (v: number, grid: number) => Math.round(v / (grid / 2)) * (grid / 2)

/** Sizes are whole cells, never halves — that is the invariant that keeps the
 *  position lattice meaningful for both parities. */
export const snapSize = (v: number, grid: number) => Math.max(grid, Math.round(v / grid) * grid)

/** Which sides a resize handle is dragging. */
export interface MovedSides {
  l?: boolean
  r?: boolean
  t?: boolean
  b?: boolean
}

/** The resize counterpart of `snapGuides`: line the edge under the cursor up
 *  with a neighbour's edge or centre. Only the dragged sides move — snapping
 *  the whole box would resize the side the user is holding still. */
export function snapSides(
  rect: Rect,
  sides: MovedSides,
  others: Rect[],
  threshold: number,
): { rect: Rect; guides: Guide[] } {
  const guides: Guide[] = []
  const out = { ...rect }

  /** Nearest of the three alignment coordinates each neighbour offers. */
  const pull = (v: number, axis: 'x' | 'y') => {
    let best: { at: number; ref: Rect } | null = null
    for (const o of others) {
      const cs = axis === 'x' ? [o.x, o.x + o.w / 2, o.x + o.w] : [o.y, o.y + o.h / 2, o.y + o.h]
      for (const c of cs)
        if (Math.abs(c - v) <= threshold && (!best || Math.abs(c - v) < Math.abs(best.at - v)))
          best = { at: c, ref: o }
    }
    return best
  }
  const guideFor = (axis: 'x' | 'y', at: number, ref: Rect) => {
    const lo = axis === 'x' ? Math.min(rect.y, ref.y) : Math.min(rect.x, ref.x)
    const hi =
      axis === 'x'
        ? Math.max(rect.y + rect.h, ref.y + ref.h)
        : Math.max(rect.x + rect.w, ref.x + ref.w)
    guides.push({ axis, at, from: lo - 12, to: hi + 12 })
  }

  if (sides.l) {
    const hit = pull(rect.x, 'x')
    if (hit) {
      out.w = out.x + out.w - hit.at
      out.x = hit.at
      guideFor('x', hit.at, hit.ref)
    }
  } else if (sides.r) {
    const hit = pull(rect.x + rect.w, 'x')
    if (hit) {
      out.w = hit.at - out.x
      guideFor('x', hit.at, hit.ref)
    }
  }
  if (sides.t) {
    const hit = pull(rect.y, 'y')
    if (hit) {
      out.h = out.y + out.h - hit.at
      out.y = hit.at
      guideFor('y', hit.at, hit.ref)
    }
  } else if (sides.b) {
    const hit = pull(rect.y + rect.h, 'y')
    if (hit) {
      out.h = hit.at - out.y
      guideFor('y', hit.at, hit.ref)
    }
  }
  return { rect: out, guides }
}
