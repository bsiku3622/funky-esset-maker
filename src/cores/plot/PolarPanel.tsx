/* Polar panels: rose diagrams and radar charts.
 *
 * A wind rose and a radar chart are the same drawing with two different
 * questions behind them — "how often does the wind blow from here" and "how
 * does this thing score on each of these axes" — so they share the frame and
 * differ only in the mark.
 *
 * ⚠️ The default zero is north, running clockwise, because every rose diagram
 * a reader has seen is a compass. The maths convention (zero east,
 * anticlockwise) is one flag away, and a strike rose that comes out mirrored is
 * worse than useless. */

import { Fragment } from 'react'
import { buildAxis } from './scale'
import type { PanelProps } from './Panel'
import type { ResolvedSeries } from './resolve'
import { linePath, markerPath, sectorPath, textWidth } from './geom'
import { TickLabel } from './svgbits'
import { UI_ONLY } from '../figure'
import { SELECT_INK } from './svgbits'

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/** Screen angle for a value on the angular axis, in radians, y growing down. */
function angleFn(startDeg: number, clockwise: boolean) {
  const dir = clockwise ? 1 : -1
  return (deg: number) => ((-startDeg + dir * deg) * Math.PI) / 180
}

interface Wedge {
  a0: number
  a1: number
  value: number
  label: string
  row: number
}

/** Fold a direction column into equal sectors. Without a value column each row
 *  counts as one, which is what a frequency rose means. */
function binSectors(s: ResolvedSeries, sectors: number, categories: string[] | null): Wedge[] {
  if (categories?.length) {
    const step = 360 / categories.length
    const sums = categories.map(() => 0)
    const rows = categories.map(() => -1)
    for (const d of s.data) {
      const i = Math.round(d.x)
      if (i < 0 || i >= sums.length) continue
      sums[i] += Number.isFinite(d.y) ? d.y : 1
      if (rows[i] < 0) rows[i] = d.row
    }
    return categories.map((label, i) => ({
      a0: i * step - step / 2,
      a1: i * step + step / 2,
      value: sums[i],
      label,
      row: rows[i] < 0 ? i : rows[i],
    }))
  }
  const n = Math.max(2, Math.min(72, sectors))
  const step = 360 / n
  const sums = new Array<number>(n).fill(0)
  const rows = new Array<number>(n).fill(-1)
  const hasY = s.data.some((d) => Number.isFinite(d.y))
  for (const d of s.data) {
    if (!Number.isFinite(d.x)) continue
    const deg = ((d.x % 360) + 360) % 360
    const i = Math.floor((deg + step / 2) / step) % n
    sums[i] += hasY && Number.isFinite(d.y) ? d.y : 1
    if (rows[i] < 0) rows[i] = d.row
  }
  return sums.map((value, i) => ({
    a0: i * step - step / 2,
    a1: i * step + step / 2,
    value,
    label: n === 16 ? COMPASS[i] : n === 8 ? COMPASS[i * 2] : `${Math.round(i * step)}°`,
    row: rows[i] < 0 ? i : rows[i],
  }))
}

export default function PolarPanel({ rp, rect, st, onPick, selected }: PanelProps) {
  const start = rp.spec.polarStart ?? 90
  const cw = rp.spec.polarClockwise ?? true
  const ang = angleFn(start, cw)

  const roses = rp.series.filter((s) => s.mark === 'rose')
  const radars = rp.series.filter((s) => s.mark === 'radar')
  const cats = rp.xCategories
  const sectors = rp.spec.sectors ?? (cats?.length || 16)

  const wedges = roses.map((s) => ({ s, w: binSectors(s, sectors, cats) }))

  // radial domain across everything drawn
  const values: number[] = []
  for (const { w } of wedges) values.push(...w.map((x) => x.value))
  for (const s of radars) values.push(...s.data.map((d) => d.y).filter((v) => Number.isFinite(v)))
  const radial = buildAxis(
    { zero: true, tickCount: 4, ...(rp.spec.y ?? {}) },
    { values },
    0,
    1,
  )

  const titleH = rp.spec.title ? st.panelTitle * 1.9 : 0
  const labelPad = st.tick * 2.6
  const size = Math.min(rect.w, rect.h - titleH) - labelPad * 2
  const r = Math.max(10, size / 2)
  const cx = rect.x + rect.w / 2
  const cy = rect.y + titleH + labelPad + r

  const rr = (v: number) => (Math.max(0, v - radial.min) / (radial.max - radial.min || 1)) * r

  const spokeCount = cats?.length || (radars.length ? (cats?.length ?? 8) : Math.min(sectors, 16))
  const spokeStep = 360 / Math.max(1, spokeCount)

  const spokeLabel = (i: number): string => {
    if (cats?.length) return cats[i] ?? ''
    if (spokeCount === 16) return COMPASS[i]
    if (spokeCount === 8) return COMPASS[i * 2]
    return `${Math.round(i * spokeStep)}°`
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

      {/* rings and spokes */}
      <g fill="none" stroke={st.c.grid} strokeWidth={st.grid}>
        {radial.ticks.map((t, i) => (
          <circle key={i} cx={cx} cy={cy} r={rr(t.v)} />
        ))}
        {Array.from({ length: spokeCount }, (_, i) => {
          const a = ang(i * spokeStep)
          return (
            <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} />
          )
        })}
      </g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={st.c.ink} strokeWidth={st.axis} />

      {/* the roses */}
      {wedges.map(({ s, w }, si) => (
        <g key={`rose${si}`}>
          {w.map((x, i) => {
            if (!(x.value > 0)) return null
            const d = sectorPath({ x: cx, y: cy }, 0, rr(x.value), ang(x.a0), ang(x.a1))
            const sel = selected?.seriesId === s.spec.id && selected.row === x.row
            return (
              <Fragment key={i}>
                <path
                  d={d}
                  fill={s.color}
                  fillOpacity={s.spec.fillOpacity ?? (roses.length > 1 ? 0.6 : 0.85)}
                  stroke={st.outline ? st.c.outline ?? undefined : '#ffffff'}
                  strokeWidth={st.outline || 0.8}
                  onPointerDown={
                    onPick
                      ? (e) => {
                          e.stopPropagation()
                          onPick(s.spec.id, x.row)
                        }
                      : undefined
                  }
                  style={onPick ? { cursor: 'pointer' } : undefined}
                />
                {sel && (
                  <path {...{ [UI_ONLY]: '1' }} d={d} fill="none" stroke={SELECT_INK} strokeWidth={2.5} />
                )}
              </Fragment>
            )
          })}
        </g>
      ))}

      {/* the radars */}
      {radars.map((s, si) => {
        const pts = s.data
          .filter((d) => Number.isFinite(d.y))
          .map((d) => {
            const a = ang(d.x * spokeStep)
            const rad = rr(d.y)
            return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) }
          })
        if (pts.length < 2) return null
        return (
          <g key={`radar${si}`}>
            <path
              d={`${linePath(pts)} Z`}
              fill={s.color}
              fillOpacity={s.spec.fillOpacity ?? 0.22}
              stroke={s.color}
              strokeWidth={s.spec.width ?? st.line}
              strokeLinejoin="round"
            />
            {(s.spec.marker ?? 'circle') !== 'none' &&
              pts.map((q, i) => (
                <path
                  key={i}
                  d={markerPath('circle', q, s.spec.markerSize ?? (st.paper ? 2.6 : 4))}
                  fill={s.color}
                  stroke={st.c.outline ?? undefined}
                  strokeWidth={st.outline || undefined}
                />
              ))}
          </g>
        )
      })}

      {/* Radial tick labels sit on the boundary between two wedges rather than
          up the middle of one: a rose's first sector is centred on zero, so the
          zero spoke runs straight through a bar. */}
      <g>
        {radial.ticks.map((t, i) => {
          if (i === 0) return null
          const a = ang(spokeStep / 2)
          const q = { x: cx + rr(t.v) * Math.cos(a), y: cy + rr(t.v) * Math.sin(a) }
          return (
            <TickLabel
              key={i}
              t={t}
              x={q.x + 4}
              y={q.y - 3}
              anchor="start"
              size={st.tick * 0.92}
              fill={st.c.muted}
              font={st.numeric}
            />
          )
        })}
      </g>

      {/* direction labels outside the circle */}
      <g fontSize={st.tick} fill={st.c.ink} fontFamily={st.font}>
        {Array.from({ length: spokeCount }, (_, i) => {
          const label = spokeLabel(i)
          if (!label) return null
          const a = ang(i * spokeStep)
          const q = { x: cx + (r + st.tick * 0.9) * Math.cos(a), y: cy + (r + st.tick * 0.9) * Math.sin(a) }
          const cos = Math.cos(a)
          const anchor = Math.abs(cos) < 0.25 ? 'middle' : cos > 0 ? 'start' : 'end'
          const dy = Math.sin(a) > 0.6 ? st.tick * 0.9 : Math.sin(a) < -0.6 ? -st.tick * 0.15 : st.tick * 0.35
          return (
            <text key={i} x={q.x} y={q.y + dy} textAnchor={anchor}>
              {label}
            </text>
          )
        })}
      </g>

      {/* legend, bottom-centre — a polar plot has no corner to spare */}
      {(rp.spec.legend?.pos ?? 'bottom') !== 'none' && rp.series.length > 1 && (
        <g>
          {rp.series.map((s, i) => {
            const total = rp.series.reduce((acc, q) => acc + textWidth(q.name, st.legend) + st.legend * 2, 0)
            let x = cx - total / 2
            for (let k = 0; k < i; k++) x += textWidth(rp.series[k].name, st.legend) + st.legend * 2
            const y = rect.y + rect.h - st.legend * 0.6
            return (
              <Fragment key={i}>
                <rect x={x} y={y - st.legend} width={st.legend} height={st.legend} fill={s.color} stroke={st.c.outline ?? undefined} strokeWidth={st.outline || undefined} />
                <text x={x + st.legend * 1.4} y={y - st.legend * 0.15} fontSize={st.legend} fill={st.c.ink}>
                  {s.name}
                </text>
              </Fragment>
            )
          })}
        </g>
      )}

      {rp.spec.y?.label && (
        <text
          x={rect.x + st.axisLabel}
          y={cy}
          textAnchor="middle"
          fontSize={st.axisLabel}
          fill={st.c.ink}
          transform={`rotate(-90 ${rect.x + st.axisLabel} ${cy})`}
        >
          {rp.spec.y.label}
        </text>
      )}
    </g>
  )
}
