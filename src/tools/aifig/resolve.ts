/* Turn an edge's endpoints into concrete path geometry. Pure, so the editor
 * (hit testing, overlay handles) and the renderer share one answer. */

import type { EndPoint, FigEdge, FigNode, Pt, Rect } from './types'
import {
  anchorPoint,
  nodeBounds,
  orthoCorners,
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
  /** corner polyline of an orthogonal route; empty for the other kinds */
  corners: Pt[]
  /** the edge's bends in canvas coordinates, whatever they are stored as */
  wps: Pt[]
  /** heads shrink below 1 when the line is too short to carry them */
  headScale: number
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
  /* Bends anchored to an end are offsets from that end's node centre, so this
     is the one place they become canvas coordinates. The centre and not the
     anchor point: the anchor is what we are about to compute from them, and a
     definition cannot depend on its own result. */
  const wps: Pt[] = e.waypoints.map((w) =>
    w.rel === 'from'
      ? { x: ca.x + w.x, y: ca.y + w.y }
      : w.rel === 'to'
        ? { x: cb.x + w.x, y: cb.y + w.y }
        : { x: w.x, y: w.y },
  )
  // aim each anchor at the first waypoint (or the other end) so 'auto' picks
  // the side the line actually leaves from
  const towardA = wps[0] ?? cb
  const towardB = wps[wps.length - 1] ?? ca
  const a = endPointOf(e.from, nodes, towardA)
  const b = endPointOf(e.to, nodes, towardB)
  if (!a || !b) return null

  /* An 'auto' anchor already faces the other end, so it never routes back over
     itself; a hand-picked side can, which is what makes an ortho skip
     connection cut through the block it leaves. Hand the router the two boxes
     so it can rule those candidates out. */
  const boxes: Rect[] = []
  for (const ep of [e.from, e.to]) {
    if ('free' in ep) continue
    const n = nodes.get(ep.node)
    if (n && ep.anchor !== 'c') boxes.push(nodeBounds(n))
  }
  const segs = route(e.route, a, b, wps, e.bow, undefined, boxes)
  // the pre-fillet corners, so a run can be grabbed and slid sideways
  const corners = e.route === 'ortho' ? orthoCorners(a, b, wps, undefined, boxes) : []
  const info = pathInfo(segs)

  const sw = e.style.strokeWidth
  const hs = headGeom(e.startHead, sw)
  const he = headGeom(e.endHead, sw)
  /* Between two shapes that nearly touch there is less line than there is
     arrowhead: the head used to be drawn at full size on a 0.2px stub, so it
     stuck out of both of them and the connector read as a blob. Give the heads
     at most a third of the line each and scale them to match. */
  const want = (hs?.inset ?? 0) + (he?.inset ?? 0)
  const headScale = want > 0 ? Math.min(1, (info.len * 0.66) / want) : 1
  const strokeInfo = pathInfo(
    trimPath(segs, (hs?.inset ?? 0) * headScale, (he?.inset ?? 0) * headScale),
  )
  return { info, a, b, strokeInfo, corners, wps, headScale }
}
