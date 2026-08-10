/* Print settings for the vector tools.
 *
 * The colour and font tokens live one level down in cores/figure.ts, because
 * the render cores need them too; they are re-exported here so a tool has one
 * import for "how a figure should look and how big it prints".
 *
 * What is genuinely tool-only is on this side: the column widths a figure has
 * to hit, the dpi choices, and the arithmetic that turns a px label into the
 * point size it will actually print at. */

export * from '../cores/figure'

/* ---------- printed width ---------- */

export const PX_PER_IN = 96
export const inPx = (v: number) => Math.round(v * PX_PER_IN)

export interface WidthPreset {
  id: string
  group: string
  label: string
  /** printed width on the page */
  widthIn: number
}

const mmIn = (mm: number) => mm / 25.4

/** The widths a figure actually has to hit. Same list AI Figure Maker uses for
 *  its canvas, minus the aspect ratios — the other tools size themselves. */
export const WIDTH_PRESETS: WidthPreset[] = [
  { id: 'icml-col', group: 'ML 학회', label: 'ICML 1단 (3.25")', widthIn: 3.25 },
  { id: 'cvpr-col', group: 'ML 학회', label: 'CVPR / ICCV 1단 (3.29")', widthIn: 3.29 },
  { id: 'acl-col', group: 'ML 학회', label: 'ACL / EMNLP 1단 (3.03")', widthIn: 3.03 },
  { id: 'aaai-col', group: 'ML 학회', label: 'AAAI 1단 (3.3")', widthIn: 3.3 },
  { id: 'neurips-col', group: 'ML 학회', label: 'NeurIPS / ICLR 본문 (5.5")', widthIn: 5.5 },
  { id: 'icml-full', group: 'ML 학회', label: 'ICML 양단 (6.75")', widthIn: 6.75 },
  { id: 'cvpr-full', group: 'ML 학회', label: 'CVPR / ICCV 양단 (6.875")', widthIn: 6.875 },
  { id: 'acl-full', group: 'ML 학회', label: 'ACL / EMNLP 양단 (6.3")', widthIn: 6.3 },
  { id: 'ieee-col', group: 'IEEE', label: 'IEEE 1단 (3.5")', widthIn: 3.5 },
  { id: 'ieee-full', group: 'IEEE', label: 'IEEE 양단 (7.16")', widthIn: 7.16 },
  { id: 'nature-1', group: '저널', label: 'Nature 1단 (89 mm)', widthIn: mmIn(89) },
  { id: 'nature-2', group: '저널', label: 'Nature 2단 (183 mm)', widthIn: mmIn(183) },
  { id: 'science-2', group: '저널', label: 'Science 2단 (114 mm)', widthIn: mmIn(114) },
  { id: 'elsevier-2', group: '저널', label: 'Elsevier 2단 (190 mm)', widthIn: mmIn(190) },
  { id: 'pnas-2', group: '저널', label: 'PNAS 2단 (114 mm)', widthIn: mmIn(114) },
  { id: 'slide', group: '발표', label: '슬라이드 폭 (13.33")', widthIn: 13.33 },
  { id: 'screen', group: '자유', label: '화면 크기 그대로', widthIn: 0 },
]

export const DEFAULT_WIDTH_ID = 'icml-col'

/** `widthIn: 0` means "whatever the figure is on screen" — 1 px = 1/96 in. */
export function printWidthIn(presetId: string, figPxWidth: number): number {
  const p = WIDTH_PRESETS.find((w) => w.id === presetId)
  if (!p || p.widthIn <= 0) return figPxWidth / PX_PER_IN
  return p.widthIn
}

/* ---------- print readout ---------- */

export const DPI_CHOICES = [150, 300, 600, 1200]
export const DEFAULT_DPI = 600

/** Journals reject body text under ~5 pt and reviewers squint below 7. */
export const MIN_READABLE_PT = 6

/** Printed size of `px` (in figure coordinates) at the chosen page width. */
export const ptOf = (px: number, widthIn: number, figPxWidth: number) =>
  (px * (widthIn / figPxWidth)) * 72
