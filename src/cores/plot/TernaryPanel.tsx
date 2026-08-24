/* Ternary diagrams — three components that sum to a whole.
 *
 * Soil texture, the QAP classification of an igneous rock, the composition of a
 * sediment: earth science reaches for this whenever a sample is a mixture of
 * exactly three things, and no cartesian pair can show it without throwing one
 * away.
 *
 * ⚠️ Rows are normalised to their own total, not to 100. A table in fractions,
 * in percent, or in grams all plot the same, and a row that sums to 97 because
 * of rounding lands where it should instead of drifting off the triangle. */

import { Fragment } from 'react'
import type { PanelProps } from './Panel'
import { linePath, markerPath, textWidth } from './geom'
import { UI_ONLY } from '../figure'
import { SELECT_INK } from './svgbits'

interface Corner {
  x: number
  y: number
}

/** a is the top corner, b bottom-left, c bottom-right. */
function baryToXY(a: number, b: number, c: number, top: Corner, bl: Corner, br: Corner): Corner {
  const t = a + b + c
  if (!(t > 0)) return { x: NaN, y: NaN }
  const [ua, ub, uc] = [a / t, b / t, c / t]
  return {
    x: ua * top.x + ub * bl.x + uc * br.x,
    y: ua * top.y + ub * bl.y + uc * br.y,
  }
}

export default function TernaryPanel({ rp, rect, st, onPick, selected }: PanelProps) {
  const labels = rp.spec.ternaryLabels ?? ['A', 'B', 'C']
  const titleH = rp.spec.title ? st.panelTitle * 1.9 : 0
  const pad = st.tick * 2.4
  const availW = rect.w - pad * 2
  const availH = rect.h - titleH - pad * 2
  // an equilateral triangle is √3/2 as tall as it is wide
  const side = Math.max(20, Math.min(availW, availH / (Math.sqrt(3) / 2)))
  const h = (side * Math.sqrt(3)) / 2
  const cx = rect.x + rect.w / 2
  const y0 = rect.y + titleH + pad + (availH - h) / 2

  const top: Corner = { x: cx, y: y0 }
  const bl: Corner = { x: cx - side / 2, y: y0 + h }
  const br: Corner = { x: cx + side / 2, y: y0 + h }
  const to = (a: number, b: number, c: number) => baryToXY(a, b, c, top, bl, br)

  const steps = 10
  const grid: { d: string }[] = []
  for (let i = 1; i < steps; i++) {
    const f = i / steps
    // one line per family, each holding one component constant
    grid.push({ d: `M${lerp(bl, top, f)} L${lerp(br, top, f)}` })
    grid.push({ d: `M${lerp(top, bl, f)} L${lerp(br, bl, f)}` })
    grid.push({ d: `M${lerp(top, br, f)} L${lerp(bl, br, f)}` })
  }

  return (
    <g>
      {rp.spec.title && (
        <text
          x={cx}
          y={rect.y + st.panelTitle * 1.25}
          textAnchor="middle"
          fontSize={st.panelTitle}
          fontWeight={st.bold === 400 ? 600 : 800}
          fill={st.c.ink}
        >
          {rp.spec.title}
        </text>
      )}

      {/* the three grid families are what makes a triangle readable as a
          ternary diagram, so they get a little more weight than a cartesian
          grid, which only has to hint at a tick that is already labelled */}
      <g stroke={st.c.grid} strokeWidth={st.grid * 1.4} fill="none">
        {grid.map((g, i) => (
          <path key={i} d={g.d} />
        ))}
      </g>

      <path
        d={`M${top.x} ${top.y}L${br.x} ${br.y}L${bl.x} ${bl.y}Z`}
        fill="none"
        stroke={st.c.ink}
        strokeWidth={st.axis}
        strokeLinejoin="round"
      />

      {/* tick labels along the two lower edges and the left one */}
      <g fontSize={st.tick * 0.9} fill={st.c.muted} fontFamily={st.numeric}>
        {Array.from({ length: steps - 1 }, (_, k) => {
          const i = k + 1
          const f = i / steps
          const onBase = lerpPt(bl, br, f)
          const onLeft = lerpPt(bl, top, f)
          const onRight = lerpPt(br, top, f)
          return (
            <Fragment key={i}>
              <text x={onBase.x} y={onBase.y + st.tick * 1.4} textAnchor="middle">
                {Math.round(f * 100)}
              </text>
              <text x={onLeft.x - st.tick * 0.5} y={onLeft.y + st.tick * 0.35} textAnchor="end">
                {Math.round(f * 100)}
              </text>
              <text x={onRight.x + st.tick * 0.5} y={onRight.y + st.tick * 0.35} textAnchor="start">
                {Math.round(f * 100)}
              </text>
            </Fragment>
          )
        })}
      </g>

      <g fontSize={st.axisLabel} fill={st.c.ink} fontWeight={st.bold === 400 ? 600 : 800}>
        <text x={top.x} y={top.y - st.axisLabel * 0.7} textAnchor="middle">
          {labels[0]}
        </text>
        <text x={bl.x - st.axisLabel * 0.4} y={bl.y + st.axisLabel * 1.9} textAnchor="middle">
          {labels[1]}
        </text>
        <text x={br.x + st.axisLabel * 0.4} y={br.y + st.axisLabel * 1.9} textAnchor="middle">
          {labels[2]}
        </text>
      </g>

      {rp.series.map((s, si) => {
        const pts = s.data.map((d) => ({
          p: to(d.x, d.y, d.y0 ?? 0),
          row: d.row,
          label: d.label,
        }))
        const joined = s.spec.width && s.spec.width > 0 ? pts.map((q) => q.p) : null
        const r = s.spec.markerSize ?? (st.paper ? 3.2 : 5)
        return (
          <g key={si}>
            {joined && (
              <path d={linePath(joined)} fill="none" stroke={s.color} strokeWidth={s.spec.width} />
            )}
            {pts.map((q, i) => {
              if (!Number.isFinite(q.p.x)) return null
              const sel = selected?.seriesId === s.spec.id && selected.row === q.row
              return (
                <Fragment key={i}>
                  <path
                    d={markerPath(s.spec.marker && s.spec.marker !== 'none' ? s.spec.marker : 'circle', q.p, r)}
                    fill={s.color}
                    fillOpacity={s.spec.opacity ?? 1}
                    stroke={st.c.outline ?? undefined}
                    strokeWidth={st.outline || undefined}
                    onPointerDown={
                      onPick
                        ? (e) => {
                            e.stopPropagation()
                            onPick(s.spec.id, q.row)
                          }
                        : undefined
                    }
                    style={onPick ? { cursor: 'pointer' } : undefined}
                  />
                  {sel && (
                    <path
                      {...{ [UI_ONLY]: '1' }}
                      d={markerPath('circle', q.p, r + 4)}
                      fill="none"
                      stroke={SELECT_INK}
                      strokeWidth={2}
                    />
                  )}
                  {s.spec.labels && q.label && (
                    <text
                      x={q.p.x + r + 3}
                      y={q.p.y + st.dataLabel * 0.34}
                      fontSize={st.dataLabel}
                      fill={st.c.ink}
                    >
                      {q.label}
                    </text>
                  )}
                </Fragment>
              )
            })}
          </g>
        )
      })}

      {rp.series.length > 1 && (rp.spec.legend?.pos ?? 'bottom') !== 'none' && (
        <g>
          {rp.series.map((s, i) => {
            const total = rp.series.reduce(
              (acc, q) => acc + textWidth(q.name, st.legend) + st.legend * 2,
              0,
            )
            let x = cx - total / 2
            for (let k = 0; k < i; k++) x += textWidth(rp.series[k].name, st.legend) + st.legend * 2
            const y = rect.y + rect.h - st.legend * 0.4
            return (
              <Fragment key={i}>
                <rect x={x} y={y - st.legend} width={st.legend} height={st.legend} fill={s.color} />
                <text x={x + st.legend * 1.4} y={y - st.legend * 0.15} fontSize={st.legend} fill={st.c.ink}>
                  {s.name}
                </text>
              </Fragment>
            )
          })}
        </g>
      )}
    </g>
  )
}

const lerpPt = (a: Corner, b: Corner, f: number): Corner => ({
  x: a.x + (b.x - a.x) * f,
  y: a.y + (b.y - a.y) * f,
})
const lerp = (a: Corner, b: Corner, f: number) => {
  const p = lerpPt(a, b, f)
  return `${p.x.toFixed(2)} ${p.y.toFixed(2)}`
}
