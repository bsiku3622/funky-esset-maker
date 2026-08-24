/* The router is shared by two editors that have nothing else in common, so what
 * matters here is the part of the contract that does not mention a figure node:
 * anchors in, segments out. AI Figure Maker's own routing invariants — the ones
 * that broke once and are swept across a spacing range — live in
 * `aifig/geometry.test.ts`; these pin that the same router is usable from a
 * plain rectangle, which is all Grapher has. */

import { describe, expect, it } from 'vitest'
import {
  atLength,
  pathD,
  pathInfo,
  route,
  type AnchorPoint,
  type Pt,
  type Rect,
} from './routing'

const box = (x: number, y: number, w = 120, h = 50): Rect => ({ x, y, w, h })

/** The anchor Grapher builds: a point on a box's edge, facing squarely out. */
function anchorOn(r: Rect, toward: Pt): AnchorPoint {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  const sx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx)
  const sy = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy)
  const s = Math.min(sx, sy)
  return {
    p: { x: cx + dx * s, y: cy + dy * s },
    dir: sx <= sy ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) },
  }
}

const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

function connect(a: Rect, b: Rect, kind: 'straight' | 'ortho' | 'curve' | 'arc') {
  const pa = anchorOn(a, centre(b))
  const pb = anchorOn(b, centre(a))
  return route(kind, pa, pb, [], 32, 12, [a, b])
}

describe('routing from bare rectangles', () => {
  it('joins two boxes without being told what they are', () => {
    const segs = connect(box(0, 0), box(400, 300), 'straight')
    expect(segs).toHaveLength(1)
    expect(pathD(segs)).toMatch(/^M[\d.-]+ [\d.-]+ L[\d.-]+ [\d.-]+$/)
  })

  it('keeps an orthogonal route axis-aligned', () => {
    const segs = connect(box(0, 0), box(400, 300), 'ortho')
    for (const s of segs) {
      if (s.t !== 'L') continue // corner fillets are curves by design
      const dx = Math.abs(s.b.x - s.a.x)
      const dy = Math.abs(s.b.y - s.a.y)
      expect(Math.min(dx, dy)).toBeLessThan(0.01)
    }
  })

  it('stays out of the two boxes it connects', () => {
    const a = box(0, 0)
    const b = box(400, 300)
    const inside = (p: Pt, r: Rect) =>
      p.x > r.x + 1.5 && p.x < r.x + r.w - 1.5 && p.y > r.y + 1.5 && p.y < r.y + r.h - 1.5
    for (const p of pathInfo(connect(a, b, 'ortho')).pts) {
      expect(inside(p, a)).toBe(false)
      expect(inside(p, b)).toBe(false)
    }
  })

  /* An arrow head is placed along the path's final direction. On an orthogonal
     route that is the last leg — not the line between the two ends, which is
     what a straight-line renderer would have used and would point the head
     diagonally into the side of the box. */
  it('ends along its own last leg, not along the line between the ends', () => {
    const a = box(0, 0)
    const b = box(400, 300)
    const tip = atLength(pathInfo(connect(a, b, 'ortho')), 1)
    // the far box is entered squarely: one component of the direction is ~0
    expect(Math.min(Math.abs(tip.dir.x), Math.abs(tip.dir.y))).toBeLessThan(0.01)
  })

  it('bows an arc to one side of the straight line', () => {
    const a = box(0, 0)
    const b = box(0, 300)
    const segs = connect(a, b, 'arc')
    expect(segs).toHaveLength(1)
    expect(segs[0].t).toBe('Q')
  })

  it('leaves a curve tangent to the side it starts from', () => {
    const segs = connect(box(0, 0), box(400, 0), 'curve')
    expect(segs[0].t).toBe('C')
    if (segs[0].t !== 'C') return
    // the first control point continues straight out of the box's east side
    expect(segs[0].c1.y).toBeCloseTo(segs[0].a.y, 5)
    expect(segs[0].c1.x).toBeGreaterThan(segs[0].a.x)
  })
})
