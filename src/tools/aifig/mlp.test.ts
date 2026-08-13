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
  isLattice,
  mlpAnchorPoint,
  mlpDotAt,
  mlpDotPoint,
  mlpLattice,
  mlpNaturalSize,
  mlpSnapProps,
  mlpSlots,
  mlpWireAt,
  parseDotKey,
  wireKey,
} from './mlp'
import { snapPos } from './geometry'
import { resolveEdge } from './resolve'
import type { FigNode, NodeProps } from './types'

const node = (props: NodeProps, box?: Partial<FigNode>): FigNode =>
  ({
    id: 'm1',
    kind: 'mlp',
    x: 100,
    y: 100,
    w: 128,
    h: 112,
    rotation: 0,
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
  const canvas = (key: string) => mlpDotPoint(n, key)!

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
      expect(mlpDotAt(spun, mlpDotPoint(spun, key)!)?.key).toBe(key)
  })
})

describe('a connector attached to one neuron', () => {
  const n = fitted({ layers: [2, 2], pitch: 40, layerGap: 96, neuronR: 12 })

  it('meets the circle on its rim, facing the other end', () => {
    const c = mlpDotPoint(n, dotKey(0, 0))!
    const a = mlpAnchorPoint(n, dotKey(0, 0), { x: c.x + 500, y: c.y })!
    expect(a.p).toEqual({ x: c.x + 12, y: c.y })
    expect(a.dir).toEqual({ x: 1, y: 0 })
  })

  it('sits at the centre when the anchor asks for it', () => {
    const c = mlpDotPoint(n, dotKey(0, 0))!
    expect(mlpAnchorPoint(n, dotKey(0, 0), { x: 0, y: 0 }, true)!.p).toEqual(c)
  })

  it('still has a direction when both ends are the same point', () => {
    const c = mlpDotPoint(n, dotKey(0, 0))!
    expect(mlpAnchorPoint(n, dotKey(0, 0), c)!.dir).toEqual({ x: 1, y: 0 })
  })

  it('has no answer for a unit that is not drawn — the caller falls back', () => {
    /* ⚠️ This is why resolve.ts treats null as "use the node instead". Shrinking
       a layer must not delete the connectors that pointed into it. */
    expect(mlpAnchorPoint(n, dotKey(0, 9), { x: 0, y: 0 })).toBeNull()
    expect(mlpDotPoint(n, dotKey(5, 0))).toBeNull()
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
    const a = mlpDotPoint(net, dotKey(0, 0))!
    // on the rim, 12 out from the centre it belongs to
    expect(Math.hypot(r.a.p.x - a.x, r.a.p.y - a.y)).toBeCloseTo(12, 6)
  })

  it('falls back to the node when the layer shrinks under it', () => {
    const small = { ...net, props: { ...net.props, layers: [2, 2] } }
    const r = resolveEdge(edge, new Map([['m1', small]]))
    expect(r).not.toBeNull()
    // no longer on a circle: it is now an anchor on the network's own outline
    expect(mlpDotPoint(small, dotKey(1, 5))).toBeNull()
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
