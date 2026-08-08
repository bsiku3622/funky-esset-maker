import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Icon, Text } from '@studio-baeks/funky-ui'
import { MathfieldElement } from 'mathlive'
import 'mathlive'
import { useFitScale, usePersist, usePngExport, useStored } from './hooks'
import SharedNumField from './NumField'
import './CartesianPlotter.css'

// CDN에서 폰트 로드 (Vite가 node_modules 폰트를 자동 서빙하지 않음)
MathfieldElement.fontsDirectory =
  'https://cdn.jsdelivr.net/npm/mathlive@0.110.0/fonts/'
MathfieldElement.soundsDirectory = null

// math-field 웹 컴포넌트 JSX 타입 (React 19부터 JSX 네임스페이스가 React.JSX로 이동).
// IntrinsicElements를 넓히는 방법은 이 namespace 확장뿐이라 규칙을 끕니다.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.HTMLAttributes<MathfieldElement> & {
        ref?: React.Ref<MathfieldElement>
        placeholder?: string
        'virtual-keyboard-mode'?: string
        'smart-mode'?: string
      }
    }
  }
}

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

interface GraphEntry {
  id: string
  /** MathLive LaTeX 형식으로 저장 */
  expr: string
  enabled: boolean
  color: string
}

// 초기 샘플 — LaTeX 형식
const SAMPLE_GRAPHS: GraphEntry[] = [
  { id: 's1', expr: 'y=x^{2}', enabled: true, color: CURVE_COLORS[0] },
  { id: 's2', expr: 'y=\\sin\\left(x\\right)', enabled: true, color: CURVE_COLORS[1] },
  { id: 's3', expr: '\\left(1.5,\\ 2.25\\right)\\ A', enabled: true, color: '#222' },
]

const STORE_KEY = 'fem.cartesian.v3'

interface Persisted {
  graphs: GraphEntry[]
  xmin: number
  xmax: number
  ymin: number
  ymax: number
  autoY: boolean
  grid: boolean
  equalAspect: boolean
  thetaMaxPi: number
  figW: number
  figH: number
  bg: BgKey
}

const DEFAULTS: Persisted = {
  graphs: SAMPLE_GRAPHS,
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

/* ---------- LaTeX → JS expression ---------- */

function latexToExpr(latex: string): string {
  return latex
    // LaTeX 공백 문자 제거
    .replace(/\\[,;:! ]/g, ' ')
    // \left( \right) → 일반 괄호
    .replace(/\\left\(/g, '(')
    .replace(/\\right\)/g, ')')
    .replace(/\\left\[/g, '(')
    .replace(/\\right\]/g, ')')
    .replace(/\\left\{/g, '(')
    .replace(/\\right\}/g, ')')
    .replace(/\\left\|/g, 'abs(')
    .replace(/\\right\|/g, ')')
    // 삼각함수
    .replace(/\\arcsin\b/g, 'asin')
    .replace(/\\arccos\b/g, 'acos')
    .replace(/\\arctan\b/g, 'atan')
    .replace(/\\sin\b/g, 'sin')
    .replace(/\\cos\b/g, 'cos')
    .replace(/\\tan\b/g, 'tan')
    .replace(/\\sinh\b/g, 'sinh')
    .replace(/\\cosh\b/g, 'cosh')
    .replace(/\\tanh\b/g, 'tanh')
    .replace(/\\ln\b/g, 'ln')
    .replace(/\\log\b/g, 'log')
    .replace(/\\exp\b/g, 'exp')
    // 지수의 {} → () — frac/sqrt 보다 먼저 처리해야 중첩 지수가 올바르게 변환됨
    // 예: \frac{x^{2}}{4} → \frac{x^(2)}{4} → (x^(2))/(4)
    .replace(/\^{([^{}]*)}/g, '^($1)')
    // sqrt: \sqrt{expr} → sqrt(expr)
    .replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)')
    .replace(/\\sqrt\b/g, 'sqrt')
    // 분수: \frac{a}{b} → (a)/(b)  (단순 1-level만)
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    // 상수
    .replace(/\\pi\b/g, 'pi')
    .replace(/\\theta\b/g, 'theta')
    .replace(/\\tau\b/g, 'tau')
    .replace(/\\infty\b/g, 'Infinity')
    .replace(/\\e\b/g, 'e')
    // 연산자
    .replace(/\\cdot\b/g, '*')
    .replace(/\\times\b/g, '*')
    .replace(/\\div\b/g, '/')
    // 나머지 LaTeX 커맨드 제거
    .replace(/\\[a-zA-Z]+/g, '')
    // 남은 {} → ()
    .replace(/\{/g, '(').replace(/\}/g, ')')
    // 공백 정리
    .replace(/\s+/g, ' ')
    .trim()
}

/* ---------- implicit multiplication ---------- */

function preprocess(expr: string): string {
  return expr
    .replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2')   // 4x → 4*x, 4( → 4*(
    .replace(/([xy])\s*([xy])/g, '$1*$2')        // xy → x*y, yx → y*x
    .replace(/\)\s*\(/g, ')*(')
    .replace(/\)\s*([a-zA-Z])/g, ')*$1')
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

function compile2d(expr: string): (x: number, y: number) => number {
  const body = preprocess(expr).replace(/\^/g, '**')
  if (/[^0-9+\-*/().,\s a-zA-Z_]/.test(body))
    throw new Error('허용되지 않는 문자')
  // new Function은 위 화이트리스트를 통과한 문자만 받습니다 — 식별자·숫자·연산자뿐이라
  // 문자열 리터럴도 프로퍼티 접근도 만들 수 없습니다
  const f = new Function(
    'x', 'y',
    ...FN_NAMES,
    `"use strict";const pi=Math.PI,e=Math.E,tau=2*Math.PI;return (${body});`,
  ) as (x: number, y: number, ...fns: ((...a: number[]) => number)[]) => number
  const impls = FN_NAMES.map((n) => FN_IMPL[n])
  return (x: number, y: number) => {
    try {
      const v = f(x, y, ...impls)
      return typeof v === 'number' ? v : NaN
    } catch {
      return NaN
    }
  }
}

function compile(expr: string, varName = 'x'): (v: number) => number {
  const body = preprocess(expr).replace(/\^/g, '**')
  if (/[^0-9+\-*/().,\s a-zA-Z_]/.test(body))
    throw new Error('허용되지 않는 문자')
  // 위 compile2d와 같은 화이트리스트 검증을 거친 뒤에만 도달합니다
  const f = new Function(
    varName,
    ...FN_NAMES,
    `"use strict";const pi=Math.PI,e=Math.E,tau=2*Math.PI;return (${body});`,
  ) as (v: number, ...fns: ((...a: number[]) => number)[]) => number
  const impls = FN_NAMES.map((n) => FN_IMPL[n])
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
  | { kind: 'implicit'; expr: string; f: (x: number, y: number) => number; color: string }
  | { kind: 'point'; x: number; y: number; label?: string; color: string }
  | { kind: 'error'; raw: string; msg: string }

const POLAR_RE = /^r\s*=\s*(.+)$/i
const FN_RE = /^(?:y|[a-zA-Z]\w*\s*\(\s*x\s*\))\s*=\s*(.+)$/
const PT_RE = /^\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?\s*(.*)$/

function parseSingleLine(line: string, color: string): Item | null {
  if (!line || line.startsWith('#')) return null

  const rm = POLAR_RE.exec(line)
  if (rm) {
    try {
      return { kind: 'polar', expr: rm[1], f: compile(rm[1], 'theta'), color }
    } catch (e) {
      return { kind: 'error', raw: line, msg: e instanceof Error ? e.message : '식 오류' }
    }
  }

  const fm = FN_RE.exec(line)
  if (fm) {
    try {
      return { kind: 'fn', expr: fm[1], f: compile(fm[1], 'x'), color }
    } catch (e) {
      return { kind: 'error', raw: line, msg: e instanceof Error ? e.message : '식 오류' }
    }
  }

  const pm = PT_RE.exec(line)
  if (pm) {
    const x = parseFloat(pm[1])
    const y = parseFloat(pm[2])
    const label = pm[3].replace(/^["']|["']$/g, '').trim() || undefined
    return { kind: 'point', x, y, label, color }
  }

  // 음함수: = 을 포함하는 임의 식 — lhs = rhs → lhs - rhs = 0 으로 변환
  const eqIdx = line.indexOf('=')
  if (eqIdx >= 0) {
    const lhs = line.slice(0, eqIdx).trim()
    const rhs = line.slice(eqIdx + 1).trim()
    try {
      const f = compile2d(`(${lhs})-(${rhs})`)
      return { kind: 'implicit', expr: line, f, color }
    } catch (e) {
      return { kind: 'error', raw: line, msg: e instanceof Error ? e.message : '식 오류' }
    }
  }

  return { kind: 'error', raw: line, msg: 'y = … · r = … · x²+y²=r² · (x, y) 형식으로 입력' }
}

function parseGraphs(graphs: GraphEntry[]): Item[] {
  const out: Item[] = []
  for (const g of graphs) {
    if (!g.enabled) continue
    const expr = latexToExpr(g.expr).trim()
    const item = parseSingleLine(expr, g.color)
    if (item) out.push(item)
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

/* ---------- numeric field ---------- */

const NumField = (props: {
  value: number
  onCommit: (n: number) => void
  width?: string
}) => <SharedNumField width="5ch" {...props} className="cp-num" />

/* ---------- icons ---------- */

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14H6L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4h6v2"/>
    </svg>
  )
}

/* ---------- GraphRow ---------- */

function GraphRow({
  entry,
  onChange,
  onDelete,
}: {
  entry: GraphEntry
  onChange: (updated: GraphEntry) => void
  onDelete: () => void
}) {
  const mathfieldRef = useRef<MathfieldElement>(null)

  // stale-closure 방지: 최신 entry/onChange를 ref로 유지
  const entryRef = useRef(entry)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    entryRef.current = entry
    onChangeRef.current = onChange
  })

  // mount: 초기값 설정 + input 이벤트 등록
  useEffect(() => {
    const el = mathfieldRef.current
    if (!el) return
    el.value = entry.expr
    const handler = () => {
      onChangeRef.current({ ...entryRef.current, expr: el.value })
    }
    el.addEventListener('input', handler)
    return () => el.removeEventListener('input', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 외부(예: 다른 곳에서 setGraphs)에서 expr이 바뀌면 MathLive에 반영
  useEffect(() => {
    const el = mathfieldRef.current
    if (el && el.value !== entry.expr) el.value = entry.expr
  }, [entry.expr])

  const cycleColor = () => {
    const idx = CURVE_COLORS.indexOf(entry.color)
    const next = CURVE_COLORS[(idx + 1) % CURVE_COLORS.length]
    onChange({ ...entry, color: next })
  }

  return (
    <div className={`graph-row${entry.enabled ? '' : ' graph-row--dim'}`}>
      <input
        type="checkbox"
        className="graph-row__check"
        checked={entry.enabled}
        onChange={(e) => onChange({ ...entry, enabled: e.target.checked })}
        aria-label="그래프 활성화"
      />
      <button
        className="graph-row__color funky-pressable"
        style={{ background: entry.color }}
        onClick={cycleColor}
        title="색상 변경"
        aria-label="색상 변경"
      />
      <math-field
        ref={mathfieldRef as React.Ref<MathfieldElement>}
        className="graph-row__mathfield"
        placeholder="y = x^2"
        virtual-keyboard-mode="off"
      />
      <Button
        variant="neutral"
        size="sm"
        onClick={() => onChange({ ...entry, enabled: !entry.enabled })}
        aria-label={entry.enabled ? '숨기기' : '표시'}
      >
        <Icon size={15}><EyeIcon open={entry.enabled} /></Icon>
      </Button>
      <Button
        variant="neutral"
        size="sm"
        onClick={onDelete}
        aria-label="삭제"
      >
        <Icon size={14}><TrashIcon /></Icon>
      </Button>
    </div>
  )
}

/* ---------- app ---------- */

export default function CartesianPlotterTool() {
  const initial = useStored(STORE_KEY, DEFAULTS)
  const [graphs, setGraphs] = useState<GraphEntry[]>(initial.graphs)
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

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)

  const items = useMemo(() => parseGraphs(graphs), [graphs])
  const bgHex = BGS.find((b) => b.key === bg)?.hex ?? null
  const hasPolar = items.some((i) => i.kind === 'polar')
  const thMax = thetaMaxPi * Math.PI

  // A polar curve drawn on unequal axes is the wrong shape — a circle comes out
  // an ellipse — so adding one forces equal aspect. Derived during render
  // rather than in an effect so the very first frame is already correct.
  const lockAspect = equalAspect || hasPolar

  usePersist(STORE_KEY, {
    graphs,
    xmin,
    xmax,
    ymin,
    ymax,
    autoY,
    grid,
    equalAspect,
    thetaMaxPi,
    figW,
    figH,
    bg,
  })

  const PAD = 52
  const uxlo = Math.min(xmin, xmax)
  const uxhi = Math.max(xmin, xmax) === uxlo ? uxlo + 1 : Math.max(xmin, xmax)

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
          if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y) }
        }
      } else if (it.kind === 'polar') {
        for (let i = 0; i <= N; i++) {
          const th = (thMax * i) / N
          const r = it.f(th)
          if (Number.isFinite(r)) {
            const y = r * Math.sin(th)
            lo = Math.min(lo, y); hi = Math.max(hi, y)
          }
        }
      } else if (it.kind === 'point') {
        lo = Math.min(lo, it.y); hi = Math.max(hi, it.y)
      } else if (it.kind === 'implicit') {
        // x를 격자로 고정한 뒤 y 방향으로 부호 변화 스캔
        const NX = 40, NY = 120
        const yScan = Math.min(30, uxhi - uxlo)
        for (let ix = 0; ix <= NX; ix++) {
          const x = uxlo + ((uxhi - uxlo) * ix) / NX
          let prev = it.f(x, -yScan)
          for (let iy = 1; iy <= NY; iy++) {
            const y = -yScan + (2 * yScan * iy) / NY
            const cur = it.f(x, y)
            if (Number.isFinite(cur) && Number.isFinite(prev) && prev * cur < 0) {
              lo = Math.min(lo, y); hi = Math.max(hi, y)
            }
            prev = cur
          }
        }
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-6, 6] as const
    if (hi - lo < 1e-6) { lo -= 1; hi += 1 }
    const pad = (hi - lo) * 0.12
    return [lo - pad, hi + pad] as const
  }, [autoY, ymin, ymax, items, uxlo, uxhi, thMax])

  const xlo = uxlo
  const xhi = uxhi
  let ylo = baseLo
  let yhi = baseHi
  if (lockAspect) {
    const pw = figW - 2 * PAD
    const ph = figH - 2 * PAD
    const xs = uxhi - uxlo
    const s = pw / xs  // x 범위를 기준 스케일로 고정 — x가 늘어나지 않음
    const yc = (baseLo + baseHi) / 2
    ylo = yc - ph / s / 2
    yhi = yc + ph / s / 2
    // xlo, xhi는 uxlo/uxhi 그대로 유지
  }

  const sx = (x: number) => PAD + ((x - xlo) / (xhi - xlo)) * (figW - 2 * PAD)
  const sy = (y: number) => figH - PAD - ((y - ylo) / (yhi - ylo)) * (figH - 2 * PAD)

  const curvePath = (f: (x: number) => number): string => {
    const N = Math.max(200, figW)
    let d = ''
    let prevY: number | null = null
    let pen = false
    for (let i = 0; i <= N; i++) {
      const x = xlo + ((xhi - xlo) * i) / N
      const y = f(x)
      if (!Number.isFinite(y) || y < ylo - (yhi - ylo) * 4 || y > yhi + (yhi - ylo) * 4) {
        pen = false; prevY = null; continue
      }
      if (prevY !== null && Math.abs(y - prevY) > (yhi - ylo) * 1.2) pen = false
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(2)} ${sy(y).toFixed(2)} `
      pen = true; prevY = y
    }
    return d.trim()
  }

  const polarPath = (f: (theta: number) => number): string => {
    const N = 720
    let d = ''
    let pen = false
    for (let i = 0; i <= N; i++) {
      const th = (thMax * i) / N
      const r = f(th)
      if (!Number.isFinite(r)) { pen = false; continue }
      const x = r * Math.cos(th); const y = r * Math.sin(th)
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(2)} ${sy(y).toFixed(2)} `
      pen = true
    }
    return d.trim()
  }

  const implicitPath = (f: (x: number, y: number) => number): string => {
    const nx = Math.min(400, Math.ceil(figW * 0.44))
    // y 범위가 넓을수록 세밀한 격자 필요 (aliasing 방지)
    const ny = Math.min(600, Math.max(Math.ceil(figH * 0.44), Math.ceil((yhi - ylo) * 18)))
    const dx = (xhi - xlo) / nx
    const dy = (yhi - ylo) / ny

    const w = nx + 1
    const grid = new Float64Array((ny + 1) * w)
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++)
        grid[j * w + i] = f(xlo + i * dx, ylo + j * dy)

    const lerpC = (v0: number, v1: number, c0: number, c1: number) =>
      c0 + (c1 - c0) * (-v0) / (v1 - v0)

    let d = ''

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v00 = grid[j * w + i]
        const v10 = grid[j * w + i + 1]
        const v01 = grid[(j + 1) * w + i]
        const v11 = grid[(j + 1) * w + i + 1]

        if (!Number.isFinite(v00) || !Number.isFinite(v10) ||
            !Number.isFinite(v01) || !Number.isFinite(v11)) continue

        const x0 = xlo + i * dx, x1 = x0 + dx
        const y0 = ylo + j * dy, y1 = y0 + dy

        type Pt = [number, number]
        const pts: Pt[] = []
        if (v00 * v10 < 0) pts.push([lerpC(v00, v10, x0, x1), y0])
        if (v10 * v11 < 0) pts.push([x1, lerpC(v10, v11, y0, y1)])
        if (v01 * v11 < 0) pts.push([lerpC(v01, v11, x0, x1), y1])
        if (v00 * v01 < 0) pts.push([x0, lerpC(v00, v01, y0, y1)])

        const seg = (a: Pt, b: Pt) =>
          `M${sx(a[0]).toFixed(1)} ${sy(a[1]).toFixed(1)}L${sx(b[0]).toFixed(1)} ${sy(b[1]).toFixed(1)}`

        if (pts.length === 2) {
          d += seg(pts[0], pts[1])
        } else if (pts.length === 4) {
          // 안장점(saddle) 처리: 중심값 부호로 연결 방향 결정
          const vc = f((x0 + x1) / 2, (y0 + y1) / 2)
          if ((vc > 0) !== (v00 > 0)) {
            d += seg(pts[0], pts[1]); d += seg(pts[3], pts[2])
          } else {
            d += seg(pts[0], pts[3]); d += seg(pts[1], pts[2])
          }
        }
      }
    }

    return d
  }

  const inXY = (x: number, y: number) => x >= xlo && x <= xhi && y >= ylo && y <= yhi
  const x0 = sx(0); const y0 = sy(0)
  const axisColor = bg === 'dark' ? '#f4f4f4' : '#222'
  const gridColor = bg === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'
  const labelColor = bg === 'dark' ? '#cfcfd6' : '#555'

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    signature: `${figW}|${figH}|${bg}`,
  })

  const { savePng, copyPng, busy, toast } = usePngExport({
    shotRef,
    filename: 'plot',
  })

  const addGraph = () => {
    const nextColor = CURVE_COLORS[graphs.length % CURVE_COLORS.length]
    setGraphs((prev) => [
      ...prev,
      { id: crypto.randomUUID(), expr: '', enabled: true, color: nextColor },
    ])
  }

  const updateGraph = (id: string, updated: GraphEntry) =>
    setGraphs((prev) => prev.map((g) => (g.id === id ? updated : g)))

  const deleteGraph = (id: string) =>
    setGraphs((prev) => prev.filter((g) => g.id !== id))

  const xt = ticks(xlo, xhi)
  const yt = ticks(ylo, yhi)
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(2)))

  const errors = items.filter((it): it is Extract<Item, { kind: 'error' }> => it.kind === 'error')

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
          <Button variant={autoY ? 'primary' : 'neutral'} size="sm" onClick={() => setAutoY((v) => !v)}>
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

        <Button variant={grid ? 'secondary' : 'neutral'} size="sm" onClick={() => setGrid((v) => !v)}>
          격자 {grid ? '켜짐' : '꺼짐'}
        </Button>

        <Button
          variant={lockAspect ? 'secondary' : 'neutral'}
          size="sm"
          disabled={hasPolar}
          title={hasPolar ? '극좌표 그래프는 등축이 아니면 모양이 찌그러집니다' : undefined}
          onClick={() => setEqualAspect((v) => !v)}
        >
          등축 {lockAspect ? '켜짐' : '꺼짐'}
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
            <Button key={b.key} variant={bg === b.key ? 'secondary' : 'neutral'} size="sm" onClick={() => setBg(b.key)}>
              {b.label}
            </Button>
          ))}
        </div>

        <div className="toolbar__spacer" />

        <Button variant="success" size="sm" onClick={savePng} disabled={busy}>PNG 저장</Button>
        <Button variant="info" size="sm" onClick={copyPng} disabled={busy}>복사</Button>
      </div>

      <div className="stage" ref={stageRef}>
        <div className="fitbox" style={nat.w ? { width: nat.w * scale, height: nat.h * scale } : undefined}>
          <div className="shot" ref={shotRef} style={{ transform: `scale(${scale})`, ...(bgHex ? { background: bgHex } : null) }}>
            <svg className="plot" width={figW} height={figH} viewBox={`0 0 ${figW} ${figH}`}>
              <defs>
                <marker id="cp-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill={axisColor} />
                </marker>
              </defs>
              {grid && (
                <g>
                  {xt.map((t, i) => <line key={`gx${i}`} x1={sx(t)} y1={PAD} x2={sx(t)} y2={figH - PAD} stroke={gridColor} strokeWidth={1} />)}
                  {yt.map((t, i) => <line key={`gy${i}`} x1={PAD} y1={sy(t)} x2={figW - PAD} y2={sy(t)} stroke={gridColor} strokeWidth={1} />)}
                </g>
              )}
              <g>
                <line x1={PAD} y1={ylo <= 0 && yhi >= 0 ? y0 : figH - PAD} x2={figW - PAD} y2={ylo <= 0 && yhi >= 0 ? y0 : figH - PAD} stroke={axisColor} strokeWidth={2.5} markerEnd="url(#cp-arrow)" />
                <line x1={xlo <= 0 && xhi >= 0 ? x0 : PAD} y1={figH - PAD} x2={xlo <= 0 && xhi >= 0 ? x0 : PAD} y2={PAD} stroke={axisColor} strokeWidth={2.5} markerEnd="url(#cp-arrow)" />
              </g>
              <g fontSize={13} fill={labelColor} fontFamily="var(--mono)">
                {xt.map((t, i) => t === 0 ? null : <text key={`tx${i}`} x={sx(t)} y={(ylo <= 0 && yhi >= 0 ? y0 : figH - PAD) + 16} textAnchor="middle">{fmt(t)}</text>)}
                {yt.map((t, i) => t === 0 ? null : <text key={`ty${i}`} x={(xlo <= 0 && xhi >= 0 ? x0 : PAD) - 8} y={sy(t) + 4} textAnchor="end">{fmt(t)}</text>)}
                {xlo <= 0 && xhi >= 0 && ylo <= 0 && yhi >= 0 && <text x={x0 - 8} y={y0 + 16} textAnchor="end">0</text>}
              </g>
              {items.map((it, i) =>
                it.kind === 'fn' || it.kind === 'polar' || it.kind === 'implicit' ? (
                  <path
                    key={i}
                    d={
                      it.kind === 'fn' ? curvePath(it.f) :
                      it.kind === 'polar' ? polarPath(it.f) :
                      implicitPath(it.f)
                    }
                    fill="none"
                    stroke={it.color}
                    strokeWidth={2.6}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ) : null,
              )}
              {items.map((it, i) =>
                it.kind === 'point' && inXY(it.x, it.y) ? (
                  <g key={`p${i}`}>
                    <circle cx={sx(it.x)} cy={sy(it.y)} r={5} fill={bg === 'dark' ? '#fff' : '#222'} stroke={bg === 'dark' ? '#222' : '#fff'} strokeWidth={2} />
                    {it.label && (
                      <text x={sx(it.x) + 9} y={sy(it.y) - 8} fontSize={15} fontWeight={700} fill={axisColor} fontFamily="var(--mono)">{it.label}</text>
                    )}
                  </g>
                ) : null,
              )}
            </svg>
          </div>
        </div>
      </div>

      <div className="graphs-panel">
        <div className="graphs-header">
          <span className="graphs-title">Graphs</span>
          <Button variant="neutral" size="sm" onClick={addGraph} aria-label="그래프 추가">+</Button>
        </div>
        <div className="graphs-list">
          {graphs.map((g) => (
            <GraphRow
              key={g.id}
              entry={g}
              onChange={(updated) => updateGraph(g.id, updated)}
              onDelete={() => deleteGraph(g.id)}
            />
          ))}
          {graphs.length === 0 && <p className="graphs-empty">+ 버튼으로 그래프를 추가하세요</p>}
        </div>
        {errors.length > 0 && (
          <div className="graphs-errors">
            {errors.map((e, i) => (
              <div key={i} className="graphs-error">
                <span className="graphs-error__raw">{e.raw}</span>
                <span className="graphs-error__msg">{e.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Text variant="chrome" muted className="hint">
        y = f(x) · 음함수 x²+y²=r² · 극좌표 r = f(theta) · 점 (x, y) 라벨 · ^ 거듭제곱 · sin·cos·sqrt·pi·e 가능
      </Text>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
