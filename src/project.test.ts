/* The project envelope is a compatibility surface: files people saved keep
 * arriving, and the storage keys are what every browser's in-progress work
 * lives under. These tests exist so a rename or a "small tidy" cannot silently
 * orphan either. */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  APP_ID,
  FORMAT,
  STORE_KEYS,
  TOOL_IDS,
  applyProject,
  buildProject,
  parseProject,
  type ToolId,
} from './project'

/* minimal localStorage — the real one is not in scope for a node test run */
class MemStorage {
  private map = new Map<string, string>()
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  clear() {
    this.map.clear()
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemStorage(),
    configurable: true,
  })
})

describe('storage keys', () => {
  it('covers every tool', () => {
    expect(TOOL_IDS.length).toBe(10)
    for (const id of TOOL_IDS) expect(STORE_KEYS[id]).toBeTruthy()
  })

  /* Frozen on purpose. If one of these has to change, existing saves and every
     user's current work need a migration — not just a new string here. */
  it('matches the published keys', () => {
    expect(STORE_KEYS).toEqual({
      highlighter: 'highlighter.v1',
      latex: 'lateximager.v1',
      tabler: 'tabler.v1',
      dsviz: 'dsviz.v1',
      grapher: 'grapher:v1',
      aifig: 'fem.aifig.v1',
      cartesian: 'fem.cartesian.v3',
      chart: 'fem.chart.v1',
      numline: 'fem.numline.v1',
      truth: 'fem.truth.v1',
    })
  })
})

describe('round trip', () => {
  it('saves what the tool stored and loads it back', () => {
    const state = { input: 'p and q', useTF: true }
    localStorage.setItem(STORE_KEYS.truth, JSON.stringify(state))

    const project = buildProject('truth')
    expect(project).not.toBeNull()
    expect(project!.app).toBe(APP_ID)
    expect(project!.tool).toBe('truth')
    expect(project!.data).toEqual(state)

    // a different browser, nothing stored
    localStorage.clear()
    expect(applyProject(project!)).toBe(true)
    expect(JSON.parse(localStorage.getItem(STORE_KEYS.truth)!)).toEqual(state)
  })

  it('survives a text round trip through parse', () => {
    localStorage.setItem(STORE_KEYS.chart, JSON.stringify({ type: 'pie' }))
    const text = JSON.stringify(buildProject('chart'))
    const parsed = parseProject(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.project.tool).toBe('chart')
      expect(parsed.project.data).toEqual({ type: 'pie' })
    }
  })

  it('has nothing to save before the tool has run', () => {
    expect(buildProject('tabler')).toBeNull()
  })
})

describe('parsing', () => {
  const wrap = (over: Record<string, unknown>) =>
    JSON.stringify({ app: APP_ID, format: FORMAT, tool: 'truth', data: {}, ...over })

  it('rejects text that is not JSON', () => {
    const r = parseProject('nope{')
    expect(r.ok).toBe(false)
  })

  it('rejects JSON that is not a project', () => {
    expect(parseProject('[1,2,3]').ok).toBe(false)
    expect(parseProject('{"hello":"world"}').ok).toBe(false)
  })

  it('rejects an unknown tool', () => {
    const r = parseProject(wrap({ tool: 'spreadsheet' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('spreadsheet')
  })

  it('rejects a file from a newer format', () => {
    const r = parseProject(wrap({ format: FORMAT + 1 }))
    expect(r.ok).toBe(false)
  })

  it('accepts an older format', () => {
    const r = parseProject(wrap({ format: 0 }))
    expect(r.ok).toBe(true)
  })

  /* AI Figure Maker wrote bare figure JSON before the envelope existed. Those
     files still open, but only as the tool the user is looking at — there is
     nothing in them that says which one they belong to. */
  it('reads a pre-envelope payload as the current tool', () => {
    const bare = JSON.stringify({ nodes: [], edges: [] })
    expect(parseProject(bare).ok).toBe(false)

    const r = parseProject(bare, 'aifig')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.project.tool).toBe('aifig')
      expect(r.project.data).toEqual({ nodes: [], edges: [] })
    }
  })

  /* `theme` was added after the format shipped, so it has to be optional in
     both directions: an old file must open (in whatever mode the app is in)
     and a new file must record which mode it was exported from. */
  it('carries the render mode when there is one', () => {
    localStorage.setItem(STORE_KEYS.tabler, JSON.stringify({ cells: [['a']] }))
    expect(buildProject('tabler')?.theme).toBeUndefined()
    expect(buildProject('tabler', { theme: 'paper' })?.theme).toBe('paper')

    const r = parseProject(wrap({ theme: 'paper' }))
    expect(r.ok && r.project.theme).toBe('paper')
    expect(parseProject(wrap({})).ok && parseProject(wrap({})).ok).toBe(true)
    const none = parseProject(wrap({}))
    expect(none.ok && none.project.theme).toBeUndefined()
    const junk = parseProject(wrap({ theme: 'neon' }))
    expect(junk.ok && junk.project.theme).toBeUndefined()
  })

  it('round-trips every tool id', () => {
    for (const id of TOOL_IDS) {
      const r = parseProject(wrap({ tool: id, data: { marker: id } }))
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.project.tool).toBe(id as ToolId)
        expect(r.project.data).toEqual({ marker: id })
      }
    }
  })
})
