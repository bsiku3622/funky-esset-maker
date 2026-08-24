/* Esset render cores — display-only components meant to be imported by other
   apps (e.g. Funky Slide). Each is the pure visual half of an Esset Maker tool,
   with the toolbar / export / fit machinery stripped out. */

export { default as CodeBlock } from './CodeBlock'
export type { CodeBlockProps, CodeTheme } from './CodeBlock'

export { default as Diagram } from './Diagram'
export type {
  DiagramProps,
  DiagramNode,
  DiagramEdge,
  DiagramColor,
} from './Diagram'

export { CHART_PALETTE } from './palette'

export { FONT, PAPER_SERIES, UI_ONLY, figColors } from './figure'
export type { FigColors, FigureTheme } from './figure'

export { default as Chart } from './Chart'
export type {
  ChartProps,
  ChartType,
  ChartDatum,
  ChartPoint,
  ChartBg,
} from './Chart'

export { default as Plot } from './plot/Plot'
export type { PlotProps, PlotBg, PlotPick } from './plot/Plot'
export type {
  PlotSpec,
  PanelSpec,
  SeriesSpec,
  AnnotationSpec,
  LegendSpec,
  MarkKind,
  MarkerKind,
  DashKind,
  CoordKind,
} from './plot/spec'
export { MARK_LABELS, emptyPanel, newId } from './plot/spec'
export type { AxisSpec, ScaleKind, TickFormat } from './plot/scale'
export { parseTable, tableToText } from './plot/data'
export type { DataTable, Column } from './plot/data'
export {
  PALETTES,
  COLOR_MAPS,
  paletteById,
  colorMapById,
  sampleMap,
  inkOn,
} from './palette'
export type { NamedPalette, ColorMap } from './palette'
