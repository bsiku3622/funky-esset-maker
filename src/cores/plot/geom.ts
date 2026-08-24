/* Paths and glyphs. Pure string building — nothing here knows about React,
 * scales or data, only about points that are already in pixels. */

export interface P {
  x: number
  y: number
}

const n = (v: number) => (Number.isFinite(v) ? +v.toFixed(2) : 0)

export const M = (p: P) => `M${n(p.x)} ${n(p.y)}`
export const L = (p: P) => `L${n(p.x)} ${n(p.y)}`

/** A polyline, broken wherever the data had a gap.
 *
 *  ⚠️ A missing point must break the line, not be skipped. Joining across a gap
 *  draws a straight segment through data that does not exist, which is the one
 *  chart lie a reader has no way to detect. */
export function linePath(pts: (P | null)[]): string {
  let d = ''
  let pen = false
  for (const p of pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      pen = false
      continue
    }
    d += pen ? ` ${L(p)}` : `${d ? ' ' : ''}${M(p)}`
    pen = true
  }
  return d
}

/** Catmull–Rom through the points, converted to cubics.
 *
 *  The control points are clamped to the segment's own y range. Unclamped
 *  Catmull–Rom overshoots after a sharp change — a curve through (0,0) (1,0)
 *  (2,5) dips below zero on its way up, which invents a value the data never
 *  had. Clamping costs a little smoothness at kinks and buys monotonicity. */
export function smoothPath(pts: (P | null)[]): string {
  const runs: P[][] = []
  let cur: P[] = []
  for (const p of pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      if (cur.length) runs.push(cur)
      cur = []
      continue
    }
    cur.push(p)
  }
  if (cur.length) runs.push(cur)

  let d = ''
  for (const run of runs) {
    if (run.length < 3) {
      d += `${d ? ' ' : ''}${linePath(run)}`
      continue
    }
    d += `${d ? ' ' : ''}${M(run[0])}`
    for (let i = 0; i < run.length - 1; i++) {
      const p0 = run[i - 1] ?? run[i]
      const p1 = run[i]
      const p2 = run[i + 1]
      const p3 = run[i + 2] ?? p2
      const lo = Math.min(p1.y, p2.y)
      const hi = Math.max(p1.y, p2.y)
      const clamp = (v: number) => Math.min(hi, Math.max(lo, v))
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: clamp(p1.y + (p2.y - p0.y) / 6) }
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: clamp(p2.y - (p3.y - p1.y) / 6) }
      d += ` C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p2.x)} ${n(p2.y)}`
    }
  }
  return d
}

export type StepAt = 'pre' | 'mid' | 'post'

/** A staircase. `post` holds the value until the next x (matplotlib's default),
 *  `pre` jumps first, `mid` splits the difference. */
export function stepPath(pts: (P | null)[], at: StepAt = 'post'): string {
  const clean = pts.filter((p): p is P => !!p && Number.isFinite(p.x) && Number.isFinite(p.y))
  if (!clean.length) return ''
  let d = M(clean[0])
  for (let i = 1; i < clean.length; i++) {
    const a = clean[i - 1]
    const b = clean[i]
    if (at === 'post') d += ` ${L({ x: b.x, y: a.y })} ${L(b)}`
    else if (at === 'pre') d += ` ${L({ x: a.x, y: b.y })} ${L(b)}`
    else {
      const mx = (a.x + b.x) / 2
      d += ` ${L({ x: mx, y: a.y })} ${L({ x: mx, y: b.y })} ${L(b)}`
    }
  }
  return d
}

/** A closed band between an upper and a lower edge. */
export function bandPath(top: (P | null)[], bottom: (P | null)[], smooth = false): string {
  const up = top.filter((p): p is P => !!p && Number.isFinite(p.y))
  const dn = bottom.filter((p): p is P => !!p && Number.isFinite(p.y)).reverse()
  if (!up.length) return ''
  const head = smooth ? smoothPath(up) : linePath(up)
  const tail = dn.map((p) => L(p)).join(' ')
  return `${head}${tail ? ` ${tail}` : ''} Z`
}

/* ---------- markers ---------- */

export type MarkerName =
  | 'none'
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'cross'
  | 'plus'
  | 'star'
  | 'hollow'

/** A marker as a path, so every one of them is a single element with the same
 *  stroke and fill handling — no mix of <circle> and <path> to keep in step. */
export function markerPath(kind: MarkerName, c: P, r: number): string {
  const { x, y } = c
  switch (kind) {
    case 'square':
      return `M${n(x - r)} ${n(y - r)}h${n(r * 2)}v${n(r * 2)}h${n(-r * 2)}Z`
    case 'triangle':
      return `M${n(x)} ${n(y - r * 1.15)}L${n(x + r)} ${n(y + r * 0.75)}L${n(x - r)} ${n(y + r * 0.75)}Z`
    case 'diamond':
      return `M${n(x)} ${n(y - r * 1.25)}L${n(x + r * 1.05)} ${n(y)}L${n(x)} ${n(y + r * 1.25)}L${n(x - r * 1.05)} ${n(y)}Z`
    case 'cross': {
      const a = r * 0.78
      return `M${n(x - a)} ${n(y - a)}L${n(x + a)} ${n(y + a)}M${n(x + a)} ${n(y - a)}L${n(x - a)} ${n(y + a)}`
    }
    case 'plus':
      return `M${n(x - r)} ${n(y)}L${n(x + r)} ${n(y)}M${n(x)} ${n(y - r)}L${n(x)} ${n(y + r)}`
    case 'star': {
      let d = ''
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 ? r * 0.45 : r * 1.2
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        d += `${i ? 'L' : 'M'}${n(x + rad * Math.cos(a))} ${n(y + rad * Math.sin(a))}`
      }
      return `${d}Z`
    }
    case 'circle':
    case 'hollow':
    default:
      // two arcs, because a full circle needs two in path syntax
      return `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(r * 2)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-r * 2)} 0`
  }
}

/** Markers drawn as strokes only — filling them would close the glyph. */
export const STROKE_ONLY: ReadonlySet<MarkerName> = new Set<MarkerName>(['cross', 'plus'])

/* ---------- arcs ---------- */

/** A pie or donut slice between two angles, in radians, measured clockwise
 *  from twelve o'clock. */
export function slicePath(c: P, r: number, a0: number, a1: number, hole = 0): string {
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0
  const at = (a: number, rad: number) => ({
    x: c.x + rad * Math.cos(a),
    y: c.y + rad * Math.sin(a),
  })
  // a full circle cannot be drawn as one arc — its endpoints coincide
  if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-9) {
    const outer = `M${n(c.x - r)} ${n(c.y)}a${n(r)} ${n(r)} 0 1 1 ${n(r * 2)} 0a${n(r)} ${n(r)} 0 1 1 ${n(-r * 2)} 0Z`
    if (hole <= 0) return outer
    const h = r * hole
    return `${outer}M${n(c.x - h)} ${n(c.y)}a${n(h)} ${n(h)} 0 1 0 ${n(h * 2)} 0a${n(h)} ${n(h)} 0 1 0 ${n(-h * 2)} 0Z`
  }
  const p1 = at(a0, r)
  const p2 = at(a1, r)
  if (hole <= 0)
    return `M${n(c.x)} ${n(c.y)} ${L(p1)}A${n(r)} ${n(r)} 0 ${large} 1 ${n(p2.x)} ${n(p2.y)}Z`
  const h = r * hole
  const q1 = at(a1, h)
  const q2 = at(a0, h)
  return `${M(p1)}A${n(r)} ${n(r)} 0 ${large} 1 ${n(p2.x)} ${n(p2.y)} ${L(q1)}A${n(h)} ${n(h)} 0 ${large} 0 ${n(q2.x)} ${n(q2.y)}Z`
}

/** A ring sector — the wedge of a rose diagram, which starts at a radius. */
export function sectorPath(c: P, r0: number, r1: number, a0: number, a1: number): string {
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0
  const at = (a: number, rad: number) => ({ x: c.x + rad * Math.cos(a), y: c.y + rad * Math.sin(a) })
  const o1 = at(a0, r1)
  const o2 = at(a1, r1)
  if (r0 <= 0)
    return `M${n(c.x)} ${n(c.y)} ${L(o1)}A${n(r1)} ${n(r1)} 0 ${large} 1 ${n(o2.x)} ${n(o2.y)}Z`
  const i1 = at(a1, r0)
  const i2 = at(a0, r0)
  return `${M(o1)}A${n(r1)} ${n(r1)} 0 ${large} 1 ${n(o2.x)} ${n(o2.y)} ${L(i1)}A${n(r0)} ${n(r0)} 0 ${large} 0 ${n(i2.x)} ${n(i2.y)}Z`
}

/* ---------- arrows ---------- */

/** A filled arrow head at `tip`, pointing along `angle` (radians). */
export function arrowHead(tip: P, angle: number, size: number): string {
  const back = size
  const half = size * 0.42
  const bx = tip.x - back * Math.cos(angle)
  const by = tip.y - back * Math.sin(angle)
  const nx = -Math.sin(angle) * half
  const ny = Math.cos(angle) * half
  return `M${n(tip.x)} ${n(tip.y)}L${n(bx + nx)} ${n(by + ny)}L${n(bx - nx)} ${n(by - ny)}Z`
}

/* ---------- text measuring ---------- */

/** Roughly how wide a label will be.
 *
 *  There is no DOM here — the plot has to know its own margins before it can
 *  be laid out, and asking the browser would mean rendering twice. The ratios
 *  are for the two stacks actually used: proportional latin runs a bit over
 *  half the em, and a CJK glyph is square. Overestimating is the safe side:
 *  too much margin looks loose, too little clips a tick label. */
export function textWidth(s: string, fontSize: number, bold = false): number {
  let w = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    if (code > 0x2e80) w += 1 // CJK, hangul, kana
    else if (/[.,:;'|! ]/.test(ch)) w += 0.28
    else if (/[iIljt]/.test(ch)) w += 0.32
    else if (/[A-Z0-9]/.test(ch)) w += 0.62
    else w += 0.52
  }
  return w * fontSize * (bold ? 1.06 : 1)
}
