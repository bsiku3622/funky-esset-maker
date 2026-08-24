/* Connector routing — the geometry behind a line drawn between two shapes.
 *
 * This is the half of the drawing that knows nothing about what it is joining:
 * it takes two anchor points (a position and the direction the line leaves in),
 * optional bends, and boxes to stay out of, and returns path segments. No node
 * type, no document, no DOM — which is why both editors can use it. AI Figure
 * Maker resolves its own shapes down to anchors (`aifig/resolve.ts`), Grapher
 * does the same from a plain rectangle.
 *
 * Paths are built as a list of segments rather than an SVG `d` string, so the
 * same data answers "where is t = 0.5 along this, and which way does it point"
 * without a live element to call getPointAtLength on — the exporter has none.
 *
 * ⚠️ Everything here is pure. Keep it that way: it is shared, and the moment it
 * reaches for a node's fields it stops being shareable. */

export interface Pt {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type RouteKind = 'straight' | 'ortho' | 'curve' | 'arc'

export interface AnchorPoint {
  p: Pt
  /** outward direction, used to seed curve control points and ortho legs */
  dir: Pt
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
  /** boxes an orthogonal route should not run through — the endpoint shapes */
  avoid: Rect[] = [],
): PathSeg[] {
  const pts = [a.p, ...waypoints, b.p]

  if (kind === 'straight') return polyline(pts)

  if (kind === 'arc') {
    const dx = b.p.x - a.p.x
    const dy = b.p.y - a.p.y
    const L = Math.hypot(dx, dy) || 1
    const mid = { x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2 }
    /* The bow is in px, so between two shapes almost touching it used to throw
       a 24px belly out of a 2px gap. Nothing may bulge further than the chord
       it spans. */
    const k = Math.sign(bow) * Math.min(Math.abs(bow), L / 2)
    const c = { x: mid.x - (dy / L) * k * 2, y: mid.y + (dx / L) * k * 2 }
    return [{ t: 'Q', a: a.p, c, b: b.p }]
  }

  if (kind === 'curve') {
    if (waypoints.length) return smoothPolyline(pts)
    const dx = b.p.x - a.p.x
    const dy = b.p.y - a.p.y
    /* ⚠️ The 28px floor keeps a short curve from going limp, but on its own it
       meant two shapes 2px apart were joined by a 31px loop: the handles stuck
       out further than the gap they were spanning. It only applies while there
       is room for it. */
    const dist = Math.hypot(dx, dy)
    const L = Math.min(Math.max(28, dist * 0.42), dist * 0.5)
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
  return roundCorners(orthoPoints(a, b, waypoints, radius, avoid), radius)
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

/** The corner polyline behind an orthogonal route, before the fillets go on.
 *  The editor needs it to let a run be dragged sideways: the rounded path has
 *  no corners left to grab. */
export function orthoCorners(
  a: AnchorPoint,
  b: AnchorPoint,
  waypoints: Pt[],
  radius = 8,
  avoid: Rect[] = [],
): Pt[] {
  return orthoPoints(a, b, waypoints, radius, avoid)
}

function orthoPoints(
  a: AnchorPoint,
  b: AnchorPoint,
  waypoints: Pt[],
  radius: number,
  avoid: Rect[],
): Pt[] {
  if (waypoints.length) return orthoThrough(a, b, waypoints)

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
    /* Both stubs point the same way and the target is behind us — the skip
       connection case. Run down the lane the stub already opened and come in
       along the target's row: one bend, and it stays outside both shapes. Try
       this before the detour lanes, which straddle the endpoints and can only
       reach the far side by crossing back over the node they left. */
    cands.push(zy(e.y))
    /* ⚠️ And the same trick on the other axis, which is the one that was
       missing. Both stubs pointing the same way is only half the story; the
       far end may be *beside* rather than behind, and then the route wants to
       cross at the target's own column. Without it the router fell through to
       the detour lanes, which straddle both endpoints — so a connector that
       should have gone up-and-across set off in the wrong direction first,
       opening with a pointless little dog-leg away from where it was going. */
    cands.push(zx(e.x))
    for (const my of near(laneY, (s.y + e.y) / 2)) cands.push(zy(my))
    cands.push(zx(s.x + a.dir.x * D))
  } else if (!horizA && !horizB) {
    if (agrees(s, e, a.dir, false) && agrees(e, s, b.dir, false)) cands.push(zy((s.y + e.y) / 2))
    cands.push(zx(e.x))
    cands.push(zy(e.y))
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

  /* Two passes: first insist the route stays out of the shapes it connects,
     then take the best-fitting one regardless. Without the second pass a
     cramped layout would lose its rounded corners rather than its overlap,
     and a corner is the cheaper thing to give up. */
  for (const strict of [true, false]) {
    for (const mids of cands) {
      const pts = straighten(dedupe([a.p, s, ...mids, e, b.p]))
      if (!legsFit(pts, radius)) continue
      if (strict && !clearOf(pts, avoid)) continue
      return pts
    }
  }
  return straighten(dedupe([a.p, s, ...cands[0], e, b.p]))
}

/* Drop a vertex that is not a corner.
 *
 * ⚠️ A stub and the leg after it often run the same way — leave a shape
 * upward, then carry on upward to the lane you are crossing on — and that
 * leaves a vertex sitting in the middle of a straight run. `roundCorners`
 * already knows not to fillet it, but `legsFit` counted it as two legs and
 * demanded a full corner radius of room for each. So the router *rejected*
 * routes for having a straight line in them: the sensible up-and-across
 * candidate kept failing on a 13px phantom leg and the line fell back to a
 * detour that set off in the wrong direction first.
 *
 * Only exactly-collinear, same-direction vertices go. A sub-pixel jog between
 * two long runs is a real corner — see `dedupe`. */
function straighten(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const p = out[out.length - 1]
    const q = pts[i]
    const r = pts[i + 1]
    const sameX = Math.abs(p.x - q.x) < 0.01 && Math.abs(q.x - r.x) < 0.01
    const sameY = Math.abs(p.y - q.y) < 0.01 && Math.abs(q.y - r.y) < 0.01
    const forward = sameX
      ? (q.y - p.y) * (r.y - q.y) >= 0
      : sameY
        ? (q.x - p.x) * (r.x - q.x) >= 0
        : false
    if ((sameX || sameY) && forward) continue
    out.push(q)
  }
  out.push(pts[pts.length - 1])
  return out
}

/* An orthogonal route that has to pass through the user's bends.
 *
 * ⚠️ This was a plain horizontal-then-vertical dog-leg through the chain, and
 * it threw away both things that make an ortho route read as one: the anchors'
 * directions and the stubs. Two visible failures came out of that. A connector
 * leaving the *top* of a shape would set off sideways from the middle of that
 * edge — a T-junction, not a connector. And a bend placed behind the anchor
 * turned the first leg straight back across the shape it had just left.
 *
 * So: leave along `a.dir`, arrive along `b.dir`, and pick each corner's
 * handedness from the direction already being travelled instead of always
 * turning the same way. The bends themselves are untouched — they are the
 * user's, and a router that quietly moved them would be a worse bug than the
 * one it fixed. */
function orthoThrough(a: AnchorPoint, b: AnchorPoint, waypoints: Pt[]): Pt[] {
  const first = waypoints[0]
  const last = waypoints[waypoints.length - 1]
  /* Is `q` out in front of the shape, the way the anchor faces? A bend that is
     already out there *is* the stub, which is what keeps this idempotent: a
     run dragged sideways stores its corners, and re-routing them must not
     grow a second stub every time. */
  const ahead = (p: Pt, q: Pt, d: Pt) => (q.x - p.x) * d.x + (q.y - p.y) * d.y > 0.5

  const chain: Pt[] = [a.p]
  if (len2(a.dir) && !ahead(a.p, first, a.dir))
    chain.push({ x: a.p.x + a.dir.x * STUB, y: a.p.y + a.dir.y * STUB })
  chain.push(...waypoints)
  if (len2(b.dir) && !ahead(b.p, last, b.dir))
    chain.push({ x: b.p.x + b.dir.x * STUB, y: b.p.y + b.dir.y * STUB })
  chain.push(b.p)

  const pts = dedupe(chain)
  const out: Pt[] = [pts[0]]
  // the leg just travelled, seeded by the anchor so the first turn continues
  // the way the line leaves its shape
  let t: Pt = a.dir
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1]
    const q = pts[i]
    const dx = q.x - p.x
    const dy = q.y - p.y
    if (Math.abs(dx) > 0.5 && Math.abs(dy) > 0.5) {
      /* Carry on along the current axis and turn late — that reads as one
         corner rather than two — unless carrying on would double back over the
         leg just drawn, in which case turn first and travel after. The corner
         into the far end is the exception: the leg that arrives has to point
         the way that endpoint faces, or the line finishes by running into the
         shape and backing out of it. */
      const arriving = i === pts.length - 1 && len2(b.dir)
      const horizFirst = arriving
        ? Math.abs(b.dir.y) > Math.abs(b.dir.x)
        : !len2(t)
          ? true
          : Math.abs(t.x) > Math.abs(t.y)
            ? dx * t.x >= 0
            : dy * t.y < 0
      out.push(horizFirst ? { x: q.x, y: p.y } : { x: p.x, y: q.y })
    }
    const prev = out[out.length - 1]
    out.push(q)
    t = { x: q.x - prev.x, y: q.y - prev.y }
  }
  /* Deliberately not straightened: a bend sitting in the middle of a straight
     run is still the user's bend, and the corner list is what the run-dragging
     grabs hold of. `roundCorners` already declines to fillet it. */
  return dedupe(out)
}

/** Does an axis-aligned leg run through `r`? The margin keeps a stub that
 *  starts on the outline — every stub does — from counting as a crossing. */
function segInRect(p: Pt, q: Pt, r: Rect) {
  const m = 1.5
  return (
    Math.max(p.x, q.x) > r.x + m &&
    Math.min(p.x, q.x) < r.x + r.w - m &&
    Math.max(p.y, q.y) > r.y + m &&
    Math.min(p.y, q.y) < r.y + r.h - m
  )
}

function clearOf(pts: Pt[], rects: Rect[]) {
  if (!rects.length) return true
  for (let i = 1; i < pts.length; i++)
    for (const r of rects) if (segInRect(pts[i - 1], pts[i], r)) return false
  return true
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

/* Drop repeated points only when they are *actually* the same point.
 *
 * ⚠️ This tolerance must stay tiny. Two nodes are rarely aligned to the pixel,
 * so an ortho route often contains a sub-pixel jog — a leg a quarter of a pixel
 * long — between two long axis-aligned runs. Merging that jog away does not
 * remove the offset; it moves it into the neighbouring legs, and they become
 * diagonals in a route that is supposed to be square. A short leg is harmless
 * (roundCorners keeps it as a hard corner and nobody can see a 0.25px step),
 * so keep it. */
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01)
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

/** Where along a path a point lands, as a 0..1 fraction of its length.
 *  The inverse of `atLength`, so dragging something that rides the path can
 *  be expressed as "which t is nearest the cursor". */
export function nearestT(info: PathInfo, p: Pt): number {
  const pts = info.pts
  if (pts.length < 2 || info.len <= 0) return 0
  let best = Infinity
  let at = 0
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const L2 = dx * dx + dy * dy
    const seg = Math.sqrt(L2)
    // clamp to the segment: the nearest point on an open polyline is never
    // beyond an end, and letting u escape 0..1 would return a t off the path
    const u = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2))
    const d = Math.hypot(p.x - (a.x + dx * u), p.y - (a.y + dy * u))
    if (d < best) {
      best = d
      at = acc + seg * u
    }
    acc += seg
  }
  return Math.max(0, Math.min(1, at / info.len))
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

export function distToSeg(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const L = dx * dx + dy * dy
  if (L === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}
