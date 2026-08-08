import { useLayoutEffect, useRef, useState } from 'react'
import {
  DIAGRAM_COLOR_HEX as COLOR_HEX,
  DIAGRAM_TEXT_ON as TEXT_ON,
  type DiagramColor,
} from './palette'
import './cores.css'

/* Diagram — display-only render core extracted from the Grapher tool.
   Draws colored node boxes (with an optional corner tag) connected by arrowed
   edges. No editing / pan / zoom / export: just the static figure, rendered at
   the tool's native scale so a host (slide box) can scale it as a whole. */

export type { DiagramColor }

export interface DiagramNode {
  id: string
  x: number
  y: number
  text: string
  color: DiagramColor
  /** small numbered/labelled tag pinned to the box's top-left corner */
  tag?: string
}

export interface DiagramEdge {
  source: string
  target: string
}

export interface DiagramProps {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

interface Size {
  w: number
  h: number
}

const DEFAULT_SIZE: Size = { w: 150, h: 50 }
const PAD = 24 // breathing room around the figure (also fits tags / shadows)

// point where the segment toward (tx,ty) crosses node n's rectangle border
function borderPoint(n: DiagramNode, size: Size, tx: number, ty: number) {
  const cx = n.x + size.w / 2
  const cy = n.y + size.h / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const sx = dx === 0 ? Infinity : size.w / 2 / Math.abs(dx)
  const sy = dy === 0 ? Infinity : size.h / 2 / Math.abs(dy)
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}

export default function Diagram({ nodes, edges }: DiagramProps) {
  const [sizes, setSizes] = useState<Record<string, Size>>({})
  const refs = useRef<Map<string, HTMLDivElement>>(new Map())

  useLayoutEffect(() => {
    setSizes((prev) => {
      let changed = false
      const next: Record<string, Size> = { ...prev }
      for (const n of nodes) {
        const el = refs.current.get(n.id)
        if (!el) continue
        const w = el.offsetWidth
        const h = el.offsetHeight
        if (!prev[n.id] || prev[n.id].w !== w || prev[n.id].h !== h) {
          next[n.id] = { w, h }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [nodes])

  const sizeOf = (id: string): Size => sizes[id] ?? DEFAULT_SIZE
  const nodeById = (id: string) => nodes.find((n) => n.id === id)

  // figure bounds (world coords) -> container size + offset to keep tags visible
  let maxX = 0
  let maxY = 0
  for (const n of nodes) {
    const s = sizeOf(n.id)
    maxX = Math.max(maxX, n.x + s.w)
    maxY = Math.max(maxY, n.y + s.h)
  }

  return (
    <div
      className="fx-diagram"
      style={{ width: maxX + PAD * 2, height: maxY + PAD * 2 }}
    >
      <div className="fx-diagram__world" style={{ left: PAD, top: PAD }}>
        <svg className="fx-diagram__edges" width={maxX + PAD} height={maxY + PAD}>
          <defs>
            <marker
              id="fx-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#222" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            const s = nodeById(e.source)
            const t = nodeById(e.target)
            if (!s || !t) return null
            const ss = sizeOf(s.id)
            const ts = sizeOf(t.id)
            const sc = { x: s.x + ss.w / 2, y: s.y + ss.h / 2 }
            const tc = { x: t.x + ts.w / 2, y: t.y + ts.h / 2 }
            const p1 = borderPoint(s, ss, tc.x, tc.y)
            const p2 = borderPoint(t, ts, sc.x, sc.y)
            return (
              <line
                key={i}
                className="fx-diagram__line"
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                markerEnd="url(#fx-arrow)"
              />
            )
          })}
        </svg>

        {nodes.map((n) => (
          <div
            key={n.id}
            ref={(el) => {
              if (el) refs.current.set(n.id, el)
              else refs.current.delete(n.id)
            }}
            className="fx-node"
            style={{
              left: n.x,
              top: n.y,
              background: COLOR_HEX[n.color],
              color: TEXT_ON[n.color],
            }}
          >
            {n.tag != null && n.tag !== '' && (
              <span className="fx-node__tag">{n.tag}</span>
            )}
            <span className="fx-node__label">{n.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
