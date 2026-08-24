/* The molecule: atoms, bonds, and the geometry that keeps a sketch looking
 * like a structural formula rather than like a graph.
 *
 * ⚠️ Positions are stored, not derived. A structural formula is a drawing with
 * conventions — the zig-zag of a chain, the shape of a fused ring system, where
 * a substituent hangs — and a layout algorithm that re-derives coordinates from
 * connectivity throws all of that away every time an atom is added. So the tool
 * snaps what you draw to the conventional angles and lengths, and then leaves
 * it exactly where you put it.
 *
 * ⚠️ A carbon with no charge and no explicit hydrogens has an *empty* label and
 * is drawn as a bare vertex. That is not a missing value: it is what skeletal
 * notation means. Nothing here may fill it in with "C". */

export interface Pt {
  x: number
  y: number
}

export interface Atom {
  id: string
  x: number
  y: number
  /** element symbol, or '' for the implicit carbon of a skeletal vertex */
  el: string
  charge?: number
  /** lone pairs, drawn as dots — Lewis structures */
  lone?: number
  /** force the hydrogen count instead of working it out from the bonds */
  hFixed?: number | null
  /** never draw this atom's hydrogens */
  hHidden?: boolean
}

export type BondStyle = 'plain' | 'wedge' | 'dash' | 'wavy'

export interface Bond {
  id: string
  a: string
  b: string
  order: 1 | 2 | 3
  style?: BondStyle
  /** part of an aromatic ring — drawn as a plain bond plus a ring circle */
  aromatic?: boolean
}

export type ArrowKind = 'forward' | 'equilibrium' | 'resonance' | 'retro' | 'curly'

export interface Arrow {
  id: string
  kind: ArrowKind
  x1: number
  y1: number
  x2: number
  y2: number
  /** condition above the arrow, and reagent/solvent below */
  above?: string
  below?: string
  /** bow of a curly (electron-pushing) arrow */
  bow?: number
}

export interface TextLabel {
  id: string
  x: number
  y: number
  text: string
  size?: number
}

export interface Molecule {
  atoms: Atom[]
  bonds: Bond[]
  arrows: Arrow[]
  labels: TextLabel[]
}

export const EMPTY: Molecule = { atoms: [], bonds: [], arrows: [], labels: [] }

/* ---------- constants ---------- */

/** One bond length. Everything else is measured in these. */
export const BOND = 42

/** The angle grid a sketch snaps to. 30° gives the 120° zig-zag of a chain and
 *  the vertices of every ring from a triangle to a hexagon. */
export const SNAP_DEG = 30

let seq = 0
export const cid = (p: string): string => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

/* ---------- elements ---------- */

/** Bonds an uncharged atom of each element normally makes. Used only to work
 *  out how many hydrogens to draw; an atom that disagrees is still drawn. */
const VALENCE: Record<string, number> = {
  C: 4,
  N: 3,
  O: 2,
  S: 2,
  P: 3,
  B: 3,
  Si: 4,
  F: 1,
  Cl: 1,
  Br: 1,
  I: 1,
  H: 1,
}

/** Elements whose lone pairs let a positive charge *add* a bond — N⁺ makes
 *  four, O⁺ makes three. Carbon and boron have none to spend, so a charge costs
 *  them a bond instead: CH₃⁺ has three hydrogens, not five. */
const LONE_PAIR_DONORS = new Set(['N', 'P', 'O', 'S', 'F', 'Cl', 'Br', 'I'])

export const KNOWN_ELEMENTS = [
  'C',
  'H',
  'N',
  'O',
  'S',
  'P',
  'F',
  'Cl',
  'Br',
  'I',
  'B',
  'Si',
  'Na',
  'K',
  'Mg',
  'Ca',
  'Fe',
  'Zn',
  'Cu',
  'Al',
]

/** Total bond order at an atom. */
export function degree(mol: Molecule, id: string): number {
  let n = 0
  for (const b of mol.bonds) if (b.a === id || b.b === id) n += b.aromatic ? 1.5 : b.order
  return n
}

/** How many hydrogens to draw on an atom, or 0 for none.
 *
 *  Skeletal notation leaves carbon's hydrogens implicit and *unwritten* — a
 *  vertex means CH₂ and nobody types it — so a bare carbon returns 0 however
 *  many it really has. A labelled heteroatom writes them, because OH and O are
 *  different things on a page. */
export function implicitH(mol: Molecule, atom: Atom): number {
  if (atom.hFixed !== null && atom.hFixed !== undefined) return Math.max(0, atom.hFixed)
  if (atom.hHidden) return 0
  const el = atom.el
  if (!el || el === 'C') return 0
  const v = VALENCE[el]
  if (v === undefined) return 0
  const q = atom.charge ?? 0
  const eff = LONE_PAIR_DONORS.has(el) ? v + q : v - Math.abs(q)
  // aromatic bonds count as 1.5, so round the sum before subtracting
  return Math.max(0, Math.round(eff - degree(mol, atom.id)))
}

/* ---------- geometry ---------- */

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)

export const angleOf = (from: Pt, to: Pt) => Math.atan2(to.y - from.y, to.x - from.x)

/** Round an angle to the sketch grid. */
export function snapAngle(rad: number, stepDeg = SNAP_DEG): number {
  const step = (stepDeg * Math.PI) / 180
  return Math.round(rad / step) * step
}

export const along = (from: Pt, rad: number, len = BOND): Pt => ({
  x: from.x + len * Math.cos(rad),
  y: from.y + len * Math.sin(rad),
})

export const atomAt = (mol: Molecule, id: string): Atom | undefined =>
  mol.atoms.find((a) => a.id === id)

export function neighbours(mol: Molecule, id: string): Atom[] {
  const out: Atom[] = []
  for (const b of mol.bonds) {
    const other = b.a === id ? b.b : b.b === id ? b.a : null
    if (!other) continue
    const at = atomAt(mol, other)
    if (at) out.push(at)
  }
  return out
}

/** The direction a new bond should leave an atom in.
 *
 *  ⚠️ Extending a chain has to turn the *opposite* way from the bond before it.
 *  Turning the same way every time walks the chain round a hexagon and closes
 *  it — which is what happens with any rule that looks only at the current atom
 *  and its one neighbour, because that pair alone cannot say which way the last
 *  turn went. So this reaches one atom further back and reverses it.
 *
 *  With nothing attached at all there is no chain to continue, and −30° is
 *  where a hand starts one. With more than one neighbour the chain has become a
 *  branch point, and the answer is simply the emptiest direction. */
export function freeAngle(mol: Molecule, atom: Atom): number {
  const nb = neighbours(mol, atom.id)
  if (!nb.length) return -Math.PI / 6
  if (nb.length === 1) {
    const prevAtom = nb[0]
    const incoming = angleOf(prevAtom, atom)
    const before = neighbours(mol, prevAtom.id).find((n) => n.id !== atom.id)
    if (!before) return snapAngle(incoming + Math.PI / 3)
    const earlier = angleOf(before, prevAtom)
    const turn = Math.atan2(
      Math.sin(incoming - earlier),
      Math.cos(incoming - earlier),
    )
    return snapAngle(incoming - Math.sign(turn || 1) * (Math.PI / 3))
  }
  const taken = nb.map((n) => angleOf(atom, n))
  let best = 0
  let bestGap = -1
  for (let d = 0; d < 360; d += SNAP_DEG) {
    const a = (d * Math.PI) / 180
    const gap = Math.min(...taken.map((t) => Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t)))))
    if (gap > bestGap) {
      bestGap = gap
      best = a
    }
  }
  return best
}

/** The atom under a point, if any. */
export function hitAtom(mol: Molecule, p: Pt, r = BOND * 0.42): Atom | null {
  let best: Atom | null = null
  let bestD = r
  for (const a of mol.atoms) {
    const d = dist(a, p)
    if (d <= bestD) {
      bestD = d
      best = a
    }
  }
  return best
}

/** The bond under a point, if any. */
export function hitBond(mol: Molecule, p: Pt, r = 9): Bond | null {
  let best: Bond | null = null
  let bestD = r
  for (const b of mol.bonds) {
    const a1 = atomAt(mol, b.a)
    const a2 = atomAt(mol, b.b)
    if (!a1 || !a2) continue
    const d = pointToSegment(p, a1, a2)
    if (d <= bestD) {
      bestD = d
      best = b
    }
  }
  return best
}

export function pointToSegment(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  if (!len2) return dist(p, a)
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2
  t = Math.max(0, Math.min(1, t))
  return dist(p, { x: a.x + vx * t, y: a.y + vy * t })
}

/* ---------- editing ---------- */

export const addAtom = (mol: Molecule, p: Pt, el = ''): [Molecule, Atom] => {
  const atom: Atom = { id: cid('a'), x: p.x, y: p.y, el }
  return [{ ...mol, atoms: [...mol.atoms, atom] }, atom]
}

export function addBond(mol: Molecule, a: string, b: string, order: 1 | 2 | 3 = 1): Molecule {
  if (a === b) return mol
  const existing = mol.bonds.find(
    (x) => (x.a === a && x.b === b) || (x.a === b && x.b === a),
  )
  // drawing over a bond that is already there raises its order, which is how
  // every structure editor lets you make a double bond without a second tool
  if (existing)
    return {
      ...mol,
      bonds: mol.bonds.map((x) =>
        x.id === existing.id
          ? { ...x, order: ((x.order % 3) + 1) as 1 | 2 | 3, aromatic: false }
          : x,
      ),
    }
  return { ...mol, bonds: [...mol.bonds, { id: cid('b'), a, b, order }] }
}

/** Remove an atom and everything that hung off it. */
export function removeAtom(mol: Molecule, id: string): Molecule {
  return {
    ...mol,
    atoms: mol.atoms.filter((a) => a.id !== id),
    bonds: mol.bonds.filter((b) => b.a !== id && b.b !== id),
  }
}

/** Remove a bond, and any atom it leaves with nothing attached.
 *
 *  A bare vertex with no bonds is not a molecule, it is a dot nobody can see
 *  and cannot select — so it goes with the bond. A *labelled* atom stays: an
 *  author who typed "Na" meant it to be there. */
export function removeBond(mol: Molecule, id: string): Molecule {
  const bond = mol.bonds.find((b) => b.id === id)
  if (!bond) return mol
  const bonds = mol.bonds.filter((b) => b.id !== id)
  const orphan = (aid: string) =>
    !bonds.some((b) => b.a === aid || b.b === aid) &&
    !(mol.atoms.find((a) => a.id === aid)?.el)
  return {
    ...mol,
    bonds,
    atoms: mol.atoms.filter((a) => !((a.id === bond.a || a.id === bond.b) && orphan(a.id))),
  }
}

/* ---------- rings ---------- */

/** A regular polygon of `n` atoms with one bond length per side, centred so
 *  that `from → to` is one of its edges when given, or around `centre`. */
export function ringPoints(n: number, centre: Pt, rotation = 0): Pt[] {
  const r = BOND / (2 * Math.sin(Math.PI / n))
  return Array.from({ length: n }, (_, i) => {
    const a = rotation - Math.PI / 2 + (i * 2 * Math.PI) / n
    return { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) }
  })
}

/** Place a free-standing ring centred on `p`. */
export function placeRing(mol: Molecule, p: Pt, n: number, aromatic: boolean): Molecule {
  const pts = ringPoints(n, p)
  const ids: string[] = []
  let next = mol
  for (const q of pts) {
    const [m, atom] = addAtom(next, q)
    next = m
    ids.push(atom.id)
  }
  return closeRing(next, ids, aromatic)
}

/** Fuse a ring onto an existing bond: the two atoms of that bond become an edge
 *  of the new ring, which grows away from the rest of the structure. */
export function fuseRing(mol: Molecule, bond: Bond, n: number, aromatic: boolean): Molecule {
  const a = atomAt(mol, bond.a)
  const b = atomAt(mol, bond.b)
  if (!a || !b) return mol
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  // the apothem, along the bond's normal
  const apo = BOND / (2 * Math.tan(Math.PI / n))
  const nx = -dy / len
  const ny = dx / len

  // away from the rest of the molecule: whichever side has less already on it
  const others = mol.atoms.filter((q) => q.id !== a.id && q.id !== b.id)
  const lean = others.reduce(
    (acc, q) => acc + Math.sign((q.x - mid.x) * nx + (q.y - mid.y) * ny),
    0,
  )
  const sign = lean > 0 ? -1 : 1
  const centre = { x: mid.x + nx * apo * sign, y: mid.y + ny * apo * sign }

  // the vertices, walking round from a to b the long way
  const startAngle = Math.atan2(a.y - centre.y, a.x - centre.x)
  const step = (2 * Math.PI) / n
  // direction round the ring that reaches b in one step
  const toB = Math.atan2(b.y - centre.y, b.x - centre.x)
  const delta = Math.atan2(Math.sin(toB - startAngle), Math.cos(toB - startAngle))
  const dir = delta > 0 ? 1 : -1

  const ids = [a.id, b.id]
  let next = mol
  for (let i = 2; i < n; i++) {
    const ang = startAngle + dir * step * i
    const [m, atom] = addAtom(next, {
      x: centre.x + (BOND / (2 * Math.sin(Math.PI / n))) * Math.cos(ang),
      y: centre.y + (BOND / (2 * Math.sin(Math.PI / n))) * Math.sin(ang),
    })
    next = m
    ids.push(atom.id)
  }
  return closeRing(next, ids, aromatic)
}

function closeRing(mol: Molecule, ids: string[], aromatic: boolean): Molecule {
  let next = mol
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i]
    const b = ids[(i + 1) % ids.length]
    const existing = next.bonds.find(
      (x) => (x.a === a && x.b === b) || (x.a === b && x.b === a),
    )
    if (existing) {
      if (aromatic)
        next = {
          ...next,
          bonds: next.bonds.map((x) => (x.id === existing.id ? { ...x, aromatic: true, order: 1 } : x)),
        }
      continue
    }
    next = {
      ...next,
      bonds: [...next.bonds, { id: cid('b'), a, b, order: 1, aromatic: aromatic || undefined }],
    }
  }
  return next
}

/** Every aromatic ring, as a list of atom ids in order.
 *
 *  Only the aromatic bonds are walked, so this is a small graph and a plain
 *  depth-first search is enough — there is no need for a full ring perception
 *  when the only question is where to draw a circle. */
export function aromaticRings(mol: Molecule): string[][] {
  const arom = mol.bonds.filter((b) => b.aromatic)
  if (!arom.length) return []
  const adj = new Map<string, string[]>()
  for (const b of arom) {
    ;(adj.get(b.a) ?? adj.set(b.a, []).get(b.a)!).push(b.b)
    ;(adj.get(b.b) ?? adj.set(b.b, []).get(b.b)!).push(b.a)
  }
  const rings: string[][] = []
  const seen = new Set<string>()
  const walk = (start: string, cur: string, prev: string | null, path: string[]) => {
    if (path.length > 8) return
    for (const nx of adj.get(cur) ?? []) {
      if (nx === prev) continue
      if (nx === start && path.length >= 3) {
        const key = [...path].sort().join(',')
        if (!seen.has(key)) {
          seen.add(key)
          rings.push([...path])
        }
        continue
      }
      if (path.includes(nx)) continue
      walk(start, nx, cur, [...path, nx])
    }
  }
  for (const id of adj.keys()) walk(id, id, null, [id])
  // a fused system yields the same ring from each of its atoms; the shortest
  // distinct cycles are the ones worth drawing a circle in
  return rings.filter((r) => r.length <= 8)
}

export const centroid = (pts: Pt[]): Pt => ({
  x: pts.reduce((s, p) => s + p.x, 0) / (pts.length || 1),
  y: pts.reduce((s, p) => s + p.y, 0) / (pts.length || 1),
})

/* ---------- extent ---------- */

export function bounds(mol: Molecule): { x: number; y: number; w: number; h: number } {
  const xs: number[] = []
  const ys: number[] = []
  for (const a of mol.atoms) {
    xs.push(a.x)
    ys.push(a.y)
  }
  for (const a of mol.arrows) {
    xs.push(a.x1, a.x2)
    ys.push(a.y1, a.y2)
  }
  for (const l of mol.labels) {
    xs.push(l.x)
    ys.push(l.y)
  }
  if (!xs.length) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
