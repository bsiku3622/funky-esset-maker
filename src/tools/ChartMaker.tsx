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
import './ChartMaker.css'

/* ---------- model ---------- */

type ChartType = 'bar' | 'line' | 'pie' | 'scatter'
type BgKey = 'transparent' | 'cream' | 'white' | 'dark'

const PALETTE = [
  '#ff4eba',
  '#3decfd',
  '#ffd500',
  '#7828c8',
  '#ff9100',
  '#00c22a',
  '#00c8ff',
]

const TYPES: { key: ChartType; label: string }[] = [
  { key: 'bar', label: '막대' },
  { key: 'line', label: '선' },
  { key: 'pie', label: '원' },
  { key: 'scatter', label: '산점도' },
]

const BGS: { key: BgKey; label: string; hex: string | null }[] = [
  { key: 'transparent', label: '투명', hex: null },
  { key: 'cream', label: '크림', hex: '#fff5d1' },
  { key: 'white', label: '흰색', hex: '#ffffff' },
  { key: 'dark', label: '어두움', hex: '#1e1e22' },
]

const SAMPLE = `사과 = 30
바나나 = 45
체리 = 18
포도 = 27`
const SAMPLE_SCATTER = `(1, 2)
(2, 3.5)
(3, 2.8)
(4, 5)
(5, 4.2)`

const STORE_KEY = 'fem.chart.v1'

interface Persisted {
  type: ChartType
  input: string
  scatterInput: string
  title: string
  accent: number // palette index
  showValues: boolean
  figW: number
  figH: number
  bg: BgKey
}

const DEFAULTS: Persisted = {
  type: 'bar',
  input: SAMPLE,
  scatterInput: SAMPLE_SCATTER,
  title: '',
  accent: 0,
  showValues: true,
  figW: 640,
  figH: 440,
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

/* ---------- parsing ---------- */

interface Datum {
  label: string
  value: number
}
function parsePairs(input: string): Datum[] {
  const out: Datum[] = []
  for (const raw of input.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(.+?)\s*[=:]\s*(-?[\d.]+)\s*$/.exec(line)
    if (m) out.push({ label: m[1].trim(), value: parseFloat(m[2]) })
  }
  return out
}
interface Pt {
  x: number
  y: number
}
function parsePoints(input: string): Pt[] {
  const out: Pt[] = []
  for (const raw of input.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?/.exec(line)
    if (m) out.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) })
  }
  return out
}

/* ---------- nice ticks ---------- */

function niceStep(range: number, target = 6): number {
  const rough = range / target || 1
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / pow
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10
  return step * pow
}
function axisTicks(min: number, max: number): number[] {
  const step = niceStep(max - min)
  const out: number[] = []
  const start = Math.ceil(min / step) * step
  for (let v = start; v <= max + step * 1e-6; v += step)
    out.push(Math.abs(v) < step * 1e-6 ? 0 : +v.toFixed(6))
  return out
}
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(2)))

/* ---------- numeric field (free typing, commit on blur) ---------- */

function NumField({
  value,
  onCommit,
}: {
  value: number
  onCommit: (n: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <input
      className="cm-num"
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = parseInt(text, 10)
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

export default function ChartMakerTool() {
  const initial = useMemo(loadState, [])
  const [type, setType] = useState<ChartType>(initial.type)
  const [input, setInput] = useState(initial.input)
  const [scatterInput, setScatterInput] = useState(initial.scatterInput)
  const [title, setTitle] = useState(initial.title)
  const [accent, setAccent] = useState(initial.accent)
  const [showValues, setShowValues] = useState(initial.showValues)
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

  const isScatter = type === 'scatter'
  const data = useMemo(() => parsePairs(input), [input])
  const points = useMemo(() => parsePoints(scatterInput), [scatterInput])
  const bgHex = BGS.find((b) => b.key === bg)?.hex ?? null
  const ink = bg === 'dark' ? '#f4f4f4' : '#222'
  const labelColor = bg === 'dark' ? '#cfcfd6' : '#555'
  const grid = bg === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'
  const color = (i: number) => PALETTE[(accent + i) % PALETTE.length]

  /* persist */
  useEffect(() => {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ type, input, scatterInput, title, accent, showValues, figW, figH, bg }),
      )
    } catch {
      /* ignore */
    }
  }, [type, input, scatterInput, title, accent, showValues, figW, figH, bg])

  useLayoutEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(180, ta.scrollHeight)}px`
  }, [input, scatterInput, type])

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
  }, [recompute, figW, figH, bg, type, title, input, scatterInput])
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
      a.download = 'chart.png'
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

  /* ---------- chart geometry ---------- */
  const PADL = 56
  const PADR = 24
  const PADT = title ? 44 : 24
  const PADB = 52
  const plotW = figW - PADL - PADR
  const plotH = figH - PADT - PADB
  const x0 = PADL
  const yBase = figH - PADB

  // bar / line value axis
  const maxV = Math.max(1, ...data.map((d) => d.value), 0)
  // round the axis top UP to a nice multiple so the tallest bar always fits
  const vStep = niceStep(maxV)
  const vMax = Math.max(vStep, Math.ceil(maxV / vStep) * vStep)
  const vt: number[] = []
  for (let v = 0; v <= vMax + vStep * 1e-6; v += vStep) vt.push(+v.toFixed(6))
  const vy = (v: number) => yBase - (v / vMax) * plotH

  // scatter ranges
  const sx0 = Math.min(...points.map((p) => p.x), 0)
  const sx1 = Math.max(...points.map((p) => p.x), 1)
  const sy0 = Math.min(...points.map((p) => p.y), 0)
  const sy1 = Math.max(...points.map((p) => p.y), 1)
  const spanX = sx1 - sx0 || 1
  const spanY = sy1 - sy0 || 1
  const scX = (x: number) => PADL + ((x - sx0) / spanX) * plotW
  const scY = (y: number) => yBase - ((y - sy0) / spanY) * plotH
  const sxt = axisTicks(sx0, sx1)
  const syt = axisTicks(sy0, sy1)

  // pie geometry
  const pieTotal = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1
  const pieR = Math.min(plotW, plotH) / 2 - 6
  const pieCx = PADL + plotW / 2
  const pieCy = PADT + plotH / 2
  const pieSlices = (() => {
    let a = -Math.PI / 2
    return data.map((d, i) => {
      const frac = Math.max(0, d.value) / pieTotal
      const a2 = a + frac * Math.PI * 2
      const large = a2 - a > Math.PI ? 1 : 0
      const p1 = [pieCx + pieR * Math.cos(a), pieCy + pieR * Math.sin(a)]
      const p2 = [pieCx + pieR * Math.cos(a2), pieCy + pieR * Math.sin(a2)]
      const mid = (a + a2) / 2
      const lx = pieCx + pieR * 0.6 * Math.cos(mid)
      const ly = pieCy + pieR * 0.6 * Math.sin(mid)
      const path = `M${pieCx} ${pieCy} L${p1[0].toFixed(2)} ${p1[1].toFixed(2)} A${pieR} ${pieR} 0 ${large} 1 ${p2[0].toFixed(2)} ${p2[1].toFixed(2)} Z`
      a = a2
      return { d, i, path, frac, lx, ly }
    })
  })()

  return (
    <div className="app">
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          Chart Maker
        </Text>

        <div className="toolbar__group">
          {TYPES.map((t) => (
            <Button
              key={t.key}
              variant={type === t.key ? 'primary' : 'neutral'}
              size="sm"
              onClick={() => setType(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        <input
          className="cm-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목 (선택)"
          spellCheck={false}
          aria-label="차트 제목"
        />

        <div className="toolbar__group">
          <span className="toolbar__label">색</span>
          <div className="swatches">
            {PALETTE.map((c, i) => (
              <button
                key={c}
                type="button"
                className={`swatch${accent === i ? ' swatch--active' : ''}`}
                style={{ background: c }}
                onClick={() => setAccent(i)}
              />
            ))}
          </div>
        </div>

        <Button
          variant={showValues ? 'secondary' : 'neutral'}
          size="sm"
          onClick={() => setShowValues((v) => !v)}
        >
          값 표시
        </Button>

        <div className="toolbar__group">
          <span className="toolbar__label">크기</span>
          <NumField value={figW} onCommit={(n) => setFigW(Math.max(280, n))} />
          <span className="cm-tilde">×</span>
          <NumField value={figH} onCommit={(n) => setFigH(Math.max(220, n))} />
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
            <svg className="chart" width={figW} height={figH} viewBox={`0 0 ${figW} ${figH}`}>
              {title && (
                <text
                  x={figW / 2}
                  y={26}
                  textAnchor="middle"
                  fontSize={20}
                  fontWeight={800}
                  fill={ink}
                >
                  {title}
                </text>
              )}

              {/* ---- bar / line: value axis + grid ---- */}
              {(type === 'bar' || type === 'line') && (
                <g>
                  {vt.map((t, i) => (
                    <g key={i}>
                      <line x1={PADL} y1={vy(t)} x2={figW - PADR} y2={vy(t)} stroke={grid} strokeWidth={1} />
                      <text x={PADL - 8} y={vy(t) + 4} textAnchor="end" fontSize={12} fill={labelColor} fontFamily="var(--mono)">
                        {fmt(t)}
                      </text>
                    </g>
                  ))}
                  <line x1={PADL} y1={PADT} x2={PADL} y2={yBase} stroke={ink} strokeWidth={2} />
                  <line x1={PADL} y1={yBase} x2={figW - PADR} y2={yBase} stroke={ink} strokeWidth={2} />
                </g>
              )}

              {/* ---- bars ---- */}
              {type === 'bar' &&
                data.map((d, i) => {
                  const n = data.length
                  const slot = plotW / n
                  const bw = slot * 0.62
                  const bx = x0 + slot * i + (slot - bw) / 2
                  const by = vy(d.value)
                  return (
                    <g key={i}>
                      <rect x={bx} y={by} width={bw} height={yBase - by} fill={color(i)} stroke="#222" strokeWidth={2} />
                      {showValues && (
                        <text x={bx + bw / 2} y={by - 6} textAnchor="middle" fontSize={13} fontWeight={700} fill={ink}>
                          {fmt(d.value)}
                        </text>
                      )}
                      <text x={bx + bw / 2} y={yBase + 18} textAnchor="middle" fontSize={13} fill={ink}>
                        {d.label}
                      </text>
                    </g>
                  )
                })}

              {/* ---- line ---- */}
              {type === 'line' && data.length > 0 && (
                <g>
                  <polyline
                    points={data
                      .map((d, i) => `${x0 + (plotW / data.length) * (i + 0.5)},${vy(d.value)}`)
                      .join(' ')}
                    fill="none"
                    stroke={color(0)}
                    strokeWidth={3}
                    strokeLinejoin="round"
                  />
                  {data.map((d, i) => {
                    const cx = x0 + (plotW / data.length) * (i + 0.5)
                    return (
                      <g key={i}>
                        <circle cx={cx} cy={vy(d.value)} r={5} fill="#fff" stroke="#222" strokeWidth={2} />
                        {showValues && (
                          <text x={cx} y={vy(d.value) - 10} textAnchor="middle" fontSize={13} fontWeight={700} fill={ink}>
                            {fmt(d.value)}
                          </text>
                        )}
                        <text x={cx} y={yBase + 18} textAnchor="middle" fontSize={13} fill={ink}>
                          {d.label}
                        </text>
                      </g>
                    )
                  })}
                </g>
              )}

              {/* ---- pie ---- */}
              {type === 'pie' &&
                pieSlices.map((s) => (
                  <g key={s.i}>
                    <path d={s.path} fill={color(s.i)} stroke="#222" strokeWidth={2} />
                    {showValues && s.frac > 0.04 && (
                      <text x={s.lx} y={s.ly} textAnchor="middle" fontSize={13} fontWeight={700} fill="#222">
                        {Math.round(s.frac * 100)}%
                      </text>
                    )}
                  </g>
                ))}

              {/* ---- scatter ---- */}
              {type === 'scatter' && (
                <g>
                  {syt.map((t, i) => (
                    <g key={`sy${i}`}>
                      <line x1={PADL} y1={scY(t)} x2={figW - PADR} y2={scY(t)} stroke={grid} strokeWidth={1} />
                      <text x={PADL - 8} y={scY(t) + 4} textAnchor="end" fontSize={12} fill={labelColor} fontFamily="var(--mono)">
                        {fmt(t)}
                      </text>
                    </g>
                  ))}
                  {sxt.map((t, i) => (
                    <text key={`sx${i}`} x={scX(t)} y={yBase + 18} textAnchor="middle" fontSize={12} fill={labelColor} fontFamily="var(--mono)">
                      {fmt(t)}
                    </text>
                  ))}
                  <line x1={PADL} y1={PADT} x2={PADL} y2={yBase} stroke={ink} strokeWidth={2} />
                  <line x1={PADL} y1={yBase} x2={figW - PADR} y2={yBase} stroke={ink} strokeWidth={2} />
                  {points.map((p, i) => (
                    <circle key={i} cx={scX(p.x)} cy={scY(p.y)} r={6} fill={color(0)} stroke="#222" strokeWidth={2} />
                  ))}
                </g>
              )}
            </svg>

            {/* pie legend */}
            {type === 'pie' && (
              <ul className="cm-legend" style={{ color: ink }}>
                {data.map((d, i) => (
                  <li key={i}>
                    <span className="cm-legend__box" style={{ background: color(i) }} />
                    <span className="cm-legend__label">{d.label}</span>
                    <span className="cm-legend__val">{fmt(d.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="editor">
        <span className="editor__prompt">{isScatter ? 'xy' : '='}</span>
        <textarea
          ref={inputRef}
          className="editor__input"
          value={isScatter ? scatterInput : input}
          onChange={(e) => (isScatter ? setScatterInput(e.target.value) : setInput(e.target.value))}
          placeholder={isScatter ? '(x, y) 점을 한 줄에 하나씩' : '라벨 = 값 (한 줄에 하나)'}
          spellCheck={false}
          rows={1}
          aria-label="차트 데이터"
        />
      </div>

      <Text variant="chrome" muted className="hint">
        {isScatter
          ? '산점도 — (x, y) 점을 한 줄에 하나씩 · 축은 자동 범위'
          : '막대 / 선 / 원 — 라벨 = 값 (한 줄에 하나) · 색 / 값표시 / 배경 조절 후 투명 PNG로 저장'}
      </Text>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
