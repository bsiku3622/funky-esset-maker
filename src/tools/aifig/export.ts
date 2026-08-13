/* Export: vector SVG, high-DPI PNG, project JSON, and a TikZ approximation.
 *
 * The SVG path serialises the live figure group instead of re-drawing it, so
 * the file is exactly what the canvas shows. The physical width is written in
 * millimetres, which is what makes \includegraphics{fig.svg} (or a PDF made
 * from it) land at the intended column width without guessing a scale factor. */

import type { EndPoint, FigDoc, FigNode, Pt } from './types'
import type { Framed } from '../svg'
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
  /* Export only these nodes and edges.
   *
   * ⚠️ The cut happens on the *clone*, so the live drawing is untouched — and
   * it has to, because the frame is measured from what remains. Measuring the
   * original group's bbox and then removing half of it would leave a figure
   * floating in the space its neighbours used to fill. */
  only?: string[]
}

export const DEFAULT_EXPORT: ExportOpts = { trim: true, pad: 6, opaque: false }

const BG_HEX: Record<string, string | null> = {
  transparent: null,
  white: '#ffffff',
  paper: '#fbfbf9',
}

export type { Framed }

/** Serialise the figure group into a standalone SVG document. */
export function buildSvg(
  group: SVGGElement,
  doc: FigDoc,
  opts: ExportOpts = DEFAULT_EXPORT,
): Framed {
  /* Cut first, then measure. A partial export is framed by what survives, and
     `getBBox` only reports what is in the document — so the trimmed copy has to
     be mounted for long enough to be measured, hidden well out of the way. */
  const clone = group.cloneNode(true) as SVGGElement
  let measured: SVGGElement = group
  let host: SVGSVGElement | null = null
  if (opts.only) {
    const keep = new Set(opts.only)
    clone.querySelectorAll('[data-node],[data-edge]').forEach((el) => {
      const id = el.getAttribute('data-node') ?? el.getAttribute('data-edge')
      if (id && !keep.has(id)) el.remove()
    })
    host = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText =
      'position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden'
    const held = clone.cloneNode(true) as SVGGElement
    host.appendChild(held)
    document.body.appendChild(host)
    measured = held
  }

  let x = 0
  let y = 0
  let w = doc.canvas.w
  let h = doc.canvas.h
  if (opts.trim) {
    let box: DOMRect | null
    try {
      box = measured.getBBox()
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
  host?.remove()
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

/* PNG, sRGB tagging and the download helpers are shared with the other SVG
   tools — see ../svg.ts. They are re-exported so this module stays the one
   import an AI Figure Maker caller needs.
 */
export { svgToPng, download, textBlob } from '../svg'

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
