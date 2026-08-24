/* One cartesian panel: work out the margins, build the axes, draw the frame,
 * then hand the plot rectangle to the marks.
 *
 * ⚠️ The axes are built twice. A tick label's width decides the left margin,
 * and the left margin decides the axis's pixel range — so the first build
 * exists only to produce tick *text*. This is safe because a domain and its
 * ticks never depend on the pixel range: only `px`/`inv` do. If that ever stops
 * being true, this becomes a layout loop rather than two passes.
 *
 * ⚠️ Marks are clipped to the plot rectangle. Without it, a pinned axis range
 * lets a line run out across the tick labels and the neighbouring panel, which
 * looks like a rendering bug rather than like data outside the view. */

import { Fragment, useMemo } from 'react'
import { buildAxis, formatTick, type Axis, type AxisSpec } from './scale'
import type { ResolvedPanel, ResolvedSeries } from './resolve'
import type { AnnotationSpec } from './spec'
import { DASH_ARRAY } from './spec'
import type { PlotStyle } from './style'
import { textWidth, arrowHead } from './geom'
import { TickLabel } from './svgbits'
import {
  AreaMark,
  BarMark,
  BoxMark,
  ContourMark,
  HeatMark,
  LineMark,
  PieMark,
  QuiverMark,
  ScatterMark,
  StemMark,
  TrendLine,
  type MarkProps,
} from './marks'
import { makeProj, panelFlip, type Proj, type Rect } from './frame'
import { colorMapById, sampleMap } from '../palette'

export interface PanelProps {
  rp: ResolvedPanel
  rect: Rect
  st: PlotStyle
  palette: string[]
  clipId: string
  /** domains forced by the figure's shareX / shareY */
  shareX?: [number, number]
  shareY?: [number, number]
  /** inner panels of a shared grid drop their tick text */
  hideXTicks?: boolean
  hideYTicks?: boolean
  onPick?: (seriesId: string, row: number) => void
  selected?: { seriesId: string; row: number } | null
}

const BAR_LIKE = new Set(['bar', 'histogram'])
const isPiePanel = (rp: ResolvedPanel) =>
  rp.series.length > 0 && rp.series.every((s) => s.mark === 'pie')

/* ---------- margins ---------- */

interface Margins {
  l: number
  r: number
  t: number
  b: number
}

function measure(
  rp: ResolvedPanel,
  st: PlotStyle,
  flip: boolean,
  hideXTicks: boolean,
  hideYTicks: boolean,
  hasBar: boolean,
): Margins {
  const { axSpec, aySpec } = axisSpecs(rp, flip, hasBar)
  const y2Spec: AxisSpec | null = rp.y2Values.length ? { pad: 0.05, ...(rp.spec.y2 ?? {}) } : null

  // pass one: any pixel range will do, the ticks come out the same
  const probeAx = buildAxis(axSpec, { values: rp.xValues, categories: rp.xCategories ?? undefined }, 0, 100)
  const probeAy = buildAxis(aySpec, { values: rp.yValues }, 100, 0)
  const probeY2 = y2Spec ? buildAxis(y2Spec, { values: rp.y2Values }, 100, 0) : null

  const vert = flip ? probeAx : probeAy
  const horiz = flip ? probeAy : probeAx

  const tickW = (a: Axis) =>
    a.ticks.reduce((w, t) => Math.max(w, textWidth(t.label + (t.sup ?? ''), st.tick)), 0)

  const gap = st.tickLen + 5
  const vertLabel = rp.spec.y?.label
  const horizLabel = rp.spec.x?.label
  const angle = horiz.spec.angle ?? (horiz.kind === 'category' ? autoAngle(horiz, st) : 0)

  let l = hideYTicks ? gap : gap + tickW(vert)
  if (vertLabel) l += st.axisLabel * 1.5
  l = Math.max(l, 10)

  const horizTickH = hideXTicks
    ? 0
    : angle
      ? Math.abs(Math.sin((angle * Math.PI) / 180)) * tickW(horiz) + st.tick * 0.8
      : st.tick * 1.25
  let b = gap + horizTickH
  if (horizLabel) b += st.axisLabel * 1.5
  b = Math.max(b, 12)

  let t = rp.spec.title ? st.panelTitle * 1.9 : st.tick * 0.9
  // the topmost tick label needs room not to be shaved by the panel edge
  t = Math.max(t, st.tick * 0.9)

  let r = st.tick * 0.9

  /* The end tick labels of the horizontal axis are centred on the plot's own
     corners, so half of each hangs outside it. On an axis whose labels are
     wider than the y-axis ones — 100,000 against 10⁵ — that half falls off the
     figure entirely. */
  if (!hideXTicks && horiz.ticks.length && !angle) {
    const half = (t2: (typeof horiz.ticks)[number]) =>
      textWidth(t2.label + (t2.sup ?? ''), st.tick) / 2 + 2
    l = Math.max(l, half(horiz.ticks[0]))
    r = Math.max(r, half(horiz.ticks[horiz.ticks.length - 1]))
  }
  if (probeY2) {
    r = gap + tickW(probeY2)
    if (rp.spec.y2?.label) r += st.axisLabel * 1.5
  }
  if (rp.spec.legend?.pos === 'right')
    r += Math.max(...legendEntries(rp).map((e) => textWidth(e.name, st.legend)), 0) + st.legend * 3

  return { l, r, t, b }
}

/* `panel.x` is the axis that runs across the page and `panel.y` the one that
 * runs up it — always, whichever way the marks are turned. A horizontal bar
 * chart therefore labels its value axis under `x`, which is where both
 * matplotlib and the reader expect to find it.
 *
 * ⚠️ Marks think in terms of a datum's x and y, which is the *other* pairing.
 * These two are what translate between them, and nothing else may. */
function axisSpecs(rp: ResolvedPanel, flip: boolean, hasBar: boolean) {
  // every numeric axis gets a little headroom; a category axis has its own
  const posDefaults: AxisSpec = { pad: 0.05 }
  // a bar has to stand on zero, and the axis it stands on is the value one
  const valueDefaults: AxisSpec = { pad: hasBar ? 0 : 0.05, zero: hasBar }
  const horiz: AxisSpec = { ...(rp.spec.x ?? {}) }
  const vert: AxisSpec = { ...(rp.spec.y ?? {}) }
  return flip
    ? { axSpec: { ...posDefaults, ...vert }, aySpec: { ...valueDefaults, ...horiz } }
    : { axSpec: { ...posDefaults, ...horiz }, aySpec: { ...valueDefaults, ...vert } }
}

/** Rotate category labels only once they would collide. */
function autoAngle(a: Axis, st: PlotStyle): number {
  const widest = a.ticks.reduce((w, t) => Math.max(w, textWidth(t.label, st.tick)), 0)
  return widest > a.band * 0.95 ? -35 : 0
}

/* ---------- legend ---------- */

interface LegendEntry {
  name: string
  color: string
  mark: string
  spec: ResolvedSeries['spec']
}

function legendEntries(rp: ResolvedPanel): LegendEntry[] {
  const out: LegendEntry[] = []
  const seen = new Set<string>()
  for (const s of rp.series) {
    if (s.mark === 'pie' || s.spec.colorEach) {
      // the key is the slices, or the categories — not the series, which has
      // no single colour to show
      s.data.forEach((d, i) => {
        const name = d.label ?? `${i + 1}`
        if (seen.has(name)) return
        seen.add(name)
        out.push({ name, color: '', mark: 'pie', spec: s.spec })
      })
      continue
    }
    if (seen.has(s.name)) continue
    seen.add(s.name)
    out.push({ name: s.name, color: s.color, mark: s.mark, spec: s.spec })
  }
  return out
}

function Legend({
  rp,
  plot,
  st,
  palette,
}: {
  rp: ResolvedPanel
  plot: Rect
  st: PlotStyle
  palette: string[]
}) {
  const pos = rp.spec.legend?.pos ?? 'top-right'
  if (pos === 'none') return null
  const entries = legendEntries(rp)
  if (entries.length < 1) return null

  const size = st.legend
  const rowH = size * 1.55
  const swatch = size * 1.1
  const pad = size * 0.6
  const cols = Math.max(1, rp.spec.legend?.columns ?? 1)
  const rows = Math.ceil(entries.length / cols)
  const colW =
    Math.max(...entries.map((e) => textWidth(e.name, size))) + swatch + size * 1.2
  const boxW = colW * cols + pad * 2
  const boxH = rows * rowH + pad * 2 + (rp.spec.legend?.title ? rowH : 0)

  const inset = size * 0.6
  let x = plot.x + inset
  let y = plot.y + inset
  if (pos === 'top-right' || pos === 'bottom-right') x = plot.x + plot.w - boxW - inset
  if (pos === 'bottom-left' || pos === 'bottom-right') y = plot.y + plot.h - boxH - inset
  if (pos === 'top') {
    x = plot.x + (plot.w - boxW) / 2
    y = plot.y + inset
  }
  if (pos === 'bottom') {
    x = plot.x + (plot.w - boxW) / 2
    y = plot.y + plot.h - boxH - inset
  }
  if (pos === 'right') {
    x = plot.x + plot.w + size * 1.2
    y = plot.y + (plot.h - boxH) / 2
  }

  const titleH = rp.spec.legend?.title ? rowH : 0
  return (
    <g>
      {rp.spec.legend?.frame !== false && (
        <rect
          x={x}
          y={y}
          width={boxW}
          height={boxH}
          fill={st.c.hole}
          fillOpacity={st.paper ? 0.85 : 0.92}
          stroke={st.paper ? st.c.grid : st.c.outline ?? st.c.ink}
          strokeWidth={st.paper ? 0.7 : 2}
        />
      )}
      {rp.spec.legend?.title && (
        <text
          x={x + pad}
          y={y + pad + size}
          fontSize={size}
          fontWeight={st.bold === 400 ? 600 : 800}
          fill={st.c.ink}
          fontFamily={st.font}
        >
          {rp.spec.legend.title}
        </text>
      )}
      {entries.map((e, i) => {
        const col = Math.floor(i / rows)
        const row = i % rows
        const ex = x + pad + col * colW
        const ey = y + pad + titleH + row * rowH + rowH / 2
        const color = e.mark === 'pie' || e.spec.colorEach ? palette[i % palette.length] : e.color
        return (
          <Fragment key={`${e.name}:${i}`}>
            <LegendGlyph mark={e.mark} spec={e.spec} color={color} x={ex} y={ey} size={swatch} st={st} />
            <text
              x={ex + swatch + size * 0.55}
              y={ey + size * 0.36}
              fontSize={size}
              fill={st.c.ink}
              fontFamily={st.font}
            >
              {e.name}
            </text>
          </Fragment>
        )
      })}
    </g>
  )
}

/** A legend key that looks like the mark it stands for — a dashed line for a
 *  dashed series, a hollow marker for a hollow one. A row of identical squares
 *  is a legend that only half works. */
function LegendGlyph({
  mark,
  spec,
  color,
  x,
  y,
  size,
  st,
}: {
  mark: string
  spec: ResolvedSeries['spec']
  color: string
  x: number
  y: number
  size: number
  st: PlotStyle
}) {
  const lineLike = mark === 'line' || mark === 'step' || mark === 'stem' || mark === 'contour'
  if (lineLike)
    return (
      <path
        d={`M${x} ${y}L${x + size} ${y}`}
        stroke={color}
        strokeWidth={Math.min(size * 0.5, spec.width ?? st.line)}
        strokeDasharray={spec.dash ? DASH_ARRAY[spec.dash] : undefined}
        strokeLinecap="round"
      />
    )
  if (mark === 'scatter')
    return (
      <circle
        cx={x + size / 2}
        cy={y}
        r={size * 0.36}
        fill={color}
        stroke={st.c.outline ?? undefined}
        strokeWidth={st.outline || undefined}
      />
    )
  return (
    <rect
      x={x}
      y={y - size / 2}
      width={size}
      height={size}
      fill={color}
      fillOpacity={mark === 'area' ? 0.55 : 1}
      stroke={st.c.outline ?? undefined}
      strokeWidth={st.outline || undefined}
    />
  )
}

/* ---------- annotations ---------- */

function Annotations({
  list,
  p,
  st,
  plot,
}: {
  list: AnnotationSpec[]
  p: Proj
  st: PlotStyle
  plot: Rect
}) {
  return (
    <g>
      {list.map((a) => {
        const color = a.color ?? st.c.muted
        const w = a.width ?? Math.max(1, st.axis * 0.7)
        const dash = a.dash ? DASH_ARRAY[a.dash] : '6 4'
        const font = a.fontSize ?? st.dataLabel
        if (a.kind === 'hline' || a.kind === 'vline') {
          const along = a.kind === 'hline'
          const v = (along ? a.y : a.x) ?? 0
          const q0 = along ? p.at(p.ax.min, v) : p.at(v, p.ay.min)
          const q1 = along ? p.at(p.ax.max, v) : p.at(v, p.ay.max)
          const tx = a.align === 'start' ? q0.x : a.align === 'middle' ? (q0.x + q1.x) / 2 : q1.x
          const ty = a.align === 'start' ? q0.y : a.align === 'middle' ? (q0.y + q1.y) / 2 : q1.y
          return (
            <Fragment key={a.id}>
              <path
                d={`M${q0.x} ${q0.y}L${q1.x} ${q1.y}`}
                stroke={color}
                strokeWidth={w}
                strokeDasharray={dash}
                opacity={a.opacity ?? 1}
              />
              {a.text && (
                <text
                  x={tx + (along ? -4 : 4)}
                  y={ty - (along ? 4 : -font)}
                  textAnchor={along ? 'end' : 'start'}
                  fontSize={font}
                  fill={color}
                  fontFamily={st.font}
                >
                  {a.text}
                </text>
              )}
            </Fragment>
          )
        }
        if (a.kind === 'hband' || a.kind === 'vband' || a.kind === 'rect') {
          const band = a.kind === 'hband'
          const c0 =
            a.kind === 'rect'
              ? p.at(a.x ?? p.ax.min, a.y ?? p.ay.min)
              : band
                ? p.at(p.ax.min, a.y ?? 0)
                : p.at(a.x ?? 0, p.ay.min)
          const c1 =
            a.kind === 'rect'
              ? p.at(a.x2 ?? p.ax.max, a.y2 ?? p.ay.max)
              : band
                ? p.at(p.ax.max, a.y2 ?? 0)
                : p.at(a.x2 ?? 0, p.ay.max)
          return (
            <Fragment key={a.id}>
              <rect
                x={Math.min(c0.x, c1.x)}
                y={Math.min(c0.y, c1.y)}
                width={Math.abs(c1.x - c0.x)}
                height={Math.abs(c1.y - c0.y)}
                fill={color}
                fillOpacity={a.opacity ?? 0.14}
                stroke="none"
              />
              {a.text && (
                <text
                  x={Math.min(c0.x, c1.x) + 5}
                  y={Math.min(c0.y, c1.y) + font * 1.2}
                  fontSize={font}
                  fill={color}
                  fontFamily={st.font}
                >
                  {a.text}
                </text>
              )}
            </Fragment>
          )
        }
        if (a.kind === 'arrow') {
          const from = p.at(a.x ?? 0, a.y ?? 0)
          const to = p.at(a.x2 ?? 0, a.y2 ?? 0)
          const ang = Math.atan2(to.y - from.y, to.x - from.x)
          const head = Math.max(6, w * 4)
          return (
            <Fragment key={a.id}>
              <path
                d={`M${from.x} ${from.y}L${to.x - Math.cos(ang) * head * 0.8} ${to.y - Math.sin(ang) * head * 0.8}`}
                stroke={color}
                strokeWidth={w}
                fill="none"
              />
              <path d={arrowHead(to, ang, head)} fill={color} />
              {a.text && (
                <text
                  x={from.x}
                  y={from.y - 6}
                  fontSize={font}
                  fill={color}
                  fontFamily={st.font}
                  textAnchor="middle"
                >
                  {a.text}
                </text>
              )}
            </Fragment>
          )
        }
        // text
        const at = a.x !== undefined || a.y !== undefined ? p.at(a.x ?? 0, a.y ?? 0) : { x: plot.x + plot.w / 2, y: plot.y + plot.h / 2 }
        return (
          <text
            key={a.id}
            x={at.x}
            y={at.y}
            fontSize={font}
            fill={a.color ?? st.c.ink}
            fontFamily={st.font}
            textAnchor={a.align === 'start' ? 'start' : a.align === 'end' ? 'end' : 'middle'}
          >
            {a.text}
          </text>
        )
      })}
    </g>
  )
}

/* ---------- colour bar ---------- */

function ColorBar({
  x,
  y,
  h,
  st,
  mapId,
  range,
  label,
  levels,
}: {
  x: number
  y: number
  h: number
  st: PlotStyle
  mapId: string
  range: [number, number]
  label?: string
  levels?: number
}) {
  const map = colorMapById(mapId)
  const w = st.tick * 1.1
  const steps = levels && levels > 1 ? levels : 48
  const [lo, hi] = range
  const ticks = 5
  return (
    <g>
      {Array.from({ length: steps }, (_, i) => {
        const t = i / (steps - 1)
        return (
          <rect
            key={i}
            x={x}
            y={y + h - (h * (i + 1)) / steps}
            width={w}
            height={h / steps + 0.5}
            fill={sampleMap(map, t)}
          />
        )
      })}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke={st.paper ? st.c.ink : st.c.outline ?? st.c.ink}
        strokeWidth={st.paper ? 0.8 : 2}
      />
      {Array.from({ length: ticks }, (_, i) => {
        const t = i / (ticks - 1)
        const v = lo + (hi - lo) * t
        const ty = y + h - h * t
        return (
          <Fragment key={`t${i}`}>
            <line x1={x + w} y1={ty} x2={x + w + 3} y2={ty} stroke={st.c.ink} strokeWidth={st.axis * 0.6} />
            <TickLabel
              t={formatTick(v, {}, Math.abs(hi - lo) / 8 || 1)}
              x={x + w + 6}
              y={ty + st.tick * 0.35}
              anchor="start"
              size={st.tick}
              fill={st.c.muted}
              font={st.numeric}
            />
          </Fragment>
        )
      })}
      {label && (
        <text
          x={x - 4}
          y={y + h / 2}
          fontSize={st.axisLabel}
          fill={st.c.ink}
          fontFamily={st.font}
          textAnchor="middle"
          transform={`rotate(-90 ${x - 4} ${y + h / 2})`}
        >
          {label}
        </text>
      )}
    </g>
  )
}

/* ---------- the panel ---------- */

export default function Panel(props: PanelProps) {
  const { rp, rect, st, palette, clipId, onPick, selected, hideXTicks, hideYTicks } = props
  const flip = panelFlip(rp.spec)
  const hasBar = rp.series.some((s) => BAR_LIKE.has(s.mark))
  const needsBar = rp.series.some((s) => s.field && s.spec.colorMap !== undefined) || rp.series.some((s) => s.mark === 'heatmap')

  const layout = useMemo(
    () => measure(rp, st, flip, !!hideXTicks, !!hideYTicks, hasBar),
    [rp, st, flip, hideXTicks, hideYTicks, hasBar],
  )
  const barW = needsBar ? st.tick * 1.1 + st.tick * 3.4 : 0
  const m = { ...layout, r: layout.r + barW }

  const plot: Rect = {
    x: rect.x + m.l,
    y: rect.y + m.t,
    w: Math.max(10, rect.w - m.l - m.r),
    h: Math.max(10, rect.h - m.t - m.b),
  }

  if (isPiePanel(rp)) return <PiePanel {...props} plot={plot} rect={rect} />

  const specs = axisSpecs(rp, flip, hasBar)
  const axSpec: AxisSpec = {
    ...specs.axSpec,
    ...(props.shareX && !flip ? { min: props.shareX[0], max: props.shareX[1] } : null),
  }
  const aySpec: AxisSpec = {
    ...specs.aySpec,
    ...(props.shareY && !flip ? { min: props.shareY[0], max: props.shareY[1] } : null),
  }

  /* A flipped category axis reads downward: the first row of the table is the
     top bar, which is the order the table itself is in. A flipped *numeric*
     axis must not do that — it would make values grow downward — so the choice
     is made by what the axis is carrying, not by the flip alone. */
  const ax = buildAxis(
    axSpec,
    { values: rp.xValues, categories: rp.xCategories ?? undefined },
    flip ? (rp.xCategories ? plot.y : plot.y + plot.h) : plot.x,
    flip ? (rp.xCategories ? plot.y + plot.h : plot.y) : plot.x + plot.w,
  )
  const ay = buildAxis(
    aySpec,
    { values: rp.yValues },
    flip ? plot.x : plot.y + plot.h,
    flip ? plot.x + plot.w : plot.y,
  )
  const ay2 = rp.y2Values.length
    ? buildAxis(
        { pad: 0.05, ...(rp.spec.y2 ?? {}) },
        { values: rp.y2Values },
        flip ? plot.x : plot.y + plot.h,
        flip ? plot.x + plot.w : plot.y,
      )
    : null

  const p = makeProj(ax, ay, flip, plot)
  const p2 = ay2 ? makeProj(ax, ay2, flip, plot) : p

  // what actually runs across the page and up it, after the flip
  const horiz = flip ? ay : ax
  const vert = flip ? ax : ay
  const horizSpec = rp.spec.x
  const vertSpec = rp.spec.y
  /** a point from screen-space data coordinates — what an annotation uses */
  const apt = (hx: number, vy: number) => ({ x: horiz.px(hx), y: vert.px(vy) })
  const aProj: Proj = { ...p, ax: horiz, ay: vert, at: apt, flip: false }

  // side-by-side placement for the unstacked bar-likes
  const barSeries = rp.series.filter((s) => BAR_LIKE.has(s.mark) && !s.stack)
  const boxSeries = rp.series.filter((s) => s.mark === 'box' || s.mark === 'violin')
  const slotOf = (s: ResolvedSeries) => {
    if (BAR_LIKE.has(s.mark) && !s.stack) {
      const i = barSeries.indexOf(s)
      return { count: barSeries.length, index: Math.max(0, i) }
    }
    if (s.mark === 'box' || s.mark === 'violin') {
      const i = boxSeries.indexOf(s)
      return { count: boxSeries.length, index: Math.max(0, i) }
    }
    return undefined
  }

  const angle = horiz.spec.angle ?? (horiz.kind === 'category' ? autoAngle(horiz, st) : 0)
  const gridOn = (a: Axis, fallback: boolean) => a.spec.grid ?? fallback

  const fieldSeries = rp.series.find((s) => s.field && s.mark === 'heatmap')
  const fieldValues = fieldSeries?.field?.z.flat().filter((v): v is number => v !== null) ?? []

  return (
    <g>
      {rp.spec.title && (
        <text
          x={rect.x + m.l + plot.w / 2}
          y={rect.y + st.panelTitle * 1.25}
          textAnchor="middle"
          fontSize={st.panelTitle}
          fontWeight={st.bold === 400 ? 600 : 800}
          fill={st.c.ink}
          fontFamily={st.font}
        >
          {rp.spec.title}
        </text>
      )}

      {/* grid, under everything */}
      <g>
        {gridOn(vert, true) &&
          vert.ticks.map((t, i) => (
            <line key={`vg${i}`} x1={plot.x} y1={vert.px(t.v)} x2={plot.x + plot.w} y2={vert.px(t.v)} stroke={st.c.grid} strokeWidth={st.grid} />
          ))}
        {vert.spec.minorGrid &&
          vert.minor.map((v, i) => (
            <line key={`vm${i}`} x1={plot.x} y1={vert.px(v)} x2={plot.x + plot.w} y2={vert.px(v)} stroke={st.c.grid} strokeWidth={st.minorGrid} opacity={0.6} />
          ))}
        {gridOn(horiz, false) &&
          horiz.ticks.map((t, i) => (
            <line key={`hg${i}`} x1={horiz.px(t.v)} y1={plot.y} x2={horiz.px(t.v)} y2={plot.y + plot.h} stroke={st.c.grid} strokeWidth={st.grid} />
          ))}
        {horiz.spec.minorGrid &&
          horiz.minor.map((v, i) => (
            <line key={`hm${i}`} x1={horiz.px(v)} y1={plot.y} x2={horiz.px(v)} y2={plot.y + plot.h} stroke={st.c.grid} strokeWidth={st.minorGrid} opacity={0.6} />
          ))}
      </g>

      {/* the marks */}
      <g clipPath={`url(#${clipId})`}>
        {rp.series.map((s, i) => {
          const proj = s.axis === 'right' && ay2 ? p2 : p
          const mp: MarkProps = { s, p: proj, st, palette, slot: slotOf(s), onPick, selected }
          return <Fragment key={`${s.spec.id}:${s.name}:${i}`}>{renderMark(mp)}</Fragment>
        })}
        {rp.series.map((s, i) => (
          <TrendLine key={`tr${i}`} s={s} p={s.axis === 'right' && ay2 ? p2 : p} st={st} palette={palette} />
        ))}
        <Annotations list={rp.spec.annotations ?? []} p={aProj} st={st} plot={plot} />
      </g>

      {/* frame and ticks, over the marks so a bar never covers the axis */}
      <g>
        {rp.spec.frame ? (
          <rect
            x={plot.x}
            y={plot.y}
            width={plot.w}
            height={plot.h}
            fill="none"
            stroke={st.c.ink}
            strokeWidth={st.axis}
          />
        ) : (
          <>
            {(vertSpec?.line ?? true) && (
              <line x1={plot.x} y1={plot.y} x2={plot.x} y2={plot.y + plot.h} stroke={st.c.ink} strokeWidth={st.axis} />
            )}
            {(horizSpec?.line ?? true) && (
              <line x1={plot.x} y1={plot.y + plot.h} x2={plot.x + plot.w} y2={plot.y + plot.h} stroke={st.c.ink} strokeWidth={st.axis} />
            )}
          </>
        )}

        {!hideYTicks &&
          vert.ticks.map((t, i) => {
            const q = { y: vert.px(t.v) }
            return (
              <Fragment key={`vt${i}`}>
                <line x1={plot.x - st.tickLen} y1={q.y} x2={plot.x} y2={q.y} stroke={st.c.ink} strokeWidth={st.axis * 0.8} />
                <TickLabel
                  t={t}
                  x={plot.x - st.tickLen - 4}
                  y={q.y + st.tick * 0.35}
                  anchor="end"
                  size={st.tick}
                  fill={st.c.muted}
                  font={vert.kind === 'category' ? st.font : st.numeric}
                />
              </Fragment>
            )
          })}

        {!hideXTicks &&
          horiz.ticks.map((t, i) => {
            const q = { x: horiz.px(t.v) }
            const ty = plot.y + plot.h + st.tickLen + st.tick
            return (
              <Fragment key={`ht${i}`}>
                <line x1={q.x} y1={plot.y + plot.h} x2={q.x} y2={plot.y + plot.h + st.tickLen} stroke={st.c.ink} strokeWidth={st.axis * 0.8} />
                <TickLabel
                  t={t}
                  x={q.x}
                  y={angle ? ty - st.tick * 0.2 : ty}
                  anchor={angle ? 'end' : 'middle'}
                  size={st.tick}
                  fill={st.c.muted}
                  font={horiz.kind === 'category' ? st.font : st.numeric}
                  angle={angle}
                />
              </Fragment>
            )
          })}

        {ay2 &&
          ay2.ticks.map((t, i) => {
            const q = { y: ay2.px(t.v) }
            const px = plot.x + plot.w
            return (
              <Fragment key={`y2${i}`}>
                <line x1={px} y1={q.y} x2={px + st.tickLen} y2={q.y} stroke={st.c.ink} strokeWidth={st.axis * 0.8} />
                <TickLabel
                  t={t}
                  x={px + st.tickLen + 4}
                  y={q.y + st.tick * 0.35}
                  anchor="start"
                  size={st.tick}
                  fill={st.c.muted}
                  font={st.numeric}
                />
              </Fragment>
            )
          })}
        {ay2 && (
          <line x1={plot.x + plot.w} y1={plot.y} x2={plot.x + plot.w} y2={plot.y + plot.h} stroke={st.c.ink} strokeWidth={st.axis} />
        )}
      </g>

      {/* axis titles */}
      {vertSpec?.label && (
        <text
          x={rect.x + st.axisLabel * 1.05}
          y={plot.y + plot.h / 2}
          textAnchor="middle"
          fontSize={st.axisLabel}
          fill={st.c.ink}
          fontFamily={st.font}
          fontWeight={st.bold === 400 ? 400 : 700}
          transform={`rotate(-90 ${rect.x + st.axisLabel * 1.05} ${plot.y + plot.h / 2})`}
        >
          {vertSpec.label}
        </text>
      )}
      {horizSpec?.label && (
        <text
          x={plot.x + plot.w / 2}
          y={rect.y + rect.h - st.axisLabel * 0.25}
          textAnchor="middle"
          fontSize={st.axisLabel}
          fill={st.c.ink}
          fontFamily={st.font}
          fontWeight={st.bold === 400 ? 400 : 700}
        >
          {horizSpec.label}
        </text>
      )}
      {ay2 && rp.spec.y2?.label && (
        <text
          x={rect.x + rect.w - st.axisLabel * 0.4 - barW}
          y={plot.y + plot.h / 2}
          textAnchor="middle"
          fontSize={st.axisLabel}
          fill={st.c.ink}
          fontFamily={st.font}
          transform={`rotate(90 ${rect.x + rect.w - st.axisLabel * 0.4 - barW} ${plot.y + plot.h / 2})`}
        >
          {rp.spec.y2.label}
        </text>
      )}

      {needsBar && fieldValues.length > 0 && (
        <ColorBar
          x={plot.x + plot.w + layout.r - st.tick * 0.4}
          y={plot.y}
          h={plot.h}
          st={st}
          mapId={fieldSeries?.spec.colorMap ?? 'viridis'}
          range={[
            fieldSeries?.spec.vmin ?? Math.min(...fieldValues),
            fieldSeries?.spec.vmax ?? Math.max(...fieldValues),
          ]}
          levels={fieldSeries?.spec.levels}
        />
      )}

      <Legend rp={rp} plot={plot} st={st} palette={palette} />
    </g>
  )
}

function renderMark(mp: MarkProps) {
  switch (mp.s.mark) {
    case 'bar':
    case 'histogram':
      return <BarMark {...mp} />
    case 'area':
      return <AreaMark {...mp} />
    case 'step':
    case 'line':
      return <LineMark {...mp} />
    case 'stem':
      return <StemMark {...mp} />
    case 'scatter':
      return <ScatterMark {...mp} />
    case 'box':
    case 'violin':
      return <BoxMark {...mp} />
    case 'heatmap':
      return <HeatMark {...mp} />
    case 'contour':
      return <ContourMark {...mp} />
    case 'quiver':
      return <QuiverMark {...mp} />
    default:
      return null
  }
}

/** A pie panel has no axes to lay out — the circle takes the room and the
 *  legend names the slices. */
function PiePanel({
  rp,
  rect,
  st,
  palette,
  onPick,
  selected,
}: PanelProps & { plot: Rect }) {
  const legendPos = rp.spec.legend?.pos ?? 'right'
  const entries = legendEntries(rp)
  const legendW =
    legendPos === 'none'
      ? 0
      : legendPos === 'right'
        ? Math.max(...entries.map((e) => textWidth(e.name, st.legend)), 0) + st.legend * 3.6
        : 0
  const top = rp.spec.title ? st.panelTitle * 1.9 : 0
  const area: Rect = { x: rect.x, y: rect.y + top, w: rect.w - legendW, h: rect.h - top }
  const r = Math.max(8, Math.min(area.w, area.h) / 2 - st.dataLabel)
  const cx = area.x + area.w / 2
  const cy = area.y + area.h / 2
  const plot: Rect = { x: area.x, y: area.y, w: area.w, h: area.h }
  return (
    <g>
      {rp.spec.title && (
        <text
          x={rect.x + rect.w / 2}
          y={rect.y + st.panelTitle * 1.25}
          textAnchor="middle"
          fontSize={st.panelTitle}
          fontWeight={st.bold === 400 ? 600 : 800}
          fill={st.c.ink}
          fontFamily={st.font}
        >
          {rp.spec.title}
        </text>
      )}
      {rp.series.map((s, i) => (
        <PieMark
          key={i}
          s={s}
          st={st}
          cx={cx}
          cy={cy}
          r={r}
          palette={palette}
          onPick={onPick}
          selected={selected}
        />
      ))}
      <Legend rp={rp} plot={plot} st={st} palette={palette} />
    </g>
  )
}

export type { Rect }
