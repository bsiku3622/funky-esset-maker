/* Turning a module grid into a drawing — and into the three warnings that
 * decide whether the drawing still scans.
 *
 * A QR code is the one figure in this app that has a *job* beyond looking
 * right: a phone has to read it. Every decorative choice here trades against
 * that, and all three failure modes are invisible on screen — a logo eating
 * more modules than the error correction can rebuild, a neon colour that has no
 * contrast against the plate, a code printed so small the modules blur
 * together. So the geometry and the checks live in the same file: the numbers
 * that make the picture are the numbers that decide whether it is honest.
 *
 * Nothing here touches the DOM or React. Paths come back as strings and the
 * checks come back as numbers, which is what makes them testable — and what
 * keeps the exported SVG free of anything a stylesheet would have to resolve. */

import type { QrCode } from './encode'

export type ModuleStyle = 'square' | 'rounded' | 'dot'
export type EyeStyle = 'square' | 'rounded' | 'circle'

export const MODULE_LABEL: Record<ModuleStyle, string> = {
  square: '사각',
  rounded: '둥근',
  dot: '점',
}

export const EYE_LABEL: Record<EyeStyle, string> = {
  square: '사각',
  rounded: '둥근',
  circle: '원',
}

/** Modules of quiet zone the spec asks for. Less than this and readers that
 *  scan a busy slide start missing the symbol entirely. */
export const SPEC_QUIET = 4

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/* ---------- layout ---------- */

export interface LayoutInput {
  /** total figure width in px, quiet zone included */
  figW: number
  /** quiet zone, in modules */
  quiet: number
  /** caption line height in px, or 0 for no caption */
  captionSize: number
}

export interface Layout {
  /** px per module */
  module: number
  /** top-left of the code area (inside the quiet zone) */
  x: number
  y: number
  /** figure box */
  figW: number
  figH: number
  /** baseline for the caption, when there is one */
  captionY: number
}

export function layout(qr: QrCode, { figW, quiet, captionSize }: LayoutInput): Layout {
  const module = figW / (qr.size + quiet * 2)
  const plate = figW
  const gap = captionSize ? captionSize * 0.5 : 0
  return {
    module,
    x: quiet * module,
    y: quiet * module,
    figW,
    figH: plate + (captionSize ? gap + captionSize * 1.25 : 0),
    captionY: plate + gap + captionSize,
  }
}

/* ---------- module paths ---------- */

const f = (v: number) => +v.toFixed(3)

/** The finder eyes occupy a 7×7 at three of the four corners. */
function inEye(qr: QrCode, x: number, y: number): boolean {
  const n = qr.size
  return (
    (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7)
  )
}

const inRect = (r: Rect | null, x: number, y: number) =>
  !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h

/** One module as a square, or as a square with the corners that face open
 *  space rounded off — which is what makes a run of modules read as one stroke
 *  instead of a row of tiles. */
function modulePath(
  dark: (x: number, y: number) => boolean,
  x: number,
  y: number,
  r: number,
): string {
  const x0 = x
  const y0 = y
  const x1 = x + 1
  const y1 = y + 1
  if (r <= 0) return `M${f(x0)} ${f(y0)}H${f(x1)}V${f(y1)}H${f(x0)}Z`

  const up = dark(x, y - 1)
  const down = dark(x, y + 1)
  const left = dark(x - 1, y)
  const right = dark(x + 1, y)
  const tl = !up && !left ? r : 0
  const tr = !up && !right ? r : 0
  const br = !down && !right ? r : 0
  const bl = !down && !left ? r : 0
  const arc = (cx: number, cy: number, rad: number) =>
    rad > 0 ? `A${f(rad)} ${f(rad)} 0 0 1 ${f(cx)} ${f(cy)}` : `L${f(cx)} ${f(cy)}`

  return (
    `M${f(x0 + tl)} ${f(y0)}` +
    `L${f(x1 - tr)} ${f(y0)}${arc(x1, y0 + tr, tr)}` +
    `L${f(x1)} ${f(y1 - br)}${arc(x1 - br, y1, br)}` +
    `L${f(x0 + bl)} ${f(y1)}${arc(x0, y1 - bl, bl)}` +
    `L${f(x0)} ${f(y0 + tl)}${arc(x0 + tl, y0, tl)}Z`
  )
}

/** A circle, written as two arcs so it can join the same path as everything
 *  else — one `<path>` per figure keeps the exported SVG small. */
function dotPath(x: number, y: number, r: number): string {
  const cx = x + 0.5
  const cy = y + 0.5
  return (
    `M${f(cx - r)} ${f(cy)}` +
    `A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}` +
    `A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`
  )
}

export interface ModulesOptions {
  style: ModuleStyle
  /** modules inside this rect are left unpainted — the logo's clear field */
  clear?: Rect | null
}

/** Every dark module except the three finder eyes, in module coordinates.
 *  The caller scales; keeping the path in module units is what lets the same
 *  string be reused as the figure is resized.
 *
 *  ⚠️ Timing and alignment patterns stay square whatever the payload style is.
 *  They are not decoration — they are the ruler a reader lays over the symbol
 *  to work out where the modules are, and a dotted timing line is a broken
 *  ruler. This was not a guess: drawing them as dots produced codes that a
 *  decoder could not read at all, and squaring them fixed it while leaving the
 *  look of the payload untouched. */
export function modulesPath(qr: QrCode, { style, clear = null }: ModulesOptions): string {
  const dark = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < qr.size &&
    y < qr.size &&
    qr.modules[y][x] &&
    !inEye(qr, x, y) &&
    !inRect(clear, x, y)

  const radius = style === 'rounded' ? 0.5 : 0
  const parts: string[] = []
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++) {
      if (!dark(x, y)) continue
      if (qr.fn[y][x]) parts.push(modulePath(dark, x, y, 0))
      else if (style === 'dot') parts.push(dotPath(x, y, 0.46))
      else parts.push(modulePath(dark, x, y, radius))
    }
  return parts.join('')
}

/** Rounded-rectangle subpath, or a plain one when `r` is 0. */
function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`
  const a = (cx: number, cy: number) => `A${f(r)} ${f(r)} 0 0 1 ${f(cx)} ${f(cy)}`
  return (
    `M${f(x + r)} ${f(y)}L${f(x + w - r)} ${f(y)}${a(x + w, y + r)}` +
    `L${f(x + w)} ${f(y + h - r)}${a(x + w - r, y + h)}` +
    `L${f(x + r)} ${f(y + h)}${a(x, y + h - r)}` +
    `L${f(x)} ${f(y + r)}${a(x + r, y)}Z`
  )
}

function ring(x: number, y: number, style: EyeStyle): string {
  // concentric on the eye's centre, which sits 3.5 modules in from its corner
  if (style === 'circle')
    return dotPath(x + 3, y + 3, 3.5) + dotPath(x + 3, y + 3, 2.5) + dotPath(x + 3, y + 3, 1.5)
  const r = style === 'rounded' ? 1.75 : 0
  return (
    roundRect(x, y, 7, 7, r) +
    roundRect(x + 1, y + 1, 5, 5, Math.max(0, r - 0.5)) +
    roundRect(x + 2, y + 2, 3, 3, Math.max(0, r - 1))
  )
}

/** The three finder eyes as one even-odd path: outer square, hole, core.
 *
 *  Even-odd rather than three painted shapes because the middle ring has to be
 *  a *hole* — painting it in the background colour looks identical on a white
 *  plate and wrong on a transparent one, which is the default everywhere else
 *  in this app. */
export function eyesPath(qr: QrCode, style: EyeStyle): string {
  const n = qr.size
  return ring(0, 0, style) + ring(n - 7, 0, style) + ring(0, n - 7, style)
}

/* ---------- the logo well ---------- */

/** Modules covered by a logo of `pct` of the code's width, centred, snapped out
 *  to whole modules so the cleared field has straight edges. */
export function logoRect(qr: QrCode, pct: number): Rect {
  const span = Math.max(1, Math.round(qr.size * pct))
  // an odd span centres exactly on an odd-sized symbol (they all are)
  const size = span % 2 === qr.size % 2 ? span : span + 1
  const from = Math.round((qr.size - size) / 2)
  return { x: from, y: from, w: size, h: size }
}

/** Font size that keeps `text` inside a logo well `box` px wide.
 *
 *  Measuring would need a laid-out DOM, and this runs during render for a
 *  figure that is also exported without one — so it estimates from advance
 *  widths instead: roughly 0.62 em for Latin, a full em for CJK and emoji.
 *  Erring small is the right direction; a logo that touches the modules around
 *  it is what the clear field exists to prevent. */
export function logoFontSize(text: string, box: number): number {
  const em = Array.from(text).reduce(
    (w, ch) => w + (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uf900-\uffff]|[\u{1f000}-\u{1ffff}]/u.test(ch) ? 1 : 0.62),
    0,
  )
  return Math.min(box * 0.86, (box * 0.92) / Math.max(em, 0.9))
}

/** Fraction of the symbol a rect hides. Compared against the level's advertised
 *  recovery to decide whether a logo has gone too far. */
export function coverage(qr: QrCode, rect: Rect | null): number {
  if (!rect) return 0
  return (rect.w * rect.h) / (qr.size * qr.size)
}

/** Error correction is spread across the whole symbol, so a code can lose its
 *  advertised share and still decode — but only with margin, since the format
 *  information and the sampling grid have no redundancy to spare. Three
 *  quarters of the nominal figure is the line readers stop complaining at. */
export const COVERAGE_MARGIN = 0.75

export const logoFits = (qr: QrCode, rect: Rect | null) =>
  coverage(qr, rect) <= qr.recovery * COVERAGE_MARGIN

/* ---------- contrast ---------- */

function channels(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim())
  if (!m) return null
  const s = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ]
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function luminance(hex: string): number {
  const rgb = channels(hex)
  if (!rgb) return 1
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio between two colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Below this a camera in ordinary light starts failing on the code. The spec
 *  talks about reflectance rather than a ratio; 4:1 is the working equivalent
 *  and is where phone readers begin to hesitate. */
export const MIN_CONTRAST = 4

/** Dark modules on a light field. Inverted codes decode on many phones and
 *  fail on enough of the rest that it is worth saying so. */
export const isInverted = (fg: string, plate: string) =>
  luminance(fg) > luminance(plate)

/* ---------- printed size ---------- */

/** Printed size of one module, in millimetres. */
export const moduleMm = (module: number, printWidthIn: number, figW: number) =>
  module * (printWidthIn / figW) * 25.4

/** Under this, ink spread and camera blur start merging neighbouring modules.
 *  0.5 mm is the usual print minimum for a code someone scans from a page. */
export const MIN_MODULE_MM = 0.5
