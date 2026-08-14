/* AI Figure Maker — a drawing surface for the architecture diagrams that go in
 * ML papers: layer blocks, 3D tensors, MLP fans, attention grids, LaTeX labels
 * and the connectors between them, on a canvas sized to a real column width.
 *
 * Design notes that matter when editing this file:
 *  - The figure renders as plain SVG. The exporter serialises the very same
 *    <g> element, so the vector file is exactly what the screen shows.
 *  - Editor chrome (handles, guides, hit targets) lives in sibling groups that
 *    the exporter never sees, which is why the figure group has no pointer
 *    events of its own — clicks are resolved against an explicit hit layer.
 *  - Undo/redo snapshots the whole document. It is a plain object, so this is
 *    cheap and never misses a field. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { useLatest } from './hooks'
import { UndoArrow } from './UndoRedo'
import './AiFigureMaker.css'

import type {
  CanvasCfg,
  FigDoc,
  FigEdge,
  FigNode,
  NeuronBits,
  NeuronGroup,
  NodeKind,
  Pt,
  Rect,
  Style,
  View,
  Waypoint,
  WireBits,
} from './aifig/types'
import { SHAPES, makeNode, paletteById, readableOn, shapeSpec, tint } from './aifig/presets'
import {
  addNodeAt,
  align as alignNodes,
  applyPalette,
  connect as connectNodes,
  contentBounds,
  distribute,
  duplicate,
  equalize,
  expandGroups,
  fullyConnect,
  group as groupNodes,
  loadDoc,
  nodeMap,
  patchEdgeStyle,
  patchEdges,
  patchMlpPart,
  patchNodeStyle,
  patchNodes,
  removeItems,
  reorder,
  saveDoc,
  selectionBounds,
  ungroup,
  type AlignMode,
  type ZMode,
} from './aifig/doc'
import {
  atLength,
  alignmentsBetween,
  distToPath,
  hitsByOutline,
  measureBetween,
  measureToFrame,
  nearestT,
  nodeBounds,
  spacingSnap,
  snapPos,
  snapSize,
  pointOnNode,
  rectCenter,
  rectsOverlap,
  rotateDir,
  rotatePt,
  snapGuides,
  snapSides,
  unionRect,
  type Gap,
  type Guide,
  type MovedSides,
  type Sticky,
} from './aifig/geometry'
import { NodeView } from './aifig/shapes'
import {
  edgeLabelBox,
  fitNodeToGrid,
  inkRect,
  labelFont,
  labelStyle,
  mlpCapStyle,
  neuronLabelStyle,
  placeLabel,
  ptOf,
  refitMlp,
  refitText,
  shapeOverflow,
} from './aifig/layout'
import { EdgeView } from './aifig/edges'
import { resolveEdge, type ResolvedEdge } from './aifig/resolve'
import {
  MLP_GAP,
  MLP_PITCH,
  MLP_R,
  freshGroupKey,
  isLattice,
  mlpDot,
  mlpPartAnchors,
  mlpDotAt,
  mlpGaps,
  mlpGroupAt,
  mlpGroupLabelAt,
  mlpHit,
  mlpPartCentre,
  mlpPartRect,
  mlpLattice,
  mlpLayers,
  mlpNaturalSize,
  mlpSlots,
  mlpSnapProps,
  mlpToLocal,
  mlpWireAt,
  groupPad,
  GROUP_CAP_GAP,
  GROUP_PAD_MAX,
  isGroupKey,
  parseDotKey,
} from './aifig/mlp'
import { ensureMathJax, layoutLabel, onMathReady } from './aifig/latex'
import { TEMPLATES } from './aifig/templates'
import { fileToImage, fitBox, imagesFromDrop, imagesFromPaste } from './aifig/image'
import {
  DEFAULT_EXPORT,
  buildSvg,
  download,
  svgToPng,
  textBlob,
  toTikz,
} from './aifig/export'
import Inspector from './aifig/Inspector'
import LabelEditor from './aifig/LabelEditor'
import Overlay, { type PartMark } from './aifig/Overlay'
import {
  ANCHOR_OUT,
  HANDLES,
  HANDLE_UV,
  HOVER_TOL,
  onAnchorDot,
  type HandleKey,
} from './aifig/handles'
import { IconBtn, Num, Seg } from './aifig/ui'

/* ---------- drag state ---------- */

/** One neuron or synapse inside a network node, by the keys mlp.ts mints. */
type PartRef = { node: string; key: string; kind: 'dot' | 'wire' | 'group' }

type Drag =
  | {
      t: 'move'
      ids: string[]
      start: Pt
      orig: Map<string, Pt>
      box: Rect
      moved: boolean
      /** which alignment each axis locked onto, so it stays locked */
      sticky: Sticky
      /* The neuron or synapse this press landed on, if it landed on one. It is
       * only acted on if the press never becomes a drag — see the pointer-up
       * handler. Deciding on the way down instead would make a selected network
       * nearly impossible to move, because its synapses cross most of its box. */
      part?: PartRef
    }
  | {
      t: 'resize'
      id: string
      kind: NodeKind
      handle: HandleKey
      orig: Rect
      rotation: number
      start: Pt
      moved: boolean
    }
  | { t: 'rotate'; id: string; center: Pt; startAngle: number; origRot: number; moved: boolean }
  /* Sliding one layer of a network sideways.
   *
   * The columns are placed by a running total of the gaps, so moving a layer is
   * moving the two gaps it sits between — wider on one side, narrower on the
   * other, and every other column stays where it was. Grabbing a circle and
   * pulling is how you say that; typing two numbers that have to add up is not. */
  | {
      t: 'layer'
      id: string
      /** which column, and where the press landed — in *canvas* coordinates */
      li: number
      start: Pt
      /** the gaps as they were, so the drag stays absolute rather than cumulative */
      gaps: number[]
      x: number
      moved: boolean
    }
  /** widening one side of a neuron group's outline — see `NeuronGroup.pad` */
  | {
      t: 'gpad'
      id: string
      key: string
      handle: HandleKey
      /** where the press landed, in the network's own frame */
      start: Pt
      orig: [number, number, number, number]
      moved: boolean
    }
  | { t: 'marquee'; start: Pt; add: boolean }
  | { t: 'pan'; sx: number; sy: number; ox: number; oy: number }
  /** `part` is set when the wire is being pulled out of one neuron */
  | { t: 'connect'; node: string; anchor: string; from: Pt; part?: string }
  | { t: 'endpoint'; edge: string; which: 'from' | 'to' }
  | { t: 'waypoint'; edge: string; index: number; moved: boolean }
  /** sliding a connector's label along its own path; `base` is where on the
   *  path the label sat when it was grabbed, so the offset rides along */
  | { t: 'label'; edge: string; start: Pt; base: Pt; moved: boolean }
  /** pushing one straight run of an orthogonal route sideways */
  | {
      t: 'segment'
      edge: string
      /** which run of the corner polyline, by its starting corner */
      index: number
      /** the run is vertical, so it moves in x — and the other way round */
      axis: 'x' | 'y'
      corners: Pt[]
      start: Pt
      moved: boolean
    }
  | null

/** How close an edge has to come, on screen, before a guide claims it. */
const SNAP_PX = 5

/* How near a network's ink still counts as pressing it, in *screen* px.
 *
 * ⚠️ Screen, not world. A group's outline is one line however far out the
 * canvas is zoomed, so a tolerance measured in world units shrinks to nothing
 * at 50% — the box you can plainly see becomes a two-pixel target — and swells
 * into a fat halo at 400%. Divide by the zoom at the call site. */
const PART_TOL = 7

/** How far the pointer must travel, on screen, before a press counts as a drag. */
const DEAD_ZONE = 3

/* Which column a part belongs to. A group is filed by its members, and one that
 * straddles two layers has no single column to move — those are left alone. */
function layerOfPart(n: FigNode, key: string): number | null {
  if (!isGroupKey(key)) return parseDotKey(key)?.li ?? null
  const held = n.props.groups?.[key]?.parts ?? []
  const lis = new Set(held.map((k) => parseDotKey(k)?.li).filter((v) => v !== undefined))
  return lis.size === 1 ? [...lis][0]! : null
}

/* The page as something to line up with. It is drawn, so it plays by the same
 * rule as any other drawn thing: its edges and its centre are alignment
 * targets. It is not a *shape*, though — it has no place in a row's rhythm, so
 * equal-spacing never sees it. */
const frameRect = (c: { w: number; h: number }): Rect => ({ x: 0, y: 0, w: c.w, h: c.h })

/** Bring the nodes whose box is a result back into line with what they draw. */
const normalise = (d: FigDoc) => refitMlp(refitText(d))

/* Is the pointer on this node?
 *
 * ⚠️ A network answers for its ink, not for its box. Its rectangle is mostly
 * empty — the space between two columns is wide enough to park a whole block in
 * — and while that rectangle was the target, anything drawn underneath it there
 * could not be reached at all: every press inside the network's bounds was
 * claimed by the network. `mlpHit` walks the circles, wires, group boxes and
 * captions instead, so the gaps fall through to whatever is behind them, the
 * same way the hollow middle of an unfilled shape does. */
const onShape = (p: Pt, n: FigNode, pad = 0) =>
  n.kind === 'mlp' ? mlpHit(n, p, pad) : pointOnNode(p, n, pad)

/* Tie a bend to the end of the connector it belongs to, and store it as an
 * offset from that node's centre.
 *
 * ⚠️ Bends used to be absolute canvas coordinates, so moving a block left its
 * connectors' corners behind and the figure tangled — a line is a relationship
 * between two shapes, and nothing about it should be pinned to the page. The
 * nearer end wins, which is what makes a lane running alongside a block travel
 * with that block while the far end re-routes. A bend on a free-floating
 * endpoint stays absolute; there is no shape to belong to. */
function tieToEnd(e: FigEdge, p: Pt, doc: FigDoc, force?: 'from' | 'to'): Waypoint {
  const mid = (ep: FigEdge['from']) => {
    if ('free' in ep) return null
    const n = doc.nodes.find((x) => x.id === ep.node)
    return n ? { x: n.x + n.w / 2, y: n.y + n.h / 2 } : null
  }
  const a = mid(e.from)
  const b = mid(e.to)
  const da = a ? Math.hypot(p.x - a.x, p.y - a.y) : Infinity
  const db = b ? Math.hypot(p.x - b.x, p.y - b.y) : Infinity
  const pick = force ?? (da <= db ? 'from' : 'to')
  const base = pick === 'from' ? a : b
  if (!base) return { x: Math.round(p.x), y: Math.round(p.y) }
  return { x: Math.round(p.x - base.x), y: Math.round(p.y - base.y), rel: pick }
}

/* Which straight run of an orthogonal route the pointer is on, if it is on one
 * that can move. The first and last runs are the stubs leaving the shapes: they
 * are pinned to their anchors, and a run too short to see is not something
 * anyone meant to grab. */
function nearestRun(
  corners: Pt[],
  p: Pt,
): { index: number; axis: 'x' | 'y' } | null {
  let best: { index: number; axis: 'x' | 'y'; d: number } | null = null
  for (let i = 1; i < corners.length - 2; i++) {
    const a = corners[i]
    const b = corners[i + 1]
    const vertical = Math.abs(a.x - b.x) < 0.5
    const len = vertical ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x)
    if (len < 16) continue
    const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x)
    const hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x)
    const along = vertical ? p.y : p.x
    if (along < lo - 4 || along > hi + 4) continue
    const d = Math.abs((vertical ? p.x - a.x : p.y - a.y))
    if (!best || d < best.d) best = { index: i, axis: vertical ? 'x' : 'y', d }
  }
  return best && best.d <= 12 ? { index: best.index, axis: best.axis } : null
}

const ZOOM_MIN = 0.15
const ZOOM_MAX = 6
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

function starterDoc(): FigDoc {
  const paletteId = 'muted'
  const pal = paletteById(paletteId)
  const tpl = TEMPLATES.find((t) => t.id === 'deeponet')!
  const bag = tpl.build(pal, 13)
  const doc: FigDoc = {
    nodes: bag.nodes,
    edges: bag.edges,
    canvas: {
      w: 528,
      h: 327,
      bg: 'transparent',
      printWidthIn: 5.5,
      presetId: 'neurips-col',
      showGrid: true,
      grid: 8,
      snap: true,
      baseFont: 13,
    },
    paletteId,
  }
  // centre the template on the canvas
  const b = contentBounds(doc)
  if (b) {
    const dx = Math.round((doc.canvas.w - b.w) / 2 - b.x)
    const dy = Math.round((doc.canvas.h - b.h) / 2 - b.y)
    doc.nodes = doc.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }))
    doc.edges = doc.edges.map((e) => ({
      ...e,
      waypoints: e.waypoints.map((p) => (p.rel ? { ...p } : { x: p.x + dx, y: p.y + dy })),
    }))
  }
  return doc
}

/** below this width the two side panels start folded — the canvas needs the
 *  room more than the rails do */
const AF_WIDE = 1280

/* Nodes on the system clipboard.
 *
 * text/plain is the one format that survives every browser and the OS
 * clipboard intact, so the payload is tagged JSON rather than a custom MIME
 * type. The tag is what stops an ordinary paste of unrelated text from being
 * read as a figure. */
const CLIP_TAG = 'funky-esset-maker/aifig-nodes'

const encodeClip = (c: { nodes: FigNode[]; edges: FigEdge[] }) =>
  JSON.stringify({ tag: CLIP_TAG, nodes: c.nodes, edges: c.edges })

function decodeClip(text: string): { nodes: FigNode[]; edges: FigEdge[] } | null {
  // cheap reject before parsing: most pastes are not ours and can be long
  if (!text.includes(CLIP_TAG)) return null
  try {
    const v = JSON.parse(text) as { tag?: string; nodes?: FigNode[]; edges?: FigEdge[] }
    if (v?.tag !== CLIP_TAG || !Array.isArray(v.nodes) || !v.nodes.length) return null
    return { nodes: v.nodes, edges: Array.isArray(v.edges) ? v.edges : [] }
  } catch {
    return null
  }
}

export default function AiFigureMaker() {
  const [doc, setDocState] = useState<FigDoc>(() => loadDoc() ?? starterDoc())
  const [selNodes, setSelNodes] = useState<string[]>([])
  const [selEdges, setSelEdges] = useState<string[]>([])
  const [view, setView] = useState<View>({ x: 60, y: 48, zoom: 1 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const hoverRef = useRef<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [gaps, setGaps] = useState<Gap[]>([])
  /** Alt held: report the distance to whatever the pointer is over */
  const [measuring, setMeasuring] = useState(false)
  /* Alt on its own reads as a question about the *page*, so the measurement
     needs to know the pointer is actually here — otherwise reaching for Alt
     while in a panel field would throw margins across the canvas. */
  const [overCanvas, setOverCanvas] = useState(false)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [temp, setTemp] = useState<{ a: Pt; b: Pt; target: string | null } | null>(null)
  const [dragging, setDragging] = useState(false)
  /* Connector mode. Dragging out of a node's anchor dot was the only way to
     make an edge, which is a 8px target that only exists while the node is
     hovered — findable once you know, unusable if you don't. This is the
     click-source-then-click-target alternative; the source stays armed so a
     fan-out (one node to a whole column) is one click per edge. */
  const [connecting, setConnecting] = useState(false)
  /** The armed source in connector mode. `part` is set when the click landed on
   *  one neuron of a network rather than on the network as a whole. */
  const [connectFrom, setConnectFrom] = useState<{ id: string; part?: string } | null>(null)
  /** One neuron or synapse inside a selected network — the thing the inspector
   *  edits when you have reached inside a network glyph. */
  /* Several at once, because colouring a whole layer is the common job and
     doing it one circle at a time is not editing, it is data entry. Shift adds
     and removes, the way it does for shapes. */
  const [selParts, setSelParts] = useState<PartRef[]>([])
  const setSelPart = (p: PartRef | null) => setSelParts(p ? [p] : [])
  /** The neuron being typed into. Its text goes straight into the circle. */
  const [editDot, setEditDot] = useState<{ node: string; key: string } | null>(null)
  // pan gets its own flag so the canvas cursor is driven by state rather than
  // by reading dragRef during render
  const [panning, setPanning] = useState(false)
  const [rail, setRail] = useState<'shapes' | 'templates' | 'layers'>('shapes')
  /* Both side panels are fixed-width, so on a narrow window they leave the
     canvas almost nothing. Start them folded there; an explicit fold/unfold is
     remembered for the session. */
  const [railOpen, setRailOpen] = useState(() => window.innerWidth >= AF_WIDE)
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= AF_WIDE)
  const [dpi, setDpi] = useState(600)
  const [trim, setTrim] = useState(true)
  /** export the selection alone — one block out of a figure, for a slide */
  const [onlySel, setOnlySel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dropping, setDropping] = useState(false)
  /* The undo stacks live in a ref (pushing must not re-render mid-drag), so the
     toolbar's two enabled flags are mirrored into state instead of read off the
     ref during render. */
  const [histState, setHistState] = useState({ canUndo: false, canRedo: false })

  const svgRef = useRef<SVGSVGElement>(null)
  const figRef = useRef<SVGGElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag>(null)
  const spaceRef = useRef(false)
  const clipRef = useRef<{ nodes: FigNode[]; edges: FigEdge[] } | null>(null)
  /** the serialised payload currently on the system clipboard, so a paste can
   *  tell "the same copy again" (cascade the offset) from "a different copy" */
  const clipTextRef = useRef<string | null>(null)
  const pasteN = useRef(0)

  /* docRef is the authority the mutating helpers read and write: commit / live
     / undo / redo each set it *before* setDocState, so two edits in one tick
     still build on each other. It is deliberately not a useLatest — that writes
     after commit, which would be a frame too late here. */
  const docRef = useRef(doc)

  // read-only mirrors for handlers that are bound once
  const viewRef = useLatest(view)
  const selNodesRef = useLatest(selNodes)
  const selEdgesRef = useLatest(selEdges)
  const connectFromRef = useLatest(connectFrom)
  const selPartsRef = useLatest(selParts)
  const connectingRef = useLatest(connecting)

  /* ---- MathJax: re-render once the glyphs are available.
     mathRev is threaded into the memoised node/edge views because their props
     do not change when the formula cache fills in. ---- */
  const [mathRev, setMathRev] = useState(0)

  /* ---- history ---- */
  const hist = useRef<{ past: FigDoc[]; future: FigDoc[] }>({ past: [], future: [] })
  const pending = useRef<FigDoc | null>(null)

  /** publish the stacks' emptiness to the toolbar */
  const syncHistory = useCallback(() => {
    const h = hist.current
    setHistState({ canUndo: h.past.length > 0, canRedo: h.future.length > 0 })
  }, [])
  const pushPast = useCallback(
    (d: FigDoc) => {
      hist.current.past.push(d)
      if (hist.current.past.length > 120) hist.current.past.shift()
      hist.current.future = []
      syncHistory()
    },
    [syncHistory],
  )
  /* Every edit passes through here, so this is the one place the nodes whose
     box is a *result* rather than an input can be brought back into line — an
     auto-fitting text node with the size of its own glyphs, a lattice-mode MLP
     with the span of its own circles. That includes the edits which resize them
     indirectly, like changing the font or the neuron pitch. Both passes return
     the document unchanged when nothing moved, so commit's identity check and
     the drag-frame render path stay as cheap as they were. Undo and redo
     deliberately skip this: they restore, they do not edit. */
  /** Change the document and open a new undo step. */
  const commit = useCallback((next: FigDoc | ((d: FigDoc) => FigDoc)) => {
    const cur = docRef.current
    const value = normalise(typeof next === 'function' ? next(cur) : next)
    if (value === cur) return
    pushPast(cur)
    docRef.current = value
    setDocState(value)
  }, [pushPast])
  /** Change the document without touching history (drag frames). */
  const live = useCallback((next: FigDoc | ((d: FigDoc) => FigDoc)) => {
    const cur = docRef.current
    const value = normalise(typeof next === 'function' ? next(cur) : next)
    if (value === cur) return
    docRef.current = value
    setDocState(value)
  }, [])
  const beginDrag = () => {
    pending.current = docRef.current
  }
  const endDrag = (changed: boolean) => {
    if (changed && pending.current && pending.current !== docRef.current)
      pushPast(pending.current)
    pending.current = null
    syncHistory()
  }
  const undo = useCallback(() => {
    const h = hist.current
    const prev = h.past.pop()
    if (!prev) return
    h.future.push(docRef.current)
    docRef.current = prev
    setDocState(prev)
    setSelNodes([])
    setSelEdges([])
    setEditing(null)
    syncHistory()
  }, [syncHistory])
  const redo = useCallback(() => {
    const h = hist.current
    const next = h.future.pop()
    if (!next) return
    h.past.push(docRef.current)
    docRef.current = next
    setDocState(next)
    setSelNodes([])
    setSelEdges([])
    setEditing(null)
    syncHistory()
  }, [syncHistory])

  /* Declared after `live` on purpose: the ready callback re-measures the text
     nodes that were sized from the plain-text fallback. */
  useEffect(() => {
    let alive = true
    const bumpRev = () => {
      if (!alive) return
      setMathRev((r) => r + 1)
      live(refitText)
    }
    void ensureMathJax().then(bumpRev)
    const off = onMathReady(bumpRev)
    return () => {
      alive = false
      off()
    }
  }, [live])

  const flash = useCallback((m: string) => {
    setToast(m)
    // clear only our own message, so a later toast is not cut short by an
    // earlier timer
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 1800)
  }, [])

  /* ---- autosave ---- */
  const warnedQuota = useRef(false)
  useEffect(() => {
    const id = window.setTimeout(() => {
      const ok = saveDoc(doc)
      // embedded bitmaps blow through the localStorage quota quickly; say so
      // once instead of letting the session quietly stop autosaving
      if (!ok && !warnedQuota.current) {
        warnedQuota.current = true
        flash('자동 저장 실패 — 용량 초과입니다. .json으로 저장해 두세요')
      }
      if (ok) warnedQuota.current = false
    }, 400)
    return () => window.clearTimeout(id)
  }, [doc, flash])

  /* ---- derived ---- */
  const nmap = useMemo(() => nodeMap(doc), [doc])
  const resolved = useMemo(() => {
    const out = new Map<string, ResolvedEdge>()
    for (const e of doc.edges) {
      const r = resolveEdge(e, nmap)
      if (r) out.set(e.id, r)
    }
    return out
  }, [doc.edges, nmap])
  // the window pointer listeners are bound once, so they cannot close over this
  const resolvedRef = useLatest(resolved)

  const selectedNodeObjs = useMemo(
    () => doc.nodes.filter((n) => selNodes.includes(n.id)),
    [doc.nodes, selNodes],
  )
  const selectedEdgeObjs = useMemo(
    () => doc.edges.filter((e) => selEdges.includes(e.id)),
    [doc.edges, selEdges],
  )
  /* A part selection only means anything while its network is still selected
     and still exists. Deriving that here rather than clearing it at every place
     a selection can change is what keeps it from going stale — the list of
     those places is long and grows. */
  const activeParts = useMemo(() => {
    const kept = selParts.filter((p) => selNodes.includes(p.node))
    const node = kept.length ? (doc.nodes.find((n) => n.id === kept[0].node) ?? null) : null
    return node ? { node, keys: kept.map((p) => p.key), kind: kept[0].kind, refs: kept } : null
  }, [selParts, selNodes, doc.nodes])
  /* Connection dots on a single selected neuron or group. Only one, because
     four dots around every unit of a selected layer is a thicket, and pulling a
     wire is a one-at-a-time job anyway. A group gets them for the same reason
     it can be landed on: it is the thing the connector is meant to point at. */
  const partAnchors = useMemo(() => {
    if (!activeParts || activeParts.kind === 'wire' || activeParts.keys.length !== 1) return []
    const key = activeParts.keys[0]
    const n = activeParts.node
    return mlpPartAnchors(n, key, ANCHOR_OUT / view.zoom).map((a) => ({
      ...a,
      node: n.id,
      part: key,
    }))
  }, [activeParts, view.zoom])
  /** Rings and halos saying which parts are selected. */
  const partMarks = useMemo((): PartMark[] => {
    if (!activeParts) return []
    const n = activeParts.node
    const at = (p: Pt) => {
      const q = { x: n.x + p.x, y: n.y + p.y }
      return n.rotation ? rotatePt(q, rectCenter(n), n.rotation) : q
    }
    const lat = mlpLattice(n)
    const out: PartMark[] = []
    for (const ref of activeParts.refs) {
      if (ref.kind === 'dot') {
        const d = lat.dots.find((x) => x.key === ref.key)
        if (d) out.push({ kind: 'dot', c: at(d), r: d.r })
      } else if (ref.kind === 'group') {
        const r = mlpPartRect(n, ref.key)
        // a polygon rather than a rect: the node may be rotated, and the
        // overlay draws in canvas coordinates
        if (r)
          out.push({
            kind: 'group',
            pts: [
              { x: r.x, y: r.y },
              { x: r.x + r.w, y: r.y },
              { x: r.x + r.w, y: r.y + r.h },
              { x: r.x, y: r.y + r.h },
            ].map(at),
          })
      } else {
        const w = lat.wires.find((x) => x.key === ref.key)
        if (w) out.push({ kind: 'wire', a: at(w.a), b: at(w.b) })
      }
    }
    return out
  }, [activeParts])
  /* Resize grips on a single selected group.
   *
   * ⚠️ They edit the group's padding, not its size. Where a group *is* follows
   * from the units it holds and those are placed by the lattice, so the only
   * thing a grip can honestly move is how far the outline stands off them —
   * see `NeuronGroup.pad`. Dragging the east grip therefore widens the box on
   * the right alone, which is what a resize looks like from the outside. */
  const partGrips = useMemo(() => {
    if (!activeParts || activeParts.kind !== 'group' || activeParts.keys.length !== 1) return []
    const n = activeParts.node
    const key = activeParts.keys[0]
    const r = mlpPartRect(n, key)
    if (!r) return []
    return HANDLES.map((h) => {
      const uv = HANDLE_UV[h]
      const p = { x: n.x + r.x + r.w * uv.x, y: n.y + r.y + r.h * uv.y }
      return {
        handle: h,
        part: key,
        node: n.id,
        p: n.rotation ? rotatePt(p, rectCenter(n), n.rotation) : p,
      }
    })
  }, [activeParts])
  const selBox = useMemo(() => selectionBounds(doc, selNodes), [doc, selNodes])
  const hoverNode = hoverId && !dragging ? (nmap.get(hoverId) ?? null) : null

  /* Alt: how far the selection is from whatever the pointer is over, and where
     the two already agree. Measured between the ink, like everything else that
     aligns — the box is an editing frame, and nobody wants the distance to an
     invisible edge.

     Point at another shape and that shape answers; point at nothing and the
     canvas does, with its four margins. "Nothing under the pointer" is the same
     answer either way — you asked about the space the selection sits in, and on
     bare canvas that space *is* the page. */
  const probe = useMemo(() => {
    if (!measuring || !overCanvas || !selectedNodeObjs.length) return null
    const a = unionRect(selectedNodeObjs.map(inkRect))
    if (!a) return null
    if (hoverNode && !selNodes.includes(hoverNode.id)) {
      const b = inkRect(hoverNode)
      return { measures: measureBetween(a, b), aligns: alignmentsBetween(a, b) }
    }
    const frame = frameRect(doc.canvas)
    return { measures: measureToFrame(a, frame), aligns: alignmentsBetween(a, frame) }
  }, [measuring, overCanvas, hoverNode, selectedNodeObjs, selNodes, doc.canvas])

  /* ---- coordinate helpers ---- */
  const toWorld = useCallback(
    (clientX: number, clientY: number): Pt => {
      const rect = svgRef.current!.getBoundingClientRect()
      const v = viewRef.current
      return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom }
    },
    [viewRef],
  )

  // stable: the wheel listener below is attached once and closes over it
  const zoomAt = useCallback(
    (clientX: number, clientY: number, next: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return
      const v = viewRef.current
      const z = clampZoom(next)
      const cx = clientX - rect.left
      const cy = clientY - rect.top
      const wx = (cx - v.x) / v.zoom
      const wy = (cy - v.y) / v.zoom
      setView({ x: cx - wx * z, y: cy - wy * z, zoom: z })
    },
    [viewRef],
  )

  const zoomBy = (f: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, viewRef.current.zoom * f)
  }

  const fitView = useCallback((padding = 40) => {
    const el = stageRef.current
    if (!el) return
    const d = docRef.current
    const b = contentBounds(d) ?? { x: 0, y: 0, w: d.canvas.w, h: d.canvas.h }
    const box = {
      x: Math.min(b.x, 0),
      y: Math.min(b.y, 0),
      w: Math.max(b.x + b.w, d.canvas.w) - Math.min(b.x, 0),
      h: Math.max(b.y + b.h, d.canvas.h) - Math.min(b.y, 0),
    }
    const zoom = clampZoom(
      Math.min((el.clientWidth - padding * 2) / box.w, (el.clientHeight - padding * 2) / box.h),
    )
    setView({
      x: (el.clientWidth - box.w * zoom) / 2 - box.x * zoom,
      y: (el.clientHeight - box.h * zoom) / 2 - box.y * zoom,
      zoom,
    })
  }, [])

  useLayoutEffect(() => {
    // initial fit once the stage has a size
    const id = window.setTimeout(() => fitView(), 30)
    return () => window.clearTimeout(id)
  }, [fitView])

  /* ---- selection helpers ---- */
  const selectNode = (id: string, additive: boolean) => {
    setSelEdges([])
    setSelNodes((prev) => {
      const ids = expandGroups(docRef.current, [id])
      if (!additive) return ids
      const has = ids.every((i) => prev.includes(i))
      return has ? prev.filter((i) => !ids.includes(i)) : [...new Set([...prev, ...ids])]
    })
  }
  const selectEdge = (id: string, additive: boolean) => {
    setSelNodes([])
    setSelEdges((prev) =>
      additive
        ? prev.includes(id)
          ? prev.filter((i) => i !== id)
          : [...prev, id]
        : [id],
    )
  }
  const clearSel = () => {
    setSelNodes([])
    setSelEdges([])
    setEditing(null)
  }

  /* ---- mutation wrappers used by the inspector ---- */
  const patchSelNodes = (patch: (n: FigNode) => Partial<FigNode>) =>
    commit((d) => patchNodes(d, selNodesRef.current, patch))
  const patchSelStyle = (patch: Partial<Style>) =>
    commit((d) => patchNodeStyle(d, selNodesRef.current, patch))
  const bagOf = (kind: PartRef['kind']) =>
    kind === 'dot' ? 'neurons' : kind === 'group' ? 'groups' : 'wires'

  const patchPart = (patch: NeuronBits | WireBits | Partial<NeuronGroup> | null) => {
    const sel = activeParts?.refs ?? []
    if (!sel.length) return
    commit((d) => sel.reduce((acc, p) => patchMlpPart(acc, p, bagOf(p.kind), patch), d))
  }

  /* Take the selected units as one thing. The group holds keys, not positions,
     so it survives the lattice being re-spaced underneath it. */
  const groupParts = () => {
    const sel = activeParts
    if (!sel || sel.kind !== 'dot' || sel.keys.length < 2) return
    const key = freshGroupKey(sel.node.props)
    commit((d) =>
      patchMlpPart(d, { node: sel.node.id, key }, 'groups', { parts: [...sel.keys] }),
    )
    setSelPart({ node: sel.node.id, key, kind: 'group' })
  }

  const ungroupParts = () => {
    const sel = activeParts
    if (!sel || sel.kind !== 'group') return
    commit((d) => sel.refs.reduce((acc, p) => patchMlpPart(acc, p, 'groups', null), d))
    setSelPart(null)
  }
  const patchSelProps = (patch: Record<string, unknown>) =>
    commit((d) =>
      patchNodes(d, selNodesRef.current, (n) => ({ props: { ...n.props, ...patch } })),
    )
  const patchSelEdges = (patch: (e: FigEdge) => Partial<FigEdge>) =>
    commit((d) => patchEdges(d, selEdgesRef.current, patch))
  const patchSelEdgeStyle = (patch: Partial<FigEdge['style']>) =>
    commit((d) => patchEdgeStyle(d, selEdgesRef.current, patch))
  const patchCanvas = (patch: Partial<CanvasCfg>) =>
    commit((d) => ({ ...d, canvas: { ...d.canvas, ...patch } }))

  /** Paint the palette accent onto the selection (outline + pale fill). */
  /* The part the toolbar is acting on, if any.
   *
   * ⚠️ Every toolbar action that paints has to ask this first. Reaching inside
   * a network makes one neuron the subject, and a button that skipped the
   * question would repaint the whole network from a control that looks like it
   * is about the thing you just clicked. The inspector already hides the node's
   * own panel while a part is focused; the toolbar is the other way in. */
  const focusedParts = () =>
    selPartsRef.current.filter((p) => selNodesRef.current.includes(p.node))

  /** Paint the focused parts instead of the node. True when it did. */
  const paintPart = (bits: NeuronBits, wireBits: WireBits) => {
    const parts = focusedParts()
    if (!parts.length) return false
    commit((d) =>
      parts.reduce(
        (acc, p) =>
          patchMlpPart(acc, p, p.kind === 'dot' ? 'neurons' : 'wires', p.kind === 'dot' ? bits : wireBits),
        d,
      ),
    )
    return true
  }

  const applyAccent = (hex: string) => {
    if (paintPart({ stroke: hex, fill: tint(hex, 0.84) }, { stroke: hex })) return
    if (selNodesRef.current.length)
      commit((d) => patchNodeStyle(d, selNodesRef.current, { stroke: hex, fill: tint(hex, 0.84) }))
    if (selEdgesRef.current.length)
      commit((d) => patchEdgeStyle(d, selEdgesRef.current, { stroke: hex, textColor: hex }))
    if (!selNodesRef.current.length && !selEdgesRef.current.length) flash('먼저 요소를 선택하세요')
  }

  /* ---- insertion ---- */
  /** viewCenter is used by handlers registered before it is declared */
  const viewCenter = (): Pt => {
    const el = stageRef.current
    const v = viewRef.current
    if (!el) return { x: doc.canvas.w / 2, y: doc.canvas.h / 2 }
    return { x: (el.clientWidth / 2 - v.x) / v.zoom, y: (el.clientHeight / 2 - v.y) / v.zoom }
  }
  // the paste / drop handlers are bound once and need the current one
  const viewCenterRef = useLatest(viewCenter)

  const insertShape = (kind: NodeKind) => {
    const c = viewCenter()
    const { doc: next, id } = addNodeAt(docRef.current, kind, c)
    // the catalogue's sizes are chosen to look right, not to divide by the
    // grid, so a fresh shape would land off the lattice everything else is on
    const placed = next.canvas.snap
      ? patchNodes(next, [id], (n) => fitNodeToGrid(n, next.canvas.grid))
      : next
    commit(placed)
    setSelEdges([])
    setSelNodes([id])
    if (kind === 'text') setEditing(id)
  }

  /** Drop / paste / pick a set of bitmaps in at `at` (world coords).
   *  Each keeps its own aspect ratio and is capped to a third of the canvas so
   *  a 4000 px screenshot does not land as a wall; several at once are laid out
   *  left to right, which is the qualitative-results panel people actually want. */
  const insertImages = useCallback(
    async (files: File[], at: Pt) => {
      if (!files.length) return
      const d = docRef.current
      const maxW = Math.max(80, d.canvas.w / 3)
      const maxH = Math.max(80, d.canvas.h / 2)
      let loaded
      try {
        loaded = await Promise.all(files.slice(0, 12).map((f) => fileToImage(f)))
      } catch {
        flash('이미지를 읽지 못했습니다')
        return
      }

      const GAP = 10
      const boxes = loaded.map((im) => fitBox(im.w, im.h, maxW, maxH))
      const totalW = boxes.reduce((s, b) => s + b.w, 0) + GAP * (boxes.length - 1)
      const tallest = Math.max(...boxes.map((b) => b.h))
      let x = Math.round(at.x - totalW / 2)
      const y = Math.round(at.y - tallest / 2)

      const pal = paletteById(d.paletteId)
      const nodes: FigNode[] = loaded.map((im, i) => {
        const box = boxes[i]
        const node = makeNode('image', 0, 0, pal, d.canvas.baseFont)
        const placed: FigNode = {
          ...node,
          x,
          y: y + Math.round((tallest - box.h) / 2),
          w: box.w,
          h: box.h,
          props: { ...node.props, src: im.src, fit: 'fill', natW: im.w, natH: im.h },
        }
        x += box.w + GAP
        return placed
      })

      commit({ ...docRef.current, nodes: [...docRef.current.nodes, ...nodes] })
      setSelEdges([])
      setSelNodes(nodes.map((n) => n.id))
      const shrunk = loaded.filter((im) => im.resized).length
      flash(
        shrunk
          ? `이미지 ${nodes.length}개 추가 — ${shrunk}개는 긴 변 2400 px로 축소했습니다`
          : `이미지 ${nodes.length}개 추가`,
      )
    },
    [commit, flash],
  )

  const insertTemplate = (tplId: string) => {
    const tpl = TEMPLATES.find((t) => t.id === tplId)
    if (!tpl) return
    const d = docRef.current
    const bag = tpl.build(paletteById(d.paletteId), d.canvas.baseFont)
    const b = unionRect(bag.nodes.map(nodeBounds))
    const c = viewCenter()
    const dx = b ? Math.round(c.x - b.x - b.w / 2) : 0
    const dy = b ? Math.round(c.y - b.y - b.h / 2) : 0
    const nodes = bag.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }))
    const edges = bag.edges.map((e) => ({
      ...e,
      waypoints: e.waypoints.map((p) => (p.rel ? { ...p } : { x: p.x + dx, y: p.y + dy })),
    }))
    commit({ ...d, nodes: [...d.nodes, ...nodes], edges: [...d.edges, ...edges] })
    setSelEdges([])
    setSelNodes(nodes.map((n) => n.id))
    flash(`${tpl.label} 삽입`)
  }

  /* ---- clipboard ----
   *
   * Copying nodes has to take ownership of the *system* clipboard, not just the
   * in-memory one. It used to only fill `clipRef`, so whatever was on the OS
   * clipboard — typically an image copied hours ago — outlived the copy, and
   * since paste checks images first that stale image won every time. The
   * ⌘C keydown even called preventDefault, which suppressed the native `copy`
   * event and guaranteed the OS clipboard was never refreshed.
   *
   * Writing the selection out as text also makes copy work between two windows
   * of the app, which the in-memory buffer never could. */
  const copySel = () => {
    const d = docRef.current
    const ids = new Set(selNodesRef.current)
    if (!ids.size) return false
    const inside = (ep: FigEdge['from']) => 'node' in ep && ids.has(ep.node)
    clipRef.current = {
      nodes: d.nodes.filter((n) => ids.has(n.id)),
      edges: d.edges.filter((e) => inside(e.from) && inside(e.to)),
    }
    pasteN.current = 0
    flash(`${ids.size}개 복사됨`)
    return true
  }
  const pasteClip = () => {
    const clip = clipRef.current
    if (!clip?.nodes.length) return false
    pasteN.current += 1
    const off = 18 * pasteN.current
    const d = docRef.current
    const ids = new Set(clip.nodes.map((n) => n.id))
    // re-run through duplicate() so ids/groups are freshly remapped
    const merged: FigDoc = {
      ...d,
      nodes: [...d.nodes, ...clip.nodes.filter((n) => !d.nodes.some((m) => m.id === n.id))],
      edges: [...d.edges, ...clip.edges.filter((e) => !d.edges.some((m) => m.id === e.id))],
    }
    const res = duplicate(merged, [...ids], clip.edges.map((e) => e.id), off, off)
    // drop the temporarily merged originals that were not already present
    const keep = new Set([...d.nodes.map((n) => n.id), ...res.nodeIds])
    const keepE = new Set([...d.edges.map((e) => e.id), ...res.edgeIds])
    commit({
      ...res.doc,
      nodes: res.doc.nodes.filter((n) => keep.has(n.id)),
      edges: res.doc.edges.filter((e) => keepE.has(e.id)),
    })
    setSelEdges([])
    setSelNodes(res.nodeIds)
    return true
  }
  const duplicateSel = () => {
    if (!selNodesRef.current.length) return
    const res = duplicate(docRef.current, selNodesRef.current, selEdgesRef.current)
    commit(res.doc)
    setSelEdges([])
    setSelNodes(res.nodeIds)
  }
  const deleteSel = () => {
    /* ⚠️ Same trap as the swatches, with a worse ending: a neuron cannot be
       deleted — the lattice decides how many there are — so Delete used to fall
       through and take the entire network with it. The nearest thing a part can
       lose is what has been done to it, so that is what goes. */
    const parts = focusedParts()
    if (parts.length) {
      commit((d) =>
        parts.reduce(
          (acc, p) => patchMlpPart(acc, p, p.kind === 'dot' ? 'neurons' : 'wires', null),
          d,
        ),
      )
      return
    }
    if (!selNodesRef.current.length && !selEdgesRef.current.length) return
    commit((d) => removeItems(d, selNodesRef.current, selEdgesRef.current))
    clearSel()
  }

  /* ---- connectors ---- */

  const toggleConnect = useCallback(() => {
    setConnecting((on) => {
      if (on) {
        setConnectFrom(null)
        setTemp(null)
      } else {
        setSelNodes([])
        setSelEdges([])
      }
      return !on
    })
  }, [])

  /** Wire the selected layers together in one action.
   *
   *  Building a fully-connected figure by hand means one connector per synapse
   *  — 4×5 alone is twenty drags. Selecting the units of two or more layers and
   *  running this does the whole thing, and leaves the new edges selected so
   *  their style is one click away. */
  const connectSelection = useCallback(() => {
    const ids = selNodesRef.current
    if (ids.length < 2) {
      flash('노드를 2개 이상 선택하세요')
      return
    }
    const r = fullyConnect(docRef.current, ids)
    if (!r.edgeIds.length) {
      flash('좌우로 나뉜 두 열 이상을 선택해야 합니다')
      return
    }
    commit(r.doc)
    setSelNodes([])
    setSelEdges(r.edgeIds)
    flash(`${r.columns}개 층 · 연결선 ${r.edgeIds.length}개`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, flash])

  /* ---- pointer interaction ---- */

  const gridSnap = (v: number) => {
    const c = docRef.current.canvas
    return c.snap ? Math.round(v / c.grid) * c.grid : v
  }

  /* Hover is decided by geometry, not by which DOM element happens to be on
   * top.
   *
   * It used to come from pointerenter/leave on each node's hit rect. The anchor
   * dots that hover puts on the border are painted in a different layer and
   * take pointer events, so the moment you touched one the rect below it fired
   * pointerleave — which unmounted the very dot you were reaching for. It
   * reappeared as soon as the pointer fell through to the rect again, so the
   * dots flickered and could not be grabbed at all. Hit-testing the document
   * keeps the node hovered wherever the pointer is near it, dots included. */
  /** The node hover would light up at this point: topmost, visible, unlocked. */
  /* What a connector would land on here: a node, and — when that node is a
     network and the pointer is on one of its circles — the neuron too. Every
     path that ends a connection goes through this, so clicking a unit and
     clicking the box around it cannot disagree about which was meant. */
  const connectTargetAt = (w: Pt) => {
    const n = docRef.current.nodes
      .slice()
      .reverse()
      .find((x) => !x.hidden && onShape(w, x, 4))
    if (!n) return null
    /* A circle first, then a group's outline — the same order the press ladder
       uses. A group is a landing site in its own right; that is what it is for. */
    const part =
      n.kind === 'mlp'
        ? (mlpDotAt(n, w, 3)?.key ?? mlpGroupAt(n, w, 5 / viewRef.current.zoom) ?? undefined)
        : undefined
    return { node: n, part }
  }

  const pickNodeAt = (w: Pt, tol = 0) =>
    docRef.current.nodes
      .slice()
      .reverse()
      .find((n) => !n.hidden && !n.locked && onShape(w, n, tol)) ?? null

  /* Written straight through rather than read back off state: several pointer
     moves can land before React re-renders, and a stale read here would drop
     the node the pointer is still reaching across. */
  const setHover = (id: string | null) => {
    hoverRef.current = id
    setHoverId((h) => (h === id ? h : id))
  }

  const onHoverMove = (ev: React.PointerEvent) => {
    if (dragRef.current) return
    const w = toWorld(ev.clientX, ev.clientY)
    const k = 1 / viewRef.current.zoom
    /* The dots float outside the box, so reaching one takes the pointer off the
       shape. Keep the node we already have while the pointer is out on one of
       its dots — the tolerance below is for *finding* a node, and widening it
       far enough to cover the dots would make every node grabbier instead. */
    const cur = hoverRef.current ? nmap.get(hoverRef.current) : null
    if (cur && !cur.hidden && !cur.locked && onAnchorDot(w, cur, k)) return
    setHover(pickNodeAt(w, HOVER_TOL * k)?.id ?? null)
  }

  const onPointerDown = (ev: React.PointerEvent) => {
    if (ev.button === 1 || spaceRef.current || ev.altKey) {
      dragRef.current = { t: 'pan', sx: ev.clientX, sy: ev.clientY, ox: view.x, oy: view.y }
      setDragging(true)
      setPanning(true)
      return
    }
    if (ev.button !== 0) return
    const el = ev.target as Element
    const world = toWorld(ev.clientX, ev.clientY)
    const d = docRef.current

    // 0) connector mode: click the source, then click the target. The source
    //    stays armed afterwards, so wiring one node to a whole column costs one
    //    click per edge instead of one drag per edge.
    if (connecting) {
      /* Asked of the geometry rather than of the hit layer: a network's rect
         covers the holes between its columns, and a click there means the
         shape underneath — the same answer the drop of a dragged wire gets. */
      const hit = connectTargetAt(world)
      const n = hit?.node ?? null
      if (!n) {
        setConnectFrom(null)
        setTemp(null)
        return
      }
      // a circle inside a network is a target in its own right
      const part = hit?.part
      if (!connectFrom) {
        setConnectFrom({ id: n.id, part })
        setTemp({ a: part ? (mlpPartCentre(n, part) ?? rectCenter(n)) : rectCenter(n), b: world, target: null })
        return
      }
      /* Same node twice is fine now, as long as the two ends are different
         units of it — that is how a skip connection inside one network gets
         drawn. Only the very same circle is a no-op. */
      if (n.id !== connectFrom.id || (part && part !== connectFrom.part)) {
        commit(
          (cur) =>
            connectNodes(cur, connectFrom.id, n.id, 'auto', 'auto', connectFrom.part, part).doc,
        )
      }
      return
    }

    // 0.5) a group's own grips, which sit inside the network's box and so have
    //      to be asked about before anything that hit-tests the canvas
    const gHandle = el.getAttribute?.('data-part-handle')
    if (gHandle) {
      const gid = el.getAttribute('data-part-node')
      const gkey = el.getAttribute('data-part-key')
      const gn = gid ? nmap.get(gid) : null
      if (gn && gkey) {
        beginDrag()
        setDragging(true)
        dragRef.current = {
          t: 'gpad',
          id: gn.id,
          key: gkey,
          handle: gHandle as HandleKey,
          start: mlpToLocal(gn, world),
          orig: groupPad(gn.props.groups?.[gkey]),
          moved: false,
        }
        return
      }
    }

    // 1) transform handles
    const handle = el.getAttribute?.('data-handle')
    if (handle && selNodesRef.current.length === 1) {
      const n = nmap.get(selNodesRef.current[0])
      if (n) {
        beginDrag()
        setDragging(true)
        if (handle === 'rotate') {
          const c = rectCenter(n)
          dragRef.current = {
            t: 'rotate',
            id: n.id,
            center: c,
            startAngle: Math.atan2(world.y - c.y, world.x - c.x),
            origRot: n.rotation,
            moved: false,
          }
        } else {
          dragRef.current = {
            t: 'resize',
            id: n.id,
            kind: n.kind,
            handle: handle as HandleKey,
            orig: { x: n.x, y: n.y, w: n.w, h: n.h },
            rotation: n.rotation,
            start: world,
            moved: false,
          }
          // grabbing a handle is the user taking the box over from the text
          if (n.props.autoFit)
            live((cur) =>
              patchNodes(cur, [n.id], (t) => ({ props: { ...t.props, autoFit: false } })),
            )
        }
        return
      }
    }

    // 2) start a connection from an anchor dot
    const anchorNode = el.getAttribute?.('data-anchor-node')
    if (anchorNode) {
      const a = el.getAttribute('data-anchor') ?? 'auto'
      // set when the dot belongs to one neuron rather than to the whole shape
      const part = el.getAttribute('data-anchor-part') ?? undefined
      const n = nmap.get(anchorNode)
      if (n) {
        beginDrag()
        setDragging(true)
        const uv: Record<string, Pt> = {
          n: { x: 0.5, y: 0 },
          s: { x: 0.5, y: 1 },
          e: { x: 1, y: 0.5 },
          w: { x: 0, y: 0.5 },
        }
        const u = uv[a] ?? { x: 0.5, y: 0.5 }
        const from = part
          ? (mlpPartCentre(n, part) ?? rectCenter(n))
          : { x: n.x + n.w * u.x, y: n.y + n.h * u.y }
        dragRef.current = { t: 'connect', node: n.id, anchor: a, from, part }
        setTemp({ a: from, b: world, target: null })
        return
      }
    }

    // 3) edge endpoint / waypoint
    const endpoint = el.getAttribute?.('data-endpoint')
    const edgeId = el.getAttribute?.('data-edge-id')
    if (endpoint && edgeId) {
      beginDrag()
      setDragging(true)
      dragRef.current = { t: 'endpoint', edge: edgeId, which: endpoint as 'from' | 'to' }
      setTemp({ a: world, b: world, target: null })
      return
    }
    const wp = el.getAttribute?.('data-waypoint')
    if (wp && edgeId) {
      beginDrag()
      setDragging(true)
      dragRef.current = { t: 'waypoint', edge: edgeId, index: Number(wp), moved: false }
      return
    }

    // 3b) drag a connector's label along its own path
    const hitLabel = el.getAttribute?.('data-hit-label')
    if (hitLabel) {
      const r = resolved.get(hitLabel)
      const e = d.edges.find((x) => x.id === hitLabel)
      if (r && e && !e.locked) {
        selectEdge(hitLabel, ev.shiftKey)
        beginDrag()
        setDragging(true)
        dragRef.current = {
          t: 'label',
          edge: hitLabel,
          start: world,
          base: atLength(r.info, e.labelT).p,
          moved: false,
        }
        return
      }
    }

    // 4) node hit
    const hitNode = el.getAttribute?.('data-hit-node')
    if (hitNode) {
      /* What you hover has to be what you drag.
       *
       * ⚠️ Hover picks the topmost *unlocked* node geometrically; the press
       * used to take whichever hit rect the DOM happened to put under the
       * cursor and give up if it was locked. A locked node lying over an
       * unlocked one made the two disagree — the anchor dots said "you have
       * this one", the press fell through to the marquee branch and started
       * rubber-banding the empty canvas instead. Fall back to hover's answer
       * rather than dropping through. */
      /* ⚠️ And a network's hit rect covers its holes, so it has to prove the
         press actually landed on something it draws — otherwise a block parked
         between two columns could never be clicked, because every press inside
         the network's bounds was answered by the network. */
      /* Only networks are re-checked. Every other hit rect is deliberately
         more generous than the geometry — an unfilled shape's band is widened
         for the zoom, a cuboid's rect covers the face it leans out into — and
         insisting on `pointOnNode` there would take that reach away. */
      const direct = nmap.get(hitNode)
      const usable =
        direct && !direct.locked && (direct.kind !== 'mlp' || mlpHit(direct, world, PART_TOL / viewRef.current.zoom))
          ? direct
          : null
      const n = usable ?? pickNodeAt(world)
      if (n) {
        const already = selNodesRef.current.includes(n.id)
        /* Reaching inside a network.
         *
         * The first click selects the network, the way clicking any shape does.
         * Once it is on its own, a *click* on one of its circles or synapses
         * picks that part instead — the "select the group, then select within
         * it" idiom, and it costs no new mode.
         *
         * ⚠️ Two conditions, and both were learned the hard way. It has to be
         * the only thing selected, or a marquee that swept up a network along
         * with three other shapes would collapse to one synapse the moment you
         * pressed to move them. And it is decided on the way *up*, not here,
         * because a network's synapses cross most of its box — grabbing one on
         * the way down would leave almost nowhere to grab the network itself. */
        /* Shift keeps working inside a network too: it is how a whole layer
           gets one colour, and doing that a circle at a time is data entry
           rather than editing. It only adds to a part selection that already
           exists — with the network merely selected, shift still means what it
           means for shapes. */
        const inParts = selPartsRef.current.length > 0
        const solo = already && selNodesRef.current.length === 1
        let part: PartRef | undefined
        if (n.kind === 'mlp' && solo && (!ev.shiftKey || inParts) && !n.locked) {
          /* A circle first, then the outline of a group, then a synapse. The
             group is picked by its edge alone, so the units it holds stay
             reachable — a group that swallowed presses on its own members
             would put them out of reach. */
          const dot = mlpDotAt(n, world, 2)
          const group = dot ? null : mlpGroupAt(n, world, 5 / viewRef.current.zoom)
          const wire =
            dot || group ? null : mlpWireAt(n, world, 3 / viewRef.current.zoom)
          const hitKey = dot?.key ?? group ?? wire?.key
          if (hitKey)
            part = {
              node: n.id,
              key: hitKey,
              kind: dot ? 'dot' : group ? 'group' : 'wire',
            }
        }
        if (part && ev.shiftKey) {
          // toggle straight away: a shift-press is never the start of a drag
          const has = selPartsRef.current.some((q) => q.key === part!.key && q.node === part!.node)
          setSelParts((cur) =>
            has
              ? cur.filter((q) => !(q.key === part!.key && q.node === part!.node))
              : // one kind at a time — a colour means different things to a
                // circle and to a line, so mixing them has nothing to offer
                [...cur.filter((q) => q.kind === part!.kind), part!],
          )
          return
        }
        /* Already reached inside and pressing that same part again: the drag
           slides its whole layer rather than the network. It is the second
           press either way — the first one reaches in — and pulling a circle
           sideways is a far better way to say "put this layer further out"
           than typing two gap widths that have to add up. */
        if (part && part.kind !== 'wire' && isLattice(n.props)) {
          const held = selPartsRef.current.some((q) => q.key === part!.key && q.node === n.id)
          const li = layerOfPart(n, part.key)
          if (held && li !== null && mlpLayers(n.props).length > 1) {
            beginDrag()
            setDragging(true)
            dragRef.current = {
              t: 'layer',
              id: n.id,
              li,
              start: world,
              gaps: mlpGaps(n.props),
              x: n.x,
              moved: false,
            }
            return
          }
        }
        if (!part) setSelPart(null)
        let ids = already ? selNodesRef.current : expandGroups(d, [n.id])
        if (ev.shiftKey) {
          ids = already
            ? selNodesRef.current.filter((i) => i !== n.id)
            : [...new Set([...selNodesRef.current, ...expandGroups(d, [n.id])])]
          setSelNodes(ids)
          setSelEdges([])
          return
        }
        if (!already) {
          setSelNodes(ids)
          setSelEdges([])
        }
        const orig = new Map<string, Pt>()
        for (const id of ids) {
          const nn = nmap.get(id)
          if (nn && !nn.locked) orig.set(id, { x: nn.x, y: nn.y })
        }
        // the ink, not the box: what the guides line up is what you can see
        const box = unionRect([...orig.keys()].map((id) => inkRect(nmap.get(id)!)))
        if (!box) return
        beginDrag()
        setDragging(true)
        dragRef.current = {
          t: 'move',
          ids: [...orig.keys()],
          start: world,
          orig,
          box,
          moved: false,
          sticky: { x: null, y: null },
          part,
        }
        return
      }
    }

    // 5) edge hit
    const hitEdge = el.getAttribute?.('data-hit-edge')
    if (hitEdge) {
      selectEdge(hitEdge, ev.shiftKey)
      /* An orthogonal route's long runs are draggable sideways. Waypoints could
         already express the result, but placing one by hand to move a lane is
         backwards: you want to push the line you can see. The stubs at either
         end are left alone — they are pinned to the anchors. */
      const r = resolved.get(hitEdge)
      const e = d.edges.find((x) => x.id === hitEdge)
      if (r && e && !e.locked && e.route === 'ortho' && r.corners.length > 3) {
        const seg = nearestRun(r.corners, world)
        if (seg) {
          beginDrag()
          setDragging(true)
          dragRef.current = {
            t: 'segment',
            edge: hitEdge,
            index: seg.index,
            axis: seg.axis,
            corners: r.corners,
            start: world,
            moved: false,
          }
        }
      }
      return
    }

    // 6) empty canvas → marquee
    if (!ev.shiftKey) clearSel()
    dragRef.current = { t: 'marquee', start: world, add: ev.shiftKey }
    setMarquee({ x: world.x, y: world.y, w: 0, h: 0 })
    setDragging(true)
  }

  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) {
        // connector mode trails a line from the armed source even though no
        // button is down, which is what tells you the click was registered
        const from = connectFromRef.current
        if (!from) return
        const w = toWorld(ev.clientX, ev.clientY)
        const over = docRef.current.nodes
          .slice()
          .reverse()
          .find((n) => !n.hidden && onShape(w, n, 4))
        setTemp((t) =>
          t ? { ...t, b: w, target: over && over.id !== from.id ? over.id : null } : t,
        )
        return
      }
      const world = toWorld(ev.clientX, ev.clientY)

      if (drag.t === 'pan') {
        setView((v) => ({ ...v, x: drag.ox + (ev.clientX - drag.sx), y: drag.oy + (ev.clientY - drag.sy) }))
        return
      }

      if (drag.t === 'move') {
        let dx = world.x - drag.start.x
        let dy = world.y - drag.start.y
        if (ev.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0
          else dx = 0
        }
        const d = docRef.current
        const free = ev.metaKey || ev.ctrlKey
        /* Guides first, grid second.
         *
         * ⚠️ These two used to run the other way round — quantise to the grid,
         * then let a guide pull up to 5px further. Any neighbour whose edge or
         * centre was not itself on the grid (an odd width puts its centre half
         * a step off, so most of them) then dragged the node back off it, and
         * the next drag re-quantised. That flip-flop is what made snapping feel
         * arbitrary. An alignment with something you can see beats one with an
         * invisible lattice, so it wins the axis outright and the grid only
         * gets the axes no guide claimed.
         *
         * ⚠️ That order is also what lets the page be a target at all. What the
         * grid quantises is the box's *position*, and centring puts that at
         * `page/2 - w/2` — 211 for a 106-wide box on a 528px page, which is not
         * on the half-cell lattice. So if the grid ran first, or even got a say
         * afterwards, a box could never actually sit centred on the page. Being
         * tier one means the page takes the axis outright and nothing pulls it
         * back off. */
        const moving = { x: drag.box.x + dx, y: drag.box.y + dy, w: drag.box.w, h: drag.box.h }
        const others = d.nodes.filter((n) => !drag.ids.includes(n.id) && !n.hidden).map(inkRect)
        const snap = free
          ? { dx: 0, dy: 0, hitX: false, hitY: false, guides: [] as Guide[], atX: null, atY: null }
          : snapGuides(
              moving,
              [...others, frameRect(d.canvas)],
              SNAP_PX / viewRef.current.zoom,
              drag.sticky,
            )
        drag.sticky = { x: snap.atX, y: snap.atY }
        /* Three rules per axis, in order of how much they mean to the reader.
           Lining up with something beats an even gap, and an even gap beats the
           lattice — a grid is only ever a proxy for the other two.

           Positions land on half cells: the corners *and* the middles of the
           checker, which is what lets an odd box centre itself on the lattice
           and an even one sit flush. Quantising the selection's box rather than
           the lead node is what makes a multi-selection move as one piece. */
        const g = d.canvas.grid
        const gaps: Gap[] = []
        const evenly = (axis: 'x' | 'y') => {
          if (free) return null
          const box = { x: drag.box.x + dx, y: drag.box.y + dy, w: drag.box.w, h: drag.box.h }
          return spacingSnap(box, others, axis, SNAP_PX / viewRef.current.zoom)
        }
        if (snap.hitX) dx += snap.dx
        else {
          const s = evenly('x')
          if (s) {
            dx += s.d
            gaps.push(...s.gaps)
          } else if (d.canvas.snap && !free) dx += snapPos(drag.box.x + dx, g) - (drag.box.x + dx)
        }
        if (snap.hitY) dy += snap.dy
        else {
          const s = evenly('y')
          if (s) {
            dy += s.d
            gaps.push(...s.gaps)
          } else if (d.canvas.snap && !free) dy += snapPos(drag.box.y + dy, g) - (drag.box.y + dy)
        }
        setGuides(snap.guides)
        setGaps(gaps)
        drag.moved = drag.moved || dx !== 0 || dy !== 0
        live((cur) =>
          patchNodes(cur, drag.ids, (n) => {
            const o = drag.orig.get(n.id)!
            return { x: Math.round(o.x + dx), y: Math.round(o.y + dy) }
          }),
        )
        return
      }

      if (drag.t === 'resize') {
        const o = drag.orig
        // work in the node's own frame so rotated boxes resize along their axes
        const c0 = { x: o.x + o.w / 2, y: o.y + o.h / 2 }
        const local = drag.rotation ? rotatePt(world, c0, -drag.rotation) : world
        const start = drag.rotation ? rotatePt(drag.start, c0, -drag.rotation) : drag.start
        const dx = local.x - start.x
        const dy = local.y - start.y
        const d = docRef.current
        let { x, y, w, h } = o
        const H = drag.handle
        if (H.includes('e')) w = o.w + dx
        if (H.includes('w')) {
          x = o.x + dx
          w = o.w - dx
        }
        if (H.includes('s')) h = o.h + dy
        if (H.includes('n')) {
          y = o.y + dy
          h = o.h - dy
        }
        if (ev.shiftKey && w > 0 && h > 0) {
          const k = Math.max(w / o.w, h / o.h)
          const nw = o.w * k
          const nh = o.h * k
          if (H.includes('w')) x = o.x + o.w - nw
          if (H.includes('n')) y = o.y + o.h - nh
          w = nw
          h = nh
        }
        /* An op paints a circle inscribed in the shorter axis, so any other
           aspect is dead space that the selection box, the anchors and the
           guides all report as part of the shape. Keep it square. */
        if (drag.kind === 'op') {
          const side = H === 'e' || H === 'w' ? w : H === 'n' || H === 's' ? h : Math.max(w, h)
          if (H.includes('w')) x += w - side
          if (H.includes('n')) y += h - side
          w = side
          h = side
        }
        const sides: MovedSides = {
          l: H.includes('w'),
          r: H.includes('e'),
          t: H.includes('n'),
          b: H.includes('s'),
        }
        const free = ev.metaKey || ev.ctrlKey || ev.shiftKey || !!drag.rotation
        if (!free) {
          const others = d.nodes.filter((n) => n.id !== drag.id && !n.hidden).map(inkRect)
          const g = snapSides(
            { x, y, w, h },
            sides,
            [...others, frameRect(d.canvas)],
            SNAP_PX / viewRef.current.zoom,
          )
          setGuides(g.guides)
          const gx = g.guides.some((q) => q.axis === 'x')
          const gy = g.guides.some((q) => q.axis === 'y')
          if (gx) ({ x, w } = { x: g.rect.x, w: g.rect.w })
          if (gy) ({ y, h } = { y: g.rect.y, h: g.rect.h })
          /* Quantise the *size*, holding the edge you are not dragging exactly
             where it is. Rounding the moving edge onto the grid instead would
             drag the box off the half-cell position it was placed at; this way
             a box grows and shrinks a whole cell at a time and keeps whatever
             offset it had, which is what makes the half-cell positions survive
             a resize. Non-whole sizes get fixed on their first resize for free. */
          if (d.canvas.snap && !gx) {
            const nw = snapSize(w, d.canvas.grid)
            if (sides.l) x += w - nw
            w = nw
          }
          if (d.canvas.snap && !gy) {
            const nh = snapSize(h, d.canvas.grid)
            if (sides.t) y += h - nh
            h = nh
          }
          if (drag.kind === 'op' && (gx || gy || d.canvas.snap)) {
            // re-square after the axes were quantised independently
            const side = Math.max(4, sides.l || sides.r ? w : h)
            if (H.includes('w')) x += w - side
            if (H.includes('n')) y += h - side
            w = side
            h = side
          }
        } else {
          setGuides([])
          setGaps([])
        }
        w = Math.max(4, w)
        h = Math.max(4, h)
        // keep the visual centre consistent under rotation
        if (drag.rotation) {
          const c1 = { x: x + w / 2, y: y + h / 2 }
          const dLocal = { x: c1.x - c0.x, y: c1.y - c0.y }
          const a = (drag.rotation * Math.PI) / 180
          const dWorld = {
            x: dLocal.x * Math.cos(a) - dLocal.y * Math.sin(a),
            y: dLocal.x * Math.sin(a) + dLocal.y * Math.cos(a),
          }
          x += dWorld.x - dLocal.x
          y += dWorld.y - dLocal.y
        }
        drag.moved = true

        /* A lattice-mode network has no free box — its size is computed from
           its spacing, and `refitMlp` would put back anything a drag wrote. So
           the handle drives the spacing instead: solve for the pitch that would
           have produced the size just dragged out, then place the box where
           that spacing puts it, holding the edge opposite the handle. The
           gesture still feels like a resize; what it edits is the lattice. */
        const mn = drag.kind === 'mlp' ? d.nodes.find((n) => n.id === drag.id) : undefined
        if (mn && isLattice(mn.props)) {
          const slots = mlpSlots(mn.props)
          const rows = Math.max(...slots.map((s) => s.length))
          const r = mn.props.neuronR ?? MLP_R
          const span = (px: number, count: number, fallback: number) =>
            count > 1 ? Math.max(2 * r, (px - 2 * r) / (count - 1)) : fallback
          const wanted = {
            ...mn.props,
            ...(sides.l || sides.r
              ? { layerGap: span(w, slots.length, mn.props.layerGap ?? MLP_GAP) }
              : null),
            ...(sides.t || sides.b ? { pitch: span(h, rows, mn.props.pitch ?? MLP_PITCH) } : null),
          }
          const props = d.canvas.snap
            ? { ...wanted, ...mlpSnapProps(wanted, d.canvas.grid) }
            : wanted
          const size = mlpNaturalSize(props)
          if (size) {
            const place = (lo: number, len: number, size: number, low?: boolean, high?: boolean) =>
              low ? lo + len - size : high ? lo : lo + (len - size) / 2
            live((cur) =>
              patchNodes(cur, [drag.id], () => ({
                x: Math.round(place(o.x, o.w, size.w, sides.l, sides.r)),
                y: Math.round(place(o.y, o.h, size.h, sides.t, sides.b)),
                ...size,
                props,
              })),
            )
            return
          }
        }

        live((cur) =>
          patchNodes(cur, [drag.id], () => ({
            x: Math.round(x),
            y: Math.round(y),
            w: Math.round(w),
            h: Math.round(h),
          })),
        )
        return
      }

      if (drag.t === 'rotate') {
        const a = Math.atan2(world.y - drag.center.y, world.x - drag.center.x)
        let deg = drag.origRot + ((a - drag.startAngle) * 180) / Math.PI
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15
        deg = Math.round(deg * 10) / 10
        drag.moved = true
        live((cur) => patchNodes(cur, [drag.id], () => ({ rotation: deg })))
        return
      }

      /* One side of a group's outline. The pointer is compared in the
         network's own frame, so a rotated network's grips still push the side
         they point at rather than the one the screen thinks they do. */
      if (drag.t === 'gpad') {
        const gn = docRef.current.nodes.find((n) => n.id === drag.id)
        if (!gn) return
        const loc = mlpToLocal(gn, world)
        const dx = loc.x - drag.start.x
        const dy = loc.y - drag.start.y
        const c = docRef.current.canvas
        const step = c.snap ? c.grid / 2 : 0
        const put = (v: number) =>
          Math.max(0, Math.min(GROUP_PAD_MAX, step ? Math.round(v / step) * step : Math.round(v)))
        const [t0, r0, b0, l0] = drag.orig
        const h = drag.handle
        const pad: [number, number, number, number] = [
          h.includes('n') ? put(t0 - dy) : t0,
          h.includes('e') ? put(r0 + dx) : r0,
          h.includes('s') ? put(b0 + dy) : b0,
          h.includes('w') ? put(l0 - dx) : l0,
        ]
        drag.moved = true
        live((cur) => patchMlpPart(cur, { node: drag.id, key: drag.key }, 'groups', { pad }))
        return
      }

      /* One layer, sideways. The gap before it grows by exactly what the gap
         after it loses, so every other column stays put and the box does not
         move — except at the two ends, where there is only one gap to give:
         the run gets longer or shorter and the node's left edge has to be
         pulled along to keep the columns behind it still. */
      if (drag.t === 'layer') {
        const n = docRef.current.nodes.find((x) => x.id === drag.id)
        if (!n) return
        const c = docRef.current.canvas
        /* ⚠️ Measured against where the press landed on the *canvas*, not
           against the node's own frame. The node moves while this drag runs —
           pulling the first column out shifts the box's left edge — so a delta
           taken in local coordinates chases its own tail and the layer travels
           at half the speed of the pointer. */
        const away = { x: world.x - drag.start.x, y: world.y - drag.start.y }
        const raw = (n.rotation ? rotateDir(away, -n.rotation) : away).x
        // whole cells: that is what keeps the columns on the position lattice
        const step = c.snap && !ev.metaKey && !ev.ctrlKey ? c.grid : 1
        const floor = 2 * (n.props.neuronR ?? MLP_R)
        const before = drag.gaps[drag.li - 1]
        const after = drag.gaps[drag.li]
        // do not let either side collapse past two circles touching
        const lo = before === undefined ? -Infinity : floor - before
        const hi = after === undefined ? Infinity : after - floor
        const d = Math.max(lo, Math.min(hi, Math.round(raw / step) * step))
        if (!drag.moved && Math.abs(d) < 0.01) return
        const gaps = drag.gaps.map((g, i) =>
          i === drag.li - 1 ? g + d : i === drag.li ? g - d : g,
        )
        drag.moved = true
        live((cur) =>
          patchNodes(cur, [drag.id], (nn) => {
            const props = { ...nn.props, gaps }
            /* ⚠️ Size the box here rather than leaving it to `refitMlp`, which
               grows a network about its *centre*. That is right for a pitch
               change and wrong for this: pulling the first column out would
               then move the last one half as far backwards. Writing the size
               makes the refit a no-op, and only the first column's move
               changes where the box starts. */
            const size = mlpNaturalSize(props)
            const x = drag.li === 0 ? drag.x + d : drag.x
            return size ? { x, ...size, props } : { x, props }
          }),
        )
        return
      }

      if (drag.t === 'marquee') {
        const r = {
          x: Math.min(drag.start.x, world.x),
          y: Math.min(drag.start.y, world.y),
          w: Math.abs(world.x - drag.start.x),
          h: Math.abs(world.y - drag.start.y),
        }
        setMarquee(r)
        const hit = docRef.current.nodes
          .filter((n) => !n.hidden && !n.locked && rectsOverlap(nodeBounds(n), r))
          .map((n) => n.id)
        setSelNodes(drag.add ? [...new Set([...selNodesRef.current, ...hit])] : hit)
        return
      }

      if (drag.t === 'connect' || drag.t === 'endpoint') {
        const target = docRef.current.nodes
          .slice()
          .reverse()
          .find((n) => !n.hidden && onShape(world, n, 4))
        setTemp((t) => (t ? { ...t, b: world, target: target?.id ?? null } : t))
        return
      }

      if (drag.t === 'label') {
        const r = resolvedRef.current.get(drag.edge)
        if (!r) return
        /* Move the point the label rides on by the pointer delta and ask the
           path which t is nearest. Carrying the *anchor* rather than the
           cursor is what keeps labelDx/labelDy — the nudge off the line —
           intact: only the position along the path changes. */
        const target = {
          x: drag.base.x + (world.x - drag.start.x),
          y: drag.base.y + (world.y - drag.start.y),
        }
        /* Quantise along the path in pixels, not in hundredths of it. A fixed
           0.01 step is a tenth of a pixel on a short connector and ten pixels
           on a long one, so the label crawled smoothly on one and lurched on
           the other. One step is one pixel either way. */
        const len = Math.max(1, r.info.len)
        const t = +(Math.round(nearestT(r.info, target) * len) / len).toFixed(4)
        drag.moved = true
        live((cur) => patchEdges(cur, [drag.edge], () => ({ labelT: t })))
        return
      }

      if (drag.t === 'segment') {
        /* Pin the run being moved, and only that run.
         *
         * ⚠️ This used to hand the *whole* corner list back as waypoints, on
         * the grounds that replaying every corner reproduces the path exactly.
         * It does — and then the figure is nailed to the page. One nudge of one
         * run froze four or five points, each tied to a node's centre, and from
         * then on the route could not respond to anything: move a block and the
         * pins came along at the wrong offsets, until a connector that used to
         * be two clean corners was a staircase wandering across the drawing.
         * Two points say everything about where a run should sit; the rest of
         * the route is the router's business, and it re-derives it. */
        const d = docRef.current
        const shift =
          drag.axis === 'x' ? world.x - drag.start.x : world.y - drag.start.y
        /* ⚠️ Nothing is written until the pointer has genuinely travelled.
         *
         * A press on a connector arms this drag, and a plain *click* still
         * delivers a pointermove or two with a delta of zero — which then went
         * through the grid snap, so the run jumped to the nearest gridline and
         * bends appeared out of nowhere. Clicking a line to select it silently
         * rerouted it. Bends are made on purpose (double-click) or by actually
         * dragging a run; never by looking at one. */
        if (!drag.moved && Math.abs(shift) * viewRef.current.zoom < DEAD_ZONE) return
        const raw = drag.axis === 'x'
          ? drag.corners[drag.index].x + shift
          : drag.corners[drag.index].y + shift
        const v = Math.round(
          d.canvas.snap && !ev.metaKey && !ev.ctrlKey ? snapPos(raw, d.canvas.grid) : raw,
        )
        const pts = drag.corners.map((c, i) =>
          i === drag.index || i === drag.index + 1
            ? drag.axis === 'x'
              ? { x: v, y: c.y }
              : { x: c.x, y: v }
            : { ...c },
        )
        drag.moved = true
        /* Tie every corner to the *same* end — the one nearest the run being
           dragged. Deciding per corner looks more precise and is worse: the two
           ends of a straight run would follow different shapes, so moving one
           of them alone would kink a lane that should have stayed straight. */
        const mid = {
          x: (pts[drag.index].x + pts[drag.index + 1].x) / 2,
          y: (pts[drag.index].y + pts[drag.index + 1].y) / 2,
        }
        /* The two ends of the moved run — minus either endpoint of the whole
           connector, which is not a bend and cannot be pinned: those belong to
           the shapes. */
        const keep = [drag.index, drag.index + 1]
          .filter((i) => i > 0 && i < pts.length - 1)
          .map((i) => pts[i])
        live((cur) =>
          patchEdges(cur, [drag.edge], (e) => {
            const rel = tieToEnd(e, mid, cur).rel
            return {
              waypoints: keep.map((p) => {
                const t = tieToEnd(e, p, cur)
                return rel && t.rel !== rel ? tieToEnd(e, p, cur, rel) : t
              }),
            }
          }),
        )
        return
      }

      if (drag.t === 'waypoint') {
        // same dead zone: clicking a bend must not snap it to the nearest cell
        const r = resolvedRef.current.get(drag.edge)
        const at = r?.wps[drag.index]
        if (
          !drag.moved &&
          at &&
          Math.hypot(world.x - at.x, world.y - at.y) * viewRef.current.zoom < DEAD_ZONE
        )
          return
        const p = { x: Math.round(gridSnap(world.x)), y: Math.round(gridSnap(world.y)) }
        drag.moved = true
        live((cur) =>
          patchEdges(cur, [drag.edge], (e) => ({
            waypoints: e.waypoints.map((w, i) => (i === drag.index ? tieToEnd(e, p, cur) : w)),
          })),
        )
        return
      }
    }

    const onUp = (ev: PointerEvent) => {
      const drag = dragRef.current
      dragRef.current = null
      setDragging(false)
      setPanning(false)
      setGuides([])
      setGaps([])
      setMarquee(null)
      if (!drag) return

      if (drag.t === 'connect') {
        const world = toWorld(ev.clientX, ev.clientY)
        const hit = connectTargetAt(world)
        const target = hit?.node
        setTemp(null)
        /* Same node twice is fine when the two ends are different units of it —
           that is how a skip connection inside one network gets drawn. */
        const sameSpot = target?.id === drag.node && hit?.part === drag.part
        if (target && !sameSpot) {
          const { doc: next, id } = connectNodes(
            docRef.current,
            drag.node,
            target.id,
            drag.anchor as never,
            'auto',
            drag.part,
            hit.part,
          )
          live(next)
          endDrag(true)
          setSelNodes([])
          setSelEdges([id])
        } else {
          endDrag(false)
        }
        return
      }

      if (drag.t === 'endpoint') {
        const world = toWorld(ev.clientX, ev.clientY)
        const hit = connectTargetAt(world)
        setTemp(null)
        live((cur) =>
          patchEdges(cur, [drag.edge], () => ({
            [drag.which]: hit
              ? { node: hit.node.id, anchor: 'auto' as const, part: hit.part }
              : { free: { x: Math.round(world.x), y: Math.round(world.y) } },
          })),
        )
        endDrag(true)
        return
      }

      /* A press on a network's insides that never turned into a drag was a
         click, and a click means "select this part". Doing it here rather than
         on the way down is what lets the same gesture still move the network:
         the synapses cross most of its box, so if grabbing one selected instead
         of moved, there would be almost nowhere left to drag from. */
      if (drag.t === 'move' && !drag.moved && drag.part) {
        setSelPart(drag.part)
        setSelEdges([])
      }

      if (drag.t === 'marquee' || drag.t === 'pan') return
      endDrag('moved' in drag ? drag.moved : false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Wheel/pinch must be a *native* non-passive listener. React registers its
     onWheel through a delegated passive listener, so preventDefault() there is
     ignored and the browser goes ahead and zooms the whole page — which is
     exactly what a trackpad pinch over the canvas used to do. */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        // a pinch arrives as many small ctrl+wheel deltas; scaling
        // exponentially keeps it smooth instead of stepping in 10% jumps
        const factor = Math.exp(-e.deltaY * 0.01)
        zoomAt(e.clientX, e.clientY, viewRef.current.zoom * factor)
      } else if (e.shiftKey) {
        setView((v) => ({ ...v, x: v.x - (e.deltaY || e.deltaX) }))
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    // Safari sends its own gesture events for pinch, on top of the wheel ones
    const stopGesture = (e: Event) => e.preventDefault()
    el.addEventListener('wheel', onWheelNative, { passive: false })
    el.addEventListener('gesturestart', stopGesture)
    el.addEventListener('gesturechange', stopGesture)
    return () => {
      el.removeEventListener('wheel', onWheelNative)
      el.removeEventListener('gesturestart', stopGesture)
      el.removeEventListener('gesturechange', stopGesture)
    }
  }, [viewRef, zoomAt])

  const onDoubleClick = (ev: React.MouseEvent) => {
    const el = ev.target as Element
    const hitNode = el.getAttribute?.('data-hit-node')
    if (hitNode) {
      /* Same rule as the press: a double-click in the space between two
         columns belongs to whatever is drawn there, not to the network. */
      const first = nmap.get(hitNode)
      const n =
        first && first.kind === 'mlp' &&
        !mlpHit(first, toWorld(ev.clientX, ev.clientY), PART_TOL / viewRef.current.zoom)
          ? pickNodeAt(toWorld(ev.clientX, ev.clientY))
          : first
      /* Inside a network the gesture is a ladder, one rung per press: select
         the network, then select the circle, then type into it. Jumping
         straight to typing on a double-click skipped a rung, so a double-click
         meant to *pick* a unit put you in a text field instead.
         ⚠️ And a network has no label of its own to edit here — opening one
         used to be the fallback, which is how an empty label kept appearing
         across the top of the drawing. */
      if (n?.kind === 'mlp') {
        const w = toWorld(ev.clientX, ev.clientY)
        const dot = mlpDotAt(n, w, 2)
        if (!dot) {
          /* A caption has nothing underneath it, so double-clicking one goes
             straight to typing — every edit on the canvas is reached by
             double-clicking the thing itself, not its parent. A group's *box*
             still climbs the ladder, because the units inside are what a press
             there usually means. */
          const named = mlpGroupLabelAt(n, w, PART_TOL / viewRef.current.zoom)
          const box = named ?? mlpGroupAt(n, w, PART_TOL / viewRef.current.zoom)
          if (!box) return
          const chosen =
            !!named || selPartsRef.current.some((p) => p.key === box && p.node === n.id)
          setSelNodes([n.id])
          setSelEdges([])
          setSelPart({ node: n.id, key: box, kind: 'group' })
          if (chosen) setEditDot({ node: n.id, key: box })
          setEditing(null)
          return
        }
        const chosen = selPartsRef.current.some((p) => p.key === dot.key && p.node === n.id)
        setSelNodes([n.id])
        setSelEdges([])
        setSelPart({ node: n.id, key: dot.key, kind: 'dot' })
        // the third rung: it was already the selection, so now it is the text
        if (chosen) setEditDot({ node: n.id, key: dot.key })
        setEditing(null)
        return
      }
      setEditing(hitNode)
      setSelNodes([hitNode])
      setSelEdges([])
      return
    }
    const hitEdge = el.getAttribute?.('data-hit-edge')
    if (hitEdge) {
      // add a waypoint where the user clicked
      const w = toWorld(ev.clientX, ev.clientY)
      const p = { x: Math.round(w.x), y: Math.round(w.y) }
      commit((d) =>
        patchEdges(d, [hitEdge], (e) => {
          // insert at the nearest segment so the path keeps its shape
          const r = resolved.get(e.id)
          /* ⚠️ Every bend on one connector follows the same shape.
           *
           * A bend is stored as an offset from the nearer end's node centre,
           * decided per bend — so a route could end up with half its bends
           * following the block at one end and half following the block at the
           * other. Move either block and those halves went different ways: the
           * ones that stayed behind were left stranded off in the margin, miles
           * from the line that was supposed to pass through them. Adopt
           * whatever the existing bends already use. */
          const rel = e.waypoints[0]?.rel
          const tied = tieToEnd(e, p, docRef.current, rel)
          if (!r) return { waypoints: [...e.waypoints, tied] }
          /* Sorting by position along the path keeps the inserted bend in the
             place it was clicked. Relative bends have to be resolved first —
             their raw x/y are offsets, not points on the canvas. */
          const abs = new Map(e.waypoints.map((w, i) => [w, r.wps[i] ?? w] as const))
          abs.set(tied, p)
          const pts = [...e.waypoints, tied]
          pts.sort((u, v) => distAlong(r, abs.get(u)!) - distAlong(r, abs.get(v)!))
          return { waypoints: pts }
        }),
      )
      setSelEdges([hitEdge])
      setSelNodes([])
      return
    }
    const wpIdx = el.getAttribute?.('data-waypoint')
    const wpEdge = el.getAttribute?.('data-edge-id')
    if (wpIdx && wpEdge) {
      commit((d) =>
        patchEdges(d, [wpEdge], (e) => ({
          waypoints: e.waypoints.filter((_, i) => i !== Number(wpIdx)),
        })),
      )
    }
  }

  /* ---- keyboard ---- */
  useEffect(() => {
    const isField = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isField(e.target)) {
        spaceRef.current = true
      }
      if (isField(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const K = e.key

      if (mod && K.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && K.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      // ⇧ variant is "copy the PNG", handled with the other export keys below.
      // Plain ⌘C is deliberately *not* handled here: preventing the default is
      // what stops the native `copy` event, and that event is the only reliable
      // way to put our own payload on the system clipboard. See the copy
      // listener below.
      if (mod && K.toLowerCase() === 'c' && !e.shiftKey) return
      if (mod && K.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSel()
        return
      }
      if (mod && K.toLowerCase() === 'a') {
        e.preventDefault()
        setSelNodes(docRef.current.nodes.filter((n) => !n.locked && !n.hidden).map((n) => n.id))
        setSelEdges([])
        return
      }
      if (mod && K.toLowerCase() === 'g') {
        e.preventDefault()
        commit((d) => (e.shiftKey ? ungroup(d, selNodesRef.current) : groupNodes(d, selNodesRef.current)))
        flash(e.shiftKey ? '그룹 해제' : '그룹으로 묶음')
        return
      }
      if (mod && (K === ']' || K === '[')) {
        e.preventDefault()
        commit((d) => reorder(d, selNodesRef.current, K === ']' ? (e.shiftKey ? 'front' : 'forward') : e.shiftKey ? 'back' : 'backward'))
        return
      }
      if (mod && (K === '=' || K === '+')) {
        e.preventDefault()
        zoomBy(1.2)
        return
      }
      if (mod && K === '-') {
        e.preventDefault()
        zoomBy(1 / 1.2)
        return
      }
      if (mod && K === '0') {
        e.preventDefault()
        fitView()
        return
      }
      if (K === 'Delete' || K === 'Backspace') {
        e.preventDefault()
        deleteSel()
        return
      }
      if (K === 'Escape') {
        setEditing(null)
        setEditDot(null)
        // step out of connector mode one stage at a time: disarm the source
        // first, leave the mode only on a second press
        if (connectFromRef.current) {
          setConnectFrom(null)
          setTemp(null)
          return
        }
        if (connectingRef.current) {
          setConnecting(false)
          return
        }
        // and out of a network the same way: the part first, the node after
        if (selPartsRef.current.length) {
          setSelPart(null)
          return
        }
        clearSel()
        return
      }
      if (!mod && K.toLowerCase() === 'c') {
        e.preventDefault()
        toggleConnect()
        return
      }
      if (!mod && K.toLowerCase() === 'l') {
        e.preventDefault()
        connectSelection()
        return
      }
      if ((K === 'Enter' || K === 'F2') && selNodesRef.current.length === 1) {
        e.preventDefault()
        setEditing(selNodesRef.current[0])
        return
      }
      if (K.startsWith('Arrow')) {
        if (!selNodesRef.current.length) return
        e.preventDefault()
        const c = docRef.current.canvas
        const step = e.shiftKey ? 10 : c.snap ? c.grid : 1
        let dx = K === 'ArrowLeft' ? -step : K === 'ArrowRight' ? step : 0
        let dy = K === 'ArrowUp' ? -step : K === 'ArrowDown' ? step : 0
        /* Land on the lattice rather than stepping blindly by the pitch, which
           carries any existing offset along forever — a node 3px off could
           never be nudged back on. A full cell per press, half cells reachable
           by dropping the node there. */
        if (c.snap && !e.shiftKey) {
          // docRef, not nmap: this listener is bound once and nmap would be
          // the map from whichever render last re-ran the effect
          const lead = docRef.current.nodes.find((n) => n.id === selNodesRef.current[0])
          if (lead) {
            const b = inkRect(lead)
            if (dx) dx = snapPos(b.x + dx, c.grid) - b.x
            if (dy) dy = snapPos(b.y + dy, c.grid) - b.y
          }
        }
        commit((d) => patchNodes(d, selNodesRef.current, (n) => ({ x: n.x + dx, y: n.y + dy })))
        return
      }
      // quick insert
      const quick: Record<string, NodeKind> = { r: 'rect', e: 'ellipse', t: 'text', b: 'cuboid', m: 'mlp', o: 'op' }
      if (!mod && quick[K.toLowerCase()]) {
        insertShape(quick[K.toLowerCase()])
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceRef.current = false
      if (!e.altKey) setMeasuring(false)
    }
    /* Alt is reported on every key event, so watching the flag rather than the
       key itself catches it however the user got there. Releasing it outside
       the window never fires a keyup, hence the blur. */
    const onAlt = (e: KeyboardEvent) => setMeasuring(e.altKey)
    const onBlur = () => setMeasuring(false)
    window.addEventListener('keydown', onAlt)
    window.addEventListener('keyup', onAlt)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onAlt)
      window.removeEventListener('keyup', onAlt)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, fitView, toggleConnect, connectSelection])

  /* ---- clipboard ----
   *
   * Order matters: our own payload first, then images, then whatever is still
   * in the in-memory buffer. Checking images first is what let a stale image
   * shadow a fresh node copy — now a node copy overwrites the system clipboard,
   * so an image only survives there if it really was copied last. */
  useEffect(() => {
    const inField = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

    const onCopy = (e: ClipboardEvent) => {
      if (inField(e.target) || !e.clipboardData) return
      if (!copySel()) return
      const clip = clipRef.current!
      e.clipboardData.setData('text/plain', encodeClip(clip))
      clipTextRef.current = encodeClip(clip)
      // only now: preventDefault on `copy` means "I wrote the data myself"
      e.preventDefault()
    }

    const onPaste = (e: ClipboardEvent) => {
      if (inField(e.target)) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      const mine = decodeClip(text)
      if (mine) {
        e.preventDefault()
        // a payload from another window restarts the cascade offset
        if (text !== clipTextRef.current) {
          clipTextRef.current = text
          clipRef.current = mine
          pasteN.current = 0
        }
        pasteClip()
        return
      }
      const files = imagesFromPaste(e.clipboardData)
      if (files.length) {
        e.preventDefault()
        void insertImages(files, viewCenterRef.current())
        return
      }
      if (pasteClip()) e.preventDefault()
    }

    window.addEventListener('copy', onCopy)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('paste', onPaste)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertImages])

  /* ---- drag & drop ---- */
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!dropping) setDropping(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    // only clear when the pointer actually left the stage, not a child
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDropping(false)
  }
  const onDrop = (e: React.DragEvent) => {
    setDropping(false)
    const files = imagesFromDrop(e.dataTransfer)
    if (!files.length) return
    e.preventDefault()
    void insertImages(files, toWorld(e.clientX, e.clientY))
  }

  /* ---- export ---- */
  const withBusy = async (run: () => Promise<void> | void) => {
    if (busy) return
    setBusy(true)
    try {
      await run()
    } catch (err) {
      flash(`내보내기 실패: ${(err as Error).message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  /* What an export covers. With "선택만" on, the selected nodes and edges —
     plus the connectors *between* two selected nodes, because a pair of blocks
     without the arrow between them is not the thing that was selected. */
  const exportOnly = () => {
    if (!onlySel) return undefined
    const nodes = new Set(selNodesRef.current)
    if (!nodes.size && !selEdgesRef.current.length) return undefined
    const d = docRef.current
    const spans = (ep: FigEdge['from']) => 'node' in ep && nodes.has(ep.node)
    const edges = d.edges
      .filter((e) => selEdgesRef.current.includes(e.id) || (spans(e.from) && spans(e.to)))
      .map((e) => e.id)
    return [...nodes, ...edges]
  }

  const framed = () => {
    const g = figRef.current
    if (!g) throw new Error('canvas not ready')
    return buildSvg(g, docRef.current, {
      ...DEFAULT_EXPORT,
      trim,
      pad: trim ? 6 : 0,
      only: exportOnly(),
    })
  }

  const exportSvg = () =>
    withBusy(() => {
      const f = framed()
      download(textBlob(f.svg, 'image/svg+xml'), 'figure.svg')
      flash('SVG로 저장했습니다')
    })

  const exportPng = () =>
    withBusy(async () => {
      const f = framed()
      const d = docRef.current
      const blob = await svgToPng(f, dpi, d.canvas.printWidthIn, d.canvas.w)
      download(blob, `figure@${dpi}dpi.png`)
      flash(`PNG ${dpi} dpi로 저장했습니다`)
    })

  const copyPng = () =>
    withBusy(async () => {
      const f = framed()
      const d = docRef.current
      const blob = await svgToPng(f, Math.min(dpi, 600), d.canvas.printWidthIn, d.canvas.w)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      flash('클립보드에 복사했습니다')
    })

  const exportTikz = () =>
    withBusy(async () => {
      // TikZ is generated from the document rather than the DOM, so the same
      // choice has to be made again here rather than reused from `framed`
      const only = exportOnly()
      const d = docRef.current
      const code = toTikz(
        only
          ? {
              ...d,
              nodes: d.nodes.filter((n) => only.includes(n.id)),
              edges: d.edges.filter((e) => only.includes(e.id)),
            }
          : d,
      )
      try {
        await navigator.clipboard.writeText(code)
        flash('TikZ 코드를 클립보드에 복사했습니다')
      } catch {
        download(textBlob(code, 'text/x-tex'), 'figure.tex')
        flash('TikZ 코드를 .tex로 저장했습니다')
      }
    })

  /* Same export keys as every other tool (⌘E / ⌘⇧C). Registered separately from
     the editing shortcuts above because those are declared before the export
     functions exist. */
  const exportKeys = useLatest({ exportPng, copyPng })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'e' && !e.shiftKey) {
        e.preventDefault()
        exportKeys.current.exportPng()
      } else if (k === 'c' && e.shiftKey) {
        e.preventDefault()
        exportKeys.current.copyPng()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exportKeys])

  /* ---- typing into a part of a network ---- */
  /* The field sits over the thing it edits wearing that thing's own text style,
     so what is on screen while you type is what will be there when you stop.
     Two kinds of text live inside a network: a unit's own label, centred in its
     circle, and a group's name, sitting above its box. */
  const dotEdit = useMemo(() => {
    if (!editDot) return null
    const n = nmap.get(editDot.node)
    if (!n) return null
    if (isGroupKey(editDot.key)) {
      const g = n.props.groups?.[editDot.key]
      const r = mlpPartRect(n, editDot.key)
      if (!g || !r) return null
      const style = mlpCapStyle(n, g.fontSize)
      // an empty name still needs a line's worth of box to type into
      const layout = layoutLabel(g.label || '​', labelFont(style))
      const cx = n.x + r.x + r.w / 2
      const top = n.y + r.y - GROUP_CAP_GAP - layout.h
      const w = Math.max(layout.w, 72)
      return {
        n,
        bag: 'groups' as const,
        text: g.label ?? '',
        style,
        color: g.textColor ?? style.textColor,
        box: {
          left: view.x + (cx - w / 2) * view.zoom,
          top: view.y + top * view.zoom,
          width: w * view.zoom,
          height: layout.h * view.zoom,
          rotation: n.rotation || undefined,
        },
      }
    }
    const d = mlpDot(n, editDot.key)
    if (!d) return null
    const bits = n.props.neurons?.[editDot.key]
    const style = neuronLabelStyle(n, d.r, bits)
    const c = { x: n.x + d.x, y: n.y + d.y }
    const p = n.rotation ? rotatePt(c, rectCenter(n), n.rotation) : c
    const fill = bits?.fill ?? n.style.fill
    return {
      n,
      bag: 'neurons' as const,
      text: bits?.label ?? '',
      style,
      color:
        bits?.textColor ??
        (n.style.textColor === 'none' ? readableOn(fill) : n.style.textColor),
      // one line, centred on the circle, as wide as the circle plus some slack
      box: {
        left: view.x + (p.x - d.r * 2) * view.zoom,
        top: view.y + (p.y - d.r * 0.75) * view.zoom,
        width: d.r * 4 * view.zoom,
        height: d.r * 1.5 * view.zoom,
        rotation: n.rotation || undefined,
      },
    }
  }, [editDot, nmap, view])

  const endDotEdit = () => {
    setEditDot(null)
    endDrag(true)
  }

  /** Step to the next drawn neuron, so a column can be labelled by keyboard. */
  const tabDot = (shift: boolean) => {
    const cur = editDot
    const n = cur ? nmap.get(cur.node) : null
    // a group has one name, not a column of them — nowhere to step to
    if (!cur || !n || isGroupKey(cur.key)) return
    const dots = mlpLattice(n).dots
    const i = dots.findIndex((x) => x.key === cur.key)
    const next = dots[(i + (shift ? -1 : 1) + dots.length) % dots.length]
    if (!next) return
    setEditDot({ node: n.id, key: next.key })
    setSelPart({ node: n.id, key: next.key, kind: 'dot' })
  }

  /* ---- label editing overlay ---- */
  /* Same bargain as typing into a neuron: the field is invisible and the figure
     shows the text. A label in LaTeX mode is a formula on the canvas, so it is
     a formula while it is being written too — the box-shaped editor that used
     to sit here showed the source instead, which meant the thing you edited and
     the thing you got were never the same picture. */
  /* The field goes exactly where the label block is, so the glyphs it draws land
     where the drawn ones were. placeLabel is the same function the renderer uses
     — asking it twice is what keeps the two in step. */
  const editNode = editing ? nmap.get(editing) : null
  const editBox = useMemo(() => {
    if (!editNode) return null
    const s = labelStyle(editNode)
    const placed = placeLabel(editNode.label ? editNode : { ...editNode, label: '​' })
    const w = Math.max(editNode.w, 40)
    // the block is placed by its alignment anchor; the field wants its left edge
    const left = placed
      ? s.align === 'center'
        ? placed.x - w / 2
        : s.align === 'right'
          ? placed.x - w
          : placed.x
      : 0
    const top = placed ? placed.y : editNode.h / 2 - editNode.style.fontSize / 2
    return {
      left: view.x + (editNode.x + left) * view.zoom,
      top: view.y + (editNode.y + top) * view.zoom,
      width: w * view.zoom,
      height: Math.max(placed?.layout.h ?? 0, editNode.style.fontSize * 1.4) * view.zoom,
      rotation: editNode.rotation || undefined,
      // rotate about the node's centre, expressed relative to the field's box
      origin: `${(editNode.w / 2 - left) * view.zoom}px ${(editNode.h / 2 - top) * view.zoom}px`,
    }
  }, [editNode, view])

  /* ---- render ---- */
  /* One checker square = one grid cell, so its corners are the points you snap
     to. A fine grid would turn the checker to mush, so below ~6px a square
     covers a whole number of cells instead — the corners still land on grid. */
  const checkerCell = doc.canvas.grid * Math.max(1, Math.ceil(6 / doc.canvas.grid))
  const pal = paletteById(doc.paletteId)
  const canvasBg =
    doc.canvas.bg === 'white' ? '#ffffff' : doc.canvas.bg === 'paper' ? '#fbfbf9' : null

  return (
    <div className="af">
      {/* ---------- toolbar ---------- */}
      <header className="af-toolbar">
        <Text variant="heading" as="h1" className="af-title">
          AI Figure Maker
        </Text>

        <div className="af-tgroup">
          {/* the same inline arrows the other toolbars use — ↶ / ↷ are missing
              from Pretendard and render as tofu */}
          <IconBtn title="실행 취소 (⌘Z)" onClick={undo} disabled={!histState.canUndo}>
            <UndoArrow />
          </IconBtn>
          <IconBtn title="다시 실행 (⇧⌘Z)" onClick={redo} disabled={!histState.canRedo}>
            <UndoArrow flip />
          </IconBtn>
          <IconBtn title="복제 (⌘D)" onClick={duplicateSel} disabled={!selNodes.length}>
            ⧉
          </IconBtn>
          <IconBtn title="삭제 (Delete)" onClick={deleteSel} disabled={!selNodes.length && !selEdges.length}>
            ✕
          </IconBtn>
        </div>

        <div className="af-tgroup">
          <IconBtn
            title="연결 모드 (C) — 시작 노드를 누르고 도착 노드를 누릅니다"
            active={connecting}
            onClick={toggleConnect}
          >
            ↗
          </IconBtn>
          <IconBtn
            title="선택한 층 전결합 (L) — 좌우로 나뉜 열끼리 모두 잇습니다"
            disabled={selNodes.length < 2}
            onClick={connectSelection}
          >
            ⁂
          </IconBtn>
        </div>

        <div className="af-tgroup">
          {(
            [
              ['left', '⇤', '왼쪽 정렬'],
              ['hcenter', '↔', '가로 가운데'],
              ['right', '⇥', '오른쪽 정렬'],
              ['top', '⤒', '위 정렬'],
              ['vcenter', '↕', '세로 가운데'],
              ['bottom', '⤓', '아래 정렬'],
            ] as [AlignMode, string, string][]
          ).map(([m, icon, title]) => (
            <IconBtn
              key={m}
              title={title}
              disabled={selNodes.length < 2}
              onClick={() => commit((d) => alignNodes(d, selNodesRef.current, m))}
            >
              {icon}
            </IconBtn>
          ))}
          <IconBtn
            title="가로 균등 분배"
            disabled={selNodes.length < 3}
            onClick={() => commit((d) => distribute(d, selNodesRef.current, 'x'))}
          >
            ⇹
          </IconBtn>
          <IconBtn
            title="세로 균등 분배"
            disabled={selNodes.length < 3}
            onClick={() => commit((d) => distribute(d, selNodesRef.current, 'y'))}
          >
            ⇳
          </IconBtn>
          <IconBtn
            title="크기 맞추기"
            disabled={selNodes.length < 2}
            onClick={() => commit((d) => equalize(d, selNodesRef.current, 'both'))}
          >
            ▭
          </IconBtn>
        </div>

        <div className="af-tgroup">
          {(
            [
              ['front', '⤒', '맨 앞으로'],
              ['forward', '↑', '앞으로'],
              ['backward', '↓', '뒤로'],
              ['back', '⤓', '맨 뒤로'],
            ] as [ZMode, string, string][]
          ).map(([m, icon, title]) => (
            <IconBtn
              key={m}
              title={title}
              disabled={!selNodes.length}
              onClick={() => commit((d) => reorder(d, selNodesRef.current, m))}
            >
              {icon}
            </IconBtn>
          ))}
          <IconBtn
            title="그룹 (⌘G)"
            disabled={selNodes.length < 2}
            onClick={() => commit((d) => groupNodes(d, selNodesRef.current))}
          >
            ⬚
          </IconBtn>
          <IconBtn
            title="그룹 해제 (⇧⌘G)"
            disabled={!selNodes.length}
            onClick={() => commit((d) => ungroup(d, selNodesRef.current))}
          >
            ⬛
          </IconBtn>
        </div>

        <div className="af-tgroup af-swatches" title="선택 요소에 팔레트 색 적용">
          {pal.colors.map((c) => (
            <button
              key={c}
              type="button"
              className="af-swatch"
              style={{ background: c }}
              title={c}
              onClick={() => applyAccent(c)}
            />
          ))}
          <button
            type="button"
            className="af-swatch af-swatch--plain"
            title="무채색 (흰 배경 + 먹선)"
            onClick={() => {
              if (paintPart({ fill: '#ffffff', stroke: pal.ink }, { stroke: pal.ink })) return
              if (!selNodesRef.current.length) return flash('먼저 요소를 선택하세요')
              commit((d) => patchNodeStyle(d, selNodesRef.current, { fill: '#ffffff', stroke: pal.ink }))
            }}
          />
        </div>

        <span className="af-spacer" />

        <div className="af-tgroup">
          <IconBtn title="축소 (⌘−)" onClick={() => zoomBy(1 / 1.2)}>
            −
          </IconBtn>
          <span className="af-zoom">{Math.round(view.zoom * 100)}%</span>
          <IconBtn title="확대 (⌘+)" onClick={() => zoomBy(1.2)}>
            ＋
          </IconBtn>
          <IconBtn title="화면에 맞춤 (⌘0)" onClick={() => fitView()}>
            ⤢
          </IconBtn>
          <IconBtn title="100%" onClick={() => setView((v) => ({ ...v, zoom: 1 }))}>
            1:1
          </IconBtn>
        </div>

        {/* opening and saving the project live in the sidebar, the same place
            for every tool; this group is the figure-specific output only */}
        <div className="af-tgroup af-export">
          {/* the same colours as every other tool's export row: orange for the
              vector/source path, green for PNG, cyan for the clipboard */}
          <Button
            variant="warning"
            size="sm"
            title="벡터 SVG로 저장 (⌘⇧E) — 물리 크기를 mm로 기록해 단 폭에 정확히 맞습니다"
            onClick={exportSvg}
            disabled={busy}
          >
            SVG
          </Button>
          <Button
            variant="warning"
            size="sm"
            title="TikZ 코드를 클립보드로 — 근사 변환입니다"
            onClick={exportTikz}
            disabled={busy}
          >
            TikZ
          </Button>
          <Num value={dpi} min={72} max={2400} step={100} onChange={setDpi} suffix="dpi" width={54} />
          <Button
            variant="success"
            size="sm"
            title="PNG로 저장 (⌘E)"
            onClick={exportPng}
            disabled={busy}
          >
            PNG 저장
          </Button>
          <Button
            variant="info"
            size="sm"
            title="클립보드로 복사 (⌘⇧C)"
            onClick={copyPng}
            disabled={busy}
          >
            복사
          </Button>
          <label
            className="af-chk af-chk--tool"
            title={
              selNodes.length || selEdges.length
                ? '고른 것만 내보냅니다 — 두 도형 사이의 연결선은 함께 갑니다'
                : '먼저 도형을 고르세요'
            }
          >
            <input
              type="checkbox"
              checked={onlySel}
              disabled={!selNodes.length && !selEdges.length}
              onChange={(e) => setOnlySel(e.target.checked)}
            />
            <span>선택만</span>
          </label>
          <label className="af-chk af-chk--tool">
            <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
            <span>여백 자르기</span>
          </label>
        </div>
      </header>

      <div className="af-body">
        {/* ---------- left rail ---------- */}
        <aside className={`af-rail${railOpen ? '' : ' is-collapsed'}`}>
          <button
            type="button"
            className="af-fold"
            onClick={() => setRailOpen((v) => !v)}
            aria-expanded={railOpen}
            title={railOpen ? '도형 패널 접기' : '도형 패널 펼치기'}
          >
            {railOpen ? '«' : '»'}
          </button>
          <Seg
            value={rail}
            options={[
              { key: 'shapes', label: '도형' },
              { key: 'templates', label: '템플릿' },
              { key: 'layers', label: '레이어' },
            ]}
            onChange={setRail}
          />
          <div className="af-rail__body">
            {rail === 'shapes' ? <ShapeRail onInsert={insertShape} /> : null}
            {rail === 'templates' ? <TemplateRail onInsert={insertTemplate} /> : null}
            {rail === 'layers' ? (
              <LayerRail
                doc={doc}
                selected={selNodes}
                onSelect={(id, add) => selectNode(id, add)}
                onToggle={(id, key) =>
                  commit((d) => patchNodes(d, [id], (n) => ({ [key]: !n[key] }) as Partial<FigNode>))
                }
                onOrder={(id, mode) => commit((d) => reorder(d, [id], mode))}
              />
            ) : null}
          </div>
        </aside>

        {/* ---------- stage ---------- */}
        <div
          className={`af-stage${dropping ? ' is-dropping' : ''}`}
          ref={stageRef}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <svg
            ref={svgRef}
            className="af-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onHoverMove}
            onPointerEnter={() => setOverCanvas(true)}
            onPointerLeave={() => {
              setHover(null)
              setOverCanvas(false)
            }}
            onDoubleClick={onDoubleClick}
            style={{ cursor: panning ? 'grabbing' : connecting ? 'crosshair' : 'default' }}
          >
            <defs>
              {/* Stands in for the checker on an opaque canvas, so it marks the
                  same thing: one dot per cell, in the middle of it. The corners
                  between the dots are the snap points. */}
              <pattern id="af-grid" width={checkerCell} height={checkerCell} patternUnits="userSpaceOnUse">
                <circle cx={checkerCell / 2} cy={checkerCell / 2} r={0.7} fill="#c9c3ab" />
              </pattern>
              {/* Faint checker so a transparent canvas does not read as white
                  paper — and, since one square is one grid cell, it doubles as
                  the grid itself. It used to be a hardcoded 7px square against
                  an 8px grid: two lattices that could never agree, so the
                  background said one thing and snapping did another. */}
              <pattern
                id="af-alpha"
                width={checkerCell * 2}
                height={checkerCell * 2}
                patternUnits="userSpaceOnUse"
              >
                <rect width={checkerCell * 2} height={checkerCell * 2} fill="#ffffff" />
                <rect width={checkerCell} height={checkerCell} fill="#f7f7f4" />
                <rect
                  x={checkerCell}
                  y={checkerCell}
                  width={checkerCell}
                  height={checkerCell}
                  fill="#f7f7f4"
                />
                {/* One dot per square, in the middle of it — the squares' own
                    corners are the snap points, so a dot there only smudged the
                    line it was sitting on.
                    ⚠️ Baking these into the checker made the "점 표시" checkbox
                    dead on a transparent canvas: the box was off and the dots
                    were still there, because they were part of the background
                    rather than the grid layer. */}
                {doc.canvas.showGrid ? [
                  [0.5, 0.5],
                  [1.5, 0.5],
                  [0.5, 1.5],
                  [1.5, 1.5],
                ].map(([u, v]) => (
                  <circle
                    key={`${u}-${v}`}
                    cx={checkerCell * u}
                    cy={checkerCell * v}
                    r={0.7}
                    fill="#dedbcd"
                  />
                )) : null}
              </pattern>
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
              {/* canvas frame */}
              <rect
                x={0}
                y={0}
                width={doc.canvas.w}
                height={doc.canvas.h}
                fill={canvasBg ?? 'url(#af-alpha)'}
                stroke="#c9c3ab"
                strokeWidth={1 / view.zoom}
              />
              {/* Only where the checker is not already showing the same cells —
                  drawing both put a second dot lattice on top of the first. */}
              {doc.canvas.showGrid && canvasBg ? (
                <rect x={0} y={0} width={doc.canvas.w} height={doc.canvas.h} fill="url(#af-grid)" />
              ) : null}

              {/* ---- the figure itself: this exact node is what gets exported ---- */}
              <g ref={figRef} className="af-figure" pointerEvents="none">
                {doc.edges.map((e) => {
                  const r = resolved.get(e.id)
                  return r ? <EdgeView key={e.id} e={e} r={r} rev={mathRev} /> : null
                })}
                {doc.nodes.map((n) => (
                  <NodeView
                    key={n.id}
                    n={n}
                    rev={mathRev}
                    editing={
                      editing === n.id ? '' : editDot?.node === n.id ? editDot.key : undefined
                    }
                  />
                ))}
              </g>

              {/* ---- hit layer (editor only) ---- */}
              <g className="af-hits">
                {doc.edges.map((e) => {
                  const r = resolved.get(e.id)
                  if (!r || e.hidden || e.locked) return null
                  return (
                    <path
                      key={e.id}
                      d={r.info.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={Math.max(10, e.style.strokeWidth + 8) / view.zoom}
                      data-hit-edge={e.id}
                      style={{ cursor: 'pointer' }}
                    />
                  )
                })}
                {doc.nodes.map((n) => {
                  if (n.hidden) return null
                  const o = shapeOverflow(n)
                  /* A shape with no fill is grabbed by its edge, not its empty
                     middle — see pointOnNode. A transparent fill here would put
                     a solid sheet over everything a group frame contains. */
                  const outline = hitsByOutline(n)
                  const b = outline ? inkRect(n) : null
                  return (
                    <rect
                      key={n.id}
                      x={b ? b.x : n.x - o.l}
                      y={b ? b.y : n.y - o.t}
                      width={b ? b.w : n.w + o.l + o.r}
                      height={b ? b.h : n.h + o.t + o.b}
                      transform={n.rotation ? `rotate(${n.rotation} ${n.x + n.w / 2} ${n.y + n.h / 2})` : undefined}
                      fill={outline ? 'none' : 'transparent'}
                      stroke={outline ? 'transparent' : undefined}
                      strokeWidth={outline ? Math.max(12, n.style.strokeWidth + 8) / view.zoom : undefined}
                      data-hit-node={n.id}
                      style={{ cursor: connecting ? 'crosshair' : n.locked ? 'default' : 'move' }}
                    />
                  )
                })}
                {/* Last, so a label stays grabbable where it overlaps a node —
                    it is drawn on top, and a hit layer that disagreed with the
                    paint order would give you the box under the text. */}
                {doc.edges.map((e) => {
                  const r = resolved.get(e.id)
                  const b = r ? edgeLabelBox(e, r) : null
                  if (!b || e.locked) return null
                  return (
                    <rect
                      key={`l-${e.id}`}
                      x={b.x - 2}
                      y={b.y - 2}
                      width={b.w + 4}
                      height={b.h + 4}
                      fill="transparent"
                      data-hit-label={e.id}
                      style={{ cursor: connecting ? 'crosshair' : 'grab' }}
                    />
                  )
                })}
              </g>

              <Overlay
                zoom={view.zoom}
                /* A focused neuron is the selection, so the network's own
                   outline, resize grips and rotate knob come off. Leaving them
                   up says two things are selected at once, and puts handles
                   that resize the whole lattice around a single circle. */
                nodes={activeParts ? [] : selectedNodeObjs}
                selBox={activeParts ? null : selBox}
                edges={selectedEdgeObjs
                  .map((e) => ({ e, r: resolved.get(e.id) }))
                  .filter((x): x is { e: FigEdge; r: ResolvedEdge } => !!x.r)}
                hoverNode={hoverNode && !hoverNode.locked && !activeParts ? hoverNode : null}
                guides={guides}
                gaps={gaps}
                measures={probe?.measures ?? []}
                aligns={probe?.aligns ?? []}
                marquee={marquee}
                tempEdge={temp ? { a: temp.a, b: temp.b } : null}
                connectTarget={temp?.target ? nodeBounds(nmap.get(temp.target)!) : null}
                partMarks={partMarks}
                partAnchors={partAnchors}
                partGrips={partGrips}
                dragging={dragging}
              />
            </g>
          </svg>

          {editBox && editNode ? (
            <LabelEditor
              value={editNode.label}
              text={labelStyle(editNode)}
              color={
                editNode.style.textColor === 'none'
                  ? readableOn(editNode.style.fill)
                  : editNode.style.textColor
              }
              zoom={view.zoom}
              box={editBox}
              multiline
              onChange={(label) => live((d) => patchNodes(d, [editNode.id], () => ({ label })))}
              onStart={() => beginDrag()}
              onDone={() => {
                setEditing(null)
                endDrag(true)
              }}
            />
          ) : null}

          {dotEdit ? (
            <LabelEditor
              value={dotEdit.text}
              text={dotEdit.style}
              color={dotEdit.color}
              zoom={view.zoom}
              box={dotEdit.box}
              multiline={false}
              onChange={(label) =>
                live((d) => patchMlpPart(d, editDot!, dotEdit.bag, { label }))
              }
              onStart={() => beginDrag()}
              onDone={endDotEdit}
              /* Tab walks the column — labelling a layer is the reason anyone
                 types in these, and reaching for the mouse between every unit
                 makes it a chore. */
              onTab={tabDot}
            />
          ) : null}

          {dropping ? (
            <div className="af-drop">
              <span>이미지를 놓으면 그 자리에 들어갑니다</span>
            </div>
          ) : null}

        </div>

        {/* ---------- right panel ---------- */}
        <aside className={`af-panel${panelOpen ? '' : ' is-collapsed'}`}>
          <button
            type="button"
            className="af-fold"
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
            title={panelOpen ? '속성 패널 접기' : '속성 패널 펼치기'}
          >
            {panelOpen ? '»' : '«'}
          </button>
          <Inspector
            doc={doc}
            nodes={selectedNodeObjs}
            edges={selectedEdgeObjs}
            onNode={patchSelNodes}
            onStyle={patchSelStyle}
            onProps={patchSelProps}
            onEdge={patchSelEdges}
            onEdgeStyle={patchSelEdgeStyle}
            onCanvas={patchCanvas}
            onPalette={(id) => commit((d) => applyPalette(d, id))}
            parts={activeParts}
            onPart={patchPart}
            onGroup={groupParts}
            onUngroup={ungroupParts}
            onExitPart={() => {
              setSelPart(null)
              setEditDot(null)
            }}
          />
        </aside>
      </div>

      {/* the status line is the other tools' hint bar, with live canvas numbers
          in it — a bar under the body rather than an overlay, so this tool ends
          the same way every other one does */}
      <div className="af-statusbar">
        <span>
          {doc.canvas.w} × {doc.canvas.h} px · {doc.canvas.printWidthIn.toFixed(2)}″ 폭 · 본문{' '}
          {ptOf(doc.canvas.baseFont, doc.canvas).toFixed(1)} pt
        </span>
        <span className="af-status-hint">
          {connecting
            ? connectFrom
              ? '도착 노드를 클릭하세요 · 시작점은 그대로 남아 연속 연결됩니다 · Esc 취소'
              : '연결 모드 — 시작 노드를 클릭하세요 · Esc로 나가기'
            : '드래그 이동 · C 연결 모드 · 여러 층 선택 후 L 전결합 · 더블클릭 편집 · 직각 연결선은 구간을 끌어 옮김 · ⌥ 누르면 캔버스 여백, 다른 도형에 올리면 그 도형까지의 거리 · 이미지는 끌어다 놓거나 ⌘V'}
        </span>
      </div>

      {toast ? <div className="af-toast">{toast}</div> : null}
    </div>
  )
}

/* ---------- rails ---------- */

function ShapeRail({ onInsert }: { onInsert: (k: NodeKind) => void }) {
  const groups = new Map<string, typeof SHAPES>()
  for (const s of SHAPES) {
    if (!groups.has(s.group)) groups.set(s.group, [])
    groups.get(s.group)!.push(s)
  }
  return (
    <>
      {[...groups.entries()].map(([g, items]) => (
        <section key={g} className="af-rail__sec">
          <h4>{g}</h4>
          <div className="af-shapes">
            {items.map((s) => (
              <button
                key={s.kind}
                type="button"
                className="af-shape"
                title={s.label}
                onClick={() => onInsert(s.kind)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={s.icon} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
                </svg>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function TemplateRail({ onInsert }: { onInsert: (id: string) => void }) {
  const groups = new Map<string, typeof TEMPLATES>()
  for (const t of TEMPLATES) {
    if (!groups.has(t.group)) groups.set(t.group, [])
    groups.get(t.group)!.push(t)
  }
  return (
    <>
      {[...groups.entries()].map(([g, items]) => (
        <section key={g} className="af-rail__sec">
          <h4>{g}</h4>
          <div className="af-templates">
            {items.map((t) => (
              <button key={t.id} type="button" className="af-template" onClick={() => onInsert(t.id)}>
                <b>{t.label}</b>
                <span>{t.note}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

/* The stacking order, top of the list = front of the drawing.
 *
 * ⚠️ The list is `doc.nodes` reversed, so "up" in the panel is *forward* in the
 * document — the one place where the two directions are opposites, and reading
 * them the same way is how a raise button ends up burying the thing it moved. */
function LayerRail({
  doc,
  selected,
  onSelect,
  onToggle,
  onOrder,
}: {
  doc: FigDoc
  selected: string[]
  onSelect: (id: string, additive: boolean) => void
  onToggle: (id: string, key: 'hidden' | 'locked') => void
  onOrder: (id: string, mode: 'front' | 'forward' | 'backward' | 'back') => void
}) {
  const rows = [...doc.nodes].reverse()
  const last = rows.length - 1
  return (
    <div className="af-layers">
      {rows.map((n, i) => (
        <div key={n.id} className={`af-layer${selected.includes(n.id) ? ' is-on' : ''}`}>
          <button
            type="button"
            className="af-layer__name"
            onClick={(e) => onSelect(n.id, e.shiftKey)}
            title={n.label || n.kind}
          >
            <i className="af-layer__kind">{shapeSpec(n.kind).label}</i>
            <span>{n.name || stripMath(n.label) || '(무제)'}</span>
          </button>
          <span className="af-layer__ord">
            {/* shift = all the way, so four actions fit in two buttons */}
            <button
              type="button"
              className="af-layer__t"
              title="위로 (Shift: 맨 위로)"
              disabled={i === 0}
              onClick={(e) => onOrder(n.id, e.shiftKey ? 'front' : 'forward')}
            >
              {'↑'}
            </button>
            <button
              type="button"
              className="af-layer__t"
              title="아래로 (Shift: 맨 아래로)"
              disabled={i === last}
              onClick={(e) => onOrder(n.id, e.shiftKey ? 'back' : 'backward')}
            >
              {'↓'}
            </button>
          </span>
          <button
            type="button"
            className="af-layer__t"
            title={n.hidden ? '표시' : '숨김'}
            onClick={() => onToggle(n.id, 'hidden')}
          >
            {n.hidden ? '◌' : '◉'}
          </button>
          <button
            type="button"
            className="af-layer__t"
            title={n.locked ? '잠금 해제' : '잠금'}
            onClick={() => onToggle(n.id, 'locked')}
          >
            {n.locked ? '🔒' : '🔓'}
          </button>
        </div>
      ))}
      {!rows.length ? <p className="af-empty">아직 요소가 없습니다.</p> : null}
    </div>
  )
}

const stripMath = (s: string) => s.replace(/\$+/g, '').replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '').trim()

/* Distance of a point along a resolved path, used to keep inserted waypoints
   in the order the line actually travels. */
function distAlong(r: ResolvedEdge, p: Pt) {
  let best = Infinity
  let bestAt = 0
  let acc = 0
  const pts = r.info.pts
  for (let i = 1; i < pts.length; i++) {
    const d = distToPath(p, [pts[i - 1], pts[i]])
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (d < best) {
      best = d
      bestAt = acc
    }
    acc += seg
  }
  return bestAt
}
