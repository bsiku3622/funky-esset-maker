/* Turn an edge's endpoints into concrete path geometry. Pure, so the editor
 * (hit testing, overlay handles) and the renderer share one answer. */

import type { Anchor, EndPoint, FigEdge, FigNode, Pt, Rect } from './types'
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
import { mlpAnchorPoint, mlpPartCentre } from './mlp'

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
  if (ep.part) {
    const a = mlpAnchorPoint(n, ep.part, ep.anchor, toward)
    // the part may have stopped being drawn; fall back to the node itself
    if (a) return a
  }
  return anchorPoint(n, ep.anchor, toward)
}

/** The fixed side an 'auto' anchor has ended up using. */
const sideOf = (d: Pt): Anchor =>
  Math.abs(d.x) >= Math.abs(d.y) ? (d.x >= 0 ? 'e' : 'w') : d.y >= 0 ? 's' : 'n'

const centerOf = (ep: EndPoint, nodes: Map<string, FigNode>): Pt | null => {
  if ('free' in ep) return ep.free
  const n = nodes.get(ep.node)
  if (!n) return null
  if (ep.part) {
    const p = mlpPartCentre(n, ep.part)
    if (p) return p
  }
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 }
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
  let a = endPointOf(e.from, nodes, towardA)
  let b = endPointOf(e.to, nodes, towardB)
  if (!a || !b) return null

  /* Two things an orthogonal route needs from its ends that the others do not.
   *
   * ⚠️ It must leave along an *axis*. `anchorPoint` snaps a shape's 'auto'
   * direction to the dominant one for exactly this reason, but a neuron or a
   * group resolves through `mlpAnchorPoint`, which points straight at the
   * target — so a connector leaving a circle began with a short diagonal stub
   * before its first right angle, a diagonal in a route that is square by
   * definition.
   *
   * ⚠️ And it must stop sliding once it has been routed by hand. An 'auto'
   * anchor slides along the face toward whatever it is aimed at, and with bends
   * it is aimed at the first bend. Dragging a run stores the route's corners as
   * bends — so the anchor moved, which moved the corners, which moved the
   * anchor, and each drag left a fresh jog behind as the line crept off the
   * shape.
   *
   * Both are answered by committing to the side already in use. A shape with no
   * bends is left alone: its direction is square already, and a point that
   * slides along an edge is what lets a row of connectors fan out. */
  if (e.route === 'ortho') {
    const square = (ep: EndPoint, at: AnchorPoint, toward: Pt) =>
      'node' in ep && ep.anchor === 'auto' && (ep.part || wps.length)
        ? (endPointOf({ ...ep, anchor: sideOf(at.dir) }, nodes, toward) ?? at)
        : at
    a = square(e.from, a, towardA)
    b = square(e.to, b, towardB)
  }

  /* An 'auto' anchor already faces the other end, so it never routes back over
     itself; a hand-picked side can, which is what makes an ortho skip
     connection cut through the block it leaves. Hand the router the two boxes
     so it can rule those candidates out. */
  const boxes: Rect[] = []
  for (const ep of [e.from, e.to]) {
    if ('free' in ep) continue
    /* A connector that starts on a neuron starts *inside* the network's box, so
       handing the router that box as something to route around would leave it
       nothing to do but fail. The part is the obstacle-free case. */
    if (ep.part) continue
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
