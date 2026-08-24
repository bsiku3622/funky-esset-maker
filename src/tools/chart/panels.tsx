/* The four property panels: 계열 · 축 · 패널 · 그림.
 *
 * The engine has far more options than a toolbar can hold, so they live here,
 * grouped by what they belong to rather than by how often they are used. The
 * split is the same one the spec makes — a series option edits a series, an
 * axis option edits an axis — so there is never a question about where a
 * control should go. */

import { Fragment } from 'react'
import { Field, Group, Row, Swatches } from '../Inspector'
import { AutoNum, ColSel, Num, Sel, Toggle, Txt, type Opt } from './controls'
import {
  COLOR_MAPS,
  MARK_LABELS,
  PALETTES,
  newId,
  type AnnotationSpec,
  type AxisSpec,
  type Column,
  type CoordKind,
  type DashKind,
  type MarkKind,
  type MarkerKind,
  type PanelSpec,
  type PlotSpec,
  type SeriesSpec,
  type TickFormat,
} from '../../cores'

export interface Ctl {
  spec: PlotSpec
  columns: Column[]
  palette: string[]
  panelIndex: number
  seriesId: string | null
  patchFigure: (over: Partial<PlotSpec>) => void
  patchPanel: (over: Partial<PanelSpec>) => void
  patchSeries: (id: string, over: Partial<SeriesSpec>) => void
  addSeries: (mark: MarkKind) => void
  removeSeries: (id: string) => void
  addPanel: () => void
  removePanel: (index: number) => void
  selectPanel: (index: number) => void
  selectSeries: (id: string | null) => void
}

const MARK_OPTS: Opt<MarkKind>[] = (Object.keys(MARK_LABELS) as MarkKind[]).map((k) => ({
  v: k,
  l: MARK_LABELS[k],
}))

const MARKER_OPTS: Opt<MarkerKind>[] = [
  { v: 'none', l: '없음' },
  { v: 'circle', l: '● 원' },
  { v: 'hollow', l: '○ 빈 원' },
  { v: 'square', l: '■ 사각' },
  { v: 'triangle', l: '▲ 삼각' },
  { v: 'diamond', l: '◆ 마름모' },
  { v: 'cross', l: '✕ 가위' },
  { v: 'plus', l: '＋ 십자' },
  { v: 'star', l: '★ 별' },
]

const DASH_OPTS: Opt<DashKind>[] = [
  { v: 'solid', l: '───' },
  { v: 'dash', l: '─ ─ ─' },
  { v: 'dot', l: '· · ·' },
  { v: 'dashdot', l: '─ · ─' },
  { v: 'longdash', l: '── ──' },
]

const FORMAT_OPTS: Opt<TickFormat>[] = [
  { v: 'auto', l: '자동' },
  { v: 'int', l: '정수' },
  { v: 'sci', l: '지수' },
  { v: 'percent', l: '퍼센트' },
  { v: 'si', l: 'SI (k·M)' },
  { v: 'comma', l: '천 단위' },
]

/* ---------- series ---------- */

export function SeriesPanel({ ctl }: { ctl: Ctl }) {
  const panel = ctl.spec.panels[ctl.panelIndex]
  const s = panel?.series.find((q) => q.id === ctl.seriesId)
  if (!panel) return null

  return (
    <>
      <Group label="계열">
        <Row label="">
          <div className="cm-chips">
            {panel.series.map((q) => (
              <button
                key={q.id}
                type="button"
                className={`cm-chip${q.id === ctl.seriesId ? ' is-on' : ''}${q.hidden ? ' is-off' : ''}`}
                onClick={() => ctl.selectSeries(q.id)}
              >
                <i style={{ background: q.color ?? colorFor(ctl, panel, q) }} />
                {q.name || q.y || MARK_LABELS[q.mark]}
              </button>
            ))}
            <button type="button" className="cm-chip cm-chip--add" onClick={() => ctl.addSeries('line')}>
              ＋
            </button>
          </div>
        </Row>
      </Group>

      {s && (
        <>
          <Group label="데이터">
            <Field label="종류">
              <Sel value={s.mark} onChange={(mark) => ctl.patchSeries(s.id, { mark })} opts={MARK_OPTS} />
            </Field>
            <Field label="이름">
              <Txt value={s.name ?? ''} placeholder={s.y ?? '계열'} onChange={(name) => ctl.patchSeries(s.id, { name: name || undefined })} />
            </Field>
            <Field label={xLabelFor(s.mark)}>
              <ColSel value={s.x} columns={ctl.columns} onChange={(x) => ctl.patchSeries(s.id, { x })} none="행 순서" />
            </Field>
            <Field label={yLabelFor(s.mark)}>
              <ColSel value={s.y} columns={ctl.columns} onChange={(y) => ctl.patchSeries(s.id, { y })} />
            </Field>
            {(s.mark === 'ternary' || s.mark === 'area') && (
              <Field label={s.mark === 'ternary' ? '세 번째' : '아래쪽'}>
                <ColSel value={s.y2} columns={ctl.columns} onChange={(y2) => ctl.patchSeries(s.id, { y2 })} />
              </Field>
            )}
            {NEEDS_VALUE.has(s.mark) && (
              <Field label="값(색)">
                <ColSel value={s.value} columns={ctl.columns} onChange={(value) => ctl.patchSeries(s.id, { value })} />
              </Field>
            )}
            {s.mark === 'quiver' && (
              <>
                <Field label="u">
                  <ColSel value={s.u} columns={ctl.columns} onChange={(u) => ctl.patchSeries(s.id, { u })} />
                </Field>
                <Field label="v">
                  <ColSel value={s.v} columns={ctl.columns} onChange={(v) => ctl.patchSeries(s.id, { v })} />
                </Field>
              </>
            )}
            {s.mark === 'scatter' && (
              <Field label="크기">
                <ColSel value={s.size} columns={ctl.columns} onChange={(size) => ctl.patchSeries(s.id, { size })} />
              </Field>
            )}
            {LABELLABLE.has(s.mark) && (
              <Field label="라벨 열">
                <ColSel value={s.text} columns={ctl.columns} onChange={(text) => ctl.patchSeries(s.id, { text })} />
              </Field>
            )}
            <Field label="그룹">
              <ColSel value={s.group} columns={ctl.columns} onChange={(group) => ctl.patchSeries(s.id, { group })} />
            </Field>
            <Field label="오차">
              <ColSel value={s.err} columns={ctl.columns} onChange={(err) => ctl.patchSeries(s.id, { err })} />
            </Field>
          </Group>

          <Group label="모양">
            <Row label="색">
              <Swatches
                colors={ctl.palette}
                value={s.color ?? ''}
                onChange={(color) => ctl.patchSeries(s.id, { color })}
              />
            </Row>
            <Row label="">
              <button type="button" className="fx-insp__btn" onClick={() => ctl.patchSeries(s.id, { color: undefined })}>
                팔레트 순서대로
              </button>
            </Row>
            {LINE_LIKE.has(s.mark) && (
              <>
                <Field label="굵기">
                  <Num value={s.width ?? 3} onChange={(width) => ctl.patchSeries(s.id, { width })} />
                </Field>
                <Field label="선 모양">
                  <Sel value={s.dash ?? 'solid'} onChange={(dash) => ctl.patchSeries(s.id, { dash })} opts={DASH_OPTS} />
                </Field>
              </>
            )}
            {MARKER_LIKE.has(s.mark) && (
              <>
                <Field label="마커">
                  <Sel value={s.marker ?? (s.mark === 'scatter' ? 'circle' : 'none')} onChange={(marker) => ctl.patchSeries(s.id, { marker })} opts={MARKER_OPTS} />
                </Field>
                <Field label="마커 크기">
                  <Num value={s.markerSize ?? 5} onChange={(markerSize) => ctl.patchSeries(s.id, { markerSize })} />
                </Field>
              </>
            )}
            {(s.mark === 'line' || s.mark === 'area') && (
              <Row label="곡선">
                <Toggle on={!!s.smooth} onChange={(smooth) => ctl.patchSeries(s.id, { smooth })}>
                  부드럽게
                </Toggle>
              </Row>
            )}
            {s.mark === 'step' && (
              <Field label="계단">
                <Sel
                  value={s.stepAt ?? 'post'}
                  onChange={(stepAt) => ctl.patchSeries(s.id, { stepAt })}
                  opts={[
                    { v: 'post', l: '값 유지 후 상승' },
                    { v: 'pre', l: '먼저 상승' },
                    { v: 'mid', l: '중간에서' },
                  ]}
                />
              </Field>
            )}
            {(s.mark === 'bar' || s.mark === 'box' || s.mark === 'violin') && (
              <>
                <Row label="방향">
                  <Toggle on={s.orient === 'h'} onChange={(h) => ctl.patchSeries(s.id, { orient: h ? 'h' : 'v' })}>
                    가로
                  </Toggle>
                </Row>
                <Field label="두께">
                  <Num value={s.barWidth ?? 0.8} onChange={(barWidth) => ctl.patchSeries(s.id, { barWidth })} />
                </Field>
              </>
            )}
            {s.mark === 'histogram' && (
              <>
                <Field label="구간 수">
                  <AutoNum value={s.bins ?? null} onChange={(bins) => ctl.patchSeries(s.id, { bins: bins ?? undefined })} integer />
                </Field>
                <Row label="세로축">
                  <Toggle on={!!s.density} onChange={(density) => ctl.patchSeries(s.id, { density })}>
                    밀도
                  </Toggle>
                </Row>
              </>
            )}
            {s.mark === 'pie' && (
              <Field label="가운데">
                <Num value={s.hole ?? 0} onChange={(hole) => ctl.patchSeries(s.id, { hole })} />
              </Field>
            )}
            {USES_MAP.has(s.mark) && (
              <>
                <Field label="컬러맵">
                  <Sel
                    value={s.colorMap ?? ''}
                    onChange={(colorMap) => ctl.patchSeries(s.id, { colorMap: colorMap || undefined })}
                    opts={[{ v: '', l: '계열 색' }, ...COLOR_MAPS.map((m) => ({ v: m.id, l: m.label }))]}
                  />
                </Field>
                <Field label="최소">
                  <AutoNum value={s.vmin ?? null} onChange={(vmin) => ctl.patchSeries(s.id, { vmin })} />
                </Field>
                <Field label="최대">
                  <AutoNum value={s.vmax ?? null} onChange={(vmax) => ctl.patchSeries(s.id, { vmax })} />
                </Field>
              </>
            )}
            {(s.mark === 'contour' || s.mark === 'heatmap') && (
              <Field label="단계">
                <AutoNum value={s.levels ?? null} onChange={(levels) => ctl.patchSeries(s.id, { levels: levels ?? undefined })} integer />
              </Field>
            )}
            <Field label="투명도">
              <Num value={s.opacity ?? 1} onChange={(opacity) => ctl.patchSeries(s.id, { opacity })} />
            </Field>
          </Group>

          <Group label="배치">
            <Field label="누적">
              <Txt value={s.stack ?? ''} placeholder="같은 이름끼리" onChange={(v) => ctl.patchSeries(s.id, { stack: v || null })} />
            </Field>
            <Row label="세로축">
              <Toggle on={s.axis === 'right'} onChange={(r) => ctl.patchSeries(s.id, { axis: r ? 'right' : 'left' })}>
                오른쪽
              </Toggle>
            </Row>
            <Row label="값 표시">
              <Toggle on={!!s.labels} onChange={(labels) => ctl.patchSeries(s.id, { labels })}>
                켜기
              </Toggle>
              {s.labels && (
                <Sel value={s.labelFormat ?? 'auto'} onChange={(labelFormat) => ctl.patchSeries(s.id, { labelFormat })} opts={FORMAT_OPTS} />
              )}
            </Row>
            <Field label="추세선">
              <Sel
                value={s.trend ?? 'none'}
                onChange={(trend) => ctl.patchSeries(s.id, { trend })}
                opts={[
                  { v: 'none', l: '없음' },
                  { v: 'linear', l: '직선' },
                  { v: 'poly2', l: '2차' },
                  { v: 'poly3', l: '3차' },
                  { v: 'mean', l: '평균선' },
                ]}
              />
            </Field>
            {s.trend && s.trend !== 'none' && s.trend !== 'mean' && (
              <Row label="R²">
                <Toggle on={!!s.trendLabel} onChange={(trendLabel) => ctl.patchSeries(s.id, { trendLabel })}>
                  표시
                </Toggle>
              </Row>
            )}
            <Row label="">
              <Toggle on={!!s.hidden} onChange={(hidden) => ctl.patchSeries(s.id, { hidden })}>
                숨기기
              </Toggle>
              <button type="button" className="fx-insp__btn fx-insp__btn--danger" onClick={() => ctl.removeSeries(s.id)}>
                삭제
              </button>
            </Row>
          </Group>
        </>
      )}
    </>
  )
}

const LINE_LIKE = new Set<MarkKind>(['line', 'area', 'step', 'stem', 'contour', 'radar', 'quiver'])
const MARKER_LIKE = new Set<MarkKind>(['line', 'area', 'step', 'stem', 'scatter', 'radar', 'ternary', 'scatter3d'])
const LABELLABLE = new Set<MarkKind>(['scatter', 'ternary', 'scatter3d', 'line', 'bar'])
const NEEDS_VALUE = new Set<MarkKind>(['heatmap', 'contour', 'surface', 'scatter3d', 'scatter'])
const USES_MAP = new Set<MarkKind>(['heatmap', 'contour', 'surface', 'scatter3d', 'scatter'])

const xLabelFor = (m: MarkKind): string =>
  m === 'ternary' ? '첫 번째' : m === 'rose' ? '방위' : m === 'radar' ? '축' : m === 'histogram' ? '(안 씀)' : 'x 열'
const yLabelFor = (m: MarkKind): string =>
  m === 'ternary' ? '두 번째' : m === 'histogram' ? '값 열' : m === 'rose' ? '크기' : 'y 열'

function colorFor(ctl: Ctl, panel: PanelSpec, s: SeriesSpec): string {
  const visible = panel.series.filter((q) => !q.hidden)
  const i = visible.indexOf(s)
  return ctl.palette[(i < 0 ? 0 : i) % ctl.palette.length]
}

/* ---------- axes ---------- */

function AxisRows({
  label,
  axis,
  onChange,
  categorical,
}: {
  label: string
  axis: AxisSpec
  onChange: (over: Partial<AxisSpec>) => void
  categorical?: boolean
}) {
  return (
    <Group label={label}>
      <Field label="이름">
        <Txt value={axis.label ?? ''} onChange={(v) => onChange({ label: v || undefined })} />
      </Field>
      {!categorical && (
        <Field label="스케일">
          <Sel
            value={axis.scale ?? 'linear'}
            onChange={(scale) => onChange({ scale })}
            opts={[
              { v: 'linear', l: '선형' },
              { v: 'log', l: '로그' },
            ]}
          />
        </Field>
      )}
      <Field label="최소">
        <AutoNum value={axis.min ?? null} onChange={(min) => onChange({ min })} />
      </Field>
      <Field label="최대">
        <AutoNum value={axis.max ?? null} onChange={(max) => onChange({ max })} />
      </Field>
      <Row label="방향">
        <Toggle on={!!axis.reverse} onChange={(reverse) => onChange({ reverse })} title="H–R 다이어그램처럼 축을 뒤집습니다">
          반전
        </Toggle>
        <Toggle on={!!axis.zero} onChange={(zero) => onChange({ zero })} title="자동 범위에 0을 포함합니다">
          0 포함
        </Toggle>
      </Row>
      <Row label="격자">
        <Toggle on={axis.grid ?? false} onChange={(grid) => onChange({ grid })}>
          주
        </Toggle>
        <Toggle on={!!axis.minorGrid} onChange={(minorGrid) => onChange({ minorGrid })}>
          보조
        </Toggle>
        <Toggle on={axis.line ?? true} onChange={(line) => onChange({ line })}>
          축선
        </Toggle>
      </Row>
      <Field label="눈금 수">
        <Num value={axis.tickCount ?? 6} onChange={(tickCount) => onChange({ tickCount })} integer />
      </Field>
      <Field label="눈금 간격">
        <AutoNum value={axis.tickStep ?? null} onChange={(tickStep) => onChange({ tickStep })} />
      </Field>
      <Field label="형식">
        <Sel value={axis.format ?? 'auto'} onChange={(format) => onChange({ format })} opts={FORMAT_OPTS} />
      </Field>
      <Field label="소수점">
        <AutoNum value={axis.decimals ?? null} onChange={(decimals) => onChange({ decimals })} integer />
      </Field>
      <Field label="단위">
        <Txt value={axis.suffix ?? ''} placeholder="예: %" onChange={(v) => onChange({ suffix: v || undefined })} />
      </Field>
      <Field label="라벨 각도">
        <Num value={axis.angle ?? 0} onChange={(angle) => onChange({ angle })} integer />
      </Field>
    </Group>
  )
}

export function AxesPanel({ ctl }: { ctl: Ctl }) {
  const panel = ctl.spec.panels[ctl.panelIndex]
  if (!panel) return null
  const hasRight = panel.series.some((s) => s.axis === 'right')
  return (
    <>
      <AxisRows label="x 축" axis={panel.x ?? {}} onChange={(over) => ctl.patchPanel({ x: { ...(panel.x ?? {}), ...over } })} />
      <AxisRows label="y 축" axis={panel.y ?? {}} onChange={(over) => ctl.patchPanel({ y: { ...(panel.y ?? {}), ...over } })} />
      {hasRight && (
        <AxisRows label="오른쪽 y 축" axis={panel.y2 ?? {}} onChange={(over) => ctl.patchPanel({ y2: { ...(panel.y2 ?? {}), ...over } })} />
      )}
    </>
  )
}

/* ---------- panel ---------- */

const COORD_OPTS: Opt<CoordKind>[] = [
  { v: 'cartesian', l: '직교' },
  { v: 'polar', l: '극좌표' },
  { v: 'ternary', l: '삼각도' },
  { v: 'proj3d', l: '3D' },
]

const ANNOT_OPTS: Opt<AnnotationSpec['kind']>[] = [
  { v: 'hline', l: '가로 기준선' },
  { v: 'vline', l: '세로 기준선' },
  { v: 'hband', l: '가로 구간' },
  { v: 'vband', l: '세로 구간' },
  { v: 'text', l: '글자' },
  { v: 'arrow', l: '화살표' },
  { v: 'rect', l: '사각형' },
]

export function PanelPanel({ ctl }: { ctl: Ctl }) {
  const panel = ctl.spec.panels[ctl.panelIndex]
  if (!panel) return null
  const ann = panel.annotations ?? []
  const patchAnn = (id: string, over: Partial<AnnotationSpec>) =>
    ctl.patchPanel({ annotations: ann.map((a) => (a.id === id ? { ...a, ...over } : a)) })

  return (
    <>
      <Group label="패널">
        <Row label="">
          <div className="cm-chips">
            {ctl.spec.panels.map((q, i) => (
              <button
                key={q.id}
                type="button"
                className={`cm-chip${i === ctl.panelIndex ? ' is-on' : ''}`}
                onClick={() => ctl.selectPanel(i)}
              >
                {q.title || `패널 ${i + 1}`}
              </button>
            ))}
            <button type="button" className="cm-chip cm-chip--add" onClick={ctl.addPanel}>
              ＋
            </button>
          </div>
        </Row>
        <Field label="제목">
          <Txt value={panel.title ?? ''} onChange={(title) => ctl.patchPanel({ title: title || undefined })} />
        </Field>
        <Field label="좌표계">
          <Sel value={panel.coord ?? 'cartesian'} onChange={(coord) => ctl.patchPanel({ coord })} opts={COORD_OPTS} />
        </Field>
        <Row label="테두리">
          <Toggle on={!!panel.frame} onChange={(frame) => ctl.patchPanel({ frame })}>
            사방 축
          </Toggle>
        </Row>
        {ctl.spec.panels.length > 1 && (
          <Row label="">
            <button
              type="button"
              className="fx-insp__btn fx-insp__btn--danger"
              onClick={() => ctl.removePanel(ctl.panelIndex)}
            >
              이 패널 삭제
            </button>
          </Row>
        )}
      </Group>

      {panel.coord === 'polar' && (
        <Group label="극좌표">
          <Field label="구획 수">
            <Num value={panel.sectors ?? 16} onChange={(sectors) => ctl.patchPanel({ sectors })} integer />
          </Field>
          <Field label="0의 방향">
            <Num value={panel.polarStart ?? 90} onChange={(polarStart) => ctl.patchPanel({ polarStart })} integer />
          </Field>
          <Row label="회전">
            <Toggle on={panel.polarClockwise ?? true} onChange={(polarClockwise) => ctl.patchPanel({ polarClockwise })}>
              시계 방향
            </Toggle>
          </Row>
        </Group>
      )}

      {panel.coord === 'ternary' && (
        <Group label="삼각도 꼭짓점">
          {[0, 1, 2].map((i) => (
            <Field key={i} label={['위', '왼쪽', '오른쪽'][i]}>
              <Txt
                value={panel.ternaryLabels?.[i] ?? ''}
                onChange={(v) => {
                  const next: [string, string, string] = [...(panel.ternaryLabels ?? ['A', 'B', 'C'])] as [string, string, string]
                  next[i] = v
                  ctl.patchPanel({ ternaryLabels: next })
                }}
              />
            </Field>
          ))}
        </Group>
      )}

      {panel.coord === 'proj3d' && (
        <Group label="3D 시점">
          <Field label="고도">
            <Num value={panel.elev ?? 28} onChange={(elev) => ctl.patchPanel({ elev })} integer />
          </Field>
          <Field label="방위">
            <Num value={panel.azim ?? -60} onChange={(azim) => ctl.patchPanel({ azim })} integer />
          </Field>
          <Field label="z 축 이름">
            <Txt value={panel.y2?.label ?? ''} onChange={(v) => ctl.patchPanel({ y2: { ...(panel.y2 ?? {}), label: v || undefined } })} />
          </Field>
        </Group>
      )}

      <Group label="범례">
        <Field label="위치">
          <Sel
            value={panel.legend?.pos ?? 'top-right'}
            onChange={(pos) => ctl.patchPanel({ legend: { ...(panel.legend ?? {}), pos } })}
            opts={[
              { v: 'none', l: '없음' },
              { v: 'top-left', l: '왼쪽 위' },
              { v: 'top-right', l: '오른쪽 위' },
              { v: 'bottom-left', l: '왼쪽 아래' },
              { v: 'bottom-right', l: '오른쪽 아래' },
              { v: 'top', l: '위 가운데' },
              { v: 'bottom', l: '아래 가운데' },
              { v: 'right', l: '바깥 오른쪽' },
            ]}
          />
        </Field>
        <Field label="제목">
          <Txt
            value={panel.legend?.title ?? ''}
            onChange={(title) => ctl.patchPanel({ legend: { ...(panel.legend ?? {}), title: title || undefined } })}
          />
        </Field>
        <Row label="상자">
          <Toggle
            on={panel.legend?.frame !== false}
            onChange={(frame) => ctl.patchPanel({ legend: { ...(panel.legend ?? {}), frame } })}
          >
            테두리
          </Toggle>
        </Row>
        <Field label="열 수">
          <Num value={panel.legend?.columns ?? 1} onChange={(columns) => ctl.patchPanel({ legend: { ...(panel.legend ?? {}), columns } })} integer />
        </Field>
      </Group>

      <Group label="주석">
        {ann.map((a) => (
          <Fragment key={a.id}>
            <Field label="종류">
              <Sel value={a.kind} onChange={(kind) => patchAnn(a.id, { kind })} opts={ANNOT_OPTS} />
            </Field>
            {a.kind !== 'text' && (
              <Row label="위치">
                {(a.kind === 'hline' || a.kind === 'hband') && (
                  <Num value={a.y ?? 0} onChange={(y) => patchAnn(a.id, { y })} />
                )}
                {(a.kind === 'vline' || a.kind === 'vband') && (
                  <Num value={a.x ?? 0} onChange={(x) => patchAnn(a.id, { x })} />
                )}
                {(a.kind === 'hband' || a.kind === 'vband') && (
                  <Num value={(a.kind === 'hband' ? a.y2 : a.x2) ?? 0} onChange={(v) => patchAnn(a.id, a.kind === 'hband' ? { y2: v } : { x2: v })} />
                )}
                {(a.kind === 'arrow' || a.kind === 'rect') && (
                  <>
                    <Num value={a.x ?? 0} onChange={(x) => patchAnn(a.id, { x })} />
                    <Num value={a.y ?? 0} onChange={(y) => patchAnn(a.id, { y })} />
                  </>
                )}
              </Row>
            )}
            {(a.kind === 'arrow' || a.kind === 'rect') && (
              <Row label="끝">
                <Num value={a.x2 ?? 0} onChange={(x2) => patchAnn(a.id, { x2 })} />
                <Num value={a.y2 ?? 0} onChange={(y2) => patchAnn(a.id, { y2 })} />
              </Row>
            )}
            {a.kind === 'text' && (
              <Row label="위치">
                <Num value={a.x ?? 0} onChange={(x) => patchAnn(a.id, { x })} />
                <Num value={a.y ?? 0} onChange={(y) => patchAnn(a.id, { y })} />
              </Row>
            )}
            <Field label="글자">
              <Txt value={a.text ?? ''} onChange={(text) => patchAnn(a.id, { text: text || undefined })} />
            </Field>
            <Row label="">
              <Swatches
                colors={['#8C8C8C', '#222222', '#C44E52', '#4C72B0', '#55A868', '#DD8452']}
                value={a.color ?? '#8C8C8C'}
                onChange={(color) => patchAnn(a.id, { color })}
              />
              <button
                type="button"
                className="fx-insp__btn fx-insp__btn--danger"
                onClick={() => ctl.patchPanel({ annotations: ann.filter((q) => q.id !== a.id) })}
              >
                ✕
              </button>
            </Row>
          </Fragment>
        ))}
        <Row label="">
          <button
            type="button"
            className="fx-insp__btn"
            onClick={() =>
              ctl.patchPanel({
                annotations: [...ann, { id: newId('a'), kind: 'hline', y: 0, dash: 'dash', color: '#8C8C8C' }],
              })
            }
          >
            ＋ 주석 추가
          </button>
        </Row>
      </Group>
    </>
  )
}

/* ---------- figure ---------- */

export function FigurePanel({ ctl }: { ctl: Ctl }) {
  const f = ctl.spec
  return (
    <>
      <Group label="제목">
        <Field label="제목">
          <Txt value={f.title ?? ''} onChange={(title) => ctl.patchFigure({ title: title || undefined })} />
        </Field>
        <Field label="부제">
          <Txt value={f.subtitle ?? ''} onChange={(subtitle) => ctl.patchFigure({ subtitle: subtitle || undefined })} />
        </Field>
        <Field label="설명">
          <Txt value={f.caption ?? ''} onChange={(caption) => ctl.patchFigure({ caption: caption || undefined })} />
        </Field>
      </Group>
      <Group label="색">
        <Field label="팔레트">
          <Sel value={f.palette} onChange={(palette) => ctl.patchFigure({ palette })} opts={PALETTES.map((p) => ({ v: p.id, l: p.label }))} />
        </Field>
        <Row label="">
          <span className="cm-palette-note">{PALETTES.find((p) => p.id === f.palette)?.note}</span>
        </Row>
        <Row label="">
          <div className="cm-chips">
            {ctl.palette.slice(0, 10).map((c) => (
              <i key={c} className="cm-swatch" style={{ background: c }} />
            ))}
          </div>
        </Row>
      </Group>
      <Group label="배치">
        <Field label="열 수">
          <Num value={f.columns} onChange={(columns) => ctl.patchFigure({ columns: Math.max(1, columns) })} integer />
        </Field>
        <Row label="축 공유">
          <Toggle on={!!f.shareX} onChange={(shareX) => ctl.patchFigure({ shareX })}>
            x
          </Toggle>
          <Toggle on={!!f.shareY} onChange={(shareY) => ctl.patchFigure({ shareY })}>
            y
          </Toggle>
        </Row>
      </Group>
    </>
  )
}
