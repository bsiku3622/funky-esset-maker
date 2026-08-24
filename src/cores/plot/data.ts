/* The data half of a plot: text in, a typed table out.
 *
 * Every plotting tool has to answer "where do the numbers come from", and the
 * honest answer for a browser tool is "somebody pastes them". So the input is
 * whatever a spreadsheet, a terminal or a paper's table actually produces —
 * comma, tab, semicolon or run-of-spaces separated — and the parser works out
 * which it is instead of asking.
 *
 * ⚠️ The table is the document. The plot spec refers to columns *by name*, so
 * renaming a header re-binds every series that used it, and reordering columns
 * changes nothing. That is deliberate: a positional binding breaks silently
 * when someone inserts a column, and a chart that quietly plots the wrong
 * column is worse than one that plots nothing. */

export type Cell = number | string | null

export interface Column {
  name: string
  /** every non-empty cell parsed as a number */
  numeric: boolean
}

export interface DataTable {
  columns: Column[]
  rows: Cell[][]
}

export const EMPTY_TABLE: DataTable = { columns: [], rows: [] }

/* ---------- delimiter sniffing ---------- */

const CANDIDATES = ['\t', ',', ';', '|'] as const

/** Which delimiter splits the body into the most consistent row width?
 *
 *  Counting occurrences alone picks the wrong one on decimal-comma data, where
 *  every row has commas but never the same number of them. Consistency is the
 *  signal that a character is structural rather than incidental. */
function sniff(lines: string[]): string | 'ws' {
  let best: string | 'ws' = 'ws'
  let bestScore = -1
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => splitDelimited(l, d).length)
    const width = counts[0]
    if (width < 2) continue
    const agree = counts.filter((c) => c === width).length / counts.length
    const score = agree * 10 + Math.min(width, 8) * 0.1
    if (agree >= 0.8 && score > bestScore) {
      bestScore = score
      best = d
    }
  }
  if (bestScore >= 0) return best
  // run-of-spaces only counts if it actually produces columns
  const w = lines.map((l) => l.trim().split(/\s+/).length)
  return w[0] >= 2 && w.filter((c) => c === w[0]).length / w.length >= 0.8 ? 'ws' : ','
}

/** Split one line, honouring "quoted, fields". */
function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/* ---------- numbers ---------- */

/** Parse a cell as a number, or NaN.
 *
 *  Accepts what a real table contains: thousands separators, a trailing
 *  percent, a leading currency-ish symbol, and the unicode minus that every
 *  copy-paste from a PDF carries. */
export function toNumber(raw: string): number {
  const t = raw.trim().replace(/[−–]/g, '-')
  if (!t) return NaN
  const cleaned = t.replace(/[,\s_]/g, '').replace(/%$/, '')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cleaned)) return NaN
  const n = Number(cleaned)
  return t.endsWith('%') ? n / 100 : n
}

const isNumeric = (raw: string) => raw.trim() === '' || Number.isFinite(toNumber(raw))

/* ---------- the parser ---------- */

/** Turn pasted text into a table.
 *
 *  A header row is detected rather than declared: if the first row has a cell
 *  that is not a number while the same column is numeric further down, the
 *  first row is names. A table that is numbers all the way up gets generic
 *  column names, which is what a bare matrix should do. */
export function parseTable(text: string): DataTable {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '' && !/^\s*#/.test(l))
  if (!lines.length) return EMPTY_TABLE

  const delim = sniff(lines)
  const split = (l: string) =>
    delim === 'ws' ? l.trim().split(/\s+/) : splitDelimited(l, delim).map((c) => c.trim())

  const grid = lines.map(split)
  const width = Math.max(...grid.map((r) => r.length))
  for (const r of grid) while (r.length < width) r.push('')

  const first = grid[0]
  const body = grid.slice(1)
  const headed =
    body.length > 0 &&
    first.some((cell, i) => !isNumeric(cell) && body.some((r) => isNumeric(r[i]) && r[i] !== ''))

  const names = headed
    ? first.map((c, i) => c.trim() || `열 ${i + 1}`)
    : first.map((_, i) => `열 ${i + 1}`)
  const dataRows = headed ? body : grid

  const columns: Column[] = names.map((name, i) => ({
    name: dedupe(name, names, i),
    numeric: dataRows.every((r) => isNumeric(r[i] ?? '')),
  }))

  const rows: Cell[][] = dataRows.map((r) =>
    r.map((cell, i) => {
      if (cell === '') return null
      if (columns[i]?.numeric) {
        const n = toNumber(cell)
        return Number.isFinite(n) ? n : null
      }
      return cell
    }),
  )

  return { columns, rows }
}

/** Two columns with the same header would make a binding ambiguous, and the
 *  binding is by name — so the later one gets a suffix. */
function dedupe(name: string, all: string[], index: number): string {
  const before = all.slice(0, index).filter((n) => n === name).length
  return before ? `${name} (${before + 1})` : name
}

/* ---------- reading a column ---------- */

export const columnIndex = (t: DataTable, name: string | undefined): number =>
  name === undefined ? -1 : t.columns.findIndex((c) => c.name === name)

/** A column as numbers, with non-numeric cells as NaN. */
export function numberColumn(t: DataTable, name: string | undefined): number[] {
  const i = columnIndex(t, name)
  if (i < 0) return []
  return t.rows.map((r) => {
    const v = r[i]
    return typeof v === 'number' ? v : NaN
  })
}

/** A column as display strings. Numbers are formatted plainly — a category
 *  label that reads `1` should not become `1.0000000000000002`. */
export function textColumn(t: DataTable, name: string | undefined): string[] {
  const i = columnIndex(t, name)
  if (i < 0) return []
  return t.rows.map((r) => {
    const v = r[i]
    if (v === null) return ''
    return typeof v === 'number' ? String(+v.toFixed(10)) : v
  })
}

/** Row indices in `name` order of first appearance — the category axis for a
 *  bar chart whose x column is text. */
export function categories(t: DataTable, name: string | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of textColumn(t, name)) {
    if (v === '' || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/** Serialise a table back to tab-separated text — for a tool that edits cells
 *  in a grid and has to write the text document back. */
export function tableToText(t: DataTable): string {
  const head = t.columns.map((c) => c.name).join('\t')
  const body = t.rows
    .map((r) => r.map((v) => (v === null ? '' : typeof v === 'number' ? String(v) : v)).join('\t'))
    .join('\n')
  return `${head}\n${body}`
}
