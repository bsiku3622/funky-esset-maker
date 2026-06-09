import './cores.css'

/* Chart — display-only render core extracted from the Chart Maker tool.
   Bar / line / pie / scatter as a self-contained SVG (+ pie legend). */

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
}

const PALETTE = [
  '#ff4eba',
  '#3decfd',
  '#ffd500',
  '#7828c8',
  '#ff9100',
  '#00c22a',
  '#00c8ff',
]
const BG_HEX: Record<ChartBg, string | null> = {
  transparent: null,
  cream: '#fff5d1',
  white: '#ffffff',
  dark: '#1e1e22',
}
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

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
}: ChartProps) {
  const figW = width
  const figH = height
  const bgHex = BG_HEX[bg]
  const ink = bg === 'dark' ? '#f4f4f4' : '#222'
  const labelColor = bg === 'dark' ? '#cfcfd6' : '#555'
  const grid = bg === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'
  const color = (i: number) => PALETTE[(accent + i) % PALETTE.length]

  const PADL = 56
  const PADR = 24
  const PADT = title ? 44 : 24
  const PADB = 52
  const plotW = figW - PADL - PADR
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

  return (
    <div
      className="fx-chart"
      style={bgHex ? { background: bgHex } : undefined}
    >
      <svg width={figW} height={figH} viewBox={`0 0 ${figW} ${figH}`}>
        {title && (
          <text x={figW / 2} y={26} textAnchor="middle" fontSize={20} fontWeight={800} fill={ink}>
            {title}
          </text>
        )}

        {(type === 'bar' || type === 'line') && (
          <g>
            {vt.map((t, i) => (
              <g key={i}>
                <line x1={PADL} y1={vy(t)} x2={figW - PADR} y2={vy(t)} stroke={grid} strokeWidth={1} />
                <text x={PADL - 8} y={vy(t) + 4} textAnchor="end" fontSize={12} fill={labelColor} fontFamily={MONO}>
                  {fmt(t)}
                </text>
              </g>
            ))}
            <line x1={PADL} y1={PADT} x2={PADL} y2={yBase} stroke={ink} strokeWidth={2} />
            <line x1={PADL} y1={yBase} x2={figW - PADR} y2={yBase} stroke={ink} strokeWidth={2} />
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

        {type === 'line' && data.length > 0 && (
          <g>
            <polyline
              points={data.map((d, i) => `${x0 + (plotW / data.length) * (i + 0.5)},${vy(d.value)}`).join(' ')}
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

        {type === 'scatter' && (
          <g>
            {syt.map((t, i) => (
              <g key={`sy${i}`}>
                <line x1={PADL} y1={scY(t)} x2={figW - PADR} y2={scY(t)} stroke={grid} strokeWidth={1} />
                <text x={PADL - 8} y={scY(t) + 4} textAnchor="end" fontSize={12} fill={labelColor} fontFamily={MONO}>
                  {fmt(t)}
                </text>
              </g>
            ))}
            {sxt.map((t, i) => (
              <text key={`sx${i}`} x={scX(t)} y={yBase + 18} textAnchor="middle" fontSize={12} fill={labelColor} fontFamily={MONO}>
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

      {type === 'pie' && (
        <ul className="fx-chart__legend" style={{ color: ink }}>
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
