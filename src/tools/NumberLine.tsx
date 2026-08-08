import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { useFitScale, usePersist, usePngExport, useStored } from './hooks'
import SharedNumField from './NumField'
import './NumberLine.css'

/* ---------- model ---------- */

type BgKey = 'transparent' | 'cream' | 'white' | 'dark'

const PALETTE = ['#ff4eba', '#7828c8', '#00a3d9', '#ff9100', '#00b327', '#d6219b']

const BGS: { key: BgKey; label: string; hex: string | null }[] = [
  { key: 'transparent', label: '투명', hex: null },
  { key: 'cream', label: '크림', hex: '#fff5d1' },
  { key: 'white', label: '흰색', hex: '#ffffff' },
  { key: 'dark', label: '어두움', hex: '#1e1e22' },
]

const SAMPLE = `x >= 2
(-1, 3]
x < -3
1`

const STORE_KEY = 'fem.numline.v1'

interface Persisted {
  input: string
  auto: boolean
  vmin: number
  vmax: number
  figW: number
  bg: BgKey
}
const DEFAULTS: Persisted = {
  input: SAMPLE,
  auto: true,
  vmin: -5,
  vmax: 5,
  figW: 760,
  bg: 'transparent',
}

/* ---------- parse ---------- */

type Item =
  | { kind: 'interval'; a: number; b: number; lc: boolean; rc: boolean; label?: string; color: string }
  | { kind: 'ray'; at: number; dir: 'left' | 'right'; closed: boolean; label?: string; color: string }
  | { kind: 'point'; at: number; closed: boolean; label?: string; color: string }
  | { kind: 'error'; raw: string; msg: string }

const IV_RE = /^([[(])\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*([\])])\s*(.*)$/
const INEQ_RE = /^x\s*(<=|>=|<|>)\s*(-?[\d.]+)\s*(.*)$/i
const PT_RE = /^(open|closed|o|c)?\s*(-?[\d.]+)\s*(.*)$/i

function parse(input: string): Item[] {
  const out: Item[] = []
  let ci = 0
  const next = () => PALETTE[ci++ % PALETTE.length]
  for (const raw of input.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let m = IV_RE.exec(line)
    if (m) {
      out.push({
        kind: 'interval',
        a: parseFloat(m[2]),
        b: parseFloat(m[3]),
        lc: m[1] === '[',
        rc: m[4] === ']',
        label: m[5].trim() || undefined,
        color: next(),
      })
      continue
    }
    m = INEQ_RE.exec(line)
    if (m) {
      const op = m[1]
      const at = parseFloat(m[2])
      const dir = op === '>' || op === '>=' ? 'right' : 'left'
      const closed = op === '>=' || op === '<='
      out.push({ kind: 'ray', at, dir, closed, label: m[3].trim() || undefined, color: next() })
      continue
    }
    m = PT_RE.exec(line)
    if (m) {
      const tag = (m[1] || '').toLowerCase()
      out.push({
        kind: 'point',
        at: parseFloat(m[2]),
        closed: !(tag === 'open' || tag === 'o'),
        label: m[3].trim() || undefined,
        color: next(),
      })
      continue
    }
    out.push({ kind: 'error', raw: line, msg: '[a,b] · x >= a · 점(숫자) 형식' })
  }
  return out
}

function niceStep(range: number, target = 10): number {
  const rough = range / target || 1
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / pow
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10
  return step * pow
}
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(2)))

const NumField = (props: { value: number; onCommit: (n: number) => void }) => (
  <SharedNumField {...props} className="nl-num" />
)

/* ---------- app ---------- */

export default function NumberLineTool() {
  const initial = useStored(STORE_KEY, DEFAULTS)
  const [input, setInput] = useState(initial.input)
  const [auto, setAuto] = useState(initial.auto)
  const [vmin, setVmin] = useState(initial.vmin)
  const [vmax, setVmax] = useState(initial.vmax)
  const [figW, setFigW] = useState(initial.figW)
  const [bg, setBg] = useState<BgKey>(initial.bg)

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const items = useMemo(() => parse(input), [input])
  const bgHex = BGS.find((b) => b.key === bg)?.hex ?? null
  const ink = bg === 'dark' ? '#f4f4f4' : '#222'
  const labelColor = bg === 'dark' ? '#cfcfd6' : '#555'

  /* range */
  const [lo, hi] = useMemo(() => {
    if (!auto) {
      const a = Math.min(vmin, vmax)
      const b = Math.max(vmin, vmax)
      return [a, b === a ? a + 1 : b] as const
    }
    const vals: number[] = []
    for (const it of items) {
      if (it.kind === 'interval') vals.push(it.a, it.b)
      else if (it.kind === 'ray') vals.push(it.at)
      else if (it.kind === 'point') vals.push(it.at)
    }
    if (!vals.length) return [-5, 5] as const
    let a = Math.min(...vals)
    let b = Math.max(...vals)
    if (b - a < 1) {
      a -= 2
      b += 2
    }
    const pad = (b - a) * 0.18 + 0.5
    return [Math.floor(a - pad), Math.ceil(b + pad)] as const
  }, [auto, vmin, vmax, items])

  const drawn = items.filter((i) => i.kind !== 'error') as Exclude<Item, { kind: 'error' }>[]
  const PADX = 46
  const ROWH = 34
  const rows = Math.max(1, drawn.length)
  const figH = 56 + rows * ROWH + 56
  const axisY = figH - 52
  const X = (v: number) => PADX + ((v - lo) / (hi - lo)) * (figW - 2 * PADX)
  const rowY = (i: number) => axisY - 26 - i * ROWH

  const step = niceStep(hi - lo)
  const tickVals: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step)
    tickVals.push(Math.abs(v) < step * 1e-6 ? 0 : +v.toFixed(6))

  usePersist(STORE_KEY, { input, auto, vmin, vmax, figW, bg })

  useLayoutEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(180, ta.scrollHeight)}px`
  }, [input])

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    signature: `${figW}|${figH}|${bg}`,
  })

  const { savePng, copyPng, busy, toast } = usePngExport({
    shotRef,
    filename: 'numberline',
  })

  const endpoint = (cx: number, cy: number, closed: boolean, color: string) => (
    <circle
      cx={cx}
      cy={cy}
      r={6}
      fill={closed ? color : bg === 'dark' ? '#1e1e22' : '#fff'}
      stroke={closed ? '#222' : color}
      strokeWidth={closed ? 2 : 3}
    />
  )

  return (
    <div className="app">
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          Number Line
        </Text>

        <div className="toolbar__group">
          <Button
            variant={auto ? 'primary' : 'neutral'}
            size="sm"
            onClick={() => setAuto((v) => !v)}
          >
            범위 자동
          </Button>
          {!auto && (
            <>
              <NumField value={vmin} onCommit={setVmin} />
              <span className="nl-tilde">~</span>
              <NumField value={vmax} onCommit={setVmax} />
            </>
          )}
        </div>

        <div className="toolbar__group">
          <span className="toolbar__label">너비</span>
          <NumField value={figW} onCommit={(n) => setFigW(Math.max(360, n))} />
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
            <svg className="nline" width={figW} height={figH} viewBox={`0 0 ${figW} ${figH}`}>
              <defs>
                <marker id="nl-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill={ink} />
                </marker>
              </defs>

              {/* the number line axis */}
              <line x1={PADX - 16} y1={axisY} x2={figW - PADX + 16} y2={axisY} stroke={ink} strokeWidth={2.5} markerStart="url(#nl-arrow)" markerEnd="url(#nl-arrow)" />

              {/* ticks + labels */}
              <g fontSize={14} fill={labelColor} fontFamily="var(--mono)">
                {tickVals.map((t, i) => (
                  <g key={i}>
                    <line x1={X(t)} y1={axisY - 5} x2={X(t)} y2={axisY + 5} stroke={ink} strokeWidth={2} />
                    <text x={X(t)} y={axisY + 22} textAnchor="middle">
                      {fmt(t)}
                    </text>
                  </g>
                ))}
              </g>

              {/* items, stacked above the axis */}
              {drawn.map((it, i) => {
                const y = rowY(i)
                if (it.kind === 'interval') {
                  const xa = X(it.a)
                  const xb = X(it.b)
                  return (
                    <g key={i}>
                      <line x1={xa} y1={y} x2={xb} y2={y} stroke={it.color} strokeWidth={5} strokeLinecap="butt" />
                      {endpoint(xa, y, it.lc, it.color)}
                      {endpoint(xb, y, it.rc, it.color)}
                      {it.label && (
                        <text x={(xa + xb) / 2} y={y - 12} textAnchor="middle" fontSize={14} fontWeight={700} fill={ink}>
                          {it.label}
                        </text>
                      )}
                    </g>
                  )
                }
                if (it.kind === 'ray') {
                  const xa = X(it.at)
                  const xEnd = it.dir === 'right' ? figW - PADX + 14 : PADX - 14
                  return (
                    <g key={i}>
                      <line x1={xa} y1={y} x2={xEnd} y2={y} stroke={it.color} strokeWidth={5} markerEnd="url(#nl-arrow)" />
                      {endpoint(xa, y, it.closed, it.color)}
                      {it.label && (
                        <text x={xa + (it.dir === 'right' ? 14 : -14)} y={y - 12} textAnchor={it.dir === 'right' ? 'start' : 'end'} fontSize={14} fontWeight={700} fill={ink}>
                          {it.label}
                        </text>
                      )}
                    </g>
                  )
                }
                // point
                const xa = X(it.at)
                return (
                  <g key={i}>
                    {endpoint(xa, y, it.closed, it.color)}
                    {it.label && (
                      <text x={xa} y={y - 12} textAnchor="middle" fontSize={14} fontWeight={700} fill={ink}>
                        {it.label}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
          </div>
        </div>
      </div>

      <div className="editor">
        <span className="editor__prompt">⊢</span>
        <textarea
          ref={inputRef}
          className="editor__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'한 줄에 하나 — x >= 2 / (-1, 3] / [0, 4) / 3 (점) / open 5'}
          spellCheck={false}
          rows={1}
          aria-label="수직선 입력"
        />
      </div>

      <Text variant="chrome" muted className="hint">
        부등식 x &gt;= 2 · 구간 [a, b] (a, b) [a, b) · 점은 숫자 (open 으로 열린 점)
        · 각 줄이 한 줄씩 쌓임 · 투명 PNG로 저장
      </Text>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
