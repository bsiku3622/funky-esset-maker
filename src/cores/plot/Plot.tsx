/* The figure: a title, a grid of panels, a caption.
 *
 * This is the component a host renders and an export serialises, so it owns the
 * <svg> element and everything inside it — including the legend, which has to
 * be in the same element or a vector export silently loses it.
 *
 * ⚠️ Nothing below may put a CSS variable into an attribute. A standalone SVG
 * has no :root to resolve `var(--…)` against, so an exported figure would come
 * back with every label in the browser's default serif. Colours arrive here as
 * literal hex through the palette and the style tokens. */

import { useId, type Ref } from 'react'
import { parseTable, type DataTable } from './data'
import { resolveFigure, type ResolvedPanel } from './resolve'
import type { PlotSpec } from './spec'
import { plotStyle, gridFontScale } from './style'
import Panel from './Panel'
import { panelGrid, type Rect } from './frame'
import PolarPanel from './PolarPanel'
import TernaryPanel from './TernaryPanel'
import Proj3dPanel from './Proj3dPanel'
import { paletteById } from '../palette'
import type { FigureTheme } from '../figure'

export type PlotBg = 'transparent' | 'cream' | 'white' | 'dark'

const BG_HEX: Record<PlotBg, string | null> = {
  transparent: null,
  cream: '#fff5d1',
  white: '#ffffff',
  dark: '#1e1e22',
}

export interface PlotPick {
  panelId: string
  seriesId: string
  row: number
}

export interface PlotProps {
  spec: PlotSpec
  /** the raw data pane; parsed here so a host can stay text-only */
  data: string | DataTable
  theme?: FigureTheme
  bg?: PlotBg
  svgRef?: Ref<SVGSVGElement>
  onPick?: (pick: PlotPick) => void
  selected?: PlotPick | null
}

/** The union of every panel's data range, for shareX / shareY. */
function sharedRange(panels: ResolvedPanel[], which: 'x' | 'y'): [number, number] | undefined {
  const vs = panels.flatMap((p) => (which === 'x' ? p.xValues : p.yValues)).filter((v) => Number.isFinite(v))
  if (!vs.length) return undefined
  return [Math.min(...vs), Math.max(...vs)]
}

export default function Plot({
  spec,
  data,
  theme = 'funky',
  bg = 'transparent',
  svgRef,
  onPick,
  selected,
}: PlotProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const table: DataTable = typeof data === 'string' ? parseTable(data) : data
  const palette = paletteById(spec.palette).colors
  const st = plotStyle(theme, bg === 'dark', palette, gridFontScale(spec.panels.length))
  const fig = resolveFigure(table, spec, palette)
  const bgHex = BG_HEX[bg]

  const pad = st.tick * 1.2
  const titleH = spec.title ? st.figTitle * 1.7 : 0
  const subH = spec.subtitle ? st.axisLabel * 1.6 : 0
  const capH = spec.caption ? st.axisLabel * 1.7 : 0
  const area: Rect = {
    x: pad,
    y: pad + titleH + subH,
    w: Math.max(20, spec.width - pad * 2),
    h: Math.max(20, spec.height - pad * 2 - titleH - subH - capH),
  }
  const gap = st.axisLabel * (spec.panels.length > 1 ? 2.6 : 0)
  const rects = panelGrid(fig.panels.length, spec.columns, area, gap)

  const shareX = spec.shareX ? sharedRange(fig.panels, 'x') : undefined
  const shareY = spec.shareY ? sharedRange(fig.panels, 'y') : undefined
  const cols = Math.max(1, Math.min(spec.columns || 1, fig.panels.length || 1))

  return (
    <svg
      ref={svgRef}
      width={spec.width}
      height={spec.height}
      viewBox={`0 0 ${spec.width} ${spec.height}`}
      fontFamily={st.font}
      style={bgHex ? { background: bgHex } : undefined}
    >
      <defs>
        {rects.map((r, i) => (
          <clipPath key={i} id={`${uid}-clip${i}`}>
            {/* the clip is the plot area, but the margins are the panel's own
                business — a generous box here is trimmed by the panel's own
                geometry and keeps a marker at the very edge from being sliced */}
            <rect x={r.x} y={r.y} width={r.w} height={r.h} />
          </clipPath>
        ))}
      </defs>

      {spec.title && (
        <text
          x={spec.width / 2}
          y={pad + st.figTitle}
          textAnchor="middle"
          fontSize={st.figTitle}
          fontWeight={st.titleWeight}
          fill={st.c.ink}
        >
          {spec.title}
        </text>
      )}
      {spec.subtitle && (
        <text
          x={spec.width / 2}
          y={pad + titleH + st.axisLabel}
          textAnchor="middle"
          fontSize={st.axisLabel}
          fill={st.c.muted}
        >
          {spec.subtitle}
        </text>
      )}

      {fig.panels.map((rp, i) => {
        const rect = rects[i]
        if (!rect) return null
        const common = {
          rp,
          rect,
          st,
          palette,
          clipId: `${uid}-clip${i}`,
          onPick: onPick ? (seriesId: string, row: number) => onPick({ panelId: rp.spec.id, seriesId, row }) : undefined,
          selected:
            selected && selected.panelId === rp.spec.id
              ? { seriesId: selected.seriesId, row: selected.row }
              : null,
        }
        if (rp.coord === 'polar') return <PolarPanel key={rp.spec.id} {...common} />
        if (rp.coord === 'ternary') return <TernaryPanel key={rp.spec.id} {...common} />
        if (rp.coord === 'proj3d') return <Proj3dPanel key={rp.spec.id} {...common} />
        return (
          <Panel
            key={rp.spec.id}
            {...common}
            shareX={shareX}
            shareY={shareY}
            /* only the outer edge of a shared grid keeps its tick text —
               repeating it on every inner panel is noise, and matplotlib's
               sharex hides it for the same reason */
            hideXTicks={!!spec.shareX && i < fig.panels.length - cols}
            hideYTicks={!!spec.shareY && i % cols !== 0}
          />
        )
      })}

      {spec.caption && (
        <text
          x={pad}
          y={spec.height - pad * 0.4}
          fontSize={st.axisLabel}
          fill={st.c.muted}
        >
          {spec.caption}
        </text>
      )}
    </svg>
  )
}
