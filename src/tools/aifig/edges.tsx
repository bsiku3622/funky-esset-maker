/* Connector rendering.
 *
 * Arrow heads are emitted as plain <path> elements rather than SVG markers:
 * markers need shared <defs> ids, which break when a figure is copied into
 * another document, and they cannot be recoloured per edge without one def per
 * colour. Drawing them inline keeps every exported file self-contained. */

import { memo } from 'react'
import type { EdgeStyle, FigEdge, Pt, Style } from './types'
import { atLength } from './geometry'
import { dashArray, headGeom } from './presets'
import { LabelView } from './shapes'
import { layoutLabel } from './latex'
import { labelFont } from './layout'
import type { ResolvedEdge } from './resolve'

/** Edge labels reuse the node label renderer, which wants a full node Style. */
function asStyle(s: EdgeStyle): Style {
  return {
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    dash: 'solid',
    opacity: 1,
    radius: 0,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: 400,
    italic: false,
    textColor: s.textColor,
    align: 'center',
    lineHeight: 1.2,
  }
}

function Head({
  kind,
  at,
  dir,
  color,
  sw,
}: {
  kind: string
  at: Pt
  dir: Pt
  color: string
  sw: number
}) {
  const g = headGeom(kind, sw)
  if (!g) return null
  const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI
  return (
    <path
      d={g.path}
      transform={`translate(${at.x.toFixed(2)} ${at.y.toFixed(2)}) rotate(${angle.toFixed(2)})`}
      fill={g.filled ? color : 'none'}
      stroke={color}
      strokeWidth={g.filled ? 0 : Math.max(0.9, sw)}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  )
}

export const EdgeView = memo(function EdgeView({
  e,
  r,
}: {
  e: FigEdge
  r: ResolvedEdge
  /** bumped when MathJax finishes loading; only here to bust memo */
  rev?: number
}) {
  if (e.hidden) return null
  const s = e.style
  const start = atLength(r.info, 0)
  const end = atLength(r.info, 1)
  const style = asStyle(s)
  const label = e.label ? layoutLabel(e.label, labelFont(style)) : null
  const lp = label ? atLength(r.info, e.labelT) : null

  return (
    <g opacity={s.opacity} data-edge={e.id}>
      <path
        d={r.strokeInfo.d}
        fill="none"
        stroke={s.stroke}
        strokeWidth={s.strokeWidth}
        strokeDasharray={dashArray(s.dash, s.strokeWidth)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Head
        kind={e.startHead}
        at={start.p}
        dir={{ x: -start.dir.x, y: -start.dir.y }}
        color={s.stroke}
        sw={s.strokeWidth}
      />
      <Head kind={e.endHead} at={end.p} dir={end.dir} color={s.stroke} sw={s.strokeWidth} />
      {label && lp ? (
        <g
          transform={`translate(${(lp.p.x + e.labelDx).toFixed(2)} ${(lp.p.y + e.labelDy).toFixed(2)})`}
        >
          {s.labelBg !== 'none' ? (
            <rect
              x={-label.w / 2 - 3}
              y={-label.h / 2 - 1.5}
              width={label.w + 6}
              height={label.h + 3}
              fill={s.labelBg}
              rx={2}
            />
          ) : null}
          <LabelView layout={label} x={0} y={-label.h / 2} style={style} />
        </g>
      ) : null}
    </g>
  )
})
