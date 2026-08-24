/* Shared color constants for the render cores.
 *
 * Kept out of the component files so importing a palette does not pull a
 * component in — and so Fast Refresh keeps working (a module that exports both
 * a component and a constant loses its refresh boundary). */

import { PAPER_SERIES } from './figure'

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

/* ---------- named series palettes ---------- */

/* A chart's colours are an argument, not a taste. The neon set above reads from
 * the back of a lecture hall and dies on a printed page; Okabe–Ito survives
 * every kind of colour blindness and looks clinical on a slide. So the palette
 * is a choice the author makes per figure, and these are the ones worth
 * offering — each is a published set, not a hand-mixed one, because the whole
 * value of a categorical palette is that its hues were separated on purpose. */

export interface NamedPalette {
  id: string
  label: string
  colors: string[]
  /** one line on when to reach for it */
  note: string
}

export const PALETTES: NamedPalette[] = [
  {
    id: 'funky',
    label: 'Funky',
    colors: CHART_PALETTE,
    note: '슬라이드용 네온 — 멀리서도 읽힘',
  },
  {
    id: 'deep',
    label: 'Seaborn Deep',
    colors: [
      '#4C72B0',
      '#DD8452',
      '#55A868',
      '#C44E52',
      '#8172B3',
      '#937860',
      '#DA8BC3',
      '#8C8C8C',
      '#CCB974',
      '#64B5CD',
    ],
    note: '논문 그림의 기본값 — 차분한 중채도',
  },
  {
    id: 'muted',
    label: 'Seaborn Muted',
    colors: [
      '#4878D0',
      '#EE854A',
      '#6ACC64',
      '#D65F5F',
      '#956CB4',
      '#8C613C',
      '#DC7EC0',
      '#797979',
      '#D5BB67',
      '#82C6E2',
    ],
    note: 'Deep보다 한 단계 밝음 — 계열이 많을 때',
  },
  {
    id: 'colorblind',
    label: 'Seaborn Colorblind',
    colors: [
      '#0173B2',
      '#DE8F05',
      '#029E73',
      '#D55E00',
      '#CC78BC',
      '#CA9161',
      '#FBAFE4',
      '#949494',
      '#ECE133',
      '#56B4E9',
    ],
    note: '색각 이상에서도 구분됨',
  },
  {
    id: 'okabe',
    label: 'Okabe–Ito',
    colors: PAPER_SERIES,
    note: 'Nature Methods 권장 8색',
  },
  {
    id: 'tab10',
    label: 'Matplotlib tab10',
    colors: [
      '#1F77B4',
      '#FF7F0E',
      '#2CA02C',
      '#D62728',
      '#9467BD',
      '#8C564B',
      '#E377C2',
      '#7F7F7F',
      '#BCBD22',
      '#17BECF',
    ],
    note: 'matplotlib 기본값 — 가장 익숙한 배색',
  },
  {
    id: 'dark2',
    label: 'ColorBrewer Dark2',
    colors: [
      '#1B9E77',
      '#D95F02',
      '#7570B3',
      '#E7298A',
      '#66A61E',
      '#E6AB02',
      '#A6761D',
      '#666666',
    ],
    note: '흰 배경에서 대비가 가장 큼',
  },
  {
    id: 'set2',
    label: 'ColorBrewer Set2',
    colors: [
      '#66C2A5',
      '#FC8D62',
      '#8DA0CB',
      '#E78AC3',
      '#A6D854',
      '#FFD92F',
      '#E5C494',
      '#B3B3B3',
    ],
    note: '파스텔 — 면적이 넓은 막대·영역에',
  },
  {
    id: 'earth',
    label: 'Earth',
    colors: [
      '#2C6E8F',
      '#C97B3C',
      '#5B8C3E',
      '#8C4A3F',
      '#5E7D9A',
      '#B8A35C',
      '#7A5C8E',
      '#4F4A45',
    ],
    note: '지구과학용 — 바다·암석·식생 톤',
  },
]

export const paletteById = (id: string): NamedPalette =>
  PALETTES.find((p) => p.id === id) ?? PALETTES[0]

/* ---------- continuous colour maps ---------- */

/* For anything where colour carries a *number* rather than a category: a
 * heatmap cell, a contour band, the height of a 3-D surface, a scatter point
 * shaded by a third column.
 *
 * ⚠️ Sequential maps here are perceptually uniform (viridis and friends) or
 * explicitly documented as not. A rainbow map invents boundaries that are not
 * in the data — the eye reads a sharp edge where cyan meets green — which is
 * why matplotlib stopped defaulting to jet, and why there is no jet here.
 *
 * Anchors are sampled from the real maps at even steps. Interpolation between
 * them is plain sRGB, which is not what matplotlib does (it interpolates in a
 * uniform space), but with ten anchors the error is under a JND. */

export interface ColorMap {
  id: string
  label: string
  /** evenly spaced anchors from t=0 to t=1 */
  stops: string[]
  /** a map with a meaningful midpoint — the tool centres it on zero */
  diverging?: boolean
}

export const COLOR_MAPS: ColorMap[] = [
  {
    id: 'viridis',
    label: 'Viridis',
    stops: [
      '#440154',
      '#482878',
      '#3E4A89',
      '#31688E',
      '#26828E',
      '#1F9E89',
      '#35B779',
      '#6DCD59',
      '#B4DE2C',
      '#FDE725',
    ],
  },
  {
    id: 'plasma',
    label: 'Plasma',
    stops: [
      '#0D0887',
      '#46039F',
      '#7201A8',
      '#9C179E',
      '#BD3786',
      '#D8576B',
      '#ED7953',
      '#FB9F3A',
      '#FDCA26',
      '#F0F921',
    ],
  },
  {
    id: 'magma',
    label: 'Magma',
    stops: [
      '#000004',
      '#180F3D',
      '#440F76',
      '#721F81',
      '#9E2F7F',
      '#CD4071',
      '#F1605D',
      '#FD9668',
      '#FECA8D',
      '#FCFDBF',
    ],
  },
  {
    id: 'inferno',
    label: 'Inferno',
    stops: [
      '#000004',
      '#1B0C41',
      '#4A0C6B',
      '#781C6D',
      '#A52C60',
      '#CF4446',
      '#ED6925',
      '#FB9A06',
      '#F7D13D',
      '#FCFFA4',
    ],
  },
  {
    id: 'cividis',
    label: 'Cividis',
    stops: [
      '#00224E',
      '#123570',
      '#3B496C',
      '#575D6D',
      '#707173',
      '#8A8678',
      '#A59C74',
      '#C3B369',
      '#E1CC55',
      '#FEE838',
    ],
  },
  {
    id: 'blues',
    label: 'Blues',
    stops: ['#F7FBFF', '#DEEBF7', '#C6DBEF', '#9ECAE1', '#6BAED6', '#3182BD', '#08519C'],
  },
  {
    id: 'greys',
    label: 'Greys',
    stops: ['#FFFFFF', '#E0E0E0', '#BDBDBD', '#969696', '#636363', '#252525'],
  },
  {
    id: 'coolwarm',
    label: 'Coolwarm',
    diverging: true,
    stops: [
      '#3B4CC0',
      '#6788EE',
      '#9ABBFF',
      '#C9D7F0',
      '#EDD1C2',
      '#F7A889',
      '#E26952',
      '#B40426',
    ],
  },
  {
    id: 'rdbu',
    label: 'RdBu',
    diverging: true,
    stops: [
      '#B2182B',
      '#D6604D',
      '#F4A582',
      '#FDDBC7',
      '#F7F7F7',
      '#D1E5F0',
      '#92C5DE',
      '#4393C3',
      '#2166AC',
    ],
  },
  {
    id: 'brbg',
    label: 'BrBG',
    diverging: true,
    stops: [
      '#8C510A',
      '#BF812D',
      '#DFC27D',
      '#F6E8C3',
      '#F5F5F5',
      '#C7EAE5',
      '#80CDC1',
      '#35978F',
      '#01665E',
    ],
  },
  {
    /* Hypsometric tinting — the convention every physical atlas uses, so a
       reader already knows blue is below sea level and white is ice. */
    id: 'terrain',
    label: 'Terrain',
    stops: [
      '#08306B',
      '#2171B5',
      '#6BAED6',
      '#C6DBEF',
      '#C7E9C0',
      '#74C476',
      '#A1D99B',
      '#D9C27E',
      '#A6743C',
      '#8C6D46',
      '#FFFFFF',
    ],
  },
]

export const colorMapById = (id: string): ColorMap =>
  COLOR_MAPS.find((m) => m.id === id) ?? COLOR_MAPS[0]

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')

/** Sample a map at `t` in 0..1, clamped. Returns a literal hex — an exported
 *  SVG has no stylesheet, so nothing here may become a CSS variable. */
export function sampleMap(map: ColorMap, t: number): string {
  const stops = map.stops
  if (!Number.isFinite(t)) return stops[0]
  const u = Math.min(1, Math.max(0, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(u))
  const f = u - i
  const a = hexToRgb(stops[i])
  const b = hexToRgb(stops[i + 1])
  return `#${toHex(a[0] + (b[0] - a[0]) * f)}${toHex(a[1] + (b[1] - a[1]) * f)}${toHex(a[2] + (b[2] - a[2]) * f)}`
}

/** Black or white, whichever stays readable on `hex`. Used for a value printed
 *  inside a heatmap cell, where the fill is chosen by the data. */
export function inkOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex)
  // ITU-R BT.601 luma — close enough for a two-way decision
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111111' : '#ffffff'
}
