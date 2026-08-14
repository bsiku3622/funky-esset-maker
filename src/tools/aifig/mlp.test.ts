/* The MLP lattice.
 *
 * The load-bearing claim is the one in `mlp.ts`'s header: get `r`, `pitch` and
 * `layerGap` onto the right multiples of the grid, and every circle in every
 * column lands on the editor's position lattice — without rounding a single
 * circle into place, which would have destroyed the equal spacing. That is what
 * most of this file is checking, from several directions. */

import { describe, expect, it } from 'vitest'
import {
  MLP_SLOT_CAP,
  dotKey,
  evenGaps,
  isLattice,
  mlpAnchorPoint,
  mlpDotAt,
  mlpGroupAt,
  mlpGaps,
  mlpGroupOverflow,
  mlpHit,
  mlpPartRect,
  mlpPartCentre,
  mlpLattice,
  mlpNaturalSize,
  mlpSnapProps,
  mlpSlots,
  mlpWireAt,
  parseDotKey,
  retypeLayers,
  wireKey,
} from './mlp'
import { snapPos } from './geometry'
import { resolveEdge } from './resolve'
import { patchMlpPart } from './doc'
import { neuronLabelStyle } from './layout'
import type { FigDoc, FigNode, NodeProps, Style } from './types'

const STYLE: Style = {
  fill: '#ffffff',
  stroke: '#222222',
  strokeWidth: 1,
  dash: 'solid',
  opacity: 1,
  radius: 0,
  fontFamily: 'latex',
  fontSize: 13,
  fontWeight: 400,
  italic: false,
  textColor: '#222222',
  align: 'center',
  lineHeight: 1.25,
}

const node = (props: NodeProps, box?: Partial<FigNode>): FigNode =>
  ({
    id: 'm1',
    kind: 'mlp',
    x: 100,
    y: 100,
    w: 128,
    h: 112,
    rotation: 0,
    style: STYLE,
    props,
    ...box,
  }) as FigNode

/** A node whose box is exactly what its lattice needs, placed on the grid. */
const fitted = (props: NodeProps, grid = 8): FigNode => {
  const p = { ...props, ...mlpSnapProps(props, grid) }
  const size = mlpNaturalSize(p)!
  return node(p, { x: snapPos(100, grid), y: snapPos(60, grid), ...size })
}

describe('equal spacing', () => {
  it('gives every column the same pitch, whatever its size', () => {
    const n = fitted({ layers: [2, 5, 3], pitch: 24, layerGap: 56, neuronR: 8 })
    const gaps = new Set<number>()
    for (const col of [0, 1, 2]) {
      const ys = mlpLattice(n)
        .dots.filter((d) => d.li === col)
        .map((d) => d.y)
        .sort((a, b) => a - b)
      for (let i = 1; i < ys.length; i++) gaps.add(+(ys[i] - ys[i - 1]).toFixed(6))
    }
    expect([...gaps]).toEqual([24])
  })

  it('centres every column on the same line', () => {
    const n = fitted({ layers: [2, 5, 3], pitch: 24, layerGap: 56, neuronR: 8 })
    const l = mlpLattice(n)
    const mid = (li: number) => {
      const ys = l.dots.filter((d) => d.li === li).map((d) => d.y)
      return (Math.min(...ys) + Math.max(...ys)) / 2
    }
    expect(mid(0)).toBeCloseTo(mid(1), 6)
    expect(mid(1)).toBeCloseTo(mid(2), 6)
  })

  it('spaces the columns by layerGap', () => {
    const n = fitted({ layers: [2, 5, 3], pitch: 24, layerGap: 56, neuronR: 8 })
    const xs = [...new Set(mlpLattice(n).dots.map((d) => d.x))].sort((a, b) => a - b)
    expect(xs[1] - xs[0]).toBe(56)
    expect(xs[2] - xs[1]).toBe(56)
  })
})

describe('the old stretch behaviour', () => {
  /* Files written before the lattice existed have no pitch. Their figures must
     look exactly as they did, which means columns of different sizes keep their
     different spacings — the very thing the lattice was added to fix. */
  it('is what a node without a pitch still gets', () => {
    const p = { layers: [3, 5], showEdges: true, neuronR: 5 }
    expect(isLattice(p)).toBe(false)
    const n = node(p, { x: 0, y: 0, w: 116, h: 78 })
    const l = mlpLattice(n)
    const col = (li: number) => l.dots.filter((d) => d.li === li).map((d) => d.y)
    const [a0, a1] = col(0)
    const [b0, b1] = col(1)
    // three units span the same box as five, so their spacings differ
    expect(a1 - a0).toBeCloseTo((78 - 10) / 2, 6)
    expect(b1 - b0).toBeCloseTo((78 - 10) / 4, 6)
  })

  it('still fills the box edge to edge', () => {
    const n = node({ layers: [4], neuronR: 6 }, { x: 0, y: 0, w: 100, h: 80 })
    const ys = mlpLattice(n).dots.map((d) => d.y)
    expect(Math.min(...ys)).toBe(6)
    expect(Math.max(...ys)).toBe(74)
  })

  it('is measured from the top-left of the node, not the canvas', () => {
    const p = { layers: [3], neuronR: 6 }
    const here = mlpLattice(node(p, { x: 0, y: 0, w: 100, h: 80 })).dots.map((d) => d.y)
    const far = mlpLattice(node(p, { x: 900, y: 500, w: 100, h: 80 })).dots.map((d) => d.y)
    expect(far).toEqual(here)
  })
})

describe('eliding a big layer', () => {
  it('keeps the first units and the last, with a ⋮ between', () => {
    expect(mlpSlots({ layers: [64], maxDots: 4 })[0]).toEqual([0, 1, 2, -1, 63])
  })

  it('draws a short column whole', () => {
    expect(mlpSlots({ layers: [3], maxDots: 6 })[0]).toEqual([0, 1, 2])
  })

  it('puts one gap mark in the elided column and none in the others', () => {
    const n = fitted({ layers: [3, 40], maxDots: 4, pitch: 24, layerGap: 56, neuronR: 8 })
    const l = mlpLattice(n)
    expect(l.gaps).toHaveLength(1)
    expect(l.gaps[0].li).toBe(1)
    expect(l.dots.filter((d) => d.li === 1).map((d) => d.n)).toEqual([0, 1, 2, 39])
  })

  it('reports the real size of the layer even though it draws four circles', () => {
    const n = fitted({ layers: [3, 40], maxDots: 4, pitch: 24, layerGap: 56, neuronR: 8 })
    expect(mlpLattice(n).cols[1].count).toBe(40)
  })

  it('wires only what is drawn', () => {
    const n = fitted({ layers: [2, 40], maxDots: 4, pitch: 24, layerGap: 56, neuronR: 8 })
    // 2 drawn units in, 4 drawn in the next column
    expect(mlpLattice(n).wires).toHaveLength(8)
  })

  it('never draws more than the hard cap', () => {
    const n = fitted({ layers: [500], pitch: 24, layerGap: 56, neuronR: 8 })
    expect(mlpLattice(n).dots.length).toBeLessThanOrEqual(MLP_SLOT_CAP)
  })
})

describe('positions forced onto the grid', () => {
  /* The claim from mlp.ts's header, checked over a spread of shapes rather than
     one lucky case: r on the half-cell, pitch and gap on the cell, and every
     centre lands on the lattice snapPos rounds to. */
  const grid = 8
  const cases: NodeProps[] = [
    { layers: [4, 5, 3], pitch: 24, layerGap: 56, neuronR: 8 },
    { layers: [2, 2], pitch: 16, layerGap: 24, neuronR: 4 },
    { layers: [1, 6, 1], pitch: 30, layerGap: 50, neuronR: 7 },
    { layers: [3, 40, 3], maxDots: 5, pitch: 25, layerGap: 33, neuronR: 6 },
  ]

  for (const p of cases) {
    it(`holds for ${JSON.stringify(p.layers)} at pitch ${p.pitch}`, () => {
      const n = fitted(p, grid)
      const l = mlpLattice(n)
      // the lattice is local, so the canvas position is what has to land
      for (const d of [...l.dots, ...l.gaps]) {
        expect(n.x + d.x).toBe(snapPos(n.x + d.x, grid))
        expect(n.y + d.y).toBe(snapPos(n.y + d.y, grid))
      }
    })
  }

  it('rounds the parameters to the multiples the proof needs', () => {
    const s = mlpSnapProps({ neuronR: 7, pitch: 25, layerGap: 33 }, 8)
    expect(s.neuronR! % 4).toBe(0)
    expect(s.pitch! % 8).toBe(0)
    expect(s.layerGap! % 8).toBe(0)
  })

  it('never lets circles in a column touch', () => {
    const s = mlpSnapProps({ neuronR: 8, pitch: 4 }, 8)
    expect(s.pitch).toBeGreaterThanOrEqual(16)
  })
})

describe('the box follows the lattice', () => {
  it('is exactly what the circles span', () => {
    const p = { layers: [4, 5, 3], pitch: 24, layerGap: 56, neuronR: 8 }
    expect(mlpNaturalSize(p)).toEqual({ w: 16 + 2 * 56, h: 16 + 4 * 24 })
  })

  it('has no answer in stretch mode, where the box is the input', () => {
    expect(mlpNaturalSize({ layers: [4, 5, 3], neuronR: 5 })).toBeNull()
  })

  it('leaves the circles inside it', () => {
    const n = fitted({ layers: [4, 5, 3], pitch: 24, layerGap: 56, neuronR: 8 })
    for (const d of mlpLattice(n).dots) {
      expect(d.x - d.r).toBeGreaterThanOrEqual(-0.001)
      expect(d.x + d.r).toBeLessThanOrEqual(n.w + 0.001)
      expect(d.y - d.r).toBeGreaterThanOrEqual(-0.001)
      expect(d.y + d.r).toBeLessThanOrEqual(n.h + 0.001)
    }
  })
})

describe('picking a part out of a network', () => {
  /* The editor's hit layer is one rectangle per node, so a click on a neuron
     arrives as a click on the network. These are what tell the two apart. */
  const n = fitted({ layers: [2, 2], pitch: 40, layerGap: 96, neuronR: 12 })
  const canvas = (key: string) => mlpPartCentre(n, key)!

  it('finds the circle under the pointer', () => {
    expect(mlpDotAt(n, canvas('l0n1'))?.key).toBe(dotKey(0, 1))
  })

  it('finds nothing in the space between circles', () => {
    // halfway down a pitch of 40 is 20 from each centre, and the radius is 12
    const a = canvas('l0n0')
    expect(mlpDotAt(n, { x: a.x, y: a.y + 20 })).toBeNull()
  })

  it('finds the wire under the pointer', () => {
    const a = canvas('l0n0')
    const b = canvas('l1n0')
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    expect(mlpWireAt(n, mid)?.key).toBe(wireKey(0, 0, 0))
  })

  it('gives the circle to the neuron, not to the wires that end in it', () => {
    // every wire of a layer converges on its neuron; the neuron is what was meant
    expect(mlpWireAt(n, canvas('l1n0'))).toBeNull()
  })

  it('ignores a wire that has been switched off', () => {
    const off = { ...n, props: { ...n.props, wires: { [wireKey(0, 0, 0)]: { hidden: true } } } }
    const a = canvas('l0n0')
    const b = canvas('l1n0')
    expect(mlpWireAt(off, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })?.key).not.toBe(
      wireKey(0, 0, 0),
    )
  })

  it('follows the node when it is rotated', () => {
    const spun = { ...n, rotation: 37 }
    for (const key of [dotKey(0, 0), dotKey(1, 1)])
      expect(mlpDotAt(spun, mlpPartCentre(spun, key)!)?.key).toBe(key)
  })
})

describe('a connector attached to one neuron', () => {
  const n = fitted({ layers: [2, 2], pitch: 40, layerGap: 96, neuronR: 12 })

  it('meets the circle on its rim, facing the other end', () => {
    const c = mlpPartCentre(n, dotKey(0, 0))!
    const a = mlpAnchorPoint(n, dotKey(0, 0), 'auto', { x: c.x + 500, y: c.y })!
    expect(a.p).toEqual({ x: c.x + 12, y: c.y })
    expect(a.dir).toEqual({ x: 1, y: 0 })
  })

  it('leaves from the side it was told to, whatever is at the other end', () => {
    /* The whole point of the four fixed sides: two wires out of one unit have
       to be able to leave from different places, or they lie on top of one
       another. This used to be ignored for a neuron. */
    const c = mlpPartCentre(n, dotKey(0, 0))!
    const away = { x: c.x + 500, y: c.y }
    expect(mlpAnchorPoint(n, dotKey(0, 0), 'n', away)!.p).toEqual({ x: c.x, y: c.y - 12 })
    expect(mlpAnchorPoint(n, dotKey(0, 0), 's', away)!.p).toEqual({ x: c.x, y: c.y + 12 })
    expect(mlpAnchorPoint(n, dotKey(0, 0), 'w', away)!.p).toEqual({ x: c.x - 12, y: c.y })
  })

  it('puts the diagonals on the rim, which a circle actually has', () => {
    const c = mlpPartCentre(n, dotKey(0, 0))!
    const p = mlpAnchorPoint(n, dotKey(0, 0), 'ne', { x: 0, y: 0 })!.p
    expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(12, 6)
    expect(p.x).toBeGreaterThan(c.x)
    expect(p.y).toBeLessThan(c.y)
  })

  it('sits at the centre when the anchor asks for it', () => {
    const c = mlpPartCentre(n, dotKey(0, 0))!
    expect(mlpAnchorPoint(n, dotKey(0, 0), 'c', { x: 0, y: 0 })!.p).toEqual(c)
  })

  it('still has a direction when both ends are the same point', () => {
    const c = mlpPartCentre(n, dotKey(0, 0))!
    expect(mlpAnchorPoint(n, dotKey(0, 0), 'auto', c)!.dir).toEqual({ x: 1, y: 0 })
  })

  it('has no answer for a unit that is not drawn — the caller falls back', () => {
    /* ⚠️ This is why resolve.ts treats null as "use the node instead". Shrinking
       a layer must not delete the connectors that pointed into it. */
    expect(mlpAnchorPoint(n, dotKey(0, 9), 'auto', { x: 0, y: 0 })).toBeNull()
    expect(mlpPartCentre(n, dotKey(5, 0))).toBeNull()
  })
})

describe('a connector whose neuron disappeared', () => {
  /* Shrinking a layer, or lowering the ellipsis threshold, can take away the
     unit an edge was attached to. The edge has to survive that: the edit was
     about layer sizes, and losing connectors to it would be data loss with no
     undo prompt attached. */
  const net = fitted({ layers: [2, 6], pitch: 40, layerGap: 96, neuronR: 12 })
  const edge = {
    id: 'e1',
    from: { node: 'm1', anchor: 'auto' as const, part: dotKey(0, 0) },
    to: { node: 'm1', anchor: 'auto' as const, part: dotKey(1, 5) },
    route: 'straight' as const,
    waypoints: [],
    startHead: 'none' as const,
    endHead: 'arrow' as const,
    label: '',
    labelT: 0.5,
    labelDx: 0,
    labelDy: 0,
    bow: 0,
    style: {
      stroke: '#000',
      strokeWidth: 1,
      dash: 'solid' as const,
      opacity: 1,
      fontFamily: 'sans' as const,
      fontSize: 11,
      textColor: '#000',
      labelBg: 'none',
    },
    locked: false,
    hidden: false,
  }

  it('lands on the two circles while they are both drawn', () => {
    const r = resolveEdge(edge, new Map([['m1', net]]))!
    const a = mlpPartCentre(net, dotKey(0, 0))!
    // on the rim, 12 out from the centre it belongs to
    expect(Math.hypot(r.a.p.x - a.x, r.a.p.y - a.y)).toBeCloseTo(12, 6)
  })

  it('falls back to the node when the layer shrinks under it', () => {
    const small = { ...net, props: { ...net.props, layers: [2, 2] } }
    const r = resolveEdge(edge, new Map([['m1', small]]))
    expect(r).not.toBeNull()
    // no longer on a circle: it is now an anchor on the network's own outline
    expect(mlpPartCentre(small, dotKey(1, 5))).toBeNull()
  })
})

describe('overriding one part', () => {
  const net = fitted({ layers: [2, 2], pitch: 40, layerGap: 96, neuronR: 16 })
  const doc = { nodes: [net, { ...net, id: 'other' }], edges: [], canvas: {}, paletteId: 'muted' } as never as FigDoc
  const at = { node: 'm1', key: dotKey(0, 0) }

  it('creates the bag on first use', () => {
    const d = patchMlpPart(doc, at, 'neurons', { fill: '#f00' })
    expect(d.nodes[0].props.neurons).toEqual({ l0n0: { fill: '#f00' } })
  })

  it('merges rather than replaces', () => {
    let d = patchMlpPart(doc, at, 'neurons', { fill: '#f00' })
    d = patchMlpPart(d, at, 'neurons', { label: 'x' })
    expect(d.nodes[0].props.neurons?.l0n0).toEqual({ fill: '#f00', label: 'x' })
  })

  it('leaves the other neurons and the other node alone', () => {
    const d = patchMlpPart(doc, at, 'neurons', { fill: '#f00' })
    expect(d.nodes[0].props.neurons?.[dotKey(0, 1)]).toBeUndefined()
    expect(d.nodes[1].props.neurons).toBeUndefined()
  })

  it('never touches the node style — that is the whole point', () => {
    /* Focusing a neuron makes it the subject; a swatch press has to land on it
       and not on the network, or one click repaints every unit. */
    const d = patchMlpPart(doc, at, 'neurons', { fill: '#f00' })
    expect(d.nodes[0].style.fill).toBe(net.style.fill)
  })

  it('clears an entry back to the default rather than freezing the current colour', () => {
    let d = patchMlpPart(doc, at, 'neurons', { fill: '#f00' })
    d = patchMlpPart(d, at, 'neurons', null)
    // and the emptied bag goes too, so an untouched network serialises as before
    expect(d.nodes[0].props.neurons).toBeUndefined()
  })

  it('keeps the bag while anything is left in it', () => {
    let d = patchMlpPart(doc, at, 'neurons', { fill: '#f00' })
    d = patchMlpPart(d, { node: 'm1', key: dotKey(0, 1) }, 'neurons', { fill: '#0f0' })
    d = patchMlpPart(d, at, 'neurons', null)
    expect(Object.keys(d.nodes[0].props.neurons ?? {})).toEqual([dotKey(0, 1)])
  })

  it('does the same for wires', () => {
    const d = patchMlpPart(doc, { node: 'm1', key: wireKey(0, 0, 1) }, 'wires', { hidden: true })
    expect(d.nodes[0].props.wires).toEqual({ [wireKey(0, 0, 1)]: { hidden: true } })
  })
})

describe('text inside a circle', () => {
  it('shrinks to fit the circle but never grows to fill it', () => {
    const n = fitted({ layers: [1], pitch: 40, layerGap: 96, neuronR: 16 })
    // r 16 allows 24; a 15px label stays 15
    expect(neuronLabelStyle({ ...n, style: { ...n.style, fontSize: 40 } }, 16).fontSize).toBe(24)
    expect(neuronLabelStyle({ ...n, style: { ...n.style, fontSize: 15 } }, 16).fontSize).toBe(15)
  })

  it('centres it, whatever the node alignment was', () => {
    const n = fitted({ layers: [1], pitch: 40, layerGap: 96, neuronR: 16 })
    expect(neuronLabelStyle({ ...n, style: { ...n.style, align: 'right' } }, 16).align).toBe('center')
  })

  it('reads the network mode unless the unit says otherwise', () => {
    const n = fitted({ layers: [1], pitch: 40, layerGap: 96, neuronR: 16 })
    expect(n.style.fontFamily).toBe('latex')
    expect(neuronLabelStyle(n, 16).fontFamily).toBe('latex')
    expect(neuronLabelStyle(n, 16, {}).fontFamily).toBe('latex')
    // one circle carrying a word among a column of symbols
    expect(neuronLabelStyle(n, 16, { fontFamily: 'sans' }).fontFamily).toBe('sans')
  })
})

describe('a group of neurons', () => {
  const held = [dotKey(0, 0), dotKey(0, 1)]
  const n = fitted({
    layers: [3, 2],
    pitch: 40,
    layerGap: 96,
    neuronR: 12,
    groups: { g0: { parts: held } },
  })

  it('encloses everything it holds, with room to breathe', () => {
    const r = mlpPartRect(n, 'g0')!
    const dots = mlpLattice(n).dots.filter((d) => held.includes(d.key))
    for (const d of dots) {
      expect(d.x - d.r).toBeGreaterThan(r.x)
      expect(d.x + d.r).toBeLessThan(r.x + r.w)
      expect(d.y - d.r).toBeGreaterThan(r.y)
      expect(d.y + d.r).toBeLessThan(r.y + r.h)
    }
  })

  it('leaves out the units it does not hold', () => {
    const r = mlpPartRect(n, 'g0')!
    const other = mlpLattice(n).dots.find((d) => d.key === dotKey(0, 2))!
    expect(other.y - other.r).toBeGreaterThan(r.y + r.h)
  })

  it('takes a connector on its own edge, not on a member circle', () => {
    const c = mlpPartCentre(n, 'g0')!
    const r = mlpPartRect(n, 'g0')!
    const a = mlpAnchorPoint(n, 'g0', 'e', { x: c.x + 500, y: c.y })!
    expect(a.p.x).toBeCloseTo(c.x + r.w / 2, 6)
    expect(a.p.y).toBeCloseTo(c.y, 6)
  })

  it('stops the ray at whichever side it reaches first', () => {
    /* A group is a box, so a diagonal must not sail out past the corner the
       way it would from a circle's rim. */
    const c = mlpPartCentre(n, 'g0')!
    const r = mlpPartRect(n, 'g0')!
    const p = mlpAnchorPoint(n, 'g0', 'ne', { x: 0, y: 0 })!.p
    expect(Math.abs(p.x - c.x)).toBeLessThanOrEqual(r.w / 2 + 0.001)
    expect(Math.abs(p.y - c.y)).toBeLessThanOrEqual(r.h / 2 + 0.001)
  })

  /* ⚠️ Picked anywhere inside, not on its outline alone. The units it holds
     stay reachable because the caller asks about the circles first — an
     outline-only target just meant a box you had to hit within a few pixels. */
  it('is picked anywhere inside it', () => {
    const r = mlpPartRect(n, 'g0')!
    const onEdge = { x: n.x + r.x, y: n.y + r.y + r.h / 2 }
    const middle = { x: n.x + r.x + r.w / 2, y: n.y + r.y + r.h / 2 }
    const outside = { x: n.x + r.x + r.w + 40, y: n.y + r.y }
    expect(mlpGroupAt(n, onEdge)).toBe('g0')
    expect(mlpGroupAt(n, middle)).toBe('g0')
    expect(mlpGroupAt(n, mlpPartCentre(n, dotKey(0, 0))!)).toBe('g0')
    expect(mlpGroupAt(n, outside)).toBeNull()
  })

  it('lets the smaller of two nested groups win', () => {
    const nested = {
      ...n,
      props: {
        ...n.props,
        groups: {
          g0: { parts: [dotKey(0, 0), dotKey(0, 1), dotKey(0, 2)] },
          g1: { parts: [dotKey(0, 0)] },
        },
      },
    }
    expect(mlpGroupAt(nested, mlpPartCentre(nested, dotKey(0, 0))!)).toBe('g1')
    expect(mlpGroupAt(nested, mlpPartCentre(nested, dotKey(0, 2))!)).toBe('g0')
  })

  it('has no rectangle once its members are gone', () => {
    const shrunk = { ...n, props: { ...n.props, layers: [1, 2] } }
    expect(mlpPartRect(shrunk, 'g0')).not.toBeNull() // l0n0 survives
    const gone = { ...n, props: { ...n.props, groups: { g0: { parts: [dotKey(9, 9)] } } } }
    expect(mlpPartRect(gone, 'g0')).toBeNull()
  })

  it('follows the layers when one is spliced in', () => {
    /* ⚠️ Members are neuron keys, so a group is one more thing filed by layer
       number — the same trap as the fills and the captions. */
    const p: NodeProps = { layers: [3, 2], groups: { g0: { parts: [dotKey(1, 0), dotKey(1, 1)] } } }
    const next = retypeLayers(p, [3, 4, 2])
    expect(next.groups?.g0.parts).toEqual([dotKey(2, 0), dotKey(2, 1)])
  })

  it('goes away when the layer it held is removed', () => {
    const p: NodeProps = { layers: [3, 2], groups: { g0: { parts: [dotKey(1, 0)] } } }
    expect(retypeLayers(p, [3]).groups).toBeUndefined()
  })

  /* Padding is a group's only degree of freedom, so it is what a resize grip
     drags. One side at a time — the whole point is that the box can be pushed
     out on the side the label needs and left alone everywhere else. */
  it('pushes out only the side that was given padding', () => {
    const base = mlpPartRect(n, 'g0')!
    const wide = {
      ...n,
      props: { ...n.props, groups: { g0: { parts: held, pad: [7, 40, 7, 7] as [number, number, number, number] } } },
    }
    const r = mlpPartRect(wide, 'g0')!
    expect(r.x).toBeCloseTo(base.x, 6)
    expect(r.y).toBeCloseTo(base.y, 6)
    expect(r.h).toBeCloseTo(base.h, 6)
    expect(r.w).toBeCloseTo(base.w + 33, 6)
  })

  it('reports how far it hangs outside the node it lives in', () => {
    const o = mlpGroupOverflow(n)
    const r = mlpPartRect(n, 'g0')!
    // the lattice sizes the box from the circles, so the padding is always out
    expect(o.l).toBeCloseTo(-r.x, 6)
    expect(o.t).toBeGreaterThan(0)
    expect(mlpGroupOverflow({ ...n, props: { ...n.props, groups: undefined } })).toEqual({
      l: 0,
      t: 0,
      r: 0,
      b: 0,
    })
  })
})

/* Columns need not be evenly spaced: an input layer standing off from the
 * hidden ones is the usual figure, and forcing one gap on the whole network
 * meant either a cramped input or a stretched everything-else. */
describe('a network whose columns are not evenly spaced', () => {
  const props = { layers: [3, 3, 3], pitch: 40, layerGap: 60, neuronR: 12, gaps: [120, 60] }
  const n = fitted(props)

  it('places each column by the running total of the gaps', () => {
    const xs = [...new Set(mlpLattice(n).dots.map((d) => d.x))].sort((a, b) => a - b)
    expect(xs.length).toBe(3)
    expect(xs[1] - xs[0]).toBeCloseTo(mlpGaps(n.props)[0], 6)
    expect(xs[2] - xs[1]).toBeCloseTo(mlpGaps(n.props)[1], 6)
  })

  it('sizes the box from what the columns actually span', () => {
    const r = n.props.neuronR!
    expect(mlpNaturalSize(n.props)!.w).toBeCloseTo(2 * r + mlpGaps(n.props).reduce((a, b) => a + b, 0), 6)
    expect(n.w).toBeCloseTo(mlpNaturalSize(n.props)!.w, 6)
  })

  /* ⚠️ The grid invariant has to survive uneven columns. It does, because the
     columns are a running total: whole-cell steps keep every prefix on the
     lattice and the centred run on the half-cell. */
  it('still lands every circle on the position lattice', () => {
    const grid = 8
    const snapped = { ...props, ...mlpSnapProps(props, grid) }
    const size = mlpNaturalSize(snapped)!
    const node = { ...n, props: snapped, x: snapPos(100, grid), y: snapPos(60, grid), ...size }
    for (const d of mlpLattice(node).dots) {
      expect(node.x + d.x).toBeCloseTo(snapPos(node.x + d.x, grid), 6)
      expect(node.y + d.y).toBeCloseTo(snapPos(node.y + d.y, grid), 6)
    }
  })

  it('says whether the spacing is even at all', () => {
    expect(evenGaps(n.props)).toBe(false)
    expect(evenGaps({ layers: [3, 3, 3], layerGap: 60, neuronR: 12 })).toBe(true)
  })

  /* ⚠️ The gaps are filed *between* layers, so a splice adds or removes one of
     them. The wide first gap has to stay the first gap — that is the whole
     point of setting it — and the layer that arrives gets the even spacing. */
  it('gains a gap when a layer is inserted and loses one when it goes', () => {
    const raw: NodeProps = { layers: [3, 3, 3], pitch: 40, layerGap: 60, neuronR: 12, gaps: [120, 60] }
    expect(retypeLayers(raw, [3, 4, 3, 3]).gaps).toEqual([120, 60, 60])
    expect(retypeLayers(raw, [3, 3]).gaps).toEqual([120])
  })

  it('leaves an evenly spaced network with nothing to store', () => {
    expect(retypeLayers({ layers: [3, 3], layerGap: 60 }, [3, 3, 3]).gaps).toBeUndefined()
  })
})

/* ⚠️ An orthogonal connector that starts on a neuron used to begin with a
 * diagonal.
 *
 * `anchorPoint` snaps a shape's 'auto' direction to the dominant axis so that
 * an ortho route's first leg is square; `mlpAnchorPoint` points straight at the
 * target instead, because a circle has no faces. Nobody reconciled the two, so
 * the stub off a neuron came out slanted and the "orthogonal" route opened with
 * a short diagonal. The resolver squares a part's anchor for ortho routes. */
describe('an orthogonal connector leaving a neuron', () => {
  const net = fitted({ layers: [2, 2], pitch: 48, layerGap: 96, neuronR: 12 })
  const box = { ...net, id: 'dst', kind: 'rect', x: 420, y: 260, w: 90, h: 50, props: {} } as FigNode
  const nodes = new Map<string, FigNode>([
    [net.id, net],
    ['dst', box],
  ])
  const wire = {
    id: 'e1',
    from: { node: net.id, anchor: 'auto' as const, part: dotKey(1, 0) },
    to: { node: 'dst', anchor: 'auto' as const },
    route: 'ortho' as const,
    waypoints: [],
    startHead: 'none' as const,
    endHead: 'arrow' as const,
    label: '',
    labelT: 0.5,
    labelDx: 0,
    labelDy: 0,
    bow: 0,
    style: {
      stroke: '#000',
      strokeWidth: 1,
      dash: 'solid' as const,
      opacity: 1,
      fontFamily: 'sans' as const,
      fontSize: 11,
      textColor: '#000',
      labelBg: 'none',
    },
    locked: false,
    hidden: false,
  }

  it('has no diagonal in it', () => {
    const r = resolveEdge(wire, nodes)!
    expect(r.corners.length).toBeGreaterThan(2)
    for (let i = 1; i < r.corners.length; i++) {
      const dx = Math.abs(r.corners[i].x - r.corners[i - 1].x)
      const dy = Math.abs(r.corners[i].y - r.corners[i - 1].y)
      expect(dx < 0.01 || dy < 0.01).toBe(true)
    }
  })

  it('leaves the circle at a cardinal point, so the stub is square', () => {
    const r = resolveEdge(wire, nodes)!
    const c = mlpPartCentre(net, dotKey(1, 0))!
    const off = { x: r.a.p.x - c.x, y: r.a.p.y - c.y }
    expect(Math.min(Math.abs(off.x), Math.abs(off.y))).toBeLessThan(0.01)
    expect(Math.hypot(off.x, off.y)).toBeCloseTo(12, 6)
  })

  it('still lets a curve aim wherever it likes', () => {
    // squaring is a rule about orthogonal routes, not a rule about neurons
    const r = resolveEdge({ ...wire, route: 'curve' as const }, nodes)!
    const c = mlpPartCentre(net, dotKey(1, 0))!
    expect(Math.abs(r.a.p.x - c.x)).toBeGreaterThan(0.5)
    expect(Math.abs(r.a.p.y - c.y)).toBeGreaterThan(0.5)
  })
})

/* ⚠️ The bug this closes: a network's rectangle was its click target, and a
   network is mostly holes. Anything drawn in the space between two columns
   could not be reached, because every press inside the bounds was answered by
   the network first. */
describe('what counts as pressing the network', () => {
  const n = fitted({ layers: [2, 2], pitch: 48, layerGap: 96, neuronR: 12 })

  const at = (x: number, y: number) => ({ x: n.x + x, y: n.y + y })

  it('answers for a circle', () => {
    const d = mlpLattice(n).dots[0]
    expect(mlpHit(n, at(d.x, d.y))).toBe(true)
  })

  it('answers for a synapse', () => {
    const w = mlpLattice(n).wires[0]
    expect(mlpHit(n, at((w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2))).toBe(true)
  })

  it('leaves the hole between the columns alone', () => {
    /* Halfway across and a quarter of the way down: well inside the box, and
       clear of both circles and every wire. */
    const local = { x: n.w / 2, y: n.h / 4 }
    const lat = mlpLattice(n)
    for (const d of lat.dots) expect(Math.hypot(d.x - local.x, d.y - local.y)).toBeGreaterThan(d.r)
    expect(mlpHit(n, at(local.x, local.y))).toBe(false)
  })

  it('lets go of the hole even when the network is on top', () => {
    // no wires at all is the worst case — the columns are then all there is
    const bare = { ...n, props: { ...n.props, showEdges: false } }
    expect(mlpHit(bare, at(n.w / 2, n.h / 2))).toBe(false)
  })

  /* A drawn group is one more layer of the network, so the space it encloses
     belongs to it — including the gap between two of the units it holds. */
  it('answers anywhere inside a group box, gap between its units included', () => {
    const g = {
      ...n,
      props: {
        ...n.props,
        showEdges: false,
        groups: { g0: { parts: [dotKey(0, 0), dotKey(0, 1)] } },
      },
    }
    const r = mlpPartRect(g, 'g0')!
    const lat = mlpLattice(g)
    const mid = (lat.dots[0].y + lat.dots[1].y) / 2
    expect(mlpHit(g, at(r.x, r.y + r.h / 2))).toBe(true)
    expect(mlpHit(g, at(lat.dots[0].x, mid))).toBe(true)
    // and outside it the network still lets go
    expect(mlpHit(g, at(r.x + r.w + 30, r.y + r.h / 2))).toBe(false)
  })

  it('does not answer for a group whose box is not drawn', () => {
    const g = {
      ...n,
      props: {
        ...n.props,
        showEdges: false,
        groups: { g0: { parts: [dotKey(0, 0), dotKey(0, 1)], bare: true } },
      },
    }
    const lat = mlpLattice(g)
    const mid = (lat.dots[0].y + lat.dots[1].y) / 2
    expect(mlpHit(g, at(lat.dots[0].x, mid))).toBe(false)
  })

  it('answers for a layer caption', () => {
    const cap = { ...n, props: { ...n.props, showEdges: false, capTop: ['input', ''] } }
    const col = mlpLattice(cap).cols[0]
    expect(mlpHit(cap, at(col.x, col.top - 4))).toBe(true)
    // and the column next to it, which has no caption, still lets go
    const col2 = mlpLattice(cap).cols[1]
    expect(mlpHit(cap, at(col2.x, col2.top - 4))).toBe(false)
  })
})

describe('splicing the layer list', () => {
  /* Keys carry the layer index, so the layer axis moving under them is the one
     change they cannot absorb on their own. Adding a hidden layer used to leave
     the output unit's colour and label filed under the old number, and the
     labelled circle jumped backwards into the middle of the network. */
  const props: NodeProps = {
    layers: [4, 64, 64, 64, 1],
    neurons: { [dotKey(0, 0)]: { label: 't' }, [dotKey(4, 0)]: { label: 'T' } },
    wires: { [wireKey(3, 0, 0)]: { stroke: '#f00' } },
    capTop: ['in', '', '', '', 'out'],
  }

  it('carries the output unit to its new layer', () => {
    const next = retypeLayers(props, [4, 64, 64, 64, 64, 1])
    expect(next.neurons?.[dotKey(5, 0)]).toEqual({ label: 'T' })
    expect(next.neurons?.[dotKey(4, 0)]).toBeUndefined()
  })

  it('leaves the layers before the new one alone', () => {
    const next = retypeLayers(props, [4, 64, 64, 64, 64, 1])
    expect(next.neurons?.[dotKey(0, 0)]).toEqual({ label: 't' })
  })

  it('carries the captions with them', () => {
    const next = retypeLayers(props, [4, 64, 64, 64, 64, 1])
    expect(next.capTop).toEqual(['in', '', '', '', '', 'out'])
  })

  it('moves the wires that still describe the same connection', () => {
    // this one runs from layer 0, well before the splice
    const p2 = { ...props, wires: { [wireKey(0, 0, 0)]: { stroke: '#f00' } } }
    const next = retypeLayers(p2, [4, 64, 64, 64, 64, 1])
    expect(next.wires?.[wireKey(0, 0, 0)]).toEqual({ stroke: '#f00' })
  })

  it('drops the wires whose connection the new layer broke', () => {
    /* ⚠️ The coloured synapse ran from layer 3 to layer 4. A layer dropped in
       between means those two are no longer joined, so the override describes
       nothing — keeping it would repaint some other synapse instead. */
    const next = retypeLayers(props, [4, 64, 64, 64, 64, 1])
    expect(next.wires).toBeUndefined()
  })

  it('drops what was on a removed layer and pulls the rest back', () => {
    const next = retypeLayers(props, [4, 64, 64, 1])
    expect(next.neurons?.[dotKey(3, 0)]).toEqual({ label: 'T' })
    expect(next.capTop).toEqual(['in', '', '', 'out'])
  })

  it('drops the overrides of the layer that went', () => {
    const gone = retypeLayers({ ...props, layers: [4, 1] }, [4])
    expect(gone.neurons?.[dotKey(1, 0)]).toBeUndefined()
  })

  it('says nothing about the keys when only a count changed', () => {
    /* The return is a patch, so leaving a field out is how "unchanged" is
       expressed — the layer axis did not move, and neither did the keys. */
    const next = retypeLayers(props, [4, 64, 32, 64, 1])
    expect(next).toEqual({ layers: [4, 64, 32, 64, 1] })
  })

  it('gives up rather than guessing when the list was rewritten wholesale', () => {
    expect(retypeLayers(props, [2, 3])).toEqual({ layers: [2, 3] })
  })
})

describe('part keys', () => {
  it('name a unit, not a drawn slot', () => {
    /* maxDots 5 draws four head units, then the ⋮, then the last one — so the
       final circle sits in slot 5 while being unit 39. Keying by slot would
       move every override the moment the threshold changed. */
    const n = fitted({ layers: [40], maxDots: 5, pitch: 24, layerGap: 56, neuronR: 8 })
    const last = mlpLattice(n).dots.at(-1)!
    expect(last.slot).toBe(5)
    expect(last.key).toBe(dotKey(0, 39))
  })

  it('survive a change of ellipsis threshold', () => {
    const at = (maxDots: number) =>
      mlpLattice(fitted({ layers: [40], maxDots, pitch: 24, layerGap: 56, neuronR: 8 }))
        .dots.map((d) => d.key)
    expect(at(8)).toContain(dotKey(0, 39))
    expect(at(4)).toContain(dotKey(0, 39))
  })

  it('round-trip', () => {
    expect(parseDotKey(dotKey(2, 7))).toEqual({ li: 2, n: 7 })
    expect(parseDotKey(wireKey(2, 7, 1))).toBeNull()
    expect(parseDotKey('l0gap')).toBeNull()
  })

  it('name a wire by both of its units', () => {
    const n = fitted({ layers: [2, 2], pitch: 24, layerGap: 56, neuronR: 8 })
    expect(mlpLattice(n).wires.map((w) => w.key)).toEqual([
      wireKey(0, 0, 0),
      wireKey(0, 0, 1),
      wireKey(0, 1, 0),
      wireKey(0, 1, 1),
    ])
  })
})
