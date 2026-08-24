/* From a spec and a table to something a renderer can draw.
 *
 * The split matters: everything that needs to *think* about the data happens
 * here — grouping, stacking, binning, gridding, working out what the axes have
 * to span — and the renderers below only turn numbers into paths. That is why
 * a bar chart's stacking can be tested without a DOM, and why the SVG and any
 * future canvas path cannot disagree about where a bar starts.
 *
 * ⚠️ Series colours are assigned by *name*, figure-wide, not by index within a
 * panel. Three subplots comparing the same five models must give each model the
 * same colour in all three, and per-panel indexing silently breaks that as soon
 * as one panel omits a series. */

import { boxStats, histogram, kde, polyFit, toDensity, type BoxStats, type Fit } from './stats'
import {
  CATEGORICAL_MARKS,
  COORD_OF,
  type CoordKind,
  type MarkKind,
  type PanelSpec,
  type PlotSpec,
  type SeriesSpec,
} from './spec'
import { categories as columnCategories, columnIndex, numberColumn, textColumn, type DataTable } from './data'

export interface Datum {
  x: number
  y: number
  /** the base a stacked or band value is measured from */
  y0?: number
  /** bin edges, for marks whose x has width */
  x0?: number
  x1?: number
  /** third variable carried by colour */
  v?: number
  /** third variable carried by area */
  s?: number
  /** vector components */
  u?: number
  w?: number
  /** absolute error-bar ends, already added to y */
  e0?: number
  e1?: number
  label?: string
  /** source row, so a click on the mark can find the line that made it */
  row: number
}

export interface BoxSlot {
  x: number
  label: string
  stats: BoxStats
  density?: { v: number; d: number }[]
}

export interface GridField {
  xs: number[]
  ys: number[]
  /** z[yi][xi], null where the table had no cell */
  z: (number | null)[][]
}

export interface ResolvedSeries {
  spec: SeriesSpec
  mark: MarkKind
  name: string
  color: string
  data: Datum[]
  boxes?: BoxSlot[]
  field?: GridField
  fit?: Fit
  stack: string | null
  axis: 'left' | 'right'
}

export interface ResolvedPanel {
  spec: PanelSpec
  coord: CoordKind
  series: ResolvedSeries[]
  /** non-null when the x axis is a list of names rather than numbers */
  xCategories: string[] | null
  xValues: number[]
  yValues: number[]
  y2Values: number[]
  /** span of the value-mapped marks, for a shared colour bar */
  vRange: [number, number] | null
}

export interface ResolvedFigure {
  panels: ResolvedPanel[]
  /** legend entries in figure order, deduplicated by name */
  legend: { name: string; color: string; mark: MarkKind; spec: SeriesSpec }[]
}

const num = (t: DataTable, name: string | undefined) => numberColumn(t, name)

/** Row indices, used when a series names no x column at all. */
const indices = (n: number) => Array.from({ length: n }, (_, i) => i)

/* ---------- group expansion ---------- */

interface Binding {
  spec: SeriesSpec
  name: string
  /** the rows this binding covers */
  rows: number[]
}

/** One spec becomes several when it names a `group` column — the long-form
 *  shape every statistics package produces, where one column says which series
 *  a row belongs to. */
function expand(table: DataTable, spec: SeriesSpec): Binding[] {
  const base = spec.name || spec.y || spec.value || spec.x || '계열'
  const all = indices(table.rows.length)
  if (!spec.group || columnIndex(table, spec.group) < 0)
    return [{ spec, name: base, rows: all }]
  const labels = textColumn(table, spec.group)
  const groups = columnCategories(table, spec.group)
  return groups.map((g) => ({
    spec,
    name: g,
    rows: all.filter((i) => labels[i] === g),
  }))
}

/* ---------- per-mark extraction ---------- */

function xyData(
  table: DataTable,
  b: Binding,
  catIndex: Map<string, number> | null,
): Datum[] {
  const { spec, rows } = b
  const ys = num(table, spec.y)
  const xNumeric = spec.x ? table.columns[columnIndex(table, spec.x)]?.numeric : undefined
  const xs = spec.x && xNumeric ? num(table, spec.x) : null
  const xLabels = spec.x && !xNumeric ? textColumn(table, spec.x) : null
  const y2 = spec.y2 ? num(table, spec.y2) : null
  const vs = spec.value ? num(table, spec.value) : null
  const ss = spec.size ? num(table, spec.size) : null
  const us = spec.u ? num(table, spec.u) : null
  const ws = spec.v ? num(table, spec.v) : null
  const names = spec.text ? textColumn(table, spec.text) : null
  const err = spec.err ? num(table, spec.err) : null
  const eLo = spec.errLow ? num(table, spec.errLow) : null
  const eHi = spec.errHigh ? num(table, spec.errHigh) : null

  const out: Datum[] = []
  rows.forEach((row, k) => {
    const y = ys.length ? ys[row] : row
    let x: number
    let label: string | undefined
    if (catIndex) {
      label = xLabels ? xLabels[row] : String(row + 1)
      const at = catIndex.get(label ?? '')
      if (at === undefined) return
      x = at
    } else if (xs) x = xs[row]
    else if (xLabels) {
      label = xLabels[row]
      x = k
    } else x = k
    if (!Number.isFinite(x)) return
    const d: Datum = { x, y, row, label: names ? names[row] : label }
    if (y2) d.y0 = y2[row]
    if (vs) d.v = vs[row]
    if (ss) d.s = ss[row]
    if (us) d.u = us[row]
    if (ws) d.w = ws[row]
    if (err) {
      d.e0 = y - Math.abs(err[row])
      d.e1 = y + Math.abs(err[row])
    }
    if (eLo) d.e0 = y - Math.abs(eLo[row])
    if (eHi) d.e1 = y + Math.abs(eHi[row])
    out.push(d)
  })
  // a line has to be drawn in x order or it doubles back over itself
  if (!catIndex && (spec.mark === 'line' || spec.mark === 'area' || spec.mark === 'step'))
    out.sort((p, q) => p.x - q.x)
  return out
}

function histogramData(table: DataTable, b: Binding): Datum[] {
  const vals = b.rows.map((r) => num(table, b.spec.y ?? b.spec.x)[r])
  let bins = histogram(vals, b.spec.bins)
  if (b.spec.density) bins = toDensity(bins)
  return bins.map((bin, i) => ({
    x: (bin.x0 + bin.x1) / 2,
    x0: bin.x0,
    x1: bin.x1,
    y: bin.count,
    y0: 0,
    row: i,
  }))
}

function boxData(
  table: DataTable,
  b: Binding,
  catIndex: Map<string, number> | null,
  wantDensity: boolean,
): BoxSlot[] {
  const ys = num(table, b.spec.y)
  if (!catIndex || !b.spec.x) {
    const vals = b.rows.map((r) => ys[r])
    return [
      {
        x: 0,
        label: b.name,
        stats: boxStats(vals),
        density: wantDensity ? kde(vals) : undefined,
      },
    ]
  }
  const labels = textColumn(table, b.spec.x)
  const byCat = new Map<string, number[]>()
  for (const r of b.rows) {
    const key = labels[r] || String(r + 1)
    ;(byCat.get(key) ?? byCat.set(key, []).get(key)!).push(ys[r])
  }
  return [...byCat.entries()].map(([label, vals]) => ({
    x: catIndex.get(label) ?? 0,
    label,
    stats: boxStats(vals),
    density: wantDensity ? kde(vals) : undefined,
  }))
}

/** Long-form (x, y, value) rows become the rectangular grid a heatmap, a
 *  contour or a surface needs. Missing cells stay null rather than zero —
 *  zero is a measurement, absence is not. */
function gridData(table: DataTable, b: Binding): GridField {
  const { spec, rows } = b
  const xNum = spec.x ? table.columns[columnIndex(table, spec.x)]?.numeric : true
  const yNum = spec.y ? table.columns[columnIndex(table, spec.y)]?.numeric : true
  const xr = xNum ? num(table, spec.x) : textColumn(table, spec.x).map((_, i) => i)
  const yr = yNum ? num(table, spec.y) : textColumn(table, spec.y).map((_, i) => i)
  const xLab = xNum ? null : textColumn(table, spec.x)
  const yLab = yNum ? null : textColumn(table, spec.y)
  const vs = num(table, spec.value ?? spec.y2)

  const xKeys: number[] = []
  const yKeys: number[] = []
  const seenX = new Map<string, number>()
  const seenY = new Map<string, number>()
  for (const r of rows) {
    const kx = xLab ? xLab[r] : String(xr[r])
    const ky = yLab ? yLab[r] : String(yr[r])
    if (!seenX.has(kx)) {
      seenX.set(kx, xKeys.length)
      xKeys.push(xLab ? seenX.size - 1 : xr[r])
    }
    if (!seenY.has(ky)) {
      seenY.set(ky, yKeys.length)
      yKeys.push(yLab ? seenY.size - 1 : yr[r])
    }
  }
  const order = (keys: number[]) => keys.map((v, i) => ({ v, i })).sort((a, c) => a.v - c.v)
  const xo = order(xKeys)
  const yo = order(yKeys)
  const xPos = new Map(xo.map((e, i) => [e.i, i]))
  const yPos = new Map(yo.map((e, i) => [e.i, i]))

  const z: (number | null)[][] = yo.map(() => xo.map(() => null))
  for (const r of rows) {
    const kx = xLab ? xLab[r] : String(xr[r])
    const ky = yLab ? yLab[r] : String(yr[r])
    const xi = xPos.get(seenX.get(kx)!)
    const yi = yPos.get(seenY.get(ky)!)
    if (xi === undefined || yi === undefined) continue
    z[yi][xi] = Number.isFinite(vs[r]) ? vs[r] : null
  }
  return { xs: xo.map((e) => e.v), ys: yo.map((e) => e.v), z }
}

/* ---------- stacking ---------- */

/** Pile series that share a stack id. Positive and negative values stack away
 *  from zero separately, so a series that dips below the axis does not eat the
 *  bar above it. */
function applyStacks(series: ResolvedSeries[]): void {
  const groups = new Map<string, ResolvedSeries[]>()
  for (const s of series) {
    if (!s.stack) continue
    ;(groups.get(s.stack) ?? groups.set(s.stack, []).get(s.stack)!).push(s)
  }
  for (const members of groups.values()) {
    const up = new Map<number, number>()
    const down = new Map<number, number>()
    for (const s of members)
      for (const d of s.data) {
        if (!Number.isFinite(d.y)) continue
        const bank = d.y >= 0 ? up : down
        const base = bank.get(d.x) ?? 0
        d.y0 = base
        const top = base + d.y
        // the drawn value is the top of the pile, with y0 as its floor
        d.y = top
        bank.set(d.x, top)
        if (d.e0 !== undefined) d.e0 += base
        if (d.e1 !== undefined) d.e1 += base
      }
  }
}

/* ---------- panel ---------- */

const markCoord = (m: MarkKind): CoordKind => COORD_OF[m] ?? 'cartesian'

/* Which names, if any, the x axis is a list of.
 *
 * ⚠️ A numeric x column is a *position*, never a category — a wind rose bins
 * degrees, a bar chart at x = 3 stands at three. Treating those numbers as
 * category names turns a compass into a list labelled 1…16 and silently
 * discards the spacing between them.
 *
 * Only a text column makes categories. A categorical mark with no x column at
 * all falls back to row numbers, because a bar per row still needs a slot to
 * stand in. */
function panelCategories(table: DataTable, panel: PanelSpec): string[] | null {
  const cat = panel.series.filter((s) => !s.hidden && CATEGORICAL_MARKS.has(s.mark))
  if (!cat.length) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of cat) {
    const idx = columnIndex(table, s.x)
    if (idx >= 0 && table.columns[idx].numeric) continue
    const labels =
      idx >= 0 ? textColumn(table, s.x) : table.rows.map((_, i) => String(i + 1))
    for (const l of labels) {
      const key = l || '—'
      if (seen.has(key)) continue
      seen.add(key)
      out.push(key)
    }
  }
  return out.length ? out : null
}

export function resolvePanel(
  table: DataTable,
  panel: PanelSpec,
  colorOf: (name: string, spec: SeriesSpec) => string,
): ResolvedPanel {
  const coord = panel.coord ?? markCoord(panel.series.find((s) => !s.hidden)?.mark ?? 'line')
  const cats = coord === 'cartesian' || coord === 'polar' ? panelCategories(table, panel) : null
  const catIndex = cats ? new Map(cats.map((c, i) => [c, i])) : null

  const series: ResolvedSeries[] = []
  for (const spec of panel.series) {
    if (spec.hidden) continue
    for (const b of expand(table, spec)) {
      const color = spec.color ?? colorOf(b.name, spec)
      const common = {
        spec,
        mark: spec.mark,
        name: b.name,
        color,
        stack: spec.stack ?? null,
        axis: spec.axis ?? ('left' as const),
      }
      if (spec.mark === 'histogram') {
        series.push({ ...common, data: histogramData(table, b) })
      } else if (spec.mark === 'box' || spec.mark === 'violin') {
        const boxes = boxData(table, b, catIndex, spec.mark === 'violin')
        series.push({ ...common, data: [], boxes })
      } else if (spec.mark === 'heatmap' || spec.mark === 'contour' || spec.mark === 'surface') {
        series.push({ ...common, data: [], field: gridData(table, b) })
      } else {
        const data = xyData(table, b, CATEGORICAL_MARKS.has(spec.mark) ? catIndex : null)
        const s: ResolvedSeries = { ...common, data }
        if (spec.trend && spec.trend !== 'none' && spec.trend !== 'mean') {
          const deg = spec.trend === 'poly3' ? 3 : spec.trend === 'poly2' ? 2 : 1
          s.fit = polyFit(data.map((d) => d.x), data.map((d) => d.y), deg) ?? undefined
        }
        series.push(s)
      }
    }
  }
  applyStacks(series)

  const pick = (side: 'left' | 'right') => series.filter((s) => s.axis === side)
  const yOf = (list: ResolvedSeries[]) => {
    const out: number[] = []
    for (const s of list) {
      for (const d of s.data) {
        out.push(d.y)
        if (d.y0 !== undefined) out.push(d.y0)
        if (d.e0 !== undefined) out.push(d.e0)
        if (d.e1 !== undefined) out.push(d.e1)
      }
      for (const b of s.boxes ?? []) {
        out.push(b.stats.min, b.stats.max, ...b.stats.outliers)
      }
      if (s.field) for (const row of s.field.z) for (const v of row) if (v !== null) out.push(v)
    }
    return out.filter((v) => Number.isFinite(v))
  }

  const xValues: number[] = []
  for (const s of series) {
    for (const d of s.data) {
      xValues.push(d.x)
      if (d.x0 !== undefined) xValues.push(d.x0)
      if (d.x1 !== undefined) xValues.push(d.x1)
    }
    for (const b of s.boxes ?? []) xValues.push(b.x)
    if (s.field && (s.mark === 'heatmap' || s.mark === 'contour')) xValues.push(...s.field.xs)
  }

  // a heatmap's y is the grid's own rows, not the value column
  const fieldY: number[] = []
  for (const s of series)
    if (s.field && (s.mark === 'heatmap' || s.mark === 'contour')) fieldY.push(...s.field.ys)

  const vs: number[] = []
  for (const s of series) {
    for (const d of s.data) if (d.v !== undefined && Number.isFinite(d.v)) vs.push(d.v)
    if (s.field) for (const row of s.field.z) for (const v of row) if (v !== null) vs.push(v)
  }

  return {
    spec: panel,
    coord,
    series,
    xCategories: cats,
    xValues: xValues.filter((v) => Number.isFinite(v)),
    yValues: fieldY.length ? fieldY : yOf(pick('left')),
    y2Values: yOf(pick('right')),
    vRange: vs.length ? [Math.min(...vs), Math.max(...vs)] : null,
  }
}

/* ---------- figure ---------- */

export function resolveFigure(
  table: DataTable,
  spec: PlotSpec,
  palette: string[],
): ResolvedFigure {
  /* Colour is keyed on the legend name so the same series keeps its colour in
     every panel, and so hiding one series does not recolour the rest. */
  const slot = new Map<string, number>()
  const colorOf = (name: string): string => {
    if (!slot.has(name)) slot.set(name, slot.size)
    return palette[slot.get(name)! % palette.length]
  }

  const panels = spec.panels.map((p) => resolvePanel(table, p, colorOf))

  const legend: ResolvedFigure['legend'] = []
  const seen = new Set<string>()
  for (const p of panels)
    for (const s of p.series) {
      if (seen.has(s.name)) continue
      seen.add(s.name)
      legend.push({ name: s.name, color: s.color, mark: s.mark, spec: s.spec })
    }
  return { panels, legend }
}
