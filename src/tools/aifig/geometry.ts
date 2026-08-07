/* Anchors, connector routing, hit-testing and alignment guides.
 *
 * Every path is built as a list of segments so the same data can produce the
 * SVG `d` string *and* answer "where is t = 0.5 on this path, and which way is
 * it pointing" without touching the DOM — the exporter has no live SVG element
 * to call getPointAtLength on. */

import type { Anchor, FigNode, Pt, Rect, RouteKind } from './types'

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

export interface AnchorPoint {
  p: Pt
  /** outward direction, used to seed curve control points and ortho legs */
  dir: Pt
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

function rotateDir(d: Pt, deg: number): Pt {
  const a = rad(deg)
  return {
    x: d.x * Math.cos(a) - d.y * Math.sin(a),
    y: d.x * Math.sin(a) + d.y * Math.cos(a),
  }
}

/* ---------- path segments ---------- */

export type PathSeg =
  | { t: 'L'; a: Pt; b: Pt }
  | { t: 'C'; a: Pt; c1: Pt; c2: Pt; b: Pt }
  | { t: 'Q'; a: Pt; c: Pt; b: Pt }

const f = (v: number) => (Math.abs(v) < 1e-4 ? 0 : +v.toFixed(2))

export function pathD(segs: PathSeg[]): string {
  if (!segs.length) return ''
  let d = `M${f(segs[0].a.x)} ${f(segs[0].a.y)}`
  for (const s of segs) {
    if (s.t === 'L') d += ` L${f(s.b.x)} ${f(s.b.y)}`
    else if (s.t === 'Q') d += ` Q${f(s.c.x)} ${f(s.c.y)} ${f(s.b.x)} ${f(s.b.y)}`
    else
      d += ` C${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.b.x)} ${f(s.b.y)}`
  }
  return d
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

function segPoint(s: PathSeg, t: number): Pt {
  if (s.t === 'L') return lerp(s.a, s.b, t)
  if (s.t === 'Q') return lerp(lerp(s.a, s.c, t), lerp(s.c, s.b, t), t)
  const p0 = lerp(s.a, s.c1, t)
  const p1 = lerp(s.c1, s.c2, t)
  const p2 = lerp(s.c2, s.b, t)
  return lerp(lerp(p0, p1, t), lerp(p1, p2, t), t)
}

/** Flatten to a polyline for length-parameterised queries. */
function flatten(segs: PathSeg[], per = 24): Pt[] {
  const pts: Pt[] = []
  segs.forEach((s, i) => {
    const n = s.t === 'L' ? 1 : per
    for (let k = i === 0 ? 0 : 1; k <= n; k++) pts.push(segPoint(s, k / n))
  })
  return pts
}

export interface PathInfo {
  segs: PathSeg[]
  d: string
  pts: Pt[]
  len: number
}

export function pathInfo(segs: PathSeg[]): PathInfo {
  const pts = flatten(segs)
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return { segs, d: pathD(segs), pts, len }
}

/** Point + unit tangent at fraction `t` of the total length. */
export function atLength(info: PathInfo, t: number): { p: Pt; dir: Pt } {
  const pts = info.pts
  if (pts.length < 2) return { p: pts[0] ?? { x: 0, y: 0 }, dir: { x: 1, y: 0 } }
  const target = Math.max(0, Math.min(1, t)) * info.len
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (acc + d >= target || i === pts.length - 1) {
      const k = d === 0 ? 0 : (target - acc) / d
      const p = lerp(pts[i - 1], pts[i], k)
      const len = d || 1
      return {
        p,
        dir: { x: (pts[i].x - pts[i - 1].x) / len, y: (pts[i].y - pts[i - 1].y) / len },
      }
    }
    acc += d
  }
  return { p: pts[pts.length - 1], dir: { x: 1, y: 0 } }
}

/** Shorten both ends by the given amounts so filled arrow heads sit flush. */
export function trimPath(segs: PathSeg[], startBy: number, endBy: number): PathSeg[] {
  if (startBy <= 0 && endBy <= 0) return segs
  const out = segs.map((s) => ({ ...s }))
  if (startBy > 0 && out.length) {
    const s = out[0]
    const next = s.t === 'L' ? s.b : s.t === 'Q' ? s.c : s.c1
    const dx = next.x - s.a.x
    const dy = next.y - s.a.y
    const L = Math.hypot(dx, dy) || 1
    const k = Math.min(0.9, startBy / L)
    s.a = { x: s.a.x + dx * k, y: s.a.y + dy * k }
  }
  if (endBy > 0 && out.length) {
    const s = out[out.length - 1]
    const prev = s.t === 'L' ? s.a : s.t === 'Q' ? s.c : s.c2
    const dx = prev.x - s.b.x
    const dy = prev.y - s.b.y
    const L = Math.hypot(dx, dy) || 1
    const k = Math.min(0.9, endBy / L)
    s.b = { x: s.b.x + dx * k, y: s.b.y + dy * k }
  }
  return out
}

/* ---------- routing ---------- */

/** Build the segment list for an edge between two resolved anchors. */
export function route(
  kind: RouteKind,
  a: AnchorPoint,
  b: AnchorPoint,
  waypoints: Pt[],
  bow: number,
  radius = 8,
): PathSeg[] {
  const pts = [a.p, ...waypoints, b.p]

  if (kind === 'straight') return polyline(pts)

  if (kind === 'arc') {
    const dx = b.p.x - a.p.x
    const dy = b.p.y - a.p.y
    const L = Math.hypot(dx, dy) || 1
    const mid = { x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2 }
    const c = { x: mid.x - (dy / L) * bow * 2, y: mid.y + (dx / L) * bow * 2 }
    return [{ t: 'Q', a: a.p, c, b: b.p }]
  }

  if (kind === 'curve') {
    if (waypoints.length) return smoothPolyline(pts)
    const dx = b.p.x - a.p.x
    const dy = b.p.y - a.p.y
    const L = Math.max(28, Math.hypot(dx, dy) * 0.42)
    const da = len2(a.dir) ? a.dir : { x: Math.sign(dx) || 1, y: 0 }
    const db = len2(b.dir) ? b.dir : { x: -(Math.sign(dx) || 1), y: 0 }
    return [
      {
        t: 'C',
        a: a.p,
        c1: { x: a.p.x + da.x * L, y: a.p.y + da.y * L },
        c2: { x: b.p.x + db.x * L, y: b.p.y + db.y * L },
        b: b.p,
      },
    ]
  }

  // orthogonal
  return roundCorners(orthoPoints(a, b, waypoints, radius), radius)
}

const len2 = (p: Pt) => p.x * p.x + p.y * p.y > 1e-6

function polyline(pts: Pt[]): PathSeg[] {
  const segs: PathSeg[] = []
  for (let i = 1; i < pts.length; i++) segs.push({ t: 'L', a: pts[i - 1], b: pts[i] })
  return segs
}

/** Catmull-Rom → cubic Bézier, for a smooth line through user waypoints. */
function smoothPolyline(pts: Pt[]): PathSeg[] {
  if (pts.length < 3) return polyline(pts)
  const segs: PathSeg[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    segs.push({
      t: 'C',
      a: p1,
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      b: p2,
    })
  }
  return segs
}

const STUB = 18 // how far an ortho leg leaves the shape before turning

function orthoPoints(
  a: AnchorPoint,
  b: AnchorPoint,
  waypoints: Pt[],
  radius: number,
): Pt[] {
  if (waypoints.length) {
    // route through the waypoints with axis-aligned dog-legs
    const chain = [a.p, ...waypoints, b.p]
    const out: Pt[] = [chain[0]]
    for (let i = 1; i < chain.length; i++) {
      const p = out[out.length - 1]
      const q = chain[i]
      if (Math.abs(p.x - q.x) > 0.5 && Math.abs(p.y - q.y) > 0.5)
        out.push({ x: q.x, y: p.y })
      out.push(q)
    }
    return dedupe(out)
  }

  const horizA = Math.abs(a.dir.x) > Math.abs(a.dir.y)
  const horizB = Math.abs(b.dir.x) > Math.abs(b.dir.y)

  /* When the two stubs face each other, their combined length must fit in the
     gap — otherwise they overshoot past one another and every route from there
     is a knot. Shrink both symmetrically instead. */
  let stubA = STUB
  let stubB = STUB
  const facing =
    (horizA && horizB && a.dir.x * b.dir.x < 0) ||
    (!horizA && !horizB && a.dir.y * b.dir.y < 0)
  if (facing) {
    const gap = horizA ? Math.abs(b.p.x - a.p.x) : Math.abs(b.p.y - a.p.y)
    if (stubA + stubB > gap - 2) stubA = stubB = Math.max(4, (gap - 2) / 2)
  }
  const s = { x: a.p.x + a.dir.x * stubA, y: a.p.y + a.dir.y * stubA }
  const e = { x: b.p.x + b.dir.x * stubB, y: b.p.y + b.dir.y * stubB }

  /* Does travelling from `from` to `to` go the way the stub points? If not,
     the naive mid-point route doubles back over the shape it just left, which
     is what makes a connector look like it is cutting a corner. */
  const agrees = (from: Pt, to: Pt, d: Pt, horiz: boolean) =>
    horiz ? (to.x - from.x) * d.x >= -0.5 : (to.y - from.y) * d.y >= -0.5

  // Detour distance used when the direct route has no room for a full corner.
  const D = Math.max(STUB, radius * 2 + 6)

  /* Candidates in preference order. The first one whose legs are all long
     enough to host a full-radius fillet wins — that is what keeps corners
     visually identical instead of collapsing to a sharp angle when two shapes
     happen to sit close together. */
  const zx = (mx: number): Pt[] => [
    { x: mx, y: s.y },
    { x: mx, y: e.y },
  ]
  const zy = (my: number): Pt[] => [
    { x: s.x, y: my },
    { x: e.x, y: my },
  ]

  // detour lanes sit outside *both* stub ends, so each turn has a full leg
  const laneY = [Math.min(s.y, e.y) - D, Math.max(s.y, e.y) + D]
  const laneX = [Math.min(s.x, e.x) - D, Math.max(s.x, e.x) + D]
  const near = (lanes: number[], v: number) =>
    Math.abs(lanes[0] - v) <= Math.abs(lanes[1] - v) ? lanes : [lanes[1], lanes[0]]

  const cands: Pt[][] = []
  if (horizA && horizB) {
    if (agrees(s, e, a.dir, true) && agrees(e, s, b.dir, true)) cands.push(zx((s.x + e.x) / 2))
    for (const my of near(laneY, (s.y + e.y) / 2)) cands.push(zy(my))
    cands.push(zx(s.x + a.dir.x * D))
  } else if (!horizA && !horizB) {
    if (agrees(s, e, a.dir, false) && agrees(e, s, b.dir, false)) cands.push(zy((s.y + e.y) / 2))
    for (const mx of near(laneX, (s.x + e.x) / 2)) cands.push(zx(mx))
    cands.push(zy(s.y + a.dir.y * D))
  } else if (horizA) {
    // leave horizontally, arrive vertically
    if (agrees(s, e, a.dir, true)) cands.push([{ x: e.x, y: s.y }])
    cands.push(zx(s.x + a.dir.x * D))
    for (const my of near(laneY, s.y)) cands.push(zy(my))
  } else {
    if (agrees(s, e, a.dir, false)) cands.push([{ x: s.x, y: e.y }])
    cands.push(zy(s.y + a.dir.y * D))
    for (const mx of near(laneX, s.x)) cands.push(zx(mx))
  }

  for (const mids of cands) {
    const pts = dedupe([a.p, s, ...mids, e, b.p])
    if (legsFit(pts, radius)) return pts
  }
  return dedupe([a.p, s, ...cands[0], e, b.p])
}

/** Can every leg host the fillets of the corners at its ends, and does the
 *  route always move forward? A leg that reverses the previous one draws back
 *  over itself, which no amount of corner rounding can hide. */
function legsFit(pts: Pt[], radius: number): boolean {
  if (pts.length < 3) return true
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    const d = Math.hypot(dx, dy)
    const ends = (i === 1 ? 1 : 0) + (i === pts.length - 1 ? 1 : 0)
    if (d + 0.01 < radius * (2 - ends)) return false
    if (i > 1) {
      const px = pts[i - 1].x - pts[i - 2].x
      const py = pts[i - 1].y - pts[i - 2].y
      if (dx * px + dy * py < -0.01) return false // doubles back
    }
  }
  return true
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5)
      out.push(p)
  }
  return out
}

/** Circle approximation constant for a 90° cubic Bézier arc. */
const KAPPA = 0.5522847498

/** Replace each interior corner of a polyline with a circular fillet.
 *
 *  Two things this must never do, both of which produce a diagonal in what is
 *  supposed to be an axis-aligned route:
 *   - skip a vertex without moving the cursor to it (a corner too tight to
 *     fillet still has to be *reached*, otherwise the path cuts across it);
 *   - fillet a vertex that is not actually a corner, which turns a collinear
 *     point into a curve segment for no reason. */
function roundCorners(pts: Pt[], r: number): PathSeg[] {
  if (pts.length < 3 || r <= 0) return polyline(pts)
  const segs: PathSeg[] = []
  let cursor = pts[0]
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const prev = pts[i - 1]
    const next = pts[i + 1]
    const d1 = Math.hypot(p.x - prev.x, p.y - prev.y)
    const d2 = Math.hypot(next.x - p.x, next.y - p.y)
    if (d1 < 1e-6 || d2 < 1e-6) continue
    // collinear? nothing to round — leave it for the final straight run
    const cross =
      ((p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x)) / (d1 * d2)
    if (Math.abs(cross) < 1e-3) continue
    const rr = Math.min(r, d1 / 2, d2 / 2)
    if (rr < 0.5) {
      // too tight to fillet: keep the hard corner rather than cutting it off
      segs.push({ t: 'L', a: cursor, b: p })
      cursor = p
      continue
    }
    const in1 = { x: p.x + ((prev.x - p.x) / d1) * rr, y: p.y + ((prev.y - p.y) / d1) * rr }
    const out1 = { x: p.x + ((next.x - p.x) / d2) * rr, y: p.y + ((next.y - p.y) / d2) * rr }
    segs.push({ t: 'L', a: cursor, b: in1 })
    // cubic with the standard circle constant reads as a true rounded corner;
    // a quadratic through the vertex looks pinched at the same radius
    segs.push({
      t: 'C',
      a: in1,
      c1: { x: in1.x + (p.x - in1.x) * KAPPA, y: in1.y + (p.y - in1.y) * KAPPA },
      c2: { x: out1.x + (p.x - out1.x) * KAPPA, y: out1.y + (p.y - out1.y) * KAPPA },
      b: out1,
    })
    cursor = out1
  }
  segs.push({ t: 'L', a: cursor, b: pts[pts.length - 1] })
  return segs
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

export function rectsOverlap(a: Rect, b: Rect) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}

/** Distance from a point to a flattened path — for selecting a connector. */
export function distToPath(p: Pt, pts: Pt[]): number {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    best = Math.min(best, distToSeg(p, pts[i - 1], pts[i]))
    if (best < 0.5) break
  }
  return best
}

function distToSeg(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const L = dx * dx + dy * dy
  if (L === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
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
  guides: Guide[]
}

/** Nudge a moving bbox so its edges/centres line up with static ones.
 *  Threshold is in world units (already divided by zoom by the caller). */
export function snapGuides(
  moving: Rect,
  others: Rect[],
  threshold: number,
): SnapResult {
  const mx = [moving.x, moving.x + moving.w / 2, moving.x + moving.w]
  const my = [moving.y, moving.y + moving.h / 2, moving.y + moving.h]
  let bestX: { d: number; at: number; ref: Rect } | null = null
  let bestY: { d: number; at: number; ref: Rect } | null = null

  for (const o of others) {
    const ox = [o.x, o.x + o.w / 2, o.x + o.w]
    const oy = [o.y, o.y + o.h / 2, o.y + o.h]
    for (const a of mx)
      for (const b of ox) {
        const d = b - a
        if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d)))
          bestX = { d, at: b, ref: o }
      }
    for (const a of my)
      for (const b of oy) {
        const d = b - a
        if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d)))
          bestY = { d, at: b, ref: o }
      }
  }

  const guides: Guide[] = []
  if (bestX)
    guides.push({
      axis: 'x',
      at: bestX.at,
      from: Math.min(moving.y, bestX.ref.y) - 12,
      to: Math.max(moving.y + moving.h, bestX.ref.y + bestX.ref.h) + 12,
    })
  if (bestY)
    guides.push({
      axis: 'y',
      at: bestY.at,
      from: Math.min(moving.x, bestY.ref.x) - 12,
      to: Math.max(moving.x + moving.w, bestY.ref.x + bestY.ref.w) + 12,
    })
  return { dx: bestX?.d ?? 0, dy: bestY?.d ?? 0, guides }
}
