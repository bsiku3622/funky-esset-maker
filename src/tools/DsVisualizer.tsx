import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { useFitScale, useHistory, usePersist, usePngExport, useStored } from './hooks'
import BgPicker from './BgPicker'
import { BG_HEX, type BgKey } from './bg'
import { useTheme } from '../theme'
import UndoRedo from './UndoRedo'
import { parseInput } from './parse'
import './DsVisualizer.css'

/* ---------- model ---------- */

type ColorKey = 'pink' | 'purple' | 'cyan' | 'yellow' | 'orange' | 'sky' | 'green'

// funky neon palette for the accent (index cells / dict keys)
const COLOR_HEX: Record<ColorKey, string> = {
  pink: '#ff4eba',
  purple: '#7828c8',
  cyan: '#3decfd',
  yellow: '#ffd500',
  orange: '#ff9100',
  sky: '#00c8ff',
  green: '#00c22a',
}
const COLORS: ColorKey[] = [
  'pink',
  'purple',
  'cyan',
  'yellow',
  'orange',
  'sky',
  'green',
]
// accent text is dark except on the deep-purple fill
const ACCENT_TEXT: Record<ColorKey, string> = {
  pink: '#222222',
  purple: '#ffffff',
  cyan: '#222222',
  yellow: '#222222',
  orange: '#222222',
  sky: '#222222',
  green: '#222222',
}

const FONT_MIN = 14
const FONT_MAX = 56
const FONT_STEP = 2

const SAMPLE = `topo = [u, v]
ready = [w]
incount = {u: 0, v: 1, w: 2, x: 0}`

const STORE_KEY = 'dsviz.v1'

interface Persisted {
  input: string
  fontSize: number
  accent: ColorKey
  bg: BgKey
  showIndex: boolean
}

const DEFAULTS: Persisted = {
  input: SAMPLE,
  fontSize: 28,
  accent: 'cyan',
  bg: 'transparent',
  showIndex: true,
}

/* ---------- app ---------- */

export default function DsVisualizerTool() {
  const paper = useTheme() === 'paper'
  const initial = useStored(STORE_KEY, DEFAULTS)
  const [input, setInput] = useState(initial.input)
  const [fontSize, setFontSize] = useState(initial.fontSize)
  const [accent, setAccent] = useState<ColorKey>(initial.accent)
  const [bg, setBg] = useState<BgKey>(initial.bg)
  const [showIndex, setShowIndex] = useState(initial.showIndex)

  // preview scale — fit the (full-size) figure into the stage; export ignores it
  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const blocks = useMemo(() => parseInput(input), [input])
  const bgHex = BG_HEX[bg]
  /* Paper mode leaves the accent off: it is applied inline, so CSS could only
     beat it with !important, and an index row in a printed figure is plain. */
  const accentHex = paper ? undefined : COLOR_HEX[accent]
  const accentText = paper ? undefined : ACCENT_TEXT[accent]
  const chromeText = bg === 'dark' ? '#f4f4f4' : '#222222'

  const persisted = { input, fontSize, accent, bg, showIndex }
  usePersist(STORE_KEY, persisted)

  const history = useHistory(persisted, (s) => {
    setInput(s.input)
    setFontSize(s.fontSize)
    setAccent(s.accent)
    setBg(s.bg)
    setShowIndex(s.showIndex)
  })

  /* editor auto-grow */
  useLayoutEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(200, ta.scrollHeight)}px`
  }, [input])

  /* font size */
  const bumpFont = (delta: number) =>
    setFontSize((s) => Math.min(FONT_MAX, Math.max(FONT_MIN, s + delta)))

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    signature: `${fontSize}|${showIndex}`,
  })

  const { savePng, copyPng, busy, toast } = usePngExport({
    shotRef,
    filename: 'ds',
    guard: () => (blocks.length ? null : '먼저 입력하세요'),
  })

  return (
    <div className="app">
      {/* toolbar */}
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          DS Visualizer
        </Text>

        <UndoRedo history={history} />

        <div className="toolbar__group" role="group" aria-label="폰트 크기">
          <Button
            variant="neutral"
            size="sm"
            onClick={() => bumpFont(-FONT_STEP)}
            disabled={fontSize <= FONT_MIN}
          >
            A−
          </Button>
          <span className="toolbar__font">{fontSize}px</span>
          <Button
            variant="neutral"
            size="sm"
            onClick={() => bumpFont(FONT_STEP)}
            disabled={fontSize >= FONT_MAX}
          >
            A+
          </Button>
        </div>

        <div
          className="toolbar__group"
          role="group"
          aria-label="강조 색"
          title={paper ? '논문 모드에서는 강조색을 칠하지 않습니다' : undefined}
          style={paper ? { opacity: 0.4 } : undefined}
        >
          <span className="toolbar__label">강조</span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                className={`swatch${accent === c ? ' swatch--active' : ''}`}
                style={{ background: COLOR_HEX[c] }}
                onClick={() => setAccent(c)}
              />
            ))}
          </div>
        </div>

        <Button
          variant={showIndex ? 'primary' : 'neutral'}
          size="sm"
          onClick={() => setShowIndex((v) => !v)}
        >
          인덱스 {showIndex ? '켜짐' : '꺼짐'}
        </Button>

        <BgPicker value={bg} onChange={setBg} />

        <div className="toolbar__spacer" />

        <Button variant="success" size="sm" title="PNG로 저장 (⌘E)" onClick={savePng} disabled={busy}>
          PNG 저장
        </Button>
        <Button variant="info" size="sm" title="클립보드로 복사 (⌘⇧C)" onClick={copyPng} disabled={busy}>
          복사
        </Button>
      </div>

      {/* stage — checkerboard shows transparency; holds the export target */}
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
              fontSize,
              color: chromeText,
              ...(bgHex ? { background: bgHex } : null),
            }}
          >
            {blocks.map((b, i) => {
              if (b.kind === 'error') {
                return (
                  <div key={i} className="block block--error">
                    <span className="err">⚠ {b.raw} — {b.msg}</span>
                  </div>
                )
              }
              if (b.kind === 'list') {
                return (
                  <div key={i} className="block">
                    <span className="var">
                      {b.name} <span className="eq">=</span>
                    </span>
                    {b.items.length === 0 ? (
                      <table className="ds">
                        <tbody>
                          <tr>
                            <td className="cell cell--empty">비어 있음</td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <table className="ds">
                        {showIndex && (
                          <thead>
                            <tr>
                              {b.items.map((_, c) => (
                                <th
                                  key={c}
                                  className="idx"
                                  style={{
                                    background: accentHex,
                                    color: accentText,
                                  }}
                                >
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          <tr>
                            {b.items.map((it, c) => (
                              <td key={c} className="cell">
                                {it}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                )
              }
              // dict
              return (
                <div key={i} className="block">
                  <span className="var">
                    {b.name} <span className="eq">=</span>
                  </span>
                  {b.entries.length === 0 ? (
                    <table className="ds">
                      <tbody>
                        <tr>
                          <td className="cell cell--empty">비어 있음</td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <table className="ds ds--dict">
                      <tbody>
                        {b.entries.map((e, r) => (
                          <tr key={r}>
                            <td
                              className="key"
                              style={{ background: accentHex, color: accentText }}
                            >
                              {e.key}
                            </td>
                            <td className="cell">{e.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* the toast lives in the stage so its offset does not depend on how
            much chrome this particular tool puts below it */}
        {toast && <div className="toast">{toast}</div>}
      </div>

      {/* editor */}
      <div className="editor">
        <span className="editor__prompt">{'>'}</span>
        <textarea
          ref={inputRef}
          className="editor__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'한 줄에 하나씩 — 예:\nready = [a, b, c]\nincount = {u: 0, v: 2}'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={1}
          aria-label="자료구조 입력"
        />
      </div>

      <Text variant="chrome" muted className="hint">
        리스트는 한 줄 표 · 딕셔너리는 두 칸 표로 시각화 · 색 / 배경 / 크기 조절
        후 투명 PNG로 저장 / 복사
      </Text>
    </div>
  )
}
