/* Turn an edge's endpoints into concrete path geometry. Pure, so the editor
 * (hit testing, overlay handles) and the renderer share one answer. */

import type { EndPoint, FigEdge, FigNode, Pt } from './types'
import {
  anchorPoint,
  pathInfo,
  route,
  trimPath,
  type AnchorPoint,
  type PathInfo,
} from './geometry'
import { headGeom } from './presets'

export interface ResolvedEdge {
  info: PathInfo
  a: AnchorPoint
  b: AnchorPoint
  /** path after trimming for filled heads — what actually gets stroked */
  strokeInfo: PathInfo
}

function endPointOf(
  ep: EndPoint,
  nodes: Map<string, FigNode>,
  toward: Pt,
): AnchorPoint | null {
  if ('free' in ep) return { p: ep.free, dir: { x: 0, y: 0 } }
  const n = nodes.get(ep.node)
  if (!n) return null
  return anchorPoint(n, ep.anchor, toward)
}

const centerOf = (ep: EndPoint, nodes: Map<string, FigNode>): Pt | null => {
  if ('free' in ep) return ep.free
  const n = nodes.get(ep.node)
  return n ? { x: n.x + n.w / 2, y: n.y + n.h / 2 } : null
}

/** Resolve an edge to concrete geometry. Returns null if an end node is gone. */
export function resolveEdge(
  e: FigEdge,
  nodes: Map<string, FigNode>,
): ResolvedEdge | null {
  const ca = centerOf(e.from, nodes)
  const cb = centerOf(e.to, nodes)
  if (!ca || !cb) return null
  // aim each anchor at the first waypoint (or the other end) so 'auto' picks
  // the side the line actually leaves from
  const towardA = e.waypoints[0] ?? cb
  const towardB = e.waypoints[e.waypoints.length - 1] ?? ca
  const a = endPointOf(e.from, nodes, towardA)
  const b = endPointOf(e.to, nodes, towardB)
  if (!a || !b) return null

  const segs = route(e.route, a, b, e.waypoints, e.bow)
  const info = pathInfo(segs)

  const sw = e.style.strokeWidth
  const hs = headGeom(e.startHead, sw)
  const he = headGeom(e.endHead, sw)
  const strokeInfo = pathInfo(trimPath(segs, hs?.inset ?? 0, he?.inset ?? 0))
  return { info, a, b, strokeInfo }
}
