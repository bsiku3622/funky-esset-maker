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
import { caretOffset } from './layout'

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

describe('where the cursor is in a drawn label', () => {
  /* The field that catches the keystrokes is invisible, so the caret drawn on
     the figure is the only one there is — it has to move when the cursor does.
     In prose the source and the glyphs run in step, so this is exact. */
  const prose = { family: 'sans-serif', size: 10, weight: 400, italic: false, lineHeight: 1.2 }

  it('grows with the cursor', () => {
    const xs = [0, 2, 4, 7].map((i) => caretOffset('abc def', i, prose).x)
    expect(xs[0]).toBe(0)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
  })

  it('lands at the end for a cursor past the end', () => {
    const end = caretOffset('abc', 3, prose)
    expect(caretOffset('abc', 99, prose)).toEqual(end)
  })

  it('counts the line an explicit break puts it on', () => {
    expect(caretOffset('ab\ncd', 4, prose).line).toBe(1)
    expect(caretOffset('ab\\ncd', 5, prose).line).toBe(1)
    expect(caretOffset('ab\ncd', 1, prose).line).toBe(0)
  })

  it('measures only the part of the line behind the cursor', () => {
    // second line, one character in — not four characters in
    expect(caretOffset('ab\ncd', 4, prose).x).toBe(caretOffset('c', 1, prose).x)
  })

  it('never runs off the front', () => {
    expect(caretOffset('abc', -5, prose).x).toBe(0)
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
