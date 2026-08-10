import { useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { useFitScale, useHistory, usePersist, usePngExport, useStored } from './hooks'
import { useTheme } from '../theme'
import UndoRedo from './UndoRedo'
import { download, textBlob } from './svg'
import { texTable } from './tex'
import './Tabler.css'

/* ---------- model ---------- */

type ColorKey = 'pink' | 'purple' | 'cyan' | 'yellow' | 'orange' | 'sky' | 'green'
type BodyKey = 'white' | 'cream'
type Align = 'left' | 'center' | 'right'

// funky neon palette for the header fill
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

// header text turns white only on the dark purple fill
const HEADER_TEXT: Record<ColorKey, string> = {
  pink: '#222222',
  purple: '#ffffff',
  cyan: '#222222',
  yellow: '#222222',
  orange: '#222222',
  sky: '#222222',
  green: '#222222',
}

const BODY_HEX: Record<BodyKey, string> = {
  white: '#ffffff',
  cream: '#fff5d1',
}

const FONT_MIN = 14
const FONT_MAX = 64
const FONT_STEP = 2

const ALIGNS: { key: Align; label: string }[] = [
  { key: 'left', label: '왼쪽' },
  { key: 'center', label: '가운데' },
  { key: 'right', label: '오른쪽' },
]

const SAMPLE: string[][] = [
  ['이름', '점수', '등급'],
  ['민준', '92', 'A'],
  ['서연', '88', 'B'],
  ['도윤', '95', 'A'],
]

const STORE_KEY = 'tabler.v1'

interface Persisted {
  cells: string[][]
  fontSize: number
  headerRow: boolean
  headerCol: boolean
  headerColor: ColorKey
  bodyBg: BodyKey
  align: Align
}

const DEFAULTS: Persisted = {
  cells: SAMPLE.map((r) => [...r]),
  fontSize: 30,
  headerRow: true,
  headerCol: false,
  headerColor: 'cyan',
  bodyBg: 'white',
  align: 'left',
}

/* ---------- app ---------- */

export default function TablerTool() {
  const theme = useTheme()
  const paper = theme === 'paper'
  const initial = useStored(STORE_KEY, DEFAULTS, (saved, defaults) => ({
    ...defaults,
    ...saved,
    // an empty or non-array cells list would render a table with nothing in it
    cells:
      Array.isArray(saved.cells) && saved.cells.length ? saved.cells : defaults.cells,
  }))
  const [cells, setCells] = useState<string[][]>(initial.cells)
  const [fontSize, setFontSize] = useState(initial.fontSize)
  const [headerRow, setHeaderRow] = useState(initial.headerRow)
  const [headerCol, setHeaderCol] = useState(initial.headerCol)
  const [headerColor, setHeaderColor] = useState<ColorKey>(initial.headerColor)
  const [bodyBg, setBodyBg] = useState<BodyKey>(initial.bodyBg)
  const [align, setAlign] = useState<Align>(initial.align)

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)

  const rows = cells.length
  const cols = cells[0]?.length ?? 0

  const persisted = {
    cells,
    fontSize,
    headerRow,
    headerCol,
    headerColor,
    bodyBg,
    align,
  }
  usePersist(STORE_KEY, persisted)

  const history = useHistory(persisted, (s) => {
    setCells(s.cells)
    setFontSize(s.fontSize)
    setHeaderRow(s.headerRow)
    setHeaderCol(s.headerCol)
    setHeaderColor(s.headerColor)
    setBodyBg(s.bodyBg)
    setAlign(s.align)
  })

  /* ---- table edits ---- */
  const setCell = (r: number, c: number, v: string) =>
    setCells((cs) =>
      cs.map((row, ri) =>
        ri === r ? row.map((cell, ci) => (ci === c ? v : cell)) : row,
      ),
    )
  const addRow = () => setCells((cs) => [...cs, Array(cols).fill('')])
  const removeRow = () =>
    setCells((cs) => (cs.length > 1 ? cs.slice(0, -1) : cs))
  const addCol = () => setCells((cs) => cs.map((row) => [...row, '']))
  const removeCol = () =>
    setCells((cs) => (cols > 1 ? cs.map((row) => row.slice(0, -1)) : cs))

  /* ---- font size ---- */
  const bumpFont = (delta: number) =>
    setFontSize((s) => Math.min(FONT_MAX, Math.max(FONT_MIN, s + delta)))

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    signature: `${rows}x${cols}|${fontSize}|${headerRow}|${headerCol}|${align}`,
  })

  const { savePng, copyPng, busy, toast } = usePngExport({
    shotRef,
    filename: 'table',
    /* Cell text renders in the app's body stack, whose first entry (Pretendard)
       is served from a CDN. Embedding it meant html-to-image fetched and
       base64'd every weight of a Korean webfont on each export — 30 s cold,
       2–4 s warm, against 0.25 s for every other tool. The stack's fallbacks
       (Apple SD Gothic Neo · Noto Sans KR · Malgun Gothic) render Korean fine,
       so the PNG uses those instead; letterforms differ slightly from screen. */
  })

  const isHeader = (r: number, c: number) =>
    (headerRow && r === 0) || (headerCol && c === 0)

  return (
    <div className="app">
      {/* toolbar */}
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          Tabler
        </Text>

        <UndoRedo history={history} />

        <div className="toolbar__group" role="group" aria-label="행">
          <span className="toolbar__label">행</span>
          <Button variant="neutral" size="sm" onClick={addRow}>
            +
          </Button>
          <Button
            variant="neutral"
            size="sm"
            onClick={removeRow}
            disabled={rows <= 1}
          >
            −
          </Button>
        </div>

        <div className="toolbar__group" role="group" aria-label="열">
          <span className="toolbar__label">열</span>
          <Button variant="neutral" size="sm" onClick={addCol}>
            +
          </Button>
          <Button
            variant="neutral"
            size="sm"
            onClick={removeCol}
            disabled={cols <= 1}
          >
            −
          </Button>
        </div>

        <div className="toolbar__group" role="group" aria-label="헤더">
          <Button
            variant={headerRow ? 'primary' : 'neutral'}
            size="sm"
            onClick={() => setHeaderRow((v) => !v)}
          >
            헤더 행
          </Button>
          <Button
            variant={headerCol ? 'primary' : 'neutral'}
            size="sm"
            onClick={() => setHeaderCol((v) => !v)}
          >
            헤더 열
          </Button>
        </div>

        <div
          className="toolbar__group"
          role="group"
          aria-label="헤더 색"
          title={paper ? '논문 모드에서는 헤더를 칠하지 않습니다 — 펑키 모드에서 적용됩니다' : undefined}
          style={paper ? { opacity: 0.4 } : undefined}
        >
          <span className="toolbar__label">헤더색</span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                className={`swatch${headerColor === c ? ' swatch--active' : ''}`}
                style={{ background: COLOR_HEX[c] }}
                onClick={() => setHeaderColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="toolbar__group" role="group" aria-label="정렬">
          <span className="toolbar__label">정렬</span>
          {ALIGNS.map((a) => (
            <Button
              key={a.key}
              variant={align === a.key ? 'secondary' : 'neutral'}
              size="sm"
              onClick={() => setAlign(a.key)}
            >
              {a.label}
            </Button>
          ))}
        </div>

        {/* swatches rather than named buttons, like every other colour choice
            in the app */}
        <div className="toolbar__group" role="group" aria-label="셀 배경">
          <span className="toolbar__label">셀</span>
          <div className="swatches">
            {(['white', 'cream'] as BodyKey[]).map((k) => (
              <button
                key={k}
                type="button"
                title={k === 'white' ? '흰색' : '크림'}
                aria-label={k === 'white' ? '흰색' : '크림'}
                aria-pressed={bodyBg === k}
                className={`swatch${bodyBg === k ? ' swatch--active' : ''}`}
                style={{ background: BODY_HEX[k] }}
                onClick={() => setBodyBg(k)}
              />
            ))}
          </div>
        </div>

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

        <div className="toolbar__spacer" />

        <Button
          variant="warning"
          size="sm"
          title="booktabs LaTeX 표로 저장 — 표는 이미지보다 소스로 넣는 편이 낫습니다"
          onClick={() =>
            download(
              textBlob(texTable(cells, { headerRow, headerCol, align })),
              'table.tex',
            )
          }
        >
          TeX
        </Button>
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
            style={{ transform: `scale(${scale})` }}
          >
            <table
              className="tbl"
              style={{
                fontSize,
                ['--body-bg' as string]: paper ? '#ffffff' : BODY_HEX[bodyBg],
              }}
            >
              <tbody>
                {cells.map((row, r) => (
                  <tr key={r}>
                    {row.map((val, c) => {
                      const head = isHeader(r, c)
                      /* Paper mode leaves the fill off entirely rather than
                         letting CSS override it: an inline background would
                         need !important to beat, and a booktabs table has no
                         header fill at all. */
                      const style =
                        head && !paper
                          ? {
                              background: COLOR_HEX[headerColor],
                              color: HEADER_TEXT[headerColor],
                              caretColor: HEADER_TEXT[headerColor],
                            }
                          : undefined
                      /* the mid rule goes under the header *row*; the header
                         column is a different thing and gets no rule */
                      const midrule = paper && headerRow && r === 0
                      return (
                        <td
                          key={c}
                          className={`cell${head ? ' cell--header' : ''}${midrule ? ' cell--midrule' : ''}`}
                          style={style}
                        >
                          <div className="cell__box">
                            <span
                              className="cell__sizer"
                              style={{ textAlign: align }}
                            >
                              {val || ' '}
                            </span>
                            <textarea
                              className="cell__input"
                              style={{ textAlign: align }}
                              value={val}
                              onChange={(e) => setCell(r, c, e.target.value)}
                              spellCheck={false}
                              rows={1}
                              aria-label={`셀 ${r + 1}, ${c + 1}`}
                            />
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* the toast lives in the stage so its offset does not depend on how
            much chrome this particular tool puts below it */}
        {toast && <div className="toast">{toast}</div>}
      </div>

      <Text variant="chrome" muted className="hint">
        셀을 클릭해 편집 · 행 / 열 추가 · 헤더 · 정렬 조절 후 투명 PNG로 저장 ·
        복사로 슬라이드에 붙여넣기
      </Text>
    </div>
  )
}
