/* The two text modes.
 *
 * A label is one string read two different ways, and the dollar sign is where
 * they disagree. These pin the disagreement down, and pin down the conversion
 * that has to happen when a label is moved from one mode to the other — because
 * without it, picking "LaTeX" from a dropdown would silently turn `$x^2$` into
 * an error and `Layer` into five italic variables multiplied together.
 *
 * Nothing here touches MathJax: parsing and rewriting are pure string work, and
 * the megabyte of typesetting only shows up at layout time. */

import { describe, expect, it } from 'vitest'
import { hasMath, labelSegs, parseLabel, retypeLabel } from './latex'

describe('reading a label in prose mode', () => {
  it('treats dollars as fences and everything else as words', () => {
    expect(parseLabel('loss $\\mathcal{L}$ here')).toEqual([
      { t: 'text', v: 'loss ' },
      { t: 'math', v: '\\mathcal{L}', display: false },
      { t: 'text', v: ' here' },
    ])
  })

  it('lets a dollar be a dollar when it is escaped', () => {
    expect(parseLabel('\\$5')).toEqual([{ t: 'text', v: '$5' }])
  })

  it('leaves an unmatched fence as text rather than eating the rest', () => {
    expect(parseLabel('cost $9')).toEqual([{ t: 'text', v: 'cost $9' }])
  })
})

describe('reading a label in LaTeX mode', () => {
  it('takes the whole string as one expression, fences and all', () => {
    expect(labelSegs('\\sigma(Wx + b)', true)).toEqual([
      { t: 'math', v: '\\sigma(Wx + b)', display: false },
    ])
  })

  it('does not treat a dollar as a delimiter', () => {
    /* In this mode a stray `$` is a TeX error, exactly as it would be in a .tex
       file — what it must not be is a silent fence that swallows half the
       label. */
    expect(labelSegs('a $ b', true)).toEqual([{ t: 'math', v: 'a $ b', display: false }])
  })

  it('has nothing to typeset when the string is blank', () => {
    expect(labelSegs('   ', true)).toEqual([])
    expect(hasMath('   ', true)).toBe(false)
    expect(hasMath('x', true)).toBe(true)
  })

  it('is not what prose mode does with the same string', () => {
    expect(labelSegs('\\sigma', false)).toEqual([{ t: 'text', v: '\\sigma' }])
  })
})

describe('switching a label between modes', () => {
  it('unfences maths and wraps prose on the way in', () => {
    expect(retypeLabel('loss $\\mathcal{L}$', 'sans', 'latex')).toBe('\\text{loss }\\mathcal{L}')
  })

  it('makes a bare word upright instead of italic variables', () => {
    expect(retypeLabel('Layer', 'sans', 'latex')).toBe('\\text{Layer}')
  })

  it('rescues a label that was all maths', () => {
    expect(retypeLabel('$\\mathcal{L}_{\\mathrm{data}}$', 'sans', 'latex')).toBe(
      '\\mathcal{L}_{\\mathrm{data}}',
    )
  })

  it('escapes what TeX would otherwise eat', () => {
    expect(retypeLabel('100% & _x_', 'sans', 'latex')).toBe('\\text{100\\% \\& \\_x\\_}')
  })

  it('puts multiple lines in an environment, since bare \\\\ is an error', () => {
    const out = retypeLabel('a\nb', 'sans', 'latex')
    expect(out).toBe('\\begin{gathered}\\text{a}\\\\\\text{b}\\end{gathered}')
  })

  it('fences the whole thing on the way out', () => {
    expect(retypeLabel('\\sigma', 'latex', 'sans')).toBe('$\\sigma$')
  })

  it('leaves the string alone when the mode did not really change', () => {
    // serif → mono is a font change, not a mode change
    expect(retypeLabel('loss $x$', 'serif', 'mono')).toBe('loss $x$')
    expect(retypeLabel('x^2', 'latex', 'latex')).toBe('x^2')
  })

  it('leaves an empty label empty rather than making it \\text{}', () => {
    expect(retypeLabel('', 'sans', 'latex')).toBe('')
  })

  it('survives a round trip visually, if not byte for byte', () => {
    /* ⚠️ The documented limit: what comes back renders the same but is not the
       same source. Chasing the bytes would mean guessing which `\text{}` the
       user wrote and which the conversion added, and guessing wrong deletes
       their markup. */
    const there = retypeLabel('loss $x$', 'sans', 'latex')
    expect(retypeLabel(there, 'latex', 'sans')).toBe('$\\text{loss }x$')
  })
})
