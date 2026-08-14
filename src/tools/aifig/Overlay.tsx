/* Editor chrome drawn on top of the figure: selection outlines, resize and
 * rotate handles, connection anchors, waypoint dots, guides and the marquee.
 *
 * It lives inside the same zoomed <g> as the figure but in a separate group
 * that the exporter never touches, and every stroke is divided by the zoom so
 * handles keep a constant on-screen size. */

import type { FigEdge, FigNode, Pt, Rect } from './types'
import type { Gap, Guide, Measure } from './geometry'
import type { ResolvedEdge } from './resolve'
import { atLength, nodeBounds } from './geometry'
import {
  ANCHOR_OUT,
  ANCHOR_R,
  ANCHOR_UV,
  CURSOR,
  GRIP,
  HANDLES,
  HANDLE_UV,
  ROTATE_OUT,
  ROTATE_R,
  anchorHandlePoint,
} from './handles'

/* What a press right here would act on.
 *
 * ⚠️ Everything drawn is a thing in its own right — a label as much as the
 * shape it names — and until this existed you had to press and find out. The
 * mark is the same shape as the target: a circle for a neuron, because a
 * neuron *is* one, and a box for everything else. */
export type HoverMark =
  /** corners in canvas order, so a rotated node still outlines squarely */
  | { kind: 'box'; pts: Pt[] }
  | { kind: 'circle'; c: Pt; r: number }
  | { kind: 'line'; a: Pt; b: Pt }
  | { kind: 'path'; d: string }

/** One selected neuron, synapse or group, ready to draw. */
export type PartMark =
  | { kind: 'dot'; c: Pt; r: number }
  | { kind: 'wire'; a: Pt; b: Pt }
  /** corners in canvas order, so a rotated network still outlines squarely */
  | { kind: 'group'; pts: Pt[] }

interface Props {
  zoom: number
  nodes: FigNode[] // selected nodes
  selBox: Rect | null
  edges: { e: FigEdge; r: ResolvedEdge }[] // selected edges
  hoverNode: FigNode | null
  guides: Guide[]
  /** equal-spacing bars, drawn while a drag is holding a rhythm */
  gaps: Gap[]
  /** distances to the shape under the pointer, while Alt is held */
  measures: Measure[]
  /** edges the two already share, shown alongside those distances */
  aligns: Guide[]
  marquee: Rect | null
  tempEdge: { a: Pt; b: Pt } | null
  /** bounds of the node a live connection would land on */
  connectTarget: Rect | null
  /** the neurons and synapses reached inside a network, in canvas coordinates */
  partMarks: PartMark[]
  /** connection dots on the selected neuron, so a wire can start there */
  partAnchors: { anchor: string; p: Pt; node: string; part: string }[]
  /** resize grips on a selected group — they drag its padding, not its size */
  partGrips: { handle: string; part: string; node: string; p: Pt }[]
  /** outline of whatever a press would land on right now */
  hover: HoverMark | null
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
  measures,
  aligns,
  marquee,
  tempEdge,
  connectTarget,
  partMarks,
  partAnchors,
  partGrips,
  hover,
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

      {/* Alt-held measurements: where the two shapes already agree, drawn the
          same way a live snap would draw it, and how far apart they are. */}
      {aligns.map((g, i) => (
        <line
          key={`al${i}`}
          x1={g.axis === 'x' ? g.at : g.from}
          y1={g.axis === 'x' ? g.from : g.at}
          x2={g.axis === 'x' ? g.at : g.to}
          y2={g.axis === 'x' ? g.to : g.at}
          stroke="#ff2d9b"
          strokeWidth={k}
          strokeDasharray={`${4 * k} ${3 * k}`}
        />
      ))}
      {measures.map((m, i) => {
        const horiz = m.axis === 'x'
        const x1 = horiz ? m.from : m.at
        const y1 = horiz ? m.at : m.from
        const x2 = horiz ? m.to : m.at
        const y2 = horiz ? m.at : m.to
        const t = 4 * k
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const fs = 11 * k
        const pad = 3 * k
        const w = (m.label.length * 6.4 + 8) * k
        return (
          <g key={`ms${i}`}>
            {/* the dashed run out to a shape that shares no band with us */}
            {m.reach ? (
              <line
                x1={horiz ? m.to : m.reach.from}
                y1={horiz ? m.reach.from : m.to}
                x2={horiz ? m.to : m.reach.to}
                y2={horiz ? m.reach.to : m.to}
                stroke="#ff2d9b"
                strokeWidth={k}
                strokeDasharray={`${3 * k} ${3 * k}`}
              />
            ) : null}
            <g stroke="#ff2d9b" strokeWidth={1.2 * k}>
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
            <rect
              x={mx - w / 2}
              y={my - fs / 2 - pad}
              width={w}
              height={fs + pad * 2}
              rx={2 * k}
              fill="#ff2d9b"
            />
            <text
              x={mx}
              y={my + fs * 0.35}
              textAnchor="middle"
              fontFamily="system-ui, sans-serif"
              fontSize={fs}
              fontWeight={600}
              fill="#fff"
            >
              {m.label}
            </text>
          </g>
        )
      })}

      {/* What a press would take, drawn before the selection so a thing that is
          both hovered and selected reads as selected. */}
      {hover && !dragging ? (
        hover.kind === 'circle' ? (
          <circle
            cx={hover.c.x}
            cy={hover.c.y}
            r={hover.r + 2 * k}
            fill="none"
            stroke="#7828c8"
            strokeWidth={1.2 * k}
            opacity={0.65}
          />
        ) : hover.kind === 'box' ? (
          <polygon
            points={hover.pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#7828c8"
            strokeWidth={1.2 * k}
            opacity={0.65}
          />
        ) : hover.kind === 'line' ? (
          <line
            x1={hover.a.x}
            y1={hover.a.y}
            x2={hover.b.x}
            y2={hover.b.y}
            stroke="#7828c8"
            strokeWidth={3 * k}
            opacity={0.3}
            strokeLinecap="round"
          />
        ) : (
          <path d={hover.d} fill="none" stroke="#7828c8" strokeWidth={3 * k} opacity={0.3} />
        )
      ) : null}

      {/* Reached inside a network. Drawn as a ring around the circle or a halo
          along the synapse rather than as a box, because the thing selected is
          round or is a line — a bounding box would say "this region", and the
          whole point is that one part was singled out. */}
      {partMarks.map((m, i) =>
        m.kind === 'dot' ? (
          <circle
            key={i}
            cx={m.c.x}
            cy={m.c.y}
            r={m.r + 3 * k}
            fill="none"
            stroke="#7828c8"
            strokeWidth={1.6 * k}
          />
        ) : m.kind === 'group' ? (
          <polygon
            key={i}
            points={m.pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#7828c8"
            strokeWidth={1.4 * k}
          />
        ) : (
          <line
            key={i}
            x1={m.a.x}
            y1={m.a.y}
            x2={m.b.x}
            y2={m.b.y}
            stroke="#7828c8"
            strokeWidth={4 * k}
            opacity={0.4}
            strokeLinecap="round"
          />
        ),
      )}

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
            y2={single.y - ROTATE_OUT * k}
            stroke="#7828c8"
            strokeWidth={1.2 * k}
          />
          <circle
            cx={single.x + single.w / 2}
            cy={single.y - ROTATE_OUT * k}
            r={ROTATE_R * k}
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
                x={x - GRIP * k}
                y={y - GRIP * k}
                width={GRIP * 2 * k}
                height={GRIP * 2 * k}
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

      {/* a selected group resizes like any other object — the grips just edit
          its padding, since where it sits is the lattice's business */}
      {!dragging
        ? partGrips.map((g) => (
            <rect
              key={`${g.part}${g.handle}`}
              x={g.p.x - GRIP * k}
              y={g.p.y - GRIP * k}
              width={GRIP * 2 * k}
              height={GRIP * 2 * k}
              fill="#fff"
              stroke="#7828c8"
              strokeWidth={1.4 * k}
              pointerEvents="all"
              data-part-handle={g.handle}
              data-part-key={g.part}
              data-part-node={g.node}
              style={{ cursor: CURSOR[g.handle as keyof typeof CURSOR] }}
            />
          ))
        : null}

      {/* the same dots, on a neuron that has been reached inside a network */}
      {!dragging
        ? partAnchors.map((a) => (
            <circle
              key={`${a.part}${a.anchor}`}
              cx={a.p.x}
              cy={a.p.y}
              r={ANCHOR_R * k}
              fill="#00c22a"
              stroke="#fff"
              strokeWidth={1.4 * k}
              pointerEvents="all"
              data-anchor={a.anchor}
              data-anchor-node={a.node}
              data-anchor-part={a.part}
              style={{ cursor: 'crosshair' }}
            />
          ))
        : null}

      {/* connection anchors on hover, floating clear of the resize grips */}
      {hoverNode && !dragging ? (
        <g>
          {Object.keys(ANCHOR_UV).map((a) => {
            const p = anchorHandlePoint(hoverNode, a, ANCHOR_OUT * k)
            return (
              <circle
                key={a}
                cx={p.x}
                cy={p.y}
                r={ANCHOR_R * k}
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
