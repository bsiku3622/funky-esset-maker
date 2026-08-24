/* The summaries a plot draws rather than reads.
 *
 * A histogram, a box plot and a trend line all take a raw column and show
 * something that is not in it. Keeping that arithmetic here rather than inside
 * the renderers means the numbers can be checked without rendering anything —
 * and a box plot whose whiskers are wrong looks exactly like one whose whiskers
 * are right. */

export const finite = (vs: number[]): number[] => vs.filter((v) => Number.isFinite(v))

/* ---------- quantiles ---------- */

/** Linear interpolation between order statistics — numpy's default, and the
 *  one matplotlib's boxplot uses, so a figure made here matches a figure made
 *  there from the same column. */
export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN
  if (sorted.length === 1) return sorted[0]
  const h = (sorted.length - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo)
}

export const mean = (vs: number[]): number =>
  vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : NaN

/** Sample standard deviation (n−1). The population form understates the spread
 *  of a measured sample, which is what an error bar on a chart always is. */
export function stdev(vs: number[]): number {
  if (vs.length < 2) return 0
  const m = mean(vs)
  return Math.sqrt(vs.reduce((s, v) => s + (v - m) ** 2, 0) / (vs.length - 1))
}

/* ---------- box plot ---------- */

export interface BoxStats {
  min: number
  q1: number
  median: number
  q3: number
  max: number
  mean: number
  /** points outside the whiskers, drawn individually */
  outliers: number[]
  n: number
}

/** Tukey's rule: whiskers reach the furthest observation within 1.5 IQR, and
 *  everything past them is drawn as a point.
 *
 *  ⚠️ The whisker ends at a *real observation*, not at q1 − 1.5·IQR. Drawing
 *  the fence instead of the datum is the classic mistake: it puts the whisker
 *  somewhere no measurement was taken. */
export function boxStats(values: number[], whisker = 1.5): BoxStats {
  const vs = finite(values).slice().sort((a, b) => a - b)
  if (!vs.length)
    return { min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN, mean: NaN, outliers: [], n: 0 }
  const q1 = quantile(vs, 0.25)
  const q3 = quantile(vs, 0.75)
  const iqr = q3 - q1
  const loFence = q1 - whisker * iqr
  const hiFence = q3 + whisker * iqr
  const inside = vs.filter((v) => v >= loFence && v <= hiFence)
  return {
    min: inside.length ? inside[0] : vs[0],
    q1,
    median: quantile(vs, 0.5),
    q3,
    max: inside.length ? inside[inside.length - 1] : vs[vs.length - 1],
    mean: mean(vs),
    outliers: vs.filter((v) => v < loFence || v > hiFence),
    n: vs.length,
  }
}

/* ---------- histogram ---------- */

export interface Bin {
  x0: number
  x1: number
  count: number
}

/** Sturges' rule, which is what most tools fall back to when nobody said how
 *  many bins they wanted. */
export const sturges = (n: number): number =>
  Math.max(1, Math.min(100, Math.ceil(Math.log2(Math.max(1, n)) + 1)))

export function histogram(values: number[], bins?: number, range?: [number, number]): Bin[] {
  const vs = finite(values)
  if (!vs.length) return []
  const lo = range ? range[0] : Math.min(...vs)
  const hi = range ? range[1] : Math.max(...vs)
  const k = Math.max(1, Math.min(500, Math.round(bins || sturges(vs.length))))
  if (hi === lo) return [{ x0: lo - 0.5, x1: lo + 0.5, count: vs.length }]
  const w = (hi - lo) / k
  const out: Bin[] = Array.from({ length: k }, (_, i) => ({
    x0: lo + i * w,
    x1: lo + (i + 1) * w,
    count: 0,
  }))
  for (const v of vs) {
    if (v < lo || v > hi) continue
    // the last bin owns its right edge, or the maximum falls out of the chart
    const i = Math.min(k - 1, Math.floor((v - lo) / w))
    out[i].count++
  }
  return out
}

/** Normalise counts to a density, so bars of different widths are comparable
 *  and the area under the histogram is 1. */
export function toDensity(bins: Bin[]): Bin[] {
  const total = bins.reduce((s, b) => s + b.count, 0)
  if (!total) return bins
  return bins.map((b) => ({ ...b, count: b.count / (total * (b.x1 - b.x0)) }))
}

/* ---------- kernel density, for violins ---------- */

/** Silverman's rule of thumb. */
export function bandwidth(vs: number[]): number {
  const n = vs.length
  if (n < 2) return 1
  const sorted = vs.slice().sort((a, b) => a - b)
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25)
  const s = stdev(vs)
  const a = iqr > 0 ? Math.min(s, iqr / 1.349) : s
  return 0.9 * (a || 1) * Math.pow(n, -0.2)
}

/** Gaussian KDE sampled on a regular grid — the outline of a violin. */
export function kde(values: number[], steps = 64, h?: number): { v: number; d: number }[] {
  const vs = finite(values)
  if (vs.length < 2) return []
  const bw = h && h > 0 ? h : bandwidth(vs)
  const lo = Math.min(...vs) - 3 * bw
  const hi = Math.max(...vs) + 3 * bw
  const out: { v: number; d: number }[] = []
  const norm = 1 / (vs.length * bw * Math.sqrt(2 * Math.PI))
  for (let i = 0; i < steps; i++) {
    const v = lo + ((hi - lo) * i) / (steps - 1)
    let s = 0
    for (const x of vs) {
      const z = (v - x) / bw
      s += Math.exp(-0.5 * z * z)
    }
    out.push({ v, d: s * norm })
  }
  return out
}

/* ---------- trend lines ---------- */

export interface Fit {
  /** coefficients, lowest power first */
  coef: number[]
  /** coefficient of determination */
  r2: number
  at: (x: number) => number
}

/** Least-squares polynomial fit by normal equations with Gaussian elimination.
 *
 *  Normal equations are numerically poor for high degrees — that is why the
 *  degree is clamped at 5. For the straight line and the gentle curve a figure
 *  actually wants, they are exact enough and need no matrix library. */
export function polyFit(xs: number[], ys: number[], degree = 1): Fit | null {
  const pts: [number, number][] = []
  for (let i = 0; i < Math.min(xs.length, ys.length); i++)
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pts.push([xs[i], ys[i]])
  const d = Math.max(1, Math.min(5, Math.round(degree)))
  if (pts.length < d + 1) return null

  const n = d + 1
  // centre x, or a fit over years like 2001..2024 loses every digit it has
  const x0 = mean(pts.map((p) => p[0]))
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0))
  const powers = pts.map((p) => {
    const u = p[0] - x0
    const row = [1]
    for (let k = 1; k <= 2 * d; k++) row.push(row[k - 1] * u)
    return row
  })
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++)
      A[r][c] = powers.reduce((s, row) => s + row[r + c], 0)
    A[r][n] = pts.reduce((s, p, i) => s + p[1] * powers[i][r], 0)
  }
  for (let i = 0; i < n; i++) {
    let piv = i
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r
    if (Math.abs(A[piv][i]) < 1e-12) return null
    ;[A[i], A[piv]] = [A[piv], A[i]]
    for (let r = 0; r < n; r++) {
      if (r === i) continue
      const f = A[r][i] / A[i][i]
      for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c]
    }
  }
  const coef = A.map((row, i) => row[n] / A[i][i])
  const at = (x: number) => {
    const u = x - x0
    let s = 0
    for (let k = coef.length - 1; k >= 0; k--) s = s * u + coef[k]
    return s
  }
  const ym = mean(pts.map((p) => p[1]))
  const ssTot = pts.reduce((s, p) => s + (p[1] - ym) ** 2, 0)
  const ssRes = pts.reduce((s, p) => s + (p[1] - at(p[0])) ** 2, 0)
  return { coef, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, at }
}
