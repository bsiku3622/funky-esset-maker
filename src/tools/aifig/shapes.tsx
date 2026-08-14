/* Shape and label renderers.
 *
 * These components are the single source of truth for what a figure looks
 * like: the export path serialises the very same DOM subtree, so there is no
 * second drawing routine that could drift out of sync. Everything is plain
 * SVG — no <foreignObject>, no CSS-dependent layout — so the exported file
 * opens the same way in Illustrator, Inkscape and a LaTeX \includegraphics. */

import { memo } from 'react'
import type { FigNode, NeuronBits, Style } from './types'
import { dashArray, FONT_STACK, paint, readableOn, shade, tint } from './presets'
import { fontCss, layoutLabel, textWidth, type LabelLayout } from './latex'
import {
  cellKey,
  isoOff,
  labelFont,
  labelStyle,
  mlpTextBoxes,
  mlpWireLabels,
  neuronLabel,
  placeLabel,
  sheetKey,
} from './layout'
import { GROUP_PAD, groupPad, mlpLattice, mlpPartRect, type MlpDot } from './mlp'

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
                  {...fillProps(fill)}
                  style={{ whiteSpace: 'pre' }}
                  xmlSpace="preserve"
                >
                  {it.v}
                </text>
              ) : (
                <g
                  key={k}
                  transform={`translate(${(ox + it.x).toFixed(2)} ${by.toFixed(2)}) scale(${(it.scale / 1000).toFixed(5)})`}
                  color={paint(fill).color}
                  {...fillProps(fill)}
                  {...strokeOnly(fill)}
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
  /* Text currently being typed into, which the editor is drawing itself. The
   * editor is a real DOM field with the same font sitting over this drawing —
   * the browser owns the caret and the selection that way — so whatever it is
   * showing has to come out of here, or the two render on top of each other a
   * pixel or two apart and the label looks doubled. `''` names the node's own
   * label; anything else names a neuron. */
  editing?: string
}

/* Colours arrive with their alpha baked in and leave as two attributes — see
 * `paint` in presets.ts for why the document keeps one string and the SVG gets
 * two. Everything that paints goes through these, so a colour cannot pick up
 * transparency in one shape and lose it in the next. */
function strokeProps(s: Style) {
  const p = paint(s.stroke)
  return {
    stroke: p.color,
    strokeOpacity: p.opacity,
    strokeWidth: s.strokeWidth,
    strokeDasharray: dashArray(s.dash, s.strokeWidth),
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  }
}

function fillProps(v: string) {
  const p = paint(v)
  return { fill: p.color, fillOpacity: p.opacity }
}

/** For the places that set a stroke colour without the rest of a Style. */
function strokeOnly(v: string) {
  const p = paint(v)
  return { stroke: p.color, strokeOpacity: p.opacity }
}

const Rect = ({ n }: BodyProps) => (
  <rect
    x={0}
    y={0}
    width={n.w}
    height={n.h}
    rx={n.style.radius}
    ry={n.style.radius}
    {...fillProps(n.style.fill)}
    {...strokeProps(n.style)}
  />
)

const Ellipse = ({ n }: BodyProps) => (
  <ellipse
    cx={n.w / 2}
    cy={n.h / 2}
    rx={n.w / 2}
    ry={n.h / 2}
    {...fillProps(n.style.fill)}
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
    {...fillProps(n.style.fill)}
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
    {...fillProps(n.style.fill)}
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
      {...fillProps(n.style.fill)}
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
  return <polygon points={pts(p)} {...fillProps(n.style.fill)} {...strokeProps(n.style)} />
}

const Cylinder = ({ n }: BodyProps) => {
  const ry = Math.min(n.h * 0.18, n.w * 0.3)
  const body = `M0 ${ry} L0 ${n.h - ry} A ${n.w / 2} ${ry} 0 0 0 ${n.w} ${n.h - ry} L${n.w} ${ry}`
  const cap = `M0 ${ry} A ${n.w / 2} ${ry} 0 0 0 ${n.w} ${ry} A ${n.w / 2} ${ry} 0 0 0 0 ${ry}`
  return (
    <g>
      <path d={`${body} A ${n.w / 2} ${ry} 0 0 0 0 ${ry} Z`} {...fillProps(n.style.fill)} {...strokeProps(n.style)} />
      <path d={cap} {...fillProps(shade(n.style.fill === "none" ? "#ffffff" : n.style.fill, 0.06))} {...strokeProps(n.style)} />
    </g>
  )
}

const Cuboid = ({ n }: BodyProps) => {
  const { dx, dy } = isoOff(n)
  const s = n.style
  const f = n.props.faces ?? {}
  const base = f.front?.fill ?? n.props.faceFront ?? (s.fill === 'none' ? '#ffffff' : s.fill)
  const top = f.top?.fill ?? n.props.faceTop ?? shade(base, 0.1)
  const side = f.side?.fill ?? n.props.faceSide ?? shade(base, 0.22)
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
        {...fillProps(top)}
        {...sp}
        data-face="top"
      />
      <polygon
        points={pts([
          [n.w, 0],
          [n.w + dx, dy],
          [n.w + dx, n.h + dy],
          [n.w, n.h],
        ])}
        {...fillProps(side)}
        {...sp}
        data-face="side"
      />
      <rect x={0} y={0} width={n.w} height={n.h} {...fillProps(base)} {...sp} data-face="front" />
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
  const bits = n.props.sheets ?? {}
  for (let i = count - 1; i >= 0; i--) {
    const b = bits[sheetKey(i)]
    sheets.push(
      <rect
        key={i}
        x={i * off}
        y={-i * off}
        width={n.w}
        height={n.h}
        rx={s.radius}
        ry={s.radius}
        {...fillProps(
          b?.fill ?? (i === 0 ? s.fill : tint(s.fill === "none" ? "#ffffff" : s.fill, 0.25)),
        )}
        {...strokeProps(s)}
        {...(b?.stroke ? strokeOnly(b.stroke) : null)}
        data-stack-sheet={sheetKey(i)}
      />,
    )
  }
  return <g>{sheets}</g>
}

/* The network glyph.
 *
 * Every coordinate comes from `mlpLattice` — this component decides how things
 * look and nothing about where they are, which is what lets a connector land on
 * the same circle the user sees. Parts carry `data-mlp-*` so the editor can
 * pick one out of the DOM without a second hit-testing routine.
 *
 * The caption font is deliberately the node's own: a layer caption is a label
 * on the same drawing, and giving it a size of its own would make "no bias"
 * under one network a different size from "no bias" under the next. */

const NeuronLabel = ({ n, d, bits }: { n: FigNode; d: MlpDot; bits?: NeuronBits }) => {
  const placed = neuronLabel(n, d, bits)
  if (!placed) return null
  const fill = bits?.fill ?? n.style.fill
  /* A label nudged clear of its circle is no longer *on* the fill, so the
     "pick something readable" default has nothing to read against — fall back
     to the network's ink once it has left home. */
  const away = !!(bits?.dx || bits?.dy)
  const color =
    bits?.textColor ??
    (n.style.textColor === 'none' ? (away ? n.style.stroke : readableOn(fill)) : n.style.textColor)
  return (
    <LabelView layout={placed.layout} x={placed.x} y={placed.y} style={placed.style} color={color} />
  )
}

/** A quadratic through the midpoint, pushed `k` px off the chord's normal. */
function bowed(a: { x: number; y: number }, b: { x: number; y: number }, k: number) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const L = Math.hypot(dx, dy) || 1
  const bend = Math.sign(k) * Math.min(Math.abs(k), L / 2)
  const c = {
    x: (a.x + b.x) / 2 - (dy / L) * bend * 2,
    y: (a.y + b.y) / 2 + (dx / L) * bend * 2,
  }
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} Q${c.x.toFixed(2)} ${c.y.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

const Mlp = ({ n, editing }: BodyProps) => {
  const s = n.style
  const lat = mlpLattice(n)
  const parts = n.props.neurons ?? {}
  const wireBits = n.props.wires ?? {}
  const baseFill = s.fill === 'none' ? '#ffffff' : s.fill
  // the synapses' own ink, falling back to the node's when nothing was said
  const wireInk = n.props.wireStroke ?? s.stroke
  const thin = n.props.wireWidth ?? Math.max(0.35, s.strokeWidth * 0.42)
  const wireFade = n.props.wireOpacity ?? 0.55

  /* Every caption the network carries — the layer captions and the group names
     — laid out by `mlpTextBoxes`. The editor picks the one you double-click out
     of the same list, which is the only way the two can agree about where a
     caption is. */
  const caps = mlpTextBoxes(n)
    .filter((t) => t.key !== editing)
    .map((t) => (
      <LabelView key={t.key} layout={t.layout} x={t.x} y={t.y} style={t.style} color={t.color} />
    ))

  /* Groups go down first, behind everything: the box is a backdrop for the
     units it holds, not a frame drawn over them. */
  const groups = Object.entries(n.props.groups ?? {}).flatMap(([key, g]) => {
    const r = mlpPartRect(n, key)
    if (!r) return []
    const out: React.ReactElement[] = []
    if (!g.bare)
      out.push(
        <rect
          key={key}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={Math.min(12, Math.max(...groupPad(g), GROUP_PAD) * 1.6)}
          {...fillProps(g.fill ?? 'none')}
          {...strokeOnly(g.stroke ?? s.stroke)}
          strokeWidth={Math.max(1, s.strokeWidth)}
          strokeDasharray={dashArray('dashed', Math.max(1, s.strokeWidth))}
          data-mlp-group={key}
        />,
      )
    // the name itself is drawn with the other captions, from mlpTextBoxes
    return out
  })

  return (
    <g>
      {groups}
      {lat.wires.map((w) => {
        const b = wireBits[w.key]
        if (b?.hidden) return null
        const sw = b?.strokeWidth ?? thin
        const common = {
          ...strokeOnly(b?.stroke ?? wireInk),
          strokeWidth: sw,
          strokeDasharray: b?.dash ? dashArray(b.dash, sw) : undefined,
          opacity: b?.opacity ?? wireFade,
          'data-mlp-wire': w.key,
        }
        /* A bow bends the run without moving either end — the ends belong to
           the lattice — which is the one shape a synapse can honestly take
           besides straight. */
        if (b?.bow) return <path key={w.key} d={bowed(w.a, w.b, b.bow)} fill="none" {...common} />
        return <line key={w.key} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} {...common} />
      })}

      {/* The ⋮ standing in for the units a big layer does not draw. It reads
          the same overrides a circle does, so the mark that says "and more of
          these" can be recoloured to match the units it stands for. */}
      {lat.gaps.map((g) => {
        const b = parts[g.key]
        return (
          <g key={g.key} {...fillProps(b?.stroke ?? b?.fill ?? s.stroke)} opacity={b?.opacity}>
            {[-1, 0, 1].map((i) => (
              <circle
                key={i}
                cx={g.x}
                cy={g.y + i * Math.max(3, g.r * 0.62)}
                r={Math.max(0.7, g.r * 0.16)}
              />
            ))}
          </g>
        )
      })}

      {lat.dots.map((d) => {
        const b = parts[d.key]
        const sw = b?.strokeWidth ?? s.strokeWidth
        return (
          <circle
            key={d.key}
            cx={d.x}
            cy={d.y}
            r={d.r}
            {...fillProps(b?.fill ?? baseFill)}
            {...strokeOnly(b?.stroke ?? s.stroke)}
            strokeWidth={sw}
            strokeDasharray={b?.dash ? dashArray(b.dash, sw) : undefined}
            opacity={b?.opacity}
            data-mlp-dot={d.key}
          />
        )
      })}

      {lat.dots.map((d) =>
        d.key === editing ? null : (
          <NeuronLabel key={`t${d.key}`} n={n} d={d} bits={parts[d.key]} />
        ),
      )}

      {caps}

      {/* A weight written on a synapse — the same picture a connector's label
          draws, and drawn last so it is never under a circle. */}
      {mlpWireLabels(n).map((t) =>
        t.key === editing ? null : (
          <LabelView
            key={`w${t.key}`}
            layout={t.layout}
            x={t.x}
            y={t.y}
            style={t.style}
            color={t.style.textColor}
          />
        ),
      )}
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
  const bits = n.props.cells ?? {}
  const cells: React.ReactElement[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const v = heat ? Math.max(0, Math.min(1, heat[i] ?? 0)) : null
      const b = bits[cellKey(r, c)]
      const x = c * (cw + gap)
      const y = r * (ch + gap)
      /* A cell said something about itself wins over the heat ramp: the ramp is
         a way of filling a whole matrix at once, and a cell picked out by hand
         is the exception being drawn on top of it. */
      const fill = b?.fill ?? (v === null ? s.fill : tint(hi, 1 - v))
      cells.push(
        <rect
          key={i}
          x={x}
          y={y}
          width={cw}
          height={ch}
          {...fillProps(fill)}
          {...strokeOnly(s.stroke)}
          strokeWidth={s.strokeWidth}
          data-grid-cell={cellKey(r, c)}
        />,
      )
      if (b?.label) {
        const style: Style = { ...s, align: 'center', textColor: b.textColor ?? s.textColor }
        const l = layoutLabel(b.label, labelFont(style))
        if (l.lines.length)
          cells.push(
            <LabelView
              key={`t${i}`}
              layout={l}
              x={x + cw / 2}
              y={y + ch / 2 - l.h / 2}
              style={style}
            />,
          )
      }
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
  /* Real numbers beat the preset. The presets are activation shapes, which is
     what most inline plots in a model figure are — but a loss curve is data,
     and there was no way to put any in. */
  const given = n.props.data?.filter((v) => Number.isFinite(v)) ?? []
  const fn = CURVES[n.props.fn ?? 'relu'] ?? CURVES.relu
  const N = given.length > 1 ? given.length - 1 : 72
  const raw: number[] = given.length > 1 ? given : []
  if (!raw.length) for (let i = 0; i <= N; i++) raw.push(fn(-1 + (2 * i) / N))
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
      <rect x={0} y={0} width={n.w} height={n.h} {...fillProps(s.fill)} stroke="none" />
      <path
        d={`M${padL} 0 L${padL} ${ph} L${n.w} ${ph}`}
        fill="none"
        {...strokeOnly(axis)}
        strokeWidth={Math.max(0.6, s.strokeWidth * 0.7)}
        opacity={0.7}
      />
      <path d={d} fill="none" stroke={axis} strokeWidth={s.strokeWidth} strokeLinejoin="round" />
    </g>
  )
}

/* The title used to straddle the top edge on an opaque white plate, so that on
 * a transparent canvas it printed a white slab across the drawing — and the
 * plate had to be taller than the text to cover the border it sat on. Sitting
 * the title *above* the edge needs no plate at all: nothing is behind it to
 * punch through. `titleBg` is still there for a title that has to overlap
 * something, but it is off unless asked for. */
const Frame = ({ n, editing }: BodyProps) => {
  const s = n.style
  // the editor draws it while it is being typed into
  const title = editing === 'prop' ? '' : (n.props.title ?? '')
  const f = fontCss(FONT_STACK[s.fontFamily], s.fontSize, 600, false)
  const bg = n.props.titleBg ?? 'none'
  const tw = title ? textWidth(title, f) : 0
  return (
    <g>
      <rect
        x={0}
        y={0}
        width={n.w}
        height={n.h}
        rx={s.radius}
        ry={s.radius}
        {...fillProps(s.fill)}
        {...strokeProps(s)}
      />
      {title ? (
        <g>
          {bg !== 'none' ? (
            <rect
              x={10 - 4}
              y={-s.fontSize * 1.12}
              width={tw + 8}
              height={s.fontSize * 1.05}
              {...fillProps(bg)}
            />
          ) : null}
          <text
            x={10}
            y={-s.fontSize * 0.3}
            fontFamily={FONT_STACK[s.fontFamily]}
            fontSize={s.fontSize}
            fontWeight={600}
            {...fillProps(s.textColor)}
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
        <rect x={0} y={0} width={n.w} height={n.h} {...fillProps(s.fill)} {...strokeProps(s)} />
        <path
          d={`M${n.w * 0.18} ${n.h * 0.72} L${n.w * 0.4} ${n.h * 0.45} L${n.w * 0.56} ${n.h * 0.6} L${n.w * 0.72} ${n.h * 0.42} L${n.w * 0.86} ${n.h * 0.72} Z`}
          {...fillProps(s.stroke)}
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
const Op = ({ n, editing }: BodyProps) => {
  const s = n.style
  const cx = n.w / 2
  const cy = n.h / 2
  const r = Math.min(n.w, n.h) / 2
  const k = r * 0.52
  const sym = editing === 'prop' ? '' : (n.props.symbol ?? '+')
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
      glyph = <circle cx={cx} cy={cy} r={Math.max(1.2, r * 0.2)} {...fillProps(s.stroke)} />
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
        {...fillProps(s.fill)}
        {...strokeOnly(s.stroke)}
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
          {...fillProps(s.textColor === "none" ? readableOn(s.fill) : s.textColor)}
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
  editing,
}: {
  n: FigNode
  /** bumped when MathJax finishes loading; only here to bust memo */
  rev?: number
  /** the label being typed into, which the editor draws instead — see BodyProps */
  editing?: string
}) {
  if (n.hidden) return null
  const Body = BODIES[n.kind] ?? Rect
  const placed = editing === '' ? null : placeLabel(n)
  const cx = n.w / 2
  const cy = n.h / 2
  const transform =
    `translate(${n.x} ${n.y})` + (n.rotation ? ` rotate(${n.rotation} ${cx} ${cy})` : '')
  return (
    <g transform={transform} opacity={n.style.opacity} data-node={n.id}>
      <Body n={n} editing={editing} />
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
