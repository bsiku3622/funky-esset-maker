/* Vector export, shared by every tool that draws its figure as SVG.
 *
 * The rule these tools follow is the one AI Figure Maker established: don't
 * re-draw the figure for export, *serialise the element on screen*. A second
 * renderer is a second thing that can disagree with what the user approved.
 *
 * Two things make the output usable in a paper rather than merely valid:
 *
 *   - Physical size in millimetres. \includegraphics{fig.svg} then lands on the
 *     column width with no scale factor to guess, and the pt size of the labels
 *     is whatever the tool showed.
 *   - No CSS dependencies. A standalone SVG has no stylesheet and no :root, so
 *     anything that resolved through a class or a custom property on screen is
 *     simply absent in the file. Fonts are pinned onto the root here for that
 *     reason; tools must write concrete colours and widths as attributes. */

import { UI_ONLY } from '../cores/figure'

const PX_PER_IN = 96

export interface Framed {
  svg: string
  /** viewport size in px (figure coordinates) */
  w: number
  h: number
}

export interface SvgDocOptions {
  /** printed width of the figure on the page */
  printWidthIn: number
  /** opaque background, or null/undefined to leave it transparent */
  bg?: string | null
  /** goes into <desc> — helps whoever opens the file six months later */
  title?: string
  /** pinned on the root so <text> without its own family does not fall back
   *  to the viewer's default serif */
  fontFamily?: string
  /** padding added around the viewBox, in figure px */
  pad?: number
}

export { UI_ONLY } from '../cores/figure'

/** Serialise a live <svg> element into a standalone, self-contained document. */
export function buildSvgDoc(
  source: SVGSVGElement,
  opts: SvgDocOptions,
): Framed {
  const clone = source.cloneNode(true) as SVGSVGElement

  clone.querySelectorAll(`[${UI_ONLY}]`).forEach((el) => el.remove())
  clone.removeAttribute('class')
  clone.removeAttribute('style')
  clone.querySelectorAll('[class]').forEach((el) => el.removeAttribute('class'))

  const vb = (source.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  const valid = vb.length === 4 && vb.every((n) => Number.isFinite(n))
  const bx = valid ? vb[0] : 0
  const by = valid ? vb[1] : 0
  const bw = valid ? vb[2] : source.clientWidth || 100
  const bh = valid ? vb[3] : source.clientHeight || 100

  const pad = opts.pad ?? 0
  const x = bx - pad
  const y = by - pad
  const w = bw + pad * 2
  const h = bh + pad * 2

  // px in the viewBox → inches on the page → millimetres, which is the unit
  // every layout program agrees on
  const inPerPx = opts.printWidthIn / bw
  const mmW = +(w * inPerPx * 25.4).toFixed(3)
  const mmH = +(h * inPerPx * 25.4).toFixed(3)

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`)
  clone.setAttribute('width', `${mmW}mm`)
  clone.setAttribute('height', `${mmH}mm`)
  if (opts.fontFamily) clone.setAttribute('font-family', opts.fontFamily)

  if (opts.bg) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(x))
    rect.setAttribute('y', String(y))
    rect.setAttribute('width', String(w))
    rect.setAttribute('height', String(h))
    rect.setAttribute('fill', opts.bg)
    clone.insertBefore(rect, clone.firstChild)
  }

  if (opts.title) {
    const desc = document.createElementNS('http://www.w3.org/2000/svg', 'desc')
    desc.textContent = opts.title
    clone.insertBefore(desc, clone.firstChild)
  }

  const body = new XMLSerializer().serializeToString(clone)
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`, w, h }
}

/* ---------- PNG ---------- */

/** Rasterise an SVG string at `dpi`.
 *
 *  Text keeps whatever fonts the markup names — an <img>-loaded SVG runs in a
 *  sandbox that cannot fetch external font files, which is exactly why the
 *  figure stacks are Times/Helvetica/system mono rather than a webfont. */
export async function svgToPng(
  framed: Framed,
  dpi: number,
  printWidthIn: number,
  canvasPxWidth: number,
): Promise<Blob> {
  const inPerPx = printWidthIn / canvasPxWidth
  const scale = Math.max(0.1, inPerPx * dpi)
  const outW = Math.max(1, Math.round(framed.w * scale))
  const outH = Math.max(1, Math.round(framed.h * scale))

  const blob = new Blob([framed.svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('svg load failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(img, 0, 0, outW, outH)
    const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!png) throw new Error('encode failed')
    return await tagSrgb(png)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Output pixel size for a given dpi — shown in the toolbar so nobody exports
 *  a 40000 px image by accident. */
export function pngPixels(
  framed: { w: number; h: number },
  dpi: number,
  printWidthIn: number,
  canvasPxWidth: number,
) {
  const scale = Math.max(0.1, (printWidthIn / canvasPxWidth) * dpi)
  return {
    w: Math.max(1, Math.round(framed.w * scale)),
    h: Math.max(1, Math.round(framed.h * scale)),
  }
}

/* PNG sRGB tagging — browser PNGs carry no colour profile, so on wide-gamut
   displays some apps reinterpret the pixels and shift the colours. Splicing
   sRGB/gAMA/cHRM in right after IHDR pins them. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array) {
  const buf = new ArrayBuffer(12 + data.length)
  const out = new Uint8Array(buf)
  const dv = new DataView(buf)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function u32(...vals: number[]) {
  const buf = new ArrayBuffer(vals.length * 4)
  const a = new Uint8Array(buf)
  const dv = new DataView(buf)
  vals.forEach((v, i) => dv.setUint32(i * 4, v >>> 0))
  return a
}

export async function tagSrgb(png: Blob): Promise<Blob> {
  const src = new Uint8Array(await png.arrayBuffer())
  const ihdrEnd = 33
  if (src.length < ihdrEnd) return png
  const chunks = [
    pngChunk('sRGB', new Uint8Array([0])),
    pngChunk('gAMA', u32(45455)),
    pngChunk('cHRM', u32(31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000)),
  ]
  const extra = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(src.length + extra)
  out.set(src.subarray(0, ihdrEnd), 0)
  let off = ihdrEnd
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  out.set(src.subarray(ihdrEnd), off)
  return new Blob([out], { type: 'image/png' })
}

/* ---------- download helpers ---------- */

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const textBlob = (s: string, type = 'text/plain') =>
  new Blob([s], { type: `${type};charset=utf-8` })

export { PX_PER_IN }
