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
import {
  alignmentsBetween,
  measureBetween,
  measureToFrame,
  snapGuides,
  snapPos,
  spacingSnap,
  type Sticky,
} from './geometry'
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

describe('spacingSnap', () => {
  const row = (xs: number[]) => xs.map((x) => R(x, 100, 60, 40))

  it('centres a block between the two it sits among', () => {
    // neighbours end at 160 and start at 320: centred means 210, so 207 pulls +3
    const s = spacingSnap(R(207, 100, 60, 40), row([100, 320]), 'x', 6)
    expect(s?.d).toBe(3)
    expect(s?.gaps).toHaveLength(2)
  })

  it('measures the two gaps it made equal', () => {
    const s = spacingSnap(R(207, 100, 60, 40), row([100, 320]), 'x', 6)!
    const widths = s.gaps.map((g) => +(g.to - g.from).toFixed(2))
    expect(widths).toEqual([50, 50])
  })

  it('carries on the rhythm a row already has', () => {
    // 100 and 200 are 40 apart; dropping a third near 300 should land on 300
    const s = spacingSnap(R(297, 100, 60, 40), row([100, 200]), 'x', 6)
    expect(s?.d).toBe(3)
  })

  /* A gap to something in another row is not a gap anyone can see, so shapes
     that do not overlap on the other axis must not take part. */
  it('ignores shapes that are not in the same row', () => {
    const elsewhere = [R(100, 400, 60, 40), R(320, 400, 60, 40)]
    expect(spacingSnap(R(200, 100, 60, 40), elsewhere, 'x', 6)).toBe(null)
  })

  it('stays quiet when nothing is close enough', () => {
    // 25px from the centred position, well past the threshold
    expect(spacingSnap(R(185, 100, 60, 40), row([100, 320]), 'x', 6)).toBe(null)
  })

  it('needs two neighbours before spacing means anything', () => {
    expect(spacingSnap(R(200, 100, 60, 40), row([100]), 'x', 6)).toBe(null)
  })
})

/* Holding the modifier over another shape asks two questions at once: how far
 * apart are we, and where do we already agree. */
describe('measureBetween', () => {
  it('measures the gap between the facing edges', () => {
    const m = measureBetween(R(100, 100, 96, 48), R(260, 100, 96, 48))
    expect(m).toHaveLength(1)
    expect(m[0].axis).toBe('x')
    expect(m[0].label).toBe('64')
    // drawn through the band the two share
    expect(m[0].at).toBe(124)
    expect(m[0].reach).toBeUndefined()
  })

  it('says nothing about an axis the two overlap on', () => {
    // side by side and vertically overlapping: only a horizontal gap exists
    const m = measureBetween(R(100, 100, 96, 48), R(260, 120, 96, 48))
    expect(m.map((x) => x.axis)).toEqual(['x'])
  })

  it('reports both axes when the shapes share no band at all', () => {
    const m = measureBetween(R(100, 100, 96, 48), R(300, 300, 96, 48))
    expect(m.map((x) => x.axis).sort()).toEqual(['x', 'y'])
    // and reaches out to the far shape, since the bar cannot touch it
    expect(m.every((x) => x.reach)).toBe(true)
  })

  it('measures nothing between shapes that overlap both ways', () => {
    expect(measureBetween(R(100, 100, 96, 48), R(120, 110, 96, 48))).toEqual([])
  })

  it('finds the edges the two already share', () => {
    const a = alignmentsBetween(R(100, 100, 96, 48), R(260, 100, 96, 48))
    expect(ys(a)).toEqual([100, 124, 148])
  })

  it('finds no alignment between shapes that share no edge', () => {
    expect(alignmentsBetween(R(100, 100, 96, 48), R(263, 137, 90, 40))).toEqual([])
  })
})

/* Pointing at bare canvas asks the same two questions of the page. */
describe('measureToFrame', () => {
  const PAGE = R(0, 0, 640, 400)
  const labels = (m: { axis: string; label: string }[]) =>
    m.map((x) => `${x.axis}${x.label}`).sort()

  it('reports all four margins', () => {
    const m = measureToFrame(R(100, 80, 96, 48), PAGE)
    // left 100, right 640-196, top 80, bottom 400-128
    expect(labels(m)).toEqual(['x100', 'x444', 'y272', 'y80'])
  })

  it('draws each bar through the middle of the shape on the other axis', () => {
    const m = measureToFrame(R(100, 80, 96, 48), PAGE)
    for (const x of m) expect(x.at).toBe(x.axis === 'x' ? 104 : 148)
  })

  it('leaves out a margin of zero and lets the guide say it instead', () => {
    // flush against the left edge: three bars, and an alignment where the
    // fourth would have been
    const box = R(0, 80, 96, 48)
    expect(labels(measureToFrame(box, PAGE))).toEqual(['x544', 'y272', 'y80'])
    expect(alignmentsBetween(box, PAGE).some((g) => g.axis === 'x' && g.at === 0)).toBe(true)
  })

  it('signs a margin the shape has spilled past', () => {
    const m = measureToFrame(R(-12, 80, 96, 48), PAGE)
    const left = m.find((x) => x.axis === 'x' && x.from < 0)!
    expect(left.label).toBe('-12')
    // and draws it where the overhang is, outside the page
    expect([left.from, left.to]).toEqual([-12, 0])
  })

  it('finds the shape sitting on the page centre', () => {
    const g = alignmentsBetween(R(272, 80, 96, 48), PAGE)
    expect(g.some((q) => q.axis === 'x' && q.at === 320)).toBe(true)
  })
})

/* The page is a snap target like any other drawn thing — the editor hands it to
 * `snapGuides` and `snapSides` as one more rect. What it is *not* is a shape,
 * and these pin that difference down. */
describe('snapping to the page', () => {
  const PAGE = R(0, 0, 460, 380)

  it('pulls a box onto the page centre and draws the line down the whole page', () => {
    // 460 wide, box 96 wide → centred at x 182; dropped 3px off
    const r = snapGuides(R(185, 100, 96, 48), [PAGE], 5)
    expect(r.dx).toBe(-3)
    const centre = r.guides.find((q) => q.axis === 'x' && q.at === 230)!
    expect(centre).toBeDefined()
    expect([centre.from, centre.to]).toEqual([-12, 392])
  })

  it('lands a box flush against the page edge', () => {
    const r = snapGuides(R(3, 100, 96, 48), [PAGE], 5)
    expect(r.dx).toBe(-3)
    expect(r.guides.some((q) => q.axis === 'x' && q.at === 0)).toBe(true)
  })

  it('beats the grid, which is the only reason the centre is reachable', () => {
    // ⚠️ 230 is not on the half-cell lattice of an 8px grid, so a box could
    // never sit centred on this page if the grid got a say. It does not: the
    // guide takes the axis outright and `snapPos` is skipped for it.
    expect(snapPos(230, 8)).not.toBe(230)
    expect(snapGuides(R(185, 100, 96, 48), [PAGE], 5).hitX).toBe(true)
  })

  it('never joins a row of shapes as one more block', () => {
    // one real neighbour plus the page is not two neighbours — an even gap to
    // the page edge is not a rhythm anyone laid out
    const neighbour = R(300, 100, 96, 48)
    expect(spacingSnap(R(180, 100, 96, 48), [neighbour, PAGE], 'x', 5)).toBeNull()
  })
})
