/* Bulk connect.
 *
 * The two things that make `fullyConnect` useful are also the two that are easy
 * to get wrong: deciding where one layer ends and the next begins, and not
 * wiring a layer's container box as if it were a unit. Both are invisible when
 * you eyeball a single figure — a container that sneaks in adds one plausible
 * looking extra line per unit. */

import { describe, expect, it } from 'vitest'
import { columnsOf, emptyDoc, fullyConnect, removeItems } from './doc'
import { makeNode, paletteById } from './presets'
import type { EndPoint, FigDoc, FigEdge, FigNode } from './types'

const P = paletteById('muted')

/** An endpoint is a node reference or a free point; these edges are always the
 *  former, but the union still has to be narrowed to read the id. */
const endId = (p: EndPoint) => ('node' in p ? p.node : '')
const pairOf = (e: FigEdge) => `${endId(e.from)}${endId(e.to)}`

function at(id: string, x: number, y: number, w = 40, h = 40): FigNode {
  return { ...makeNode('ellipse', 0, 0, P, 12), id, x, y, w, h }
}

function docOf(nodes: FigNode[]): FigDoc {
  return { ...emptyDoc(), nodes }
}

describe('columnsOf', () => {
  it('splits on the gaps between layers, not between units', () => {
    const nodes = [
      at('a0', 0, 0),
      at('a1', 0, 60),
      at('b0', 200, 0),
      at('b1', 200, 60),
      at('b2', 200, 120),
    ]
    const cols = columnsOf(nodes)
    expect(cols.map((c) => c.map((n) => n.id))).toEqual([
      ['a0', 'a1'],
      ['b0', 'b1', 'b2'],
    ])
  })

  it('orders columns left to right and units top to bottom', () => {
    const cols = columnsOf([at('r1', 300, 90), at('l0', 0, 0), at('r0', 300, 10)])
    expect(cols.map((c) => c.map((n) => n.id))).toEqual([['l0'], ['r0', 'r1']])
  })
})

describe('fullyConnect', () => {
  it('wires every unit of a column to every unit of the next', () => {
    const d = docOf([
      at('a0', 0, 0),
      at('a1', 0, 60),
      at('b0', 200, 0),
      at('b1', 200, 60),
      at('b2', 200, 120),
    ])
    const r = fullyConnect(d, d.nodes.map((n) => n.id))
    expect(r.columns).toBe(2)
    expect(r.edgeIds).toHaveLength(2 * 3)
    // plain lines: an arrowhead per synapse is unreadable at this density
    expect(r.doc.edges.every((e) => e.endHead === 'none')).toBe(true)
  })

  it('chains three columns without wiring the first to the last', () => {
    const d = docOf([at('a', 0, 0), at('b', 200, 0), at('c', 400, 0)])
    const r = fullyConnect(d, ['a', 'b', 'c'])
    expect(r.columns).toBe(3)
    const pairs = r.doc.edges.map(pairOf)
    expect(pairs.sort()).toEqual(['ab', 'bc'])
  })

  it('ignores a layer container that encloses its own units', () => {
    const box = { ...makeNode('rect', 0, 0, P, 12), id: 'box', x: -10, y: -10, w: 60, h: 130 }
    const d = docOf([box, at('a0', 0, 0), at('a1', 0, 60), at('b0', 200, 0)])
    const r = fullyConnect(d, ['box', 'a0', 'a1', 'b0'])
    expect(r.edgeIds).toHaveLength(2)
    expect(r.doc.edges.some((e) => pairOf(e).includes('box'))).toBe(false)
  })

  it('does nothing when the selection is a single column', () => {
    const d = docOf([at('a0', 0, 0), at('a1', 0, 60)])
    const r = fullyConnect(d, ['a0', 'a1'])
    expect(r.edgeIds).toHaveLength(0)
    expect(r.doc).toBe(d)
  })
})

/* Deleting a block used to take its connectors with it, so pulling one step
 * out of a chain left the two halves with no way back together. */
describe('removeItems', () => {
  const chain = (ids: string[]): FigDoc => {
    const nodes = ids.map((id, i) => at(id, i * 200, 0))
    const edges = ids.slice(1).map((id, i) => ({
      id: `e${i}`,
      from: { node: ids[i], anchor: 'auto' as const },
      to: { node: id, anchor: 'auto' as const },
      route: 'straight' as const,
      waypoints: [],
      startHead: 'none' as const,
      endHead: 'arrow' as const,
      label: '',
      labelT: 0.5,
      labelDx: 0,
      labelDy: 0,
      bow: 24,
      style: { ...paletteById('muted') && baseEdge() },
      locked: false,
      hidden: false,
    }))
    return { ...emptyDoc(), nodes, edges }
  }
  const baseEdge = () => ({
    stroke: '#222', strokeWidth: 1.4, dash: 'solid' as const, opacity: 1,
    fontFamily: 'sans' as const, fontSize: 11, textColor: '#222', labelBg: 'none',
  })

  it('joins what came before to what came after', () => {
    const r = removeItems(chain(['a', 'b', 'c']), ['b'], [])
    expect(r.nodes.map((n) => n.id)).toEqual(['a', 'c'])
    expect(r.edges.map(pairOf)).toEqual(['ac'])
  })

  it('closes a run of several deleted blocks in one hop', () => {
    const r = removeItems(chain(['a', 'b', 'c', 'd']), ['b', 'c'], [])
    expect(r.edges.map(pairOf)).toEqual(['ad'])
  })

  it('carries the incoming line to every branch the block fed', () => {
    const d = chain(['a', 'b'])
    d.nodes.push(at('c', 400, 0), at('x', 400, 200))
    d.edges.push(
      { ...d.edges[0], id: 'e1', from: { node: 'b', anchor: 'auto' }, to: { node: 'c', anchor: 'auto' } },
      { ...d.edges[0], id: 'e2', from: { node: 'b', anchor: 'auto' }, to: { node: 'x', anchor: 'auto' } },
    )
    const r = removeItems(d, ['b'], [])
    expect(r.edges.map(pairOf).sort()).toEqual(['ac', 'ax'])
  })

  it('invents nothing when the block was an end of the chain', () => {
    const r = removeItems(chain(['a', 'b']), ['b'], [])
    expect(r.edges).toEqual([])
  })

  it('does not duplicate a connection that already exists', () => {
    const d = chain(['a', 'b', 'c'])
    d.edges.push({ ...d.edges[0], id: 'direct', from: { node: 'a', anchor: 'auto' }, to: { node: 'c', anchor: 'auto' } })
    const r = removeItems(d, ['b'], [])
    expect(r.edges.map(pairOf)).toEqual(['ac'])
  })
})
