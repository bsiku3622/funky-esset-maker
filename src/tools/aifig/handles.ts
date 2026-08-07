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

export const anchorHandlePoint = (n: FigNode, k: string): Pt => {
  const uv = ANCHOR_UV[k] ?? { x: 0.5, y: 0.5 }
  const p = { x: n.x + n.w * uv.x, y: n.y + n.h * uv.y }
  return n.rotation ? rotatePt(p, rectCenter(n), n.rotation) : p
}
