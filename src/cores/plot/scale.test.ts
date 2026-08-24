/* An axis is wrong in ways that still look like an axis, so these check the
   arithmetic rather than the appearance: where a value lands, what the ticks
   are, and that a label is not 0.30000000000000004. */

import { describe, expect, it } from 'vitest'
import { buildAxis, formatTick, niceNum } from './scale'

describe('niceNum', () => {
  it('rounds to 1, 2, 5 or 10 times a power of ten', () => {
    expect(niceNum(0.0123, true)).toBeCloseTo(0.01, 12)
    expect(niceNum(6.7, true)).toBe(5)
    expect(niceNum(7.5, true)).toBe(10)
    expect(niceNum(230, false)).toBe(500)
  })
})

describe('linear axis', () => {
  it('maps the domain onto the pixel range it was given', () => {
    const a = buildAxis({ min: 0, max: 100 }, { values: [0, 100] }, 40, 440)
    expect(a.px(0)).toBeCloseTo(40, 6)
    expect(a.px(100)).toBeCloseTo(440, 6)
    expect(a.px(50)).toBeCloseTo(240, 6)
    expect(a.inv(240)).toBeCloseTo(50, 6)
  })

  /* A y axis is built bottom-to-top because SVG's y grows downward; `reverse`
     is the author's choice on top of that, not a restatement of it. */
  it('reverses independently of the direction the range was passed in', () => {
    const up = buildAxis({ min: 0, max: 10 }, {}, 400, 100)
    expect(up.px(0)).toBeCloseTo(400, 6)
    const rev = buildAxis({ min: 0, max: 10, reverse: true }, {}, 400, 100)
    expect(rev.px(0)).toBeCloseTo(100, 6)
    expect(rev.px(10)).toBeCloseTo(400, 6)
  })

  /* An axis measured from zero is read as a scale, so it ends on a round
     number. An axis merely framing data is read as a window, and rounding it
     out is how −6…6 became −10…10 and left the plot two-thirds empty. */
  it('rounds out only when the axis is anchored at zero', () => {
    const scale = buildAxis({ zero: true }, { values: [3, 47] }, 0, 100)
    expect(scale.min).toBe(0)
    expect(scale.max).toBe(50)
    expect(scale.ticks[scale.ticks.length - 1].v).toBeCloseTo(scale.max, 9)

    const window = buildAxis({ pad: 0 }, { values: [-6, 6] }, 0, 100)
    expect(window.min).toBeCloseTo(-6, 9)
    expect(window.max).toBeCloseTo(6, 9)
  })

  it('keeps every tick inside the domain', () => {
    const a = buildAxis({ pad: 0.05 }, { values: [3, 47] }, 0, 100)
    for (const t of a.ticks) {
      expect(t.v).toBeGreaterThanOrEqual(a.min - 1e-9)
      expect(t.v).toBeLessThanOrEqual(a.max + 1e-9)
    }
  })

  it('leaves a pinned range exactly where it was pinned', () => {
    const a = buildAxis({ min: 3, max: 47 }, { values: [3, 47] }, 0, 100)
    expect(a.min).toBe(3)
    expect(a.max).toBe(47)
  })

  it('gives a flat series an axis to sit on', () => {
    const a = buildAxis({}, { values: [5, 5, 5] }, 0, 100)
    expect(a.max).toBeGreaterThan(a.min)
    expect(Number.isFinite(a.px(5))).toBe(true)
  })

  it('labels ticks without floating-point litter', () => {
    const a = buildAxis({ min: 0, max: 1 }, {}, 0, 100)
    for (const t of a.ticks) expect(t.label).not.toMatch(/\d{6,}/)
    expect(a.ticks.map((t) => t.label)).toEqual(['0', '0.2', '0.4', '0.6', '0.8', '1'])
  })
})

describe('log axis', () => {
  it('spaces decades evenly', () => {
    const a = buildAxis({ scale: 'log' }, { values: [1e-8, 1e-4] }, 0, 400)
    const d1 = a.px(1e-7) - a.px(1e-8)
    const d2 = a.px(1e-5) - a.px(1e-6)
    expect(d1).toBeCloseTo(d2, 6)
  })

  it('writes a power of ten as a superscript, not as 0.0001', () => {
    const a = buildAxis({ scale: 'log' }, { values: [1e-8, 1e-4] }, 0, 400)
    const t = a.ticks.find((x) => Math.abs(x.v - 1e-8) < 1e-20)
    expect(t?.label).toBe('10')
    expect(t?.sup).toBe('−8')
  })

  /* An axis spanning 1e-6…1e-3 used to label its top tick "0.001" and the rest
     as powers, because the choice was made one tick at a time. */
  it('uses one notation for the whole axis', () => {
    const a = buildAxis({ scale: 'log' }, { values: [1.5e-6, 9e-4] }, 0, 400)
    const powers = a.ticks.filter((t) => t.sup !== undefined).length
    expect(powers === 0 || powers === a.ticks.length).toBe(true)
  })

  it('keeps a short, everyday range in plain decimals', () => {
    const a = buildAxis({ scale: 'log' }, { values: [1, 900] }, 0, 400)
    expect(a.ticks.every((t) => t.sup === undefined)).toBe(true)
  })

  it('ignores non-positive values instead of producing NaN', () => {
    const a = buildAxis({ scale: 'log' }, { values: [0, -3, 1, 1000] }, 0, 400)
    expect(Number.isFinite(a.px(1))).toBe(true)
    expect(Number.isFinite(a.min)).toBe(true)
    expect(a.min).toBeGreaterThan(0)
  })

  /* Five percent of the span between 1e-8 and 1e-4 is 5e-6, which is larger
     than the whole bottom decade. Padding a log axis linearly puts its floor
     below zero, and every tick then lands at 1e-300. */
  it('does not take linear padding below zero', () => {
    const a = buildAxis({ scale: 'log', pad: 0.05, zero: true }, { values: [2.6e-8, 1e-4] }, 0, 400)
    // (zero is meaningless on a log axis; what matters is that it survives it)
    expect(a.min).toBeGreaterThanOrEqual(1e-9)
    expect(a.ticks.length).toBeLessThan(12)
  })

  it('has minor rungs between the decades', () => {
    const a = buildAxis({ scale: 'log' }, { values: [1, 1000] }, 0, 400)
    expect(a.minor.length).toBeGreaterThan(10)
  })
})

describe('category axis', () => {
  it('centres each category in its own slot', () => {
    const a = buildAxis({}, { categories: ['a', 'b', 'c', 'd'] }, 0, 400)
    expect(a.band).toBeCloseTo(100, 6)
    expect(a.px(0)).toBeCloseTo(50, 6)
    expect(a.px(3)).toBeCloseTo(350, 6)
  })

  it('labels with the category names', () => {
    const a = buildAxis({}, { categories: ['사과', '바나나'] }, 0, 200)
    expect(a.ticks.map((t) => t.label)).toEqual(['사과', '바나나'])
  })
})

describe('formatTick', () => {
  it('has a format for each thing a reader expects', () => {
    expect(formatTick(0.45, { format: 'percent' }, 0.1).label).toBe('45%')
    expect(formatTick(1234567, { format: 'int' }, 1).label).toBe('1,234,567')
    expect(formatTick(1500, { format: 'si' }, 100).label).toBe('1.5k')
    expect(formatTick(0.002, { format: 'sci' }, 1e-3)).toMatchObject({ label: '2×10', sup: '−3' })
    expect(formatTick(42, { suffix: ' m' }, 1).label).toBe('42 m')
  })

  it('switches to an exponent only where decimals stop being readable', () => {
    expect(formatTick(12345, {}, 1000).label).toBe('12345')
    expect(formatTick(1e6, {}, 1e5).sup).toBe('6')
  })
})
