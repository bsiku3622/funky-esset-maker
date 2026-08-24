/* A saved payload is not necessarily something this app wrote — project files
 * are hand-editable JSON and `llms.txt` invites an assistant to author one. So
 * what `useStored` reads back is checked against the shape of the tool's
 * defaults first. These tests pin what that check does and does not promise:
 * it is a shallow filter, not a schema, and the ErrorBoundary is what stands
 * behind it. */

import { describe, expect, it } from 'vitest'
import { shapeMatches } from './hooks'

describe('shapeMatches', () => {
  it('compares primitives by type', () => {
    expect(shapeMatches(30, 18)).toBe(true)
    expect(shapeMatches('30', 18)).toBe(false)
    expect(shapeMatches(true, false)).toBe(true)
    expect(shapeMatches('left', 'center')).toBe(true)
    expect(shapeMatches(0, 'center')).toBe(false)
  })

  it('will not take a scalar where an array belongs', () => {
    expect(shapeMatches('a,b,c', ['a', 'b'])).toBe(false)
    expect(shapeMatches({ 0: 'a' }, ['a', 'b'])).toBe(false)
    expect(shapeMatches([], ['a', 'b'])).toBe(true)
  })

  /* The case that crashed Tabler: `cells` arrives as an array, so a top-level
     check passes it, and the throw happens a level down at `row.map`. */
  it('checks one level inside an array', () => {
    const cells = [
      ['Model', 'Acc'],
      ['ResNet-50', '76.1'],
    ]
    expect(shapeMatches(cells, cells)).toBe(true)
    expect(shapeMatches([['Model', 'Acc'], 'ResNet-50,76.1'], cells)).toBe(false)
    expect(shapeMatches([[1, 2]], cells)).toBe(false)
  })

  it('reads no element shape out of an empty default', () => {
    expect(shapeMatches([120, 80], [])).toBe(true)
    expect(shapeMatches(['anything', {}], [])).toBe(true)
  })

  /* Most objects here are records keyed by the user's own strings — a language
     name, a `row,col` cell — so a default says nothing about which keys exist. */
  it('accepts any object where an object belongs', () => {
    expect(shapeMatches({ python: 'print(1)' }, { js: 'console.log(1)' })).toBe(true)
    expect(shapeMatches({}, { js: '' })).toBe(true)
    expect(shapeMatches([], { js: '' })).toBe(false)
    expect(shapeMatches(null, { js: '' })).toBe(false)
    expect(shapeMatches('nope', { js: '' })).toBe(false)
  })

  it('has nothing to check when the default is null or absent', () => {
    expect(shapeMatches('anything', null)).toBe(true)
    expect(shapeMatches(42, undefined)).toBe(true)
  })

  it('stops at the depth it promises', () => {
    const ref = [[['deep']]]
    // two levels in, the innermost array is taken on trust
    expect(shapeMatches([[[42]]], ref)).toBe(true)
    // but a mismatch within those two levels is still caught
    expect(shapeMatches([['flat']], ref)).toBe(false)
  })
})
