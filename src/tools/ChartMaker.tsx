/* Chart Maker — the editor around the plot engine.
 *
 * The document is two things: a table of numbers as text, and a spec that says
 * what to draw with them. Keeping the data as text is what makes this fast to
 * use — you paste a table from anywhere and it plots — and keeping the spec as
 * a structure is what lets an inspector edit it without parsing prose.
 *
 * ⚠️ The old tool's document was a single `라벨 = 값` string and one chart type.
 * `migrate` below turns those saved files into a spec so nothing anyone made
 * before is lost; the storage key is deliberately unchanged, because it is the
 * name every project file already carries. */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import {
  Plot,
  MARK_LABELS,
  PALETTES,
  emptyPanel,
  newId,
  paletteById,
  parseTable,
  figColors,
  type MarkKind,
  type PanelSpec,
  type PlotPick,
  type PlotSpec,
  type SeriesSpec,
} from '../cores'
import { useFitScale, useHistory, usePersist, useStored, useSvgExport } from './hooks'
import BgPicker from './BgPicker'
import { BG_HEX, type BgKey } from './bg'
import { ptOf, printWidthIn as widthInOf } from './paper'
import { useTheme } from '../theme'
import Inspector from './Inspector'
import PrintBar from './PrintBar'
import UndoRedo from './UndoRedo'
import SharedNumField from './NumField'
import { PRESETS, presetById } from './chart/presets'
import { AxesPanel, FigurePanel, PanelPanel, SeriesPanel, type Ctl } from './chart/panels'
import './ChartMaker.css'

const STORE_KEY = 'fem.chart.v1'

interface Persisted {
  /** the data pane, verbatim */
  data: string
  spec: PlotSpec
  bg: BgKey
  widthId: string
  dpi: number
}

const DEFAULTS: Persisted = {
  data: PRESETS[0].data,
  spec: PRESETS[0].spec,
  bg: 'transparent',
  widthId: 'screen',
  dpi: 600,
}

/* ---------- reading what the old tool saved ---------- */

interface LegacySaved {
  type?: string
  input?: string
  scatterInput?: string
  title?: string
  showValues?: boolean
  figW?: number
  figH?: number
}

/** `사과 = 30` lines become a two-column table; `(1, 2)` lines become x/y. */
function legacyTable(saved: LegacySaved): { data: string; mark: MarkKind; x: string; y: string } {
  if (saved.type === 'scatter') {
    const rows: string[] = ['x\ty']
    for (const line of (saved.scatterInput ?? '').split('\n')) {
      const m = /^\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?/.exec(line.trim())
      if (m) rows.push(`${m[1]}\t${m[2]}`)
    }
    return { data: rows.join('\n'), mark: 'scatter', x: 'x', y: 'y' }
  }
  const rows: string[] = ['항목\t값']
  for (const line of (saved.input ?? '').split('\n')) {
    const m = /^(.+?)\s*[=:]\s*(-?[\d.]+)\s*$/.exec(line.trim())
    if (m) rows.push(`${m[1].trim()}\t${m[2]}`)
  }
  const mark: MarkKind = saved.type === 'line' ? 'line' : saved.type === 'pie' ? 'pie' : 'bar'
  return { data: rows.join('\n'), mark, x: '항목', y: '값' }
}

function migrate(saved: Partial<Persisted> & LegacySaved, defaults: Persisted): Persisted {
  if (saved.spec && saved.data !== undefined) return { ...defaults, ...saved } as Persisted
  if (saved.input === undefined && saved.scatterInput === undefined)
    return { ...defaults, ...saved } as Persisted

  const { data, mark, x, y } = legacyTable(saved)
  const spec: PlotSpec = {
    title: saved.title || undefined,
    width: saved.figW ?? 640,
    height: saved.figH ?? 440,
    // the old tool drew neon; keeping that is what "opens the same" means
    palette: 'funky',
    columns: 1,
    panels: [
      {
        ...emptyPanel('p1'),
        legend: { pos: mark === 'pie' ? 'right' : 'none', frame: mark !== 'pie' },
        y: { grid: true, zero: true },
        x: { grid: false },
        series: [{ id: 's1', mark, x, y, labels: saved.showValues ?? true }],
      },
    ],
  }
  return { ...defaults, ...saved, data, spec }
}

/* ---------- tabs ---------- */

type Tab = 'series' | 'axes' | 'panel' | 'figure'
const TABS: { id: Tab; label: string }[] = [
  { id: 'series', label: '계열' },
  { id: 'axes', label: '축' },
  { id: 'panel', label: '패널' },
  { id: 'figure', label: '그림' },
]

/* ---------- app ---------- */

export default function ChartMakerTool() {
  const theme = useTheme()
  const initial = useStored<Persisted>(STORE_KEY, DEFAULTS, migrate as never)

  const [data, setData] = useState(initial.data)
  const [spec, setSpec] = useState<PlotSpec>(initial.spec)
  const [bg, setBg] = useState<BgKey>(initial.bg)
  const [widthId, setWidthId] = useState(initial.widthId)
  const [dpi, setDpi] = useState(initial.dpi)

  const [panelIndex, setPanelIndex] = useState(0)
  const [seriesId, setSeriesId] = useState<string | null>(
    initial.spec.panels[0]?.series[0]?.id ?? null,
  )
  const [tab, setTab] = useState<Tab>('series')
  const [pick, setPick] = useState<PlotPick | null>(null)
  const [presetId, setPresetId] = useState('')

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const table = useMemo(() => parseTable(data), [data])
  const palette = paletteById(spec.palette).colors
  const bgHex = BG_HEX[bg]

  const persisted: Persisted = { data, spec, bg, widthId, dpi }
  usePersist(STORE_KEY, persisted)

  const history = useHistory(persisted, (s) => {
    setData(s.data)
    setSpec(s.spec)
    setBg(s.bg)
    setWidthId(s.widthId)
    setDpi(s.dpi)
  })

  useLayoutEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(200, ta.scrollHeight)}px`
  }, [data])

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    signature: `${spec.width}|${spec.height}|${bg}|${theme}|${spec.panels.length}|${spec.title ?? ''}`,
  })

  const printIn = widthInOf(widthId, spec.width)

  const { saveSvg, savePng, copyPng, pixels, busy, toast } = useSvgExport({
    svgRef,
    filename: 'chart',
    printWidthIn: printIn,
    figPxWidth: spec.width,
    figPxHeight: spec.height,
    bg: bgHex,
    fontFamily: figColors(theme, bg === 'dark', palette).text,
    dpi,
    title: 'Made with Funky Esset Maker — Chart Maker',
  })

  /* ---------- editing ---------- */

  const patchFigure = useCallback((over: Partial<PlotSpec>) => {
    setSpec((s) => ({ ...s, ...over }))
  }, [])

  const patchPanelAt = useCallback((index: number, over: Partial<PanelSpec>) => {
    setSpec((s) => ({
      ...s,
      panels: s.panels.map((p, i) => (i === index ? { ...p, ...over } : p)),
    }))
  }, [])

  const patchPanel = useCallback(
    (over: Partial<PanelSpec>) => patchPanelAt(panelIndex, over),
    [panelIndex, patchPanelAt],
  )

  const patchSeries = useCallback(
    (id: string, over: Partial<SeriesSpec>) => {
      setSpec((s) => ({
        ...s,
        panels: s.panels.map((p, i) =>
          i === panelIndex
            ? { ...p, series: p.series.map((q) => (q.id === id ? { ...q, ...over } : q)) }
            : p,
        ),
      }))
    },
    [panelIndex],
  )

  const addSeries = useCallback(
    (mark: MarkKind) => {
      const id = newId('s')
      const firstNumeric = table.columns.find((c) => c.numeric)?.name
      const firstText = table.columns.find((c) => !c.numeric)?.name
      setSpec((s) => ({
        ...s,
        panels: s.panels.map((p, i) =>
          i === panelIndex
            ? { ...p, series: [...p.series, { id, mark, x: firstText ?? firstNumeric, y: firstNumeric }] }
            : p,
        ),
      }))
      setSeriesId(id)
      setTab('series')
    },
    [panelIndex, table.columns],
  )

  const removeSeries = useCallback(
    (id: string) => {
      setSpec((s) => ({
        ...s,
        panels: s.panels.map((p, i) =>
          i === panelIndex ? { ...p, series: p.series.filter((q) => q.id !== id) } : p,
        ),
      }))
      setSeriesId((cur) => (cur === id ? null : cur))
    },
    [panelIndex],
  )

  const addPanel = useCallback(() => {
    setSpec((s) => ({ ...s, panels: [...s.panels, emptyPanel()] }))
    setPanelIndex(spec.panels.length)
    setTab('panel')
  }, [spec.panels.length])

  const removePanel = useCallback((index: number) => {
    setSpec((s) => ({ ...s, panels: s.panels.filter((_, i) => i !== index) }))
    setPanelIndex((i) => Math.max(0, Math.min(i, spec.panels.length - 2)))
  }, [spec.panels.length])

  const ctl: Ctl = {
    spec,
    columns: table.columns,
    palette,
    panelIndex: Math.min(panelIndex, Math.max(0, spec.panels.length - 1)),
    seriesId,
    patchFigure,
    patchPanel,
    patchSeries,
    addSeries,
    removeSeries,
    addPanel,
    removePanel,
    selectPanel: setPanelIndex,
    selectSeries: setSeriesId,
  }

  const loadPreset = (id: string) => {
    if (!id) return
    const p = presetById(id)
    setData(p.data)
    // a preset is a whole figure, but the page it prints on is the author's
    setSpec({ ...p.spec, palette: spec.palette })
    setPanelIndex(0)
    setSeriesId(p.spec.panels[0]?.series[0]?.id ?? null)
    setPick(null)
    setPresetId(id)
    setTab('series')
  }

  const onPick = (p: PlotPick) => {
    const idx = spec.panels.findIndex((q) => q.id === p.panelId)
    if (idx >= 0) setPanelIndex(idx)
    setSeriesId(p.seriesId)
    setPick(p)
    setTab('series')
  }

  const panel = spec.panels[ctl.panelIndex]
  const selectedSeries = panel?.series.find((s) => s.id === seriesId)

  return (
    <div className="app">
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          Chart Maker
        </Text>

        <UndoRedo history={history} />

        <div className="toolbar__group">
          <span className="toolbar__label">예제</span>
          <select
            className="cm-preset"
            value={presetId}
            aria-label="예제 그래프"
            onChange={(e) => loadPreset(e.target.value)}
          >
            <option value="">불러오기…</option>
            {[...new Set(PRESETS.map((p) => p.group))].map((g) => (
              <optgroup key={g} label={g}>
                {PRESETS.filter((p) => p.group === g).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <input
          className="cm-title"
          value={spec.title ?? ''}
          onChange={(e) => patchFigure({ title: e.target.value || undefined })}
          placeholder="제목 (선택)"
          spellCheck={false}
          aria-label="그래프 제목"
        />

        <div className="toolbar__group">
          <span className="toolbar__label">색</span>
          <select
            className="cm-preset"
            value={spec.palette}
            aria-label="팔레트"
            onChange={(e) => patchFigure({ palette: e.target.value })}
          >
            {PALETTES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <div className="swatches">
            {palette.slice(0, 6).map((c) => (
              <span key={c} className="swatch swatch--flat" style={{ background: c }} />
            ))}
          </div>
        </div>

        <div className="toolbar__group">
          <span className="toolbar__label">크기</span>
          <SharedNumField
            className="cm-num"
            integer
            value={spec.width}
            onCommit={(n) => patchFigure({ width: Math.max(280, n) })}
          />
          <span className="cm-tilde">×</span>
          <SharedNumField
            className="cm-num"
            integer
            value={spec.height}
            onCommit={(n) => patchFigure({ height: Math.max(220, n) })}
          />
        </div>

        <PrintBar
          widthId={widthId}
          onWidth={(id, px) => {
            setWidthId(id)
            if (px) {
              const ratio = spec.height / spec.width
              patchFigure({ width: px, height: Math.round(px * ratio) })
            }
          }}
          dpi={dpi}
          onDpi={setDpi}
          labelPt={ptOf(theme === 'paper' ? 10 : 13, printIn, spec.width)}
          pixels={pixels}
        />

        <BgPicker value={bg} onChange={setBg} />

        <div className="toolbar__spacer" />

        <Button variant="warning" size="sm" title="벡터 SVG로 저장 (⌘⇧E)" onClick={saveSvg}>
          SVG
        </Button>
        <Button variant="success" size="sm" title="PNG로 저장 (⌘E)" onClick={savePng} disabled={busy}>
          PNG 저장
        </Button>
        <Button variant="info" size="sm" title="클립보드로 복사 (⌘⇧C)" onClick={copyPng} disabled={busy}>
          복사
        </Button>
      </div>

      <div className="stage fx-insp-host" ref={stageRef}>
        <div
          className="fitbox"
          style={nat.w ? { width: nat.w * scale, height: nat.h * scale } : undefined}
        >
          <div
            className="shot"
            ref={shotRef}
            style={{ transform: `scale(${scale})`, ...(bgHex ? { background: bgHex } : null) }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setPick(null)
            }}
          >
            <Plot
              spec={spec}
              data={table}
              theme={theme}
              bg={bg}
              svgRef={svgRef}
              onPick={onPick}
              selected={pick}
            />
          </div>
        </div>

        <Inspector
          title={TABS.find((t) => t.id === tab)?.label ?? '속성'}
          hint={
            tab === 'series'
              ? selectedSeries
                ? `${selectedSeries.name || selectedSeries.y || ''} · ${MARK_LABELS[selectedSeries.mark]}`
                : '계열을 고르세요'
              : `패널 ${ctl.panelIndex + 1} / ${spec.panels.length}`
          }
        >
          <div className="cm-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`cm-tab${tab === t.id ? ' is-on' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'series' && <SeriesPanel ctl={ctl} />}
          {tab === 'axes' && <AxesPanel ctl={ctl} />}
          {tab === 'panel' && <PanelPanel ctl={ctl} />}
          {tab === 'figure' && <FigurePanel ctl={ctl} />}
        </Inspector>

        {toast && <div className="toast">{toast}</div>}
      </div>

      <div className="editor">
        <span className="editor__prompt">▦</span>
        <textarea
          ref={inputRef}
          className="editor__input"
          value={data}
          onChange={(e) => setData(e.target.value)}
          placeholder={'첫 줄은 열 이름 — 쉼표, 탭, 공백 아무거나\n항목\t값\n사과\t30'}
          spellCheck={false}
          rows={1}
          aria-label="데이터 표"
        />
      </div>

      <Text variant="chrome" muted className="hint">
        {`${table.columns.length}열 × ${table.rows.length}행 · 표를 붙여넣으면 바로 그려집니다 · 마크를 클릭하면 그 계열을 편집합니다`}
      </Text>
    </div>
  )
}
