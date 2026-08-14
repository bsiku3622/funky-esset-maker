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

/* One neuron's and one wire's overrides inside an `mlp` node.
 *
 * These are what make a network glyph editable part by part: a neuron can be
 * recoloured or given text without becoming its own node, and a synapse can be
 * recoloured or dropped without becoming its own edge. Keeping them here rather
 * than exploding the glyph into real nodes is what lets the lattice stay
 * algorithmic — a unit you could drag away from the grid would not be on it. */
/* A neuron is a circle with text in it, and everything a circle can be told is
 * on offer here. Absent means "whatever the network is set to" — that is the
 * default rather than a limit, so a unit only carries what has been said about
 * it specifically and still follows the figure when its colours change.
 *
 * ⚠️ What is deliberately *not* here is position and radius. Those belong to
 * the lattice — a unit you could move or resize by hand would not be on the
 * grid, and being on the grid is the whole point of mlp.ts. Everything else is
 * appearance, and appearance is the user's. */
export interface NeuronBits {
  /** drawn inside the circle */
  label?: string
  fontFamily?: FontKind
  /** absent lets the network's size be capped to fit the circle; set is exact */
  fontSize?: number
  fontWeight?: number
  italic?: boolean
  textColor?: string
  /* Nudge away from the circle's centre, the way a connector's label carries
   * one. A label that has to sit *outside* its unit — naming a circle too small
   * to hold the name — is the reason: without it the only way to put text
   * beside a neuron was a free-floating text node, which then had to be dragged
   * again every time the lattice re-spaced underneath it. */
  dx?: number
  dy?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  dash?: DashKind
  opacity?: number
}

/* Several units taken together — an input vector, a block that repeats, the
 * half of a layer that carries one thing. It exists so a connector can point at
 * the four of them at once instead of four connectors saying the same thing.
 *
 * ⚠️ Members are named by neuron key, so anything that renumbers the layer axis
 * has to renumber these too. */
export interface NeuronGroup {
  parts: string[]
  label?: string
  fill?: string
  stroke?: string
  /** the enclosing outline; absent draws it */
  bare?: boolean
  /* How far the outline stands off the units it holds, one number per side in
   * CSS order — top, right, bottom, left. Absent is `GROUP_PAD` all round.
   *
   * ⚠️ This is the group's *only* degree of freedom, and that is on purpose. A
   * group is defined by the units it holds, and those are placed by the lattice
   * — so it cannot be moved or given a size of its own without lying about
   * where its members are. Dragging a grip therefore edits the padding, which
   * is the one part of the box the lattice does not already decide. */
  pad?: [number, number, number, number]
  /** the name drawn above the box */
  textColor?: string
  fontSize?: number
}

/* One caption's own settings. Absent means "whatever the network says", which
 * is what `capColor` still answers for the whole row of them. */
export interface CapBits {
  dx?: number
  dy?: number
  textColor?: string
  fontSize?: number
  fontFamily?: FontKind
}

export interface WireBits {
  stroke?: string
  strokeWidth?: number
  dash?: DashKind
  opacity?: number
  /** drop this one synapse without touching the rest */
  hidden?: boolean
  /* A weight written on the synapse, the way a connector carries a label. The
   * two are the same picture — "this quantity travels along this line" — and a
   * network drawn without it has to caption its weights somewhere else. */
  label?: string
  /** where along the run the label sits, 0..1, and its nudge off the line */
  labelT?: number
  labelDx?: number
  labelDy?: number
}

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
  /* mlp — see mlp.ts, which owns what these mean geometrically */
  layers?: number[] // neurons per layer
  showEdges?: boolean // draw full connections
  neuronR?: number
  /** centre-to-centre spacing down a column. Absent = the old behaviour, where
   *  every column stretches to fill the box and so no two columns of different
   *  sizes share a spacing. Present = equal spacing, and the box follows. */
  pitch?: number
  /** centre-to-centre spacing between columns; pairs with `pitch` */
  layerGap?: number
  /* One width per gap — `layers.length - 1` of them — when the columns are not
   * evenly spaced. An absent entry falls back to `layerGap`, so the array only
   * has to say what is different: pushing the input layer out to the left is
   * one number, and the rest of the network keeps its rhythm. */
  gaps?: number[]
  /** circles drawn per column before the remainder becomes a ⋮ */
  maxDots?: number
  /* The synapses have their own ink. They used to borrow the node's stroke,
   * which meant a network could not have dark circles and pale wires — the
   * ordinary look for a figure with more than three units a layer. Absent
   * still falls back to the node, so nothing already drawn changes. */
  wireStroke?: string
  wireWidth?: number
  wireOpacity?: number
  /** per-neuron overrides, keyed `l0n2` (layer, unit) */
  neurons?: Record<string, NeuronBits>
  /** per-wire overrides, keyed `l0n2-n1` (layer, from unit, to unit) */
  wires?: Record<string, WireBits>
  /** neuron groups, keyed `g0` — a connector may point at one */
  groups?: Record<string, NeuronGroup>
  /** caption above each column — "no bias" and friends */
  capTop?: string[]
  /** caption below each column */
  capBottom?: string[]
  /** ink for both rows of captions; absent follows the node's text colour */
  capColor?: string
  /* Everything said about one caption, keyed the way `mlpTextBoxes` keys them —
   * `cap:t:2` for a layer's, `g0` for a group's. One bag for both kinds because
   * a caption is a caption: the thing that differs is where its *text* is kept,
   * and by the time it has a colour and a place that no longer matters.
   *
   * ⚠️ `capOffsets` was the same bag holding only positions. Documents saved
   * with it are still read — see `capBits` — and re-saved under the new name. */
  caps?: Record<string, CapBits>
  capOffsets?: Record<string, { dx: number; dy: number }>
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
  /* Free nudge off whatever `labelPos` picked, in px.
   *
   * ⚠️ The seven positions are starting points, not the whole vocabulary. A
   * connector's label and a neuron's both carry an offset; a node's did not, so
   * the only way to put a name a little to the left of "above" was a separate
   * text node that then had to be moved by hand every time the shape did. */
  labelDx?: number
  labelDy?: number
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

/* An end of a connector.
 *
 * `part` names something *inside* the node — today, one neuron of an `mlp`, by
 * the keys mlp.ts mints. It is what lets a connector land on a single unit of a
 * network without that unit having to be a node of its own, which it cannot be
 * if its position is to stay under the lattice's control.
 *
 * ⚠️ A part can stop being drawn — the layer shrinks, or the ellipsis swallows
 * it. The connector then falls back to the node as a whole rather than
 * disappearing: an edit about layer sizes must not silently delete edges. */
export type EndPoint =
  | { node: string; anchor: Anchor; part?: string }
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
