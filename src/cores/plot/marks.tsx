/* The marks. Each one turns a resolved series into SVG, and nothing more —
 * scales are already built, colours already assigned, stacking already done.
 *
 * ⚠️ Every mark projects through `Proj` rather than calling an axis directly.
 * That is what makes a horizontal bar chart the same code as a vertical one:
 * the panel decides which axis runs which way, and a mark only ever says
 * "put this datum at (x, y) in data units". A mark that reaches for `x.px`
 * itself will draw sideways the first time somebody flips the panel. */

import { Fragment } from 'react'
import { DASH_ARRAY, type DashKind, type MarkerKind } from './spec'
import { formatTick } from './scale'
import type { Datum, ResolvedSeries } from './resolve'
import type { Proj } from './frame'

export type { Proj }
import {
  arrowHead,
  bandPath,
  linePath,
  markerPath,
  slicePath,
  smoothPath,
  stepPath,
  STROKE_ONLY,
  type P,
} from './geom'
import type { PlotStyle } from './style'
import { colorMapById, inkOn, sampleMap } from '../palette'
import { SELECT_INK } from './svgbits'
import { UI_ONLY } from '../figure'

export interface MarkProps {
  s: ResolvedSeries
  p: Proj
  st: PlotStyle
  /** side-by-side placement among the panel's unstacked bar-like series */
  slot?: { count: number; index: number }
  onPick?: (seriesId: string, row: number) => void
  selected?: { seriesId: string; row: number } | null
}

const dashOf = (d: DashKind | undefined) => (d ? DASH_ARRAY[d] : undefined)
const opacityOf = (v: number | undefined, fallback = 1) => (v === undefined ? fallback : v)

const pickHandler = (
  onPick: MarkProps['onPick'],
  id: string,
  row: number,
) =>
  onPick
    ? (e: React.PointerEvent) => {
        e.stopPropagation()
        onPick(id, row)
      }
    : undefined

const isSel = (sel: MarkProps['selected'], id: string, row: number) =>
  !!sel && sel.seriesId === id && sel.row === row

/* ---------- data labels ---------- */

function DataLabels({ s, p, st, pts }: MarkProps & { pts: { d: Datum; at: P }[] }) {
  if (!s.spec.labels) return null
  const spec = { format: s.spec.labelFormat, decimals: s.spec.labelDecimals ?? undefined }
  return (
    <g fontFamily={st.numeric} fontSize={st.dataLabel} fill={st.c.ink} fontWeight={st.bold}>
      {pts.map(({ d, at }, i) => {
        // a bound name column replaces the number: labelling a point "Vega" and
        // labelling it "40.1" are different jobs and only one can have the spot
        const t = s.spec.text ? null : formatTick(d.y, spec, Math.abs(d.y) / 50 || 1)
        return (
          <text
            key={i}
            x={p.flip ? at.x + 6 : at.x}
            y={p.flip ? at.y + st.dataLabel * 0.36 : at.y - 6}
            textAnchor={p.flip ? 'start' : 'middle'}
          >
            {t ? t.label : (d.label ?? '')}
            {t?.sup ? (
              <tspan fontSize={st.dataLabel * 0.72} dy={-st.dataLabel * 0.42}>
                {t.sup}
              </tspan>
            ) : null}
          </text>
        )
      })}
    </g>
  )
}

/* ---------- bars ---------- */

/** How wide one slot is, in pixels.
 *
 *  A category axis says so directly. A numeric x has to be asked: the smallest
 *  gap between two adjacent values is the widest a bar can be without touching
 *  its neighbour, and a histogram carries its own bin edges. */
function slotWidth(s: ResolvedSeries, p: Proj): number {
  const withEdges = s.data.find((d) => d.x0 !== undefined && d.x1 !== undefined)
  if (withEdges) return Math.abs(p.ax.px(withEdges.x1!) - p.ax.px(withEdges.x0!))
  if (p.ax.kind === 'category') return p.ax.band
  const xs = s.data.map((d) => d.x).sort((a, b) => a - b)
  let gap = Infinity
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > 0) gap = Math.min(gap, xs[i] - xs[i - 1])
  if (!Number.isFinite(gap)) return Math.abs(p.ax.px(p.ax.max) - p.ax.px(p.ax.min)) * 0.6
  return Math.abs(p.ax.px(p.ax.min + gap) - p.ax.px(p.ax.min))
}

export function BarMark(props: MarkProps) {
  const { s, p, st, slot, onPick, selected } = props
  const count = slot?.count ?? 1
  const index = slot?.index ?? 0
  const frac = s.spec.barWidth ?? 0.8
  const full = slotWidth(s, p) * frac
  const w = Math.max(1, full / count)
  const off = -full / 2 + w * index

  const pts: { d: Datum; at: P }[] = []
  const bars = s.data.map((d, i) => {
    if (!Number.isFinite(d.y)) return null
    const base = d.y0 ?? baseOf(p)
    const a = p.at(d.x, d.y)
    const b = p.at(d.x, base)
    // an axis-aligned rectangle from the two ends, whichever way the panel runs
    const lo = p.flip ? Math.min(a.x, b.x) : Math.min(a.y, b.y)
    const len = Math.abs(p.flip ? a.x - b.x : a.y - b.y)
    const cross = (p.flip ? a.y : a.x) + off
    const rect = p.flip
      ? { x: lo, y: cross, width: len, height: w }
      : { x: cross, y: lo, width: w, height: len }
    pts.push({ d, at: p.flip ? { x: lo + len, y: cross + w / 2 } : { x: cross + w / 2, y: lo } })
    return (
      <Fragment key={i}>
        <rect
          {...rect}
          fill={s.color}
          fillOpacity={opacityOf(s.spec.fillOpacity, opacityOf(s.spec.opacity))}
          stroke={st.outline ? st.c.outline ?? undefined : undefined}
          strokeWidth={st.outline || undefined}
          onPointerDown={pickHandler(onPick, s.spec.id, d.row)}
          style={onPick ? { cursor: 'pointer' } : undefined}
        />
        {isSel(selected, s.spec.id, d.row) && (
          <rect
            {...{ [UI_ONLY]: '1' }}
            x={rect.x - 3}
            y={rect.y - 3}
            width={rect.width + 6}
            height={rect.height + 6}
            fill="none"
            stroke={SELECT_INK}
            strokeWidth={2}
          />
        )}
      </Fragment>
    )
  })
  return (
    <g>
      {bars}
      <ErrorBars {...props} />
      <DataLabels {...props} pts={pts} />
    </g>
  )
}

/** The value a bar grows from: zero when the axis contains it, otherwise the
 *  axis floor — a log axis has no zero to stand on. */
function baseOf(p: Proj): number {
  const a = p.ay
  if (a.kind === 'log') return a.min
  return a.min <= 0 && a.max >= 0 ? 0 : a.min
}

/* ---------- error bars ---------- */

export function ErrorBars({ s, p, st }: MarkProps) {
  const has = s.data.some((d) => d.e0 !== undefined || d.e1 !== undefined)
  if (!has) return null
  const cap = Math.max(3, st.line * 1.6)
  return (
    <g stroke={st.paper ? st.c.ink : s.color} strokeWidth={Math.max(1, st.line * 0.55)} fill="none">
      {s.data.map((d, i) => {
        const lo = d.e0 ?? d.y
        const hi = d.e1 ?? d.y
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
        const a = p.at(d.x, lo)
        const b = p.at(d.x, hi)
        return p.flip ? (
          <path
            key={i}
            d={`M${a.x} ${a.y}L${b.x} ${b.y}M${a.x} ${a.y - cap}L${a.x} ${a.y + cap}M${b.x} ${b.y - cap}L${b.x} ${b.y + cap}`}
          />
        ) : (
          <path
            key={i}
            d={`M${a.x} ${a.y}L${b.x} ${b.y}M${a.x - cap} ${a.y}L${a.x + cap} ${a.y}M${b.x - cap} ${b.y}L${b.x + cap} ${b.y}`}
          />
        )
      })}
    </g>
  )
}

/* ---------- markers ---------- */

function Markers({ s, p, st, onPick, selected }: MarkProps) {
  const kind: MarkerKind = s.spec.marker ?? 'none'
  if (kind === 'none') return null
  const r = (s.spec.markerSize ?? (st.paper ? 3.2 : 5)) * 1
  const hollow = kind === 'hollow'
  const stroke = STROKE_ONLY.has(kind) || hollow
  return (
    <g>
      {s.data.map((d, i) => {
        if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) return null
        const c = p.at(d.x, d.y)
        // area encodes the size column, so the radius is its square root
        const rr = d.s !== undefined && Number.isFinite(d.s) ? Math.sqrt(Math.abs(d.s)) : r
        return (
          <Fragment key={i}>
            <path
              d={markerPath(hollow ? 'circle' : kind, c, rr)}
              fill={stroke ? (hollow ? st.c.hole : 'none') : s.color}
              fillOpacity={opacityOf(s.spec.opacity)}
              stroke={stroke ? s.color : (st.outline ? st.c.outline ?? undefined : undefined)}
              strokeWidth={stroke ? st.marker : st.outline || undefined}
              onPointerDown={pickHandler(onPick, s.spec.id, d.row)}
              style={onPick ? { cursor: 'pointer' } : undefined}
            />
            {isSel(selected, s.spec.id, d.row) && (
              <path
                {...{ [UI_ONLY]: '1' }}
                d={markerPath('circle', c, rr + 4)}
                fill="none"
                stroke={SELECT_INK}
                strokeWidth={2}
              />
            )}
          </Fragment>
        )
      })}
    </g>
  )
}

/* ---------- line family ---------- */

export function LineMark(props: MarkProps) {
  const { s, p, st } = props
  const pts = s.data.map((d) =>
    Number.isFinite(d.x) && Number.isFinite(d.y) ? p.at(d.x, d.y) : null,
  )
  const d =
    s.mark === 'step'
      ? stepPath(pts, s.spec.stepAt ?? 'post')
      : s.spec.smooth
        ? smoothPath(pts)
        : linePath(pts)
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={s.color}
        strokeWidth={s.spec.width ?? st.line}
        strokeDasharray={dashOf(s.spec.dash)}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={opacityOf(s.spec.opacity)}
      />
      <ErrorBars {...props} />
      <Markers {...props} />
      <DataLabels
        {...props}
        pts={s.data.map((dd) => ({ d: dd, at: p.at(dd.x, dd.y) }))}
      />
    </g>
  )
}

export function AreaMark(props: MarkProps) {
  const { s, p, st } = props
  const top = s.data.map((d) => (Number.isFinite(d.y) ? p.at(d.x, d.y) : null))
  const floor = baseOf(p)
  const bottom = s.data.map((d) => p.at(d.x, d.y0 ?? floor))
  return (
    <g>
      <path
        d={bandPath(top, bottom, s.spec.smooth)}
        fill={s.color}
        fillOpacity={opacityOf(s.spec.fillOpacity, st.paper ? 0.28 : 0.4)}
        stroke="none"
      />
      <path
        d={s.spec.smooth ? smoothPath(top) : linePath(top)}
        fill="none"
        stroke={s.color}
        strokeWidth={s.spec.width ?? st.line}
        strokeDasharray={dashOf(s.spec.dash)}
        strokeLinejoin="round"
      />
      <Markers {...props} />
      <DataLabels {...props} pts={s.data.map((dd) => ({ d: dd, at: p.at(dd.x, dd.y) }))} />
    </g>
  )
}

export function StemMark(props: MarkProps) {
  const { s, p, st } = props
  const floor = baseOf(p)
  return (
    <g>
      <g stroke={s.color} strokeWidth={s.spec.width ?? Math.max(1, st.line * 0.6)}>
        {s.data.map((d, i) => {
          const a = p.at(d.x, floor)
          const b = p.at(d.x, d.y)
          return <path key={i} d={`M${a.x} ${a.y}L${b.x} ${b.y}`} />
        })}
      </g>
      <Markers {...props} s={{ ...s, spec: { ...s.spec, marker: s.spec.marker ?? 'circle' } }} />
      <DataLabels {...props} pts={s.data.map((dd) => ({ d: dd, at: p.at(dd.x, dd.y) }))} />
    </g>
  )
}

export function ScatterMark(props: MarkProps) {
  const { s, p, st, onPick, selected } = props
  const map = colorMapById(s.spec.colorMap ?? 'viridis')
  const vs = s.data.map((d) => d.v).filter((v): v is number => v !== undefined && Number.isFinite(v))
  const vmin = s.spec.vmin ?? (vs.length ? Math.min(...vs) : 0)
  const vmax = s.spec.vmax ?? (vs.length ? Math.max(...vs) : 1)
  const kind = s.spec.marker && s.spec.marker !== 'none' ? s.spec.marker : 'circle'
  const base = s.spec.markerSize ?? (st.paper ? 3.4 : 6)
  const sizes = s.data.map((d) => d.s).filter((v): v is number => v !== undefined && Number.isFinite(v))
  const smax = sizes.length ? Math.max(...sizes) : 1
  const stroke = STROKE_ONLY.has(kind) || kind === 'hollow'
  return (
    <g>
      {s.data.map((d, i) => {
        if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) return null
        const c = p.at(d.x, d.y)
        const fill =
          d.v !== undefined && Number.isFinite(d.v)
            ? sampleMap(map, (d.v - vmin) / (vmax - vmin || 1))
            : s.color
        // area, not radius, carries the size column
        const r =
          d.s !== undefined && Number.isFinite(d.s) && smax > 0
            ? base * Math.sqrt(Math.max(0, d.s) / smax) * 2
            : base
        return (
          <Fragment key={i}>
            <path
              d={markerPath(kind === 'hollow' ? 'circle' : kind, c, Math.max(1, r))}
              fill={stroke ? (kind === 'hollow' ? st.c.hole : 'none') : fill}
              fillOpacity={opacityOf(s.spec.opacity)}
              stroke={stroke ? fill : st.outline ? st.c.outline ?? undefined : undefined}
              strokeWidth={stroke ? st.marker : st.outline || undefined}
              onPointerDown={pickHandler(onPick, s.spec.id, d.row)}
              style={onPick ? { cursor: 'pointer' } : undefined}
            />
            {isSel(selected, s.spec.id, d.row) && (
              <path
                {...{ [UI_ONLY]: '1' }}
                d={markerPath('circle', c, Math.max(1, r) + 4)}
                fill="none"
                stroke={SELECT_INK}
                strokeWidth={2}
              />
            )}
          </Fragment>
        )
      })}
      <ErrorBars {...props} />
      <DataLabels {...props} pts={s.data.map((dd) => ({ d: dd, at: p.at(dd.x, dd.y) }))} />
    </g>
  )
}

/* ---------- trend line ---------- */

export function TrendLine({ s, p, st }: MarkProps) {
  const kind = s.spec.trend
  if (!kind || kind === 'none') return null
  if (kind === 'mean') {
    const ys = s.data.map((d) => d.y).filter((v) => Number.isFinite(v))
    if (!ys.length) return null
    const m = ys.reduce((a, b) => a + b, 0) / ys.length
    const a = p.at(p.ax.min, m)
    const b = p.at(p.ax.max, m)
    return (
      <path
        d={`M${a.x} ${a.y}L${b.x} ${b.y}`}
        stroke={s.color}
        strokeWidth={Math.max(1, st.line * 0.7)}
        strokeDasharray="7 5"
        fill="none"
      />
    )
  }
  if (!s.fit) return null
  const steps = 64
  const pts: P[] = []
  for (let i = 0; i <= steps; i++) {
    const x = p.ax.min + ((p.ax.max - p.ax.min) * i) / steps
    pts.push(p.at(x, s.fit.at(x)))
  }
  return (
    <g>
      <path
        d={linePath(pts)}
        fill="none"
        stroke={s.color}
        strokeWidth={Math.max(1, st.line * 0.7)}
        strokeDasharray="7 5"
        opacity={0.9}
      />
      {s.spec.trendLabel && (
        <text
          x={p.rect.x + p.rect.w - 8}
          y={p.rect.y + 14}
          textAnchor="end"
          fontSize={st.dataLabel}
          fontFamily={st.numeric}
          fill={s.color}
        >
          {`R² = ${s.fit.r2.toFixed(3)}`}
        </text>
      )}
    </g>
  )
}

/* ---------- box and violin ---------- */

export function BoxMark({ s, p, st, slot, onPick, selected }: MarkProps) {
  const count = slot?.count ?? 1
  const index = slot?.index ?? 0
  const full = (p.ax.kind === 'category' ? p.ax.band : p.ax.band / Math.max(1, s.boxes?.length ?? 1)) * (s.spec.barWidth ?? 0.62)
  const w = full / count
  const off = -full / 2 + w * index + w / 2

  return (
    <g>
      {(s.boxes ?? []).map((b, i) => {
        const st_ = b.stats
        if (!Number.isFinite(st_.median)) return null
        const cross = (p.flip ? p.at(b.x, 0).y : p.at(b.x, 0).x) + off
        const v = (val: number) => (p.flip ? p.at(b.x, val).x : p.at(b.x, val).y)
        const q1 = v(st_.q1)
        const q3 = v(st_.q3)
        const med = v(st_.median)
        const lo = v(st_.min)
        const hi = v(st_.max)
        const half = w / 2
        const boxRect = p.flip
          ? { x: Math.min(q1, q3), y: cross - half, width: Math.abs(q3 - q1), height: w }
          : { x: cross - half, y: Math.min(q1, q3), width: w, height: Math.abs(q3 - q1) }
        const seg = (a: number, b2: number) =>
          p.flip ? `M${a} ${cross}L${b2} ${cross}` : `M${cross} ${a}L${cross} ${b2}`
        const capAt = (at: number) =>
          p.flip
            ? `M${at} ${cross - half * 0.5}L${at} ${cross + half * 0.5}`
            : `M${cross - half * 0.5} ${at}L${cross + half * 0.5} ${at}`
        const medLine = p.flip
          ? `M${med} ${cross - half}L${med} ${cross + half}`
          : `M${cross - half} ${med}L${cross + half} ${med}`
        return (
          <Fragment key={i}>
            {b.density && (
              <ViolinBody b={b} cross={cross} half={half} p={p} color={s.color} st={st} />
            )}
            <path
              d={`${seg(lo, q1)} ${seg(q3, hi)} ${capAt(lo)} ${capAt(hi)}`}
              stroke={st.paper ? st.c.ink : st.c.outline ?? st.c.ink}
              strokeWidth={Math.max(1, st.axis * 0.7)}
              fill="none"
            />
            <rect
              {...boxRect}
              fill={s.color}
              fillOpacity={opacityOf(s.spec.fillOpacity, b.density ? 0.9 : 1)}
              stroke={st.paper ? st.c.ink : st.c.outline ?? undefined}
              strokeWidth={st.paper ? 0.9 : st.outline}
              onPointerDown={pickHandler(onPick, s.spec.id, i)}
              style={onPick ? { cursor: 'pointer' } : undefined}
            />
            <path d={medLine} stroke={st.paper ? '#ffffff' : '#222222'} strokeWidth={Math.max(1.4, st.axis)} />
            {st_.outliers.map((o, k) => {
              const c = p.at(b.x, o)
              const cc = p.flip ? { x: c.x, y: cross } : { x: cross, y: c.y }
              return (
                <path
                  key={k}
                  d={markerPath('circle', cc, st.paper ? 2 : 3)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={Math.max(1, st.marker * 0.7)}
                />
              )
            })}
            {isSel(selected, s.spec.id, i) && (
              <rect
                {...{ [UI_ONLY]: '1' }}
                x={boxRect.x - 3}
                y={boxRect.y - 3}
                width={boxRect.width + 6}
                height={boxRect.height + 6}
                fill="none"
                stroke={SELECT_INK}
                strokeWidth={2}
              />
            )}
          </Fragment>
        )
      })}
    </g>
  )
}

function ViolinBody({
  b,
  cross,
  half,
  p,
  color,
  st,
}: {
  b: NonNullable<ResolvedSeries['boxes']>[number]
  cross: number
  half: number
  p: Proj
  color: string
  st: PlotStyle
}) {
  const den = b.density ?? []
  if (den.length < 2) return null
  const dmax = Math.max(...den.map((d) => d.d)) || 1
  const wing = half * 1.7
  const right = den.map((d) => {
    const at = p.at(b.x, d.v)
    const off = (d.d / dmax) * wing
    return p.flip ? { x: at.x, y: cross - off } : { x: cross + off, y: at.y }
  })
  const left = den
    .map((d) => {
      const at = p.at(b.x, d.v)
      const off = (d.d / dmax) * wing
      return p.flip ? { x: at.x, y: cross + off } : { x: cross - off, y: at.y }
    })
    .reverse()
  return (
    <path
      d={`${linePath(right)} ${left.map((q) => `L${q.x.toFixed(2)} ${q.y.toFixed(2)}`).join(' ')} Z`}
      fill={color}
      fillOpacity={0.3}
      stroke={color}
      strokeWidth={Math.max(1, st.line * 0.5)}
    />
  )
}

/* ---------- fields ---------- */

/** A heatmap, and — with `levels` — a filled contour.
 *
 *  The smooth variant upsamples the grid and shades each sub-cell by bilinear
 *  interpolation. It is not marching squares, but for a filled field that is
 *  what a reader sees anyway, and it stays vector: quantising the colour to
 *  `levels` steps produces the banded look of contourf with no polygon
 *  assembly and no rasterisation. */
export function HeatMark({ s, p, st, onPick }: MarkProps) {
  const f = s.field
  if (!f || !f.xs.length || !f.ys.length) return null
  const map = colorMapById(s.spec.colorMap ?? 'viridis')
  const flat = f.z.flat().filter((v): v is number => v !== null && Number.isFinite(v))
  if (!flat.length) return null
  const vmin = s.spec.vmin ?? Math.min(...flat)
  const vmax = s.spec.vmax ?? Math.max(...flat)
  const levels = s.spec.levels && s.spec.levels > 1 ? s.spec.levels : 0
  const norm = (v: number) => {
    const t = (v - vmin) / (vmax - vmin || 1)
    return levels ? Math.round(t * (levels - 1)) / (levels - 1) : t
  }

  const edge = (arr: number[], i: number, side: -1 | 1) => {
    const cur = arr[i]
    const nb = arr[i + side]
    if (nb === undefined) {
      const other = arr[i - side]
      return other === undefined ? cur + side * 0.5 : cur + (cur - other) / 2
    }
    return (cur + nb) / 2
  }

  return (
    <g>
      {f.ys.map((_yv, yi) =>
        f.xs.map((_xv, xi) => {
          const v = f.z[yi][xi]
          if (v === null) return null
          const a = p.at(edge(f.xs, xi, -1), edge(f.ys, yi, -1))
          const b = p.at(edge(f.xs, xi, 1), edge(f.ys, yi, 1))
          const x = Math.min(a.x, b.x)
          const y = Math.min(a.y, b.y)
          const w = Math.abs(b.x - a.x)
          const h = Math.abs(b.y - a.y)
          const fill = sampleMap(map, norm(v))
          return (
            <Fragment key={`${xi}:${yi}`}>
              <rect
                x={x}
                y={y}
                // a hairline overlap, or antialiasing draws a grid of white seams
                width={w + 0.5}
                height={h + 0.5}
                fill={fill}
                opacity={opacityOf(s.spec.opacity)}
                onPointerDown={pickHandler(onPick, s.spec.id, yi * f.xs.length + xi)}
                style={onPick ? { cursor: 'pointer' } : undefined}
              />
              {s.spec.labels && w > st.dataLabel * 2 && h > st.dataLabel * 1.4 && (
                <text
                  x={x + w / 2}
                  y={y + h / 2 + st.dataLabel * 0.35}
                  textAnchor="middle"
                  fontSize={st.dataLabel}
                  fontFamily={st.numeric}
                  fill={inkOn(fill)}
                >
                  {formatTick(v, { format: s.spec.labelFormat }, Math.abs(vmax - vmin) / 50 || 1).label}
                </text>
              )}
            </Fragment>
          )
        }),
      )}
    </g>
  )
}

/** Isolines by marching squares.
 *
 *  Each cell contributes independent segments; they are not stitched into
 *  closed loops. For drawing that makes no difference — the segments meet at
 *  shared edges — and it removes the whole class of bugs that loop assembly
 *  brings with saddle points. */
export function ContourMark({ s, p, st }: MarkProps) {
  const f = s.field
  if (!f || f.xs.length < 2 || f.ys.length < 2) return null
  const flat = f.z.flat().filter((v): v is number => v !== null && Number.isFinite(v))
  if (!flat.length) return null
  const vmin = s.spec.vmin ?? Math.min(...flat)
  const vmax = s.spec.vmax ?? Math.max(...flat)
  const k = Math.max(2, Math.min(40, s.spec.levels ?? 8))
  const map = colorMapById(s.spec.colorMap ?? 'viridis')
  const useMap = !!s.spec.colorMap

  const paths: { d: string; color: string; level: number }[] = []
  for (let li = 0; li < k; li++) {
    const t = (li + 1) / (k + 1)
    const level = vmin + (vmax - vmin) * t
    let d = ''
    for (let yi = 0; yi < f.ys.length - 1; yi++)
      for (let xi = 0; xi < f.xs.length - 1; xi++) {
        const corners = [
          { v: f.z[yi][xi], x: f.xs[xi], y: f.ys[yi] },
          { v: f.z[yi][xi + 1], x: f.xs[xi + 1], y: f.ys[yi] },
          { v: f.z[yi + 1][xi + 1], x: f.xs[xi + 1], y: f.ys[yi + 1] },
          { v: f.z[yi + 1][xi], x: f.xs[xi], y: f.ys[yi + 1] },
        ]
        if (corners.some((c) => c.v === null)) continue
        const cuts: P[] = []
        for (let e = 0; e < 4; e++) {
          const a = corners[e]
          const b = corners[(e + 1) % 4]
          const av = a.v as number
          const bv = b.v as number
          if (av === bv) continue
          if ((av < level && bv >= level) || (bv < level && av >= level)) {
            const u = (level - av) / (bv - av)
            cuts.push(p.at(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u))
          }
        }
        for (let i = 0; i + 1 < cuts.length; i += 2)
          d += `M${cuts[i].x.toFixed(2)} ${cuts[i].y.toFixed(2)}L${cuts[i + 1].x.toFixed(2)} ${cuts[i + 1].y.toFixed(2)}`
      }
    if (d) paths.push({ d, color: useMap ? sampleMap(map, t) : s.color, level })
  }
  return (
    <g fill="none" strokeWidth={s.spec.width ?? Math.max(1, st.line * 0.5)}>
      {paths.map((q, i) => (
        <path key={i} d={q.d} stroke={q.color} strokeDasharray={dashOf(s.spec.dash)} />
      ))}
    </g>
  )
}

/** A vector field. Arrows are scaled together so their relative lengths mean
 *  something; the longest is capped at one grid step. */
export function QuiverMark({ s, p, st }: MarkProps) {
  const withUV = s.data.filter((d) => Number.isFinite(d.u ?? NaN) && Number.isFinite(d.w ?? NaN))
  if (!withUV.length) return null
  const mags = withUV.map((d) => Math.hypot(d.u!, d.w!))
  const maxMag = Math.max(...mags) || 1
  const xs = [...new Set(withUV.map((d) => d.x))].sort((a, b) => a - b)
  let step = Infinity
  for (let i = 1; i < xs.length; i++) step = Math.min(step, Math.abs(p.ax.px(xs[i]) - p.ax.px(xs[i - 1])))
  const cap = Number.isFinite(step) ? step * 0.9 : p.rect.w / 10
  return (
    <g stroke={s.color} strokeWidth={Math.max(1, st.line * 0.5)} fill={s.color}>
      {withUV.map((d, i) => {
        const o = p.at(d.x, d.y)
        const mag = Math.hypot(d.u!, d.w!)
        const len = (mag / maxMag) * cap
        const ang = Math.atan2(-d.w!, d.u!)
        const tip = { x: o.x + len * Math.cos(ang), y: o.y + len * Math.sin(ang) }
        return (
          <Fragment key={i}>
            <path d={`M${o.x.toFixed(2)} ${o.y.toFixed(2)}L${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`} />
            <path d={arrowHead(tip, ang, Math.max(4, len * 0.3))} stroke="none" />
          </Fragment>
        )
      })}
    </g>
  )
}

/* ---------- pie ---------- */

export function PieMark({
  s,
  st,
  cx,
  cy,
  r,
  palette,
  onPick,
  selected,
}: {
  s: ResolvedSeries
  st: PlotStyle
  cx: number
  cy: number
  r: number
  palette: string[]
  onPick?: (seriesId: string, row: number) => void
  selected?: { seriesId: string; row: number } | null
}) {
  const vals = s.data.filter((d) => Number.isFinite(d.y) && d.y > 0)
  const total = vals.reduce((acc, d) => acc + d.y, 0) || 1
  const hole = s.spec.hole ?? 0
  /* The running angle is accumulated up front rather than inside the map: a
     closure that mutates during render is exactly what breaks when React
     re-runs one. */
  const spans: { a0: number; a1: number; frac: number }[] = []
  let acc = -Math.PI / 2
  for (const d of vals) {
    const frac = d.y / total
    spans.push({ a0: acc, a1: acc + frac * Math.PI * 2, frac })
    acc += frac * Math.PI * 2
  }
  return (
    <g>
      {vals.map((d, i) => {
        const { a0, a1, frac } = spans[i]
        const path = slicePath({ x: cx, y: cy }, r, a0, a1, hole)
        const mid = (a0 + a1) / 2
        const lr = hole > 0 ? r * (hole + (1 - hole) / 2) : r * 0.62
        const lx = cx + lr * Math.cos(mid)
        const ly = cy + lr * Math.sin(mid)
        const fill = palette[i % palette.length]
        return (
          <Fragment key={i}>
            <path
              d={path}
              fill={fill}
              fillOpacity={opacityOf(s.spec.opacity)}
              stroke={st.outline ? st.c.outline ?? undefined : '#ffffff'}
              strokeWidth={st.outline || 1}
              onPointerDown={pickHandler(onPick, s.spec.id, d.row)}
              style={onPick ? { cursor: 'pointer' } : undefined}
            />
            {isSel(selected, s.spec.id, d.row) && (
              <path
                {...{ [UI_ONLY]: '1' }}
                d={path}
                fill="none"
                stroke={SELECT_INK}
                strokeWidth={2.5}
              />
            )}
            {s.spec.labels !== false && frac > 0.035 && (
              <text
                x={lx}
                y={ly + st.dataLabel * 0.35}
                textAnchor="middle"
                fontSize={st.dataLabel}
                fontWeight={st.bold}
                fontFamily={st.numeric}
                fill={inkOn(fill)}
              >
                {`${Math.round(frac * 1000) / 10}%`}
              </text>
            )}
          </Fragment>
        )
      })}
    </g>
  )
}
