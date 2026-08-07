/* Ready-made architecture blocks.
 *
 * Each template lays itself out in a local frame starting at (0,0); the editor
 * translates it to wherever it is dropped. They are ordinary nodes and edges
 * afterwards — nothing about a template survives insertion, so everything
 * stays editable. Colours come from the active palette, so a template dropped
 * into a "Nature muted" figure matches the rest of it. */

import type { Anchor, FigEdge, FigNode, HeadKind, LabelPos, NodeKind, NodeProps, RouteKind, Style } from './types'
import { baseEdgeStyle, baseStyle, type Palette, tint, uid } from './presets'

interface Bag {
  nodes: FigNode[]
  edges: FigEdge[]
}

interface NodeOpt {
  /** palette colour index; -1 = neutral outline only */
  ci?: number
  fill?: string
  stroke?: string
  labelPos?: LabelPos
  props?: NodeProps
  font?: number
  dash?: Style['dash']
  italic?: boolean
  weight?: number
  align?: Style['align']
  radius?: number
  rotation?: number
  name?: string
}

interface EdgeOpt {
  route?: RouteKind
  label?: string
  from?: Anchor
  to?: Anchor
  head?: HeadKind
  tail?: HeadKind
  dash?: Style['dash']
  bow?: number
  labelT?: number
  labelDx?: number
  labelDy?: number
  waypoints?: { x: number; y: number }[]
  color?: string
}

class Builder {
  nodes: FigNode[] = []
  edges: FigEdge[] = []
  p: Palette
  font: number

  constructor(p: Palette, font: number) {
    this.p = p
    this.font = font
  }

  color(ci?: number) {
    if (ci === undefined || ci < 0) return null
    return this.p.colors[ci % this.p.colors.length]
  }

  n(
    key: string,
    kind: NodeKind,
    x: number,
    y: number,
    w: number,
    h: number,
    label = '',
    o: NodeOpt = {},
  ) {
    const accent = this.color(o.ci)
    const style: Style = {
      ...baseStyle(this.p, o.font ?? this.font),
      ...(accent ? { stroke: accent, fill: tint(accent, 0.84) } : null),
      ...(o.fill ? { fill: o.fill } : null),
      ...(o.stroke ? { stroke: o.stroke } : null),
      ...(o.dash ? { dash: o.dash } : null),
      ...(o.italic ? { italic: true } : null),
      ...(o.weight ? { fontWeight: o.weight } : null),
      ...(o.align ? { align: o.align } : null),
      ...(o.radius !== undefined ? { radius: o.radius } : null),
    }
    const node: FigNode = {
      id: key,
      kind,
      x,
      y,
      w,
      h,
      rotation: o.rotation ?? 0,
      label,
      labelPos: o.labelPos ?? 'center',
      style,
      props: o.props ?? {},
      locked: false,
      hidden: false,
      name: o.name,
    }
    this.nodes.push(node)
    return node
  }

  /** free-standing text label */
  t(key: string, x: number, y: number, label: string, o: NodeOpt = {}) {
    return this.n(key, 'text', x, y, 90, 20, label, {
      ...o,
      fill: 'none',
      stroke: 'none',
    })
  }

  e(from: string, to: string, o: EdgeOpt = {}) {
    const st = baseEdgeStyle(this.p, Math.max(9, this.font - 2))
    const edge: FigEdge = {
      id: uid('e'),
      from: { node: from, anchor: o.from ?? 'auto' },
      to: { node: to, anchor: o.to ?? 'auto' },
      route: o.route ?? 'straight',
      waypoints: o.waypoints ?? [],
      startHead: o.tail ?? 'none',
      endHead: o.head ?? 'arrow',
      label: o.label ?? '',
      labelT: o.labelT ?? 0.5,
      labelDx: o.labelDx ?? 0,
      labelDy: o.labelDy ?? 0,
      bow: o.bow ?? 24,
      style: {
        ...st,
        ...(o.dash ? { dash: o.dash } : null),
        ...(o.color ? { stroke: o.color, textColor: o.color } : null),
      },
      locked: false,
      hidden: false,
    }
    this.edges.push(edge)
    return edge
  }

  chain(ids: string[], o: EdgeOpt = {}) {
    for (let i = 0; i < ids.length - 1; i++) this.e(ids[i], ids[i + 1], o)
  }

  out(): Bag {
    // rewrite the readable keys used above into fresh unique ids
    const map = new Map<string, string>()
    for (const n of this.nodes) {
      const id = uid()
      map.set(n.id, id)
      n.id = id
    }
    for (const e of this.edges) {
      if ('node' in e.from) e.from = { ...e.from, node: map.get(e.from.node) ?? e.from.node }
      if ('node' in e.to) e.to = { ...e.to, node: map.get(e.to.node) ?? e.to.node }
    }
    return { nodes: this.nodes, edges: this.edges }
  }
}

export interface Template {
  id: string
  label: string
  group: string
  note: string
  build: (p: Palette, font: number) => Bag
}

/* ---------- templates ---------- */

const transformerBlock: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  const W = 150
  const x = 40
  b.n('in', 'ellipse', x + 30, 372, 90, 30, 'Input', { ci: -1, font: font - 1 })
  b.n('pe', 'op', x + 152, 375, 24, 24, '', { props: { symbol: '+' }, ci: -1 })
  b.t('pelab', x + 110, 330, 'Positional\\nencoding', { font: font - 3, align: 'center' })
  b.n('mha', 'rect', x, 264, W, 44, 'Multi-Head\\nAttention', { ci: 0, font: font - 1 })
  b.n('an1', 'rect', x, 208, W, 30, 'Add & Norm', { ci: -1, font: font - 2, fill: p.neutral })
  b.n('ffn', 'rect', x, 140, W, 44, 'Feed Forward', { ci: 1, font: font - 1 })
  b.n('an2', 'rect', x, 84, W, 30, 'Add & Norm', { ci: -1, font: font - 2, fill: p.neutral })
  b.n('out', 'ellipse', x + 30, 30, 90, 30, 'Output', { ci: -1, font: font - 1 })
  b.n('rep', 'frame', x - 18, 66, W + 36, 260, '', {
    dash: 'dashed',
    fill: 'none',
    props: { title: 'N ×' },
    font: font - 2,
  })

  b.e('in', 'pe', { to: 's' })
  b.e('pe', 'mha', { from: 'n', to: 's' })
  b.e('mha', 'an1', { from: 'n', to: 's' })
  b.e('an1', 'ffn', { from: 'n', to: 's' })
  b.e('ffn', 'an2', { from: 'n', to: 's' })
  b.e('an2', 'out', { from: 'n', to: 's' })
  // residual bypasses
  b.e('pe', 'an1', {
    route: 'ortho',
    from: 'e',
    to: 'e',
    dash: 'dashed',
    waypoints: [{ x: x + W + 46, y: 387 }, { x: x + W + 46, y: 223 }],
  })
  b.e('an1', 'an2', {
    route: 'ortho',
    from: 'w',
    to: 'w',
    dash: 'dashed',
    waypoints: [{ x: x - 46, y: 223 }, { x: x - 46, y: 99 }],
  })
  return b.out()
}

const attention: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  b.n('q', 'rect', 0, 250, 64, 30, '$Q$', { ci: 0, font })
  b.n('k', 'rect', 88, 250, 64, 30, '$K$', { ci: 1, font })
  b.n('v', 'rect', 176, 250, 64, 30, '$V$', { ci: 2, font })
  b.n('mm1', 'rect', 20, 186, 112, 28, 'MatMul', { ci: -1, font: font - 2, fill: p.neutral })
  b.n('scale', 'rect', 20, 138, 112, 28, 'Scale $1/\\sqrt{d_k}$', { ci: -1, font: font - 3, fill: p.neutral })
  b.n('sm', 'rect', 20, 90, 112, 28, 'SoftMax', { ci: 3, font: font - 2 })
  b.n('mm2', 'rect', 76, 42, 112, 28, 'MatMul', { ci: -1, font: font - 2, fill: p.neutral })
  b.n('o', 'ellipse', 96, -14, 72, 28, 'Output', { ci: -1, font: font - 1 })
  b.e('q', 'mm1', { from: 'n', route: 'ortho' })
  b.e('k', 'mm1', { from: 'n', route: 'ortho' })
  b.chain(['mm1', 'scale', 'sm'], { from: 'n', to: 's' })
  b.e('sm', 'mm2', { from: 'n', route: 'ortho' })
  b.e('v', 'mm2', { from: 'n', route: 'ortho' })
  b.e('mm2', 'o', { from: 'n', to: 's' })
  return b.out()
}

const encoderDecoder: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  b.n('src', 'parallelogram', 0, 60, 96, 38, 'Input $x$', { ci: -1, font: font - 1 })
  b.n('enc', 'trapezoid', 128, 20, 76, 118, 'Encoder', {
    ci: 0,
    props: { taper: 0.5, dir: 'right' },
    font: font - 1,
  })
  b.n('z', 'rect', 232, 60, 52, 38, '$z$', { ci: 2, font })
  b.n('dec', 'trapezoid', 312, 20, 76, 118, 'Decoder', {
    ci: 1,
    props: { taper: 0.5, dir: 'left' },
    font: font - 1,
  })
  b.n('out', 'parallelogram', 416, 60, 100, 38, 'Output $\\hat{y}$', { ci: -1, font: font - 1 })
  b.chain(['src', 'enc', 'z', 'dec', 'out'], { route: 'straight', from: 'e', to: 'w' })
  b.t('lat', 214, 108, 'latent', { font: font - 3 })
  return b.out()
}

const autoencoder: Template['build'] = (p, font) => {
  const bag = encoderDecoder(p, font)
  for (const n of bag.nodes) {
    if (n.label === 'Input $x$') n.label = 'Input $x$'
    if (n.label === 'Output $\\hat{y}$') n.label = 'Recon. $\\hat{x}$'
  }
  return bag
}

const cnnPipeline: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  const specs: [string, number, number, number, string, number][] = [
    // key, x, w, h, label, colorIndex
    ['c1', 0, 54, 96, 'conv', 0],
    ['p1', 96, 44, 78, 'pool', 5],
    ['c2', 178, 44, 78, 'conv', 0],
    ['p2', 264, 36, 60, 'pool', 5],
    ['c3', 336, 36, 60, 'conv', 0],
  ]
  for (const [key, x, w, h, label, ci] of specs) {
    b.n(key, 'cuboid', x, 110 - h / 2, w, h, label, {
      ci,
      labelPos: 'bottom',
      font: font - 3,
      props: { depth: 22, skew: 34 },
    })
  }
  b.n('fc', 'rect', 410, 78, 30, 66, '', { ci: 1 })
  b.n('out', 'rect', 470, 92, 26, 38, '', { ci: 3 })
  b.t('fclab', 396, 154, 'FC', { font: font - 3 })
  b.t('outlab', 452, 154, 'softmax', { font: font - 3 })
  b.chain(['c1', 'p1', 'p2', 'c3', 'fc', 'out'], { from: 'e', to: 'w' })
  b.n('img', 'image', -110, 74, 88, 72, '', { ci: -1, labelPos: 'bottom' })
  b.e('img', 'c1', { from: 'e', to: 'w' })
  return b.out()
}

const resnetBlock: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  b.n('in', 'ellipse', 60, 250, 70, 28, '$x$', { ci: -1 })
  b.n('c1', 'rect', 30, 190, 130, 34, 'Conv 3×3', { ci: 0, font: font - 1 })
  b.n('b1', 'rect', 30, 148, 130, 26, 'BatchNorm', { ci: -1, fill: p.neutral, font: font - 2 })
  b.n('r1', 'rect', 30, 110, 130, 26, 'ReLU', { ci: -1, fill: p.neutral, font: font - 2 })
  b.n('c2', 'rect', 30, 62, 130, 34, 'Conv 3×3', { ci: 0, font: font - 1 })
  b.n('add', 'op', 82, 10, 26, 26, '', { props: { symbol: '+' }, ci: -1 })
  b.n('out', 'ellipse', 60, -50, 70, 28, '$\\mathcal{F}(x)+x$', { ci: -1, font: font - 2 })
  b.chain(['in', 'c1', 'b1', 'r1', 'c2', 'add'], { from: 'n', to: 's' })
  b.e('add', 'out', { from: 'n', to: 's' })
  b.e('in', 'add', {
    route: 'ortho',
    from: 'e',
    to: 'e',
    label: 'identity',
    labelT: 0.5,
    labelDx: 26,
    waypoints: [{ x: 210, y: 264 }, { x: 210, y: 23 }],
  })
  return b.out()
}

const unet: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  const enc: [string, number, number, number][] = [
    ['e1', 0, 0, 110],
    ['e2', 70, 26, 84],
    ['e3', 140, 50, 56],
  ]
  const dec: [string, number, number, number][] = [
    ['d3', 250, 50, 56],
    ['d2', 320, 26, 84],
    ['d1', 390, 0, 110],
  ]
  for (const [k, x, y, h] of enc) b.n(k, 'rect', x, y, 44, h, '', { ci: 0 })
  for (const [k, x, y, h] of dec) b.n(k, 'rect', x, y, 44, h, '', { ci: 1 })
  b.n('bn', 'rect', 196, 66, 44, 30, '', { ci: 3 })
  b.chain(['e1', 'e2', 'e3', 'bn', 'd3', 'd2', 'd1'], { from: 'e', to: 'w', route: 'ortho' })
  const skips: [string, string, number][] = [
    ['e1', 'd1', -26],
    ['e2', 'd2', -6],
    ['e3', 'd3', 14],
  ]
  for (const [a, c, y] of skips)
    b.e(a, c, {
      route: 'ortho',
      from: 'n',
      to: 'n',
      dash: 'dashed',
      label: 'skip',
      labelDy: -8,
      waypoints: [
        { x: 22 + (a === 'e1' ? 0 : a === 'e2' ? 70 : 140), y },
        { x: 412 - (a === 'e1' ? 0 : a === 'e2' ? 70 : 140), y },
      ],
    })
  b.t('encl', 30, 126, 'encoder', { font: font - 3 })
  b.t('decl', 380, 126, 'decoder', { font: font - 3 })
  return b.out()
}

const deeponet: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  const blue = p.colors[0]
  const orange = p.colors[1]
  // branch net — sensor readings of the input function
  b.n('u', 'rect', 0, 22, 106, 34, '$u(x_1),\\dots,u(x_m)$', { ci: -1, font: font - 3 })
  b.n('branch', 'mlp', 132, 0, 116, 78, 'Branch net', {
    ci: 0,
    labelPos: 'top',
    font: font - 1,
    props: { layers: [4, 5, 4], showEdges: true, neuronR: 5 },
    fill: tint(blue, 0.7),
    stroke: blue,
  })
  b.n('bvec', 'rect', 274, 26, 40, 26, '$b_k$', { ci: 0, font: font - 1 })
  // trunk net — the query coordinate
  b.n('y', 'rect', 0, 156, 106, 34, '$y$', { ci: -1, font: font - 1 })
  b.n('trunk', 'mlp', 132, 134, 116, 78, 'Trunk net', {
    ci: 1,
    labelPos: 'bottom',
    font: font - 1,
    props: { layers: [2, 5, 4], showEdges: true, neuronR: 5 },
    fill: tint(orange, 0.7),
    stroke: orange,
  })
  b.n('tvec', 'rect', 274, 160, 40, 26, '$t_k$', { ci: 1, font: font - 1 })
  // merge
  b.n('dot', 'op', 340, 92, 26, 26, '', { props: { symbol: '.' }, ci: -1 })
  b.n('out', 'rect', 392, 86, 122, 38, '$\\mathcal{G}_\\theta(u)(y)$', { ci: -1, font: font - 1 })
  b.e('u', 'branch', { from: 'e', to: 'w' })
  b.e('branch', 'bvec', { from: 'e', to: 'w' })
  b.e('y', 'trunk', { from: 'e', to: 'w' })
  b.e('trunk', 'tvec', { from: 'e', to: 'w' })
  b.e('bvec', 'dot', { route: 'ortho', from: 'e', to: 'n' })
  b.e('tvec', 'dot', { route: 'ortho', from: 'e', to: 's' })
  b.e('dot', 'out', { from: 'e', to: 'w' })
  b.t('sum', 408, 128, '$\\sum_k b_k(u)\\,t_k(y)$', { font: font - 4 })
  return b.out()
}

const pinn: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  b.n('in', 'rect', 0, 74, 66, 32, '$(x,t)$', { ci: -1, font })
  b.n('net', 'mlp', 100, 34, 150, 112, 'NN $_\\theta$', {
    ci: 0,
    labelPos: 'top',
    props: { layers: [2, 5, 5, 1], showEdges: true, neuronR: 5 },
  })
  b.n('u', 'rect', 286, 74, 66, 32, '$\\hat{u}$', { ci: 0, font })
  b.n('ad', 'rect', 286, 8, 128, 34, 'Autodiff $\\partial_x,\\partial_t$', {
    ci: 2,
    font: font - 2,
  })
  b.n('pde', 'rect', 452, 4, 150, 42, '$\\mathcal{L}_{\\mathrm{PDE}}$', { ci: 3, font })
  b.n('data', 'rect', 452, 74, 150, 42, '$\\mathcal{L}_{\\mathrm{data}}$', { ci: 1, font })
  b.n('tot', 'rect', 452, 144, 150, 42, '$\\mathcal{L}=\\mathcal{L}_{\\mathrm{PDE}}+\\lambda\\mathcal{L}_{\\mathrm{data}}$', {
    ci: -1,
    font: font - 3,
    fill: p.neutral,
  })
  b.e('in', 'net', { from: 'e', to: 'w' })
  b.e('net', 'u', { from: 'e', to: 'w' })
  b.e('u', 'ad', { route: 'ortho', from: 'n', to: 'w' })
  b.e('ad', 'pde', { from: 'e', to: 'w' })
  b.e('u', 'data', { from: 'e', to: 'w' })
  b.e('pde', 'tot', { route: 'ortho', from: 'e', to: 'e', waypoints: [{ x: 630, y: 25 }, { x: 630, y: 165 }] })
  b.e('data', 'tot', { route: 'ortho', from: 'e', to: 'e', waypoints: [{ x: 618, y: 95 }, { x: 618, y: 165 }] })
  b.e('tot', 'net', {
    route: 'ortho',
    from: 'w',
    to: 's',
    dash: 'dashed',
    label: 'backprop',
    labelDy: 14,
    waypoints: [{ x: 175, y: 214 }],
  })
  return b.out()
}

const gan: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  b.n('z', 'ellipse', 0, 96, 60, 30, '$z$', { ci: -1 })
  b.n('g', 'trapezoid', 96, 66, 74, 92, '$G$', { ci: 0, props: { taper: 0.4, dir: 'left' }, font })
  b.n('fake', 'image', 206, 78, 74, 66, '', { ci: -1, labelPos: 'bottom', font: font - 3 })
  b.t('fakel', 206, 148, 'fake $\\tilde{x}$', { font: font - 2 })
  b.n('real', 'image', 206, -18, 74, 66, '', { ci: -1 })
  b.t('reall', 206, 52, 'real $x$', { font: font - 2 })
  b.n('d', 'trapezoid', 330, 22, 74, 108, '$D$', { ci: 1, props: { taper: 0.4, dir: 'right' }, font })
  b.n('out', 'rect', 440, 60, 96, 32, 'real / fake', { ci: -1, font: font - 2, fill: p.neutral })
  b.e('z', 'g', { from: 'e', to: 'w' })
  b.e('g', 'fake', { from: 'e', to: 'w' })
  b.e('fake', 'd', { from: 'e', to: 'w' })
  b.e('real', 'd', { from: 'e', to: 'w' })
  b.e('d', 'out', { from: 'e', to: 'w' })
  return b.out()
}

const diffusion: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  const N = 4
  for (let i = 0; i < N; i++) {
    b.n(`x${i}`, 'image', i * 118, 0, 78, 68, '', { ci: -1 })
    b.t(`l${i}`, i * 118, 74, i === 0 ? '$x_0$' : i === N - 1 ? '$x_T$' : `$x_{${i}}$`, {
      font: font - 1,
    })
  }
  for (let i = 0; i < N - 1; i++)
    b.e(`x${i}`, `x${i + 1}`, {
      route: 'arc',
      bow: -18,
      from: 'ne',
      to: 'nw',
      label: '$q(x_{t}\\mid x_{t-1})$',
      labelDy: -6,
      color: p.colors[0],
    })
  for (let i = N - 1; i > 0; i--)
    b.e(`x${i}`, `x${i - 1}`, {
      route: 'arc',
      bow: -18,
      from: 'sw',
      to: 'se',
      label: '$p_\\theta(x_{t-1}\\mid x_t)$',
      labelDy: 8,
      dash: 'dashed',
      color: p.colors[1],
    })
  return b.out()
}

const vit: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  b.n('img', 'grid', 0, 30, 96, 96, 'Patches', {
    ci: 0,
    labelPos: 'bottom',
    font: font - 2,
    props: { rows: 4, cols: 4, gap: 1.5 },
  })
  b.n('proj', 'rect', 142, 56, 104, 44, 'Linear\\nprojection', { ci: 1, font: font - 2 })
  b.n('pos', 'op', 282, 66, 24, 24, '', { props: { symbol: '+' }, ci: -1 })
  b.t('posl', 258, 104, 'pos. emb.', { font: font - 3 })
  b.n('tr', 'stack', 342, 42, 118, 72, 'Transformer\\nEncoder', {
    ci: 2,
    font: font - 2,
    props: { count: 3, offset: 5 },
  })
  b.n('head', 'rect', 500, 56, 92, 44, 'MLP head', { ci: 3, font: font - 2 })
  b.n('cls', 'rect', 500, -8, 92, 32, 'class', { ci: -1, font: font - 2, fill: p.neutral })
  b.chain(['img', 'proj', 'pos', 'tr', 'head'], { from: 'e', to: 'w' })
  b.e('head', 'cls', { from: 'n', to: 's' })
  return b.out()
}

const trainingLoop: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  b.n('data', 'cylinder', 0, 46, 76, 70, 'Dataset', { ci: -1, labelPos: 'bottom', font: font - 2 })
  b.n('batch', 'rect', 122, 62, 88, 36, 'Mini-batch', { ci: -1, font: font - 2, fill: p.neutral })
  b.n('model', 'rect', 254, 54, 108, 52, 'Model $f_\\theta$', { ci: 0, font })
  b.n('loss', 'rect', 406, 58, 96, 44, '$\\mathcal{L}(\\hat y, y)$', { ci: 3, font })
  b.n('opt', 'rect', 254, 172, 108, 40, 'Optimizer', { ci: 1, font: font - 1 })
  b.chain(['data', 'batch', 'model', 'loss'], { from: 'e', to: 'w' })
  b.e('loss', 'opt', {
    route: 'ortho',
    from: 's',
    to: 'e',
    label: '$\\nabla_\\theta\\mathcal{L}$',
    waypoints: [{ x: 454, y: 192 }],
  })
  b.e('opt', 'model', { from: 'n', to: 's', label: 'update $\\theta$', labelDx: 44 })
  return b.out()
}

const mlpOnly: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  b.n('m', 'mlp', 0, 0, 210, 140, '', {
    ci: 0,
    props: { layers: [3, 5, 5, 2], showEdges: true, neuronR: 8 },
  })
  b.t('in', -18, 150, 'input', { font: font - 2 })
  b.t('hid', 74, 150, 'hidden', { font: font - 2 })
  b.t('outl', 176, 150, 'output', { font: font - 2 })
  return b.out()
}

const tensorFlow3d: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  const sizes: [number, number, number][] = [
    [64, 96, 0],
    [52, 78, 0],
    [40, 60, 1],
    [30, 44, 1],
  ]
  let x = 0
  sizes.forEach(([w, h, ci], i) => {
    b.n(`t${i}`, 'cuboid', x, 100 - h / 2, w, h, `$H_{${i + 1}}$`, {
      ci,
      labelPos: 'bottom',
      font: font - 2,
      props: { depth: 26 - i * 3, skew: 34 },
    })
    x += w + 66
  })
  for (let i = 0; i < sizes.length - 1; i++)
    b.e(`t${i}`, `t${i + 1}`, { from: 'e', to: 'w', label: i === 0 ? 'conv' : '' })
  return b.out()
}

const comparisonPanel: Template['build'] = (p, font) => {
  const b = new Builder(p, font)
  const cols = ['Input', 'Ours', 'Baseline', 'GT']
  cols.forEach((c, i) => {
    b.n(`im${i}`, 'image', i * 104, 0, 92, 92, '', { ci: -1 })
    b.t(`lb${i}`, i * 104, 98, c, { font: font - 1, align: 'center', weight: 600 })
  })
  return b.out()
}

export const TEMPLATES: Template[] = [
  { id: 'transformer', label: 'Transformer 블록', group: '아키텍처', note: 'MHA + FFN + residual', build: transformerBlock },
  { id: 'attention', label: 'Scaled Dot-Product Attention', group: '아키텍처', note: 'Q·K·V 흐름', build: attention },
  { id: 'vit', label: 'Vision Transformer', group: '아키텍처', note: '패치 → 임베딩 → 인코더', build: vit },
  { id: 'resnet', label: 'ResNet 블록', group: '아키텍처', note: 'identity skip', build: resnetBlock },
  { id: 'unet', label: 'U-Net', group: '아키텍처', note: '인코더-디코더 + skip', build: unet },
  { id: 'cnn', label: 'CNN 파이프라인', group: '아키텍처', note: '3D 텐서 블록 시퀀스', build: cnnPipeline },
  { id: 'encdec', label: 'Encoder–Decoder', group: '아키텍처', note: 'latent bottleneck', build: encoderDecoder },
  { id: 'autoenc', label: 'Autoencoder', group: '아키텍처', note: '재구성 구조', build: autoencoder },
  { id: 'gan', label: 'GAN', group: '아키텍처', note: 'G / D 적대 구조', build: gan },
  { id: 'diffusion', label: 'Diffusion 과정', group: '아키텍처', note: 'forward / reverse chain', build: diffusion },
  { id: 'deeponet', label: 'DeepONet', group: '연산자 학습', note: 'branch / trunk → 내적', build: deeponet },
  { id: 'pinn', label: 'PINN', group: '연산자 학습', note: 'autodiff → PDE residual', build: pinn },
  { id: 'mlp', label: 'MLP 다이어그램', group: '기본', note: '완전연결 층', build: mlpOnly },
  { id: 'tensor3d', label: '3D 텐서 체인', group: '기본', note: 'feature map 축소', build: tensorFlow3d },
  { id: 'training', label: '학습 루프', group: '기본', note: '데이터 → 손실 → 옵티마이저', build: trainingLoop },
  { id: 'panel', label: '정성 비교 패널', group: '기본', note: 'Input / Ours / GT', build: comparisonPanel },
]
