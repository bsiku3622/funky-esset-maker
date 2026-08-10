/* Figure tokens for the two render modes.
 *
 * These live in cores/ rather than tools/ because the render cores need them
 * too — Chart is imported by other apps, and a chart that can only draw the
 * neon look is half a component. Nothing here knows about the app's theme
 * context; the mode arrives as a plain argument.
 *
 * ⚠️ The font stacks are concrete on purpose. The SVG tools used to write
 * fontFamily="var(--mono)" into their <text>, which is fine on screen and
 * silently wrong in an exported file: a standalone SVG has no :root to read
 * the variable from, so every label fell back to the browser's default serif.
 * Nothing may reintroduce a CSS variable into SVG markup that gets exported. */

export type FigureTheme = 'funky' | 'paper'

/** Elements carrying this attribute are editor chrome (selection rings, hit
 *  targets, handles) and are dropped from an exported file. */
export const UI_ONLY = 'data-ui'

/* ---------- fonts ---------- */

export const FONT = {
  /** Times-alike — matches LaTeX body text in most conference styles */
  serif:
    '"Times New Roman", "Nimbus Roman", "Liberation Serif", Tinos, Times, serif',
  /** Helvetica-alike — matches matplotlib and Illustrator defaults */
  sans: 'Helvetica, "Helvetica Neue", Arial, "Liberation Sans", Arimo, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  /** the app's own body stack, for figures that should look like the app */
  funky: 'Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif',
} as const

/* ---------- series colours ---------- */

/** Okabe–Ito. Recommended by Nature Methods; the eight hues stay distinct under
 *  deuteranopia, protanopia and tritanopia, which a neon palette does not. */
export const PAPER_SERIES = [
  '#0072B2',
  '#D55E00',
  '#009E73',
  '#CC79A7',
  '#E69F00',
  '#56B4E9',
  '#8C8C8C',
  '#000000',
]

/* ---------- resolved colours ---------- */

export interface FigColors {
  /** axes, frames, primary text */
  ink: string
  /** tick labels and other secondary text */
  muted: string
  /** grid lines */
  grid: string
  /** what shows through an open marker */
  hole: string
  /** categorical series, in assignment order */
  series: string[]
  /** outline around a filled shape, or null for none (paper draws none) */
  outline: string | null
  /** label typeface */
  text: string
  /** numeric typeface (tick labels, coordinates) */
  numeric: string
  /** weight for emphasised labels — paper never bolds a data label */
  bold: number
}

/**
 * @param theme        which look to paint
 * @param dark         the tool's dark background is selected
 * @param funkySeries  the tool's own neon palette, used only in funky mode
 */
export function figColors(
  theme: FigureTheme,
  dark: boolean,
  funkySeries: string[],
): FigColors {
  if (theme === 'paper')
    return {
      ink: dark ? '#f2f2f2' : '#000000',
      muted: dark ? '#c8c8c8' : '#3a3a3a',
      grid: dark ? 'rgba(255,255,255,0.16)' : '#dcdcdc',
      hole: dark ? '#1e1e22' : '#ffffff',
      series: PAPER_SERIES,
      outline: null,
      text: FONT.serif,
      numeric: FONT.sans,
      bold: 400,
    }
  return {
    ink: dark ? '#f4f4f4' : '#222222',
    muted: dark ? '#cfcfd6' : '#555555',
    grid: dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)',
    hole: dark ? '#1e1e22' : '#ffffff',
    series: funkySeries,
    outline: dark ? '#f4f4f4' : '#222222',
    text: FONT.funky,
    numeric: FONT.mono,
    bold: 700,
  }
}
