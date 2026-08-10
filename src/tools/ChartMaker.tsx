import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { Chart, CHART_PALETTE } from '../cores'
import { useFitScale, useHistory, usePersist, useStored, useSvgExport } from './hooks'
import BgPicker from './BgPicker'
import { BG_HEX, type BgKey } from './bg'
import { figColors, ptOf, printWidthIn as widthInOf } from './paper'
import { useTheme } from '../theme'
import Inspector, { Field, Row } from './Inspector'
import PrintBar from './PrintBar'
import UndoRedo from './UndoRedo'
import SharedNumField from './NumField'
import './ChartMaker.css'

/* ---------- model ---------- */

type ChartType = 'bar' | 'line' | 'pie' | 'scatter'

const TYPES: { key: ChartType; label: string }[] = [
  { key: 'bar', label: '막대' },
  { key: 'line', label: '선' },
  { key: 'pie', label: '원' },
  { key: 'scatter', label: '산점도' },
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
  widthId: string
  dpi: number
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
  widthId: 'screen',
  dpi: 600,
}

/* ---------- parsing ---------- */

interface Datum {
  label: string
  value: number
  /** source line, so the inspector can rewrite exactly one */
  line: number
}
function parsePairs(input: string): Datum[] {
  const out: Datum[] = []
  input.split('\n').forEach((raw, line) => {
    const text = raw.trim()
    if (!text || text.startsWith('#')) return
    const m = /^(.+?)\s*[=:]\s*(-?[\d.]+)\s*$/.exec(text)
    if (m) out.push({ label: m[1].trim(), value: parseFloat(m[2]), line })
  })
  return out
}
interface Pt {
  x: number
  y: number
  line: number
}
function parsePoints(input: string): Pt[] {
  const out: Pt[] = []
  input.split('\n').forEach((raw, line) => {
    const text = raw.trim()
    if (!text || text.startsWith('#')) return
    const m = /^\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?/.exec(text)
    if (m) out.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), line })
  })
  return out
}

const num = (v: number) => String(+v.toFixed(6))

/* ---------- numeric field (free typing, commit on blur) ---------- */

const NumField = (props: { value: number; onCommit: (n: number) => void }) => (
  <SharedNumField {...props} className="cm-num" integer />
)

/* ---------- app ---------- */

export default function ChartMakerTool() {
  const theme = useTheme()
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
  const [widthId, setWidthId] = useState(initial.widthId)
  const [dpi, setDpi] = useState(initial.dpi)
  const [sel, setSel] = useState<number | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isScatter = type === 'scatter'
  const data = useMemo(() => parsePairs(input), [input])
  const points = useMemo(() => parsePoints(scatterInput), [scatterInput])
  const bgHex = BG_HEX[bg]
  const c = figColors(theme, bg === 'dark', CHART_PALETTE)

  const persisted = {
    type,
    input,
    scatterInput,
    title,
    accent,
    showValues,
    figW,
    figH,
    bg,
    widthId,
    dpi,
  }
  usePersist(STORE_KEY, persisted)

  const history = useHistory(persisted, (s) => {
    setType(s.type)
    setInput(s.input)
    setScatterInput(s.scatterInput)
    setTitle(s.title)
    setAccent(s.accent)
    setShowValues(s.showValues)
    setFigW(s.figW)
    setFigH(s.figH)
    setBg(s.bg)
    setWidthId(s.widthId)
    setDpi(s.dpi)
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
    signature: `${figW}|${figH}|${bg}|${type}|${title}|${theme}`,
  })

  const printIn = widthInOf(widthId, figW)

  const { saveSvg, savePng, copyPng, pixels, busy, toast } = useSvgExport({
    svgRef,
    filename: 'chart',
    printWidthIn: printIn,
    figPxWidth: figW,
    figPxHeight: figH,
    bg: bgHex,
    fontFamily: c.text,
    dpi,
    title: 'Made with Funky Esset Maker — Chart Maker',
  })

  /* ---- editing through the inspector ---- */

  const replaceLine = useCallback(
    (scatter: boolean, line: number, next: string | null) => {
      const set = scatter ? setScatterInput : setInput
      set((text) => {
        const lines = text.split('\n')
        if (line < 0 || line >= lines.length) return text
        if (next === null) lines.splice(line, 1)
        else lines[line] = next
        return lines.join('\n')
      })
    },
    [],
  )

  const selDatum = !isScatter && sel !== null ? (data[sel] ?? null) : null
  const selPoint = isScatter && sel !== null ? (points[sel] ?? null) : null

  // the inspector edits the source line; the text stays the document
  const patchDatum = (over: Partial<Pick<Datum, 'label' | 'value'>>) => {
    if (!selDatum) return
    const next = { ...selDatum, ...over }
    replaceLine(false, selDatum.line, `${next.label} = ${num(next.value)}`)
  }
  const patchPoint = (over: Partial<Pick<Pt, 'x' | 'y'>>) => {
    if (!selPoint) return
    const next = { ...selPoint, ...over }
    replaceLine(true, selPoint.line, `(${num(next.x)}, ${num(next.y)})`)
  }

  const addRow = () => {
    if (isScatter) setScatterInput((t) => `${t.replace(/\s*$/, '')}\n(0, 0)`)
    else setInput((t) => `${t.replace(/\s*$/, '')}\n항목 = 10`)
  }

  const anySelected = selDatum !== null || selPoint !== null

  return (
    <div className="app">
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          Chart Maker
        </Text>

        <UndoRedo history={history} />

        <div className="toolbar__group">
          {TYPES.map((t) => (
            <Button
              key={t.key}
              variant={type === t.key ? 'primary' : 'neutral'}
              size="sm"
              onClick={() => {
                setType(t.key)
                setSel(null)
              }}
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
            {c.series.map((col, i) => (
              <button
                key={col}
                type="button"
                title={col}
                aria-label={`색 ${i + 1}`}
                className={`swatch${accent === i ? ' swatch--active' : ''}`}
                style={{ background: col }}
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

        <PrintBar
          widthId={widthId}
          onWidth={(id, px) => {
            setWidthId(id)
            if (px) {
              const ratio = figH / figW
              setFigW(px)
              setFigH(Math.round(px * ratio))
            }
          }}
          dpi={dpi}
          onDpi={setDpi}
          labelPt={ptOf(theme === 'paper' ? 10 : 13, printIn, figW)}
          pixels={pixels}
        />

        <BgPicker value={bg} onChange={setBg} />

        <div className="toolbar__spacer" />

        <Button variant="warning" size="sm" title="벡터 SVG로 저장 (⌘⇧E)" onClick={saveSvg}>
          SVG
        </Button>
        <Button variant="success" size="sm" title="PNG로 저장 (⌘E)" onClick={savePng} disabled={busy}>
          PNG 저장
        </Button>
        <Button variant="info" size="sm" title="클립보드로 복사 (⌘⇧C)" onClick={copyPng} disabled={busy}>
          복사
        </Button>
      </div>

      <div className="stage fx-insp-host" ref={stageRef}>
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
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSel(null)
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
              theme={theme}
              /* the legend has to be inside the SVG or the vector export
                 silently loses it — the HTML list is not in the element we
                 serialise */
              legend="svg"
              svgRef={svgRef}
              selected={sel}
              onPick={setSel}
            />
          </div>
        </div>

        {selDatum && (
          <Inspector
            title={type === 'pie' ? '조각' : type === 'line' ? '점' : '막대'}
            hint={`${selDatum.label} = ${num(selDatum.value)}`}
            onClose={() => setSel(null)}
          >
            <Field label="라벨">
              <input
                type="text"
                value={selDatum.label}
                onChange={(e) => patchDatum({ label: e.target.value || '항목' })}
              />
            </Field>
            <Field label="값">
              <SharedNumField
                value={selDatum.value}
                onCommit={(value) => patchDatum({ value })}
              />
            </Field>
            <Row label="">
              <button
                type="button"
                className="fx-insp__btn"
                onClick={() => patchDatum({ value: +(selDatum.value * 1.1).toFixed(4) })}
              >
                +10%
              </button>
              <button
                type="button"
                className="fx-insp__btn"
                onClick={() => patchDatum({ value: +(selDatum.value * 0.9).toFixed(4) })}
              >
                −10%
              </button>
            </Row>
            <Row label="">
              <button
                type="button"
                className="fx-insp__btn fx-insp__btn--danger"
                onClick={() => {
                  replaceLine(false, selDatum.line, null)
                  setSel(null)
                }}
              >
                삭제
              </button>
            </Row>
          </Inspector>
        )}

        {selPoint && (
          <Inspector
            title="점"
            hint={`(${num(selPoint.x)}, ${num(selPoint.y)})`}
            onClose={() => setSel(null)}
          >
            <Field label="x">
              <SharedNumField value={selPoint.x} onCommit={(x) => patchPoint({ x })} />
            </Field>
            <Field label="y">
              <SharedNumField value={selPoint.y} onCommit={(y) => patchPoint({ y })} />
            </Field>
            <Row label="">
              <button
                type="button"
                className="fx-insp__btn fx-insp__btn--danger"
                onClick={() => {
                  replaceLine(true, selPoint.line, null)
                  setSel(null)
                }}
              >
                삭제
              </button>
            </Row>
          </Inspector>
        )}

        {!anySelected && (
          <p className="fx-insp-tip">막대 · 조각 · 점을 클릭하면 편집합니다</p>
        )}

        {/* the toast lives in the stage so its offset does not depend on how
            much chrome this particular tool puts below it */}
        {toast && <div className="toast">{toast}</div>}
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
        <Button variant="neutral" size="sm" onClick={addRow} title="한 줄 추가">
          +
        </Button>
      </div>

      <Text variant="chrome" muted className="hint">
        {isScatter
          ? '산점도 — (x, y) 점을 한 줄에 하나씩 · 축은 자동 범위 · 점을 클릭해 편집'
          : '막대 / 선 / 원 — 라벨 = 값 (한 줄에 하나) · 클릭해 편집 · SVG / PNG로 내보내기'}
      </Text>
    </div>
  )
}
