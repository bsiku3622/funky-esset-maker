/* The drawing is checked for the two things that are invisible until someone
 * tries to scan the result: that the paths cover exactly the modules they are
 * supposed to (no eye painted twice, no logo well left dark), and that the
 * three warnings fire at the values they claim to. */

import { describe, expect, it } from 'vitest'
import { encodeQr, type QrCode } from './encode'
import {
  COVERAGE_MARGIN,
  MIN_CONTRAST,
  contrastRatio,
  coverage,
  eyesPath,
  isInverted,
  layout,
  logoFits,
  logoFontSize,
  logoRect,
  moduleMm,
  modulesPath,
} from './paint'

const code = (text = 'https://ksa.hs.kr', ecl: 'L' | 'M' | 'Q' | 'H' = 'H'): QrCode => {
  const r = encodeQr(text, { ecl })
  if (!r.ok) throw new Error(r.error)
  return r.qr
}

/** Subpaths, which for the module path is one per painted module. */
const subpaths = (d: string) => (d.match(/M/g) ?? []).length

describe('layout', () => {
  const qr = code()

  it('divides the width between the code and its quiet zone', () => {
    const geo = layout(qr, { figW: 400, quiet: 4, captionSize: 0 })
    expect(geo.module).toBeCloseTo(400 / (qr.size + 8), 6)
    expect(geo.x).toBeCloseTo(geo.module * 4, 6)
    // no caption, so the figure is square
    expect(geo.figH).toBe(400)
  })

  it('adds room under the code for a caption', () => {
    const geo = layout(qr, { figW: 400, quiet: 4, captionSize: 20 })
    expect(geo.figH).toBeGreaterThan(400)
    expect(geo.captionY).toBeGreaterThan(400)
    expect(geo.captionY).toBeLessThan(geo.figH)
  })

  it('shrinks the modules as the quiet zone grows', () => {
    const tight = layout(qr, { figW: 400, quiet: 1, captionSize: 0 })
    const loose = layout(qr, { figW: 400, quiet: 8, captionSize: 0 })
    expect(loose.module).toBeLessThan(tight.module)
  })
})

describe('module paths', () => {
  const qr = code()
  const darkCount = qr.modules.flat().filter(Boolean).length

  it('paints one subpath per dark module, eyes excluded', () => {
    // each eye contributes 9 dark modules on its ring plus 16 on its core
    const inEyes = [
      [0, 0],
      [qr.size - 7, 0],
      [0, qr.size - 7],
    ].reduce((sum, [ox, oy]) => {
      let n = 0
      for (let y = 0; y < 7; y++)
        for (let x = 0; x < 7; x++) if (qr.modules[oy + y][ox + x]) n++
      return sum + n
    }, 0)
    expect(subpaths(modulesPath(qr, { style: 'square' }))).toBe(darkCount - inEyes)
  })

  it('draws the same modules whatever the style', () => {
    const square = subpaths(modulesPath(qr, { style: 'square' }))
    expect(subpaths(modulesPath(qr, { style: 'rounded' }))).toBe(square)
    expect(subpaths(modulesPath(qr, { style: 'dot' }))).toBe(square)
  })

  it('leaves the logo well unpainted', () => {
    const rect = logoRect(qr, 0.2)
    const full = subpaths(modulesPath(qr, { style: 'square' }))
    const cleared = subpaths(modulesPath(qr, { style: 'square', clear: rect }))
    expect(cleared).toBeLessThan(full)
    // nothing outside the well may go missing with it
    let darkInWell = 0
    for (let y = rect.y; y < rect.y + rect.h; y++)
      for (let x = rect.x; x < rect.x + rect.w; x++) if (qr.modules[y][x]) darkInWell++
    expect(full - cleared).toBe(darkInWell)
  })

  it('rounds only the corners that face open space', () => {
    const blank = (): boolean[][] =>
      Array.from({ length: qr.size }, () => new Array<boolean>(qr.size).fill(false))

    // a module with nothing around it becomes a circle: four arcs
    const one = blank()
    one[10][10] = true
    expect((modulesPath({ ...qr, modules: one }, { style: 'rounded' }).match(/A/g) ?? []).length)
      .toBe(4)

    // side by side they become one pill: the two corners where they meet go
    // square, so it is still four arcs and not the eight two circles would need
    const two = blank()
    two[10][10] = true
    two[10][11] = true
    expect((modulesPath({ ...qr, modules: two }, { style: 'rounded' }).match(/A/g) ?? []).length)
      .toBe(4)
  })

  /* Regression: drawing the timing and alignment patterns as dots produced a
     code no decoder could read — they are the grid a reader measures the
     symbol against, not decoration. Squares emit two H commands each; dots and
     rounded modules emit none, so counting them counts exactly the modules
     that stayed square. */
  it('keeps the function patterns square in every style', () => {
    let fnDark = 0
    for (let y = 0; y < qr.size; y++)
      for (let x = 0; x < qr.size; x++) {
        const eye =
          (x < 7 && y < 7) || (x >= qr.size - 7 && y < 7) || (x < 7 && y >= qr.size - 7)
        if (qr.modules[y][x] && qr.fn[y][x] && !eye) fnDark++
      }
    expect(fnDark).toBeGreaterThan(0)
    for (const style of ['dot', 'rounded'] as const) {
      const d = modulesPath(qr, { style })
      expect([style, (d.match(/H/g) ?? []).length / 2]).toEqual([style, fnDark])
    }
  })

  it('writes every eye as ring, hole and core', () => {
    for (const style of ['square', 'rounded', 'circle'] as const)
      expect(subpaths(eyesPath(qr, style))).toBe(9)
  })
})

describe('the logo label', () => {
  it('shrinks as the text gets longer', () => {
    const one = logoFontSize('✦', 100)
    const three = logoFontSize('KSA', 100)
    expect(one).toBeGreaterThan(three)
    expect(one).toBeLessThanOrEqual(86)
  })

  it('keeps a wide script from overflowing its well', () => {
    // three Hangul syllables are three ems, so they have to come out smaller
    // than three Latin letters at the same box
    expect(logoFontSize('한국과', 100)).toBeLessThan(logoFontSize('KSA', 100))
  })
})

describe('the logo well', () => {
  const qr = code()

  it('centres the well on the code', () => {
    const rect = logoRect(qr, 0.2)
    expect(rect.x + rect.w / 2).toBeCloseTo(qr.size / 2, 6)
    expect(rect.y).toBe(rect.x)
    expect(rect.w).toBe(rect.h)
  })

  it('measures what the logo hides', () => {
    const rect = logoRect(qr, 0.2)
    expect(coverage(qr, rect)).toBeCloseTo((rect.w * rect.h) / (qr.size * qr.size), 6)
    expect(coverage(qr, null)).toBe(0)
  })

  /* The check that matters: the same logo is fine at H and reckless at L,
     because the two levels can rebuild different amounts of the symbol. */
  it('allows at H what it refuses at L', () => {
    const big = 0.2
    expect(logoFits(code('x', 'H'), logoRect(code('x', 'H'), big))).toBe(true)
    expect(logoFits(code('x', 'L'), logoRect(code('x', 'L'), big))).toBe(false)
  })

  it('stops short of the advertised recovery', () => {
    const h = code('x', 'H')
    // exactly at the nominal 30% is already past the line
    expect(logoFits(h, { x: 0, y: 0, w: h.size, h: Math.round(h.size * 0.3) })).toBe(false)
    expect(COVERAGE_MARGIN).toBeLessThan(1)
  })
})

describe('contrast', () => {
  it('matches the WCAG ratio', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 3)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 6)
    expect(contrastRatio('#7828c8', '#ffffff')).toBeCloseTo(7.15, 1)
  })

  it('reads short hex and ignores the leading hash', () => {
    expect(contrastRatio('#fff', 'ffffff')).toBeCloseTo(1, 6)
  })

  /* Neon pink on cream is the funky palette's most tempting combination and
     the one that does not scan — 2.2:1. */
  it('catches the neon-on-cream trap', () => {
    expect(contrastRatio('#ff4eba', '#fff5d1')).toBeLessThan(MIN_CONTRAST)
    expect(contrastRatio('#222222', '#fff5d1')).toBeGreaterThan(MIN_CONTRAST)
  })

  it('notices a light-on-dark code', () => {
    expect(isInverted('#ffffff', '#1e1e22')).toBe(true)
    expect(isInverted('#222222', '#ffffff')).toBe(false)
  })
})

describe('printed module size', () => {
  /* A version 5 code (37 modules) in an ICML column is right at the edge: the
     modules land near half a millimetre, which is the print floor. */
  it('converts a module to millimetres on the page', () => {
    const qr = code('x', 'M')
    const geo = layout(qr, { figW: 312, quiet: 4, captionSize: 0 })
    expect(moduleMm(geo.module, 3.25, 312)).toBeCloseTo(
      (312 / (qr.size + 8)) * (3.25 / 312) * 25.4,
      6,
    )
  })

  it('grows the module as the printed width grows', () => {
    const qr = code()
    const geo = layout(qr, { figW: 400, quiet: 4, captionSize: 0 })
    expect(moduleMm(geo.module, 6.5, 400)).toBeCloseTo(
      moduleMm(geo.module, 3.25, 400) * 2,
      6,
    )
  })
})
