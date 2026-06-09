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

function loadState(): Persisted {
  const fallback: Persisted = {
    cells: SAMPLE.map((r) => [...r]),
    fontSize: 30,
    headerRow: true,
    headerCol: false,
    headerColor: 'cyan',
    bodyBg: 'white',
    align: 'left',
  }
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return fallback
    const saved = JSON.parse(raw) as Partial<Persisted>
    const cells =
      Array.isArray(saved.cells) && saved.cells.length
        ? saved.cells
        : fallback.cells
    return {
      cells,
      fontSize: saved.fontSize ?? fallback.fontSize,
      headerRow: saved.headerRow ?? fallback.headerRow,
      headerCol: saved.headerCol ?? fallback.headerCol,
      headerColor: saved.headerColor ?? fallback.headerColor,
      bodyBg: saved.bodyBg ?? fallback.bodyBg,
      align: saved.align ?? fallback.align,
    }
  } catch {
    return fallback
  }
}

/* ---------- app ---------- */

export default function TablerTool() {
  const initial = useMemo(loadState, [])
  const [cells, setCells] = useState<string[][]>(initial.cells)
  const [fontSize, setFontSize] = useState(initial.fontSize)
  const [headerRow, setHeaderRow] = useState(initial.headerRow)
  const [headerCol, setHeaderCol] = useState(initial.headerCol)
  const [headerColor, setHeaderColor] = useState<ColorKey>(initial.headerColor)
  const [bodyBg, setBodyBg] = useState<BodyKey>(initial.bodyBg)
  const [align, setAlign] = useState<Align>(initial.align)

  // preview scale — fit the (full-size) table into the stage; export ignores it
  const [scale, setScale] = useState(1)
  const [nat, setNat] = useState({ w: 0, h: 0 })

  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)

  const rows = cells.length
  const cols = cells[0]?.length ?? 0

  /* persist */
  useEffect(() => {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          cells,
          fontSize,
          headerRow,
          headerCol,
          headerColor,
          bodyBg,
          align,
        }),
      )
    } catch {
      /* ignore */
    }
  }, [cells, fontSize, headerRow, headerCol, headerColor, bodyBg, align])

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

  /* ---- preview scale: fit the table card into the stage ---- */
  const recomputeScale = useCallback(() => {
    const stage = stageRef.current
    const shot = shotRef.current
    if (!stage || !shot) return
    const cs = getComputedStyle(stage)
    const availW =
      stage.clientWidth -
      parseFloat(cs.paddingLeft) -
      parseFloat(cs.paddingRight)
    const availH =
      stage.clientHeight -
      parseFloat(cs.paddingTop) -
      parseFloat(cs.paddingBottom)
    const natW = shot.offsetWidth
    const natH = shot.offsetHeight
    if (natW === 0 || natH === 0) return
    const s = Math.max(0.05, Math.min(1, availW / natW, availH / natH))
    setNat((p) => (p.w !== natW || p.h !== natH ? { w: natW, h: natH } : p))
    setScale((p) => (Math.abs(p - s) > 0.001 ? s : p))
  }, [])

  useLayoutEffect(() => {
    recomputeScale()
  }, [recomputeScale, cells, fontSize, headerRow, headerCol, align])

  useEffect(() => {
    const stage = stageRef.current
    const shot = shotRef.current
    if (!stage || !shot) return
    const ro = new ResizeObserver(recomputeScale)
    ro.observe(stage)
    ro.observe(shot)
    return () => ro.disconnect()
  }, [recomputeScale])

  /* ---- flash a small toast ---- */
  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 1800)
  }

  /* ---- PNG export: rasterize the table at full resolution ---- */
  const makeBlob = useCallback(async (): Promise<Blob | null> => {
    const node = shotRef.current
    if (!node) return null
    return toBlob(node, {
      pixelRatio: 3, // crisp on projectors
      cacheBust: true,
      skipFonts: false, // keep the body font for the cell text
      width: node.offsetWidth,
      height: node.offsetHeight,
      style: { transform: 'none', transformOrigin: 'top left' },
    })
  }, [])

  const withExport = async (run: (blob: Blob) => void | Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      const blob = await makeBlob()
      if (!blob) {
        flash('이미지를 만들지 못했습니다')
        return
      }
      await run(blob)
    } catch {
      flash('내보내기 실패')
    } finally {
      setBusy(false)
    }
  }

  const savePng = () =>
    withExport((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'table.png'
      a.click()
      URL.revokeObjectURL(url)
      flash('PNG로 저장했습니다')
    })

  const copyPng = () =>
    withExport(async (blob) => {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ])
        flash('클립보드에 복사했습니다')
      } catch {
        flash('복사 실패 — 저장을 이용하세요')
      }
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

        <div className="toolbar__group" role="group" aria-label="헤더 색">
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

        <div className="toolbar__group" role="group" aria-label="셀 배경">
          <span className="toolbar__label">셀</span>
          <Button
            variant={bodyBg === 'white' ? 'warning' : 'neutral'}
            size="sm"
            onClick={() => setBodyBg('white')}
          >
            흰색
          </Button>
          <Button
            variant={bodyBg === 'cream' ? 'warning' : 'neutral'}
            size="sm"
            onClick={() => setBodyBg('cream')}
          >
            크림
          </Button>
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

        <Button variant="success" size="sm" onClick={savePng} disabled={busy}>
          PNG 저장
        </Button>
        <Button variant="info" size="sm" onClick={copyPng} disabled={busy}>
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
              style={{ fontSize, ['--body-bg' as string]: BODY_HEX[bodyBg] }}
            >
              <tbody>
                {cells.map((row, r) => (
                  <tr key={r}>
                    {row.map((val, c) => {
                      const head = isHeader(r, c)
                      const style = head
                        ? {
                            background: COLOR_HEX[headerColor],
                            color: HEADER_TEXT[headerColor],
                            caretColor: HEADER_TEXT[headerColor],
                          }
                        : undefined
                      return (
                        <td
                          key={c}
                          className={`cell${head ? ' cell--header' : ''}`}
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
      </div>

      <Text variant="chrome" muted className="hint">
        셀을 클릭해 편집 · 행 / 열 추가 · 헤더 · 정렬 조절 후 투명 PNG로 저장 ·
        복사로 슬라이드에 붙여넣기
      </Text>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
