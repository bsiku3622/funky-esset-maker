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
