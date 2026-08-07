/* Export: vector SVG, high-DPI PNG, project JSON, and a TikZ approximation.
 *
 * The SVG path serialises the live figure group instead of re-drawing it, so
 * the file is exactly what the canvas shows. The physical width is written in
 * millimetres, which is what makes \includegraphics{fig.svg} (or a PDF made
 * from it) land at the intended column width without guessing a scale factor. */

import type { EndPoint, FigDoc, FigNode, Pt } from './types'
import { PX_PER_IN, hexToRgb } from './presets'
import { nodeBounds, unionRect } from './geometry'
import { nodeMap } from './doc'
import { parseLabel } from './latex'

export interface ExportOpts {
  /** crop to the drawn content instead of the canvas frame */
  trim: boolean
  /** padding around the content when trimming, in px */
  pad: number
  /** paint the canvas background even when it is set to transparent */
  opaque: boolean
}

export const DEFAULT_EXPORT: ExportOpts = { trim: true, pad: 6, opaque: false }

const BG_HEX: Record<string, string | null> = {
  transparent: null,
  white: '#ffffff',
  paper: '#fbfbf9',
}

export interface Framed {
  svg: string
  /** viewport size in px */
  w: number
  h: number
}

/** Serialise the figure group into a standalone SVG document. */
export function buildSvg(
  group: SVGGElement,
  doc: FigDoc,
  opts: ExportOpts = DEFAULT_EXPORT,
): Framed {
  let x = 0
  let y = 0
  let w = doc.canvas.w
  let h = doc.canvas.h
  if (opts.trim) {
    let box: DOMRect | null
    try {
      box = group.getBBox()
    } catch {
      box = null
    }
    if (box && box.width > 0 && box.height > 0) {
      x = Math.floor(box.x - opts.pad)
      y = Math.floor(box.y - opts.pad)
      w = Math.ceil(box.width + opts.pad * 2)
      h = Math.ceil(box.height + opts.pad * 2)
    }
  }

  const clone = group.cloneNode(true) as SVGGElement
  // strip editor-only attributes so the file stays clean
  for (const attr of ['transform', 'class', 'pointer-events'])
    clone.removeAttribute(attr)
  clone.querySelectorAll('[data-node],[data-edge]').forEach((el) => {
    el.removeAttribute('data-node')
    el.removeAttribute('data-edge')
  })
  const body = new XMLSerializer().serializeToString(clone)

  const bg = BG_HEX[doc.canvas.bg] ?? (opts.opaque ? '#ffffff' : null)
  const rect = bg
    ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>`
    : ''

  // physical size: the canvas width is authored for doc.canvas.printWidthIn
  const scaleIn = doc.canvas.printWidthIn / doc.canvas.w
  const mmW = +(w * scaleIn * 25.4).toFixed(3)
  const mmH = +(h * scaleIn * 25.4).toFixed(3)

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${mmW}mm" height="${mmH}mm" viewBox="${x} ${y} ${w} ${h}">\n` +
    `<desc>Made with Funky Esset Maker — AI Figure Maker</desc>\n` +
    `${rect}\n${body}\n</svg>\n`
  return { svg, w, h }
}

/* ---------- PNG ---------- */

/** Rasterise an SVG string at `dpi`. Text keeps the system fonts referenced in
 *  the markup, which is why the figure fonts are Times/Helvetica rather than a
 *  webfont — an <img>-loaded SVG cannot fetch external font files. */
export async function svgToPng(
  framed: Framed,
  dpi: number,
  printWidthIn: number,
  canvasPxWidth: number,
): Promise<Blob> {
  // px in the viewBox → inches on paper → device pixels at the target dpi
  const inPerPx = printWidthIn / canvasPxWidth
  const scale = Math.max(0.1, (inPerPx * dpi))
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

async function tagSrgb(png: Blob): Promise<Blob> {
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

/* ---------- TikZ ---------- */

/* A best-effort translation, not a renderer: shapes map to the closest
   TikZ node shape and coordinates are converted to pt with the y-axis
   flipped. Curved/orthogonal routes become straight or right-angled paths.
   Meant as a starting point for authors who want the figure in LaTeX source
   form — the SVG export is the faithful one. */

const PT_PER_PX = 72 / PX_PER_IN

const colorName = (hex: string, seen: Map<string, string>) => {
  if (hex === 'none') return 'none'
  const k = hex.toLowerCase()
  const hit = seen.get(k)
  if (hit) return hit
  const name = `c${seen.size + 1}`
  seen.set(k, name)
  return name
}

/** Escape prose for LaTeX while leaving `$…$` spans verbatim — escaping a
 *  subscript underscore inside math mode would break the formula. */
function esc(s: string) {
  return parseLabel(s)
    .map((seg) =>
      seg.t === 'br'
        ? ' \\\\ '
        : seg.t === 'math'
          ? seg.display
            ? `\\[${seg.v}\\]`
            : `$${seg.v}$`
          : seg.v.replace(/([%#&_$])/g, '\\$1').replace(/([{}])/g, '\\$1'),
    )
    .join('')
}

/** TikZ has no glyph for our operator tokens, so map them to math symbols. */
const OP_TEX: Record<string, string> = {
  '+': '$+$',
  '-': '$-$',
  x: '$\\times$',
  '.': '$\\odot$',
  c: '$\\Vert$',
}

const TIKZ_SHAPE: Record<string, string> = {
  rect: 'rectangle',
  ellipse: 'ellipse',
  op: 'circle',
  diamond: 'diamond',
  cylinder: 'cylinder',
  trapezoid: 'trapezium',
  parallelogram: 'trapezium',
  triangle: 'regular polygon,regular polygon sides=3',
}

export function toTikz(doc: FigDoc): string {
  const colors = new Map<string, string>()
  const lines: string[] = []
  const bounds = unionRect(doc.nodes.map(nodeBounds)) ?? { x: 0, y: 0, w: 0, h: 0 }
  const X = (v: number) => +((v - bounds.x) * PT_PER_PX).toFixed(2)
  const Y = (v: number) => +(-(v - bounds.y) * PT_PER_PX).toFixed(2)

  const body: string[] = []
  const named = new Map<string, string>()
  doc.nodes.forEach((n, i) => {
    if (n.hidden) return
    const name = `n${i}`
    named.set(n.id, name)
    const cx = X(n.x + n.w / 2)
    const cy = Y(n.y + n.h / 2)
    const shape = TIKZ_SHAPE[n.kind] ?? 'rectangle'
    const fill = colorName(n.style.fill, colors)
    const stroke = colorName(n.style.stroke, colors)
    const opts = [
      shape === 'rectangle' ? 'rectangle' : `shape=${shape}`,
      `draw=${stroke}`,
      fill === 'none' ? 'fill=none' : `fill=${fill}`,
      `line width=${(n.style.strokeWidth * PT_PER_PX).toFixed(2)}pt`,
      `minimum width=${(n.w * PT_PER_PX).toFixed(1)}pt`,
      `minimum height=${(n.h * PT_PER_PX).toFixed(1)}pt`,
      'inner sep=1pt',
      'align=center',
      n.style.radius > 0 && shape === 'rectangle' ? 'rounded corners=1.5pt' : '',
      n.style.dash === 'dashed' ? 'dashed' : n.style.dash === 'dotted' ? 'dotted' : '',
      n.rotation ? `rotate=${-n.rotation}` : '',
    ]
      .filter(Boolean)
      .join(', ')
    const label =
      n.kind === 'op'
        ? (OP_TEX[n.props.symbol ?? '+'] ?? esc(n.props.symbol ?? ''))
        : n.kind === 'frame'
          ? esc(n.props.title ?? n.label)
          : esc(n.label)
    body.push(`  \\node[${opts}] (${name}) at (${cx}pt,${cy}pt) {${label}};`)
  })

  const nm = nodeMap(doc)
  for (const e of doc.edges) {
    if (e.hidden) continue
    const a = 'node' in e.from ? named.get(e.from.node) : null
    const b = 'node' in e.to ? named.get(e.to.node) : null
    const stroke = colorName(e.style.stroke, colors)
    const arrow =
      e.endHead === 'none' && e.startHead === 'none'
        ? '-'
        : e.startHead !== 'none' && e.endHead !== 'none'
          ? '<->'
          : e.endHead !== 'none'
            ? '->'
            : '<-'
    const opts = [
      arrow,
      `draw=${stroke}`,
      `line width=${(e.style.strokeWidth * PT_PER_PX).toFixed(2)}pt`,
      e.style.dash === 'dashed' ? 'dashed' : e.style.dash === 'dotted' ? 'dotted' : '',
    ]
      .filter(Boolean)
      .join(', ')
    const mid = e.label ? ` node[midway, fill=white, inner sep=1pt, font=\\scriptsize] {${esc(e.label)}}` : ''
    const conn = e.route === 'ortho' ? '|-' : '--'
    if (a && b) {
      body.push(`  \\draw[${opts}] (${a}) ${conn}${mid} (${b});`)
    } else {
      // free endpoint: fall back to absolute coordinates
      const pa = endpointXY(e.from, nm)
      const pb = endpointXY(e.to, nm)
      if (pa && pb)
        body.push(
          `  \\draw[${opts}] (${X(pa.x)}pt,${Y(pa.y)}pt) ${conn}${mid} (${X(pb.x)}pt,${Y(pb.y)}pt);`,
        )
    }
  }

  for (const [hex, name] of colors) {
    const [r, g, bl] = hexToRgb(hex)
    lines.push(`\\definecolor{${name}}{RGB}{${r},${g},${bl}}`)
  }
  return (
    `% requires: \\usepackage{tikz}\n% \\usetikzlibrary{shapes.geometric,shapes.symbols,arrows.meta}\n` +
    `${lines.join('\n')}\n\\begin{tikzpicture}[x=1pt,y=1pt]\n${body.join('\n')}\n\\end{tikzpicture}\n`
  )
}

function endpointXY(ep: EndPoint, nm: Map<string, FigNode>): Pt | null {
  if ('free' in ep) return ep.free
  const n = nm.get(ep.node)
  return n ? { x: n.x + n.w / 2, y: n.y + n.h / 2 } : null
}
