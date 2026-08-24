/* The funky look, applied to a figure at render time.
 *
 * AI Figure Maker was built for papers, so its stored Style holds journal
 * values: hairline strokes, rounded corners, regular weight. The funky look is
 * the same figure drawn the way a slide wants it — 2px black outlines, square
 * corners, a hard offset shadow, bold labels.
 *
 * ⚠️ This is a *render* mode, exactly like paper mode elsewhere in the app: it
 * never touches the document. Everything here takes a Style and returns a new
 * one, so switching back to paper restores the authored figure to the pixel.
 *
 * Colours are deliberately left alone. funky-ui's rule is "structure loud,
 * content quiet" — the loud part is the outline, the shadow and the weight, not
 * a hue this file picked over the one the author chose. Someone who wants neon
 * fills switches to the Funky palette, which recolours the document properly
 * and can be undone.
 *
 * ⚠️ The shadow is a duplicated shape, not an SVG <filter>. Filters are
 * rasterised by Illustrator and Inkscape on import, which would turn a vector
 * figure into a picture of one at the first edit. */

import type { EdgeStyle, FigNode, NodeKind, Style } from './types'

/** funky-ui's ink. Literal rather than `var(--funky-*)`: an exported SVG has no
 *  stylesheet, so a custom property in the markup resolves to nothing. */
export const FUNKY_INK = '#222222'

/** The `sm` hard shadow — 4px 4px 0 0 rgba(0,0,0,.2). Offset and opacity are
 *  split because the offset is a transform and the opacity is a group. */
export const FUNKY_SHADOW = 4
export const FUNKY_SHADOW_OPACITY = 0.2

/** Standard border. funky-ui reserves 3px for real emphasis and mostly uses 2. */
export const FUNKY_STROKE = 2

/** Bold enough to read from the back of the room. */
const FUNKY_WEIGHT = 800

/** Restyle a node's Style for the funky look. */
export function funkyStyle(style: Style): Style {
  return {
    ...style,
    // an outline is the look, so a shape that had none gets one
    stroke: FUNKY_INK,
    strokeWidth: Math.max(style.strokeWidth, FUNKY_STROKE),
    radius: 0,
    fontWeight: Math.max(style.fontWeight, FUNKY_WEIGHT),
  }
}

export const funkyNode = (n: FigNode): FigNode => ({ ...n, style: funkyStyle(n.style) })

/* Which shapes cast one.
 *
 * funky-ui puts a hard shadow under *surfaces* — a card, a panel, a block. A
 * shape that is really a diagram of many parts is not one surface, and
 * duplicating it produces a shadow per part: an MLP's shadow lands on its own
 * synapses and turns the fan into a smear. The same goes for a grid's cells and
 * for shapes that are just a stroke (a brace, a bracket, an inline curve).
 *
 * Text and images are left out too — text casting a shadow is a drop-shadow
 * effect, which is a different look entirely, and a bitmap already has edges. */
const NO_SHADOW: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'mlp',
  'grid',
  'brace',
  'bracket',
  'curve',
  'text',
  'image',
  'frame',
])

export const castsShadow = (kind: NodeKind) => !NO_SHADOW.has(kind)

/** The same node painted flat black, to sit behind the real one as its shadow.
 *
 *  Both fill and stroke go black so the silhouette is solid: a shape with no
 *  fill would otherwise cast a shadow of its outline only, which reads as a
 *  doubled border rather than a shadow. */
export const shadowNode = (n: FigNode): FigNode => ({
  ...n,
  style: {
    ...funkyStyle(n.style),
    fill: '#000000',
    stroke: '#000000',
    // the group carries the opacity; the shape itself must be solid
    opacity: 1,
  },
})

/** Connectors get the same ink and a weight that matches the outlines.
 *
 *  No shadow: funky-ui puts a hard shadow under surfaces, not under lines, and
 *  a doubled connector reads as two connectors. */
export function funkyEdgeStyle(s: EdgeStyle): EdgeStyle {
  return {
    ...s,
    stroke: FUNKY_INK,
    strokeWidth: Math.max(s.strokeWidth, FUNKY_STROKE),
  }
}
