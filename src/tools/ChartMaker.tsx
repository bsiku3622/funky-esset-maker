import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { Chart, CHART_PALETTE } from '../cores'
import { useFitScale, usePersist, usePngExport, useStored } from './hooks'
import SharedNumField from './NumField'
import './ChartMaker.css'

/* ---------- model ---------- */

type ChartType = 'bar' | 'line' | 'pie' | 'scatter'
type BgKey = 'transparent' | 'cream' | 'white' | 'dark'

// the toolbar swatches show the series colors the chart core will actually use
const PALETTE = CHART_PALETTE

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

/* ---------- numeric field (free typing, commit on blur) ---------- */

const NumField = (props: { value: number; onCommit: (n: number) => void }) => (
  <SharedNumField {...props} className="cm-num" integer />
)

/* ---------- app ---------- */

export default function ChartMakerTool() {
  const initial = useStored(STORE_KEY, DEFAULTS)
  const [type, setType] = useState<ChartType>(initial.type)
  const [input, setInput] = useState(initial.input)
  const [scatterInput, setScatterInput] = useState(initial.scatterInput)
  const [title, setTitle] = useState(initial.title)
  const [accent, setAccent] = useState(initial.accent)
  const [showValues, setShowValues] = useState(initial.showValues)
  const [figW, setFigW] = useState(initial.figW)
  const [figH, setFigH] = useState(initial.figH)
  const [bg, setBg] = useState<BgKey>(initial.bg)

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isScatter = type === 'scatter'
  const data = useMemo(() => parsePairs(input), [input])
  const points = useMemo(() => parsePoints(scatterInput), [scatterInput])
  const bgHex = BGS.find((b) => b.key === bg)?.hex ?? null

  usePersist(STORE_KEY, {
    type,
    input,
    scatterInput,
    title,
    accent,
    showValues,
    figW,
    figH,
    bg,
  })

  useLayoutEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(180, ta.scrollHeight)}px`
  }, [input, scatterInput, type])

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    signature: `${figW}|${figH}|${bg}|${type}|${title}`,
  })

  const { savePng, copyPng, busy, toast } = usePngExport({
    shotRef,
    filename: 'chart',
  })

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

        <Button variant="success" size="sm" title="PNG로 저장 (⌘E)" onClick={savePng} disabled={busy}>
          PNG 저장
        </Button>
        <Button variant="info" size="sm" title="클립보드로 복사 (⌘⇧C)" onClick={copyPng} disabled={busy}>
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
            {/* bg is passed for the ink/grid colors it picks; the card itself is
                painted by .shot above so the padding is covered too */}
            <Chart
              type={type}
              data={data}
              points={points}
              title={title || undefined}
              accent={accent}
              showValues={showValues}
              width={figW}
              height={figH}
              bg={bg}
            />
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
