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
  useReducer,
  useRef,
  useState,
} from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import './AiFigureMaker.css'

import type {
  CanvasCfg,
  FigDoc,
  FigEdge,
  FigNode,
  NodeKind,
  Pt,
  Rect,
  Style,
  View,
} from './aifig/types'
import { SHAPES, makeNode, paletteById, shapeSpec, tint } from './aifig/presets'
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
  group as groupNodes,
  loadDoc,
  nodeMap,
  normalizeDoc,
  patchEdgeStyle,
  patchEdges,
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
  distToPath,
  nodeBounds,
  pointInNode,
  rectCenter,
  rectsOverlap,
  rotatePt,
  snapGuides,
  unionRect,
  type Guide,
} from './aifig/geometry'
import { NodeView } from './aifig/shapes'
import { ptOf, shapeOverflow } from './aifig/layout'
import { EdgeView } from './aifig/edges'
import { resolveEdge, type ResolvedEdge } from './aifig/resolve'
import { ensureMathJax, onMathReady } from './aifig/latex'
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
import Overlay from './aifig/Overlay'
import type { HandleKey } from './aifig/handles'
import { IconBtn, Num, Seg } from './aifig/ui'

/* ---------- drag state ---------- */

type Drag =
  | {
      t: 'move'
      ids: string[]
      start: Pt
      orig: Map<string, Pt>
      box: Rect
      moved: boolean
    }
  | {
      t: 'resize'
      id: string
      handle: HandleKey
      orig: Rect
      rotation: number
      start: Pt
      moved: boolean
    }
  | { t: 'rotate'; id: string; center: Pt; startAngle: number; origRot: number; moved: boolean }
  | { t: 'marquee'; start: Pt; add: boolean }
  | { t: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { t: 'connect'; node: string; anchor: string; from: Pt }
  | { t: 'endpoint'; edge: string; which: 'from' | 'to' }
  | { t: 'waypoint'; edge: string; index: number; moved: boolean }
  | null

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
      waypoints: e.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    }))
  }
  return doc
}

export default function AiFigureMaker() {
  const [doc, setDocState] = useState<FigDoc>(() => loadDoc() ?? starterDoc())
  const [selNodes, setSelNodes] = useState<string[]>([])
  const [selEdges, setSelEdges] = useState<string[]>([])
  const [view, setView] = useState<View>({ x: 60, y: 48, zoom: 1 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [temp, setTemp] = useState<{ a: Pt; b: Pt; target: string | null } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [rail, setRail] = useState<'shapes' | 'templates' | 'layers'>('shapes')
  const [dpi, setDpi] = useState(600)
  const [trim, setTrim] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [, bump] = useReducer((x: number) => x + 1, 0)

  const svgRef = useRef<SVGSVGElement>(null)
  const figRef = useRef<SVGGElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag>(null)
  const spaceRef = useRef(false)
  const clipRef = useRef<{ nodes: FigNode[]; edges: FigEdge[] } | null>(null)
  const pasteN = useRef(0)

  const docRef = useRef(doc)
  docRef.current = doc
  const viewRef = useRef(view)
  viewRef.current = view
  const selNodesRef = useRef(selNodes)
  selNodesRef.current = selNodes
  const selEdgesRef = useRef(selEdges)
  selEdgesRef.current = selEdges

  /* ---- MathJax: re-render once the glyphs are available.
     mathRev is threaded into the memoised node/edge views because their props
     do not change when the formula cache fills in. ---- */
  const [mathRev, setMathRev] = useState(0)
  useEffect(() => {
    let alive = true
    const bumpRev = () => {
      if (alive) setMathRev((r) => r + 1)
    }
    void ensureMathJax().then(bumpRev)
    const off = onMathReady(bumpRev)
    return () => {
      alive = false
      off()
    }
  }, [])

  /* ---- history ---- */
  const hist = useRef<{ past: FigDoc[]; future: FigDoc[] }>({ past: [], future: [] })
  const pending = useRef<FigDoc | null>(null)

  const pushPast = (d: FigDoc) => {
    hist.current.past.push(d)
    if (hist.current.past.length > 120) hist.current.past.shift()
    hist.current.future = []
  }
  /** Change the document and open a new undo step. */
  const commit = useCallback((next: FigDoc | ((d: FigDoc) => FigDoc)) => {
    const cur = docRef.current
    const value = typeof next === 'function' ? next(cur) : next
    if (value === cur) return
    pushPast(cur)
    docRef.current = value
    setDocState(value)
  }, [])
  /** Change the document without touching history (drag frames). */
  const live = useCallback((next: FigDoc | ((d: FigDoc) => FigDoc)) => {
    const cur = docRef.current
    const value = typeof next === 'function' ? next(cur) : next
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
    bump()
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
  }, [])
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  const flash = (m: string) => {
    setToast(m)
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 1800)
  }

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

  const selectedNodeObjs = useMemo(
    () => doc.nodes.filter((n) => selNodes.includes(n.id)),
    [doc.nodes, selNodes],
  )
  const selectedEdgeObjs = useMemo(
    () => doc.edges.filter((e) => selEdges.includes(e.id)),
    [doc.edges, selEdges],
  )
  const selBox = useMemo(() => selectionBounds(doc, selNodes), [doc, selNodes])
  const hoverNode = hoverId && !dragging ? (nmap.get(hoverId) ?? null) : null

  /* ---- coordinate helpers ---- */
  const toWorld = useCallback((clientX: number, clientY: number): Pt => {
    const rect = svgRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom }
  }, [])

  const zoomAt = (clientX: number, clientY: number, next: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const v = viewRef.current
    const z = clampZoom(next)
    const cx = clientX - rect.left
    const cy = clientY - rect.top
    const wx = (cx - v.x) / v.zoom
    const wy = (cy - v.y) / v.zoom
    setView({ x: cx - wx * z, y: cy - wy * z, zoom: z })
  }

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
  const applyAccent = (hex: string) => {
    if (selNodesRef.current.length)
      commit((d) => patchNodeStyle(d, selNodesRef.current, { stroke: hex, fill: tint(hex, 0.84) }))
    if (selEdgesRef.current.length)
      commit((d) => patchEdgeStyle(d, selEdgesRef.current, { stroke: hex, textColor: hex }))
    if (!selNodesRef.current.length && !selEdgesRef.current.length) flash('먼저 요소를 선택하세요')
  }

  /* ---- insertion ---- */
  /** viewCenter is used by handlers registered before it is declared */
  const viewCenterRef = useRef<() => Pt>(() => ({ x: 0, y: 0 }))
  const viewCenter = (): Pt => {
    const el = stageRef.current
    const v = viewRef.current
    if (!el) return { x: doc.canvas.w / 2, y: doc.canvas.h / 2 }
    return { x: (el.clientWidth / 2 - v.x) / v.zoom, y: (el.clientHeight / 2 - v.y) / v.zoom }
  }
  viewCenterRef.current = viewCenter

  const insertShape = (kind: NodeKind) => {
    const c = viewCenter()
    const { doc: next, id } = addNodeAt(docRef.current, kind, c)
    commit(next)
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
    [commit],
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
      waypoints: e.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    }))
    commit({ ...d, nodes: [...d.nodes, ...nodes], edges: [...d.edges, ...edges] })
    setSelEdges([])
    setSelNodes(nodes.map((n) => n.id))
    flash(`${tpl.label} 삽입`)
  }

  /* ---- clipboard ---- */
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
    if (!selNodesRef.current.length && !selEdgesRef.current.length) return
    commit((d) => removeItems(d, selNodesRef.current, selEdgesRef.current))
    clearSel()
  }

  /* ---- pointer interaction ---- */

  const gridSnap = (v: number) => {
    const c = docRef.current.canvas
    return c.snap ? Math.round(v / c.grid) * c.grid : v
  }

  const onPointerDown = (ev: React.PointerEvent) => {
    if (ev.button === 1 || spaceRef.current || ev.altKey) {
      dragRef.current = { t: 'pan', sx: ev.clientX, sy: ev.clientY, ox: view.x, oy: view.y }
      setDragging(true)
      return
    }
    if (ev.button !== 0) return
    const el = ev.target as Element
    const world = toWorld(ev.clientX, ev.clientY)
    const d = docRef.current

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
            handle: handle as HandleKey,
            orig: { x: n.x, y: n.y, w: n.w, h: n.h },
            rotation: n.rotation,
            start: world,
            moved: false,
          }
        }
        return
      }
    }

    // 2) start a connection from an anchor dot
    const anchorNode = el.getAttribute?.('data-anchor-node')
    if (anchorNode) {
      const a = el.getAttribute('data-anchor') ?? 'auto'
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
        const from = { x: n.x + n.w * u.x, y: n.y + n.h * u.y }
        dragRef.current = { t: 'connect', node: n.id, anchor: a, from }
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

    // 4) node hit
    const hitNode = el.getAttribute?.('data-hit-node')
    if (hitNode) {
      const n = nmap.get(hitNode)
      if (n && !n.locked) {
        const already = selNodesRef.current.includes(hitNode)
        let ids = already ? selNodesRef.current : expandGroups(d, [hitNode])
        if (ev.shiftKey) {
          ids = already
            ? selNodesRef.current.filter((i) => i !== hitNode)
            : [...new Set([...selNodesRef.current, ...expandGroups(d, [hitNode])])]
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
        const box = unionRect([...orig.keys()].map((id) => nodeBounds(nmap.get(id)!)))
        if (!box) return
        beginDrag()
        setDragging(true)
        dragRef.current = { t: 'move', ids: [...orig.keys()], start: world, orig, box, moved: false }
        return
      }
    }

    // 5) edge hit
    const hitEdge = el.getAttribute?.('data-hit-edge')
    if (hitEdge) {
      selectEdge(hitEdge, ev.shiftKey)
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
      if (!drag) return
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
        if (d.canvas.snap) {
          const first = drag.orig.get(drag.ids[0])!
          dx = Math.round((first.x + dx) / d.canvas.grid) * d.canvas.grid - first.x
          dy = Math.round((first.y + dy) / d.canvas.grid) * d.canvas.grid - first.y
        }
        // smart guides against the unselected nodes
        const moving = { x: drag.box.x + dx, y: drag.box.y + dy, w: drag.box.w, h: drag.box.h }
        const others = d.nodes
          .filter((n) => !drag.ids.includes(n.id) && !n.hidden)
          .map(nodeBounds)
        const snap = ev.metaKey || ev.ctrlKey
          ? { dx: 0, dy: 0, guides: [] as Guide[] }
          : snapGuides(moving, others, 5 / viewRef.current.zoom)
        dx += snap.dx
        dy += snap.dy
        setGuides(snap.guides)
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
        let dx = local.x - start.x
        let dy = local.y - start.y
        const d = docRef.current
        if (d.canvas.snap && !ev.metaKey && !ev.ctrlKey) {
          dx = Math.round(dx / d.canvas.grid) * d.canvas.grid
          dy = Math.round(dy / d.canvas.grid) * d.canvas.grid
        }
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
          .find((n) => !n.hidden && pointInNode(world, n, 4))
        setTemp((t) => (t ? { ...t, b: world, target: target?.id ?? null } : t))
        return
      }

      if (drag.t === 'waypoint') {
        const p = { x: Math.round(gridSnap(world.x)), y: Math.round(gridSnap(world.y)) }
        drag.moved = true
        live((cur) =>
          patchEdges(cur, [drag.edge], (e) => ({
            waypoints: e.waypoints.map((w, i) => (i === drag.index ? p : w)),
          })),
        )
        return
      }
    }

    const onUp = (ev: PointerEvent) => {
      const drag = dragRef.current
      dragRef.current = null
      setDragging(false)
      setGuides([])
      setMarquee(null)
      if (!drag) return

      if (drag.t === 'connect') {
        const world = toWorld(ev.clientX, ev.clientY)
        const target = docRef.current.nodes
          .slice()
          .reverse()
          .find((n) => !n.hidden && pointInNode(world, n, 4))
        setTemp(null)
        if (target && target.id !== drag.node) {
          const { doc: next, id } = connectNodes(
            docRef.current,
            drag.node,
            target.id,
            drag.anchor as never,
            'auto',
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
        const target = docRef.current.nodes
          .slice()
          .reverse()
          .find((n) => !n.hidden && pointInNode(world, n, 4))
        setTemp(null)
        live((cur) =>
          patchEdges(cur, [drag.edge], () => ({
            [drag.which]: target
              ? { node: target.id, anchor: 'auto' as const }
              : { free: { x: Math.round(world.x), y: Math.round(world.y) } },
          })),
        )
        endDrag(true)
        return
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDoubleClick = (ev: React.MouseEvent) => {
    const el = ev.target as Element
    const hitNode = el.getAttribute?.('data-hit-node')
    if (hitNode) {
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
          if (!r) return { waypoints: [...e.waypoints, p] }
          const pts = [...e.waypoints, p]
          pts.sort((a, b) => distAlong(r, a) - distAlong(r, b))
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
        e.shiftKey ? redo() : undo()
        return
      }
      if (mod && K.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod && K.toLowerCase() === 'c') {
        if (copySel()) e.preventDefault()
        return
      }
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
        clearSel()
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
        const step = e.shiftKey ? 10 : docRef.current.canvas.snap ? docRef.current.canvas.grid : 1
        const dx = K === 'ArrowLeft' ? -step : K === 'ArrowRight' ? step : 0
        const dy = K === 'ArrowUp' ? -step : K === 'ArrowDown' ? step : 0
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
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, fitView])

  /* ---- clipboard: images beat the internal node clipboard ---- */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target
      if (
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      )
        return
      const files = imagesFromPaste(e.clipboardData)
      if (files.length) {
        e.preventDefault()
        void insertImages(files, viewCenterRef.current())
        return
      }
      if (pasteClip()) e.preventDefault()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
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

  const framed = () => {
    const g = figRef.current
    if (!g) throw new Error('canvas not ready')
    return buildSvg(g, docRef.current, { ...DEFAULT_EXPORT, trim, pad: trim ? 6 : 0 })
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

  const exportJson = () =>
    withBusy(() => {
      download(textBlob(JSON.stringify(docRef.current, null, 2), 'application/json'), 'figure.json')
      flash('프로젝트를 저장했습니다')
    })

  const exportTikz = () =>
    withBusy(async () => {
      const code = toTikz(docRef.current)
      try {
        await navigator.clipboard.writeText(code)
        flash('TikZ 코드를 클립보드에 복사했습니다')
      } catch {
        download(textBlob(code, 'text/x-tex'), 'figure.tex')
        flash('TikZ 코드를 .tex로 저장했습니다')
      }
    })

  const openJson = (file: File) => {
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const next = normalizeDoc(JSON.parse(String(rd.result)))
        if (!next) throw new Error('bad file')
        commit(next)
        clearSel()
        setTimeout(() => fitView(), 20)
        flash('프로젝트를 불러왔습니다')
      } catch {
        flash('JSON을 읽지 못했습니다')
      }
    }
    rd.readAsText(file)
  }

  /* ---- label editing overlay ---- */
  const editNode = editing ? nmap.get(editing) : null
  const editBox = editNode
    ? {
        left: view.x + editNode.x * view.zoom,
        top: view.y + editNode.y * view.zoom,
        width: Math.max(60, editNode.w * view.zoom),
        height: Math.max(28, editNode.h * view.zoom),
      }
    : null

  /* ---- render ---- */
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
          <IconBtn title="실행 취소 (⌘Z)" onClick={undo} disabled={!hist.current.past.length}>
            ↶
          </IconBtn>
          <IconBtn title="다시 실행 (⇧⌘Z)" onClick={redo} disabled={!hist.current.future.length}>
            ↷
          </IconBtn>
          <IconBtn title="복제 (⌘D)" onClick={duplicateSel} disabled={!selNodes.length}>
            ⧉
          </IconBtn>
          <IconBtn title="삭제 (Delete)" onClick={deleteSel} disabled={!selNodes.length && !selEdges.length}>
            ✕
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

        <div className="af-tgroup af-export">
          <label className="af-open">
            열기
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) openJson(f)
                e.target.value = ''
              }}
            />
          </label>
          <Button variant="secondary" size="sm" onClick={exportJson} disabled={busy}>
            .json
          </Button>
          <Button variant="primary" size="sm" onClick={exportSvg} disabled={busy}>
            SVG
          </Button>
          <Button variant="info" size="sm" onClick={exportPng} disabled={busy}>
            PNG
          </Button>
          <Num value={dpi} min={72} max={2400} step={100} onChange={setDpi} suffix="dpi" width={54} />
          <Button variant="secondary" size="sm" onClick={copyPng} disabled={busy}>
            복사
          </Button>
          <Button variant="secondary" size="sm" onClick={exportTikz} disabled={busy}>
            TikZ
          </Button>
          <label className="af-chk af-chk--tool">
            <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
            <span>여백 자르기</span>
          </label>
        </div>
      </header>

      <div className="af-body">
        {/* ---------- left rail ---------- */}
        <aside className="af-rail">
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
            onDoubleClick={onDoubleClick}
            style={{ cursor: dragging && dragRef.current?.t === 'pan' ? 'grabbing' : 'default' }}
          >
            <defs>
              <pattern id="af-grid" width={doc.canvas.grid} height={doc.canvas.grid} patternUnits="userSpaceOnUse">
                <circle cx={0.5} cy={0.5} r={0.5} fill="#b9b39a" />
              </pattern>
              {/* faint checker so a transparent canvas does not read as white paper */}
              <pattern id="af-alpha" width={14} height={14} patternUnits="userSpaceOnUse">
                <rect width={14} height={14} fill="#ffffff" />
                <rect width={7} height={7} fill="#f7f7f4" />
                <rect x={7} y={7} width={7} height={7} fill="#f7f7f4" />
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
              {doc.canvas.showGrid ? (
                <rect x={0} y={0} width={doc.canvas.w} height={doc.canvas.h} fill="url(#af-grid)" />
              ) : null}

              {/* ---- the figure itself: this exact node is what gets exported ---- */}
              <g ref={figRef} className="af-figure" pointerEvents="none">
                {doc.edges.map((e) => {
                  const r = resolved.get(e.id)
                  return r ? <EdgeView key={e.id} e={e} r={r} rev={mathRev} /> : null
                })}
                {doc.nodes.map((n) => (
                  <NodeView key={n.id} n={n} rev={mathRev} />
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
                  return (
                    <rect
                      key={n.id}
                      x={n.x - o.l}
                      y={n.y - o.t}
                      width={n.w + o.l + o.r}
                      height={n.h + o.t + o.b}
                      transform={n.rotation ? `rotate(${n.rotation} ${n.x + n.w / 2} ${n.y + n.h / 2})` : undefined}
                      fill="transparent"
                      data-hit-node={n.id}
                      onPointerEnter={() => setHoverId(n.id)}
                      onPointerLeave={() => setHoverId((h) => (h === n.id ? null : h))}
                      style={{ cursor: n.locked ? 'default' : 'move' }}
                    />
                  )
                })}
              </g>

              <Overlay
                zoom={view.zoom}
                nodes={selectedNodeObjs}
                selBox={selBox}
                edges={selectedEdgeObjs
                  .map((e) => ({ e, r: resolved.get(e.id) }))
                  .filter((x): x is { e: FigEdge; r: ResolvedEdge } => !!x.r)}
                hoverNode={hoverNode && !hoverNode.locked ? hoverNode : null}
                guides={guides}
                marquee={marquee}
                tempEdge={temp ? { a: temp.a, b: temp.b } : null}
                connectTarget={temp?.target ? nodeBounds(nmap.get(temp.target)!) : null}
                dragging={dragging}
              />
            </g>
          </svg>

          {editBox && editNode ? (
            <textarea
              className="af-edit"
              autoFocus
              style={{
                left: editBox.left,
                top: editBox.top,
                width: editBox.width,
                height: editBox.height,
                fontSize: Math.max(9, editNode.style.fontSize * view.zoom),
              }}
              value={editNode.label}
              onChange={(e) => live((d) => patchNodes(d, [editNode.id], () => ({ label: e.target.value })))}
              onBlur={() => {
                setEditing(null)
                endDrag(true)
              }}
              onFocus={() => beginDrag()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                  ;(e.target as HTMLTextAreaElement).blur()
                }
              }}
            />
          ) : null}

          {dropping ? (
            <div className="af-drop">
              <span>이미지를 놓으면 그 자리에 들어갑니다</span>
            </div>
          ) : null}

          <div className="af-statusbar">
            <span>
              {doc.canvas.w} × {doc.canvas.h} px · {doc.canvas.printWidthIn.toFixed(2)}″ 폭 · 본문{' '}
              {ptOf(doc.canvas.baseFont, doc.canvas).toFixed(1)} pt
            </span>
            <span className="af-status-hint">
              드래그 이동 · 초록 점에서 끌면 연결 · 더블클릭 편집 · 이미지는 끌어다 놓거나 ⌘V
            </span>
          </div>
        </div>

        {/* ---------- right panel ---------- */}
        <aside className="af-panel">
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
          />
        </aside>
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

function LayerRail({
  doc,
  selected,
  onSelect,
  onToggle,
}: {
  doc: FigDoc
  selected: string[]
  onSelect: (id: string, additive: boolean) => void
  onToggle: (id: string, key: 'hidden' | 'locked') => void
}) {
  const rows = [...doc.nodes].reverse()
  return (
    <div className="af-layers">
      {rows.map((n) => (
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
