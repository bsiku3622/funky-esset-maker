/* Colour with transparency in it.
 *
 * The document keeps one string per colour slot and the SVG gets two
 * attributes. These pin the split, and pin the promise that matters most:
 * a colour that never mentioned alpha reads back byte for byte, because
 * thousands of saved figures are full of them. */

import { describe, expect, it } from 'vitest'
import { alphaOf, paint, withAlpha } from './presets'

describe('reading a colour', () => {
  it('leaves a plain colour alone and says nothing about opacity', () => {
    expect(paint('#ff2d9b')).toEqual({ color: '#ff2d9b', opacity: undefined })
  })

  it('splits an eight-digit hex into colour and opacity', () => {
    expect(paint('#ff2d9b80').color).toBe('#ff2d9b')
    expect(paint('#ff2d9b80').opacity).toBeCloseTo(128 / 255, 6)
  })

  it('reads the ends exactly', () => {
    expect(paint('#00000000').opacity).toBe(0)
    expect(paint('#000000ff').opacity).toBe(1)
  })

  it('passes anything it does not recognise straight through', () => {
    // named colours and rgb() are not this app's convention, but must not break
    expect(paint('none')).toEqual({ color: 'none', opacity: undefined })
    expect(paint('red').color).toBe('red')
    expect(paint(undefined).color).toBe('none')
  })

  it('calls an unmentioned alpha opaque', () => {
    expect(alphaOf('#ff2d9b')).toBe(1)
    expect(alphaOf(undefined)).toBe(1)
  })
})

describe('writing a colour', () => {
  it('drops back to six digits at full strength', () => {
    /* ⚠️ The compatibility promise. A figure saved before transparency
       existed, opened and saved again untouched, has to come back identical —
       so full opacity must not start writing `ff` onto every colour. */
    expect(withAlpha('#ff2d9b', 1)).toBe('#ff2d9b')
    expect(withAlpha('#ff2d9bff', 1)).toBe('#ff2d9b')
  })

  it('writes the alpha as two digits below that', () => {
    expect(withAlpha('#ff2d9b', 0.5)).toBe('#ff2d9b80')
    expect(withAlpha('#ff2d9b', 0)).toBe('#ff2d9b00')
  })

  it('replaces an alpha rather than appending to it', () => {
    expect(withAlpha('#ff2d9b33', 0.5)).toBe('#ff2d9b80')
  })

  it('round-trips', () => {
    for (const a of [0, 0.25, 0.5, 0.75, 1]) {
      expect(alphaOf(withAlpha('#3decfd', a))).toBeCloseTo(a, 2)
    }
  })

  it('leaves "none" as nothing rather than making it a transparent colour', () => {
    expect(withAlpha('none', 0.4)).toBe('none')
  })

  it('clamps instead of writing a hex that is not one', () => {
    expect(withAlpha('#ffffff', 5)).toBe('#ffffff')
    expect(withAlpha('#ffffff', -3)).toBe('#ffffff00')
  })
})
