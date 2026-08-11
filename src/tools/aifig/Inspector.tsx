/* Right-hand property panel.
 *
 * Shows the canvas settings when nothing is selected, otherwise the union of
 * the selected nodes' / edges' properties. Multi-select edits apply to every
 * selected item; a field displays the first item's value as the representative. */

import { useMemo } from 'react'
import type {
  AlignKind,
  Anchor,
  CanvasCfg,
  DashKind,
  FigDoc,
  FigEdge,
  FigNode,
  FontKind,
  HeadKind,
  LabelPos,
  RouteKind,
  Style,
} from './types'
import {
  CANVAS_PRESETS,
  FONT_LABEL,
  HEADS,
  PALETTES,
  paletteById,
  presetById,
} from './presets'
import { ptOf } from './layout'
import { dataUrlBytes, fileToImage, formatBytes } from './image'
import { Chk, ColorBtn, Field, Group, Num, NumList, Sel, Seg } from './ui'

const DASHES: { key: DashKind; label: string }[] = [
  { key: 'solid', label: '───' },
  { key: 'dashed', label: '- - -' },
  { key: 'dotted', label: '·····' },
  { key: 'dashdot', label: '-·-·' },
]

const ALIGNS: { key: AlignKind; label: string }[] = [
  { key: 'left', label: '⇤' },
  { key: 'center', label: '↔' },
  { key: 'right', label: '⇥' },
]

const LABEL_POS: { key: LabelPos; label: string }[] = [
  { key: 'center', label: '중앙' },
  { key: 'inside-top', label: '안쪽 위' },
  { key: 'inside-bottom', label: '안쪽 아래' },
  { key: 'top', label: '위' },
  { key: 'bottom', label: '아래' },
  { key: 'left', label: '왼쪽' },
  { key: 'right', label: '오른쪽' },
]

const ROUTES: { key: RouteKind; label: string }[] = [
  { key: 'straight', label: '직선' },
  { key: 'ortho', label: '직각' },
  { key: 'curve', label: '곡선' },
  { key: 'arc', label: '호' },
]

/* Which side of a node a connector leaves from and lands on.
 *
 * The routing geometry has supported all nine anchors from the start, but
 * nothing exposed them: dragging out of an anchor dot fixed the *start* side
 * and the end was hardcoded to `auto`, so "out of the right, into the top" —
 * the ordinary L a side branch wants — could not be expressed at all. Only the
 * four sides are offered; corners route badly and `auto` covers the rest. */
const ANCHORS: { key: Anchor; label: string }[] = [
  { key: 'auto', label: '자동' },
  { key: 'n', label: '위' },
  { key: 'e', label: '오른쪽' },
  { key: 's', label: '아래' },
  { key: 'w', label: '왼쪽' },
]

const OPS: { key: string; label: string }[] = [
  { key: '+', label: '⊕ 합' },
  { key: 'x', label: '⊗ 곱' },
  { key: '.', label: '⊙ 내적' },
  { key: '-', label: '⊖ 차' },
  { key: 'c', label: '‖ concat' },
  { key: 'σ', label: 'σ' },
  { key: 'φ', label: 'φ' },
]

const FNS = [
  { key: 'relu', label: 'ReLU' },
  { key: 'sigmoid', label: 'Sigmoid' },
  { key: 'tanh', label: 'tanh' },
  { key: 'gelu', label: 'GELU' },
  { key: 'loss', label: 'Loss' },
  { key: 'sine', label: 'sin' },
  { key: 'step', label: 'Step' },
]

interface Props {
  doc: FigDoc
  nodes: FigNode[]
  edges: FigEdge[]
  onNode: (patch: (n: FigNode) => Partial<FigNode>) => void
  onStyle: (patch: Partial<Style>) => void
  onProps: (patch: Record<string, unknown>) => void
  onEdge: (patch: (e: FigEdge) => Partial<FigEdge>) => void
  onEdgeStyle: (patch: Partial<FigEdge['style']>) => void
  onCanvas: (patch: Partial<CanvasCfg>) => void
  onPalette: (id: string) => void
}

export default function Inspector({
  doc,
  nodes,
  edges,
  onNode,
  onStyle,
  onProps,
  onEdge,
  onEdgeStyle,
  onCanvas,
  onPalette,
}: Props) {
  const pal = paletteById(doc.paletteId)
  const swatches = useMemo(() => [...pal.colors, pal.neutral], [pal])

  if (!nodes.length && !edges.length)
    return (
      <CanvasPanel doc={doc} onCanvas={onCanvas} onPalette={onPalette} />
    )

  return (
    <div className="af-inspector">
      {nodes.length ? (
        <NodePanel
          doc={doc}
          nodes={nodes}
          swatches={swatches}
          onNode={onNode}
          onStyle={onStyle}
          onProps={onProps}
        />
      ) : null}
      {edges.length ? (
        <EdgePanel
          doc={doc}
          edges={edges}
          swatches={swatches}
          onEdge={onEdge}
          onEdgeStyle={onEdgeStyle}
        />
      ) : null}
    </div>
  )
}

/* ---------- canvas ---------- */

function CanvasPanel({
  doc,
  onCanvas,
  onPalette,
}: {
  doc: FigDoc
  onCanvas: (p: Partial<CanvasCfg>) => void
  onPalette: (id: string) => void
}) {
  const c = doc.canvas
  const bodyPt = ptOf(c.baseFont, c)
  return (
    <div className="af-inspector">
      <Group title="캔버스 규격">
        <Field label="프리셋" wide>
          <Sel
            value={c.presetId}
            options={CANVAS_PRESETS.map((p) => ({ key: p.id, label: p.label, group: p.group }))}
            onChange={(id) => {
              const p = presetById(id)
              onCanvas({ presetId: id, w: p.w, h: p.h, printWidthIn: p.widthIn })
            }}
          />
        </Field>
        <Field label="크기 (px)">
          <Num value={c.w} onChange={(w) => onCanvas({ w: Math.max(40, w), presetId: 'free' })} width={62} />
          <span className="af-x">×</span>
          <Num value={c.h} onChange={(h) => onCanvas({ h: Math.max(40, h) })} width={62} />
        </Field>
        <Field label="인쇄 폭">
          <Num
            value={+c.printWidthIn.toFixed(3)}
            step={0.05}
            onChange={(v) => onCanvas({ printWidthIn: Math.max(0.3, v) })}
            suffix="in"
            width={62}
          />
          <span className="af-hint-inline">= {(c.printWidthIn * 25.4).toFixed(1)} mm</span>
        </Field>
        <p className="af-note">
          본문 글자 <b>{bodyPt.toFixed(1)} pt</b> 로 인쇄됩니다.
          {bodyPt < 6 ? (
            <span className="af-warn"> — 6 pt 미만은 대부분의 학회에서 판독 불가로 봅니다.</span>
          ) : bodyPt < 7 ? (
            <span className="af-warn"> — 7 pt 이하는 작습니다. 캔버스를 줄이거나 글자를 키우세요.</span>
          ) : bodyPt > 11 ? (
            <span className="af-ok"> — 본문(10 pt)보다 큽니다. 줄여도 됩니다.</span>
          ) : (
            <span className="af-ok"> — 적정 범위입니다.</span>
          )}
        </p>
      </Group>

      <Group title="배경 · 그리드">
        <Field label="배경">
          <Seg
            value={c.bg}
            options={[
              { key: 'transparent', label: '투명' },
              { key: 'white', label: '흰색' },
              { key: 'paper', label: '종이' },
            ]}
            onChange={(bg) => onCanvas({ bg })}
          />
        </Field>
        <Field label="그리드">
          <Chk checked={c.showGrid} onChange={(showGrid) => onCanvas({ showGrid })} label="표시" />
          <Chk checked={c.snap} onChange={(snap) => onCanvas({ snap })} label="스냅" />
        </Field>
        <Field label="간격">
          <Num value={c.grid} min={2} max={64} onChange={(grid) => onCanvas({ grid })} suffix="px" width={52} />
        </Field>
        <Field label="기본 글자">
          <Num
            value={c.baseFont}
            min={4}
            max={72}
            onChange={(baseFont) => onCanvas({ baseFont })}
            suffix="px"
            width={52}
          />
        </Field>
      </Group>

      <Group title="팔레트">
        <div className="af-palettes">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`af-pal${doc.paletteId === p.id ? ' is-on' : ''}`}
              onClick={() => onPalette(p.id)}
            >
              <span className="af-pal__chips">
                {p.colors.slice(0, 6).map((c2) => (
                  <i key={c2} style={{ background: c2 }} />
                ))}
              </span>
              <span className="af-pal__name">{p.label}</span>
              <span className="af-pal__note">{p.note}</span>
            </button>
          ))}
        </div>
      </Group>
    </div>
  )
}

/* ---------- nodes ---------- */

function NodePanel({
  doc,
  nodes,
  swatches,
  onNode,
  onStyle,
  onProps,
}: {
  doc: FigDoc
  nodes: FigNode[]
  swatches: string[]
  onNode: Props['onNode']
  onStyle: Props['onStyle']
  onProps: Props['onProps']
}) {
  const n = nodes[0]
  const s = n.style
  const multi = nodes.length > 1
  const kinds = new Set(nodes.map((x) => x.kind))
  const one = kinds.size === 1 ? n.kind : null
  const fontPt = ptOf(s.fontSize, doc.canvas)

  return (
    <>
      <Group title={multi ? `${nodes.length}개 선택` : '위치 · 크기'}>
        <Field label="X · Y">
          <Num value={n.x} onChange={(x) => onNode(() => ({ x }))} width={58} />
          <Num value={n.y} onChange={(y) => onNode(() => ({ y }))} width={58} />
        </Field>
        <Field label="W · H">
          <Num value={n.w} min={2} onChange={(w) => onNode(() => ({ w }))} width={58} />
          <Num value={n.h} min={2} onChange={(h) => onNode(() => ({ h }))} width={58} />
        </Field>
        <Field label="회전">
          <Num
            value={n.rotation}
            step={5}
            min={-360}
            max={360}
            onChange={(rotation) => onNode(() => ({ rotation }))}
            suffix="°"
            width={58}
          />
        </Field>
      </Group>

      <Group title="스타일">
        <Field label="채움">
          <ColorBtn
            value={s.fill}
            swatches={swatches}
            allowNone
            onChange={(fill) => onStyle({ fill })}
          />
          <span className="af-hint-inline">{s.fill}</span>
        </Field>
        <Field label="선">
          <ColorBtn
            value={s.stroke}
            swatches={swatches}
            allowNone
            onChange={(stroke) => onStyle({ stroke })}
          />
          <Num
            value={s.strokeWidth}
            step={0.2}
            min={0}
            max={20}
            onChange={(strokeWidth) => onStyle({ strokeWidth })}
            width={46}
          />
        </Field>
        <Field label="선 유형">
          <Seg compact value={s.dash} options={DASHES} onChange={(dash) => onStyle({ dash })} />
        </Field>
        <Field label="모서리">
          <Num value={s.radius} min={0} max={80} onChange={(radius) => onStyle({ radius })} width={46} />
          <span className="af-hint-inline">투명도</span>
          <Num
            value={s.opacity}
            step={0.1}
            min={0}
            max={1}
            onChange={(opacity) => onStyle({ opacity })}
            width={46}
          />
        </Field>
      </Group>

      <Group title="라벨">
        <Field label="텍스트" wide>
          <textarea
            className="af-text"
            rows={2}
            value={n.label}
            placeholder="텍스트 · $x^2$ 로 수식"
            onChange={(e) => onNode(() => ({ label: e.target.value }))}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </Field>
        <Field label="위치">
          <Sel value={n.labelPos} options={LABEL_POS} onChange={(labelPos) => onNode(() => ({ labelPos }))} />
        </Field>
        <Field label="글꼴">
          <Sel
            value={s.fontFamily}
            options={(['sans', 'serif', 'mono'] as FontKind[]).map((k) => ({
              key: k,
              label: FONT_LABEL[k],
            }))}
            onChange={(fontFamily) => onStyle({ fontFamily })}
          />
        </Field>
        <Field label="크기">
          <Num
            value={s.fontSize}
            min={2}
            max={200}
            onChange={(fontSize) => onStyle({ fontSize })}
            suffix="px"
            width={52}
          />
          <span className={`af-hint-inline${fontPt < 6 ? ' af-warn' : ''}`}>{fontPt.toFixed(1)} pt</span>
        </Field>
        <Field label="굵기 · 기울임">
          <Seg
            compact
            value={String(s.fontWeight)}
            options={[
              { key: '400', label: 'R' },
              { key: '600', label: 'M' },
              { key: '700', label: 'B' },
            ]}
            onChange={(v) => onStyle({ fontWeight: Number(v) })}
          />
          <Chk checked={s.italic} onChange={(italic) => onStyle({ italic })} label="I" />
        </Field>
        <Field label="정렬 · 색">
          <Seg compact value={s.align} options={ALIGNS} onChange={(align) => onStyle({ align })} />
          <ColorBtn value={s.textColor} swatches={swatches} onChange={(textColor) => onStyle({ textColor })} />
          <Num
            value={s.lineHeight}
            step={0.05}
            min={0.8}
            max={3}
            onChange={(lineHeight) => onStyle({ lineHeight })}
            width={46}
          />
        </Field>
      </Group>

      {one ? (
        <KindPanel kind={one} n={n} swatches={swatches} onProps={onProps} onNode={onNode} />
      ) : null}
    </>
  )
}

/* ---------- per-kind extras ---------- */

function KindPanel({
  kind,
  n,
  swatches,
  onProps,
  onNode,
}: {
  kind: FigNode['kind']
  n: FigNode
  swatches: string[]
  onProps: Props['onProps']
  onNode: Props['onNode']
}) {
  const p = n.props
  switch (kind) {
    case 'cuboid':
      return (
        <Group title="텐서 블록">
          <Field label="깊이">
            <Num value={p.depth ?? 24} min={0} max={200} onChange={(depth) => onProps({ depth })} width={52} />
            <span className="af-hint-inline">각도</span>
            <Num value={p.skew ?? 32} min={5} max={85} onChange={(skew) => onProps({ skew })} suffix="°" width={48} />
          </Field>
          <Field label="윗면 / 옆면">
            <ColorBtn
              value={p.faceTop ?? '#ffffff'}
              swatches={swatches}
              onChange={(faceTop) => onProps({ faceTop })}
            />
            <ColorBtn
              value={p.faceSide ?? '#ffffff'}
              swatches={swatches}
              onChange={(faceSide) => onProps({ faceSide })}
            />
            <button type="button" className="af-mini" onClick={() => onProps({ faceTop: undefined, faceSide: undefined })}>
              자동 음영
            </button>
          </Field>
        </Group>
      )
    case 'stack':
      return (
        <Group title="반복 블록">
          <Field label="장수">
            <Num value={p.count ?? 3} min={1} max={12} onChange={(count) => onProps({ count })} width={48} />
            <span className="af-hint-inline">간격</span>
            <Num value={p.offset ?? 5} min={1} max={40} onChange={(offset) => onProps({ offset })} width={48} />
          </Field>
        </Group>
      )
    case 'mlp':
      return (
        <Group title="MLP">
          <Field label="층 구성" wide>
            {/* 24 is the cap the shape itself clamps to, so the field and the
                drawing agree on what a layer can hold */}
            <NumList
              value={p.layers ?? [4, 5, 3]}
              max={24}
              maxItems={12}
              placeholder="4, 5, 3"
              onChange={(layers) => onProps({ layers })}
            />
          </Field>
          <Field label="뉴런 반지름">
            <Num value={p.neuronR ?? 6} min={1} max={40} onChange={(neuronR) => onProps({ neuronR })} width={48} />
            <Chk
              checked={p.showEdges !== false}
              onChange={(showEdges) => onProps({ showEdges })}
              label="연결선"
            />
          </Field>
        </Group>
      )
    case 'grid':
      return (
        <Group title="격자 · 히트맵">
          <Field label="행 · 열">
            <Num value={p.rows ?? 4} min={1} max={64} onChange={(rows) => onProps({ rows })} width={48} />
            <Num value={p.cols ?? 4} min={1} max={64} onChange={(cols) => onProps({ cols })} width={48} />
            <span className="af-hint-inline">틈</span>
            <Num value={p.gap ?? 1} min={0} max={20} step={0.5} onChange={(gap) => onProps({ gap })} width={44} />
          </Field>
          <Field label="히트맵">
            <button
              type="button"
              className="af-mini"
              onClick={() => {
                const rows = p.rows ?? 4
                const cols = p.cols ?? 4
                // deterministic-looking blocky pattern, editable afterwards
                const heat = Array.from({ length: rows * cols }, (_, i) => {
                  const r = Math.floor(i / cols)
                  const c = i % cols
                  return +(0.5 + 0.5 * Math.sin(r * 1.7 + c * 0.9)).toFixed(2)
                })
                onProps({ heat })
              }}
            >
              샘플 채우기
            </button>
            {p.heat ? (
              <button type="button" className="af-mini" onClick={() => onProps({ heat: undefined })}>
                지우기
              </button>
            ) : null}
            <ColorBtn
              value={p.heatHi ?? n.style.stroke}
              swatches={swatches}
              onChange={(heatHi) => onProps({ heatHi })}
            />
          </Field>
        </Group>
      )
    case 'op':
      return (
        <Group title="연산자">
          <Field label="기호" wide>
            <Sel value={p.symbol ?? '+'} options={OPS} onChange={(symbol) => onProps({ symbol })} />
          </Field>
        </Group>
      )
    case 'curve':
      return (
        <Group title="곡선">
          <Field label="함수" wide>
            <Sel value={p.fn ?? 'relu'} options={FNS} onChange={(fn) => onProps({ fn })} />
          </Field>
        </Group>
      )
    case 'trapezoid':
      return (
        <Group title="사다리꼴">
          <Field label="기울기">
            <Num
              value={p.taper ?? 0.45}
              step={0.05}
              min={0}
              max={0.9}
              onChange={(taper) => onProps({ taper })}
              width={52}
            />
          </Field>
          <Field label="방향">
            <Seg
              compact
              value={p.dir ?? 'right'}
              options={[
                { key: 'right', label: '▶' },
                { key: 'left', label: '◀' },
                { key: 'down', label: '▼' },
                { key: 'up', label: '▲' },
              ]}
              onChange={(dir) => onProps({ dir })}
            />
          </Field>
        </Group>
      )
    case 'brace':
      return (
        <Group title="중괄호">
          <Field label="방향">
            <Seg
              compact
              value={p.dir ?? 'down'}
              options={[
                { key: 'down', label: '⌣' },
                { key: 'up', label: '⌢' },
                { key: 'left', label: '{' },
                { key: 'right', label: '}' },
              ]}
              onChange={(dir) => onProps({ dir })}
            />
          </Field>
        </Group>
      )
    case 'frame':
      return (
        <Group title="프레임">
          <Field label="제목" wide>
            <input
              className="af-input"
              value={p.title ?? ''}
              onChange={(e) => onProps({ title: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </Field>
        </Group>
      )
    case 'image': {
      const nat = p.natW && p.natH ? { w: p.natW, h: p.natH } : null
      const bytes = p.src ? dataUrlBytes(p.src) : 0
      return (
        <Group title="이미지">
          <Field label="파일" wide>
            <label className="af-mini af-file">
              {p.src ? '교체' : '불러오기'}
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  const im = await fileToImage(f)
                  onProps({ src: im.src, natW: im.w, natH: im.h })
                }}
              />
            </label>
            {p.src ? (
              <button
                type="button"
                className="af-mini"
                onClick={() => onProps({ src: undefined, natW: undefined, natH: undefined })}
              >
                비우기
              </button>
            ) : null}
          </Field>
          <Field label="채우기">
            <Seg
              compact
              value={p.fit ?? 'fill'}
              options={[
                { key: 'fill', label: '늘림', title: '박스에 맞춰 늘립니다 (비율 깨짐)' },
                { key: 'contain', label: '맞춤', title: '비율 유지, 남는 곳은 여백' },
                { key: 'cover', label: '채움', title: '비율 유지, 넘치는 부분은 잘림' },
              ]}
              onChange={(fit) => onProps({ fit })}
            />
          </Field>
          {nat ? (
            <>
              <Field label="원본">
                <span className="af-hint-inline">
                  {nat.w} × {nat.h} px · {formatBytes(bytes)}
                </span>
              </Field>
              <Field label="비율">
                <button
                  type="button"
                  className="af-mini"
                  title="지금 너비를 유지한 채 높이를 원본 비율로 맞춥니다"
                  onClick={() => onNode(() => ({ h: Math.max(4, Math.round((n.w * nat.h) / nat.w)) }))}
                >
                  원본 비율로
                </button>
                <button
                  type="button"
                  className="af-mini"
                  title="원본 픽셀 크기로 되돌립니다"
                  onClick={() => onNode(() => ({ w: nat.w, h: nat.h }))}
                >
                  원본 크기
                </button>
              </Field>
            </>
          ) : null}
        </Group>
      )
    }
    default:
      return null
  }
}

/* ---------- edges ---------- */

function EdgePanel({
  doc,
  edges,
  swatches,
  onEdge,
  onEdgeStyle,
}: {
  doc: FigDoc
  edges: FigEdge[]
  swatches: string[]
  onEdge: Props['onEdge']
  onEdgeStyle: Props['onEdgeStyle']
}) {
  const e = edges[0]
  const s = e.style
  return (
    <>
      <Group title={edges.length > 1 ? `연결선 ${edges.length}개` : '연결선'}>
        <Field label="경로">
          <Seg value={e.route} options={ROUTES} onChange={(route) => onEdge(() => ({ route }))} />
        </Field>
        <Field label="붙는 위치">
          <Sel
            value={'node' in e.from ? e.from.anchor : 'auto'}
            options={ANCHORS.map((a) => ({ key: a.key, label: `시작: ${a.label}` }))}
            onChange={(anchor) =>
              onEdge((cur) => ('node' in cur.from ? { from: { ...cur.from, anchor } } : {}))
            }
          />
          <Sel
            value={'node' in e.to ? e.to.anchor : 'auto'}
            options={ANCHORS.map((a) => ({ key: a.key, label: `끝: ${a.label}` }))}
            onChange={(anchor) =>
              onEdge((cur) => ('node' in cur.to ? { to: { ...cur.to, anchor } } : {}))
            }
          />
        </Field>
        {e.route === 'arc' ? (
          <Field label="휨">
            <Num value={e.bow} step={4} min={-300} max={300} onChange={(bow) => onEdge(() => ({ bow }))} width={56} />
          </Field>
        ) : null}
        <Field label="끝 모양">
          <Sel
            value={e.startHead}
            options={HEADS.map((h) => ({ key: h.key as HeadKind, label: `시작: ${h.label}` }))}
            onChange={(startHead) => onEdge(() => ({ startHead }))}
          />
          <Sel
            value={e.endHead}
            options={HEADS.map((h) => ({ key: h.key as HeadKind, label: `끝: ${h.label}` }))}
            onChange={(endHead) => onEdge(() => ({ endHead }))}
          />
        </Field>
        <Field label="선">
          <ColorBtn value={s.stroke} swatches={swatches} onChange={(stroke) => onEdgeStyle({ stroke })} />
          <Num
            value={s.strokeWidth}
            step={0.2}
            min={0.1}
            max={20}
            onChange={(strokeWidth) => onEdgeStyle({ strokeWidth })}
            width={46}
          />
          <Seg compact value={s.dash} options={DASHES} onChange={(dash) => onEdgeStyle({ dash })} />
        </Field>
        {e.waypoints.length ? (
          <Field label="경유점">
            <button type="button" className="af-mini" onClick={() => onEdge(() => ({ waypoints: [] }))}>
              {e.waypoints.length}개 초기화
            </button>
          </Field>
        ) : null}
      </Group>

      <Group title="연결선 라벨">
        <Field label="텍스트" wide>
          <input
            className="af-input"
            value={e.label}
            placeholder="$\\nabla_\\theta \\mathcal{L}$"
            onChange={(ev) => onEdge(() => ({ label: ev.target.value }))}
            onKeyDown={(ev) => ev.stopPropagation()}
          />
        </Field>
        <Field label="위치">
          <Num
            value={e.labelT}
            step={0.05}
            min={0}
            max={1}
            onChange={(labelT) => onEdge(() => ({ labelT }))}
            width={48}
          />
          <span className="af-hint-inline">보정</span>
          <Num value={e.labelDx} onChange={(labelDx) => onEdge(() => ({ labelDx }))} width={44} />
          <Num value={e.labelDy} onChange={(labelDy) => onEdge(() => ({ labelDy }))} width={44} />
        </Field>
        <Field label="글자">
          <Num
            value={s.fontSize}
            min={2}
            max={100}
            onChange={(fontSize) => onEdgeStyle({ fontSize })}
            suffix="px"
            width={50}
          />
          <span className="af-hint-inline">{ptOf(s.fontSize, doc.canvas).toFixed(1)} pt</span>
          <ColorBtn value={s.textColor} swatches={swatches} onChange={(textColor) => onEdgeStyle({ textColor })} />
        </Field>
        <Field label="라벨 배경">
          <ColorBtn
            value={s.labelBg}
            swatches={swatches}
            allowNone
            onChange={(labelBg) => onEdgeStyle({ labelBg })}
          />
        </Field>
      </Group>
    </>
  )
}
