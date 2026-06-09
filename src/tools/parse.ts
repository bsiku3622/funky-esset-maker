/* ---------- input parsing ----------
   one declaration per line:
     name = [a, b, c]      → list  (single-row table)
     name = {k: v, ...}    → dict  (two-column table)
   commas / colons are split at top level only, so nested (), [], {} survive. */

export interface ListBlock {
  kind: 'list'
  name: string
  items: string[]
}
export interface DictBlock {
  kind: 'dict'
  name: string
  entries: { key: string; value: string }[]
}
export interface ErrorBlock {
  kind: 'error'
  raw: string
  msg: string
}
export type Block = ListBlock | DictBlock | ErrorBlock

const OPEN = '([{'
const CLOSE = ')]}'

// split on a separator that appears at bracket depth 0
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (OPEN.includes(ch)) depth++
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1)
    if (ch === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

// index of the first top-level colon (for dict key:value)
function firstTopColon(s: string): number {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (OPEN.includes(ch)) depth++
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1)
    else if (ch === ':' && depth === 0) return i
  }
  return -1
}

function parseLine(line: string): Block {
  const eq = line.indexOf('=')
  if (eq === -1)
    return {
      kind: 'error',
      raw: line,
      msg: '형식: 이름 = [ ... ] 또는 이름 = { ... }',
    }
  const name = line.slice(0, eq).trim()
  const rhs = line.slice(eq + 1).trim()
  if (!name) return { kind: 'error', raw: line, msg: '변수 이름이 없습니다' }

  if (rhs.startsWith('[') && rhs.endsWith(']')) {
    const inner = rhs.slice(1, -1).trim()
    const items = inner
      ? splitTop(inner, ',').map((s) => s.trim()).filter((s) => s.length > 0)
      : []
    return { kind: 'list', name, items }
  }

  if (rhs.startsWith('{') && rhs.endsWith('}')) {
    const inner = rhs.slice(1, -1).trim()
    const parts = inner
      ? splitTop(inner, ',').map((s) => s.trim()).filter((s) => s.length > 0)
      : []
    const entries = parts.map((p) => {
      const ci = firstTopColon(p)
      if (ci === -1) return { key: p.trim(), value: '' }
      return { key: p.slice(0, ci).trim(), value: p.slice(ci + 1).trim() }
    })
    return { kind: 'dict', name, entries }
  }

  return {
    kind: 'error',
    raw: line,
    msg: '[ ... ] (리스트) 또는 { ... } (딕셔너리) 형식이어야 합니다',
  }
}

export function parseInput(input: string): Block[] {
  return input
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map(parseLine)
}
