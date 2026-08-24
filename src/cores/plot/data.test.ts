/* What arrives in the data pane is a paste, not a format. These pin the guesses
   the parser makes about it — the ones that are wrong in a way the author would
   not notice, because a mis-sniffed delimiter still draws *a* chart. */

import { describe, expect, it } from 'vitest'
import { categories, numberColumn, parseTable, toNumber } from './data'

describe('toNumber', () => {
  it('reads what a real table contains', () => {
    expect(toNumber('1234')).toBe(1234)
    expect(toNumber('1,234.5')).toBe(1234.5)
    expect(toNumber('  -2.5e3 ')).toBe(-2500)
    // the unicode minus every PDF copy-paste carries
    expect(toNumber('−7')).toBe(-7)
    expect(toNumber('45%')).toBeCloseTo(0.45, 12)
  })

  it('refuses things that merely start with a number', () => {
    expect(toNumber('3 apples')).toBeNaN()
    expect(toNumber('')).toBeNaN()
    expect(toNumber('--3')).toBeNaN()
  })
})

describe('parseTable', () => {
  it('detects a header row by what the column becomes below it', () => {
    const t = parseTable('model\tacc\nresnet\t76.1\nvit\t81.4')
    expect(t.columns.map((c) => c.name)).toEqual(['model', 'acc'])
    expect(t.columns[1].numeric).toBe(true)
    expect(t.rows).toHaveLength(2)
  })

  it('names the columns itself when the table is numbers all the way up', () => {
    const t = parseTable('1 2\n3 4')
    expect(t.columns.map((c) => c.name)).toEqual(['열 1', '열 2'])
    expect(t.rows).toHaveLength(2)
  })

  /* Decimal-comma data has a comma in every row but never the same number of
     them, which is exactly what separates a separator from a coincidence. */
  it('does not mistake decimal commas for a delimiter', () => {
    const t = parseTable('a\tb\n1,5\t2\n3\t4,25')
    expect(t.columns).toHaveLength(2)
  })

  it('takes CSV with quoted fields', () => {
    const t = parseTable('name,value\n"Lee, J.",3\n"say ""hi""",4')
    expect(t.rows[0][0]).toBe('Lee, J.')
    expect(t.rows[1][0]).toBe('say "hi"')
    expect(numberColumn(t, 'value')).toEqual([3, 4])
  })

  it('skips comments and blank lines', () => {
    const t = parseTable('# 2024 결과\nx,y\n\n1,2\n# 빠짐\n3,4')
    expect(t.rows).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('keeps a short row usable by padding it', () => {
    const t = parseTable('a,b,c\n1,2\n3,4,5')
    expect(t.rows[0]).toEqual([1, 2, null])
  })

  it('makes duplicate headers addressable', () => {
    const t = parseTable('x,x\n1,2')
    expect(t.columns.map((c) => c.name)).toEqual(['x', 'x (2)'])
  })

  it('reads categories in first-appearance order, once each', () => {
    const t = parseTable('city,v\n서울,1\n부산,2\n서울,3')
    expect(categories(t, 'city')).toEqual(['서울', '부산'])
  })
})
