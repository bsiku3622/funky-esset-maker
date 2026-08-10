import {
  DPI_CHOICES,
  MIN_READABLE_PT,
  WIDTH_PRESETS,
  inPx,
  type WidthPreset,
} from './paper'
import './PrintBar.css'

/* Print controls for the vector tools: how wide the figure lands on the page,
 * and how dense the PNG fallback is.
 *
 * The width preset does two things at once, and doing only one of them is the
 * mistake this component exists to prevent. It sets the physical width written
 * into the SVG *and* resizes the canvas to match, because a figure authored at
 * 760 px and printed at 3.25 inches has 4 pt labels — valid, unreadable, and
 * invisible until the PDF comes back from the typesetter. The pt readout is
 * there so the number is never a surprise. */

export interface PrintBarProps {
  widthId: string
  /** the caller resizes its canvas to `px` and stores `id` */
  onWidth: (id: string, px: number) => void
  dpi: number
  onDpi: (dpi: number) => void
  /** printed size of the figure's tick/label text, in points */
  labelPt: number
  /** what the current dpi would produce */
  pixels: { w: number; h: number }
}

const groups = WIDTH_PRESETS.reduce<Record<string, WidthPreset[]>>((acc, p) => {
  ;(acc[p.group] ??= []).push(p)
  return acc
}, {})

export default function PrintBar({
  widthId,
  onWidth,
  dpi,
  onDpi,
  labelPt,
  pixels,
}: PrintBarProps) {
  const tooSmall = labelPt > 0 && labelPt < MIN_READABLE_PT

  return (
    <>
      <div className="toolbar__group">
        <span className="toolbar__label">인쇄</span>
        <select
          className="fx-print__select"
          value={widthId}
          aria-label="출력 폭"
          onChange={(e) => {
            const p = WIDTH_PRESETS.find((w) => w.id === e.target.value)
            if (!p) return
            // widthIn 0 is "screen size" — leave the canvas alone
            onWidth(p.id, p.widthIn > 0 ? inPx(p.widthIn) : 0)
          }}
        >
          {Object.entries(groups).map(([group, list]) => (
            <optgroup key={group} label={group}>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="toolbar__group">
        <span className="toolbar__label">dpi</span>
        <select
          className="fx-print__select fx-print__select--dpi"
          value={dpi}
          aria-label="PNG 해상도"
          onChange={(e) => onDpi(Number(e.target.value))}
        >
          {DPI_CHOICES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <span
          className={`fx-print__readout${tooSmall ? ' is-warn' : ''}`}
          title={
            tooSmall
              ? `라벨이 ${MIN_READABLE_PT}pt 미만입니다 — 인쇄 폭을 넓히거나 캔버스를 줄이세요 · PNG ${pixels.w}×${pixels.h}px`
              : `라벨의 인쇄 크기 · PNG ${pixels.w}×${pixels.h}px`
          }
        >
          {labelPt > 0 ? `${labelPt.toFixed(1)}pt` : '—'}
        </span>
      </div>
    </>
  )
}
