/* AI Figure Maker — document model.
 *
 * The whole figure is one plain-JSON document: an ordered node list (array
 * order == z-order), an edge list, and canvas settings. Everything the editor
 * shows is derived from it, so undo/redo is snapshot-based and the .json
 * export is literally this object. */

/* ---------- geometry primitives ---------- */

export interface Pt {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/* ---------- style ---------- */

export type DashKind = 'solid' | 'dashed' | 'dotted' | 'dashdot'
/* How a label's source text is read, and what it is drawn in.
 *
 * The first three are fonts: the label is prose, and maths has to be fenced off
 * with `$…$` (inline) or `$$…$$` (display) the way it is in a .tex file.
 * `latex` is not a font but a mode — the *whole* string is one TeX expression,
 * so `\sigma` is a sigma with no dollars around it. That is the right default
 * for figure labels, which are mostly symbols; the cost is that prose typed in
 * this mode comes out as italic maths letters, so a word like "Encoder" wants
 * one of the others (or `\text{Encoder}`).
 *
 * serif = Times-alike (matches most LaTeX body text); sans = Helvetica-alike
 * (matches matplotlib defaults); mono for code/shape names. */
export type FontKind = 'serif' | 'sans' | 'mono' | 'latex'
export type AlignKind = 'left' | 'center' | 'right'
/** Where a node's label sits relative to its box. */
export type LabelPos =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'inside-top'
  | 'inside-bottom'

export interface Style {
  fill: string // 'none' for no fill
  stroke: string // 'none' for no outline
  strokeWidth: number
  dash: DashKind
  opacity: number
  radius: number // corner radius (rect-like shapes)
  fontFamily: FontKind
  fontSize: number
  fontWeight: number
  italic: boolean
  textColor: string
  align: AlignKind
  /** extra line spacing multiplier for multi-line labels */
  lineHeight: number
}

/* ---------- nodes ---------- */

export type NodeKind =
  | 'rect' // generic layer block
  | 'cuboid' // 3D tensor / feature map (isometric)
  | 'ellipse' // neuron, state
  | 'op' // operator token: ⊕ ⊗ ⊙ ⊘ concat σ …
  | 'diamond' // branch / decision
  | 'trapezoid' // encoder / decoder wedge
  | 'cylinder' // dataset / memory
  | 'stack' // repeated block (N×)
  | 'mlp' // fully-connected layer diagram
  | 'grid' // patch grid / attention map / matrix
  | 'brace' // grouping brace
  | 'bracket' // matrix bracket (for tensor notation)
  | 'text' // free label / equation
  | 'image' // pasted bitmap (sample, qualitative result)
  | 'frame' // titled container (dashed group box)
  | 'curve' // small inline plot (loss curve, activation)
  | 'triangle'
  | 'parallelogram' // data / IO block (flowchart convention)

/** Per-kind extras. Kept as one optional bag so the node type stays flat and
 *  serialisation is trivial; each field is only read by the kinds that use it. */
export interface NodeProps {
  /* cuboid */
  depth?: number // isometric depth in px
  skew?: number // isometric angle, degrees
  faceTop?: string // top-face fill override (auto-shaded when absent)
  faceSide?: string
  /* stack */
  count?: number // how many sheets
  offset?: number // per-sheet offset in px
  /* mlp */
  layers?: number[] // neurons per layer
  showEdges?: boolean // draw full connections
  neuronR?: number
  /* grid */
  rows?: number
  cols?: number
  /** per-cell 0..1 intensities, row-major; blends fill toward `heatHi` */
  heat?: number[]
  heatHi?: string
  gap?: number
  /* brace / bracket */
  dir?: 'up' | 'down' | 'left' | 'right'
  /* op */
  symbol?: string
  /* image */
  src?: string // data URL
  /** how the bitmap fills its box: stretch, letterbox, or crop to fill */
  fit?: 'fill' | 'contain' | 'cover'
  /** natural pixel size, kept so "reset to original ratio" works later */
  natW?: number
  natH?: number
  /* curve */
  fn?: 'relu' | 'sigmoid' | 'tanh' | 'gelu' | 'loss' | 'sine' | 'step'
  /* text */
  /** box tracks the glyphs instead of the other way round. Absent on nodes
   *  saved before it existed, which keeps their layout frozen. */
  autoFit?: boolean
  /* trapezoid */
  taper?: number // 0..0.9, how much the short side shrinks
  /* frame */
  title?: string
  /** plate behind the frame's title; 'none' unless the title has to sit over
   *  something. It used to be a hardcoded white slab. */
  titleBg?: string
}

export interface FigNode {
  id: string
  kind: NodeKind
  x: number
  y: number
  w: number
  h: number
  rotation: number // degrees, about the box centre
  label: string // may contain $…$ inline LaTeX
  labelPos: LabelPos
  style: Style
  props: NodeProps
  locked: boolean
  hidden: boolean
  name?: string // shown in the layer list; falls back to label/kind
  group?: string // group id (nodes sharing one move as a unit)
}

/* ---------- edges ---------- */

/** 'auto' picks the border point facing the other end; the rest are fixed. */
export type Anchor =
  | 'auto'
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'
  | 'c'

export type EndPoint =
  | { node: string; anchor: Anchor }
  | { free: Pt } // detached endpoint (free-floating arrow)

/* A bend in a connector.
 *
 * ⚠️ Without `rel` the point is an absolute canvas coordinate, which is how
 * every bend used to be stored — and why moving a block left its connectors
 * pinned to the canvas and tangled the figure. With `rel` the point is an
 * offset from that endpoint's node centre, so the bend travels with the shape
 * it belongs to. Files written before this keep the old meaning. */
export interface Waypoint extends Pt {
  rel?: 'from' | 'to'
}

export type RouteKind = 'straight' | 'ortho' | 'curve' | 'arc'
export type HeadKind =
  | 'none'
  | 'arrow' // filled triangle
  | 'open' // stroked V
  | 'dot'
  | 'circle'
  | 'diamond'
  | 'bar'

export interface EdgeStyle {
  stroke: string
  strokeWidth: number
  dash: DashKind
  opacity: number
  fontFamily: FontKind
  fontSize: number
  textColor: string
  /** Which side of the label's anchor the text sits on, and the ragged edge of
   *  a multi-line one. Absent on edges saved before it existed: centred. */
  align?: AlignKind
  /** label background plate — keeps text readable over crossing lines */
  labelBg: string // 'none' to disable
}

export interface FigEdge {
  id: string
  from: EndPoint
  to: EndPoint
  route: RouteKind
  waypoints: Waypoint[] // user-dragged bends (straight/ortho); curve uses them as controls
  startHead: HeadKind
  endHead: HeadKind
  label: string // may contain $…$
  labelT: number // 0..1 position along the path
  labelDx: number // manual nudge
  labelDy: number
  /** arc bulge in px (route === 'arc'), signed */
  bow: number
  style: EdgeStyle
  locked: boolean
  hidden: boolean
}

/* ---------- canvas ---------- */

export type BgKind = 'transparent' | 'white' | 'paper'

export interface CanvasCfg {
  /** logical px == CSS px at 96 dpi; presets convert from in/mm/pt */
  w: number
  h: number
  bg: BgKind
  /** target print width in inches — drives the "effective pt size" readout */
  printWidthIn: number
  presetId: string
  showGrid: boolean
  grid: number
  snap: boolean
  /** base font size applied to newly created nodes */
  baseFont: number
}

export interface FigDoc {
  nodes: FigNode[]
  edges: FigEdge[]
  canvas: CanvasCfg
  /** active palette id — new nodes pull their colors from it */
  paletteId: string
}

/* ---------- editor-only state (not persisted in the figure) ---------- */

/* `ToolMode` and `Selection` used to live here. Nothing ever read either: the
 * editor keeps its mode in `connecting` and its selection in two id arrays, so
 * they were a description of a design that was never built. */

export interface View {
  x: number
  y: number
  zoom: number
}
