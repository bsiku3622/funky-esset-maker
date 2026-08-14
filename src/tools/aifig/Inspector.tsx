/* Right-hand property panel.
 *
 * Shows the canvas settings when nothing is selected, otherwise the union of
 * the selected nodes' / edges' properties. Multi-select edits apply to every
 * selected item; a field displays the first item's value as the representative. */

import { useMemo, useState } from 'react'
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
  NeuronBits,
  NeuronGroup,
  NodeProps,
  RouteKind,
  Style,
  WireBits,
} from './types'
import {
  CANVAS_PRESETS,
  FONT_LABEL,
  HEADS,
  PALETTES,
  paletteById,
  presetById,
} from './presets'
import { fitNodeToGrid, ptOf } from './layout'
import { retypeLabel } from './latex'
import {
  MLP_GAP,
  MLP_MAX_LAYERS,
  MLP_MAX_UNITS,
  MLP_PITCH,
  MLP_R,
  MLP_SLOT_CAP,
  GROUP_PAD_MAX,
  groupPad,
  isLattice,
  mlpGaps,
  mlpLayers,
  mlpSnapProps,
  parseDotKey,
  retypeLayers,
} from './mlp'
import { nodeMap } from './doc'
import { resolveEdge } from './resolve'
import { dataUrlBytes, fileToImage, formatBytes } from './image'
import { Chk, ColorBtn, Field, Group, Num, NumList, Sel, Seg } from './ui'

/** Sentinel for "no override" in a dropdown whose real values are all strings. */
const INHERIT = '__inherit'

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
  /** the neurons or synapses reached inside a selected network */
  parts: SelParts | null
  /** merge into their overrides; null clears them back to the default */
  onPart: (patch: NeuronBits | WireBits | Partial<NeuronGroup> | null) => void
  /** step back out to the network as a whole */
  onExitPart: () => void
  /** take the selected neurons as one thing a connector can point at */
  onGroup: () => void
  /** undo that, leaving the units where they are */
  onUngroup: () => void
}

export interface SelParts {
  node: FigNode
  /** part keys, all of one kind and all inside `node` */
  keys: string[]
  kind: 'dot' | 'wire' | 'group'
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
  parts,
  onPart,
  onExitPart,
  onGroup,
  onUngroup,
}: Props) {
  const pal = paletteById(doc.paletteId)
  const swatches = useMemo(() => [...pal.colors, pal.neutral], [pal])

  if (!nodes.length && !edges.length)
    return (
      <CanvasPanel doc={doc} onCanvas={onCanvas} onPalette={onPalette} />
    )

  /* ⚠️ A focused part replaces the node panel rather than sitting above it.
   *
   * Reaching inside a network makes one neuron the subject, and every control
   * on screen has to belong to that subject — otherwise the swatch you reach
   * for repaints the whole network, which is both the wrong thing and an
   * expensive mistake to undo once you have hand-coloured a dozen units. The
   * network's own settings are one press of Esc away. */
  if (parts)
    return (
      <div className="af-inspector">
        <PartPanel
          parts={parts}
          swatches={swatches}
          onPart={onPart}
          onExit={onExitPart}
          onGroup={onGroup}
          onUngroup={onUngroup}
        />
      </div>
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
          <Chk
            checked={c.showGrid}
            onChange={(showGrid) => onCanvas({ showGrid })}
            label="점 표시"
          />
          <Chk checked={c.snap} onChange={(snap) => onCanvas({ snap })} label="스냅" />
        </Field>
        <Field label="간격">
          <Num value={c.grid} min={2} max={64} onChange={(grid) => onCanvas({ grid })} suffix="px" width={52} />
        </Field>
        <p className="af-note">
          투명 배경의 체크무늬 한 칸이 이 간격입니다 — 보이는 칸 모서리가 스냅 지점이고, 점은 칸
          가운데 표시입니다. 도형은 반칸 단위로 놓이고 크기는 온칸 단위로 바뀝니다.
        </p>
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
          <button
            type="button"
            className="af-mini"
            title="크기를 격자 칸 수에 맞추고 격자선 위에 올립니다"
            onClick={() => onNode((x) => fitNodeToGrid(x, doc.canvas.grid))}
          >
            격자에 맞추기
          </button>
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
            /* This box is always the raw source, whatever the canvas is
               showing — LaTeX mode edits the formula on the shape itself, and
               this is where you go to see what it is really made of. */
            placeholder={
              s.fontFamily === 'latex' ? '\\sigma(Wx + b) — 원문 그대로' : '텍스트 · $x^2$ 로 수식'
            }
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
            options={(['latex', 'sans', 'serif', 'mono'] as FontKind[]).map((k) => ({
              key: k,
              label: FONT_LABEL[k],
            }))}
            /* One patch, not a style change plus a label change: the source has
               to be rewritten for the new mode, and two commits would make the
               dropdown take two presses of undo to come back from. */
            onChange={(fontFamily) =>
              onNode((n) => ({
                label: retypeLabel(n.label, n.style.fontFamily, fontFamily),
                style: { ...n.style, fontFamily },
              }))
            }
          />
        </Field>
        {s.fontFamily === 'latex' ? (
          <p className="af-note">전체가 수식입니다 — <code>$</code> 없이 바로 쓰세요.</p>
        ) : (
          <p className="af-note">
            글 사이에 수식을 넣으려면 <code>$x^2$</code>, 한 줄로 띄우려면 <code>$$…$$</code>.
          </p>
        )}
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
        <KindPanel
          kind={one}
          n={n}
          canvas={doc.canvas}
          swatches={swatches}
          onProps={onProps}
          onNode={onNode}
        />
      ) : null}
    </>
  )
}

/* ---------- per-kind extras ---------- */

function KindPanel({
  kind,
  n,
  canvas,
  swatches,
  onProps,
  onNode,
}: {
  kind: FigNode['kind']
  n: FigNode
  canvas: CanvasCfg
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
      return <MlpPanel n={n} canvas={canvas} swatches={swatches} onProps={onProps} />

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
    case 'text':
      return (
        <Group title="텍스트">
          <Field label="크기" wide>
            <Chk
              checked={p.autoFit === true}
              onChange={(autoFit) => onProps({ autoFit })}
              label="내용에 맞춤"
            />
          </Field>
          <p className="af-note">
            켜면 상자가 글자를 따라가서 정렬·스냅이 글자 기준으로 맞습니다. 핸들로 크기를 바꾸면
            자동으로 꺼집니다.
          </p>
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
          <Field label="제목 배경">
            <ColorBtn
              value={p.titleBg ?? 'none'}
              swatches={swatches}
              allowNone
              onChange={(titleBg) => onProps({ titleBg })}
            />
            <span className="af-hint-inline">겹칠 때만</span>
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

/* ---------- parts of an MLP ---------- */

/* A neuron is a circle with text in it, so it gets what a circle gets. The
 * earlier version of this panel offered four fields and nothing else, on the
 * theory that a part should be simpler than a shape — which is backwards. The
 * lattice owns where a unit is and how big it is, because that is what keeps
 * the drawing on the grid; everything about how it *looks* is the user's, and
 * withholding it just means the figure cannot be drawn.
 *
 * Every field is an override. Absent follows the network, and "기본값으로"
 * deletes the entry rather than writing the current value into it — otherwise
 * recolouring the network would leave every hand-touched unit on the old
 * palette. Edits apply to all selected parts at once. */
function PartPanel({
  parts,
  swatches,
  onPart,
  onExit,
  onGroup,
  onUngroup,
}: {
  parts: SelParts
  swatches: string[]
  onPart: Props['onPart']
  onExit: () => void
  onGroup: () => void
  onUngroup: () => void
}) {
  const p = parts.node.props
  const s = parts.node.style
  const many = parts.keys.length > 1
  const first = parts.keys[0]
  const where = parseDotKey(first)

  const back = (
    <Field label="대상">
      <span className="af-hint-inline">
        {many
          ? `${parts.keys.length}개`
          : parts.kind === 'wire'
            ? '연결선 하나'
            : where
              ? `${where.li + 1}층 ${where.n + 1}번`
              : '뉴런 하나'}
      </span>
      <button type="button" className="af-mini" onClick={onExit}>
        네트워크 전체로 (Esc)
      </button>
    </Field>
  )
  const reset = (
    <button type="button" className="af-mini" onClick={() => onPart(null)}>
      기본값으로
    </button>
  )

  if (parts.kind === 'group') {
    const g = p.groups?.[first]
    const pad = groupPad(g)
    /* One number for all four sides. The grips do them separately — this is
       for saying "give it eight all round" without four drags. */
    const even = pad.every((v) => v === pad[0])
    return (
      <Group title={many ? `그룹 ${parts.keys.length}개` : '뉴런 그룹'}>
        {back}
        <Field label="이름" wide>
          <input
            className="af-input"
            value={g?.label ?? ''}
            placeholder="입력층"
            onChange={(e) => onPart({ label: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </Field>
        <Field label="이름 색 · 크기">
          <ColorBtn
            value={g?.textColor ?? (s.textColor === 'none' ? s.stroke : s.textColor)}
            swatches={swatches}
            onChange={(textColor) => onPart({ textColor })}
          />
          <Num
            value={g?.fontSize ?? s.fontSize}
            min={2}
            max={200}
            onChange={(fontSize) => onPart({ fontSize })}
            suffix="px"
            width={56}
          />
        </Field>
        <Field label="채우기 · 테두리">
          <ColorBtn
            value={g?.fill ?? 'none'}
            swatches={swatches}
            allowNone
            onChange={(fill) => onPart({ fill })}
          />
          <ColorBtn
            value={g?.stroke ?? s.stroke}
            swatches={swatches}
            onChange={(stroke) => onPart({ stroke })}
          />
        </Field>
        <Field label="여백">
          <Num
            value={pad[0]}
            min={0}
            max={GROUP_PAD_MAX}
            onChange={(v) => onPart({ pad: [v, v, v, v] })}
            suffix="px"
            width={62}
          />
          <span className="af-hint-inline">{even ? '네 면 같음' : `${pad.join(' / ')}`}</span>
        </Field>
        <Field label="표시">
          <Chk checked={!g?.bare} onChange={(on) => onPart({ bare: !on })} label="상자 그리기" />
          <button type="button" className="af-mini" onClick={onUngroup}>
            그룹 해제
          </button>
        </Field>
        <p className="af-note">
          {g ? `뉴런 ${g.parts.length}개` : ''} — 연결선을 그룹에 붙이면 네 개를 따로 잇지 않고
          하나로 말할 수 있습니다. 테두리를 클릭해서 고르고, 모서리 핸들로 면마다 여백을
          조절하세요.
        </p>
      </Group>
    )
  }

  if (parts.kind === 'wire') {
    const w: WireBits = p.wires?.[first] ?? {}
    return (
      <Group title={many ? `연결선 ${parts.keys.length}개` : '연결선 하나'}>
        {back}
        <Field label="색 · 굵기">
          <ColorBtn
            value={w.stroke ?? s.stroke}
            swatches={swatches}
            onChange={(stroke) => onPart({ stroke })}
          />
          <Num
            value={w.strokeWidth ?? +Math.max(0.35, s.strokeWidth * 0.42).toFixed(2)}
            step={0.1}
            min={0.1}
            max={20}
            onChange={(strokeWidth) => onPart({ strokeWidth })}
            suffix="px"
            width={58}
          />
        </Field>
        <Field label="선 모양">
          <Sel value={w.dash ?? 'solid'} options={DASHES} onChange={(dash) => onPart({ dash })} />
          <Num
            value={w.opacity ?? 0.55}
            step={0.05}
            min={0}
            max={1}
            onChange={(opacity) => onPart({ opacity })}
            width={46}
          />
        </Field>
        <Field label="표시">
          <Chk checked={!w.hidden} onChange={(on) => onPart({ hidden: !on })} label="그리기" />
          {reset}
        </Field>
        <p className="af-note">
          층 크기를 바꿔도 같은 두 뉴런을 따라갑니다. Shift로 여러 개 고를 수 있습니다.
        </p>
      </Group>
    )
  }

  const b: NeuronBits = p.neurons?.[first] ?? {}
  const mode = b.fontFamily ?? s.fontFamily
  return (
    <Group title={many ? `뉴런 ${parts.keys.length}개` : '뉴런 하나'}>
      {back}
      <Field label="텍스트" wide>
        <input
          className="af-input"
          value={b.label ?? ''}
          placeholder={mode === 'latex' ? 'x_1' : '$x_1$'}
          onChange={(e) => onPart({ label: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </Field>
      <Field label="글꼴">
        <Sel
          value={b.fontFamily ?? INHERIT}
          options={[
            { key: INHERIT, label: `네트워크를 따름 (${FONT_LABEL[s.fontFamily]})` },
            ...(['latex', 'sans', 'serif', 'mono'] as FontKind[]).map((k) => ({
              key: k,
              label: FONT_LABEL[k],
            })),
          ]}
          onChange={(v) => {
            const next = v === INHERIT ? undefined : (v as FontKind)
            // the source has to be rewritten for the new mode, same as a node's
            onPart({ fontFamily: next, label: retypeLabel(b.label ?? '', mode, next ?? s.fontFamily) })
          }}
        />
      </Field>
      <Field label="글자 크기">
        <Num
          value={b.fontSize ?? s.fontSize}
          min={2}
          max={200}
          onChange={(fontSize) => onPart({ fontSize })}
          suffix="px"
          width={56}
        />
        <Num
          value={b.fontWeight ?? s.fontWeight}
          min={100}
          max={900}
          step={100}
          onChange={(fontWeight) => onPart({ fontWeight })}
          width={56}
        />
        <Chk
          checked={b.italic ?? s.italic}
          onChange={(italic) => onPart({ italic })}
          label="기울임"
        />
      </Field>
      <Field label="글자색">
        <ColorBtn
          value={b.textColor ?? (s.textColor === 'none' ? '#222222' : s.textColor)}
          swatches={swatches}
          onChange={(textColor) => onPart({ textColor })}
        />
      </Field>
      {/* The same nudge a connector's label carries, for the same reason: a
          name too long for its circle has to be able to sit beside it. */}
      <Field label="글자 위치">
        <Num
          value={b.dx ?? 0}
          onChange={(dx) => onPart({ dx })}
          suffix="X"
          width={54}
        />
        <Num
          value={b.dy ?? 0}
          onChange={(dy) => onPart({ dy })}
          suffix="Y"
          width={54}
        />
        <button type="button" className="af-mini" onClick={() => onPart({ dx: 0, dy: 0 })}>
          가운데로
        </button>
      </Field>
      <Field label="채우기 · 테두리">
        <ColorBtn value={b.fill ?? s.fill} swatches={swatches} onChange={(fill) => onPart({ fill })} />
        <ColorBtn
          value={b.stroke ?? s.stroke}
          swatches={swatches}
          onChange={(stroke) => onPart({ stroke })}
        />
        <Num
          value={b.strokeWidth ?? s.strokeWidth}
          step={0.1}
          min={0}
          max={20}
          onChange={(strokeWidth) => onPart({ strokeWidth })}
          suffix="px"
          width={56}
        />
      </Field>
      <Field label="선 모양 · 투명도">
        <Sel value={b.dash ?? 'solid'} options={DASHES} onChange={(dash) => onPart({ dash })} />
        <Num
          value={b.opacity ?? 1}
          step={0.05}
          min={0}
          max={1}
          onChange={(opacity) => onPart({ opacity })}
          width={46}
        />
        {reset}
      </Field>
      {many ? (
        <Field label="묶기">
          <button type="button" className="af-mini" onClick={onGroup}>
            그룹으로 묶기
          </button>
          <span className="af-hint-inline">연결선을 한 번에 받습니다</span>
        </Field>
      ) : null}
      <p className="af-note">
        원을 더블클릭하면 그 자리에서 바로 쓸 수 있습니다 — Tab으로 다음 뉴런, Esc로 나가기.
        Shift로 여러 개를 고르면 한꺼번에 바뀝니다.
      </p>
    </Group>
  )
}

/* ---------- MLP ---------- */

/* The network panel.
 *
 * Two things here are not ordinary number fields. "등간격" is the switch between
 * the two placement modes in mlp.ts, so turning it on has to *supply* a pitch
 * and a gap rather than just set a flag — and it seeds them from what the node
 * looks like now, so the drawing does not jump when you flip it. And every
 * spacing value goes through mlpSnapProps while canvas snapping is on, which is
 * the whole of "circles land on the grid": get these three numbers onto the
 * right multiples and the lattice does the rest. */
function MlpPanel({
  n,
  canvas,
  swatches,
  onProps,
}: {
  n: FigNode
  canvas: CanvasCfg
  swatches: string[]
  onProps: Props['onProps']
}) {
  const p = n.props
  const lattice = isLattice(p)
  const layers = mlpLayers(p)
  const r = p.neuronR ?? MLP_R
  const pitch = p.pitch ?? MLP_PITCH
  const gap = p.layerGap ?? MLP_GAP
  /* ⚠️ Whether the gaps are *stored* per layer, not whether they happen to be
     equal. Turning the switch on seeds every gap with the even one so nothing
     jumps — and if that were read back as "still even", the switch would flip
     itself off the instant it was used. */
  const perGap = !!p.gaps?.length

  /** Spacing edits go on the grid when the canvas is snapping. */
  const put = (patch: Partial<NodeProps>) =>
    onProps(canvas.snap ? { ...patch, ...mlpSnapProps({ ...p, ...patch }, canvas.grid) } : patch)

  const caps = (which: 'capTop' | 'capBottom', li: number, v: string) => {
    const list = [...(p[which] ?? [])]
    while (list.length < layers.length) list.push('')
    list[li] = v
    onProps({ [which]: list.some(Boolean) ? list : undefined })
  }

  return (
    <>
      <Group title="MLP">
        <Field label="층 구성" wide>
          {/* A layer may stand for far more units than it draws — the ellipsis
              below decides how many circles that becomes. */}
          {/* Not a plain set: adding or removing a layer renumbers the ones
              after it, and every per-part override is filed by layer number. */}
          <NumList
            value={layers}
            max={MLP_MAX_UNITS}
            maxItems={MLP_MAX_LAYERS}
            placeholder="4, 5, 3"
            onChange={(v) => onProps(retypeLayers(p, v) as Record<string, unknown>)}
          />
        </Field>
        <Field label="배치">
          <Chk
            checked={lattice}
            onChange={(on) =>
              put(
                on
                  ? {
                      // seed from the current drawing so nothing jumps
                      pitch: Math.max(2 * r, Math.round((n.h - 2 * r) / Math.max(1, Math.max(...layers) - 1))),
                      layerGap: Math.max(2 * r, Math.round((n.w - 2 * r) / Math.max(1, layers.length - 1))),
                    }
                  : { pitch: undefined, layerGap: undefined },
              )
            }
            /* ⚠️ Called "등간격" until the gaps could differ, at which point the
               name was a lie and it read as the opposite of the switch below
               it. What it actually decides is which way round the box and the
               spacing depend on each other. */
            label="격자 배치"
          />
          <span className="af-hint-inline">
            {lattice ? '간격이 상자를 정합니다' : '상자에 맞춰 늘립니다'}
          </span>
        </Field>
        {lattice ? (
          <>
            <Field label="간격">
              <Num value={pitch} min={2} max={200} onChange={(v) => put({ pitch: v })} suffix="세로" width={62} />
              <Num
                value={gap}
                min={2}
                max={400}
                onChange={(v) => put({ layerGap: v, gaps: undefined })}
                suffix="가로"
                width={62}
                disabled={perGap}
              />
            </Field>
            {/* One width per gap, so a layer can stand off from its neighbour
                without disturbing the rhythm of the rest — an input column set
                apart from the hidden ones is the usual reason. Turning it on
                seeds every gap with the even one, so nothing jumps. */}
            {layers.length > 2 ? (
              <Field label="가로 간격">
                <Chk
                  checked={perGap}
                  onChange={(on) => put({ gaps: on ? mlpGaps(p) : undefined })}
                  label="칸마다 따로"
                />
                <span className="af-hint-inline">
                  {perGap ? '아래에서 칸별로' : '전부 한 값으로'}
                </span>
              </Field>
            ) : null}
            {perGap ? (
              <Field label="칸 간격" wide>
                {mlpGaps(p).map((v, i) => (
                  <Num
                    key={i}
                    value={v}
                    min={2}
                    max={400}
                    onChange={(next) => {
                      const list = mlpGaps(p)
                      list[i] = next
                      put({ gaps: list })
                    }}
                    suffix={`${i + 1}–${i + 2}`}
                    width={58}
                  />
                ))}
              </Field>
            ) : null}
          </>
        ) : null}
        <Field label="뉴런 반지름">
          <Num value={r} min={1} max={40} onChange={(v) => put({ neuronR: v })} width={48} />
          <Chk
            checked={p.showEdges !== false}
            onChange={(showEdges) => onProps({ showEdges })}
            label="연결선"
          />
        </Field>
        {/* The synapses have their own ink: a network usually wants dark
            circles and pale wires, which one colour cannot express. */}
        <Field label="연결선 색">
          <ColorBtn
            value={p.wireStroke ?? n.style.stroke}
            swatches={swatches}
            onChange={(wireStroke) => onProps({ wireStroke })}
          />
          <Num
            value={p.wireWidth ?? +Math.max(0.35, n.style.strokeWidth * 0.42).toFixed(2)}
            step={0.1}
            min={0.1}
            max={20}
            onChange={(wireWidth) => onProps({ wireWidth })}
            suffix="px"
            width={58}
          />
          <Num
            value={p.wireOpacity ?? 0.55}
            step={0.05}
            min={0}
            max={1}
            onChange={(wireOpacity) => onProps({ wireOpacity })}
            width={46}
          />
        </Field>
        <Field label="생략">
          <Num
            value={p.maxDots ?? MLP_SLOT_CAP}
            min={2}
            max={MLP_SLOT_CAP}
            onChange={(maxDots) => onProps({ maxDots })}
            suffix="개까지"
            width={70}
          />
          <span className="af-hint-inline">넘으면 ⋮ 로</span>
        </Field>
        {lattice ? (
          <p className="af-note">
            상자 크기는 격자에서 나옵니다 — 핸들로 끌면 간격이 바뀝니다.
          </p>
        ) : null}
      </Group>

      <Group title="층 라벨">
        <Field label="글자색">
          <ColorBtn
            value={p.capColor ?? (n.style.textColor === 'none' ? n.style.stroke : n.style.textColor)}
            swatches={swatches}
            onChange={(capColor) => onProps({ capColor })}
          />
          <span className="af-hint-inline">위·아래 라벨 공통</span>
        </Field>
        {layers.map((count, li) => (
          <Field key={li} label={`${li + 1}층 (${count})`} wide>
            <input
              className="af-input"
              value={p.capTop?.[li] ?? ''}
              placeholder="위"
              onChange={(e) => caps('capTop', li, e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <input
              className="af-input"
              value={p.capBottom?.[li] ?? ''}
              placeholder="아래"
              onChange={(e) => caps('capBottom', li, e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </Field>
        ))}
        <p className="af-note">
          층 라벨은 글로 읽습니다 — <code>no bias</code>는 띄어쓰기 그대로 나오고, 수식은{' '}
          <code>$\sigma$</code>처럼 감싸세요.
        </p>
      </Group>
    </>
  )
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
  /* The label's position is stored as a fraction so it keeps its place when the
     line changes length, but a fraction is a poor thing to type: 0.01 of a long
     connector is ten pixels, so nudging it lurched. Offer the same value in
     whichever unit suits — px to place it exactly, % to think proportionally. */
  const [unit, setUnit] = useState<'px' | 'pct'>('px')
  const len = useMemo(() => resolveEdge(e, nodeMap(doc))?.info.len ?? 0, [e, doc])
  const along = unit === 'px' ? Math.round(e.labelT * len) : Math.round(e.labelT * 1000) / 10
  const setAlong = (v: number) => {
    const t = unit === 'px' ? (len > 0 ? v / len : 0) : v / 100
    onEdge(() => ({ labelT: +Math.min(1, Math.max(0, t)).toFixed(4) }))
  }
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
            {/* Named for what it does, not for what it counts: "4개 초기화"
                reads as a number you can set. This is the way back from a
                route that has been dragged into knots. */}
            <button type="button" className="af-mini" onClick={() => onEdge(() => ({ waypoints: [] }))}>
              곧게 펴기 ({e.waypoints.length}개)
            </button>
          </Field>
        ) : null}
      </Group>

      <Group title="연결선 라벨">
        <Field label="텍스트" wide>
          <input
            className="af-input"
            value={e.label}
            placeholder={
              s.fontFamily === 'latex'
                ? '\\nabla_\\theta \\mathcal{L}'
                : '텍스트 · $\\nabla_\\theta \\mathcal{L}$ 로 수식'
            }
            onChange={(ev) => onEdge(() => ({ label: ev.target.value }))}
            onKeyDown={(ev) => ev.stopPropagation()}
          />
        </Field>
        <Field label="글꼴">
          <Sel
            value={s.fontFamily}
            options={(['latex', 'sans', 'serif', 'mono'] as FontKind[]).map((k) => ({
              key: k,
              label: FONT_LABEL[k],
            }))}
            onChange={(fontFamily) =>
              onEdge((ed) => ({
                label: retypeLabel(ed.label, ed.style.fontFamily, fontFamily),
                style: { ...ed.style, fontFamily },
              }))
            }
          />
        </Field>
        {/* Three separate things — where along the line, how far off it, and
            which side of that point the text sits — used to share one row and
            wrapped into a mess. One row each, each labelled. */}
        <Field label="선 위 위치">
          <Num
            value={along}
            step={unit === 'px' ? 1 : 0.5}
            min={0}
            max={unit === 'px' ? Math.max(1, Math.round(len)) : 100}
            onChange={setAlong}
            width={60}
          />
          <Seg
            compact
            value={unit}
            options={[
              { key: 'px', label: 'px', title: '선을 따라 잰 거리' },
              { key: 'pct', label: '%', title: '선 길이에 대한 비율' },
            ]}
            onChange={setUnit}
          />
          <span className="af-hint-inline">전체 {Math.round(len)} px · 라벨을 끌어도 됩니다</span>
        </Field>
        <Field label="X 오프셋">
          <Num value={e.labelDx} onChange={(labelDx) => onEdge(() => ({ labelDx }))} suffix="px" width={56} />
        </Field>
        <Field label="Y 오프셋">
          <Num value={e.labelDy} onChange={(labelDy) => onEdge(() => ({ labelDy }))} suffix="px" width={56} />
        </Field>
        <Field label="정렬">
          <Seg
            compact
            value={s.align ?? 'center'}
            options={ALIGNS}
            onChange={(align) => onEdgeStyle({ align })}
          />
          <span className="af-hint-inline">기준점 대비</span>
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
