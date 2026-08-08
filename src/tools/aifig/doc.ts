/* Pure document operations: everything that transforms a FigDoc without
 * touching React. Keeping them here means undo/redo only ever has to snapshot
 * one plain object, and the same helpers back both the toolbar buttons and the
 * keyboard shortcuts. */

import type {
  Anchor,
  EdgeStyle,
  FigDoc,
  FigEdge,
  FigNode,
  Pt,
  Rect,
  Style,
} from './types'
import { nodeBounds, unionRect } from './geometry'
import {
  baseEdgeStyle,
  DEFAULT_CANVAS,
  makeNode,
  paletteById,
  uid,
} from './presets'

export const nodeMap = (doc: FigDoc) => new Map(doc.nodes.map((n) => [n.id, n]))

export function emptyDoc(paletteId = 'muted'): FigDoc {
  return { nodes: [], edges: [], canvas: { ...DEFAULT_CANVAS }, paletteId }
}

/* ---------- selection helpers ---------- */

export const selectedNodes = (doc: FigDoc, ids: string[]) =>
  doc.nodes.filter((n) => ids.includes(n.id))

export function selectionBounds(doc: FigDoc, ids: string[]): Rect | null {
  return unionRect(selectedNodes(doc, ids).map(nodeBounds))
}

/** Expand a selection to whole groups — dragging one member moves them all. */
export function expandGroups(doc: FigDoc, ids: string[]): string[] {
  const groups = new Set(
    doc.nodes.filter((n) => ids.includes(n.id) && n.group).map((n) => n.group!),
  )
  if (!groups.size) return ids
  const out = new Set(ids)
  for (const n of doc.nodes) if (n.group && groups.has(n.group)) out.add(n.id)
  return [...out]
}

/* ---------- mutation ---------- */

export function patchNodes(
  doc: FigDoc,
  ids: string[],
  patch: (n: FigNode) => Partial<FigNode>,
): FigDoc {
  const set = new Set(ids)
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (set.has(n.id) ? { ...n, ...patch(n) } : n)),
  }
}

export function patchNodeStyle(
  doc: FigDoc,
  ids: string[],
  patch: Partial<Style>,
): FigDoc {
  return patchNodes(doc, ids, (n) => ({ style: { ...n.style, ...patch } }))
}

export function patchEdges(
  doc: FigDoc,
  ids: string[],
  patch: (e: FigEdge) => Partial<FigEdge>,
): FigDoc {
  const set = new Set(ids)
  return {
    ...doc,
    edges: doc.edges.map((e) => (set.has(e.id) ? { ...e, ...patch(e) } : e)),
  }
}

export function patchEdgeStyle(
  doc: FigDoc,
  ids: string[],
  patch: Partial<EdgeStyle>,
): FigDoc {
  return patchEdges(doc, ids, (e) => ({ style: { ...e.style, ...patch } }))
}

export function removeItems(doc: FigDoc, nodeIds: string[], edgeIds: string[]): FigDoc {
  const ns = new Set(nodeIds)
  const es = new Set(edgeIds)
  const attached = (ep: FigEdge['from']) => 'node' in ep && ns.has(ep.node)
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !ns.has(n.id)),
    edges: doc.edges.filter(
      (e) => !es.has(e.id) && !attached(e.from) && !attached(e.to),
    ),
  }
}

/* ---------- z-order ---------- */

export type ZMode = 'front' | 'back' | 'forward' | 'backward'

export function reorder(doc: FigDoc, ids: string[], mode: ZMode): FigDoc {
  const set = new Set(ids)
  const nodes = [...doc.nodes]
  if (mode === 'front') {
    const picked = nodes.filter((n) => set.has(n.id))
    return { ...doc, nodes: [...nodes.filter((n) => !set.has(n.id)), ...picked] }
  }
  if (mode === 'back') {
    const picked = nodes.filter((n) => set.has(n.id))
    return { ...doc, nodes: [...picked, ...nodes.filter((n) => !set.has(n.id))] }
  }
  const step = mode === 'forward' ? 1 : -1
  const order = mode === 'forward' ? [...nodes.keys()].reverse() : [...nodes.keys()]
  for (const i of order) {
    if (!set.has(nodes[i].id)) continue
    const j = i + step
    if (j < 0 || j >= nodes.length || set.has(nodes[j].id)) continue
    ;[nodes[i], nodes[j]] = [nodes[j], nodes[i]]
  }
  return { ...doc, nodes }
}

/* ---------- align / distribute ---------- */

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

export function align(doc: FigDoc, ids: string[], mode: AlignMode): FigDoc {
  const picked = selectedNodes(doc, ids)
  if (picked.length < 2) return doc
  const box = unionRect(picked.map(nodeBounds))!
  return patchNodes(doc, ids, (n) => {
    const b = nodeBounds(n)
    // keep the offset between the node's box and its rotated bounds
    const offX = n.x - b.x
    const offY = n.y - b.y
    switch (mode) {
      case 'left':
        return { x: Math.round(box.x + offX) }
      case 'right':
        return { x: Math.round(box.x + box.w - b.w + offX) }
      case 'hcenter':
        return { x: Math.round(box.x + (box.w - b.w) / 2 + offX) }
      case 'top':
        return { y: Math.round(box.y + offY) }
      case 'bottom':
        return { y: Math.round(box.y + box.h - b.h + offY) }
      default:
        return { y: Math.round(box.y + (box.h - b.h) / 2 + offY) }
    }
  })
}

export function distribute(doc: FigDoc, ids: string[], axis: 'x' | 'y'): FigDoc {
  const picked = selectedNodes(doc, ids)
  if (picked.length < 3) return doc
  const withBox = picked.map((n) => ({ n, b: nodeBounds(n) }))
  withBox.sort((p, q) => (axis === 'x' ? p.b.x - q.b.x : p.b.y - q.b.y))
  const first = withBox[0].b
  const last = withBox[withBox.length - 1].b
  const span =
    axis === 'x' ? last.x + last.w - first.x : last.y + last.h - first.y
  const used = withBox.reduce((s, p) => s + (axis === 'x' ? p.b.w : p.b.h), 0)
  const gap = (span - used) / (withBox.length - 1)
  let cursor = axis === 'x' ? first.x : first.y
  const moves = new Map<string, number>()
  for (const { n, b } of withBox) {
    moves.set(n.id, Math.round(cursor + (axis === 'x' ? n.x - b.x : n.y - b.y)))
    cursor += (axis === 'x' ? b.w : b.h) + gap
  }
  return patchNodes(doc, ids, (n) =>
    moves.has(n.id) ? (axis === 'x' ? { x: moves.get(n.id)! } : { y: moves.get(n.id)! }) : {},
  )
}

/** Give every selected node the same width and/or height as the widest/tallest. */
export function equalize(doc: FigDoc, ids: string[], axis: 'w' | 'h' | 'both'): FigDoc {
  const picked = selectedNodes(doc, ids)
  if (picked.length < 2) return doc
  const w = Math.max(...picked.map((n) => n.w))
  const h = Math.max(...picked.map((n) => n.h))
  return patchNodes(doc, ids, () => ({
    ...(axis === 'w' || axis === 'both' ? { w } : null),
    ...(axis === 'h' || axis === 'both' ? { h } : null),
  }))
}

/* ---------- grouping ---------- */

export function group(doc: FigDoc, ids: string[]): FigDoc {
  if (ids.length < 2) return doc
  const gid = uid('g')
  return patchNodes(doc, ids, () => ({ group: gid }))
}

export function ungroup(doc: FigDoc, ids: string[]): FigDoc {
  return patchNodes(doc, ids, () => ({ group: undefined }))
}

/* ---------- clone ---------- */

export interface CloneResult {
  doc: FigDoc
  nodeIds: string[]
  edgeIds: string[]
}

/** Duplicate nodes plus any edge whose both ends are inside the set. */
export function cloneInto(
  doc: FigDoc,
  nodes: FigNode[],
  edges: FigEdge[],
  dx: number,
  dy: number,
): CloneResult {
  const idMap = new Map<string, string>()
  const groupMap = new Map<string, string>()
  const newNodes = nodes.map((n) => {
    const id = uid()
    idMap.set(n.id, id)
    let g = n.group
    if (g) {
      if (!groupMap.has(g)) groupMap.set(g, uid('g'))
      g = groupMap.get(g)!
    }
    return { ...n, id, x: n.x + dx, y: n.y + dy, group: g, style: { ...n.style }, props: { ...n.props } }
  })
  const remap = (ep: FigEdge['from']): FigEdge['from'] | null => {
    if ('free' in ep) return { free: { x: ep.free.x + dx, y: ep.free.y + dy } }
    const id = idMap.get(ep.node)
    return id ? { node: id, anchor: ep.anchor } : null
  }
  const newEdges: FigEdge[] = []
  for (const e of edges) {
    const from = remap(e.from)
    const to = remap(e.to)
    if (!from || !to) continue
    newEdges.push({
      ...e,
      id: uid('e'),
      from,
      to,
      waypoints: e.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      style: { ...e.style },
    })
  }
  return {
    doc: { ...doc, nodes: [...doc.nodes, ...newNodes], edges: [...doc.edges, ...newEdges] },
    nodeIds: newNodes.map((n) => n.id),
    edgeIds: newEdges.map((e) => e.id),
  }
}

export function duplicate(
  doc: FigDoc,
  nodeIds: string[],
  edgeIds: string[],
  dx = 16,
  dy = 16,
): CloneResult {
  const ns = new Set(nodeIds)
  const nodes = doc.nodes.filter((n) => ns.has(n.id))
  const inside = (ep: FigEdge['from']) => 'node' in ep && ns.has(ep.node)
  const edges = doc.edges.filter(
    (e) => edgeIds.includes(e.id) || (inside(e.from) && inside(e.to)),
  )
  return cloneInto(doc, nodes, edges, dx, dy)
}

/* ---------- creation ---------- */

export function addNodeAt(
  doc: FigDoc,
  kind: FigNode['kind'],
  at: Pt,
  colorIndex = -1,
): { doc: FigDoc; id: string } {
  const p = paletteById(doc.paletteId)
  const n = makeNode(kind, at.x, at.y, p, doc.canvas.baseFont, colorIndex)
  return { doc: { ...doc, nodes: [...doc.nodes, n] }, id: n.id }
}

export function connect(
  doc: FigDoc,
  from: string,
  to: string,
  fromAnchor: Anchor = 'auto',
  toAnchor: Anchor = 'auto',
): { doc: FigDoc; id: string } {
  const p = paletteById(doc.paletteId)
  const e: FigEdge = {
    id: uid('e'),
    from: { node: from, anchor: fromAnchor },
    to: { node: to, anchor: toAnchor },
    route: 'straight',
    waypoints: [],
    startHead: 'none',
    endHead: 'arrow',
    label: '',
    labelT: 0.5,
    labelDx: 0,
    labelDy: 0,
    bow: 24,
    style: baseEdgeStyle(p, Math.max(9, doc.canvas.baseFont - 2)),
    locked: false,
    hidden: false,
  }
  return { doc: { ...doc, edges: [...doc.edges, e] }, id: e.id }
}

/* ---------- palette swap ---------- */

/** Re-map an existing figure onto another palette by nearest-hue matching, so
 *  switching schemes keeps the "which block is which" grouping intact. */
export function applyPalette(doc: FigDoc, toId: string): FigDoc {
  const from = paletteById(doc.paletteId)
  const to = paletteById(toId)
  const map = new Map<string, string>()
  from.colors.forEach((c, i) => map.set(c.toLowerCase(), to.colors[i % to.colors.length]))
  map.set(from.ink.toLowerCase(), to.ink)
  map.set(from.line.toLowerCase(), to.line)
  map.set(from.neutral.toLowerCase(), to.neutral)
  const conv = (c: string) => map.get(c.toLowerCase()) ?? c
  return {
    ...doc,
    paletteId: toId,
    nodes: doc.nodes.map((n) => ({
      ...n,
      style: {
        ...n.style,
        stroke: conv(n.style.stroke),
        textColor: conv(n.style.textColor),
        fill: conv(n.style.fill),
      },
    })),
    edges: doc.edges.map((e) => ({
      ...e,
      style: { ...e.style, stroke: conv(e.style.stroke), textColor: conv(e.style.textColor) },
    })),
  }
}

/* ---------- bounds of the whole figure ---------- */

export function contentBounds(doc: FigDoc): Rect | null {
  const rects: Rect[] = doc.nodes.filter((n) => !n.hidden).map(nodeBounds)
  for (const e of doc.edges) {
    for (const ep of [e.from, e.to])
      if ('free' in ep) rects.push({ x: ep.free.x, y: ep.free.y, w: 0, h: 0 })
    for (const p of e.waypoints) rects.push({ x: p.x, y: p.y, w: 0, h: 0 })
  }
  return unionRect(rects)
}

/* ---------- persistence ---------- */

export const STORE_KEY = 'fem.aifig.v1'

/** Returns false when the browser refused the write — almost always the quota,
 *  which embedded bitmaps blow through quickly. The caller warns the user
 *  rather than letting a session silently stop autosaving. */
export function saveDoc(doc: FigDoc): boolean {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(doc))
    return true
  } catch {
    return false
  }
}

/* Goes through normalizeDoc rather than trusting the stored shape. Opening a
   project writes this slot and remounts the tool, so a hand-written or
   AI-generated figure — which will be missing per-node defaults — arrives here
   too, not only through a file picker. */
export function loadDoc(): FigDoc | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    return normalizeDoc(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Accept a hand-edited / older JSON file without crashing the canvas. */
export function normalizeDoc(input: unknown): FigDoc | null {
  if (!input || typeof input !== 'object') return null
  const d = input as Partial<FigDoc>
  if (!Array.isArray(d.nodes) || !Array.isArray(d.edges)) return null
  const p = paletteById(d.paletteId ?? 'muted')
  // defaults live in objects rather than inline keys so a file missing a field
  // gets filled in without the spread order tripping TS's overwrite check
  const nodeDefaults = {
    rotation: 0,
    label: '',
    labelPos: 'center',
    locked: false,
    hidden: false,
    props: {},
  } as const
  const edgeDefaults = {
    route: 'straight',
    waypoints: [],
    startHead: 'none',
    endHead: 'arrow',
    label: '',
    labelT: 0.5,
    labelDx: 0,
    labelDy: 0,
    bow: 24,
    locked: false,
    hidden: false,
  } as const
  const nodes = d.nodes.map(
    (n) =>
      ({
        ...nodeDefaults,
        ...n,
        style: { ...makeNode('rect', 0, 0, p, 13).style, ...(n.style ?? {}) },
      }) as FigNode,
  )
  const edges = d.edges.map(
    (e) =>
      ({
        ...edgeDefaults,
        ...e,
        style: { ...baseEdgeStyle(p), ...(e.style ?? {}) },
      }) as FigEdge,
  )
  return {
    nodes,
    edges,
    canvas: { ...DEFAULT_CANVAS, ...(d.canvas ?? {}) },
    paletteId: d.paletteId ?? 'muted',
  }
}
