import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { useFitScale, useHistory, usePersist, useStored, useSvgExport } from './hooks'
import BgPicker from './BgPicker'
import { BG_HEX, type BgKey } from './bg'
import { figColors, ptOf, printWidthIn as widthInOf } from './paper'
import { UI_ONLY } from './svg'
import { useTheme } from '../theme'
import Inspector, { Field, Row, Swatches } from './Inspector'
import PrintBar from './PrintBar'
import UndoRedo from './UndoRedo'
import SharedNumField from './NumField'
import './NumberLine.css'

/* ---------- model ---------- */


const PALETTE = ['#ff4eba', '#7828c8', '#00a3d9', '#ff9100', '#00b327', '#d6219b']

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
  /** printed-width preset id; 'screen' means 1 px = 1/96 in */
  widthId: string
  dpi: number
}
const DEFAULTS: Persisted = {
  input: SAMPLE,
  auto: true,
  vmin: -5,
  vmax: 5,
  figW: 760,
  bg: 'transparent',
  widthId: 'screen',
  dpi: 600,
}

/* ---------- parse ---------- */

interface Base {
  /** index of the source line, so the inspector can rewrite exactly one */
  line: number
  label?: string
  /** explicit colour from the source, if the author set one */
  hex?: string
}
type Item =
  | (Base & { kind: 'interval'; a: number; b: number; lc: boolean; rc: boolean })
  | (Base & { kind: 'ray'; at: number; dir: 'left' | 'right'; closed: boolean })
  | (Base & { kind: 'point'; at: number; closed: boolean })
  | { kind: 'error'; line: number; raw: string; msg: string }

type Drawn = Exclude<Item, { kind: 'error' }>

const IV_RE = /^([[(])\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*([\])])\s*(.*)$/
const INEQ_RE = /^x\s*(<=|>=|<|>)\s*(-?[\d.]+)\s*(.*)$/i
const PT_RE = /^(open|closed|o|c)?\s*(-?[\d.]+)\s*(.*)$/i
/* An optional colour at the end of the line. Split off before the shape regexes
   run so it never lands inside a label. */
const HEX_RE = /\s+(#[0-9a-fA-F]{6})\s*$/

function parse(input: string): Item[] {
  const out: Item[] = []
  input.split('\n').forEach((raw, line) => {
    let text = raw.trim()
    if (!text || text.startsWith('#')) return
    let hex: string | undefined
    const cm = HEX_RE.exec(text)
    if (cm) {
      hex = cm[1]
      text = text.slice(0, cm.index).trim()
    }
    let m = IV_RE.exec(text)
    if (m) {
      out.push({
        kind: 'interval',
        line,
        hex,
        a: parseFloat(m[2]),
        b: parseFloat(m[3]),
        lc: m[1] === '[',
        rc: m[4] === ']',
        label: m[5].trim() || undefined,
      })
      return
    }
    m = INEQ_RE.exec(text)
    if (m) {
      const op = m[1]
      out.push({
        kind: 'ray',
        line,
        hex,
        at: parseFloat(m[2]),
        dir: op === '>' || op === '>=' ? 'right' : 'left',
        closed: op === '>=' || op === '<=',
        label: m[3].trim() || undefined,
      })
      return
    }
    m = PT_RE.exec(text)
    if (m) {
      const tag = (m[1] || '').toLowerCase()
      out.push({
        kind: 'point',
        line,
        hex,
        at: parseFloat(m[2]),
        closed: !(tag === 'open' || tag === 'o'),
        label: m[3].trim() || undefined,
      })
      return
    }
    out.push({ kind: 'error', line, raw: text, msg: '[a,b] · x >= a · 점(숫자) 형식' })
  })
  return out
}

const num = (v: number) => String(+v.toFixed(6))

/** Render an item back to its source line — the text stays the document, the
 *  inspector is just another way to type into it. */
function format(it: Drawn): string {
  const tail = `${it.label ? ` ${it.label}` : ''}${it.hex ? ` ${it.hex}` : ''}`
  if (it.kind === 'interval')
    return `${it.lc ? '[' : '('}${num(it.a)}, ${num(it.b)}${it.rc ? ']' : ')'}${tail}`
  if (it.kind === 'ray') {
    const op = it.dir === 'right' ? (it.closed ? '>=' : '>') : it.closed ? '<=' : '<'
    return `x ${op} ${num(it.at)}${tail}`
  }
  return `${it.closed ? '' : 'open '}${num(it.at)}${tail}`
}

function niceStep(range: number, target = 10): number {
  const rough = range / target || 1
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / pow
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10
  return step * pow
}
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(2)))

/** marker id for a colour — ids have to be valid without the '#' */
const arrowId = (hex: string) => `nl-arrow-${hex.replace('#', '')}`

const NumField = (props: { value: number; onCommit: (n: number) => void }) => (
  <SharedNumField {...props} className="nl-num" />
)

/* ---------- app ---------- */

export default function NumberLineTool() {
  const theme = useTheme()
  const initial = useStored(STORE_KEY, DEFAULTS)
  const [input, setInput] = useState(initial.input)
  const [auto, setAuto] = useState(initial.auto)
  const [vmin, setVmin] = useState(initial.vmin)
  const [vmax, setVmax] = useState(initial.vmax)
  const [figW, setFigW] = useState(initial.figW)
  const [bg, setBg] = useState<BgKey>(initial.bg)
  const [widthId, setWidthId] = useState(initial.widthId)
  const [dpi, setDpi] = useState(initial.dpi)
  /** source-line index of the selected item, or null */
  const [sel, setSel] = useState<number | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const items = useMemo(() => parse(input), [input])
  const bgHex = BG_HEX[bg]
  const dark = bg === 'dark'
  const c = figColors(theme, dark, PALETTE)
  const paper = theme === 'paper'

  /* Geometry lives in the tool because "thin" is a different number here than
     in a 640px chart. Paper halves every stroke and drops the label weight —
     a bold data label is a slide habit. */
  const G = paper
    ? { axis: 1, tick: 0.8, bar: 2.2, dot: 3.4, ring: 1.1, tickFont: 11, labelFont: 11 }
    : { axis: 2.5, tick: 2, bar: 5, dot: 6, ring: 3, tickFont: 14, labelFont: 14 }

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

  const drawn = items.filter((i): i is Drawn => i.kind !== 'error')
  const PADX = paper ? 30 : 46
  const ROWH = paper ? 24 : 34
  const rows = Math.max(1, drawn.length)
  const figH = Math.round((paper ? 30 : 56) + rows * ROWH + (paper ? 36 : 56))
  const axisY = figH - (paper ? 34 : 52)
  const X = (v: number) => PADX + ((v - lo) / (hi - lo)) * (figW - 2 * PADX)
  const rowY = (i: number) => axisY - (paper ? 18 : 26) - i * ROWH

  /** explicit colour wins; otherwise the mode's own palette, by draw order */
  const colorOf = (it: Drawn, i: number) => it.hex ?? c.series[i % c.series.length]

  /* every colour that needs an arrowhead: the axis plus each ray */
  const arrowColors = Array.from(
    new Set([c.ink, ...drawn.map((it, i) => (it.kind === 'ray' ? colorOf(it, i) : null))].filter(
      (v): v is string => typeof v === 'string',
    )),
  )

  const step = niceStep(hi - lo)
  const tickVals: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step)
    tickVals.push(Math.abs(v) < step * 1e-6 ? 0 : +v.toFixed(6))

  const persisted = { input, auto, vmin, vmax, figW, bg, widthId, dpi }
  usePersist(STORE_KEY, persisted)

  const history = useHistory(persisted, (s) => {
    setInput(s.input)
    setAuto(s.auto)
    setVmin(s.vmin)
    setVmax(s.vmax)
    setFigW(s.figW)
    setBg(s.bg)
    setWidthId(s.widthId)
    setDpi(s.dpi)
  })

  useLayoutEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(180, ta.scrollHeight)}px`
  }, [input])

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    signature: `${figW}|${figH}|${bg}|${theme}`,
  })

  const printIn = widthInOf(widthId, figW)

  const { saveSvg, savePng, copyPng, pixels, busy, toast } = useSvgExport({
    svgRef,
    filename: 'numberline',
    printWidthIn: printIn,
    figPxWidth: figW,
    figPxHeight: figH,
    bg: bgHex,
    fontFamily: c.text,
    dpi,
    title: 'Made with Funky Esset Maker — Number Line',
  })

  /* ---- editing through the inspector ---- */

  const replaceLine = useCallback((line: number, next: string | null) => {
    setInput((text) => {
      const lines = text.split('\n')
      if (line < 0 || line >= lines.length) return text
      if (next === null) lines.splice(line, 1)
      else lines[line] = next
      return lines.join('\n')
    })
  }, [])

  const selected = drawn.find((d) => d.line === sel) ?? null
  const patch = (over: Partial<Drawn>) => {
    if (!selected) return
    replaceLine(selected.line, format({ ...selected, ...over } as Drawn))
  }

  const endpoint = (cx: number, cy: number, closed: boolean, color: string) => (
    <circle
      cx={cx}
      cy={cy}
      r={G.dot}
      fill={closed ? color : c.hole}
      stroke={closed ? c.outline ?? color : color}
      strokeWidth={closed ? G.ring * 0.7 : G.ring}
    />
  )

  return (
    <div className="app">
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          Number Line
        </Text>

        <UndoRedo history={history} />

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
          <NumField value={figW} onCommit={(n) => setFigW(Math.max(240, n))} />
        </div>

        <PrintBar
          widthId={widthId}
          onWidth={(id, px) => {
            setWidthId(id)
            if (px) setFigW(px)
          }}
          dpi={dpi}
          onDpi={setDpi}
          labelPt={ptOf(G.tickFont, printIn, figW)}
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
          >
            <svg
              ref={svgRef}
              className="nline"
              width={figW}
              height={figH}
              viewBox={`0 0 ${figW} ${figH}`}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) setSel(null)
              }}
            >
              {/* One marker per colour in play. A single ink-coloured arrow was
                  fine while every ray was neon, but in paper mode a blue ray
                  ending in a black head reads as two different objects. */}
              <defs>
                {arrowColors.map((hex) => (
                  <marker
                    key={hex}
                    id={arrowId(hex)}
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M0 0 L10 5 L0 10 z" fill={hex} />
                  </marker>
                ))}
              </defs>

              {/* the number line axis */}
              <line x1={PADX - 16} y1={axisY} x2={figW - PADX + 16} y2={axisY} stroke={c.ink} strokeWidth={G.axis} markerStart={`url(#${arrowId(c.ink)})`} markerEnd={`url(#${arrowId(c.ink)})`} />

              {/* ticks + labels */}
              <g fontSize={G.tickFont} fill={c.muted} fontFamily={c.numeric}>
                {tickVals.map((t, i) => (
                  <g key={i}>
                    <line x1={X(t)} y1={axisY - (paper ? 3.5 : 5)} x2={X(t)} y2={axisY + (paper ? 3.5 : 5)} stroke={c.ink} strokeWidth={G.tick} />
                    <text x={X(t)} y={axisY + (paper ? 16 : 22)} textAnchor="middle">
                      {fmt(t)}
                    </text>
                  </g>
                ))}
              </g>

              {/* items, stacked above the axis */}
              {drawn.map((it, i) => {
                const y = rowY(i)
                const color = colorOf(it, i)
                const on = sel === it.line
                const pick = (e: React.PointerEvent) => {
                  e.stopPropagation()
                  setSel(it.line)
                }
                const label = it.label && (
                  <text
                    fontSize={G.labelFont}
                    fontWeight={c.bold}
                    fill={c.ink}
                    fontFamily={c.text}
                    x={
                      it.kind === 'interval'
                        ? (X(it.a) + X(it.b)) / 2
                        : it.kind === 'ray'
                          ? X(it.at) + (it.dir === 'right' ? 14 : -14)
                          : X(it.at)
                    }
                    y={y - (paper ? 8 : 12)}
                    textAnchor={
                      it.kind === 'ray' ? (it.dir === 'right' ? 'start' : 'end') : 'middle'
                    }
                  >
                    {it.label}
                  </text>
                )
                return (
                  <g key={it.line} onPointerDown={pick} style={{ cursor: 'pointer' }}>
                    {/* a fat invisible bar so thin paper strokes stay clickable */}
                    <line
                      {...{ [UI_ONLY]: '1' }}
                      x1={PADX - 18}
                      y1={y}
                      x2={figW - PADX + 18}
                      y2={y}
                      stroke="transparent"
                      strokeWidth={ROWH - 4}
                    />
                    {on && (
                      <rect
                        {...{ [UI_ONLY]: '1' }}
                        x={PADX - 18}
                        y={y - ROWH / 2}
                        width={figW - 2 * PADX + 36}
                        height={ROWH}
                        fill="rgba(120,40,200,0.10)"
                        stroke="#7828c8"
                        strokeWidth={1.5}
                      />
                    )}
                    {it.kind === 'interval' && (
                      <>
                        <line x1={X(it.a)} y1={y} x2={X(it.b)} y2={y} stroke={color} strokeWidth={G.bar} strokeLinecap="butt" />
                        {endpoint(X(it.a), y, it.lc, color)}
                        {endpoint(X(it.b), y, it.rc, color)}
                      </>
                    )}
                    {it.kind === 'ray' && (
                      <>
                        <line x1={X(it.at)} y1={y} x2={it.dir === 'right' ? figW - PADX + 14 : PADX - 14} y2={y} stroke={color} strokeWidth={G.bar} markerEnd={`url(#${arrowId(color)})`} />
                        {endpoint(X(it.at), y, it.closed, color)}
                      </>
                    )}
                    {it.kind === 'point' && endpoint(X(it.at), y, it.closed, color)}
                    {label}
                  </g>
                )
              })}
            </svg>
          </div>
        </div>

        {selected && (
          <Inspector
            title={
              selected.kind === 'interval'
                ? '구간'
                : selected.kind === 'ray'
                  ? '부등식'
                  : '점'
            }
            hint={format(selected)}
            onClose={() => setSel(null)}
          >
            {selected.kind === 'interval' && (
              <>
                <Field label="시작">
                  <SharedNumField value={selected.a} onCommit={(a) => patch({ a })} />
                </Field>
                <Field label="끝">
                  <SharedNumField value={selected.b} onCommit={(b) => patch({ b })} />
                </Field>
                <Row label="끝점">
                  <button
                    type="button"
                    className={`fx-insp__btn${selected.lc ? ' is-on' : ''}`}
                    onClick={() => patch({ lc: !selected.lc })}
                  >
                    {selected.lc ? '[ 닫힘' : '( 열림'}
                  </button>
                  <button
                    type="button"
                    className={`fx-insp__btn${selected.rc ? ' is-on' : ''}`}
                    onClick={() => patch({ rc: !selected.rc })}
                  >
                    {selected.rc ? '] 닫힘' : ') 열림'}
                  </button>
                </Row>
              </>
            )}

            {selected.kind === 'ray' && (
              <>
                <Field label="기준">
                  <SharedNumField value={selected.at} onCommit={(at) => patch({ at })} />
                </Field>
                <Row label="방향">
                  <button
                    type="button"
                    className={`fx-insp__btn${selected.dir === 'left' ? ' is-on' : ''}`}
                    onClick={() => patch({ dir: 'left' })}
                  >
                    ← 이하
                  </button>
                  <button
                    type="button"
                    className={`fx-insp__btn${selected.dir === 'right' ? ' is-on' : ''}`}
                    onClick={() => patch({ dir: 'right' })}
                  >
                    이상 →
                  </button>
                </Row>
                <Row label="끝점">
                  <button
                    type="button"
                    className={`fx-insp__btn${selected.closed ? ' is-on' : ''}`}
                    onClick={() => patch({ closed: !selected.closed })}
                  >
                    {selected.closed ? '닫힘 (≤ ≥)' : '열림 (< >)'}
                  </button>
                </Row>
              </>
            )}

            {selected.kind === 'point' && (
              <>
                <Field label="위치">
                  <SharedNumField value={selected.at} onCommit={(at) => patch({ at })} />
                </Field>
                <Row label="채움">
                  <button
                    type="button"
                    className={`fx-insp__btn${selected.closed ? ' is-on' : ''}`}
                    onClick={() => patch({ closed: !selected.closed })}
                  >
                    {selected.closed ? '● 채움' : '○ 빈 점'}
                  </button>
                </Row>
              </>
            )}

            <Field label="라벨">
              <input
                type="text"
                value={selected.label ?? ''}
                onChange={(e) => patch({ label: e.target.value || undefined })}
                placeholder="없음"
              />
            </Field>

            <Row label="색">
              <Swatches
                colors={c.series}
                value={selected.hex ?? ''}
                onChange={(hex) => patch({ hex })}
              />
            </Row>
            {selected.hex && (
              <Row label="">
                <button
                  type="button"
                  className="fx-insp__btn"
                  onClick={() => patch({ hex: undefined })}
                >
                  자동 색으로
                </button>
              </Row>
            )}

            <Row label="">
              <button
                type="button"
                className="fx-insp__btn fx-insp__btn--danger"
                onClick={() => {
                  replaceLine(selected.line, null)
                  setSel(null)
                }}
              >
                삭제
              </button>
            </Row>
          </Inspector>
        )}
        {!selected && drawn.length > 0 && (
          <p className="fx-insp-tip">항목을 클릭하면 속성을 편집합니다</p>
        )}

        {/* the toast lives in the stage so its offset does not depend on how
            much chrome this particular tool puts below it */}
        {toast && <div className="toast">{toast}</div>}
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
        · 줄 끝에 #rrggbb 로 색 지정 · 항목을 클릭해 편집 · SVG / PNG로 내보내기
      </Text>
    </div>
  )
}
