/* 3-D surfaces and point clouds, drawn as flat SVG.
 *
 * This is an orthographic camera and a painter's algorithm: project every quad
 * of the grid, sort them back to front, and paint. There is no z-buffer and no
 * rasteriser, which is exactly the point — the output stays vector, so the
 * figure can be opened in Illustrator and recoloured, and it prints at whatever
 * resolution the page has.
 *
 * ⚠️ Painter's ordering is per-quad, so two surfaces that interpenetrate will
 * be drawn wrong at the seam. Nothing here fixes that; splitting the quads at
 * the intersection is a different program. Two surfaces that merely sit above
 * one another — a fit over a ground truth, which is the common case — are fine.
 *
 * ⚠️ `elev` and `azim` mean what they mean in matplotlib (degrees, elevation
 * above the xy plane and rotation about z), so a figure can be matched to one
 * a paper already contains. */

import { Fragment } from 'react'
import { buildAxis, type Axis } from './scale'
import type { PanelProps } from './Panel'
import { markerPath, type P } from './geom'
import { TickLabel } from './svgbits'
import { colorMapById, sampleMap } from '../palette'
import type { PlotStyle } from './style'

interface V3 {
  x: number
  y: number
  z: number
}

/** Orthographic projection from a camera on the unit sphere. */
function camera(elevDeg: number, azimDeg: number) {
  const e = (elevDeg * Math.PI) / 180
  const a = (azimDeg * Math.PI) / 180
  const ce = Math.cos(e)
  const se = Math.sin(e)
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  // right and up vectors of the image plane, and the axis that measures depth
  const right: V3 = { x: -sa, y: ca, z: 0 }
  const up: V3 = { x: -ca * se, y: -sa * se, z: ce }
  const fwd: V3 = { x: ca * ce, y: sa * ce, z: se }
  const dot = (p: V3, q: V3) => p.x * q.x + p.y * q.y + p.z * q.z
  return {
    to2d: (p: V3) => ({ x: dot(p, right), y: -dot(p, up) }),
    depth: (p: V3) => dot(p, fwd),
  }
}

interface Face {
  pts: P[]
  depth: number
  fill: string
  stroke?: string
}

export default function Proj3dPanel({ rp, rect, st }: PanelProps) {
  const elev = rp.spec.elev ?? 28
  const azim = rp.spec.azim ?? -60
  const cam = camera(elev, azim)

  const surfaces = rp.series.filter((s) => s.mark === 'surface' && s.field)
  const clouds = rp.series.filter((s) => s.mark === 'scatter3d')

  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  for (const s of surfaces) {
    xs.push(...s.field!.xs)
    ys.push(...s.field!.ys)
    for (const row of s.field!.z) for (const v of row) if (v !== null) zs.push(v)
  }
  for (const s of clouds) {
    for (const d of s.data) {
      xs.push(d.x)
      ys.push(d.y)
      if (d.v !== undefined && Number.isFinite(d.v)) zs.push(d.v)
    }
  }
  if (!xs.length || !ys.length) return null

  const ax = buildAxis({ tickCount: 5, ...(rp.spec.x ?? {}) }, { values: xs }, 0, 1)
  const ay = buildAxis({ tickCount: 5, ...(rp.spec.y ?? {}) }, { values: ys }, 0, 1)
  const az = buildAxis({ tickCount: 5, ...(rp.spec.y2 ?? {}) }, { values: zs.length ? zs : [0, 1] }, 0, 1)

  /** data → the unit cube the camera looks at */
  const unit = (x: number, y: number, z: number): V3 => ({
    x: (x - ax.min) / (ax.max - ax.min || 1) - 0.5,
    y: (y - ay.min) / (ay.max - ay.min || 1) - 0.5,
    // z gets a little less height than width, which is what makes a surface
    // read as a landscape rather than as a tower
    z: ((z - az.min) / (az.max - az.min || 1) - 0.5) * 0.8,
  })

  // fit the projected cube into the panel
  const corners: V3[] = []
  for (const cx of [ax.min, ax.max])
    for (const cy of [ay.min, ay.max])
      for (const cz of [az.min, az.max]) corners.push(unit(cx, cy, cz))
  const proj = corners.map((c) => cam.to2d(c))
  const bx = [Math.min(...proj.map((p) => p.x)), Math.max(...proj.map((p) => p.x))]
  const by = [Math.min(...proj.map((p) => p.y)), Math.max(...proj.map((p) => p.y))]

  const titleH = rp.spec.title ? st.panelTitle * 1.9 : 0
  const pad = st.tick * 3.2
  const availW = rect.w - pad * 2
  const availH = rect.h - titleH - pad * 2
  const k = Math.min(availW / (bx[1] - bx[0] || 1), availH / (by[1] - by[0] || 1))
  const ox = rect.x + pad + (availW - (bx[1] - bx[0]) * k) / 2 - bx[0] * k
  const oy = rect.y + titleH + pad + (availH - (by[1] - by[0]) * k) / 2 - by[0] * k

  const to = (x: number, y: number, z: number): P => {
    const q = cam.to2d(unit(x, y, z))
    return { x: ox + q.x * k, y: oy + q.y * k }
  }
  const depthAt = (x: number, y: number, z: number) => cam.depth(unit(x, y, z))

  /* ---- the box, drawn behind everything ---- */
  /* The three panes that face away from the camera. Without them a surface
     floats in the middle of nothing and there is no way to read its height —
     which is why matplotlib shades them rather than drawing bare gridlines. */
  const boxLines: { d: string; grid: boolean }[] = []
  const quad = (pts: P[]) => `M${pts.map((q) => `${q.x.toFixed(2)} ${q.y.toFixed(2)}`).join('L')}Z`
  // the two vertical panes that face away from the camera, plus the floor
  const backX = Math.cos((azim * Math.PI) / 180) > 0 ? ax.min : ax.max
  const backY = Math.sin((azim * Math.PI) / 180) > 0 ? ay.min : ay.max
  const seg = (a: P, b: P) => `M${a.x.toFixed(2)} ${a.y.toFixed(2)}L${b.x.toFixed(2)} ${b.y.toFixed(2)}`

  const panes = [
    // floor
    quad([
      to(ax.min, ay.min, az.min),
      to(ax.max, ay.min, az.min),
      to(ax.max, ay.max, az.min),
      to(ax.min, ay.max, az.min),
    ]),
    quad([
      to(ax.min, backY, az.min),
      to(ax.max, backY, az.min),
      to(ax.max, backY, az.max),
      to(ax.min, backY, az.max),
    ]),
    quad([
      to(backX, ay.min, az.min),
      to(backX, ay.max, az.min),
      to(backX, ay.max, az.max),
      to(backX, ay.min, az.max),
    ]),
  ]

  for (const t of ax.ticks) {
    boxLines.push({ d: seg(to(t.v, backY, az.min), to(t.v, backY, az.max)), grid: true })
    boxLines.push({ d: seg(to(t.v, ay.min, az.min), to(t.v, ay.max, az.min)), grid: true })
  }
  for (const t of ay.ticks) {
    boxLines.push({ d: seg(to(backX, t.v, az.min), to(backX, t.v, az.max)), grid: true })
    boxLines.push({ d: seg(to(ax.min, t.v, az.min), to(ax.max, t.v, az.min)), grid: true })
  }
  for (const t of az.ticks) {
    boxLines.push({ d: seg(to(ax.min, backY, t.v), to(ax.max, backY, t.v)), grid: true })
    boxLines.push({ d: seg(to(backX, ay.min, t.v), to(backX, ay.max, t.v)), grid: true })
  }

  /* ---- faces ---- */
  const faces: Face[] = []
  for (const s of surfaces) {
    const f = s.field!
    const map = colorMapById(s.spec.colorMap ?? '')
    const useMap = !!s.spec.colorMap
    const zmin = s.spec.vmin ?? az.min
    const zmax = s.spec.vmax ?? az.max
    for (let j = 0; j < f.ys.length - 1; j++)
      for (let i = 0; i < f.xs.length - 1; i++) {
        const quad = [
          [f.xs[i], f.ys[j], f.z[j][i]],
          [f.xs[i + 1], f.ys[j], f.z[j][i + 1]],
          [f.xs[i + 1], f.ys[j + 1], f.z[j + 1][i + 1]],
          [f.xs[i], f.ys[j + 1], f.z[j + 1][i]],
        ] as [number, number, number | null][]
        if (quad.some((q) => q[2] === null)) continue
        const pts = quad.map((q) => to(q[0], q[1], q[2] as number))
        const zAvg = quad.reduce((acc, q) => acc + (q[2] as number), 0) / 4
        const depth = quad.reduce((acc, q) => acc + depthAt(q[0], q[1], q[2] as number), 0) / 4
        const fill = useMap
          ? sampleMap(map, (zAvg - zmin) / (zmax - zmin || 1))
          : s.color
        faces.push({
          pts,
          depth,
          fill,
          stroke: s.spec.width === 0 ? undefined : fill,
        })
      }
  }
  // back to front: the camera looks down +fwd, so the largest depth is nearest
  faces.sort((a, b) => a.depth - b.depth)

  // several surfaces in one scene have to be seen through each other
  const faceOpacity = surfaces[0]?.spec.fillOpacity ?? (surfaces.length > 1 ? 0.82 : 1)

  return (
    <g>
      {rp.spec.title && (
        <text
          x={rect.x + rect.w / 2}
          y={rect.y + st.panelTitle * 1.25}
          textAnchor="middle"
          fontSize={st.panelTitle}
          fontWeight={st.bold === 400 ? 600 : 800}
          fill={st.c.ink}
        >
          {rp.spec.title}
        </text>
      )}

      {/* the box is the only thing telling a reader where the surface sits, so
          it carries more weight than a flat grid does */}
      <g>
        {panes.map((d, i) => (
          <path key={i} d={d} fill={st.c.ink} fillOpacity={st.paper ? 0.045 : 0.07} stroke="none" />
        ))}
      </g>
      <g stroke={st.c.grid} strokeWidth={st.grid * 1.5} fill="none">
        {boxLines.map((l, i) => (
          <path key={i} d={l.d} />
        ))}
      </g>

      <g>
        {faces.map((f, i) => (
          <path
            key={i}
            d={`M${f.pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}Z`}
            fill={f.fill}
            fillOpacity={faceOpacity}
            stroke={f.stroke}
            strokeWidth={0.4}
            strokeLinejoin="round"
          />
        ))}
      </g>

      <g>
        {clouds.map((s, si) => {
          const map = colorMapById(s.spec.colorMap ?? '')
          const useMap = !!s.spec.colorMap
          const pts = s.data
            .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y))
            .map((d) => ({
              q: to(d.x, d.y, d.v ?? 0),
              depth: depthAt(d.x, d.y, d.v ?? 0),
              v: d.v ?? 0,
            }))
            .sort((a, b) => a.depth - b.depth)
          return (
            <Fragment key={si}>
              {pts.map((p, i) => (
                <path
                  key={i}
                  d={markerPath(
                    s.spec.marker && s.spec.marker !== 'none' ? s.spec.marker : 'circle',
                    p.q,
                    s.spec.markerSize ?? (st.paper ? 2.8 : 4.5),
                  )}
                  fill={useMap ? sampleMap(map, (p.v - az.min) / (az.max - az.min || 1)) : s.color}
                  fillOpacity={s.spec.opacity ?? 1}
                  stroke={st.c.outline ?? undefined}
                  strokeWidth={st.outline ? st.outline * 0.5 : undefined}
                />
              ))}
            </Fragment>
          )
        })}
      </g>

      {/* the three visible edges of the box, with their ticks */}
      <g stroke={st.c.ink} strokeWidth={st.axis * 0.7} fill="none">
        <path d={seg(to(ax.min, backY, az.min), to(ax.max, backY, az.min))} />
        <path d={seg(to(backX, ay.min, az.min), to(backX, ay.max, az.min))} />
        <path d={seg(to(backX, backY, az.min), to(backX, backY, az.max))} />
      </g>

      <AxisTicks axis={ax} st={st} at={(v) => to(v, backY, az.min)} away={(v) => to(v, backY + (backY === ay.min ? -0.06 : 0.06) * (ay.max - ay.min), az.min)} label={rp.spec.x?.label} />
      <AxisTicks axis={ay} st={st} at={(v) => to(backX, v, az.min)} away={(v) => to(backX + (backX === ax.min ? -0.06 : 0.06) * (ax.max - ax.min), v, az.min)} label={rp.spec.y?.label} />
      <AxisTicks axis={az} st={st} at={(v) => to(backX, backY, v)} away={(v) => to(backX + (backX === ax.min ? -0.05 : 0.05) * (ax.max - ax.min), backY + (backY === ay.min ? -0.05 : 0.05) * (ay.max - ay.min), v)} label={rp.spec.y2?.label} />
    </g>
  )
}

/** Tick text pushed a little away from the box, along the direction that leads
 *  out of it — which is what keeps a 3-D axis label from landing on the plot. */
function AxisTicks({
  axis,
  st,
  at,
  away,
  label,
}: {
  axis: Axis
  st: PlotStyle
  at: (v: number) => P
  away: (v: number) => P
  label?: string
}) {
  const mid = (axis.min + axis.max) / 2
  const m = away(mid)
  return (
    <g>
      {axis.ticks.map((t, i) => {
        const a = at(t.v)
        const b = away(t.v)
        const dx = b.x - a.x
        return (
          <Fragment key={i}>
            <path d={`M${a.x.toFixed(2)} ${a.y.toFixed(2)}L${(a.x + dx * 0.28).toFixed(2)} ${(a.y + (b.y - a.y) * 0.28).toFixed(2)}`} stroke={st.c.ink} strokeWidth={st.axis * 0.6} />
            <TickLabel
              t={t}
              x={b.x}
              y={b.y + st.tick * 0.34}
              anchor={dx > 2 ? 'start' : dx < -2 ? 'end' : 'middle'}
              size={st.tick * 0.9}
              fill={st.c.muted}
              font={axis.kind === 'category' ? st.font : st.numeric}
            />
          </Fragment>
        )
      })}
      {label && (
        <text
          x={m.x + (m.x > at(mid).x ? st.tick * 2.2 : -st.tick * 2.2)}
          y={m.y + st.tick * 1.6}
          textAnchor="middle"
          fontSize={st.axisLabel}
          fill={st.c.ink}
          fontFamily={st.font}
        >
          {label}
        </text>
      )}
    </g>
  )
}
