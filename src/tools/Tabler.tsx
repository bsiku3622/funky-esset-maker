import { useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import {
  useFitScale,
  useHistory,
  useLatest,
  usePersist,
  usePngExport,
  useStored,
} from './hooks'
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

type FontKey = 'sans' | 'serif' | 'mono'

/* Set on the table, so the sizer and the textarea inherit one value. ⚠️ Never
 * give the two different families: the span draws the glyphs and the textarea
 * draws the selection, and any difference in metrics pulls them apart — the
 * header weight did exactly that until it was fixed. */
const FONT_STACK: Record<FontKey, string> = {
  sans: 'inherit',
  serif: '"Times New Roman", "Nimbus Roman", "Liberation Serif", Times, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
}
const FONTS: { key: FontKey; label: string }[] = [
  { key: 'sans', label: '본문' },
  { key: 'serif', label: 'Times' },
  { key: 'mono', label: 'Mono' },
]

/** Cell fills, keyed by position. */
const at = (r: number, c: number) => `${r},${c}`

/* A neon at full strength swallows the text on it. Cell fills are a background
 * for black type, so the palette is reused at a wash instead of adding a second
 * set of colours that would drift from the first. */
function tintOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * 0.62)
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`
}

/* A rectangle drawn around a run of cells — "이 행이 결론" and the like.
 * It is part of the figure, not editor chrome, so it exports. */
interface Box {
  r0: number
  c0: number
  r1: number
  c1: number
  color: string
}

interface Sel {
  r0: number
  c0: number
  r1: number
  c1: number
}

/** Corners in any order, read back as top-left → bottom-right. */
const norm = (s: Sel): Sel => ({
  r0: Math.min(s.r0, s.r1),
  c0: Math.min(s.c0, s.c1),
  r1: Math.max(s.r0, s.r1),
  c1: Math.max(s.c0, s.c1),
})
const inSel = (s: Sel, r: number, c: number) => {
  const n = norm(s)
  return r >= n.r0 && r <= n.r1 && c >= n.c0 && c <= n.c1
}

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
  fontFamily: FontKey
  headerRow: boolean
  headerCol: boolean
  headerColor: ColorKey
  bodyBg: BodyKey
  align: Align
  /** per-column width in px; null lets the column size to its text */
  colW: (number | null)[]
  /** per-cell background, keyed `row,col` */
  fills: Record<string, string>
  boxes: Box[]
}

const DEFAULTS: Persisted = {
  cells: SAMPLE.map((r) => [...r]),
  fontSize: 30,
  fontFamily: 'sans',
  headerRow: true,
  headerCol: false,
  headerColor: 'cyan',
  bodyBg: 'white',
  align: 'left',
  colW: [],
  fills: {},
  boxes: [],
}

/* ---------- inserting and removing ---------- */

/* ⚠️ Everything filed by position has to move when a row or column is spliced
 * in — the fills are keyed `row,col` and the boxes are corner pairs. Adding a
 * row above a highlighted one used to leave the highlight on the row that
 * moved down into its place, which is a quiet enough wrong that it survives
 * until the figure is printed. */
const shift = (i: number, at: number, delta: 1 | -1) =>
  delta === 1 ? (i >= at ? i + 1 : i) : i === at ? -1 : i > at ? i - 1 : i

function spliceFills(
  fills: Record<string, string>,
  axis: 'row' | 'col',
  index: number,
  delta: 1 | -1,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(fills)) {
    const [r, c] = key.split(',').map(Number)
    const moved = axis === 'row' ? shift(r, index, delta) : shift(c, index, delta)
    if (moved < 0) continue
    out[axis === 'row' ? at(moved, c) : at(r, moved)] = v
  }
  return out
}

function spliceBoxes(boxes: Box[], axis: 'row' | 'col', index: number, delta: 1 | -1): Box[] {
  const lo = axis === 'row' ? 'r0' : 'c0'
  const hi = axis === 'row' ? 'r1' : 'c1'
  return boxes.flatMap((b) => {
    /* A box keeps its span: a row added inside it grows it, a row taken from
       inside it shrinks it, and one that loses its whole extent is dropped. */
    const a = b[lo] >= index ? b[lo] + delta : b[lo]
    const z = b[hi] >= index ? b[hi] + delta : b[hi]
    return z < a ? [] : [{ ...b, [lo]: Math.max(0, a), [hi]: z }]
  })
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
  const [fontFamily, setFontFamily] = useState<FontKey>(initial.fontFamily)
  const [headerRow, setHeaderRow] = useState(initial.headerRow)
  const [headerCol, setHeaderCol] = useState(initial.headerCol)
  const [headerColor, setHeaderColor] = useState<ColorKey>(initial.headerColor)
  const [bodyBg, setBodyBg] = useState<BodyKey>(initial.bodyBg)
  const [align, setAlign] = useState<Align>(initial.align)
  const [colW, setColW] = useState<(number | null)[]>(initial.colW)
  const [fills, setFills] = useState<Record<string, string>>(initial.fills)
  const [boxes, setBoxes] = useState<Box[]>(initial.boxes)
  /* Which cells the formatting buttons act on. Not persisted — it is where you
     are, not what the table is. */
  const [sel, setSel] = useState<Sel | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)

  const rows = cells.length
  const cols = cells[0]?.length ?? 0

  const persisted = {
    cells,
    fontSize,
    fontFamily,
    headerRow,
    headerCol,
    headerColor,
    bodyBg,
    align,
    colW,
    fills,
    boxes,
  }
  usePersist(STORE_KEY, persisted)

  const history = useHistory(persisted, (s) => {
    setCells(s.cells)
    setFontSize(s.fontSize)
    setFontFamily(s.fontFamily)
    setHeaderRow(s.headerRow)
    setHeaderCol(s.headerCol)
    setHeaderColor(s.headerColor)
    setBodyBg(s.bodyBg)
    setAlign(s.align)
    setColW(s.colW)
    setFills(s.fills)
    setBoxes(s.boxes)
  })

  /* ---- table edits ---- */
  const setCell = (r: number, c: number, v: string) =>
    setCells((cs) =>
      cs.map((row, ri) =>
        ri === r ? row.map((cell, ci) => (ci === c ? v : cell)) : row,
      ),
    )
  /* Row and column edits happen *at* a place rather than only at the end, so
     they all go through one pair that also moves everything filed by position. */
  const insertRow = (index: number) => {
    setCells((cs) => [...cs.slice(0, index), Array(cols).fill(''), ...cs.slice(index)])
    setFills((f) => spliceFills(f, 'row', index, 1))
    setBoxes((b) => spliceBoxes(b, 'row', index, 1))
    setSel({ r0: index, c0: 0, r1: index, c1: cols - 1 })
  }
  const deleteRow = (index: number) => {
    if (rows <= 1) return
    setCells((cs) => cs.filter((_, i) => i !== index))
    setFills((f) => spliceFills(f, 'row', index, -1))
    setBoxes((b) => spliceBoxes(b, 'row', index, -1))
    setSel(null)
  }
  const insertCol = (index: number) => {
    setCells((cs) => cs.map((row) => [...row.slice(0, index), '', ...row.slice(index)]))
    setColW((w) => [...w.slice(0, index), null, ...w.slice(index)])
    setFills((f) => spliceFills(f, 'col', index, 1))
    setBoxes((b) => spliceBoxes(b, 'col', index, 1))
    setSel({ r0: 0, c0: index, r1: rows - 1, c1: index })
  }
  const deleteCol = (index: number) => {
    if (cols <= 1) return
    setCells((cs) => cs.map((row) => row.filter((_, i) => i !== index)))
    setColW((w) => w.filter((_, i) => i !== index))
    setFills((f) => spliceFills(f, 'col', index, -1))
    setBoxes((b) => spliceBoxes(b, 'col', index, -1))
    setSel(null)
  }

  /* ---- what the formatting buttons act on ---- */
  const target = sel ? norm(sel) : null
  const eachInSel = (fn: (r: number, c: number) => void) => {
    if (!target) return
    for (let r = target.r0; r <= target.r1; r++)
      for (let c = target.c0; c <= target.c1; c++) fn(r, c)
  }
  const paintSel = (color: string | null) => {
    if (!target) return
    setFills((f) => {
      const next = { ...f }
      eachInSel((r, c) => {
        if (color) next[at(r, c)] = color
        else delete next[at(r, c)]
      })
      return next
    })
  }
  const boxSel = (color: string) => {
    if (!target) return
    setBoxes((b) => [
      // one box per region: drawing two on the same cells just thickens the line
      ...b.filter(
        (x) => !(x.r0 === target.r0 && x.c0 === target.c0 && x.r1 === target.r1 && x.c1 === target.c1),
      ),
      { ...target, color },
    ])
  }
  const unboxSel = () => {
    if (!target) return
    setBoxes((b) =>
      b.filter((x) => !(x.r0 === target.r0 && x.c0 === target.c0 && x.r1 === target.r1 && x.c1 === target.c1)),
    )
  }

  /* ---- font size ---- */
  const bumpFont = (delta: number) =>
    setFontSize((s) => Math.min(FONT_MAX, Math.max(FONT_MIN, s + delta)))

  /* ---- dragging a column wider ---- */
  /* The grip is inside the cell and absolutely positioned, so it takes up no
     room: the export can drop it without the table moving underneath. Widths
     are measured on screen and divided by the preview scale, or a table shown
     at 60% would grow two pixels for every one dragged. */
  const resizeRef = useRef<{ col: number; startX: number; startW: number } | null>(null)
  const startResize = (col: number, ev: React.PointerEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
    const cell = (ev.currentTarget as HTMLElement).closest('td')
    resizeRef.current = {
      col,
      startX: ev.clientX,
      startW: (cell?.getBoundingClientRect().width ?? 0) / (scaleRef.current || 1),
    }
    const move = (e: PointerEvent) => {
      const d = resizeRef.current
      if (!d) return
      const w = Math.max(40, Math.round(d.startW + (e.clientX - d.startX) / (scaleRef.current || 1)))
      setColW((cur) => {
        const next = [...cur]
        while (next.length < cols) next.push(null)
        next[d.col] = w
        return next
      })
    }
    const up = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    signature: `${rows}x${cols}|${fontSize}|${headerRow}|${headerCol}|${align}`,
  })

  // the resize handler runs outside React and needs the live scale
  const scaleRef = useLatest(scale)

  const { savePng, copyPng, busy, toast } = usePngExport({
    shotRef,
    filename: 'table',
    /* Selection rings and resize grips are editor chrome. They carry no layout
       weight — absolutely positioned inside the cell — so dropping them here
       takes them out of the picture without moving anything that stays. */
    /* ⚠️ Presence, not value. The marker is written `data-ui=""`, so reading
       it as `node.dataset.ui` yields an empty string — falsy — and every piece
       of chrome sailed straight into the PNG. The SVG exporter matches on
       `[data-ui]` for the same reason; the two have to agree. */
    options: () => ({
      filter: (node: HTMLElement) => !node.hasAttribute?.('data-ui'),
    }),
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

        {/* Rows and columns go in *where you are*, which is what makes a table
            editable after the first draft. With nothing selected they still
            append, so the old one-button habit keeps working. */}
        <div className="toolbar__group" role="group" aria-label="행">
          <span className="toolbar__label">행</span>
          <Button
            variant="neutral"
            size="sm"
            title="선택한 행 위에 삽입"
            onClick={() => insertRow(target ? target.r0 : rows)}
          >
            ↑+
          </Button>
          <Button
            variant="neutral"
            size="sm"
            title="선택한 행 아래에 삽입 · 선택이 없으면 맨 끝"
            onClick={() => insertRow(target ? target.r1 + 1 : rows)}
          >
            ↓+
          </Button>
          <Button
            variant="neutral"
            size="sm"
            title="선택한 행 삭제 · 선택이 없으면 마지막 행"
            onClick={() => deleteRow(target ? target.r0 : rows - 1)}
            disabled={rows <= 1}
          >
            −
          </Button>
        </div>

        <div className="toolbar__group" role="group" aria-label="열">
          <span className="toolbar__label">열</span>
          <Button
            variant="neutral"
            size="sm"
            title="선택한 열 왼쪽에 삽입"
            onClick={() => insertCol(target ? target.c0 : cols)}
          >
            ←+
          </Button>
          <Button
            variant="neutral"
            size="sm"
            title="선택한 열 오른쪽에 삽입 · 선택이 없으면 맨 끝"
            onClick={() => insertCol(target ? target.c1 + 1 : cols)}
          >
            +→
          </Button>
          <Button
            variant="neutral"
            size="sm"
            title="선택한 열 삭제 · 선택이 없으면 마지막 열"
            onClick={() => deleteCol(target ? target.c0 : cols - 1)}
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
        <div className="toolbar__group" role="group" aria-label="표 배경">
          <span className="toolbar__label">표</span>
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

        {/* Everything here acts on the selection, so it is disabled without
            one — a colour button that silently does nothing is worse than a
            greyed one that says why. */}
        <div
          className="toolbar__group"
          role="group"
          aria-label="선택 영역"
          title={target ? undefined : '셀을 클릭해 선택하세요 · Shift+클릭으로 범위'}
          style={target ? undefined : { opacity: 0.4 }}
        >
          <span className="toolbar__label">선택</span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={`${c} 칠하기`}
                className="swatch"
                disabled={!target}
                style={{ background: tintOf(COLOR_HEX[c]) }}
                onClick={() => paintSel(tintOf(COLOR_HEX[c]))}
              />
            ))}
            <button
              type="button"
              title="칠 지우기"
              className="swatch swatch--none"
              disabled={!target}
              onClick={() => paintSel(null)}
            />
          </div>
          <Button
            variant="neutral"
            size="sm"
            title="선택 영역에 강조 상자 — 그림의 일부라 저장됩니다"
            disabled={!target}
            onClick={() => boxSel(COLOR_HEX[headerColor])}
          >
            □ 강조
          </Button>
          <Button
            variant="neutral"
            size="sm"
            title="이 영역의 강조 상자 지우기"
            disabled={!target}
            onClick={unboxSel}
          >
            □ 해제
          </Button>
        </div>

        <div className="toolbar__group" role="group" aria-label="글꼴">
          <span className="toolbar__label">글꼴</span>
          {FONTS.map((f) => (
            <Button
              key={f.key}
              variant={fontFamily === f.key ? 'secondary' : 'neutral'}
              size="sm"
              onClick={() => setFontFamily(f.key)}
            >
              {f.label}
            </Button>
          ))}
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
                fontFamily: FONT_STACK[fontFamily],
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
                      const fill = fills[at(r, c)]
                      const style: React.CSSProperties =
                        head && !paper
                          ? {
                              background: COLOR_HEX[headerColor],
                              color: HEADER_TEXT[headerColor],
                              caretColor: HEADER_TEXT[headerColor],
                            }
                          : {}
                      // a hand-painted cell beats the header fill: it was asked for
                      if (fill) style.background = fill
                      const w = colW[c]
                      if (w) style.width = w
                      /* The emphasis rectangles are drawn as inset shadows on
                         the cells along their edges. A border would fight the
                         cell's own; an absolutely positioned overlay would sit
                         outside the table's flow and have to be measured. */
                      const edges: string[] = []
                      for (const b of boxes) {
                        if (r < b.r0 || r > b.r1 || c < b.c0 || c > b.c1) continue
                        if (r === b.r0) edges.push(`inset 0 3px 0 0 ${b.color}`)
                        if (r === b.r1) edges.push(`inset 0 -3px 0 0 ${b.color}`)
                        if (c === b.c0) edges.push(`inset 3px 0 0 0 ${b.color}`)
                        if (c === b.c1) edges.push(`inset -3px 0 0 0 ${b.color}`)
                      }
                      if (edges.length) style.boxShadow = edges.join(', ')
                      const picked = sel ? inSel(sel, r, c) : false
                      /* the mid rule goes under the header *row*; the header
                         column is a different thing and gets no rule */
                      const midrule = paper && headerRow && r === 0
                      return (
                        <td
                          key={c}
                          className={`cell${head ? ' cell--header' : ''}${midrule ? ' cell--midrule' : ''}${w ? ' cell--fixed' : ''}`}
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
                              /* Chrome, despite holding the text: its glyphs
                                 are transparent — the sizer draws what you see
                                 — so all it could add to an export is its own
                                 focus tint. Absolutely positioned, so dropping
                                 it moves nothing. */
                              data-ui=""
                              style={{ textAlign: align }}
                              value={val}
                              onChange={(e) => setCell(r, c, e.target.value)}
                              /* Clicking a cell is also how it gets picked, so
                                 the caret and the selection arrive together.
                                 Shift reaches from the anchor to here, which
                                 inside one textarea would extend the *text*
                                 selection — across two cells it cannot mean
                                 that, so it is ours to use. */
                              onPointerDown={(e) => {
                                if (e.shiftKey && sel) {
                                  e.preventDefault()
                                  ;(e.currentTarget as HTMLTextAreaElement).blur()
                                  setSel({ ...sel, r1: r, c1: c })
                                }
                              }}
                              onFocus={() => setSel({ r0: r, c0: c, r1: r, c1: c })}
                              spellCheck={false}
                              rows={1}
                              aria-label={`셀 ${r + 1}, ${c + 1}`}
                            />
                            {picked ? <span className="cell__pick" data-ui="" /> : null}
                            {/* one grip per column, on the top row */}
                            {r === 0 ? (
                              <span
                                className="cell__grip"
                                data-ui=""
                                title="끌어서 열 너비 · 두 번 누르면 글자에 맞춤"
                                onPointerDown={(e) => startResize(c, e)}
                                onDoubleClick={() =>
                                  setColW((cur) => {
                                    const next = [...cur]
                                    while (next.length < cols) next.push(null)
                                    next[c] = null
                                    return next
                                  })
                                }
                              />
                            ) : null}
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
