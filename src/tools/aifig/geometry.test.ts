/* Connector routing invariants.
 *
 * These pin the properties that broke once already (see logs.md, 2026-08-07
 * "직각 커넥터 라우팅 재작성"): an orthogonal route that quietly grew a diagonal
 * because a too-tight corner was skipped without moving the cursor to it, and
 * corners that collapsed to near-square whenever two shapes sat close together.
 * Both are invisible in a unit test of a single pair — they only show up when
 * you sweep the whole spacing range, which is what the sweep below does. */

import { describe, expect, it } from 'vitest'
import { anchorPoint, atLength, pathInfo, route, type PathSeg } from './geometry'
import type { FigNode } from './types'

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
