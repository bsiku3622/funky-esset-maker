/* Drawing a structural formula.
 *
 * The conventions this has to honour, in the order they matter: a plain carbon
 * is a bare vertex; a labelled atom interrupts its bonds rather than sitting on
 * top of them; the second line of a double bond goes on the inside of a ring;
 * and hydrogens attach to the side the rest of the molecule is not on, so a
 * methyl on the left of a chain reads H₃C and not CH₃ backwards.
 *
 * ⚠️ Bonds stop at the edge of a label's box, not at the atom's centre. Drawing
 * the full line and painting a white disc over the middle looks identical on
 * screen and wrong the moment the figure is placed on a coloured background —
 * and an exported SVG is placed on whatever the document uses. */

import { Fragment } from 'react'
import { UI_ONLY } from '../../cores'
import { textWidth } from '../../cores/plot/geom'
import {
  aromaticRings,
  atomAt,
  centroid,
  neighbours,
  type Atom,
  type Molecule,
  type Pt,
} from './model'
import { labelOf, type ChemStyle, type LabelBox } from './style'

export type { ChemStyle }

export type PickKind = 'atom' | 'bond' | 'arrow' | 'label'
export interface ChemPick {
  kind: PickKind
  id: string
}

const SELECT = '#7828c8'

/** How far along `dir` the label's box reaches — the point a bond stops at. */
function boxReach(box: LabelBox, dx: number, dy: number): number {
  if (!box.show) return 0
  const len = Math.hypot(dx, dy) || 1
  const ux = Math.abs(dx / len)
  const uy = Math.abs(dy / len)
  // the ellipse through the box's corners, which is close enough to the shape
  // of a word and much cheaper than a real glyph box
  const t = Math.hypot(ux / (box.rx || 1e-6), uy / (box.ry || 1e-6))
  return t > 0 ? 1 / t : 0
}

function AtomLabel({ atom, box, st }: { atom: Atom; box: LabelBox; st: ChemStyle }) {
  if (!box.show) return null
  return (
    <text
      x={atom.x}
      y={atom.y + st.fontSize * 0.35}
      textAnchor="middle"
      fontFamily={st.font}
      fontSize={st.fontSize}
      fontWeight={600}
      fill={st.ink}
    >
      {box.parts.map((p, i) => (
        <tspan
          key={i}
          fontSize={p.sub || p.sup ? st.fontSize * 0.72 : undefined}
          dy={p.sub ? st.fontSize * 0.2 : p.sup ? -st.fontSize * 0.42 : 0}
        >
          {p.t}
        </tspan>
      ))}
    </text>
  )
}

/* ---------- bonds ---------- */

/** Which side the second line of a double bond goes on.
 *
 *  Toward whatever else is attached to the two atoms — which inside a ring is
 *  the ring's interior, and that is the convention. With nothing attached the
 *  bond is drawn symmetrically, the way O=C=O is. */
function doubleOffset(mol: Molecule, a: Atom, b: Atom): number {
  const others = [...neighbours(mol, a.id), ...neighbours(mol, b.id)].filter(
    (n) => n.id !== a.id && n.id !== b.id,
  )
  if (!others.length) return 0
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const lean = others.reduce((s, n) => s + ((n.x - mx) * nx + (n.y - my) * ny), 0)
  return lean === 0 ? 0 : lean > 0 ? 1 : -1
}

function wavyPath(a: Pt, b: Pt, amp: number): string {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const n = Math.max(3, Math.round(len / 6))
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const nx = -uy
  const ny = ux
  let d = `M${a.x.toFixed(2)} ${a.y.toFixed(2)}`
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const px = a.x + ux * len * t
    const py = a.y + uy * len * t
    const s = (i % 2 ? 1 : -1) * amp
    const cx = px - ux * (len / n / 2) + nx * s
    const cy = py - uy * (len / n / 2) + ny * s
    d += ` Q${cx.toFixed(2)} ${cy.toFixed(2)} ${px.toFixed(2)} ${py.toFixed(2)}`
  }
  return d
}

/* ---------- arrows ---------- */

function ArrowMark({
  a,
  st,
  selected,
  onPick,
}: {
  a: Molecule['arrows'][number]
  st: ChemStyle
  selected: boolean
  onPick?: (p: ChemPick) => void
}) {
  const dx = a.x2 - a.x1
  const dy = a.y2 - a.y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const head = st.fontSize * 0.62
  const w = st.bondWidth

  const headPath = (tip: Pt, sx: number, sy: number, half = false) => {
    const back = { x: tip.x - sx * head, y: tip.y - sy * head }
    const p1 = { x: back.x + nx * head * 0.42, y: back.y + ny * head * 0.42 }
    const p2 = { x: back.x - nx * head * 0.42, y: back.y - ny * head * 0.42 }
    return half
      ? `M${tip.x.toFixed(2)} ${tip.y.toFixed(2)}L${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
      : `M${tip.x.toFixed(2)} ${tip.y.toFixed(2)}L${p1.x.toFixed(2)} ${p1.y.toFixed(2)}L${p2.x.toFixed(2)} ${p2.y.toFixed(2)}Z`
  }

  const shaft = (off: number) =>
    `M${(a.x1 + nx * off).toFixed(2)} ${(a.y1 + ny * off).toFixed(2)}L${(a.x2 + nx * off).toFixed(2)} ${(a.y2 + ny * off).toFixed(2)}`

  const pick = onPick ? (e: React.PointerEvent) => { e.stopPropagation(); onPick({ kind: 'arrow', id: a.id }) } : undefined

  if (a.kind === 'curly') {
    // an electron-pushing arrow bows, and its head is a single barb
    const bow = a.bow ?? len * 0.35
    const cx = (a.x1 + a.x2) / 2 + nx * bow
    const cy = (a.y1 + a.y2) / 2 + ny * bow
    const tipDir = { x: a.x2 - cx, y: a.y2 - cy }
    const tl = Math.hypot(tipDir.x, tipDir.y) || 1
    return (
      <g onPointerDown={pick} style={onPick ? { cursor: 'pointer' } : undefined}>
        <path
          d={`M${a.x1} ${a.y1} Q${cx.toFixed(2)} ${cy.toFixed(2)} ${a.x2} ${a.y2}`}
          fill="none"
          stroke={st.ink}
          strokeWidth={w}
        />
        <path
          d={headPath({ x: a.x2, y: a.y2 }, tipDir.x / tl, tipDir.y / tl, true)}
          fill="none"
          stroke={st.ink}
          strokeWidth={w}
        />
        {selected && <SelLine a={{ x: a.x1, y: a.y1 }} b={{ x: a.x2, y: a.y2 }} />}
      </g>
    )
  }

  const equil = a.kind === 'equilibrium'
  const off = equil ? st.gap * 0.75 : 0
  return (
    <g onPointerDown={pick} style={onPick ? { cursor: 'pointer' } : undefined}>
      <path d={shaft(off)} stroke={st.ink} strokeWidth={w} fill="none" />
      <path
        d={headPath({ x: a.x2 + nx * off, y: a.y2 + ny * off }, ux, uy, equil)}
        fill={equil ? 'none' : st.ink}
        stroke={st.ink}
        strokeWidth={equil ? w : 0}
      />
      {(equil || a.kind === 'resonance' || a.kind === 'retro') && (
        <>
          <path d={shaft(-off)} stroke={st.ink} strokeWidth={w} fill="none" />
          <path
            d={headPath({ x: a.x1 - nx * off, y: a.y1 - ny * off }, -ux, -uy, equil)}
            fill={equil ? 'none' : st.ink}
            stroke={st.ink}
            strokeWidth={equil ? w : 0}
          />
        </>
      )}
      {a.above && (
        <text
          x={(a.x1 + a.x2) / 2}
          y={(a.y1 + a.y2) / 2 - st.fontSize * 0.55}
          textAnchor="middle"
          fontFamily={st.font}
          fontSize={st.fontSize * 0.8}
          fill={st.ink}
        >
          {a.above}
        </text>
      )}
      {a.below && (
        <text
          x={(a.x1 + a.x2) / 2}
          y={(a.y1 + a.y2) / 2 + st.fontSize * 1.15}
          textAnchor="middle"
          fontFamily={st.font}
          fontSize={st.fontSize * 0.8}
          fill={st.ink}
        >
          {a.below}
        </text>
      )}
      {selected && <SelLine a={{ x: a.x1, y: a.y1 }} b={{ x: a.x2, y: a.y2 }} />}
    </g>
  )
}

const SelLine = ({ a, b }: { a: Pt; b: Pt }) => (
  <path
    {...{ [UI_ONLY]: '1' }}
    d={`M${a.x} ${a.y}L${b.x} ${b.y}`}
    stroke={SELECT}
    strokeWidth={7}
    strokeOpacity={0.28}
    strokeLinecap="round"
    fill="none"
  />
)

/* ---------- the view ---------- */

export interface ChemViewProps {
  mol: Molecule
  width: number
  height: number
  st: ChemStyle
  bgHex?: string | null
  svgRef?: React.Ref<SVGSVGElement>
  selected?: ChemPick | null
  onPick?: (p: ChemPick) => void
  /** the bond being dragged out right now */
  ghost?: { from: Pt; to: Pt } | null
  /** draw lone pairs — a Lewis structure rather than a skeletal one */
  lonePairs?: boolean
  /* The editor drives everything from pointer events on the canvas and its own
     hit-testing, rather than from handlers on each shape: a drag has to know
     where it started even when it started on nothing. */
  onPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void
  onPointerMove?: (e: React.PointerEvent<SVGSVGElement>) => void
  onPointerUp?: (e: React.PointerEvent<SVGSVGElement>) => void
  cursor?: string
}

export default function ChemView({
  mol,
  width,
  height,
  st,
  bgHex,
  svgRef,
  selected,
  onPick,
  ghost,
  lonePairs,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  cursor,
}: ChemViewProps) {
  const boxes = new Map<string, LabelBox>()
  for (const a of mol.atoms) boxes.set(a.id, labelOf(mol, a, st))

  const rings = aromaticRings(mol)

  const pickAtom = onPick
    ? (id: string) => (e: React.PointerEvent) => {
        e.stopPropagation()
        onPick({ kind: 'atom', id })
      }
    : undefined

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ ...(bgHex ? { background: bgHex } : null), ...(cursor ? { cursor } : null), touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* bonds first: a label drawn after can never be crossed by one */}
      <g strokeLinecap="round">
        {mol.bonds.map((bond) => {
          const a = atomAt(mol, bond.a)
          const b = atomAt(mol, bond.b)
          if (!a || !b) return null
          const dx = b.x - a.x
          const dy = b.y - a.y
          const len = Math.hypot(dx, dy) || 1
          const ux = dx / len
          const uy = dy / len
          const ra = boxReach(boxes.get(a.id)!, dx, dy)
          const rb = boxReach(boxes.get(b.id)!, dx, dy)
          const p1 = { x: a.x + ux * ra, y: a.y + uy * ra }
          const p2 = { x: b.x - ux * rb, y: b.y - uy * rb }
          const nx = -uy
          const ny = ux
          const sel = selected?.kind === 'bond' && selected.id === bond.id
          const pick = onPick
            ? (e: React.PointerEvent) => {
                e.stopPropagation()
                onPick({ kind: 'bond', id: bond.id })
              }
            : undefined

          const line = (off: number, shrink = 0) => {
            const s = { x: p1.x + nx * off + ux * shrink, y: p1.y + ny * off + uy * shrink }
            const e = { x: p2.x + nx * off - ux * shrink, y: p2.y + ny * off - uy * shrink }
            return `M${s.x.toFixed(2)} ${s.y.toFixed(2)}L${e.x.toFixed(2)} ${e.y.toFixed(2)}`
          }

          const style = bond.style ?? 'plain'
          const order = bond.aromatic ? 1 : bond.order
          const side = order === 2 ? doubleOffset(mol, a, b) : 0

          return (
            <g key={bond.id} onPointerDown={pick} style={onPick ? { cursor: 'pointer' } : undefined}>
              {sel && <SelLine a={p1} b={p2} />}
              {style === 'wedge' ? (
                <path
                  d={`M${p1.x.toFixed(2)} ${p1.y.toFixed(2)}L${(p2.x + nx * st.gap * 0.62).toFixed(2)} ${(p2.y + ny * st.gap * 0.62).toFixed(2)}L${(p2.x - nx * st.gap * 0.62).toFixed(2)} ${(p2.y - ny * st.gap * 0.62).toFixed(2)}Z`}
                  fill={st.ink}
                  stroke="none"
                />
              ) : style === 'dash' ? (
                <g stroke={st.ink} strokeWidth={st.bondWidth * 0.9}>
                  {Array.from({ length: 6 }, (_, i) => {
                    const t = (i + 1) / 6
                    const w = st.gap * 0.62 * t
                    const cx = p1.x + (p2.x - p1.x) * t
                    const cy = p1.y + (p2.y - p1.y) * t
                    return (
                      <path
                        key={i}
                        d={`M${(cx + nx * w).toFixed(2)} ${(cy + ny * w).toFixed(2)}L${(cx - nx * w).toFixed(2)} ${(cy - ny * w).toFixed(2)}`}
                      />
                    )
                  })}
                </g>
              ) : style === 'wavy' ? (
                <path d={wavyPath(p1, p2, st.gap * 0.5)} fill="none" stroke={st.ink} strokeWidth={st.bondWidth} />
              ) : (
                <g stroke={st.ink} strokeWidth={st.bondWidth} fill="none">
                  {order === 1 && <path d={line(0)} />}
                  {order === 2 && side === 0 && (
                    <>
                      <path d={line(st.gap / 2)} />
                      <path d={line(-st.gap / 2)} />
                    </>
                  )}
                  {order === 2 && side !== 0 && (
                    <>
                      <path d={line(0)} />
                      {/* the inner line is inset at both ends, which is what
                          makes a ring's double bond look drawn rather than
                          duplicated */}
                      <path d={line(side * st.gap, st.gap * 0.9)} />
                    </>
                  )}
                  {order === 3 && (
                    <>
                      <path d={line(0)} />
                      <path d={line(st.gap * 0.8)} />
                      <path d={line(-st.gap * 0.8)} />
                    </>
                  )}
                </g>
              )}
            </g>
          )
        })}
      </g>

      {/* aromatic circles */}
      <g fill="none" stroke={st.ink} strokeWidth={st.bondWidth * 0.85}>
        {rings.map((ring, i) => {
          const pts = ring.map((id) => atomAt(mol, id)).filter((a): a is Atom => !!a)
          if (pts.length < 3) return null
          const c = centroid(pts)
          const r = (pts.reduce((s, p) => s + Math.hypot(p.x - c.x, p.y - c.y), 0) / pts.length) * 0.62
          return <circle key={i} cx={c.x} cy={c.y} r={r} />
        })}
      </g>

      {/* atoms */}
      <g>
        {mol.atoms.map((a) => {
          const box = boxes.get(a.id)!
          const sel = selected?.kind === 'atom' && selected.id === a.id
          return (
            <Fragment key={a.id}>
              {sel && (
                <circle
                  {...{ [UI_ONLY]: '1' }}
                  cx={a.x}
                  cy={a.y}
                  r={Math.max(box.rx, box.ry) + 6}
                  fill="none"
                  stroke={SELECT}
                  strokeWidth={2}
                />
              )}
              <AtomLabel atom={a} box={box} st={st} />
              {lonePairs && (a.lone ?? 0) > 0 && (
                <LonePairs atom={a} n={a.lone ?? 0} mol={mol} st={st} box={box} />
              )}
              {/* an invisible disc so a bare vertex can still be grabbed */}
              <circle
                {...{ [UI_ONLY]: '1' }}
                cx={a.x}
                cy={a.y}
                r={Math.max(10, box.rx)}
                fill="transparent"
                onPointerDown={pickAtom?.(a.id)}
                style={onPick ? { cursor: 'pointer' } : undefined}
              />
            </Fragment>
          )
        })}
      </g>

      {mol.arrows.map((a) => (
        <ArrowMark
          key={a.id}
          a={a}
          st={st}
          selected={selected?.kind === 'arrow' && selected.id === a.id}
          onPick={onPick}
        />
      ))}

      {mol.labels.map((l) => (
        <Fragment key={l.id}>
          <text
            x={l.x}
            y={l.y}
            textAnchor="middle"
            fontFamily={st.font}
            fontSize={l.size ?? st.fontSize}
            fill={st.ink}
            onPointerDown={
              onPick
                ? (e) => {
                    e.stopPropagation()
                    onPick({ kind: 'label', id: l.id })
                  }
                : undefined
            }
            style={onPick ? { cursor: 'pointer' } : undefined}
          >
            {l.text}
          </text>
          {selected?.kind === 'label' && selected.id === l.id && (
            <rect
              {...{ [UI_ONLY]: '1' }}
              x={l.x - textWidth(l.text, l.size ?? st.fontSize) / 2 - 4}
              y={l.y - (l.size ?? st.fontSize)}
              width={textWidth(l.text, l.size ?? st.fontSize) + 8}
              height={(l.size ?? st.fontSize) * 1.35}
              fill="none"
              stroke={SELECT}
              strokeWidth={2}
            />
          )}
        </Fragment>
      ))}

      {ghost && (
        <path
          {...{ [UI_ONLY]: '1' }}
          d={`M${ghost.from.x} ${ghost.from.y}L${ghost.to.x} ${ghost.to.y}`}
          stroke={SELECT}
          strokeWidth={st.bondWidth}
          strokeDasharray="5 4"
          fill="none"
        />
      )}
    </svg>
  )
}

/** Lone pairs, placed in the gaps between the bonds. */
function LonePairs({
  atom,
  n,
  mol,
  st,
  box,
}: {
  atom: Atom
  n: number
  mol: Molecule
  st: ChemStyle
  box: LabelBox
}) {
  const taken = neighbours(mol, atom.id).map((q) => Math.atan2(q.y - atom.y, q.x - atom.x))
  const slots: number[] = []
  for (let d = 0; d < 360 && slots.length < n; d += 45) {
    const a = (d * Math.PI) / 180
    const clear = taken.every(
      (t) => Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t))) > Math.PI / 4,
    )
    if (clear) slots.push(a)
  }
  const r = Math.max(box.rx, box.ry) + st.fontSize * 0.34
  const dot = st.fontSize * 0.11
  return (
    <g fill={st.ink}>
      {slots.map((a, i) => {
        const cx = atom.x + r * Math.cos(a)
        const cy = atom.y + r * Math.sin(a)
        const nx = -Math.sin(a) * st.fontSize * 0.17
        const ny = Math.cos(a) * st.fontSize * 0.17
        return (
          <Fragment key={i}>
            <circle cx={cx + nx} cy={cy + ny} r={dot} />
            <circle cx={cx - nx} cy={cy - ny} r={dot} />
          </Fragment>
        )
      })}
    </g>
  )
}
