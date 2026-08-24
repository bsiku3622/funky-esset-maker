/* How a structure is drawn, and how wide an atom's label comes out.
 *
 * Kept out of the renderer because a module that exports both a component and a
 * plain function loses its Fast Refresh boundary — and because the label box is
 * what the bond-trimming geometry measures against, which is worth reading on
 * its own. */

import { textWidth } from '../../cores/plot/geom'
import { implicitH, neighbours, type Atom, type Molecule } from './model'

export interface ChemStyle {
  ink: string
  /** what a label's box knocks out of a bond */
  paper: string
  bondWidth: number
  font: string
  fontSize: number
  /** gap between the two lines of a double bond */
  gap: number
}

export const chemStyle = (theme: 'funky' | 'paper', dark: boolean, scale = 1): ChemStyle =>
  theme === 'paper'
    ? {
        ink: dark ? '#f2f2f2' : '#000000',
        paper: dark ? '#1e1e22' : '#ffffff',
        bondWidth: 1.5 * scale,
        font: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
        fontSize: 15 * scale,
        gap: 5 * scale,
      }
    : {
        ink: dark ? '#f4f4f4' : '#222222',
        paper: dark ? '#1e1e22' : '#ffffff',
        bondWidth: 2.6 * scale,
        font: 'Pretendard, "Apple SD Gothic Neo", system-ui, sans-serif',
        fontSize: 17 * scale,
        gap: 6 * scale,
      }

/* ---------- atom labels ---------- */

export interface LabelBox {
  /** the text drawn, in pieces so subscripts stay tspans */
  parts: { t: string; sub?: boolean; sup?: boolean }[]
  /** half-width and half-height of the box a bond must stop outside */
  rx: number
  ry: number
  show: boolean
}

function chargeText(q: number): string {
  const sign = q > 0 ? '+' : '−'
  const n = Math.abs(q)
  return n === 1 ? sign : `${n}${sign}`
}

/** Which side the hydrogens go on: away from the bonds. */
function hLeft(mol: Molecule, atom: Atom): boolean {
  const nb = neighbours(mol, atom.id)
  if (!nb.length) return false
  const mean = nb.reduce((s, n) => s + (n.x - atom.x), 0) / nb.length
  // everything attached is to the right, so the hydrogens go left
  return mean > 1
}

export function labelOf(mol: Molecule, atom: Atom, st: ChemStyle): LabelBox {
  const h = implicitH(mol, atom)
  const q = atom.charge ?? 0
  const show = !!atom.el || q !== 0 || (atom.hFixed ?? 0) > 0
  if (!show) return { parts: [], rx: 0, ry: 0, show: false }
  const el = atom.el || 'C'
  const hParts: LabelBox['parts'] = h
    ? [{ t: 'H' }, ...(h > 1 ? [{ t: String(h), sub: true }] : [])]
    : []
  const parts: LabelBox['parts'] = hLeft(mol, atom)
    ? [...hParts, { t: el }]
    : [{ t: el }, ...hParts]
  if (q !== 0) parts.push({ t: chargeText(q), sup: true })
  const plain = parts.map((p) => p.t).join('')
  const w = textWidth(plain, st.fontSize, true)
  return {
    parts,
    // a little air around the glyphs, or the bond appears to touch the letter
    rx: w / 2 + st.fontSize * 0.16,
    ry: st.fontSize * 0.52 + st.fontSize * 0.1,
    show: true,
  }
}

