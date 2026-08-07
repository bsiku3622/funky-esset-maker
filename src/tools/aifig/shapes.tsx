/* Shape and label renderers.
 *
 * These components are the single source of truth for what a figure looks
 * like: the export path serialises the very same DOM subtree, so there is no
 * second drawing routine that could drift out of sync. Everything is plain
 * SVG — no <foreignObject>, no CSS-dependent layout — so the exported file
 * opens the same way in Illustrator, Inkscape and a LaTeX \includegraphics. */

import { memo } from 'react'
import type { FigNode, Style } from './types'
import { dashArray, FONT_STACK, readableOn, shade, tint } from './presets'
import { fontCss, textWidth, type LabelLayout } from './latex'
import { isoOff, labelStyle, placeLabel } from './layout'

/* ---------- label ---------- */

interface LabelProps {
  layout: LabelLayout
  /** anchor point: left/centre/right edge of the text block, at its top */
  x: number
  y: number
  style: Style
  color?: string
}

/** Draw a laid-out label. `x` means left / centre / right depending on align. */
export const LabelView = memo(function LabelView({
  layout,
  x,
  y,
  style,
  color,
}: LabelProps) {
  const fill = color ?? style.textColor
  const fam = FONT_STACK[style.fontFamily]
  return (
    <g>
      {layout.lines.map((ln, i) => {
        const ox =
          style.align === 'center'
            ? x - ln.w / 2
            : style.align === 'right'
              ? x - ln.w
              : x
        const by = y + ln.baseline
        return (
          <g key={i}>
            {ln.items.map((it, k) =>
              it.t === 'text' ? (
                <text
                  key={k}
                  x={+(ox + it.x).toFixed(2)}
                  y={+by.toFixed(2)}
                  fontFamily={fam}
                  fontSize={style.fontSize}
                  fontWeight={style.fontWeight}
                  fontStyle={style.italic ? 'italic' : undefined}
                  fill={fill}
                  style={{ whiteSpace: 'pre' }}
                  xmlSpace="preserve"
                >
                  {it.v}
                </text>
              ) : (
                <g
                  key={k}
                  transform={`translate(${(ox + it.x).toFixed(2)} ${by.toFixed(2)}) scale(${(it.scale / 1000).toFixed(5)})`}
                  color={fill}
                  fill={fill}
                  stroke={fill}
                  dangerouslySetInnerHTML={{ __html: it.box.inner }}
                />
              ),
            )}
          </g>
        )
      })}
    </g>
  )
})

/* ---------- shape geometry ---------- */

const pts = (arr: [number, number][]) => arr.map(([x, y]) => `${x},${y}`).join(' ')

/* ---------- individual shapes ---------- */

interface BodyProps {
  n: FigNode
}

function strokeProps(s: Style) {
  return {
    stroke: s.stroke,
    strokeWidth: s.strokeWidth,
    strokeDasharray: dashArray(s.dash, s.strokeWidth),
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  }
}

const Rect = ({ n }: BodyProps) => (
  <rect
    x={0}
    y={0}
    width={n.w}
    height={n.h}
    rx={n.style.radius}
    ry={n.style.radius}
    fill={n.style.fill}
    {...strokeProps(n.style)}
  />
)

const Ellipse = ({ n }: BodyProps) => (
  <ellipse
    cx={n.w / 2}
    cy={n.h / 2}
    rx={n.w / 2}
    ry={n.h / 2}
    fill={n.style.fill}
    {...strokeProps(n.style)}
  />
)

const Diamond = ({ n }: BodyProps) => (
  <polygon
    points={pts([
      [n.w / 2, 0],
      [n.w, n.h / 2],
      [n.w / 2, n.h],
      [0, n.h / 2],
    ])}
    fill={n.style.fill}
    {...strokeProps(n.style)}
  />
)

const Triangle = ({ n }: BodyProps) => (
  <polygon
    points={pts([
      [n.w / 2, 0],
      [n.w, n.h],
      [0, n.h],
    ])}
    fill={n.style.fill}
    {...strokeProps(n.style)}
  />
)

const Parallelogram = ({ n }: BodyProps) => {
  const k = Math.min(n.w * 0.28, n.h * 0.6)
  return (
    <polygon
      points={pts([
        [k, 0],
        [n.w, 0],
        [n.w - k, n.h],
        [0, n.h],
      ])}
      fill={n.style.fill}
      {...strokeProps(n.style)}
    />
  )
}

const Trapezoid = ({ n }: BodyProps) => {
  const t = Math.max(0, Math.min(0.9, n.props.taper ?? 0.45))
  const dir = n.props.dir ?? 'right'
  const inset = (dir === 'left' || dir === 'right' ? n.h : n.w) * (t / 2)
  const p: [number, number][] =
    dir === 'right'
      ? [
          [0, 0],
          [n.w, inset],
          [n.w, n.h - inset],
          [0, n.h],
        ]
      : dir === 'left'
        ? [
            [0, inset],
            [n.w, 0],
            [n.w, n.h],
            [0, n.h - inset],
          ]
        : dir === 'down'
          ? [
              [0, 0],
              [n.w, 0],
              [n.w - inset, n.h],
              [inset, n.h],
            ]
          : [
              [inset, 0],
              [n.w - inset, 0],
              [n.w, n.h],
              [0, n.h],
            ]
  return <polygon points={pts(p)} fill={n.style.fill} {...strokeProps(n.style)} />
}

const Cylinder = ({ n }: BodyProps) => {
  const ry = Math.min(n.h * 0.18, n.w * 0.3)
  const body = `M0 ${ry} L0 ${n.h - ry} A ${n.w / 2} ${ry} 0 0 0 ${n.w} ${n.h - ry} L${n.w} ${ry}`
  const cap = `M0 ${ry} A ${n.w / 2} ${ry} 0 0 0 ${n.w} ${ry} A ${n.w / 2} ${ry} 0 0 0 0 ${ry}`
  return (
    <g>
      <path d={`${body} A ${n.w / 2} ${ry} 0 0 0 0 ${ry} Z`} fill={n.style.fill} {...strokeProps(n.style)} />
      <path d={cap} fill={shade(n.style.fill === 'none' ? '#ffffff' : n.style.fill, 0.06)} {...strokeProps(n.style)} />
    </g>
  )
}

const Cuboid = ({ n }: BodyProps) => {
  const { dx, dy } = isoOff(n)
  const s = n.style
  const base = s.fill === 'none' ? '#ffffff' : s.fill
  const top = n.props.faceTop ?? shade(base, 0.1)
  const side = n.props.faceSide ?? shade(base, 0.22)
  const sp = strokeProps(s)
  return (
    <g>
      <polygon
        points={pts([
          [0, 0],
          [dx, dy],
          [n.w + dx, dy],
          [n.w, 0],
        ])}
        fill={top}
        {...sp}
      />
      <polygon
        points={pts([
          [n.w, 0],
          [n.w + dx, dy],
          [n.w + dx, n.h + dy],
          [n.w, n.h],
        ])}
        fill={side}
        {...sp}
      />
      <rect x={0} y={0} width={n.w} height={n.h} fill={base} {...sp} />
    </g>
  )
}

const Stack = ({ n }: BodyProps) => {
  const count = Math.max(1, Math.min(12, n.props.count ?? 3))
  const off = n.props.offset ?? 5
  const s = n.style
  const sheets = []
  // The front sheet sits exactly on the node box so the selection outline, the
  // label and the shape all line up; the rest fan out behind it to the upper
  // right (which is what shapeOverflow reports for the hit area).
  for (let i = count - 1; i >= 0; i--) {
    sheets.push(
      <rect
        key={i}
        x={i * off}
        y={-i * off}
        width={n.w}
        height={n.h}
        rx={s.radius}
        ry={s.radius}
        fill={i === 0 ? s.fill : tint(s.fill === 'none' ? '#ffffff' : s.fill, 0.25)}
        {...strokeProps(s)}
      />,
    )
  }
  return <g>{sheets}</g>
}

const Mlp = ({ n }: BodyProps) => {
  const layers = (n.props.layers ?? [4, 5, 3]).map((v) => Math.max(1, Math.min(24, v)))
  const r = n.props.neuronR ?? 6
  const showEdges = n.props.showEdges !== false
  const s = n.style
  const colX =
    layers.length === 1
      ? [n.w / 2]
      : layers.map((_, i) => r + (i * (n.w - 2 * r)) / (layers.length - 1))
  const posOf = (li: number, k: number) => {
    const count = layers[li]
    const span = n.h - 2 * r
    const y = count === 1 ? n.h / 2 : r + (k * span) / (count - 1)
    return { x: colX[li], y }
  }
  const lines: React.ReactElement[] = []
  if (showEdges)
    for (let li = 0; li < layers.length - 1; li++)
      for (let a = 0; a < layers[li]; a++)
        for (let b = 0; b < layers[li + 1]; b++) {
          const p = posOf(li, a)
          const q = posOf(li + 1, b)
          lines.push(
            <line
              key={`${li}-${a}-${b}`}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              stroke={s.stroke}
              strokeWidth={Math.max(0.35, s.strokeWidth * 0.42)}
              opacity={0.55}
            />,
          )
        }
  const dots: React.ReactElement[] = []
  layers.forEach((count, li) => {
    for (let k = 0; k < count; k++) {
      const p = posOf(li, k)
      dots.push(
        <circle
          key={`${li}-${k}`}
          cx={p.x}
          cy={p.y}
          r={r}
          fill={s.fill === 'none' ? '#ffffff' : s.fill}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
        />,
      )
    }
  })
  return (
    <g>
      {lines}
      {dots}
    </g>
  )
}

const Grid = ({ n }: BodyProps) => {
  const rows = Math.max(1, Math.min(64, n.props.rows ?? 4))
  const cols = Math.max(1, Math.min(64, n.props.cols ?? 4))
  const gap = n.props.gap ?? 1
  const s = n.style
  const cw = (n.w - gap * (cols - 1)) / cols
  const ch = (n.h - gap * (rows - 1)) / rows
  const heat = n.props.heat
  const hi = n.props.heatHi ?? s.stroke
  const cells: React.ReactElement[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const v = heat ? Math.max(0, Math.min(1, heat[i] ?? 0)) : null
      cells.push(
        <rect
          key={i}
          x={c * (cw + gap)}
          y={r * (ch + gap)}
          width={cw}
          height={ch}
          fill={v === null ? s.fill : tint(hi, 1 - v)}
          stroke={s.stroke}
          strokeWidth={Math.max(0.3, s.strokeWidth * 0.7)}
        />,
      )
    }
  return <g>{cells}</g>
}

const Brace = ({ n }: BodyProps) => {
  const dir = n.props.dir ?? 'down'
  const s = n.style
  // drawn for a horizontal brace under a span, then rotated for other dirs
  const W = dir === 'left' || dir === 'right' ? n.h : n.w
  const H = dir === 'left' || dir === 'right' ? n.w : n.h
  // the arms sit half-way down so the centre spur stays short no matter how
  // deep the box is — otherwise a tall brace degenerates into a V
  const arm = H / 2
  const q = Math.max(1, Math.min(arm, W / 8))
  const f2 = (v: number) => +v.toFixed(2)
  const d =
    `M0 0 Q0 ${f2(arm)} ${f2(q)} ${f2(arm)} L${f2(W / 2 - q)} ${f2(arm)}` +
    ` Q${f2(W / 2)} ${f2(arm)} ${f2(W / 2)} ${f2(H)}` +
    ` Q${f2(W / 2)} ${f2(arm)} ${f2(W / 2 + q)} ${f2(arm)} L${f2(W - q)} ${f2(arm)}` +
    ` Q${f2(W)} ${f2(arm)} ${f2(W)} 0`
  const rot =
    dir === 'down'
      ? ''
      : dir === 'up'
        ? `translate(${n.w} ${n.h}) rotate(180)`
        : dir === 'right'
          ? `translate(${n.w} 0) rotate(90)`
          : `translate(0 ${n.h}) rotate(-90)`
  return (
    <g transform={rot || undefined}>
      <path d={d} fill="none" {...strokeProps(s)} />
    </g>
  )
}

const Bracket = ({ n }: BodyProps) => {
  const s = n.style
  const lip = Math.min(n.w * 0.18, 14)
  const d =
    `M${lip} 0 L0 0 L0 ${n.h} L${lip} ${n.h}` +
    ` M${n.w - lip} 0 L${n.w} 0 L${n.w} ${n.h} L${n.w - lip} ${n.h}`
  return <path d={d} fill="none" {...strokeProps(s)} />
}

const CURVES: Record<string, (t: number) => number> = {
  relu: (t) => Math.max(0, t),
  sigmoid: (t) => 1 / (1 + Math.exp(-t * 6)),
  tanh: (t) => Math.tanh(t * 2.5),
  gelu: (t) => (t * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (t + 0.044715 * t ** 3)))) / 2,
  loss: (t) => Math.exp(-(t + 1) * 2.2),
  sine: (t) => Math.sin(t * Math.PI * 1.6),
  step: (t) => (t < 0 ? 0 : 1),
}

const Curve = ({ n }: BodyProps) => {
  const s = n.style
  const fn = CURVES[n.props.fn ?? 'relu'] ?? CURVES.relu
  const N = 72
  const raw: number[] = []
  for (let i = 0; i <= N; i++) raw.push(fn(-1 + (2 * i) / N))
  const lo = Math.min(...raw, 0)
  const hi = Math.max(...raw, lo + 1e-6)
  const padL = 8
  const padB = 8
  const pw = n.w - padL
  const ph = n.h - padB
  const d = raw
    .map((v, i) => {
      const x = padL + (i / N) * pw
      const y = ph - ((v - lo) / (hi - lo)) * ph
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  const axis = s.stroke === 'none' ? '#4A4A4A' : s.stroke
  return (
    <g>
      <rect x={0} y={0} width={n.w} height={n.h} fill={s.fill} stroke="none" />
      <path
        d={`M${padL} 0 L${padL} ${ph} L${n.w} ${ph}`}
        fill="none"
        stroke={axis}
        strokeWidth={Math.max(0.6, s.strokeWidth * 0.7)}
        opacity={0.7}
      />
      <path d={d} fill="none" stroke={axis} strokeWidth={s.strokeWidth} strokeLinejoin="round" />
    </g>
  )
}

const Frame = ({ n }: BodyProps) => {
  const s = n.style
  const title = n.props.title ?? ''
  const f = fontCss(FONT_STACK[s.fontFamily], s.fontSize, 600, false)
  const tw = title ? textWidth(title, f) + 10 : 0
  return (
    <g>
      <rect
        x={0}
        y={0}
        width={n.w}
        height={n.h}
        rx={s.radius}
        ry={s.radius}
        fill={s.fill}
        {...strokeProps(s)}
      />
      {title ? (
        <g>
          <rect
            x={10}
            y={-s.fontSize * 0.72}
            width={tw}
            height={s.fontSize * 1.35}
            fill="#ffffff"
          />
          <text
            x={15}
            y={s.fontSize * 0.34}
            fontFamily={FONT_STACK[s.fontFamily]}
            fontSize={s.fontSize}
            fontWeight={600}
            fill={s.textColor}
          >
            {title}
          </text>
        </g>
      ) : null}
    </g>
  )
}

const Img = ({ n }: BodyProps) => {
  const s = n.style
  if (!n.props.src)
    return (
      <g>
        <rect x={0} y={0} width={n.w} height={n.h} fill={s.fill} {...strokeProps(s)} />
        <path
          d={`M${n.w * 0.18} ${n.h * 0.72} L${n.w * 0.4} ${n.h * 0.45} L${n.w * 0.56} ${n.h * 0.6} L${n.w * 0.72} ${n.h * 0.42} L${n.w * 0.86} ${n.h * 0.72} Z`}
          fill={s.stroke}
          opacity={0.25}
        />
      </g>
    )
  // 'cover' relies on SVG's own slice behaviour, so no clipPath is needed
  const par =
    n.props.fit === 'contain'
      ? 'xMidYMid meet'
      : n.props.fit === 'cover'
        ? 'xMidYMid slice'
        : 'none'
  return (
    <g>
      <image href={n.props.src} x={0} y={0} width={n.w} height={n.h} preserveAspectRatio={par} />
      {s.stroke !== 'none' ? (
        <rect x={0} y={0} width={n.w} height={n.h} fill="none" {...strokeProps(s)} />
      ) : null}
    </g>
  )
}

/** Operator token: a small circle carrying ⊕ / ⊗ / … drawn as strokes so it
 *  scales cleanly and never depends on a symbol font being installed. */
const Op = ({ n }: BodyProps) => {
  const s = n.style
  const cx = n.w / 2
  const cy = n.h / 2
  const r = Math.min(n.w, n.h) / 2
  const k = r * 0.52
  const sym = n.props.symbol ?? '+'
  const sp = {
    stroke: s.stroke,
    strokeWidth: Math.max(0.8, s.strokeWidth * 1.1),
    strokeLinecap: 'round' as const,
  }
  let glyph: React.ReactElement | null
  switch (sym) {
    case '+':
      glyph = (
        <g {...sp}>
          <line x1={cx - k} y1={cy} x2={cx + k} y2={cy} />
          <line x1={cx} y1={cy - k} x2={cx} y2={cy + k} />
        </g>
      )
      break
    case '-':
      glyph = (
        <g {...sp}>
          <line x1={cx - k} y1={cy} x2={cx + k} y2={cy} />
        </g>
      )
      break
    case 'x': {
      const d = k * 0.72
      glyph = (
        <g {...sp}>
          <line x1={cx - d} y1={cy - d} x2={cx + d} y2={cy + d} />
          <line x1={cx + d} y1={cy - d} x2={cx - d} y2={cy + d} />
        </g>
      )
      break
    }
    case '.':
      glyph = <circle cx={cx} cy={cy} r={Math.max(1.2, r * 0.2)} fill={s.stroke} />
      break
    case 'c': {
      // concat: two short bars merging
      const d = k * 0.75
      glyph = (
        <g {...sp} fill="none">
          <path d={`M${cx - d} ${cy - d} L${cx - d} ${cy + d}`} />
          <path d={`M${cx} ${cy - d} L${cx} ${cy + d}`} />
          <path d={`M${cx + d} ${cy - d} L${cx + d} ${cy + d}`} />
        </g>
      )
      break
    }
    default:
      glyph = null
  }
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={s.fill}
        stroke={s.stroke}
        strokeWidth={s.strokeWidth}
        strokeDasharray={dashArray(s.dash, s.strokeWidth)}
      />
      {glyph}
      {!glyph && sym ? (
        <text
          x={cx}
          y={cy + s.fontSize * 0.35}
          textAnchor="middle"
          fontFamily={FONT_STACK[s.fontFamily]}
          fontSize={s.fontSize}
          fill={s.textColor === 'none' ? readableOn(s.fill) : s.textColor}
        >
          {sym}
        </text>
      ) : null}
    </g>
  )
}

const BODIES: Partial<Record<FigNode['kind'], (p: BodyProps) => React.ReactElement | null>> = {
  rect: Rect,
  ellipse: Ellipse,
  diamond: Diamond,
  triangle: Triangle,
  parallelogram: Parallelogram,
  trapezoid: Trapezoid,
  cylinder: Cylinder,
  cuboid: Cuboid,
  stack: Stack,
  mlp: Mlp,
  grid: Grid,
  brace: Brace,
  bracket: Bracket,
  curve: Curve,
  frame: Frame,
  image: Img,
  op: Op,
  text: () => null,
}

/* ---------- node ---------- */

export const NodeView = memo(function NodeView({
  n,
}: {
  n: FigNode
  /** bumped when MathJax finishes loading; only here to bust memo */
  rev?: number
}) {
  if (n.hidden) return null
  const Body = BODIES[n.kind] ?? Rect
  const placed = placeLabel(n)
  const cx = n.w / 2
  const cy = n.h / 2
  const transform =
    `translate(${n.x} ${n.y})` + (n.rotation ? ` rotate(${n.rotation} ${cx} ${cy})` : '')
  return (
    <g transform={transform} opacity={n.style.opacity} data-node={n.id}>
      <Body n={n} />
      {placed ? (
        <LabelView
          layout={placed.layout}
          x={placed.x}
          y={placed.y}
          style={labelStyle(n)}
        />
      ) : null}
    </g>
  )
})
