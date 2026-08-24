/* Rectangles and projections — the geometry a panel is placed in.
 *
 * Separate from the components that use it because a module exporting both a
 * component and a plain function loses its Fast Refresh boundary, and because
 * the panel grid is worth testing without rendering anything. */

import type { Axis } from './scale'
import type { PanelSpec } from './spec'
import type { P } from './geom'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Proj {
  /** the panel draws its category axis vertically */
  flip: boolean
  /** axis carrying a datum's x */
  ax: Axis
  /** axis carrying a datum's y */
  ay: Axis
  at: (x: number, y: number) => P
  /** where the value axis reads `v` — the floor a bar rises from */
  vpx: (v: number) => number
  /** the plot rectangle */
  rect: Rect
}

export function makeProj(ax: Axis, ay: Axis, flip: boolean, rect: Rect): Proj {
  return {
    flip,
    ax,
    ay,
    at: (x, y) => (flip ? { x: ay.px(y), y: ax.px(x) } : { x: ax.px(x), y: ay.px(y) }),
    vpx: (v) => ay.px(v),
    rect,
  }
}

/** A panel is horizontal if the mark that cares says so. Orientation belongs to
 *  the panel, not to one series: a horizontal bar chart with a line drawn over
 *  it must flip the line too, or the two disagree about which way is up. */
export const panelFlip = (panel: PanelSpec): boolean =>
  panel.series.some((s) => !s.hidden && s.orient === 'h')

/** Panel rectangles for a figure of `n` panels in `cols` columns. */
export function panelGrid(n: number, cols: number, area: Rect, gap: number): Rect[] {
  const c = Math.max(1, Math.min(cols || 1, n || 1))
  const rows = Math.max(1, Math.ceil(n / c))
  const w = (area.w - gap * (c - 1)) / c
  const h = (area.h - gap * (rows - 1)) / rows
  return Array.from({ length: n }, (_, i) => ({
    x: area.x + (i % c) * (w + gap),
    y: area.y + Math.floor(i / c) * (h + gap),
    w,
    h,
  }))
}
