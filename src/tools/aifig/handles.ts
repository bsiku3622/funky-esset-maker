/* Handle geometry for the selection overlay: resize grips, the rotate knob and
 * the four connection anchors. Kept apart from the overlay component so the
 * pointer handlers in the editor can reuse the same coordinates. */

import type { FigNode, Pt } from './types'
import { rectCenter, rotatePt } from './geometry'

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type HandleKey = (typeof HANDLES)[number]

export const HANDLE_UV: Record<HandleKey, Pt> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
}

export const CURSOR: Record<HandleKey, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

export const handlePoint = (n: FigNode, k: HandleKey): Pt => {
  const uv = HANDLE_UV[k]
  const p = { x: n.x + n.w * uv.x, y: n.y + n.h * uv.y }
  return n.rotation ? rotatePt(p, rectCenter(n), n.rotation) : p
}

export const ANCHOR_UV: Record<string, Pt> = {
  n: { x: 0.5, y: 0 },
  s: { x: 0.5, y: 1 },
  e: { x: 1, y: 0.5 },
  w: { x: 0, y: 0.5 },
}

/* ⚠️ The connection dots float *outside* the box, and they have to.
 *
 * They used to sit on the edge midpoints — which is exactly where the n/s/e/w
 * resize grips are, and they were painted after them. A circle of r 5.5 covers
 * an 8px square completely, so on any hovered shape those four grips could not
 * be grabbed at all: pressing one started a connector. Only the corners still
 * resized. Two meanings on one point cannot be told apart by z-order, so the
 * dots move off it and each gesture gets its own target.
 *
 * All three numbers are screen px and they have to stay consistent with each
 * other; `handles.test.ts` pins the gaps down. */
/** How far past the edge the dots float. */
export const ANCHOR_OUT = 12
/** Dot radius. */
export const ANCHOR_R = 5.5
/** Resize grip half-width — the grips are `2 * GRIP` squares centred on a corner. */
export const GRIP = 4
/** How far above the box the rotate knob sits, and its radius. */
export const ROTATE_OUT = 28
export const ROTATE_R = 4.5
/** How far past the box hover still picks a node up. */
export const HOVER_TOL = 9

/** Where a connection dot is drawn. `out` is the float distance in *world*
 *  units — pass `ANCHOR_OUT / zoom`, or 0 for the bare attachment point. */
export const anchorHandlePoint = (n: FigNode, k: string, out = 0): Pt => {
  const uv = ANCHOR_UV[k] ?? { x: 0.5, y: 0.5 }
  const p = {
    x: n.x + n.w * uv.x + (uv.x - 0.5) * 2 * out,
    y: n.y + n.h * uv.y + (uv.y - 0.5) * 2 * out,
  }
  return n.rotation ? rotatePt(p, rectCenter(n), n.rotation) : p
}

/* Reaching for a floating dot takes the pointer off the shape, so plain hover
 * tolerance would drop the node — and unmount the dot — before you got there.
 * Hover holds on to the node it already has while the pointer is out on one of
 * its dots, which is what this answers. Widening the tolerance instead would
 * have worked too, and would have made every node grabbier by the same amount:
 * the shape's own halo is for *finding* it, not for reaching its dots. */
export const onAnchorDot = (p: Pt, n: FigNode, k: number): boolean => {
  const r = (ANCHOR_R + 2) * k
  return Object.keys(ANCHOR_UV).some((a) => {
    const q = anchorHandlePoint(n, a, ANCHOR_OUT * k)
    return (p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= r * r
  })
}
