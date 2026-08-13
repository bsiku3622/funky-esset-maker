/* Two gestures, one point.
 *
 * The connection dots used to sit on the edge midpoints — the same spot as the
 * n/s/e/w resize grips, painted after them. A circle of r 5.5 hides an 8px
 * square completely, so on any hovered shape those four grips could not be
 * grabbed: pressing one started a connector instead. Only the corners resized.
 *
 * The fix is spatial, so what has to be tested is the spacing. These pin the
 * gaps down in screen px; the constants are free to move as long as the dots,
 * the grips and the rotate knob still miss each other, and hover can still
 * reach a dot without letting go of the shape. */

import { describe, expect, it } from 'vitest'
import {
  ANCHOR_OUT,
  ANCHOR_R,
  ANCHOR_UV,
  GRIP,
  HANDLE_UV,
  HOVER_TOL,
  ROTATE_OUT,
  ROTATE_R,
  anchorHandlePoint,
  onAnchorDot,
} from './handles'
import type { FigNode } from './types'

const node = (over: Partial<FigNode> = {}): FigNode =>
  ({ id: 'n1', kind: 'rect', x: 100, y: 100, w: 120, h: 60, rotation: 0, ...over }) as FigNode

/** Screen-px distance from a dot to the grip it used to sit on top of. */
const dotToGrip = (n: FigNode, a: string) => {
  const uv = HANDLE_UV[a as keyof typeof HANDLE_UV]
  const grip = { x: n.x + n.w * uv.x, y: n.y + n.h * uv.y }
  const dot = anchorHandlePoint(n, a, ANCHOR_OUT) // k = 1: world px == screen px
  return Math.hypot(dot.x - grip.x, dot.y - grip.y)
}

describe('connection dots vs resize grips', () => {
  it('clears every grip it used to cover', () => {
    const n = node()
    for (const a of Object.keys(ANCHOR_UV)) {
      // the grip is a square, so its half-extent along the normal is GRIP
      expect(dotToGrip(n, a)).toBeGreaterThan(GRIP + ANCHOR_R)
    }
  })

  it('would have failed flush against the edge — which is the bug', () => {
    // out = 0 puts the dot dead centre on the grip, the way it used to be
    expect(anchorHandlePoint(node(), 'e', 0)).toEqual({ x: 220, y: 130 })
    for (const a of Object.keys(ANCHOR_UV)) {
      const dot = anchorHandlePoint(node(), a, 0)
      const uv = HANDLE_UV[a as keyof typeof HANDLE_UV]
      expect(dot).toEqual({ x: 100 + 120 * uv.x, y: 100 + 60 * uv.y })
    }
  })

  it('clears the rotate knob too', () => {
    // both sit above the top edge, on the same vertical line
    const gap = ROTATE_OUT - ROTATE_R - (ANCHOR_OUT + ANCHOR_R)
    expect(gap).toBeGreaterThan(0)
  })

  it('pushes each dot straight out along its own normal', () => {
    const n = node()
    expect(anchorHandlePoint(n, 'n', ANCHOR_OUT)).toEqual({ x: 160, y: 100 - ANCHOR_OUT })
    expect(anchorHandlePoint(n, 's', ANCHOR_OUT)).toEqual({ x: 160, y: 160 + ANCHOR_OUT })
    expect(anchorHandlePoint(n, 'e', ANCHOR_OUT)).toEqual({ x: 220 + ANCHOR_OUT, y: 130 })
    expect(anchorHandlePoint(n, 'w', ANCHOR_OUT)).toEqual({ x: 100 - ANCHOR_OUT, y: 130 })
  })

  it('carries the dots around with a rotated shape, offset and all', () => {
    // a quarter turn swings the east dot below the centre, still floating the
    // same distance past the edge it belongs to — 60 of half-width plus the 12
    const e = anchorHandlePoint(node({ rotation: 90 }), 'e', ANCHOR_OUT)
    expect(e.x).toBeCloseTo(160, 6)
    expect(e.y).toBeCloseTo(130 + 60 + ANCHOR_OUT, 6)
  })
})

describe('reaching a dot without losing the shape', () => {
  it('leaves no dead gap between the shape halo and the dot', () => {
    /* ⚠️ The pointer travels from inside the shape out to the dot. Hover holds
       on once it is *on* a dot, so the two regions have to overlap — a gap
       between them is a band where hover drops and the dot vanishes. */
    expect(ANCHOR_OUT - ANCHOR_R).toBeLessThan(HOVER_TOL)
  })

  it('holds the node while the pointer is out on a dot', () => {
    const n = node()
    const dot = anchorHandlePoint(n, 'e', ANCHOR_OUT)
    expect(onAnchorDot(dot, n, 1)).toBe(true)
    expect(onAnchorDot({ x: dot.x + 1, y: dot.y + 1 }, n, 1)).toBe(true)
  })

  it('lets go everywhere else', () => {
    const n = node()
    expect(onAnchorDot({ x: 160, y: 130 }, n, 1)).toBe(false) // dead centre
    expect(onAnchorDot({ x: 300, y: 130 }, n, 1)).toBe(false) // well outside
    // and on the grip itself, which now belongs to resize alone
    expect(onAnchorDot({ x: 220, y: 130 }, n, 1)).toBe(false)
  })

  it('scales the dots with the zoom, so they stay a constant size on screen', () => {
    const n = node()
    // at 2x zoom (k = 0.5) the dot sits half as far out in world units
    const near = anchorHandlePoint(n, 'e', ANCHOR_OUT * 0.5)
    expect(near.x).toBe(220 + ANCHOR_OUT / 2)
    expect(onAnchorDot(near, n, 0.5)).toBe(true)
    // and the far one is no longer under the pointer at that zoom
    expect(onAnchorDot(anchorHandlePoint(n, 'e', ANCHOR_OUT), n, 0.5)).toBe(false)
  })
})
