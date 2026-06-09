import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { toBlob } from 'html-to-image'
import './CartesianPlotter.css'

/* ---------- model ---------- */

type BgKey = 'transparent' | 'cream' | 'white' | 'dark'

const CURVE_COLORS = [
  '#ff4eba',
  '#7828c8',
  '#00a3d9',
  '#ff9100',
  '#00b327',
  '#d6219b',
  '#0277b6',
]

const BGS: { key: BgKey; label: string; hex: string | null }[] = [
  { key: 'transparent', label: '투명', hex: null },
  { key: 'cream', label: '크림', hex: '#fff5d1' },
  { key: 'white', label: '흰색', hex: '#ffffff' },
  { key: 'dark', label: '어두움', hex: '#1e1e22' },
]

const SAMPLE = `y = x^2
y = sin(x)
(1.5, 2.25) A`

const STORE_KEY = 'fem.cartesian.v1'

interface Persisted {
  input: string
  xmin: number
  xmax: number
  ymin: number
  ymax: number
  autoY: boolean
  grid: boolean
  equalAspect: boolean
  thetaMaxPi: number // θ range is [0, thetaMaxPi·π] for polar curves
  figW: number
  figH: number
  bg: BgKey
}

const DEFAULTS: Persisted = {
  input: SAMPLE,
  xmin: -5,
  xmax: 5,
  ymin: -3,
  ymax: 6,
  autoY: true,
  grid: true,
  equalAspect: false,
  thetaMaxPi: 2,
  figW: 640,
  figH: 480,
  bg: 'transparent',
}

function loadState(): Persisted {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) }
  } catch {
    return DEFAULTS
  }
}

/* ---------- expression compiler ---------- */

const FN_NAMES = [
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
  'exp', 'log', 'ln', 'log10', 'sqrt', 'cbrt', 'abs', 'sign', 'floor',
  'ceil', 'round', 'min', 'max', 'pow', 'atan2',
]
const FN_IMPL: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min,
  max: Math.max, pow: Math.pow, atan2: Math.atan2,
}

function compile(expr: string, varName = 'x'): (v: number) => number {
  const body = expr.replace(/\^/g, '**')
  if (/[^0-9+\-*/().,\s a-zA-Z_]/.test(body))
    throw new Error('허용되지 않는 문자')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const f = new Function(
    varName,
    ...FN_NAMES,
    `"use strict";const pi=Math.PI,e=Math.E,tau=2*Math.PI;return (${body});`,
  ) as (v: number, ...fns: ((...a: number[]) => number)[]) => number
  const impls = FN_NAMES.map((n) => FN_IMPL[n])
  // a half-typed expression (e.g. "t" on the way to "theta") references an
  // unknown identifier and throws at call time — catch it and return NaN so the
  // sampler just skips it instead of crashing the render.
  return (v: number) => {
    try {
      const y = f(v, ...impls)
      return typeof y === 'number' ? y : NaN
    } catch {
      return NaN
    }
  }
}

/* ---------- parse plot items ---------- */

type Item =
  | { kind: 'fn'; expr: string; f: (x: number) => number; color: string }
  | { kind: 'polar'; expr: string; f: (theta: number) => number; color: string }
  | { kind: 'point'; x: number; y: number; label?: string; color: string }
  | { kind: 'error'; raw: string; msg: string }

const POLAR_RE = /^r\s*=\s*(.+)$/i
const FN_RE = /^(?:y|[a-zA-Z]\w*\s*\(\s*x\s*\))\s*=\s*(.+)$/
const PT_RE = /^\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?\s*(.*)$/

function parse(input: string): Item[] {
  const out: Item[] = []
  let ci = 0
  const next = () => CURVE_COLORS[ci++ % CURVE_COLORS.length]
  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    // polar: r = f(theta)
    const rm = POLAR_RE.exec(line)
    if (rm) {
      try {
        const f = compile(rm[1], 'theta')
        out.push({ kind: 'polar', expr: rm[1], f, color: next() })
      } catch (e) {
        out.push({ kind: 'error', raw: line, msg: e instanceof Error ? e.message : '식 오류' })
      }
      continue
    }
    const fm = FN_RE.exec(line)
    if (fm) {
      try {
        const f = compile(fm[1], 'x')
        out.push({ kind: 'fn', expr: fm[1], f, color: next() })
      } catch (e) {
        out.push({ kind: 'error', raw: line, msg: e instanceof Error ? e.message : '식 오류' })
      }
      continue
    }
    const pm = PT_RE.exec(line)
    if (pm) {
      const x = parseFloat(pm[1])
      const y = parseFloat(pm[2])
      const label = pm[3].replace(/^["']|["']$/g, '').trim() || undefined
      out.push({ kind: 'point', x, y, label, color: '#222' })
      continue
    }
    out.push({ kind: 'error', raw: line, msg: 'y = … · r = … · (x, y) 형식' })
  }
  return out
}

/* ---------- nice ticks ---------- */

function niceStep(range: number, target = 8): number {
  const rough = range / target
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / pow
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10
  return step * pow
}
function ticks(min: number, max: number): number[] {
  const step = niceStep(max - min)
  const out: number[] = []
  const start = Math.ceil(min / step) * step
  for (let v = start; v <= max + step * 1e-6; v += step) {
    out.push(Math.abs(v) < step * 1e-6 ? 0 : +v.toFixed(6))
  }
  return out
}

/* ---------- numeric field (free typing, commit on blur) ---------- */

function NumField({
  value,
  onCommit,
  width = '5ch',
}: {
  value: number
  onCommit: (n: number) => void
  width?: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <input
      className="cp-num"
      type="text"
      inputMode="decimal"
      style={{ width }}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = parseFloat(text)
        if (Number.isFinite(n)) onCommit(n)
        else setText(String(value))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

/* ---------- app ---------- */

export default function CartesianPlotterTool() {
  const initial = useMemo(loadState, [])
  const [input, setInput] = useState(initial.input)
  const [xmin, setXmin] = useState(initial.xmin)
  const [xmax, setXmax] = useState(initial.xmax)
  const [ymin, setYmin] = useState(initial.ymin)
  const [ymax, setYmax] = useState(initial.ymax)
  const [autoY, setAutoY] = useState(initial.autoY)
  const [grid, setGrid] = useState(initial.grid)
  const [equalAspect, setEqualAspect] = useState(initial.equalAspect)
  const [thetaMaxPi, setThetaMaxPi] = useState(initial.thetaMaxPi)
  const [figW, setFigW] = useState(initial.figW)
  const [figH, setFigH] = useState(initial.figH)
  const [bg, setBg] = useState<BgKey>(initial.bg)

  const [scale, setScale] = useState(1)
  const [nat, setNat] = useState({ w: 0, h: 0 })
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const items = useMemo(() => parse(input), [input])
  const bgHex = BGS.find((b) => b.key === bg)?.hex ?? null
  const hasPolar = items.some((i) => i.kind === 'polar')
  const thMax = thetaMaxPi * Math.PI

  // turn equal aspect on when a polar curve first appears (so circles are round);
  // the user can still toggle it off afterwards.
  useEffect(() => {
    if (hasPolar) setEqualAspect(true)
  }, [hasPolar])

  /* persist */
  useEffect(() => {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ input, xmin, xmax, ymin, ymax, autoY, grid, equalAspect, thetaMaxPi, figW, figH, bg }),
      )
    } catch {
      /* ignore */
    }
  }, [input, xmin, xmax, ymin, ymax, autoY, grid, equalAspect, thetaMaxPi, figW, figH, bg])

  /* editor auto-grow */
  useLayoutEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(180, ta.scrollHeight)}px`
  }, [input])

  const PAD = 52
  // user-requested X range (used to evaluate content; the *view* range below may
  // be widened by equal aspect)
  const uxlo = Math.min(xmin, xmax)
  const uxhi = Math.max(xmin, xmax) === uxlo ? uxlo + 1 : Math.max(xmin, xmax)

  // base y-range (auto from samples, or manual) before equal-aspect adjustment
  const [baseLo, baseHi] = useMemo(() => {
    if (!autoY) {
      const a = Math.min(ymin, ymax)
      const b = Math.max(ymin, ymax)
      return [a, b === a ? a + 1 : b] as const
    }
    let lo = Infinity
    let hi = -Infinity
    const N = 240
    for (const it of items) {
      if (it.kind === 'fn') {
        for (let i = 0; i <= N; i++) {
          const x = uxlo + ((uxhi - uxlo) * i) / N
          const y = it.f(x)
          if (Number.isFinite(y)) {
            lo = Math.min(lo, y)
            hi = Math.max(hi, y)
          }
        }
      } else if (it.kind === 'polar') {
        for (let i = 0; i <= N; i++) {
          const th = (thMax * i) / N
          const r = it.f(th)
          if (Number.isFinite(r)) {
            const y = r * Math.sin(th)
            lo = Math.min(lo, y)
            hi = Math.max(hi, y)
          }
        }
      } else if (it.kind === 'point') {
        lo = Math.min(lo, it.y)
        hi = Math.max(hi, it.y)
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-6, 6] as const
    if (hi - lo < 1e-6) {
      lo -= 1
      hi += 1
    }
    const pad = (hi - lo) * 0.12
    return [lo - pad, hi + pad] as const
  }, [autoY, ymin, ymax, items, uxlo, uxhi, thMax])

  // view range. with equal aspect (auto-on for polar) we keep the same pixels-
  // per-unit on both axes by fitting BOTH content ranges at a common scale —
  // whichever axis has slack is widened, so nothing gets cropped.
  const eqAspect = equalAspect
  let xlo = uxlo
  let xhi = uxhi
  let ylo = baseLo
  let yhi = baseHi
  if (eqAspect) {
    const pw = figW - 2 * PAD
    const ph = figH - 2 * PAD
    const xs = uxhi - uxlo
    const ys = baseHi - baseLo || 1
    const s = Math.min(pw / xs, ph / ys) // common px/unit that fits both
    const xc = (uxlo + uxhi) / 2
    const yc = (baseLo + baseHi) / 2
    const hx = pw / s / 2
    const hy = ph / s / 2
    xlo = xc - hx
    xhi = xc + hx
    ylo = yc - hy
    yhi = yc + hy
  }

  const sx = (x: number) => PAD + ((x - xlo) / (xhi - xlo)) * (figW - 2 * PAD)
  const sy = (y: number) => figH - PAD - ((y - ylo) / (yhi - ylo)) * (figH - 2 * PAD)

  // build a polyline path for a function, breaking on non-finite / big jumps
  const curvePath = (f: (x: number) => number): string => {
    const N = Math.max(200, figW)
    let d = ''
    let prevY: number | null = null
    let pen = false
    for (let i = 0; i <= N; i++) {
      const x = xlo + ((xhi - xlo) * i) / N
      const y = f(x)
      if (!Number.isFinite(y) || y < ylo - (yhi - ylo) * 4 || y > yhi + (yhi - ylo) * 4) {
        pen = false
        prevY = null
        continue
      }
      // break on a huge jump (likely an asymptote)
      if (prevY !== null && Math.abs(y - prevY) > (yhi - ylo) * 1.2) {
        pen = false
      }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(2)} ${sy(y).toFixed(2)} `
      pen = true
      prevY = y
    }
    return d.trim()
  }

  // polar curve: sample θ over [0, thMax], map (r·cosθ, r·sinθ) into the plane
  const polarPath = (f: (theta: number) => number): string => {
    const N = 720
    let d = ''
    let pen = false
    for (let i = 0; i <= N; i++) {
      const th = (thMax * i) / N
      const r = f(th)
      if (!Number.isFinite(r)) {
        pen = false
        continue
      }
      const x = r * Math.cos(th)
      const y = r * Math.sin(th)
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(2)} ${sy(y).toFixed(2)} `
      pen = true
    }
    return d.trim()
  }

  const inXY = (x: number, y: number) =>
    x >= xlo && x <= xhi && y >= ylo && y <= yhi
  const x0 = sx(0)
  const y0 = sy(0)
  const axisColor = bg === 'dark' ? '#f4f4f4' : '#222'
  const gridColor = bg === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'
  const labelColor = bg === 'dark' ? '#cfcfd6' : '#555'

  /* preview scale */
  const recompute = useCallback(() => {
    const stage = stageRef.current
    const shot = shotRef.current
    if (!stage || !shot) return
    const cs = getComputedStyle(stage)
    const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    const w = shot.offsetWidth
    const h = shot.offsetHeight
    if (!w || !h) return
    const s = Math.max(0.05, Math.min(1, aw / w, ah / h))
    setNat((p) => (p.w !== w || p.h !== h ? { w, h } : p))
    setScale((p) => (Math.abs(p - s) > 0.001 ? s : p))
  }, [])
  useLayoutEffect(() => {
    recompute()
  }, [recompute, figW, figH, bg])
  useEffect(() => {
    const stage = stageRef.current
    const shot = shotRef.current
    if (!stage || !shot) return
    const ro = new ResizeObserver(recompute)
    ro.observe(stage)
    ro.observe(shot)
    return () => ro.disconnect()
  }, [recompute])

  const flash = (m: string) => {
    setToast(m)
    window.setTimeout(() => setToast(null), 1800)
  }

  const makeBlob = useCallback(async () => {
    const node = shotRef.current
    if (!node) return null
    return toBlob(node, {
      pixelRatio: 3,
      skipFonts: true,
      width: node.offsetWidth,
      height: node.offsetHeight,
      style: { transform: 'none', transformOrigin: 'top left' },
    })
  }, [])

  const withExport = async (run: (b: Blob) => void | Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      const b = await makeBlob()
      if (!b) {
        flash('이미지를 만들지 못했습니다')
        return
      }
      await run(b)
    } catch {
      flash('내보내기 실패')
    } finally {
      setBusy(false)
    }
  }
  const savePng = () =>
    withExport((b) => {
      const url = URL.createObjectURL(b)
      const a = document.createElement('a')
      a.href = url
      a.download = 'plot.png'
      a.click()
      URL.revokeObjectURL(url)
      flash('PNG로 저장했습니다')
    })
  const copyPng = () =>
    withExport(async (b) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
        flash('클립보드에 복사했습니다')
      } catch {
        flash('복사 실패 — 저장을 이용하세요')
      }
    })

  const xt = ticks(xlo, xhi)
  const yt = ticks(ylo, yhi)
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(2)))

  return (
    <div className="app">
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          Cartesian Plotter
        </Text>

        <div className="toolbar__group">
          <span className="toolbar__label">X</span>
          <NumField value={xmin} onCommit={setXmin} />
          <span className="cp-tilde">~</span>
          <NumField value={xmax} onCommit={setXmax} />
        </div>

        <div className="toolbar__group">
          <Button
            variant={autoY ? 'primary' : 'neutral'}
            size="sm"
            onClick={() => setAutoY((v) => !v)}
          >
            Y 자동
          </Button>
          {!autoY && (
            <>
              <NumField value={ymin} onCommit={setYmin} />
              <span className="cp-tilde">~</span>
              <NumField value={ymax} onCommit={setYmax} />
            </>
          )}
        </div>

        <Button
          variant={grid ? 'secondary' : 'neutral'}
          size="sm"
          onClick={() => setGrid((v) => !v)}
        >
          격자 {grid ? '켜짐' : '꺼짐'}
        </Button>

        <Button
          variant={eqAspect ? 'secondary' : 'neutral'}
          size="sm"
          onClick={() => setEqualAspect((v) => !v)}
        >
          등축 {eqAspect ? '켜짐' : '꺼짐'}
        </Button>

        {hasPolar && (
          <div className="toolbar__group">
            <span className="toolbar__label">θ</span>
            <span className="cp-theta">0 ~</span>
            <NumField value={thetaMaxPi} onCommit={(n) => setThetaMaxPi(Math.max(0.25, n))} width="4ch" />
            <span className="cp-theta">π</span>
          </div>
        )}

        <div className="toolbar__group">
          <span className="toolbar__label">크기</span>
          <NumField value={figW} onCommit={(n) => setFigW(Math.max(240, n))} />
          <span className="cp-tilde">×</span>
          <NumField value={figH} onCommit={(n) => setFigH(Math.max(180, n))} />
        </div>

        <div className="toolbar__group">
          <span className="toolbar__label">배경</span>
          {BGS.map((b) => (
            <Button
              key={b.key}
              variant={bg === b.key ? 'secondary' : 'neutral'}
              size="sm"
              onClick={() => setBg(b.key)}
            >
              {b.label}
            </Button>
          ))}
        </div>

        <div className="toolbar__spacer" />

        <Button variant="success" size="sm" onClick={savePng} disabled={busy}>
          PNG 저장
        </Button>
        <Button variant="info" size="sm" onClick={copyPng} disabled={busy}>
          복사
        </Button>
      </div>

      <div className="stage" ref={stageRef}>
        <div
          className="fitbox"
          style={nat.w ? { width: nat.w * scale, height: nat.h * scale } : undefined}
        >
          <div
            className="shot"
            ref={shotRef}
            style={{
              transform: `scale(${scale})`,
              ...(bgHex ? { background: bgHex } : null),
            }}
          >
            <svg
              className="plot"
              width={figW}
              height={figH}
              viewBox={`0 0 ${figW} ${figH}`}
            >
              <defs>
                <marker
                  id="cp-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0 L10 5 L0 10 z" fill={axisColor} />
                </marker>
              </defs>

              {/* grid */}
              {grid && (
                <g>
                  {xt.map((t, i) => (
                    <line
                      key={`gx${i}`}
                      x1={sx(t)}
                      y1={PAD}
                      x2={sx(t)}
                      y2={figH - PAD}
                      stroke={gridColor}
                      strokeWidth={1}
                    />
                  ))}
                  {yt.map((t, i) => (
                    <line
                      key={`gy${i}`}
                      x1={PAD}
                      y1={sy(t)}
                      x2={figW - PAD}
                      y2={sy(t)}
                      stroke={gridColor}
                      strokeWidth={1}
                    />
                  ))}
                </g>
              )}

              {/* axes (drawn at 0 if visible, else along the edge) */}
              <g>
                <line
                  x1={PAD}
                  y1={ylo <= 0 && yhi >= 0 ? y0 : figH - PAD}
                  x2={figW - PAD}
                  y2={ylo <= 0 && yhi >= 0 ? y0 : figH - PAD}
                  stroke={axisColor}
                  strokeWidth={2.5}
                  markerEnd="url(#cp-arrow)"
                />
                <line
                  x1={xlo <= 0 && xhi >= 0 ? x0 : PAD}
                  y1={figH - PAD}
                  x2={xlo <= 0 && xhi >= 0 ? x0 : PAD}
                  y2={PAD}
                  stroke={axisColor}
                  strokeWidth={2.5}
                  markerEnd="url(#cp-arrow)"
                />
              </g>

              {/* tick labels */}
              <g fontSize={13} fill={labelColor} fontFamily="var(--mono)">
                {xt.map((t, i) =>
                  t === 0 ? null : (
                    <text
                      key={`tx${i}`}
                      x={sx(t)}
                      y={(ylo <= 0 && yhi >= 0 ? y0 : figH - PAD) + 16}
                      textAnchor="middle"
                    >
                      {fmt(t)}
                    </text>
                  ),
                )}
                {yt.map((t, i) =>
                  t === 0 ? null : (
                    <text
                      key={`ty${i}`}
                      x={(xlo <= 0 && xhi >= 0 ? x0 : PAD) - 8}
                      y={sy(t) + 4}
                      textAnchor="end"
                    >
                      {fmt(t)}
                    </text>
                  ),
                )}
                {xlo <= 0 && xhi >= 0 && ylo <= 0 && yhi >= 0 && (
                  <text x={x0 - 8} y={y0 + 16} textAnchor="end">
                    0
                  </text>
                )}
              </g>

              {/* curves (cartesian + polar) */}
              {items.map((it, i) =>
                it.kind === 'fn' || it.kind === 'polar' ? (
                  <path
                    key={i}
                    d={it.kind === 'fn' ? curvePath(it.f) : polarPath(it.f)}
                    fill="none"
                    stroke={it.color}
                    strokeWidth={2.6}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ) : null,
              )}

              {/* points */}
              {items.map((it, i) =>
                it.kind === 'point' && inXY(it.x, it.y) ? (
                  <g key={`p${i}`}>
                    <circle
                      cx={sx(it.x)}
                      cy={sy(it.y)}
                      r={5}
                      fill={bg === 'dark' ? '#fff' : '#222'}
                      stroke={bg === 'dark' ? '#222' : '#fff'}
                      strokeWidth={2}
                    />
                    {it.label && (
                      <text
                        x={sx(it.x) + 9}
                        y={sy(it.y) - 8}
                        fontSize={15}
                        fontWeight={700}
                        fill={axisColor}
                        fontFamily="var(--mono)"
                      >
                        {it.label}
                      </text>
                    )}
                  </g>
                ) : null,
              )}
            </svg>
          </div>
        </div>
      </div>

      <div className="editor">
        <span className="editor__prompt">y=</span>
        <textarea
          ref={inputRef}
          className="editor__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'한 줄에 하나 — y = x^2 / f(x) = sin(x) / (1, 2) 라벨'}
          spellCheck={false}
          rows={1}
          aria-label="그래프 입력"
        />
      </div>

      <Text variant="chrome" muted className="hint">
        y = f(x) · 극좌표 r = f(theta) (등축 자동) · 점 (x, y) 라벨 · ^ 거듭제곱,
        sin·cos·sqrt·pi 등 · 곱셈은 2*x 처럼 명시 · 투명 PNG로 저장 / 복사
      </Text>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
