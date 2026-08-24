/* The two things a structure editor has to get right without being told: how
   many hydrogens an atom has, and which way the next bond goes. Both are
   invisible in the model and obvious in the drawing. */

import { describe, expect, it } from 'vitest'
import {
  BOND,
  addAtom,
  addBond,
  along,
  freeAngle,
  fuseRing,
  implicitH,
  placeRing,
  removeBond,
  type Molecule,
} from './model'

const blank: Molecule = { atoms: [], bonds: [], arrows: [], labels: [] }

/** Build a chain by repeatedly asking where the next bond goes. */
function chain(n: number): Molecule {
  const [start, first] = addAtom(blank, { x: 0, y: 0 })
  let mol = start
  let cur = first
  for (let i = 1; i < n; i++) {
    const a = freeAngle(mol, cur)
    const [next, made] = addAtom(mol, along(cur, a))
    mol = addBond(next, cur.id, made.id)
    cur = made
  }
  return mol
}

describe('chain geometry', () => {
  /* Turning the same way each time walks a chain round a hexagon and closes
     it — which is exactly what the first version did. */
  it('zig-zags instead of curling into a ring', () => {
    const mol = chain(7)
    expect(mol.atoms).toHaveLength(7)
    const xs = mol.atoms.map((a) => a.x)
    // a zig-zag keeps moving in one direction; a curl comes back
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
    // and it stays within one bond of the axis it started on
    const ys = mol.atoms.map((a) => a.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(BOND)
  })

  it('keeps every bond the same length', () => {
    const mol = chain(6)
    for (const b of mol.bonds) {
      const a = mol.atoms.find((q) => q.id === b.a)!
      const c = mol.atoms.find((q) => q.id === b.b)!
      expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeCloseTo(BOND, 6)
    }
  })
})

describe('rings', () => {
  it('places a polygon with one bond per side', () => {
    const mol = placeRing(blank, { x: 0, y: 0 }, 6, true)
    expect(mol.atoms).toHaveLength(6)
    expect(mol.bonds).toHaveLength(6)
    expect(mol.bonds.every((b) => b.aromatic)).toBe(true)
    for (const b of mol.bonds) {
      const a = mol.atoms.find((q) => q.id === b.a)!
      const c = mol.atoms.find((q) => q.id === b.b)!
      expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeCloseTo(BOND, 4)
    }
  })

  /* Fusing shares the bond rather than duplicating it: naphthalene is ten
     atoms and eleven bonds, not twelve and twelve. */
  it('fuses onto an existing bond', () => {
    const one = placeRing(blank, { x: 0, y: 0 }, 6, true)
    const two = fuseRing(one, one.bonds[0], 6, true)
    expect(two.atoms).toHaveLength(10)
    expect(two.bonds).toHaveLength(11)
  })
})

describe('implicit hydrogens', () => {
  const withAtom = (el: string, charge?: number, bonds = 0): Molecule => {
    const [made, a] = addAtom(blank, { x: 0, y: 0 }, el)
    let mol = made
    if (charge) mol = { ...mol, atoms: mol.atoms.map((q) => ({ ...q, charge })) }
    for (let i = 0; i < bonds; i++) {
      const [m, other] = addAtom(mol, { x: BOND * (i + 1), y: 0 })
      mol = addBond(m, a.id, other.id)
    }
    return mol
  }
  const hOf = (mol: Molecule) => implicitH(mol, mol.atoms[0])

  it('writes them on a heteroatom and never on a skeletal carbon', () => {
    expect(hOf(withAtom('O', 0, 1))).toBe(1) // an alcohol's OH
    expect(hOf(withAtom('N', 0, 1))).toBe(2) // an amine's NH2
    expect(hOf(withAtom('', 0, 1))).toBe(0) // a bare vertex says nothing
    expect(hOf(withAtom('C', 0, 1))).toBe(0)
  })

  /* A positive charge buys nitrogen a fourth bond and costs carbon its fourth:
     NH4+ has four hydrogens, CH3+ has three. */
  it('spends a charge differently on nitrogen and on carbon', () => {
    expect(hOf(withAtom('N', 1))).toBe(4)
    expect(hOf(withAtom('O', -1, 1))).toBe(0)
    expect(hOf(withAtom('O', 1, 2))).toBe(1) // H3O+ drawn with two bonds
  })

  it('takes an explicit count over the arithmetic', () => {
    const mol = withAtom('O', 0, 1)
    expect(implicitH(mol, { ...mol.atoms[0], hFixed: 3 })).toBe(3)
    expect(implicitH(mol, { ...mol.atoms[0], hHidden: true })).toBe(0)
  })
})

describe('removing a bond', () => {
  it('takes the bare vertex it leaves behind but keeps a labelled atom', () => {
    const [m1, a] = addAtom(blank, { x: 0, y: 0 })
    const [m2, b] = addAtom(m1, { x: BOND, y: 0 })
    const joined = addBond(m2, a.id, b.id)
    expect(removeBond(joined, joined.bonds[0].id).atoms).toHaveLength(0)

    const [m3, c] = addAtom(blank, { x: 0, y: 0 }, 'Na')
    const [m4, d] = addAtom(m3, { x: BOND, y: 0 }, 'Cl')
    const salt = addBond(m4, c.id, d.id)
    expect(removeBond(salt, salt.bonds[0].id).atoms).toHaveLength(2)
  })
})
