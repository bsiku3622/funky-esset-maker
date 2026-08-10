/* The print maths is what decides whether an exported figure lands at the
 * right size on the page, and the failure mode is silent: a wrong factor still
 * produces a valid file, just one that is 40% too wide or has 4 pt labels. */

import { describe, expect, it } from 'vitest'
import {
  FONT,
  MIN_READABLE_PT,
  PAPER_SERIES,
  PX_PER_IN,
  WIDTH_PRESETS,
  figColors,
  inPx,
  printWidthIn,
  ptOf,
} from './paper'

describe('printed width', () => {
  it('reads the preset width', () => {
    // ICML single column
    expect(printWidthIn('icml-col', 999)).toBeCloseTo(3.25, 6)
  })

  /* 'screen' means the figure prints at CSS scale, so a 760 px number line is
     7.92 in wide. Everything else is measured against that convention. */
  it('falls back to 1 px = 1/96 in for the screen preset', () => {
    expect(printWidthIn('screen', 760)).toBeCloseTo(760 / 96, 6)
    expect(printWidthIn('no-such-preset', 480)).toBeCloseTo(5, 6)
  })

  it('converts inches to canvas pixels', () => {
    expect(inPx(3.25)).toBe(312)
    expect(PX_PER_IN).toBe(96)
  })

  it('has a unique id for every preset', () => {
    const ids = WIDTH_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('point size', () => {
  /* A 14 px label on a 760 px canvas printed at screen scale is 10.5 pt:
     14 * (1/96) * 72. This is the number the toolbar shows. */
  it('matches the CSS px → pt ratio at screen scale', () => {
    expect(ptOf(14, 760 / 96, 760)).toBeCloseTo(10.5, 6)
  })

  /* The same figure squeezed into an ICML column is unreadable, and the
     readout has to say so rather than let it through. */
  it('goes below the warning threshold when a wide canvas is squeezed', () => {
    expect(ptOf(14, 3.25, 760)).toBeLessThan(MIN_READABLE_PT)
  })

  it('is unaffected by the canvas size when both scale together', () => {
    expect(ptOf(14, 3.25, inPx(3.25))).toBeCloseTo(10.5, 1)
  })
})

describe('figure colours', () => {
  const funky = ['#ff4eba', '#7828c8']

  it('uses the tool palette in funky and Okabe–Ito in paper', () => {
    expect(figColors('funky', false, funky).series).toBe(funky)
    expect(figColors('paper', false, funky).series).toBe(PAPER_SERIES)
  })

  /* Paper draws flat colour with no outline; funky outlines everything. */
  it('drops the shape outline in paper mode', () => {
    expect(figColors('paper', false, funky).outline).toBeNull()
    expect(figColors('funky', false, funky).outline).toBe('#222222')
  })

  it('never bolds a data label in paper mode', () => {
    expect(figColors('paper', false, funky).bold).toBe(400)
    expect(figColors('funky', false, funky).bold).toBe(700)
  })

  it('lightens the ink on a dark background in both modes', () => {
    expect(figColors('paper', true, funky).ink).not.toBe(figColors('paper', false, funky).ink)
    expect(figColors('funky', true, funky).ink).not.toBe(figColors('funky', false, funky).ink)
  })

  /* ⚠️ A CSS variable in SVG markup resolves to nothing in an exported file.
     Every font the figures use has to be a literal stack. */
  it('names concrete font stacks, never a custom property', () => {
    for (const stack of Object.values(FONT)) expect(stack).not.toContain('var(')
    for (const theme of ['funky', 'paper'] as const) {
      const c = figColors(theme, false, funky)
      expect(c.text).not.toContain('var(')
      expect(c.numeric).not.toContain('var(')
    }
  })

  it('keeps the CVD-safe palette distinct enough to name', () => {
    expect(new Set(PAPER_SERIES).size).toBe(PAPER_SERIES.length)
  })
})
