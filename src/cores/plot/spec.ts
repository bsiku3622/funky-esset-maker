/* The plot document.
 *
 * One figure holds a grid of panels; a panel holds a coordinate system, its
 * axes and a list of series; a series names the columns it reads. Nothing here
 * holds pixels or colours-by-index resolved — that happens at render time, so
 * changing the palette or the size never edits the document.
 *
 * ⚠️ Series bind to columns by *name*. See data.ts for why. The consequence
 * here is that a spec is meaningful on its own and can be saved, swapped onto
 * different data, or written by hand.
 *
 * Every field that can be left out is left out on purpose: the defaults below
 * are what a bare `{mark: 'line', y: '...'}` means, and a spec that only says
 * what is unusual about it stays readable in a saved file. */

import type { AxisSpec, TickFormat } from './scale'

export type MarkKind =
  /* xy */
  | 'line'
  | 'area'
  | 'bar'
  | 'scatter'
  | 'step'
  | 'stem'
  /* statistical */
  | 'histogram'
  | 'box'
  | 'violin'
  | 'pie'
  /* fields */
  | 'heatmap'
  | 'contour'
  | 'quiver'
  /* non-cartesian */
  | 'rose'
  | 'radar'
  | 'ternary'
  /* projected */
  | 'surface'
  | 'scatter3d'

export type MarkerKind =
  | 'none'
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'cross'
  | 'plus'
  | 'star'
  | 'hollow'

export type DashKind = 'solid' | 'dash' | 'dot' | 'dashdot' | 'longdash'

export type TrendKind = 'none' | 'linear' | 'poly2' | 'poly3' | 'mean'

export interface SeriesSpec {
  id: string
  mark: MarkKind
  /** legend text; falls back to the y column's name */
  name?: string

  /* ---- data binding, by column name ---- */
  x?: string
  y?: string
  /** the second value: a band's lower edge, a bar's base, a quiver's v */
  y2?: string
  /** a third variable carried by colour — heatmap cell, shaded scatter */
  value?: string
  /** a third variable carried by area — bubble scatter */
  size?: string
  /** names for the individual points — star names on an H–R diagram, sample
   *  ids on a ternary plot. Printed instead of the value when `labels` is on. */
  text?: string
  /** split one binding into one series per distinct value in this column */
  group?: string
  /** vector field components */
  u?: string
  v?: string
  /** symmetric error, or the two halves of an asymmetric one */
  err?: string
  errLow?: string
  errHigh?: string

  /* ---- style ---- */
  /** literal hex; without it the series takes its place in the palette */
  color?: string
  width?: number
  dash?: DashKind
  marker?: MarkerKind
  markerSize?: number
  opacity?: number
  fillOpacity?: number
  /** draw through the points as a spline rather than straight legs */
  smooth?: boolean
  /** series sharing a stack id pile up instead of overlapping */
  stack?: string | null
  /** which y axis this series is measured against */
  axis?: 'left' | 'right'
  /** print each value next to its mark */
  labels?: boolean
  labelFormat?: TickFormat
  labelDecimals?: number | null
  hidden?: boolean

  /* ---- per-mark ---- */
  /** histogram bin count; absent means Sturges' rule */
  bins?: number
  density?: boolean
  /** bar and box direction */
  orient?: 'v' | 'h'
  /** bar thickness as a fraction of its slot */
  barWidth?: number
  /** pie: hole radius as a fraction, making it a donut */
  hole?: number
  colorMap?: string
  /** heatmap/contour value range, for a shared colour bar */
  vmin?: number | null
  vmax?: number | null
  levels?: number
  trend?: TrendKind
  /** show the fitted equation and R² next to the trend line */
  trendLabel?: boolean
  /** step interpolation side */
  stepAt?: 'pre' | 'mid' | 'post'
}

export type LegendPos =
  | 'none'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top'
  | 'bottom'
  | 'right'

export interface LegendSpec {
  pos?: LegendPos
  /** draw the box behind it — matplotlib's frameon */
  frame?: boolean
  columns?: number
  title?: string
}

export type AnnotationKind = 'hline' | 'vline' | 'hband' | 'vband' | 'text' | 'arrow' | 'rect'

export interface AnnotationSpec {
  id: string
  kind: AnnotationKind
  /** in data units; a text annotation uses x/y as its anchor */
  x?: number
  y?: number
  x2?: number
  y2?: number
  text?: string
  color?: string
  dash?: DashKind
  width?: number
  opacity?: number
  fontSize?: number
  /** where the label sits along a rule */
  align?: 'start' | 'middle' | 'end'
}

export type CoordKind = 'cartesian' | 'polar' | 'ternary' | 'proj3d'

export interface PanelSpec {
  id: string
  title?: string
  coord?: CoordKind
  x?: AxisSpec
  y?: AxisSpec
  /** the right-hand axis — a climograph's temperature against its rainfall */
  y2?: AxisSpec
  series: SeriesSpec[]
  annotations?: AnnotationSpec[]
  legend?: LegendSpec
  /** draw the full box rather than only the left and bottom spines */
  frame?: boolean
  /* ---- polar ---- */
  /** degrees; 0 = east, which is the maths convention */
  polarStart?: number
  polarClockwise?: boolean
  /** number of angular sectors a rose bins into */
  sectors?: number
  /* ---- ternary ---- */
  ternaryLabels?: [string, string, string]
  /* ---- 3d ---- */
  elev?: number
  azim?: number
}

export interface PlotSpec {
  title?: string
  subtitle?: string
  width: number
  height: number
  /** id from cores/palette PALETTES */
  palette: string
  /** panels are laid out left to right, wrapping at this many columns */
  columns: number
  panels: PanelSpec[]
  /** every panel gets the same x (or y) domain — matplotlib's sharex */
  shareX?: boolean
  shareY?: boolean
  /** draw a colour bar for the value-mapped marks */
  colorBar?: boolean
  colorBarLabel?: string
  /** figure-wide caption under the plot */
  caption?: string
}

/* ---------- defaults ---------- */

export const DEFAULT_AXIS: Required<Pick<AxisSpec, 'scale' | 'grid' | 'line' | 'tickCount'>> = {
  scale: 'linear',
  grid: true,
  line: true,
  tickCount: 6,
}

export const DASH_ARRAY: Record<DashKind, string | undefined> = {
  solid: undefined,
  dash: '7 5',
  dot: '1.5 4',
  dashdot: '8 4 1.5 4',
  longdash: '14 6',
}

/** Marks that place one categorical slot per row rather than a numeric x. */
export const CATEGORICAL_MARKS: ReadonlySet<MarkKind> = new Set<MarkKind>([
  'bar',
  'box',
  'violin',
  'pie',
  'rose',
  'radar',
])

/** Marks that do not live on a normal pair of axes, and so cannot share a panel
 *  with one that does. */
export const COORD_OF: Partial<Record<MarkKind, CoordKind>> = {
  rose: 'polar',
  radar: 'polar',
  ternary: 'ternary',
  surface: 'proj3d',
  scatter3d: 'proj3d',
}

export const MARK_LABELS: Record<MarkKind, string> = {
  line: '선',
  area: '영역',
  bar: '막대',
  scatter: '산점도',
  step: '계단',
  stem: '스템',
  histogram: '히스토그램',
  box: '상자',
  violin: '바이올린',
  pie: '원',
  heatmap: '히트맵',
  contour: '등고선',
  quiver: '벡터장',
  rose: '로즈',
  radar: '레이더',
  ternary: '삼각도',
  surface: '3D 표면',
  scatter3d: '3D 산점도',
}

let seq = 0
export const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`

export const emptyPanel = (id = newId('p')): PanelSpec => ({
  id,
  coord: 'cartesian',
  x: { grid: false, line: true },
  y: { grid: true, line: true },
  series: [],
  annotations: [],
  legend: { pos: 'top-right', frame: true },
})
