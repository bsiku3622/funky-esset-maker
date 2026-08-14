/* Connector routing invariants.
 *
 * These pin the properties that broke once already (see logs.md, 2026-08-07
 * "직각 커넥터 라우팅 재작성"): an orthogonal route that quietly grew a diagonal
 * because a too-tight corner was skipped without moving the cursor to it, and
 * corners that collapsed to near-square whenever two shapes sat close together.
 * Both are invisible in a unit test of a single pair — they only show up when
 * you sweep the whole spacing range, which is what the sweep below does. */

import { describe, expect, it } from 'vitest'
import { anchorPoint, atLength, orthoCorners, pathInfo, route, type PathSeg } from './geometry'
import type { Anchor, FigEdge, FigNode, Pt } from './types'
import { resolveEdge } from './resolve'

const RADIUS = 8

function node(x: number, y: number, w = 120, h = 60): FigNode {
  return {
    id: `n${x}-${y}`,
    kind: 'rect',
    x,
    y,
    w,
    h,
    rotation: 0,
    label: '',
    labelPos: 'center',
    style: {
      fill: '#fff',
      stroke: '#222',
      strokeWidth: 1,
      dash: 'solid',
      opacity: 1,
      radius: 0,
      fontFamily: 'sans',
      fontSize: 12,
      fontWeight: 400,
      italic: false,
      textColor: '#222',
      align: 'center',
      lineHeight: 1.2,
    },
    props: {},
    locked: false,
    hidden: false,
  }
}

const center = (n: FigNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 })

/** Route `a → b` the way the editor does: both ends on 'auto' anchors. */
function ortho(a: FigNode, b: FigNode, radius = RADIUS): PathSeg[] {
  return route(
    'ortho',
    anchorPoint(a, 'auto', center(b)),
    anchorPoint(b, 'auto', center(a)),
    [],
    0,
    radius,
  )
}

const isAxisAligned = (s: Extract<PathSeg, { t: 'L' }>) =>
  Math.abs(s.a.x - s.b.x) < 0.01 || Math.abs(s.a.y - s.b.y) < 0.01

/** A 90° fillet spans r·√2 between its endpoints, so the radius the router
 *  actually achieved can be read back off the curve. */
const filletRadius = (s: Extract<PathSeg, { t: 'C' }>) =>
  Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) / Math.SQRT2

/** Directions of the straight runs, in order. */
function runDirs(segs: PathSeg[]) {
  return segs
    .filter((s): s is Extract<PathSeg, { t: 'L' }> => s.t === 'L')
    .map((s) => ({ x: Math.sign(s.b.x - s.a.x), y: Math.sign(s.b.y - s.a.y) }))
}

describe('orthogonal routing', () => {
  it('keeps every straight run axis-aligned', () => {
    const segs = ortho(node(0, 0), node(300, 200))
    const straights = segs.filter((s): s is Extract<PathSeg, { t: 'L' }> => s.t === 'L')
    expect(straights.length).toBeGreaterThan(0)
    for (const s of straights) expect(isAxisAligned(s)).toBe(true)
  })

  it('never emits a diagonal, at any spacing', () => {
    const offending: string[] = []
    for (let dx = 4; dx <= 220; dx += 4) {
      for (let dy = 4; dy <= 220; dy += 4) {
        for (const s of ortho(node(0, 0), node(dx + 120, dy))) {
          if (s.t === 'L' && !isAxisAligned(s)) offending.push(`dx=${dx} dy=${dy}`)
        }
      }
    }
    expect(offending.slice(0, 5)).toEqual([])
  })

  it('never doubles back on itself', () => {
    const reversals: string[] = []
    for (let dx = 4; dx <= 220; dx += 4) {
      for (let dy = 4; dy <= 220; dy += 4) {
        const dirs = runDirs(ortho(node(0, 0), node(dx + 120, dy)))
        for (let i = 1; i < dirs.length; i++) {
          const dot = dirs[i].x * dirs[i - 1].x + dirs[i].y * dirs[i - 1].y
          if (dot < 0) reversals.push(`dx=${dx} dy=${dy}`)
        }
      }
    }
    expect(reversals.slice(0, 5)).toEqual([])
  })

  /* The rewrite's whole point: keep the corner radius fixed and bend the
     *route* when it will not fit, rather than shaving the radius. logs.md
     measured 88.8% of corners keeping the full radius over this sweep. */
  it('keeps the full corner radius on the large majority of routes', () => {
    let full = 0
    let total = 0
    for (let dx = 4; dx <= 220; dx += 4) {
      for (let dy = 4; dy <= 220; dy += 4) {
        for (const s of ortho(node(0, 0), node(dx + 120, dy))) {
          if (s.t !== 'C') continue
          total++
          if (filletRadius(s) > RADIUS - 0.05) full++
        }
      }
    }
    expect(total).toBeGreaterThan(1000)
    expect(full / total).toBeGreaterThan(0.88)
  })

  it('shrinks facing stubs instead of letting them overshoot', () => {
    // two nodes almost touching, facing each other: the classic knot case
    const segs = ortho(node(0, 0), node(126, 0))
    for (const s of segs) {
      if (s.t === 'L') expect(isAxisAligned(s)).toBe(true)
    }
    const dirs = runDirs(segs)
    for (let i = 1; i < dirs.length; i++) {
      expect(dirs[i].x * dirs[i - 1].x + dirs[i].y * dirs[i - 1].y).toBeGreaterThanOrEqual(0)
    }
  })

  /* A residual/skip connection leaves and arrives on the *same* side, so the
     target sits behind the stub. The detour lanes straddle both endpoints, and
     the one the router used to pick reached the far side by crossing back over
     the block it had just left — see logs.md, 2026-08-11. */
  it('routes a same-side skip connection outside both boxes', () => {
    const src = node(100, 90, 300, 95)
    const dst = node(188, 477, 80, 80)
    const segs = route(
      'ortho',
      anchorPoint(src, 'w', center(dst)),
      anchorPoint(dst, 'w', center(src)),
      [],
      0,
      RADIUS,
    )
    const inside = (p: { x: number; y: number }, n: FigNode) =>
      p.x > n.x + 1 && p.x < n.x + n.w - 1 && p.y > n.y + 1 && p.y < n.y + n.h - 1
    for (const p of pathInfo(segs).pts) {
      expect(inside(p, src)).toBe(false)
      expect(inside(p, dst)).toBe(false)
    }
  })

  it('does not round a collinear point into a curve', () => {
    // horizontally aligned neighbours: a straight shot, no corners at all
    const segs = ortho(node(0, 0), node(400, 0))
    expect(segs.every((s) => s.t === 'L')).toBe(true)
  })

  /* ⚠️ Both ends leaving upward, far apart across the page: up, across, down.
   * The router had no candidate for "cross at the target's own column" when
   * both stubs were vertical, so it fell through to the detour lanes — and
   * those straddle both endpoints, so the line set off *away* from where it was
   * going and opened with a pointless dog-leg before turning back. */
  it('goes up and across rather than doubling out sideways first', () => {
    const src = node(100, 200, 60, 40)
    const dst = node(900, 60, 60, 40)
    const p = pathInfo(
      route('ortho', anchorPoint(src, 'n', center(dst)), anchorPoint(dst, 'n', center(src)), [], 0, RADIUS),
    ).pts
    for (let i = 1; i < p.length; i++)
      expect(p[i].x).toBeGreaterThanOrEqual(p[i - 1].x - 0.01) // never travels left
    // and it never climbs above the lane it crosses on
    const top = Math.min(...p.map((q) => q.y))
    expect(top).toBeGreaterThan(dst.y - 40)
  })
})

/* ⚠️ Routing *through the user's bends* used to be a different, much dumber
 * function than routing without them: a horizontal-then-vertical dog-leg that
 * never looked at either anchor. So the moment a route had a single bend it
 * stopped leaving its shape properly — it set off sideways out of a top edge,
 * or turned straight back across the shape it had just left. */
describe('an orthogonal route with bends', () => {
  /** The corner polyline — the thing the router actually decides. */
  const corners = (
    a: FigNode,
    b: FigNode,
    wps: Pt[],
    anchors: [Anchor, Anchor] = ['auto', 'auto'],
  ) =>
    orthoCorners(
      anchorPoint(a, anchors[0], wps[0] ?? center(b)),
      anchorPoint(b, anchors[1], wps[wps.length - 1] ?? center(a)),
      wps,
      RADIUS,
    )

  it('keeps every run axis-aligned', () => {
    const p = corners(node(0, 0), node(400, 300), [{ x: 200, y: 40 }, { x: 260, y: 250 }])
    for (let i = 1; i < p.length; i++)
      expect(
        Math.abs(p[i].x - p[i - 1].x) < 0.01 || Math.abs(p[i].y - p[i - 1].y) < 0.01,
      ).toBe(true)
  })

  it('leaves along the anchor it was given, not sideways off it', () => {
    /* North anchor, bend directly to the left: the old router ran straight out
       of the middle of the top edge and read as a T-junction. */
    const a = node(200, 200)
    const p = corners(a, node(0, 0), [{ x: 40, y: 230 }], ['n', 'auto'])
    expect(p[0].y).toBeCloseTo(a.y, 6)
    // the first movement is upward, out of the shape
    expect(p[1].y).toBeLessThan(p[0].y - 1)
    expect(Math.abs(p[1].x - p[0].x)).toBeLessThan(0.5)
  })

  it('arrives along the far anchor rather than backing into the shape', () => {
    const b = node(400, 200)
    const p = corners(node(0, 0), b, [{ x: 200, y: 400 }], ['auto', 'w'])
    const last = p[p.length - 1]
    const before = p[p.length - 2]
    expect(last.x).toBeCloseTo(b.x, 6)
    // the final leg runs east into the west face, not north or south past it
    expect(before.y).toBeCloseTo(last.y, 6)
    expect(before.x).toBeLessThan(last.x)
  })

  /* Only the leg that *leaves* is promised: a bend placed behind the far end
     genuinely demands a U-turn, and honouring the bend is the right answer
     there. Turning back over the shape you just left never is. */
  it('never turns back over the shape it just left', () => {
    const cases: Pt[][] = [
      [{ x: 60, y: 300 }],
      [{ x: -80, y: 40 }, { x: 300, y: 260 }],
      [{ x: 300, y: -60 }, { x: 100, y: 400 }],
    ]
    for (const wps of cases) {
      const p = corners(node(0, 0), node(400, 300), wps)
      const lead = { x: p[1].x - p[0].x, y: p[1].y - p[0].y }
      const next = { x: p[2].x - p[1].x, y: p[2].y - p[1].y }
      expect(lead.x * next.x + lead.y * next.y).toBeGreaterThan(-0.01)
    }
  })

  it('passes through every bend it was given', () => {
    const wps = [{ x: 200, y: 40 }, { x: 260, y: 250 }]
    const p = corners(node(0, 0), node(400, 300), wps)
    for (const w of wps)
      expect(p.some((q) => Math.abs(q.x - w.x) < 0.02 && Math.abs(q.y - w.y) < 0.02)).toBe(true)
  })

  /* ⚠️ Replaying a route's own corners must land on exactly the same route.
   *
   * Dragging a run sideways stores every corner as a bend, and an 'auto' anchor
   * aims at the first bend — so the anchor moved, which moved the corners,
   * which moved the anchor. Each drag left a fresh jog behind and the line
   * crept off the shape. This is the fixed point that stops it, and it lives in
   * the resolver rather than the router: it is the *anchor* that has to settle
   * down. */
  it('replays its own corners unchanged', () => {
    const a = node(0, 0)
    const b = node(400, 300)
    const nodes = new Map([a, b].map((n) => [n.id, n] as const))
    const edge = (wps: Pt[]): FigEdge => ({
      id: 'e1',
      from: { node: a.id, anchor: 'auto' },
      to: { node: b.id, anchor: 'auto' },
      route: 'ortho',
      waypoints: wps.map((p) => ({ ...p })),
      startHead: 'none',
      endHead: 'arrow',
      label: '',
      labelT: 0.5,
      labelDx: 0,
      labelDy: 0,
      bow: 0,
      style: {
        stroke: '#222',
        strokeWidth: 1,
        dash: 'solid',
        opacity: 1,
        fontFamily: 'sans',
        fontSize: 11,
        textColor: '#222',
        labelBg: 'none',
      },
      locked: false,
      hidden: false,
    })
    const first = resolveEdge(edge([{ x: 200, y: 40 }]), nodes)!.corners
    let prev = first
    // three drags' worth: the creep only showed up on repetition
    for (let round = 0; round < 3; round++) {
      const next = resolveEdge(edge(prev.slice(1, -1)), nodes)!.corners
      expect(next.length).toBe(first.length)
      for (let i = 0; i < first.length; i++) {
        expect(next[i].x).toBeCloseTo(first[i].x, 6)
        expect(next[i].y).toBeCloseTo(first[i].y, 6)
      }
      prev = next
    }
  })
})

describe('path measurement', () => {
  it('reports a length that matches the walked polyline', () => {
    const info = pathInfo([
      { t: 'L', a: { x: 0, y: 0 }, b: { x: 30, y: 0 } },
      { t: 'L', a: { x: 30, y: 0 }, b: { x: 30, y: 40 } },
    ])
    expect(info.len).toBeCloseTo(70, 6)
  })

  it('parameterises by length, not by segment index', () => {
    // 30 across then 40 down: the midpoint by length is 5px down the second leg
    const info = pathInfo([
      { t: 'L', a: { x: 0, y: 0 }, b: { x: 30, y: 0 } },
      { t: 'L', a: { x: 30, y: 0 }, b: { x: 30, y: 40 } },
    ])
    const { p, dir } = atLength(info, 0.5)
    expect(p.x).toBeCloseTo(30, 6)
    expect(p.y).toBeCloseTo(5, 6)
    expect(dir).toEqual({ x: 0, y: 1 })
  })
})

/* Two shapes almost touching used to produce a connector far bigger than the
 * gap it spanned: a curve's handles have a 28px floor, an arc's bow is in px,
 * and an arrowhead is sized from the stroke — none of them looked at how much
 * room there actually was. */
describe('connectors shorter than their own decoration', () => {
  const chord = (segs: PathSeg[]) => {
    const pts = pathInfo(segs).pts
    const a = pts[0]
    const b = pts[pts.length - 1]
    return Math.hypot(b.x - a.x, b.y - a.y)
  }
  const sideways = (segs: PathSeg[]) => {
    const xs = pathInfo(segs).pts.map((p) => p.x)
    return Math.max(...xs) - Math.min(...xs)
  }
  /** two boxes stacked with `gap` between them, joined bottom-to-top */
  const pair = (kind: 'curve' | 'arc' | 'straight', gap: number, bow = 24) => {
    const a = node(100, 100, 60, 40)
    const b = node(100, 140 + gap, 60, 40)
    return route(kind, anchorPoint(a, 's', center(b)), anchorPoint(b, 'n', center(a)), [], bow, RADIUS)
  }

  it('does not loop a curve out further than the gap it spans', () => {
    for (const gap of [0, 2, 6, 14]) {
      const segs = pair('curve', gap)
      expect(pathInfo(segs).len).toBeLessThanOrEqual(gap + 0.5)
    }
  })

  it('keeps the handles long once there is room for them', () => {
    /* Two boxes stacked face to face give a curve whose handles lie along the
       chord, so the path is straight however long they are — the floor has to
       be read off the control point, not off the length. */
    const seg = pair('curve', 200)[0]
    expect(seg.t).toBe('C')
    if (seg.t !== 'C') return
    expect(Math.hypot(seg.c1.x - seg.a.x, seg.c1.y - seg.a.y)).toBeGreaterThan(28)
  })

  it('never bulges an arc wider than half its chord', () => {
    for (const gap of [2, 6, 14, 30, 200]) {
      const segs = pair('arc', gap)
      expect(sideways(segs)).toBeLessThanOrEqual(chord(segs) / 2 + 0.01)
    }
  })

  it('leaves a generous arc alone when the chord is long', () => {
    expect(sideways(pair('arc', 400))).toBeCloseTo(24, 0)
  })
})
