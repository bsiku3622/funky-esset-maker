/* How thick, how big, how bold — for the two looks the app draws in.
 *
 * The values mirror what each mode is imitating. Paper is a journal figure:
 * hairline spines, no outline around a fill, serif labels, nothing bolded.
 * Funky is a slide: 2px black outlines, heavy labels, colour that survives a
 * projector. Everything downstream reads these instead of writing its own
 * number, so a single figure never mixes the two. */

import { figColors, FONT, type FigColors, type FigureTheme } from '../figure'

export interface PlotStyle {
  c: FigColors
  paper: boolean
  /** spine and tick marks */
  axis: number
  grid: number
  minorGrid: number
  /** outline drawn around a filled mark, 0 in paper mode */
  outline: number
  line: number
  marker: number
  figTitle: number
  panelTitle: number
  axisLabel: number
  tick: number
  legend: number
  dataLabel: number
  /** length of a tick mark outside the spine */
  tickLen: number
  bold: number
  /** figure title weight */
  titleWeight: number
  font: string
  numeric: string
}

export function plotStyle(
  theme: FigureTheme,
  dark: boolean,
  series: string[],
  /** shrink for a dense grid of subplots */
  fontScale = 1,
): PlotStyle {
  const c: FigColors = figColors(theme, dark, series)
  const paper = theme === 'paper'
  const f = (n: number) => Math.max(6, Math.round(n * fontScale * 10) / 10)
  return paper
    ? {
        c,
        paper,
        axis: 0.9,
        grid: 0.6,
        minorGrid: 0.4,
        outline: 0,
        line: 1.6,
        marker: 0.9,
        figTitle: f(15),
        panelTitle: f(12),
        axisLabel: f(11),
        tick: f(9.5),
        legend: f(9.5),
        dataLabel: f(9),
        tickLen: 3.5,
        bold: 400,
        titleWeight: 600,
        font: c.text,
        numeric: FONT.sans,
      }
    : {
        c,
        paper,
        axis: 2,
        grid: 1,
        minorGrid: 0.7,
        outline: 2,
        line: 3,
        marker: 2,
        figTitle: f(20),
        panelTitle: f(15),
        axisLabel: f(13),
        tick: f(11.5),
        legend: f(12),
        dataLabel: f(12),
        tickLen: 5,
        bold: 700,
        titleWeight: 800,
        font: c.text,
        numeric: c.numeric,
      }
}

/** Fonts shrink once a figure is cut into more than a couple of panels — a
 *  13pt axis label in a 2×3 grid is bigger than the plot it labels. */
export const gridFontScale = (panels: number): number =>
  panels <= 1 ? 1 : panels <= 2 ? 0.92 : panels <= 4 ? 0.84 : panels <= 6 ? 0.76 : 0.7
