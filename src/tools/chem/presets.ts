/* Starting structures.
 *
 * Drawing benzene from an empty canvas takes six clicks and knowing that the
 * ring tool exists; picking it from a list takes one and teaches that it does.
 * Each of these is also a worked example of one feature — fused rings, stereo
 * bonds, formal charges, lone pairs, a reaction arrow — so the list doubles as
 * the tool's documentation. */

import {
  BOND,
  addAtom,
  addBond,
  cid,
  fuseRing,
  placeRing,
  type Arrow,
  type Bond,
  type BondStyle,
  type Molecule,
  type Pt,
} from './model'

/* ---------- a small builder ---------- */

const rad = (deg: number) => (deg * Math.PI) / 180

class Sketch {
  mol: Molecule = { atoms: [], bonds: [], arrows: [], labels: [] }

  at(p: Pt, el = ''): string {
    const [m, a] = addAtom(this.mol, p, el)
    this.mol = m
    return a.id
  }

  /** A new atom one bond away at `deg`, joined to `from`. Screen degrees, so
   *  −30 goes up and to the right — the way a chain is drawn. */
  to(from: string, deg: number, el = '', order: 1 | 2 | 3 = 1, style?: BondStyle): string {
    const a = this.mol.atoms.find((q) => q.id === from)!
    const id = this.at({ x: a.x + BOND * Math.cos(rad(deg)), y: a.y + BOND * Math.sin(rad(deg)) }, el)
    this.mol = addBond(this.mol, from, id, order)
    if (style) this.style(from, id, style)
    return id
  }

  style(a: string, b: string, style: BondStyle) {
    this.mol = {
      ...this.mol,
      bonds: this.mol.bonds.map((x) =>
        (x.a === a && x.b === b) || (x.a === b && x.b === a) ? { ...x, style } : x,
      ),
    }
  }

  ring(p: Pt, n: number, aromatic = false) {
    this.mol = placeRing(this.mol, p, n, aromatic)
  }

  fuseOn(pick: (b: Bond) => boolean, n: number, aromatic = false) {
    const bond = this.mol.bonds.find(pick)
    if (bond) this.mol = fuseRing(this.mol, bond, n, aromatic)
  }

  charge(id: string, q: number) {
    this.mol = {
      ...this.mol,
      atoms: this.mol.atoms.map((a) => (a.id === id ? { ...a, charge: q } : a)),
    }
  }

  lone(id: string, n: number) {
    this.mol = {
      ...this.mol,
      atoms: this.mol.atoms.map((a) => (a.id === id ? { ...a, lone: n } : a)),
    }
  }

  arrow(a: Omit<Arrow, 'id'>) {
    this.mol = { ...this.mol, arrows: [...this.mol.arrows, { ...a, id: cid('r') }] }
  }

  text(x: number, y: number, text: string, size?: number) {
    this.mol = { ...this.mol, labels: [...this.mol.labels, { id: cid('t'), x, y, text, size }] }
  }
}

const make = (f: (s: Sketch) => void): Molecule => {
  const s = new Sketch()
  f(s)
  return s.mol
}

/* ---------- the list ---------- */

export interface ChemPreset {
  id: string
  label: string
  group: string
  /** what it demonstrates, shown under the picker */
  note: string
  mol: Molecule
  lonePairs?: boolean
  /* Some of these are a reaction rather than a molecule and need a wider page.
     Carried on the preset because the canvas is a property of the drawing, not
     of the tool. */
  w?: number
  h?: number
}

export const CHEM_PRESETS: ChemPreset[] = [
  {
    id: 'benzene',
    label: '벤젠',
    group: '고리',
    note: '방향족 고리 — 케쿨레 대신 안쪽 원',
    mol: make((s) => s.ring({ x: 280, y: 210 }, 6, true)),
  },
  {
    id: 'cyclohexane',
    label: '사이클로헥세인',
    group: '고리',
    note: '고리 도구로 한 번에',
    mol: make((s) => s.ring({ x: 280, y: 210 }, 6)),
  },
  {
    id: 'naphthalene',
    label: '나프탈렌',
    group: '고리',
    note: '결합 위에 고리를 얹으면 융합됩니다',
    mol: make((s) => {
      s.ring({ x: 245, y: 210 }, 6, true)
      // the rightmost vertical bond of the first ring
      s.fuseOn((b) => {
        const a = s.mol.atoms.find((q) => q.id === b.a)!
        const c = s.mol.atoms.find((q) => q.id === b.b)!
        return Math.abs(a.x - c.x) < 1 && a.x > 260
      }, 6, true)
    }),
  },
  {
    id: 'pyridine',
    label: '피리딘',
    group: '고리',
    note: '고리 원자에 원소를 지정',
    mol: make((s) => {
      s.ring({ x: 280, y: 210 }, 6, true)
      const top = s.mol.atoms.reduce((a, b) => (a.y < b.y ? a : b))
      s.mol = {
        ...s.mol,
        atoms: s.mol.atoms.map((a) => (a.id === top.id ? { ...a, el: 'N' } : a)),
      }
    }),
  },
  {
    id: 'ethanol',
    label: '에탄올',
    group: '사슬',
    note: '지그재그 사슬 + 헤테로 원자',
    mol: make((s) => {
      const c1 = s.at({ x: 210, y: 220 })
      const c2 = s.to(c1, -30)
      s.to(c2, 30, 'O')
    }),
  },
  {
    id: 'acetic',
    label: '아세트산',
    group: '사슬',
    note: '이중 결합 · 카복실기',
    mol: make((s) => {
      const c1 = s.at({ x: 200, y: 220 })
      const c2 = s.to(c1, -30)
      s.to(c2, -90, 'O', 2)
      s.to(c2, 30, 'O')
    }),
  },
  {
    id: 'benzoic',
    label: '벤조산',
    group: '사슬',
    note: '고리에 치환기 붙이기',
    mol: make((s) => {
      s.ring({ x: 230, y: 215 }, 6, true)
      const right = s.mol.atoms.reduce((a, b) => (a.x > b.x ? a : b))
      const c = s.to(right.id, 0)
      s.to(c, -60, 'O', 2)
      s.to(c, 60, 'O')
    }),
  },
  {
    id: 'glycine',
    label: '글라이신 양쪽성 이온',
    group: '전하',
    note: '형식 전하 — N⁺ 는 결합 4개, O⁻ 는 1개',
    mol: make((s) => {
      const n = s.at({ x: 200, y: 215 }, 'N')
      s.charge(n, 1)
      const c1 = s.to(n, -30)
      const c2 = s.to(c1, 30)
      s.to(c2, -30, 'O', 2)
      const o = s.to(c2, 90, 'O')
      s.charge(o, -1)
    }),
  },
  {
    id: 'water',
    label: '물 루이스 구조',
    group: '전하',
    note: '비공유 전자쌍 — 점으로 표시',
    lonePairs: true,
    mol: make((s) => {
      const o = s.at({ x: 280, y: 200 }, 'O')
      s.lone(o, 2)
      const h1 = s.to(o, 150, 'H')
      const h2 = s.to(o, 30, 'H')
      void h1
      void h2
    }),
  },
  {
    id: 'ammonium',
    label: '암모늄 이온',
    group: '전하',
    note: '전하가 수소 개수를 바꿉니다',
    mol: make((s) => {
      const n = s.at({ x: 280, y: 210 }, 'N')
      s.charge(n, 1)
    }),
  },
  {
    id: 'stereo',
    label: '입체 결합',
    group: '입체',
    note: '쐐기 · 점선 — 지면 앞뒤',
    mol: make((s) => {
      const c = s.at({ x: 280, y: 210 })
      s.to(c, 180, 'H')
      s.to(c, 0, 'Cl')
      s.to(c, -60, 'Br', 1, 'wedge')
      s.to(c, 60, 'F', 1, 'dash')
    }),
  },
  {
    id: 'esterification',
    label: '에스터화 반응',
    group: '반응',
    note: '화살표 위아래에 조건과 시약',
    w: 780,
    h: 300,
    mol: make((s) => {
      const c1 = s.at({ x: 60, y: 160 })
      const c2 = s.to(c1, -30)
      s.to(c2, -90, 'O', 2)
      s.to(c2, 30, 'O')
      s.text(190, 166, '+', 20)
      const e1 = s.at({ x: 235, y: 170 })
      const e2 = s.to(e1, -30)
      s.to(e2, 30, 'O')
      s.arrow({ kind: 'equilibrium', x1: 360, y1: 160, x2: 470, y2: 160, above: 'H₂SO₄', below: 'Δ' })
      const f1 = s.at({ x: 510, y: 170 })
      const f2 = s.to(f1, -30)
      s.to(f2, -90, 'O', 2)
      const o = s.to(f2, 30, 'O')
      const g = s.to(o, -30)
      s.to(g, 30)
    }),
  },
  {
    id: 'curly',
    label: '전자 이동 화살표',
    group: '반응',
    note: '굽은 화살표 — 메커니즘',
    w: 480,
    h: 300,
    mol: make((s) => {
      const c1 = s.at({ x: 180, y: 190 })
      const c2 = s.to(c1, -30, '', 2)
      s.to(c2, 30, 'Br')
      s.arrow({ kind: 'curly', x1: 205, y1: 156, x2: 260, y2: 156, bow: -34 })
    }),
  },
]

export const chemPresetById = (id: string): ChemPreset =>
  CHEM_PRESETS.find((p) => p.id === id) ?? CHEM_PRESETS[0]
