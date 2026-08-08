/* Shared color constants for the render cores.
 *
 * Kept out of the component files so importing a palette does not pull a
 * component in — and so Fast Refresh keeps working (a module that exports both
 * a component and a constant loses its refresh boundary). */

/** Chart series colors, in order. A host (Chart Maker's toolbar) can show the
 *  same swatches the chart will actually use. */
export const CHART_PALETTE = [
  '#ff4eba',
  '#3decfd',
  '#ffd500',
  '#7828c8',
  '#ff9100',
  '#00c22a',
  '#00c8ff',
]

/* ---------- diagram node colors ---------- */

export type DiagramColor =
  | 'surface'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'yellow'
  | 'orange'
  | 'sky'
  | 'green'

/** Node fills — the funky tokens, mirrored here because the canvas export path
 *  needs literal hex and cannot read CSS variables. Shared with the Grapher
 *  editor so what you arrange there is what a rendered Diagram shows. */
export const DIAGRAM_COLOR_HEX: Record<DiagramColor, string> = {
  surface: '#ffffff',
  pink: '#ff4eba',
  purple: '#7828c8',
  cyan: '#3decfd',
  yellow: '#ffd500',
  orange: '#ff9100',
  sky: '#00c8ff',
  green: '#00c22a',
}

/** Readable ink for each fill above. */
export const DIAGRAM_TEXT_ON: Record<DiagramColor, string> = {
  surface: '#222222',
  pink: '#222222',
  purple: '#ffffff',
  cyan: '#222222',
  yellow: '#222222',
  orange: '#222222',
  sky: '#222222',
  green: '#222222',
}
