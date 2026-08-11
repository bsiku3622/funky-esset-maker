/* Editor chrome drawn on top of the figure: selection outlines, resize and
 * rotate handles, connection anchors, waypoint dots, guides and the marquee.
 *
 * It lives inside the same zoomed <g> as the figure but in a separate group
 * that the exporter never touches, and every stroke is divided by the zoom so
 * handles keep a constant on-screen size. */

import type { FigEdge, FigNode, Pt, Rect } from './types'
import type { Gap, Guide } from './geometry'
import type { ResolvedEdge } from './resolve'
import { atLength, nodeBounds } from './geometry'
import { ANCHOR_UV, CURSOR, HANDLES, HANDLE_UV, anchorHandlePoint } from './handles'

interface Props {
  zoom: number
  nodes: FigNode[] // selected nodes
  selBox: Rect | null
  edges: { e: FigEdge; r: ResolvedEdge }[] // selected edges
  hoverNode: FigNode | null
  guides: Guide[]
  /** equal-spacing bars, drawn while a drag is holding a rhythm */
  gaps: Gap[]
  marquee: Rect | null
  tempEdge: { a: Pt; b: Pt } | null
  /** bounds of the node a live connection would land on */
  connectTarget: Rect | null
  /** true while a drag is in flight — handles are hidden to reduce noise */
  dragging: boolean
}

export default function Overlay({
  zoom,
  nodes,
  selBox,
  edges,
  hoverNode,
  guides,
  gaps,
  marquee,
  tempEdge,
  connectTarget,
  dragging,
}: Props) {
  const k = 1 / zoom
  const single = nodes.length === 1 ? nodes[0] : null

  return (
    <g className="af-overlay" pointerEvents="none">
      {guides.map((g, i) => (
        <line
          key={i}
          x1={g.axis === 'x' ? g.at : g.from}
          y1={g.axis === 'x' ? g.from : g.at}
          x2={g.axis === 'x' ? g.at : g.to}
          y2={g.axis === 'x' ? g.to : g.at}
          stroke="#ff2d9b"
          strokeWidth={k}
          strokeDasharray={`${4 * k} ${3 * k}`}
        />
      ))}

      {/* Equal gaps: a measured bar with end ticks, drawn solid so it reads as
          a distance rather than as one more alignment line. */}
      {gaps.map((g, i) => {
        const horiz = g.axis === 'x'
        const x1 = horiz ? g.from : g.at
        const y1 = horiz ? g.at : g.from
        const x2 = horiz ? g.to : g.at
        const y2 = horiz ? g.at : g.to
        const t = 4 * k
        return (
          <g key={`gap${i}`} stroke="#ff2d9b" strokeWidth={1.2 * k}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} />
            <line
              x1={horiz ? x1 : x1 - t}
              y1={horiz ? y1 - t : y1}
              x2={horiz ? x1 : x1 + t}
              y2={horiz ? y1 + t : y1}
            />
            <line
              x1={horiz ? x2 : x2 - t}
              y1={horiz ? y2 - t : y2}
              x2={horiz ? x2 : x2 + t}
              y2={horiz ? y2 + t : y2}
            />
          </g>
        )
      })}

      {/* selected node outlines */}
      {nodes.map((n) => {
        const b = nodeBounds(n)
        return (
          <rect
            key={n.id}
            x={n.rotation ? b.x : n.x}
            y={n.rotation ? b.y : n.y}
            width={n.rotation ? b.w : n.w}
            height={n.rotation ? b.h : n.h}
            fill="none"
            stroke="#7828c8"
            strokeWidth={1.2 * k}
            strokeDasharray={n.rotation ? `${3 * k} ${3 * k}` : undefined}
          />
        )
      })}

      {/* multi-selection bounding box */}
      {nodes.length > 1 && selBox ? (
        <rect
          x={selBox.x}
          y={selBox.y}
          width={selBox.w}
          height={selBox.h}
          fill="none"
          stroke="#7828c8"
          strokeWidth={1.4 * k}
          strokeDasharray={`${5 * k} ${4 * k}`}
        />
      ) : null}

      {/* resize + rotate handles (single selection only) */}
      {single && !dragging ? (
        <g transform={single.rotation ? `rotate(${single.rotation} ${single.x + single.w / 2} ${single.y + single.h / 2})` : undefined}>
          <line
            x1={single.x + single.w / 2}
            y1={single.y}
            x2={single.x + single.w / 2}
            y2={single.y - 22 * k}
            stroke="#7828c8"
            strokeWidth={1.2 * k}
          />
          <circle
            cx={single.x + single.w / 2}
            cy={single.y - 22 * k}
            r={4.5 * k}
            fill="#fff"
            stroke="#7828c8"
            strokeWidth={1.4 * k}
            className="af-h-rotate"
            pointerEvents="all"
            data-handle="rotate"
            style={{ cursor: 'grab' }}
          />
          {HANDLES.map((h) => {
            const uv = HANDLE_UV[h]
            const x = single.x + single.w * uv.x
            const y = single.y + single.h * uv.y
            return (
              <rect
                key={h}
                x={x - 4 * k}
                y={y - 4 * k}
                width={8 * k}
                height={8 * k}
                fill="#fff"
                stroke="#7828c8"
                strokeWidth={1.4 * k}
                pointerEvents="all"
                data-handle={h}
                style={{ cursor: CURSOR[h] }}
              />
            )
          })}
        </g>
      ) : null}

      {/* connection anchors on hover */}
      {hoverNode && !dragging ? (
        <g>
          {Object.keys(ANCHOR_UV).map((a) => {
            const p = anchorHandlePoint(hoverNode, a)
            return (
              <circle
                key={a}
                cx={p.x}
                cy={p.y}
                r={5.5 * k}
                fill="#00c22a"
                stroke="#fff"
                strokeWidth={1.4 * k}
                pointerEvents="all"
                data-anchor={a}
                data-anchor-node={hoverNode.id}
                style={{ cursor: 'crosshair' }}
              />
            )
          })}
        </g>
      ) : null}

      {/* selected edges: endpoints + waypoints */}
      {edges.map(({ e, r }) => {
        const a = atLength(r.info, 0)
        const b = atLength(r.info, 1)
        return (
          <g key={e.id}>
            <path
              d={r.info.d}
              fill="none"
              stroke="#7828c8"
              strokeWidth={2 * k}
              opacity={0.35}
            />
            <circle
              cx={a.p.x}
              cy={a.p.y}
              r={4.5 * k}
              fill="#fff"
              stroke="#7828c8"
              strokeWidth={1.4 * k}
              pointerEvents="all"
              data-endpoint="from"
              data-edge-id={e.id}
              style={{ cursor: 'crosshair' }}
            />
            <circle
              cx={b.p.x}
              cy={b.p.y}
              r={4.5 * k}
              fill="#fff"
              stroke="#7828c8"
              strokeWidth={1.4 * k}
              pointerEvents="all"
              data-endpoint="to"
              data-edge-id={e.id}
              style={{ cursor: 'crosshair' }}
            />
            {r.wps.map((w, i) => (
              <rect
                key={i}
                x={w.x - 4 * k}
                y={w.y - 4 * k}
                width={8 * k}
                height={8 * k}
                fill="#ffd500"
                stroke="#7828c8"
                strokeWidth={1.2 * k}
                pointerEvents="all"
                data-waypoint={i}
                data-edge-id={e.id}
                style={{ cursor: 'move' }}
              />
            ))}
          </g>
        )
      })}

      {/* live connection */}
      {tempEdge ? (
        <g>
          <line
            x1={tempEdge.a.x}
            y1={tempEdge.a.y}
            x2={tempEdge.b.x}
            y2={tempEdge.b.y}
            stroke="#00c22a"
            strokeWidth={1.6 * k}
            strokeDasharray={`${5 * k} ${3 * k}`}
          />
          <circle cx={tempEdge.b.x} cy={tempEdge.b.y} r={3 * k} fill="#00c22a" />
        </g>
      ) : null}
      {connectTarget ? (
        <rect
          x={connectTarget.x - 2 * k}
          y={connectTarget.y - 2 * k}
          width={connectTarget.w + 4 * k}
          height={connectTarget.h + 4 * k}
          fill="none"
          stroke="#00c22a"
          strokeWidth={2 * k}
        />
      ) : null}

      {marquee ? (
        <rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.w}
          height={marquee.h}
          fill="rgba(120,40,200,0.08)"
          stroke="#7828c8"
          strokeWidth={1 * k}
          strokeDasharray={`${4 * k} ${3 * k}`}
        />
      ) : null}
    </g>
  )
}
