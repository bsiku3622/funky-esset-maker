/* The LaTeX export is pasted into a document that then has to compile, so the
 * two things worth pinning are that specials get escaped and that the booktabs
 * rules land in the right places. */

import { describe, expect, it } from 'vitest'
import { escapeTex, texBoolean, texListing, texTable } from './tex'

describe('escaping', () => {
  it('escapes the characters that would break a build', () => {
    expect(escapeTex('a & b')).toBe('a \\& b')
    expect(escapeTex('100%')).toBe('100\\%')
    expect(escapeTex('x_1')).toBe('x\\_1')
    expect(escapeTex('$5')).toBe('\\$5')
    expect(escapeTex('a^b')).toBe('a\\textasciicircum{}b')
    expect(escapeTex('~x')).toBe('\\textasciitilde{}x')
  })

  /* The backslash has to go first, or the replacements for the other specials
     get their own backslashes escaped afterwards. */
  it('escapes a backslash without eating the later escapes', () => {
    expect(escapeTex('\\ & _')).toBe('\\textbackslash{} \\& \\_')
  })
})

describe('booktabs table', () => {
  const cells = [
    ['Model', 'Acc'],
    ['ResNet', '76.1'],
  ]

  it('puts the midrule under the header row only', () => {
    const tex = texTable(cells, { headerRow: true, align: 'center' })
    const lines = tex.split('\n')
    expect(lines.indexOf('\\midrule')).toBe(lines.indexOf('Model & Acc \\\\') + 1)
    expect(tex.match(/\\midrule/g)).toHaveLength(1)
    expect(tex).toContain('\\toprule')
    expect(tex).toContain('\\bottomrule')
  })

  it('omits the midrule when there is no header row', () => {
    expect(texTable(cells, { headerRow: false, align: 'left' })).not.toContain('\\midrule')
  })

  it('derives the column spec from the alignment', () => {
    expect(texTable(cells, { headerRow: true, align: 'right' })).toContain('{rr}')
    // a stub column is left-aligned whatever the body does
    expect(
      texTable(cells, { headerRow: true, headerCol: true, align: 'right' }),
    ).toContain('{lr}')
  })

  it('leaves raw cells alone', () => {
    const tex = texTable([['$p$', '$q$']], { headerRow: true, align: 'center', raw: true })
    expect(tex).toContain('$p$ & $q$')
  })

  it('returns nothing for an empty table', () => {
    expect(texTable([], { headerRow: true, align: 'left' })).toBe('')
  })
})

describe('boolean expressions', () => {
  it('turns the ASCII operators into maths', () => {
    expect(texBoolean('p and q')).toBe('$p \\land q$')
    expect(texBoolean('p or not q')).toBe('$p \\lor \\lnot q$')
    expect(texBoolean('p -> q')).toBe('$p \\rightarrow q$')
    expect(texBoolean('p <-> q')).toBe('$p \\leftrightarrow q$')
  })
})

describe('listings', () => {
  it('does not escape the code', () => {
    expect(texListing('a & b_c')).toContain('a & b_c')
  })

  /* A snippet containing the end marker would close the environment early and
     leave the rest of the file as body text. */
  it('defuses a nested end marker', () => {
    expect(texListing('\\end{lstlisting}').match(/\\end\{lstlisting\}/g)).toHaveLength(1)
  })

  it('omits the language key when there is none', () => {
    expect(texListing('x = 1')).not.toContain('language=')
    expect(texListing('x = 1', { language: 'Python' })).toContain('language=Python')
  })
})
