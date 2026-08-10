import type { Ref } from 'react'
import { CHART_PALETTE } from './palette'
import { UI_ONLY, figColors, type FigureTheme } from './figure'
import './cores.css'

/* Chart — display-only render core extracted from the Chart Maker tool.
   Bar / line / pie / scatter as a self-contained SVG (+ pie legend).

   Two things here exist for the host tool rather than for display: `svgRef`,
   because vector export serialises this element rather than re-drawing it, and
   `onPick`/`selected`, because the tool lets you click a bar to edit it. Both
   are optional and a plain host can ignore them. */

export type ChartType = 'bar' | 'line' | 'pie' | 'scatter'
export type ChartBg = 'transparent' | 'cream' | 'white' | 'dark'

export interface ChartDatum {
  label: string
  value: number
}
export interface ChartPoint {
  x: number
  y: number
}

export interface ChartProps {
  type: ChartType
  data?: ChartDatum[]
  points?: ChartPoint[]
  title?: string
  /** palette index (0..6) */
  accent?: number
  showValues?: boolean
  width?: number
  height?: number
  bg?: ChartBg
  /** 'funky' neon on black outlines, or 'paper' hairline journal style */
  theme?: FigureTheme
  /** where the pie legend is drawn. 'svg' keeps it inside the exported file;
   *  'html' is the original flow layout and stays the default for hosts that
   *  were laying it out themselves. */
  legend?: 'html' | 'svg'
  svgRef?: Ref<SVGSVGElement>
  /** index of the selected datum/point, for the editing host */
  selected?: number | null
  onPick?: (index: number) => void
}

const BG_HEX: Record<ChartBg, string | null> = {
  transparent: null,
  cream: '#fff5d1',
  white: '#ffffff',
  dark: '#1e1e22',
}

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

export default function Chart({
  type,
  data = [],
  points = [],
  title,
  accent = 0,
  showValues = true,
  width = 640,
  height = 440,
  bg = 'transparent',
  theme = 'funky',
  legend = 'html',
  svgRef,
  selected = null,
  onPick,
}: ChartProps) {
  const figW = width
  const figH = height
  const bgHex = BG_HEX[bg]
  const paper = theme === 'paper'
  const c = figColors(theme, bg === 'dark', CHART_PALETTE)
  const color = (i: number) => c.series[(accent + i) % c.series.length]

  /* Paper thins every rule and stops outlining the fills; a bar chart in a
     journal is flat colour against a hairline axis. */
  const G = paper
    ? { axis: 1, gridW: 0.7, out: 0.6, line: 1.6, dot: 3.2, titleFont: 13, tickFont: 10, labelFont: 10 }
    : { axis: 2, gridW: 1, out: 2, line: 3, dot: 5, titleFont: 20, tickFont: 12, labelFont: 13 }

  const PADL = paper ? 40 : 56
  const PADR = paper ? 14 : 24
  const PADT = title ? (paper ? 30 : 44) : paper ? 14 : 24
  const PADB = paper ? 34 : 52
  const legendW = legend === 'svg' && type === 'pie' ? Math.min(180, figW * 0.28) : 0
  const plotW = figW - PADL - PADR - legendW
  const plotH = figH - PADT - PADB
  const x0 = PADL
  const yBase = figH - PADB

  const maxV = Math.max(1, ...data.map((d) => d.value), 0)
  const vStep = niceStep(maxV)
  const vMax = Math.max(vStep, Math.ceil(maxV / vStep) * vStep)
  const vt: number[] = []
  for (let v = 0; v <= vMax + vStep * 1e-6; v += vStep) vt.push(+v.toFixed(6))
  const vy = (v: number) => yBase - (v / vMax) * plotH

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

  const pieTotal = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1
  const pieR = Math.min(plotW, plotH) / 2 - 6
  const pieCx = PADL + plotW / 2
  const pieCy = PADT + plotH / 2
  let a = -Math.PI / 2
  const pieSlices = data.map((d, i) => {
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

  const pick = (i: number) => (e: React.PointerEvent) => {
    if (!onPick) return
    e.stopPropagation()
    onPick(i)
  }
  const cursor = onPick ? 'pointer' : undefined

  /** the purple ring is editor state, never part of the exported file */
  const ring = (props: Record<string, string | number>) => (
    <rect
      {...{ [UI_ONLY]: '1' }}
      {...props}
      fill="none"
      stroke="#7828c8"
      strokeWidth={2}
    />
  )

  return (
    <div className="fx-chart" style={bgHex ? { background: bgHex } : undefined}>
      <svg
        ref={svgRef}
        width={figW}
        height={figH}
        viewBox={`0 0 ${figW} ${figH}`}
        fontFamily={c.text}
      >
        {title && (
          <text
            x={(figW - legendW) / 2}
            y={paper ? 20 : 26}
            textAnchor="middle"
            fontSize={G.titleFont}
            fontWeight={paper ? 700 : 800}
            fill={c.ink}
          >
            {title}
          </text>
        )}

        {(type === 'bar' || type === 'line') && (
          <g>
            {vt.map((t, i) => (
              <g key={i}>
                <line x1={PADL} y1={vy(t)} x2={figW - PADR} y2={vy(t)} stroke={c.grid} strokeWidth={G.gridW} />
                <text x={PADL - 8} y={vy(t) + 4} textAnchor="end" fontSize={G.tickFont} fill={c.muted} fontFamily={c.numeric}>
                  {fmt(t)}
                </text>
              </g>
            ))}
            <line x1={PADL} y1={PADT} x2={PADL} y2={yBase} stroke={c.ink} strokeWidth={G.axis} />
            <line x1={PADL} y1={yBase} x2={figW - PADR} y2={yBase} stroke={c.ink} strokeWidth={G.axis} />
          </g>
        )}

        {type === 'bar' &&
          data.map((d, i) => {
            const n = data.length
            const slot = plotW / n
            const bw = slot * 0.62
            const bx = x0 + slot * i + (slot - bw) / 2
            const by = vy(d.value)
            return (
              <g key={i} onPointerDown={pick(i)} style={{ cursor }}>
                <rect
                  x={bx}
                  y={by}
                  width={bw}
                  height={Math.max(0, yBase - by)}
                  fill={color(i)}
                  stroke={c.outline ?? undefined}
                  strokeWidth={c.outline ? G.out : undefined}
                />
                {selected === i && ring({ x: bx - 3, y: by - 3, width: bw + 6, height: Math.max(0, yBase - by) + 6 })}
                {showValues && (
                  <text x={bx + bw / 2} y={by - 6} textAnchor="middle" fontSize={G.labelFont} fontWeight={c.bold} fill={c.ink}>
                    {fmt(d.value)}
                  </text>
                )}
                <text x={bx + bw / 2} y={yBase + (paper ? 14 : 18)} textAnchor="middle" fontSize={G.labelFont} fill={c.ink}>
                  {d.label}
                </text>
              </g>
            )
          })}

        {type === 'line' && data.length > 0 && (
          <g>
            <polyline
              points={data.map((d, i) => `${x0 + (plotW / data.length) * (i + 0.5)},${vy(d.value)}`).join(' ')}
              fill="none"
              stroke={color(0)}
              strokeWidth={G.line}
              strokeLinejoin="round"
            />
            {data.map((d, i) => {
              const cx = x0 + (plotW / data.length) * (i + 0.5)
              return (
                <g key={i} onPointerDown={pick(i)} style={{ cursor }}>
                  <circle
                    cx={cx}
                    cy={vy(d.value)}
                    r={G.dot}
                    fill={paper ? color(0) : c.hole}
                    stroke={c.outline ?? undefined}
                    strokeWidth={c.outline ? G.out : undefined}
                  />
                  {selected === i && ring({ x: cx - G.dot - 4, y: vy(d.value) - G.dot - 4, width: G.dot * 2 + 8, height: G.dot * 2 + 8 })}
                  {showValues && (
                    <text x={cx} y={vy(d.value) - 10} textAnchor="middle" fontSize={G.labelFont} fontWeight={c.bold} fill={c.ink}>
                      {fmt(d.value)}
                    </text>
                  )}
                  <text x={cx} y={yBase + (paper ? 14 : 18)} textAnchor="middle" fontSize={G.labelFont} fill={c.ink}>
                    {d.label}
                  </text>
                </g>
              )
            })}
          </g>
        )}

        {type === 'pie' &&
          pieSlices.map((s) => (
            <g key={s.i} onPointerDown={pick(s.i)} style={{ cursor }}>
              <path
                d={s.path}
                fill={color(s.i)}
                stroke={c.outline ?? (paper ? '#ffffff' : undefined)}
                strokeWidth={c.outline ? G.out : paper ? 0.8 : undefined}
              />
              {selected === s.i && (
                <path
                  {...{ [UI_ONLY]: '1' }}
                  d={s.path}
                  fill="none"
                  stroke="#7828c8"
                  strokeWidth={2.5}
                />
              )}
              {showValues && s.frac > 0.04 && (
                <text x={s.lx} y={s.ly} textAnchor="middle" fontSize={G.labelFont} fontWeight={c.bold} fill={paper ? '#ffffff' : '#222'}>
                  {Math.round(s.frac * 100)}%
                </text>
              )}
            </g>
          ))}

        {/* pie legend, drawn inside the SVG so the export is one file */}
        {type === 'pie' && legend === 'svg' && (
          <g fontSize={G.labelFont} fill={c.ink}>
            {data.map((d, i) => {
              const ly = PADT + 6 + i * (G.labelFont + 8)
              const lx = figW - legendW + 4
              const box = G.labelFont
              return (
                <g key={i} onPointerDown={pick(i)} style={{ cursor }}>
                  <rect
                    x={lx}
                    y={ly}
                    width={box}
                    height={box}
                    fill={color(i)}
                    stroke={c.outline ?? undefined}
                    strokeWidth={c.outline ? G.out : undefined}
                  />
                  <text x={lx + box + 6} y={ly + box - 2} fontWeight={selected === i ? 700 : c.bold === 700 ? 700 : 400}>
                    {d.label}
                  </text>
                </g>
              )
            })}
          </g>
        )}

        {type === 'scatter' && (
          <g>
            {syt.map((t, i) => (
              <g key={`sy${i}`}>
                <line x1={PADL} y1={scY(t)} x2={figW - PADR} y2={scY(t)} stroke={c.grid} strokeWidth={G.gridW} />
                <text x={PADL - 8} y={scY(t) + 4} textAnchor="end" fontSize={G.tickFont} fill={c.muted} fontFamily={c.numeric}>
                  {fmt(t)}
                </text>
              </g>
            ))}
            {sxt.map((t, i) => (
              <text key={`sx${i}`} x={scX(t)} y={yBase + (paper ? 14 : 18)} textAnchor="middle" fontSize={G.tickFont} fill={c.muted} fontFamily={c.numeric}>
                {fmt(t)}
              </text>
            ))}
            <line x1={PADL} y1={PADT} x2={PADL} y2={yBase} stroke={c.ink} strokeWidth={G.axis} />
            <line x1={PADL} y1={yBase} x2={figW - PADR} y2={yBase} stroke={c.ink} strokeWidth={G.axis} />
            {points.map((p, i) => (
              <g key={i} onPointerDown={pick(i)} style={{ cursor }}>
                <circle
                  cx={scX(p.x)}
                  cy={scY(p.y)}
                  r={paper ? G.dot : 6}
                  fill={color(0)}
                  stroke={c.outline ?? undefined}
                  strokeWidth={c.outline ? G.out : undefined}
                />
                {selected === i &&
                  ring({ x: scX(p.x) - 9, y: scY(p.y) - 9, width: 18, height: 18 })}
              </g>
            ))}
          </g>
        )}
      </svg>

      {type === 'pie' && legend === 'html' && (
        <ul className="fx-chart__legend" style={{ color: c.ink }}>
          {data.map((d, i) => (
            <li key={i}>
              <span className="fx-chart__box" style={{ background: color(i) }} />
              <span className="fx-chart__label">{d.label}</span>
              <span className="fx-chart__val">{fmt(d.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
