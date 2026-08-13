/* Palettes, journal canvas sizes, fonts and per-shape defaults.
 *
 * The palettes are the ones that actually recur in ML papers rather than a
 * generic swatch set: matplotlib's tab10 (what most plots already use), the
 * seaborn/Nature muted set, a grayscale + single-accent scheme, and two
 * colour-vision-deficiency-safe sets (Okabe-Ito, Paul Tol). Keeping a figure
 * inside one of these is most of what makes it look "published". */

import type {
  CanvasCfg,
  EdgeStyle,
  FigNode,
  FontKind,
  NodeKind,
  NodeProps,
  Style,
} from './types'
import { retypeLabel } from './latex'

/* ---------- units ---------- */

export const PX_PER_IN = 96
export const inPx = (v: number) => Math.round(v * PX_PER_IN)
export const mmPx = (v: number) => Math.round((v / 25.4) * PX_PER_IN)
export const cmPx = (v: number) => mmPx(v * 10)

/* ---------- palettes ---------- */

export interface Palette {
  id: string
  label: string
  note: string
  /** categorical series, in the order they should be assigned */
  colors: string[]
  /** default outline + text colour */
  ink: string
  /** default connector colour (usually a touch lighter than ink) */
  line: string
  /** neutral box fill */
  neutral: string
}

export const PALETTES: Palette[] = [
  {
    id: 'tab10',
    label: 'Matplotlib tab10',
    note: '가장 흔한 기본값 — 본문 plot과 색을 맞출 때',
    colors: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#7f7f7f'],
    ink: '#222222',
    line: '#4A4A4A',
    neutral: '#EDEDED',
  },
  {
    id: 'muted',
    label: 'Nature muted',
    note: '채도를 낮춘 학술 표준 — branch/trunk 구분에 권장',
    colors: ['#4C72B0', '#DD8452', '#55A868', '#C44E52', '#8172B3', '#8C8C8C'],
    ink: '#2B2B2B',
    line: '#4A4A4A',
    neutral: '#EAEAEA',
  },
  {
    id: 'grayaccent',
    label: 'Grayscale + 포인트',
    note: '가장 보수적 — 회색조 통일 + 강조 1색',
    colors: ['#2166AC', '#B2182B', '#4A4A4A', '#8C8C8C', '#BFBFBF', '#D9D9D9'],
    ink: '#4A4A4A',
    line: '#4A4A4A',
    neutral: '#D9D9D9',
  },
  {
    id: 'okabe',
    label: 'Okabe–Ito (CVD-safe)',
    note: 'Nature Methods 권장 — 색각 이상에서도 구분됨',
    colors: [
      '#0072B2',
      '#E69F00',
      '#009E73',
      '#D55E00',
      '#CC79A7',
      '#56B4E9',
      '#F0E442',
      '#000000',
    ],
    ink: '#1A1A1A',
    line: '#4A4A4A',
    neutral: '#E8E8E8',
  },
  {
    id: 'tol',
    label: 'Paul Tol bright',
    note: '대비가 강한 CVD-safe 대안',
    colors: [
      '#4477AA',
      '#EE6677',
      '#228833',
      '#CCBB44',
      '#66CCEE',
      '#AA3377',
      '#BBBBBB',
    ],
    ink: '#222222',
    line: '#4A4A4A',
    neutral: '#E9E9E9',
  },
]

export const paletteById = (id: string) =>
  PALETTES.find((p) => p.id === id) ?? PALETTES[1]

/* ---------- colour helpers ---------- */

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim()
  if (h.length === 3)
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  if (Number.isNaN(n)) return [0, 0, 0]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')}`

/** Mix `hex` toward white by t (0 = unchanged, 1 = white). Paper figures almost
 *  always use a pale fill under a saturated outline, so this is how fills are
 *  derived from a palette entry instead of shipping a second swatch list. */
export function tint(hex: string, t: number) {
  if (hex === 'none') return 'none'
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t)
}

/** Mix toward black — used for the shaded faces of a 3D tensor block. */
export function shade(hex: string, t: number) {
  if (hex === 'none') return 'none'
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r * (1 - t), g * (1 - t), b * (1 - t))
}

/** Perceptual luminance — picks black/white label text over a filled shape. */
export function readableOn(hex: string) {
  if (hex === 'none') return '#222222'
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return L > 0.45 ? '#222222' : '#ffffff'
}

/* ---------- colour with transparency ---------- */

/* A colour carries its own alpha, as an eight-digit hex.
 *
 * One string per slot is what keeps the document simple: adding a parallel
 * `fillOpacity` beside every `fill` would mean two fields to keep in step, on
 * every shape, every edge, every neuron. But an eight-digit hex is CSS Color 4,
 * which browsers take and some vector editors still do not — and this app's
 * whole point is an SVG that opens correctly in Illustrator and Inkscape. So it
 * is split at drawing time into a plain colour and a matching `*-opacity`,
 * which every SVG consumer has understood since 1.0.
 *
 * ⚠️ Fully opaque colours stay six digits. Files written before this exist in
 * their thousands and must read back identically. */
export interface Paint {
  color: string
  /** undefined when fully opaque — nothing is written to the attribute */
  opacity: number | undefined
}

const HEX8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/i

export function paint(v: string | undefined): Paint {
  if (!v) return { color: 'none', opacity: undefined }
  const m = HEX8.exec(v)
  if (!m) return { color: v, opacity: undefined }
  return { color: `#${m[1]}`, opacity: parseInt(m[2], 16) / 255 }
}

/** 0..1, where a colour that says nothing about it is opaque. */
export const alphaOf = (v: string | undefined) => paint(v).opacity ?? 1

/** Rewrite a colour's alpha, dropping back to six digits at full strength. */
export function withAlpha(v: string, a: number): string {
  const base = paint(v).color
  if (base === 'none') return 'none'
  const clamped = Math.max(0, Math.min(1, a))
  if (clamped >= 1) return base
  return base + Math.round(clamped * 255).toString(16).padStart(2, '0')
}

/* ---------- fonts ---------- */

export const FONT_STACK: Record<FontKind, string> = {
  // Times-alike: matches LaTeX body text in most conference styles
  serif:
    '"Times New Roman", "Nimbus Roman", "Liberation Serif", "Tinos", Times, serif',
  // Helvetica-alike: matches matplotlib/Illustrator defaults
  sans:
    'Helvetica, "Helvetica Neue", Arial, "Liberation Sans", "Arimo", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  /* LaTeX mode draws through MathJax, which brings its own glyphs — this stack
     is only what the fallback text is measured and painted in during the one
     frame before MathJax finishes loading. Times keeps that frame close. */
  latex:
    '"Times New Roman", "Nimbus Roman", "Liberation Serif", "Tinos", Times, serif',
}

export const FONT_LABEL: Record<FontKind, string> = {
  latex: 'LaTeX',
  sans: 'Sans (Helvetica)',
  serif: 'Times New Roman',
  mono: 'Mono',
}

/* ---------- dash patterns ---------- */

/** Scaled by stroke width so a dashed hairline still reads as dashed. */
export function dashArray(kind: string, sw: number): string | undefined {
  const u = Math.max(1, sw)
  switch (kind) {
    case 'dashed':
      return `${u * 4} ${u * 2.6}`
    case 'dotted':
      return `${u * 0.1} ${u * 2.2}`
    case 'dashdot':
      return `${u * 5} ${u * 2} ${u * 0.1} ${u * 2}`
    default:
      return undefined
  }
}

/* ---------- canvas presets ---------- */

export interface CanvasPreset {
  id: string
  group: string
  label: string
  /** printed width; the readout uses it to convert px → pt */
  widthIn: number
  w: number
  h: number
}

const P = (
  id: string,
  group: string,
  label: string,
  widthIn: number,
  hRatio = 0.62,
): CanvasPreset => ({
  id,
  group,
  label,
  widthIn,
  w: inPx(widthIn),
  h: Math.round(inPx(widthIn) * hRatio),
})

export const CANVAS_PRESETS: CanvasPreset[] = [
  // ML conferences
  P('neurips-col', 'ML 학회', 'NeurIPS / ICLR 본문 (5.5")', 5.5),
  P('icml-col', 'ML 학회', 'ICML 1단 (3.25")', 3.25, 0.8),
  P('icml-full', 'ML 학회', 'ICML 양단 (6.75")', 6.75, 0.42),
  P('cvpr-col', 'ML 학회', 'CVPR / ICCV 1단 (3.29")', 3.29, 0.8),
  P('cvpr-full', 'ML 학회', 'CVPR / ICCV 양단 (6.875")', 6.875, 0.42),
  P('acl-col', 'ML 학회', 'ACL / EMNLP 1단 (3.03")', 3.03, 0.82),
  P('acl-full', 'ML 학회', 'ACL / EMNLP 양단 (6.3")', 6.3, 0.44),
  P('aaai-col', 'ML 학회', 'AAAI 1단 (3.3")', 3.3, 0.8),
  // IEEE / general
  P('ieee-col', 'IEEE', 'IEEE 1단 (3.5")', 3.5, 0.78),
  P('ieee-full', 'IEEE', 'IEEE 양단 (7.16")', 7.16, 0.42),
  // journals
  {
    id: 'nature-1',
    group: '저널',
    label: 'Nature 1단 (89 mm)',
    widthIn: 89 / 25.4,
    w: mmPx(89),
    h: mmPx(70),
  },
  {
    id: 'nature-2',
    group: '저널',
    label: 'Nature 2단 (183 mm)',
    widthIn: 183 / 25.4,
    w: mmPx(183),
    h: mmPx(90),
  },
  {
    id: 'science-2',
    group: '저널',
    label: 'Science 2단 (114 mm)',
    widthIn: 114 / 25.4,
    w: mmPx(114),
    h: mmPx(80),
  },
  {
    id: 'elsevier-2',
    group: '저널',
    label: 'Elsevier 2단 (190 mm)',
    widthIn: 190 / 25.4,
    w: mmPx(190),
    h: mmPx(95),
  },
  {
    id: 'pnas-2',
    group: '저널',
    label: 'PNAS 2단 (114 mm)',
    widthIn: 114 / 25.4,
    w: mmPx(114),
    h: mmPx(78),
  },
  // presentation
  { id: 'slide-169', group: '발표', label: '슬라이드 16:9', widthIn: 13.33, w: 1280, h: 720 },
  { id: 'poster-a0', group: '발표', label: '포스터 패널 (400 mm)', widthIn: 400 / 25.4, w: mmPx(400), h: mmPx(260) },
  { id: 'free', group: '자유', label: '자유 크기', widthIn: 8, w: 900, h: 560 },
]

export const presetById = (id: string) =>
  CANVAS_PRESETS.find((p) => p.id === id) ?? CANVAS_PRESETS[0]

/* ---------- defaults ---------- */

export const DEFAULT_CANVAS: CanvasCfg = {
  ...(() => {
    const p = presetById('neurips-col')
    return { w: p.w, h: p.h, printWidthIn: p.widthIn, presetId: p.id }
  })(),
  bg: 'transparent',
  showGrid: true,
  grid: 8,
  snap: true,
  baseFont: 13,
}

export function baseStyle(p: Palette, font = 13): Style {
  return {
    fill: '#ffffff',
    stroke: p.ink,
    strokeWidth: 1.4,
    dash: 'solid',
    opacity: 1,
    radius: 3,
    fontFamily: 'sans',
    fontSize: font,
    fontWeight: 400,
    italic: false,
    textColor: p.ink,
    align: 'center',
    lineHeight: 1.25,
  }
}

export function baseEdgeStyle(p: Palette, font = 11): EdgeStyle {
  return {
    stroke: p.line,
    strokeWidth: 1.4,
    dash: 'solid',
    opacity: 1,
    fontFamily: 'sans',
    fontSize: font,
    textColor: p.line,
    // no plate by default: it is there to punch through a line the label sits
    // on, and most labels do not, so it mostly just ate the background
    labelBg: 'none',
  }
}

/** Connectors drawn in the editor. Same as the template base, but starting in
 *  LaTeX mode the way hand-drawn nodes do — a connector label is nearly always
 *  a symbol. Templates keep `baseEdgeStyle`; their labels carry their own `$`. */
export const newEdgeStyle = (p: Palette, font = 11): EdgeStyle => ({
  ...baseEdgeStyle(p, font),
  fontFamily: 'latex',
})

/* ---------- shape catalogue ---------- */

export interface ShapeSpec {
  kind: NodeKind
  label: string
  group: string
  w: number
  h: number
  /** thumbnail drawn in the palette strip (24×24 viewBox) */
  icon: string
  props?: NodeProps
  /** overrides merged onto baseStyle when inserting */
  style?: Partial<Style>
  labelText?: string
}

export const SHAPES: ShapeSpec[] = [
  {
    kind: 'rect',
    label: '블록',
    group: '기본',
    w: 120,
    h: 46,
    icon: 'M3 7h18v10H3z',
    labelText: 'Layer',
  },
  {
    kind: 'cuboid',
    label: '텐서 블록',
    group: 'AI',
    w: 84,
    h: 84,
    icon: 'M3 9h12v12H3zM3 9l6-5h12l-6 5M15 21l6-5V4',
    props: { depth: 26, skew: 32 },
    labelText: '',
  },
  {
    kind: 'stack',
    label: '반복 블록',
    group: 'AI',
    w: 118,
    h: 46,
    icon: 'M3 9h14v10H3zM6 6h14v10M9 3h12v10',
    props: { count: 3, offset: 5 },
    labelText: 'Block',
  },
  {
    kind: 'mlp',
    label: 'MLP',
    group: 'AI',
    /* The box a lattice of [4,64,64,64,1] at r 16, pitch 48, gap 56, eliding
       past 4, comes out as — five columns is 2r + 4·gap across, and the widest
       column draws 3 + ⋮ + 1 = 5 slots, so 2r + 4·pitch down. It has to match,
       because a lattice-mode MLP's box is recomputed from its lattice on the
       next edit and a mismatch would make the shape jump when first touched. */
    w: 256,
    h: 224,
    /* ⚠️ This was five zero-length segments — `M6 5v0` and friends — meaning
       "put a dot here". Nothing drew: the icons are stroked with the default
       butt cap, which gives a segment of length zero no width to show. Drawn
       as a fan of real lines between real circles instead, so it does not
       depend on a cap setting to exist. */
    /* Four links, not the full six: at 22px every crossing is a blob, and the
       rest of the rail is line art with air in it. */
    icon:
      'M8 5L16 8.5M8 12L16 8.5M8 12L16 15.5M8 19L16 15.5' +
      'M4 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0' +
      'M4 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0' +
      'M4 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0' +
      'M16 8.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0' +
      'M16 15.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    /* Lattice mode from the start: equal spacing, circles on the grid, and a ⋮
       once a layer passes six. Nodes in older files have no `pitch` and keep
       the stretch behaviour until someone turns it on. */
    props: {
      layers: [4, 64, 64, 64, 1],
      showEdges: true,
      neuronR: 16,
      pitch: 48,
      layerGap: 56,
      maxDots: 4,
    },
    labelText: '',
    style: { fill: '#ffffff', strokeWidth: 1 },
  },
  {
    kind: 'grid',
    label: '패치 / 히트맵',
    group: 'AI',
    w: 96,
    h: 96,
    icon: 'M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18',
    props: { rows: 4, cols: 4, gap: 1 },
    labelText: '',
  },
  {
    kind: 'op',
    label: '연산자',
    group: 'AI',
    w: 26,
    h: 26,
    icon: 'M12 3a9 9 0 100 18 9 9 0 100-18M12 7v10M7 12h10',
    props: { symbol: '+' },
    labelText: '',
    style: { align: 'center' },
  },
  {
    kind: 'ellipse',
    label: '타원 / 뉴런',
    group: '기본',
    w: 76,
    h: 48,
    icon: 'M12 5a7 7 0 100 14 7 7 0 100-14',
    labelText: 'z',
  },
  {
    kind: 'trapezoid',
    label: '인코더 / 디코더',
    group: 'AI',
    w: 78,
    h: 96,
    icon: 'M5 3h14l-4 18H9z',
    props: { taper: 0.45, dir: 'right' },
    labelText: 'Enc',
  },
  {
    kind: 'cylinder',
    label: '데이터셋',
    group: 'AI',
    w: 76,
    h: 72,
    icon: 'M5 7c0-2 3-4 7-4s7 2 7 4v10c0 2-3 4-7 4s-7-2-7-4zM5 7c0 2 3 4 7 4s7-2 7-4',
    labelText: 'Data',
  },
  {
    kind: 'diamond',
    label: '분기',
    group: '기본',
    w: 92,
    h: 62,
    icon: 'M12 3l9 9-9 9-9-9z',
    labelText: '',
  },
  {
    kind: 'parallelogram',
    label: '입출력',
    group: '기본',
    w: 110,
    h: 46,
    icon: 'M7 6h14l-4 12H3z',
    labelText: 'Input',
  },
  {
    kind: 'triangle',
    label: '삼각형',
    group: '기본',
    w: 64,
    h: 56,
    icon: 'M12 4l9 16H3z',
    labelText: '',
  },
  {
    kind: 'curve',
    label: '미니 그래프',
    group: 'AI',
    w: 96,
    h: 64,
    icon: 'M4 18V5M4 18h16M5 15c4 0 5-8 9-8s5 4 6 4',
    props: { fn: 'relu' },
    labelText: '',
  },
  {
    kind: 'frame',
    label: '그룹 프레임',
    group: '주석',
    w: 220,
    h: 140,
    icon: 'M3 6h18v14H3zM3 6l0-2h8v2',
    props: { title: 'Module' },
    labelText: '',
    style: { fill: 'none', dash: 'dashed', strokeWidth: 1.1, radius: 6 },
  },
  {
    kind: 'brace',
    label: '중괄호',
    group: '주석',
    w: 120,
    h: 22,
    icon: 'M4 8c3 0 0 8 4 8M20 8c-3 0-0 8-4 8',
    props: { dir: 'down' },
    labelText: '',
    style: { fill: 'none' },
  },
  {
    kind: 'bracket',
    label: '행렬 괄호',
    group: '주석',
    w: 90,
    h: 70,
    icon: 'M8 4H5v16h3M16 4h3v16h-3',
    labelText: '',
    style: { fill: 'none' },
  },
  {
    kind: 'text',
    label: '텍스트 / 수식',
    group: '주석',
    w: 130,
    h: 26,
    icon: 'M5 6h14M12 6v13',
    labelText: '$\\mathcal{L}_{\\mathrm{data}}$',
    props: { autoFit: true },
    style: { fill: 'none', stroke: 'none', fontSize: 15 },
  },
  {
    kind: 'image',
    label: '이미지',
    group: '주석',
    w: 120,
    h: 90,
    icon: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
    labelText: '',
    style: { fill: '#f3f3f3', strokeWidth: 1 },
  },
]

export const shapeSpec = (kind: NodeKind) =>
  SHAPES.find((s) => s.kind === kind) ?? SHAPES[0]

/* ---------- node factory ---------- */

let seq = 0
export const uid = (p = 'n') =>
  `${p}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function makeNode(
  kind: NodeKind,
  x: number,
  y: number,
  palette: Palette,
  baseFont: number,
  colorIndex = -1,
): FigNode {
  const spec = shapeSpec(kind)
  const accent = colorIndex >= 0 ? palette.colors[colorIndex % palette.colors.length] : null
  const style: Style = {
    ...baseStyle(palette, baseFont),
    /* Nodes you draw start in LaTeX mode: figure labels are mostly symbols, and
       fencing every one of them in dollars is the tax this removes. Templates
       do not come through here — they build on `baseStyle` directly and their
       labels are written for the prose-plus-`$…$` convention. */
    fontFamily: 'latex',
    ...(accent
      ? { stroke: accent, fill: tint(accent, 0.82), textColor: palette.ink }
      : null),
    ...spec.style,
  }
  return {
    id: uid(),
    kind,
    x: Math.round(x - spec.w / 2),
    y: Math.round(y - spec.h / 2),
    w: spec.w,
    h: spec.h,
    rotation: 0,
    /* The catalogue's seed labels are written the prose way — "Layer",
       "$\mathcal{L}_{data}$" — so they get converted into whatever mode the
       node is actually starting in. Left alone in LaTeX mode, "Layer" would
       come out as five italic variables multiplied together and the loss one
       would be a hard error. */
    label: retypeLabel(spec.labelText ?? '', 'sans', style.fontFamily),
    labelPos: kind === 'cuboid' || kind === 'mlp' || kind === 'grid' ? 'bottom' : 'center',
    style,
    props: { ...(spec.props ?? {}) },
    locked: false,
    hidden: false,
  }
}

/* ---------- arrow-head geometry (shared by canvas + SVG export) ---------- */

export interface HeadGeom {
  /** path in a local frame where the tip is at (0,0) and the line comes from -x */
  path: string
  filled: boolean
  /** how far back from the tip the line should stop, in stroke widths */
  inset: number
}

export function headGeom(kind: string, sw: number): HeadGeom | null {
  const L = Math.max(6, sw * 4.6) // length
  const W = Math.max(4.2, sw * 3.2) // half-width
  switch (kind) {
    case 'arrow':
      return {
        path: `M0 0 L${-L} ${-W} L${-L * 0.78} 0 L${-L} ${W} Z`,
        filled: true,
        inset: L * 0.74,
      }
    case 'open':
      return { path: `M${-L} ${-W} L0 0 L${-L} ${W}`, filled: false, inset: 0 }
    case 'dot': {
      const r = Math.max(2.4, sw * 1.9)
      return {
        path: `M${-r} 0a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`,
        filled: true,
        inset: r * 2,
      }
    }
    case 'circle': {
      const r = Math.max(2.4, sw * 1.9)
      return {
        path: `M${-r} 0a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`,
        filled: false,
        inset: r * 2,
      }
    }
    case 'diamond': {
      const d = Math.max(5, sw * 3.4)
      return {
        path: `M0 0 L${-d} ${-d * 0.6} L${-d * 2} 0 L${-d} ${d * 0.6} Z`,
        filled: true,
        inset: d * 2,
      }
    }
    case 'bar':
      return { path: `M0 ${-W} L0 ${W}`, filled: false, inset: 0 }
    default:
      return null
  }
}

export const HEADS: { key: string; label: string }[] = [
  { key: 'none', label: '없음' },
  { key: 'arrow', label: '삼각' },
  { key: 'open', label: '열린' },
  { key: 'dot', label: '점' },
  { key: 'circle', label: '원' },
  { key: 'diamond', label: '마름모' },
  { key: 'bar', label: '막대' },
]
