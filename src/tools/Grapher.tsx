import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import {
  DIAGRAM_COLOR_HEX as COLOR_HEX,
  DIAGRAM_TEXT_ON as TEXT_ON,
  type DiagramColor,
} from '../cores/palette'
import { useLatest } from './hooks'
import UndoRedo from './UndoRedo'
import './Grapher.css'

/* ---------- model ---------- */

/* Node colors come from the cores palette, shared with the Diagram render core:
   a figure arranged here has to keep its colors when a slide renders it. */
type ColorKey = DiagramColor

const COLORS: { key: ColorKey; label: string }[] = [
  { key: 'surface', label: 'White' },
  { key: 'pink', label: 'Pink' },
  { key: 'purple', label: 'Purple' },
  { key: 'cyan', label: 'Cyan' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'orange', label: 'Orange' },
  { key: 'sky', label: 'Sky' },
  { key: 'green', label: 'Green' },
]

const BG_HEX = '#fff5d1'
const INK_HEX = '#222222'
const EXPORT_FONT =
  '700 15px "Pretendard Variable", Pretendard, system-ui, sans-serif'

interface Node {
  id: string
  x: number
  y: number
  text: string
  color: ColorKey
}

interface Edge {
  id: string
  source: string
  target: string
}

const DEFAULT_SIZE = { w: 150, h: 50 }

const uid = () => Math.random().toString(36).slice(2, 9)

/* ---------- geometry ---------- */

interface Size {
  w: number
  h: number
}

// point on a node's rectangle border in the direction of (tx, ty)
function borderPoint(n: Node, size: Size, tx: number, ty: number) {
  const cx = n.x + size.w / 2
  const cy = n.y + size.h / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const sx = dx === 0 ? Infinity : size.w / 2 / Math.abs(dx)
  const sy = dy === 0 ? Infinity : size.h / 2 / Math.abs(dy)
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}

// wrap text to a max pixel width (handles \n and long unspaced runs)
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = []
  for (const para of (text || ' ').split('\n')) {
    const words = para.split(' ')
    let line = ''
    const push = (s: string) => out.push(s)
    for (const word of words) {
      // break a single word that is too long, char by char
      let chunk = word
      while (ctx.measureText(chunk).width > maxWidth && chunk.length > 1) {
        let i = 1
        while (
          i < chunk.length &&
          ctx.measureText(chunk.slice(0, i + 1)).width <= maxWidth
        )
          i++
        if (line) {
          push(line)
          line = ''
        }
        push(chunk.slice(0, i))
        chunk = chunk.slice(i)
      }
      const candidate = line ? `${line} ${chunk}` : chunk
      if (ctx.measureText(candidate).width > maxWidth && line) {
        push(line)
        line = chunk
      } else {
        line = candidate
      }
    }
    push(line)
  }
  return out.length ? out : [' ']
}

/* ---------- pointer state (refs, no re-render) ---------- */

type Drag =
  | {
      type: 'move'
      ids: string[]
      primary: string
      offX: number
      offY: number
      starts: Record<string, { x: number; y: number }>
    }
  | { type: 'connect'; source: string }
  | { type: 'pan'; sx: number; sy: number; px: number; py: number }
  | null

interface View {
  x: number
  y: number
  zoom: number
}

const ZOOM_MIN = 0.3
const ZOOM_MAX = 2.5
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

/* ---------- persistence ---------- */

const STORAGE_KEY = 'grapher:v1'

const DEFAULT_NODES: Node[] = [
  { id: 'a', x: 220, y: 180, text: 'Start', color: 'green' },
  { id: 'b', x: 220, y: 340, text: 'Process', color: 'cyan' },
  { id: 'c', x: 470, y: 340, text: 'Decision', color: 'yellow' },
  { id: 'd', x: 345, y: 500, text: 'End', color: 'pink' },
]
const DEFAULT_EDGES: Edge[] = [
  { id: 'e1', source: 'a', target: 'b' },
  { id: 'e2', source: 'b', target: 'c' },
  { id: 'e3', source: 'c', target: 'd' },
]

interface Saved {
  nodes: Node[]
  edges: Edge[]
  view: View
  snap: boolean
  transparentBg: boolean
}

interface Snapshot {
  nodes: Node[]
  edges: Edge[]
}

const GRID = 24 // snap step (matches the background dot grid)
const snapTo = (v: number) => Math.round(v / GRID) * GRID

function loadState(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null
    return {
      nodes: data.nodes,
      edges: data.edges,
      view: data.view ?? { x: 0, y: 0, zoom: 1 },
      snap: !!data.snap,
      transparentBg: !!data.transparentBg,
    }
  } catch {
    return null
  }
}

/* ---------- PNG sRGB tagging ----------
   Browser-generated PNGs carry no color profile, so on wide-gamut (P3)
   displays some apps reinterpret the pixels and shift the colors. We splice
   in sRGB / gAMA / cHRM chunks right after IHDR so the values are read as
   sRGB exactly as drawn. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++)
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const pngChunk = (type: string, data: Uint8Array) => {
  const buf = new ArrayBuffer(12 + data.length)
  const out = new Uint8Array(buf)
  const dv = new DataView(buf)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  const typeAndData = out.subarray(4, 8 + data.length)
  dv.setUint32(8 + data.length, crc32(typeAndData))
  return out
}

const u32 = (...vals: number[]) => {
  const buf = new ArrayBuffer(vals.length * 4)
  const a = new Uint8Array(buf)
  const dv = new DataView(buf)
  vals.forEach((v, i) => dv.setUint32(i * 4, v >>> 0))
  return a
}

function tagPngSrgb(png: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  // already has a color chunk? leave it alone
  // PNG sig (8) + IHDR (length 4 + 'IHDR' 4 + 13 data + 4 crc) = ends at 33
  const ihdrEnd = 33
  if (png.length < ihdrEnd) return png
  const srgb = pngChunk('sRGB', new Uint8Array([0])) // perceptual intent
  const gama = pngChunk('gAMA', u32(45455)) // 1/2.2
  const chrm = pngChunk(
    'cHRM',
    u32(31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000), // sRGB primaries
  )
  const extra = srgb.length + gama.length + chrm.length
  const out = new Uint8Array(new ArrayBuffer(png.length + extra))
  out.set(png.subarray(0, ihdrEnd), 0)
  let off = ihdrEnd
  for (const ch of [srgb, gama, chrm]) {
    out.set(ch, off)
    off += ch.length
  }
  out.set(png.subarray(ihdrEnd), off)
  return out
}

/* ---------- app ---------- */

export default function GrapherTool() {
  // restore from localStorage once (falls back to the sample graph)
  const [boot] = useState(loadState)
  const [nodes, setNodes] = useState<Node[]>(() => boot?.nodes ?? DEFAULT_NODES)
  const [edges, setEdges] = useState<Edge[]>(() => boot?.edges ?? DEFAULT_EDGES)
  // selection: multiple nodes (Shift to add) + at most one edge
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sizes, setSizes] = useState<Record<string, Size>>({})
  // live cursor while drawing a connection
  const [tempEdge, setTempEdge] = useState<{
    source: string
    x: number
    y: number
  } | null>(null)

  const [view, setView] = useState<View>(
    () => boot?.view ?? { x: 0, y: 0, zoom: 1 },
  )
  const [toast, setToast] = useState<string | null>(null)
  const [snap, setSnap] = useState<boolean>(() => boot?.snap ?? false)
  const [transparentBg, setTransparentBg] = useState<boolean>(
    () => boot?.transparentBg ?? false,
  )
  /* The history stacks live in a ref (pushing must not re-render), but the two
     booleans the toolbar needs are mirrored into state — reading the ref during
     render would leave the buttons showing whatever the last render happened to
     observe. */
  const [histState, setHistState] = useState({ canUndo: false, canRedo: false })

  const canvasRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const dragRef = useRef<Drag>(null)

  // refs mirror latest state so handlers set up once (or async) read fresh data
  const viewRef = useLatest(view)
  const nodesRef = useLatest(nodes)
  const edgesRef = useLatest(edges)
  const snapRef = useLatest(snap)

  // internal clipboard for copy/paste of nodes (+ edges between them)
  const clipboard = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null)
  const pasteCount = useRef(0)

  /* ---- selection helpers ---- */
  const clearSelection = () => {
    setSelectedNodeIds([])
    setSelectedEdgeId(null)
  }
  const selectOnlyNode = (id: string) => {
    setSelectedNodeIds([id])
    setSelectedEdgeId(null)
  }
  const selectEdge = (id: string) => {
    setSelectedEdgeId(id)
    setSelectedNodeIds([])
  }
  const toggleNode = (id: string) => {
    setSelectedEdgeId(null)
    setSelectedNodeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  /* ---- undo / redo history (snapshots of nodes + edges) ---- */
  const history = useRef<{ past: Snapshot[]; future: Snapshot[] }>({
    past: [],
    future: [],
  })
  const pending = useRef<Snapshot | null>(null) // captured at the start of a drag
  const dirty = useRef(false) // did the current drag actually change anything?

  const snapshot = (): Snapshot => ({
    nodes: nodesRef.current,
    edges: edgesRef.current,
  })
  /** publish the stacks' emptiness to the toolbar */
  const syncHistory = () => {
    const h = history.current
    setHistState({ canUndo: h.past.length > 0, canRedo: h.future.length > 0 })
  }
  const pushPast = (snap: Snapshot) => {
    history.current.past.push(snap)
    if (history.current.past.length > 100) history.current.past.shift()
    history.current.future = []
    syncHistory()
  }
  // instantaneous actions: capture current state (= "before") then mutate
  const record = () => pushPast(snapshot())
  // drag / connect: capture before, commit only if something actually changed
  const beginAction = () => {
    pending.current = snapshot()
    dirty.current = false
  }
  const commitAction = () => {
    const before = pending.current
    pending.current = null
    if (before && dirty.current) pushPast(before)
    dirty.current = false
  }
  const restore = (snap: Snapshot) => {
    setNodes(snap.nodes)
    setEdges(snap.edges)
    clearSelection()
    setEditingId(null)
  }
  const undo = () => {
    const h = history.current
    if (!h.past.length) return
    h.future.push(snapshot())
    restore(h.past.pop()!)
    syncHistory()
  }
  const redo = () => {
    const h = history.current
    if (!h.future.length) return
    h.past.push(snapshot())
    restore(h.future.pop()!)
    syncHistory()
  }
  const { canUndo, canRedo } = histState

  const getSize = (id: string) => sizes[id] ?? DEFAULT_SIZE
  const getNode = (id: string) => nodes.find((n) => n.id === id)

  /* measure node boxes after layout (text changes size).
     When snap is on, round the width up to a grid multiple so the box's
     left AND right edges both land on the grid (left snaps via x). */
  useLayoutEffect(() => {
    setSizes((prev) => {
      let changed = false
      const next = { ...prev }
      for (const n of nodes) {
        const el = nodeRefs.current.get(n.id)
        if (!el) continue
        // measure the natural content size, ignoring any snapped width we applied
        const prevW = el.style.width
        const prevMax = el.style.maxWidth
        el.style.width = 'auto'
        el.style.maxWidth = '220px'
        const natW = el.offsetWidth
        const natH = el.offsetHeight
        el.style.width = prevW
        el.style.maxWidth = prevMax

        const w = snapRef.current ? Math.ceil(natW / GRID) * GRID : natW
        const h = natH
        if (!prev[n.id] || prev[n.id].w !== w || prev[n.id].h !== h) {
          next[n.id] = { w, h }
          changed = true
        }
      }
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, editingId, snap])

  // client coords -> world coords (undo pan + zoom)
  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return {
      x: (clientX - rect.left - v.x) / v.zoom,
      y: (clientY - rect.top - v.y) / v.zoom,
    }
  }

  // zoom keeping the given client point anchored
  const zoomAt = (clientX: number, clientY: number, nextZoom: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const v = viewRef.current
    const z = clampZoom(nextZoom)
    const cx = clientX - rect.left
    const cy = clientY - rect.top
    const wx = (cx - v.x) / v.zoom
    const wy = (cy - v.y) / v.zoom
    setView({ x: cx - wx * z, y: cy - wy * z, zoom: z })
  }

  const zoomByCenter = (factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    zoomAt(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      viewRef.current.zoom * factor,
    )
  }

  /* ---- global pointer handlers (set up once) ---- */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.type === 'pan') {
        setView((v) => ({
          ...v,
          x: drag.px + (e.clientX - drag.sx),
          y: drag.py + (e.clientY - drag.sy),
        }))
        return
      }
      const { x, y } = toWorld(e.clientX, e.clientY)
      if (drag.type === 'move') {
        // snap the primary node, shift the whole group by the same delta
        let px = x - drag.offX
        let py = y - drag.offY
        if (snapRef.current) {
          px = snapTo(px)
          py = snapTo(py)
        }
        const start = drag.starts[drag.primary]
        const dx = px - start.x
        const dy = py - start.y
        if (dx !== 0 || dy !== 0) dirty.current = true
        setNodes((ns) =>
          ns.map((n) =>
            drag.starts[n.id]
              ? { ...n, x: drag.starts[n.id].x + dx, y: drag.starts[n.id].y + dy }
              : n,
          ),
        )
      } else {
        setTempEdge({ source: drag.source, x, y })
      }
    }
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current
      dragRef.current = null
      if (drag?.type === 'connect') {
        const el = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest('[data-node-id]') as HTMLElement | null
        const targetId = el?.dataset.nodeId
        if (targetId && targetId !== drag.source) {
          const dup = edgesRef.current.some(
            (ed) => ed.source === drag.source && ed.target === targetId,
          )
          if (!dup) {
            dirty.current = true
            setEdges((es) => [
              ...es,
              { id: uid(), source: drag.source, target: targetId },
            ])
          }
        }
      }
      // commit the move/connect as one undo step (no-op if nothing changed)
      if (drag?.type === 'move' || drag?.type === 'connect') commitAction()
      setTempEdge(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- actions ---- */

  const addNode = (x?: number, y?: number) => {
    record()
    const id = uid()
    let px = x ?? 120 + nodes.length * 28
    let py = y ?? 120 + nodes.length * 28
    if (snap) {
      px = snapTo(px)
      py = snapTo(py)
    }
    setNodes((ns) => [
      ...ns,
      { id, x: px, y: py, text: 'New node', color: 'surface' },
    ])
    selectOnlyNode(id)
  }

  const deleteSelectedNodes = () => {
    if (selectedNodeIds.length === 0) return
    record()
    const ids = new Set(selectedNodeIds)
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)))
    setEdges((es) =>
      es.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
    )
    clearSelection()
    setEditingId(null)
  }

  const deleteEdge = (id: string) => {
    record()
    setEdges((es) => es.filter((e) => e.id !== id))
    setSelectedEdgeId(null)
  }

  // recolor every selected node at once
  const colorSelected = (color: ColorKey) => {
    if (selectedNodeIds.length === 0) return
    record()
    const ids = new Set(selectedNodeIds)
    setNodes((ns) =>
      ns.map((n) => (ids.has(n.id) ? { ...n, color } : n)),
    )
  }

  const updateNode = (id: string, patch: Partial<Node>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)))

  /* ---- copy / paste (internal clipboard) ---- */
  const copySelection = () => {
    const ids = new Set(selectedNodeIds)
    if (ids.size === 0) return false
    const ns = nodesRef.current.filter((n) => ids.has(n.id))
    const es = edgesRef.current.filter(
      (e) => ids.has(e.source) && ids.has(e.target),
    )
    clipboard.current = {
      nodes: ns.map((n) => ({ ...n })),
      edges: es.map((e) => ({ ...e })),
    }
    pasteCount.current = 0
    flash(`${ns.length}개 복사됨`)
    return true
  }

  const pasteClipboard = () => {
    const clip = clipboard.current
    if (!clip || clip.nodes.length === 0) return false
    record()
    pasteCount.current += 1
    const off = 24 * pasteCount.current // cascade repeated pastes
    const idMap = new Map<string, string>()
    const newNodes = clip.nodes.map((n) => {
      const nid = uid()
      idMap.set(n.id, nid)
      let x = n.x + off
      let y = n.y + off
      if (snapRef.current) {
        x = snapTo(x)
        y = snapTo(y)
      }
      return { ...n, id: nid, x, y }
    })
    const newEdges = clip.edges.map((e) => ({
      id: uid(),
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
    }))
    setNodes((ns) => [...ns, ...newNodes])
    setEdges((es) => [...es, ...newEdges])
    setSelectedEdgeId(null)
    setSelectedNodeIds(newNodes.map((n) => n.id))
    flash(`${newNodes.length}개 붙여넣기`)
    return true
  }

  /* ---- auto layout: longest-path layering ---- */
  const autoLayout = (dir: 'vertical' | 'horizontal') => {
    if (nodes.length === 0) return
    record()
    const LAYER_GAP = dir === 'vertical' ? 140 : 220 // distance between layers
    const SIBLING_GAP = dir === 'vertical' ? 200 : 110 // spread within a layer

    const ids = nodes.map((n) => n.id)
    const idset = new Set(ids)
    const rawEdges = edges.filter(
      (e) => e.source !== e.target && idset.has(e.source) && idset.has(e.target),
    )
    const key = (s: string, t: string) => `${s} ${t}`

    // 1) break cycles: DFS — an edge into a node still on the stack is a back edge
    const adj = new Map<string, string[]>(ids.map((id) => [id, []]))
    for (const e of rawEdges) adj.get(e.source)!.push(e.target)
    const color = new Map<string, number>(ids.map((id) => [id, 0])) // 0 white 1 gray 2 black
    const back = new Set<string>()
    for (const root of ids) {
      if (color.get(root) !== 0) continue
      const st: { v: string; i: number }[] = [{ v: root, i: 0 }]
      color.set(root, 1)
      while (st.length) {
        const top = st[st.length - 1]
        const nbrs = adj.get(top.v)!
        if (top.i < nbrs.length) {
          const w = nbrs[top.i++]
          const c = color.get(w)!
          if (c === 0) {
            color.set(w, 1)
            st.push({ v: w, i: 0 })
          } else if (c === 1) {
            back.add(key(top.v, w)) // points to an ancestor -> cycle
          }
        } else {
          color.set(top.v, 2)
          st.pop()
        }
      }
    }

    // reverse back edges so the graph is a DAG; dedup
    const seen = new Set<string>()
    const dag: { s: string; t: string }[] = []
    for (const e of rawEdges) {
      const [s, t] = back.has(key(e.source, e.target))
        ? [e.target, e.source]
        : [e.source, e.target]
      if (s === t || seen.has(key(s, t))) continue
      seen.add(key(s, t))
      dag.push({ s, t })
    }

    // 2) longest-path layering (DAG -> converges)
    const layer = new Map<string, number>(ids.map((id) => [id, 0]))
    for (let it = 0; it < ids.length; it++) {
      let ch = false
      for (const e of dag) {
        if (layer.get(e.t)! < layer.get(e.s)! + 1) {
          layer.set(e.t, layer.get(e.s)! + 1)
          ch = true
        }
      }
      if (!ch) break
    }
    const maxLayer = Math.max(0, ...ids.map((id) => layer.get(id)!))

    // 3) build layered graph, inserting dummy nodes for edges spanning >1 layer
    //    (dummies reserve a lane so long/back edges don't run through other nodes)
    const order: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
    const vlayer = new Map<string, number>()
    for (const id of ids) {
      const L = layer.get(id)!
      order[L].push(id)
      vlayer.set(id, L)
    }
    const down = new Map<string, string[]>() // vid -> neighbors in next layer
    const up = new Map<string, string[]>() // vid -> neighbors in prev layer
    const link = (a: string, b: string) => {
      if (!down.has(a)) down.set(a, [])
      if (!up.has(b)) up.set(b, [])
      down.get(a)!.push(b)
      up.get(b)!.push(a)
    }
    let dummyN = 0
    for (const e of dag) {
      const La = vlayer.get(e.s)!
      const Lb = vlayer.get(e.t)!
      let prev = e.s
      for (let L = La + 1; L < Lb; L++) {
        const d = `d${dummyN++}`
        order[L].push(d)
        vlayer.set(d, L)
        link(prev, d)
        prev = d
      }
      link(prev, e.t)
    }

    // 4) ordering: barycenter sweeps to reduce crossings
    const indexMap = (arr: string[]) => {
      const m = new Map<string, number>()
      arr.forEach((v, i) => m.set(v, i))
      return m
    }
    const bary = (
      v: string,
      nbr: Map<string, string[]>,
      idx: Map<string, number>,
      fallback: number,
    ) => {
      const ns = nbr.get(v)
      if (!ns || ns.length === 0) return fallback
      let s = 0
      for (const n of ns) s += idx.get(n) ?? 0
      return s / ns.length
    }
    for (let sweep = 0; sweep < 6; sweep++) {
      if (sweep % 2 === 0) {
        for (let L = 1; L <= maxLayer; L++) {
          const idx = indexMap(order[L - 1])
          const cur = indexMap(order[L])
          order[L] = [...order[L]]
            .map((v) => ({ v, k: bary(v, up, idx, cur.get(v)!) }))
            .sort((a, b) => a.k - b.k)
            .map((o) => o.v)
        }
      } else {
        for (let L = maxLayer - 1; L >= 0; L--) {
          const idx = indexMap(order[L + 1])
          const cur = indexMap(order[L])
          order[L] = [...order[L]]
            .map((v) => ({ v, k: bary(v, down, idx, cur.get(v)!) }))
            .sort((a, b) => a.k - b.k)
            .map((o) => o.v)
        }
      }
    }

    // 5) cross-axis coords: pull each node toward its neighbors' average,
    //    then keep order with a minimum gap. Straight chains end up aligned.
    const cross = new Map<string, number>()
    for (let L = 0; L <= maxLayer; L++)
      order[L].forEach((v, i) => cross.set(v, i * SIBLING_GAP))
    for (let it = 0; it < 12; it++) {
      const downward = it % 2 === 0
      for (let s = 1; s <= maxLayer; s++) {
        const L = downward ? s : maxLayer - s
        const nbr = downward ? up : down
        const row = order[L]
        const desired = row.map((v) => {
          const ns = nbr.get(v)
          if (!ns || ns.length === 0) return cross.get(v)!
          let sum = 0
          for (const n of ns) sum += cross.get(n)!
          return sum / ns.length
        })
        let prev = -Infinity
        for (let i = 0; i < row.length; i++) {
          const nx = Math.max(desired[i], prev + SIBLING_GAP)
          cross.set(row[i], nx)
          prev = nx
        }
      }
    }

    // 6) final positions for the real nodes (snap to grid when snap is on)
    const pos: Record<string, { x: number; y: number }> = {}
    for (const id of ids) {
      const L = vlayer.get(id)!
      const c = cross.get(id)!
      const { w, h } = getSize(id)
      let x: number
      let y: number
      if (dir === 'vertical') {
        x = c - w / 2
        y = L * LAYER_GAP
      } else {
        x = L * LAYER_GAP
        y = c - h / 2
      }
      if (snap) {
        x = snapTo(x)
        y = snapTo(y)
      }
      pos[id] = { x, y }
    }

    // bounding box of the result (world coords)
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const n of nodes) {
      const p = pos[n.id]
      if (!p) continue
      const { w, h } = getSize(n.id)
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x + w)
      maxY = Math.max(maxY, p.y + h)
    }

    setNodes((ns) => ns.map((n) => (pos[n.id] ? { ...n, ...pos[n.id] } : n)))

    // pan so the whole graph sits centered in the viewport (keep current zoom)
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect) {
      const z = viewRef.current.zoom
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      setView((v) => ({
        ...v,
        x: rect.width / 2 - cx * z,
        y: rect.height / 2 - cy * z,
      }))
    }
  }

  /* ---- PNG export: draw the whole graph onto an offscreen canvas ---- */
  const buildCanvas = (): HTMLCanvasElement | null => {
    if (nodes.length === 0) return null
    const PAD = 40
    const SCALE = 2 // crisp on hi-dpi

    // content bounding box in world coords
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const n of nodes) {
      const { w, h } = getSize(n.id)
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + w + 4) // include shadow offset
      maxY = Math.max(maxY, n.y + h + 4)
    }
    const W = maxX - minX + PAD * 2
    const H = maxY - minY + PAD * 2

    const canvas = document.createElement('canvas')
    canvas.width = W * SCALE
    canvas.height = H * SCALE
    const ctx = canvas.getContext('2d')!
    ctx.scale(SCALE, SCALE)
    ctx.translate(-minX + PAD, -minY + PAD)

    // background (skip when transparent export is on)
    if (!transparentBg) {
      ctx.fillStyle = BG_HEX
      ctx.fillRect(minX - PAD, minY - PAD, W, H)
    }

    ctx.font = EXPORT_FONT
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'miter'

    const center = (n: Node) => {
      const { w, h } = getSize(n.id)
      return { x: n.x + w / 2, y: n.y + h / 2 }
    }

    // edges
    for (const e of edges) {
      const s = getNode(e.source)
      const t = getNode(e.target)
      if (!s || !t) continue
      const p1 = borderPoint(s, getSize(s.id), center(t).x, center(t).y)
      const p2 = borderPoint(t, getSize(t.id), center(s).x, center(s).y)
      const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x)
      const head = 9
      const tipX = p2.x
      const tipY = p2.y
      // line (stop a little short of the tip)
      ctx.strokeStyle = INK_HEX
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(tipX - Math.cos(ang) * head, tipY - Math.sin(ang) * head)
      ctx.stroke()
      // arrowhead
      ctx.fillStyle = INK_HEX
      ctx.beginPath()
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(
        tipX - head * Math.cos(ang - Math.PI / 7),
        tipY - head * Math.sin(ang - Math.PI / 7),
      )
      ctx.lineTo(
        tipX - head * Math.cos(ang + Math.PI / 7),
        tipY - head * Math.sin(ang + Math.PI / 7),
      )
      ctx.closePath()
      ctx.fill()
    }

    // nodes
    for (const n of nodes) {
      const { w, h } = getSize(n.id)
      // hard shadow (shadow-sm: 4 4)
      ctx.fillStyle = 'rgba(0,0,0,0.2)'
      ctx.fillRect(n.x + 4, n.y + 4, w, h)
      // fill
      ctx.fillStyle = COLOR_HEX[n.color]
      ctx.fillRect(n.x, n.y, w, h)
      // border
      ctx.strokeStyle = INK_HEX
      ctx.lineWidth = 2
      ctx.strokeRect(n.x + 1, n.y + 1, w - 2, h - 2)
      // text
      ctx.fillStyle = TEXT_ON[n.color]
      const lines = wrapText(ctx, n.text, w - 28)
      const lineH = 19
      const startY = n.y + h / 2 - ((lines.length - 1) * lineH) / 2
      ctx.textAlign = 'center'
      lines.forEach((line, i) =>
        ctx.fillText(line, n.x + w / 2, startY + i * lineH),
      )
    }

    return canvas
  }

  const exportToBlob = (cb: (blob: Blob) => void) => {
    const canvas = buildCanvas()
    if (!canvas) {
      flash('노드가 없습니다')
      return
    }
    canvas.toBlob(async (blob) => {
      if (!blob) return
      // tag as sRGB so color-managed apps don't reinterpret on wide-gamut displays
      const tagged = tagPngSrgb(new Uint8Array(await blob.arrayBuffer()))
      cb(new Blob([tagged], { type: 'image/png' }))
    }, 'image/png')
  }

  const savePng = () =>
    exportToBlob((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'diagram.png'
      a.click()
      URL.revokeObjectURL(url)
      flash('PNG로 저장했습니다')
    })

  const copyPng = () =>
    exportToBlob(async (blob) => {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ])
        flash('클립보드에 복사했습니다')
      } catch {
        flash('복사 실패 — 저장을 이용하세요')
      }
    })

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 1800)
  }

  /* ---- persist to localStorage (debounced) ---- */
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ nodes, edges, view, snap, transparentBg }),
        )
      } catch {
        /* quota / disabled storage — ignore */
      }
    }, 300)
    return () => window.clearTimeout(id)
  }, [nodes, edges, view, snap, transparentBg])

  /* ---- wheel to zoom (non-passive so we can preventDefault) ---- */
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      zoomAt(e.clientX, e.clientY, viewRef.current.zoom * factor)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- keyboard: delete / escape ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // undo / redo work everywhere except while typing in a node
      if (!editingId && (e.metaKey || e.ctrlKey)) {
        const k = e.key.toLowerCase()
        if (k === 'z') {
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
          return
        }
        if (k === 'y') {
          e.preventDefault()
          redo()
          return
        }
        if (k === 'c') {
          if (copySelection()) e.preventDefault()
          return
        }
        if (k === 'v') {
          if (pasteClipboard()) e.preventDefault()
          return
        }
      }
      if (editingId) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeIds.length) deleteSelectedNodes()
        else if (selectedEdgeId) deleteEdge(selectedEdgeId)
      } else if (e.key === 'Escape') {
        clearSelection()
        setEditingId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeIds, selectedEdgeId, editingId])

  /* ---- node / port / canvas pointer down ---- */
  const onNodePointerDown = (e: React.PointerEvent, node: Node) => {
    if (editingId === node.id) return
    const target = e.target as HTMLElement
    if (target.dataset.port) return // port handled separately
    e.stopPropagation()

    // Shift toggles membership without starting a drag
    if (e.shiftKey) {
      toggleNode(node.id)
      return
    }

    // plain press: keep the group if this node is already in it, else select only it
    const movingIds = selectedNodeIds.includes(node.id)
      ? selectedNodeIds
      : [node.id]
    if (!selectedNodeIds.includes(node.id)) selectOnlyNode(node.id)
    else setSelectedEdgeId(null)

    beginAction() // snapshot before the move; committed on pointer up
    const { x, y } = toWorld(e.clientX, e.clientY)
    const starts: Record<string, { x: number; y: number }> = {}
    for (const id of movingIds) {
      const n = nodesRef.current.find((nn) => nn.id === id)
      if (n) starts[id] = { x: n.x, y: n.y }
    }
    dragRef.current = {
      type: 'move',
      ids: movingIds,
      primary: node.id,
      offX: x - node.x,
      offY: y - node.y,
      starts,
    }
  }

  const onPortPointerDown = (e: React.PointerEvent, node: Node) => {
    e.stopPropagation()
    beginAction() // snapshot before connecting; committed on pointer up
    dragRef.current = { type: 'connect', source: node.id }
    const { x, y } = toWorld(e.clientX, e.clientY)
    setTempEdge({ source: node.id, x, y })
  }

  // empty-space pointer down: deselect + start panning the field
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (!e.shiftKey) clearSelection()
    setEditingId(null)
    const v = viewRef.current
    dragRef.current = {
      type: 'pan',
      sx: e.clientX,
      sy: e.clientY,
      px: v.x,
      py: v.y,
    }
  }

  /* ---- render one edge ---- */
  const renderEdge = (edge: Edge) => {
    const s = getNode(edge.source)
    const t = getNode(edge.target)
    if (!s || !t) return null
    const ss = getSize(s.id)
    const ts = getSize(t.id)
    const sc = { x: s.x + ss.w / 2, y: s.y + ss.h / 2 }
    const tc = { x: t.x + ts.w / 2, y: t.y + ts.h / 2 }
    const p1 = borderPoint(s, ss, tc.x, tc.y)
    const p2 = borderPoint(t, ts, sc.x, sc.y)
    const selected = selectedEdgeId === edge.id
    return (
      <g key={edge.id} className={selected ? 'edge--selected' : undefined}>
        <line
          className="edge-line"
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          markerEnd="url(#arrow)"
        />
        <line
          className="edge-hit"
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          onPointerDown={(e) => {
            e.stopPropagation()
            selectEdge(edge.id)
          }}
        />
      </g>
    )
  }

  const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id))
  const singleNode = selectedNodes.length === 1 ? selectedNodes[0] : null
  const commonColor =
    selectedNodes.length > 0 &&
    selectedNodes.every((n) => n.color === selectedNodes[0].color)
      ? selectedNodes[0].color
      : null

  const worldTransform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`

  return (
    <div className="app">
      {/* toolbar */}
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          Grapher
        </Text>
        {/* this tool keeps its own history (it snapshots nodes+edges, not the
            whole persisted object) but shares the buttons so the icon and the
            shortcuts read the same everywhere */}
        <UndoRedo history={{ undo, redo, canUndo, canRedo }} />

        <div className="toolbar__group">
          <Button variant="primary" size="sm" onClick={() => addNode()}>
            + Node
          </Button>
        </div>
        <Button
          variant={snap ? 'warning' : 'neutral'}
          size="sm"
          onClick={() => setSnap((s) => !s)}
          title="격자에 맞춰 이동"
        >
          ⊞ Snap
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => autoLayout('vertical')}
        >
          ↓ 세로 정렬
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => autoLayout('horizontal')}
        >
          → 가로 정렬
        </Button>
        <Button variant="success" size="sm" title="PNG로 저장 (⌘E)" onClick={savePng}>
          PNG 저장
        </Button>
        <Button variant="info" size="sm" title="클립보드로 복사 (⌘⇧C)" onClick={copyPng}>
          복사
        </Button>
        <Button
          variant={transparentBg ? 'warning' : 'neutral'}
          size="sm"
          onClick={() => setTransparentBg((v) => !v)}
          title="PNG 저장·복사 시 배경 투명"
        >
          ▦ 투명 배경
        </Button>
      </div>

      {/* canvas + the panels that float over it */}
      <div className="canvasbox">
      <div
        className="canvas"
        ref={canvasRef}
        style={{
          backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
        onPointerDown={onCanvasPointerDown}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-node-id]')) return
          const { x, y } = toWorld(e.clientX, e.clientY)
          addNode(x - 60, y - 24)
        }}
      >
       <div className="world" style={{ transform: worldTransform }}>
        {/* edges */}
        <svg className="canvas__edges">
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--funky-border-color)" />
            </marker>
          </defs>
          {edges.map(renderEdge)}
          {tempEdge &&
            (() => {
              const s = getNode(tempEdge.source)
              if (!s) return null
              const p1 = borderPoint(s, getSize(s.id), tempEdge.x, tempEdge.y)
              return (
                <line
                  className="edge-temp"
                  x1={p1.x}
                  y1={p1.y}
                  x2={tempEdge.x}
                  y2={tempEdge.y}
                />
              )
            })()}
        </svg>

        {/* nodes */}
        {nodes.map((node) => {
          const selected = selectedNodeIds.includes(node.id)
          return (
            <div
              key={node.id}
              data-node-id={node.id}
              ref={(el) => {
                if (el) nodeRefs.current.set(node.id, el)
                else nodeRefs.current.delete(node.id)
              }}
              className={`node node--${node.color}${
                selected ? ' node--selected' : ''
              }`}
              style={{
                left: node.x,
                top: node.y,
                ...(snap
                  ? { width: getSize(node.id).w, maxWidth: 'none' }
                  : null),
              }}
              onPointerDown={(e) => onNodePointerDown(e, node)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                beginAction() // snapshot before the edit; committed on blur/enter
                setEditingId(node.id)
                selectOnlyNode(node.id)
              }}
            >
              <div className="node__text">
                {/* label always rendered so the box keeps its size while editing */}
                <div
                  className={`node__label${
                    editingId === node.id ? ' node__label--editing' : ''
                  }`}
                >
                  {node.text || ' '}
                </div>
                {editingId === node.id && (
                  <textarea
                    className="node__editor"
                    autoFocus
                    value={node.text}
                    onChange={(e) => {
                      dirty.current = true // mark the edit as a real change
                      updateNode(node.id, { text: e.target.value })
                    }}
                    onBlur={() => {
                      commitAction()
                      setEditingId(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        commitAction()
                        setEditingId(null)
                      }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                )}
              </div>
              <div
                className="node__port"
                data-port="true"
                onPointerDown={(e) => onPortPointerDown(e, node)}
              />
            </div>
          )
        })}
       </div>
      </div>

      {/* zoom controls */}
      <div className="zoombar">
        <Button
          variant="neutral"
          size="sm"
          onClick={() => zoomByCenter(1 / 1.2)}
        >
          −
        </Button>
        <button
          className="zoombar__pct"
          onClick={() => setView({ x: 0, y: 0, zoom: 1 })}
          title="100%로 초기화"
        >
          {Math.round(view.zoom * 100)}%
        </button>
        <Button variant="neutral" size="sm" onClick={() => zoomByCenter(1.2)}>
          +
        </Button>
      </div>

      {/* inspector: node(s) */}
      {selectedNodes.length > 0 && (
        <div className="inspector">
          <Text variant="heading" as="h2">
            {singleNode ? 'Node' : `${selectedNodes.length} Nodes`}
          </Text>

          <div className="inspector__section">
            <Text variant="chrome" muted>
              Color
            </Text>
            <div className="swatches">
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  title={c.label}
                  className={`swatch swatch--${c.key}${
                    commonColor === c.key ? ' swatch--active' : ''
                  }`}
                  onClick={() => colorSelected(c.key)}
                />
              ))}
            </div>
          </div>

          <div className="inspector__section">
            {singleNode && (
              <Button
                variant="info"
                size="sm"
                onClick={() => {
                  beginAction()
                  setEditingId(singleNode.id)
                }}
              >
                텍스트 편집
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={deleteSelectedNodes}>
              {singleNode ? '노드 삭제' : `${selectedNodes.length}개 삭제`}
            </Button>
          </div>
        </div>
      )}

      {/* inspector: edge */}
      {selectedEdgeId && (
        <div className="inspector">
          <Text variant="heading" as="h2">
            Edge
          </Text>
          <Button
            variant="danger"
            size="sm"
            onClick={() => deleteEdge(selectedEdgeId)}
          >
            연결 삭제
          </Button>
        </div>
      )}

      {/* toast */}
      {toast && <div className="toast">{toast}</div>}
      </div>

      <Text variant="chrome" muted className="hint">
        드래그로 이동 · Shift+클릭 다중 선택 · 빈 곳 드래그로 화면 이동 · 휠로 확대 ·
        더블클릭으로 노드 추가 · 포트에서 끌어 연결
      </Text>
    </div>
  )
}
