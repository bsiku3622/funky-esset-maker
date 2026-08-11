/* Alignment guides.
 *
 * The failure these pin down is a visual one, easy to miss in code. Dragging a
 * copy of a block alongside the original lines its top *and* its bottom up at
 * the same moment, but only one guide was ever drawn, and when the two blocks
 * are not pixel-identical the two alignments cannot both hold — so the winner
 * changed hands every time the pointer crossed the midpoint between them and
 * the guide flickered from one edge to the other several times a second.
 *
 * Two separate fixes, and they need separate tests: draw every line the chosen
 * shift really lands on, and stop the choice changing hands under jitter. */

import { describe, expect, it } from 'vitest'
import { snapGuides, type Sticky } from './geometry'
import type { Rect } from './types'

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

const ys = (g: { axis: string; at: number }[]) =>
  g.filter((q) => q.axis === 'y').map((q) => q.at).sort((a, b) => a - b)

describe('snapGuides', () => {
  it('draws both edges when both line up at once', () => {
    // a block 100 tall, dropped 2px low beside an identical one: top, centre
    // and bottom all land together, and all three have to be drawn
    const r = snapGuides(R(300, 102, 80, 100), [R(100, 100, 80, 100)], 5)
    expect(ys(r.guides)).toEqual([100, 150, 200])
    expect(r.dy).toBe(-2)
    expect(r.hitY).toBe(true)
  })

  it('lines a whole block up rather than clipping one edge to a passing neighbour', () => {
    /* Centre-to-centre with the second rect is 0px away and the first rect's
       three coordinates are all 3px away. The old rule took the nearest single
       match; agreeing in three places is the better answer. */
    const r = snapGuides(R(300, 103, 80, 100), [R(100, 100, 80, 100), R(500, 104, 80, 98)], 5)
    expect(r.dy).toBe(-3)
    expect(ys(r.guides)).toEqual([100, 150, 200])
  })

  /* When the moving box is a pixel taller than what it is next to, its top and
     its bottom simply cannot both land — no delta satisfies both. One answer is
     correct; the point is that it has to stay the same answer. */
  it('holds one answer while the pointer creeps across the midpoint', () => {
    const refs = [R(100, 100, 80, 40), R(100, 262, 80, 40)] // span 100..302
    let sticky: Sticky = { x: null, y: null }
    const seen = new Set<string>()
    for (let off = -3; off <= 3; off += 0.25) {
      const r = snapGuides(R(300, 100 + off, 80, 200), refs, 5, sticky)
      sticky = { x: r.atX, y: r.atY }
      seen.add(ys(r.guides).join(','))
    }
    expect([...seen]).toEqual(['100'])
  })

  it('without the lock, the same sweep is exactly what used to flicker', () => {
    const refs = [R(100, 100, 80, 40), R(100, 262, 80, 40)]
    const seen = new Set<string>()
    for (let off = -3; off <= 3; off += 0.25) {
      seen.add(ys(snapGuides(R(300, 100 + off, 80, 200), refs, 5).guides).join(','))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('still lets a deliberate move take over from the lock', () => {
    const refs = [R(100, 100, 80, 40), R(100, 262, 80, 40)]
    // locked on the top edge, then dragged far enough that the bottom is the
    // only alignment left in range at all
    const r = snapGuides(R(300, 106, 80, 200), refs, 5, { x: null, y: 100 })
    expect(r.atY).toBe(302)
  })

  it('merges references that share an edge into one line', () => {
    const r = snapGuides(R(300, 102, 80, 40), [R(100, 100, 80, 40), R(500, 100, 80, 40)], 5)
    // same height as both, so all three coordinates land at once
    expect(ys(r.guides)).toEqual([100, 120, 140])
    // the line has to reach across everything it claims to align
    const top = r.guides.find((g) => g.axis === 'y' && g.at === 100)!
    expect(top.from).toBeLessThanOrEqual(100 - 12)
    expect(top.to).toBeGreaterThanOrEqual(580 + 12)
  })

  it('finds nothing when there is nothing in range', () => {
    const r = snapGuides(R(300, 500, 80, 100), [R(100, 100, 80, 100)], 5)
    expect(r.hitY).toBe(false)
    expect(r.dy).toBe(0)
    expect(r.guides).toEqual([])
    expect(r.atY).toBe(null)
  })
})
