/* LaTeX source export.
 *
 * For a table, a truth table or a code listing, the thing you actually want in
 * a paper is not an image — it is source. An image of a table does not match
 * the document's font, does not reflow, cannot be searched, and looks wrong at
 * every zoom level; every style guide says so and every reviewer notices.
 *
 * So paper mode gives these tools a .tex button next to the .png one. The
 * generated source is deliberately plain: booktabs rules, no colour, no
 * package tricks beyond the one line the preamble note asks for. It is meant
 * to be pasted and then edited, which is why the caption and label are left
 * empty rather than filled with something you would have to notice and
 * delete. */

/* ⚠️ One pass, not a chain of .replace() calls. Three of the replacements emit
   braces or backslashes of their own, and a later rule in the chain escapes
   those again — `\` came out as `\textbackslash\{\}`, which typesets the
   literal text. A single regex with a lookup table never re-scans its own
   output. */
const SPECIALS: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
}

/** Escape the ten characters that mean something to TeX. */
export function escapeTex(s: string): string {
  return s.replace(/[\\&%$#_{}~^]/g, (ch) => SPECIALS[ch])
}

export type TexAlign = 'left' | 'center' | 'right'
const COL: Record<TexAlign, string> = { left: 'l', center: 'c', right: 'r' }

export interface TexTableOptions {
  /** first row is the header, so it gets the midrule under it */
  headerRow: boolean
  /** first column is a stub — left-aligned regardless of the body alignment */
  headerCol?: boolean
  align: TexAlign
  /** cell contents are already TeX (maths, say) and must not be escaped */
  raw?: boolean
  caption?: string
  label?: string
}

/** A booktabs table. `cells[0]` is the header row when `headerRow` is set. */
export function texTable(cells: string[][], opts: TexTableOptions): string {
  const cols = cells[0]?.length ?? 0
  if (!cols) return ''
  const spec = Array.from({ length: cols }, (_, i) =>
    opts.headerCol && i === 0 ? 'l' : COL[opts.align],
  ).join('')

  const esc = (s: string) => (opts.raw ? s : escapeTex(s))
  const row = (r: string[]) => `${r.map(esc).join(' & ')} \\\\`

  const body: string[] = []
  cells.forEach((r, i) => {
    body.push(row(r))
    if (opts.headerRow && i === 0) body.push('\\midrule')
  })

  return [
    '% \\usepackage{booktabs}',
    '\\begin{table}[t]',
    '\\centering',
    `\\begin{tabular}{${spec}}`,
    '\\toprule',
    ...body,
    '\\bottomrule',
    '\\end{tabular}',
    `\\caption{${opts.caption ?? ''}}`,
    `\\label{tab:${opts.label ?? ''}}`,
    '\\end{table}',
    '',
  ].join('\n')
}

/** Boolean operators as their maths symbols, so a truth table header reads as
 *  logic rather than as the ASCII the tool is typed in. */
export function texBoolean(expr: string): string {
  const body = expr
    .replace(/<->|<=>|↔/g, ' \\leftrightarrow ')
    .replace(/->|=>|→/g, ' \\rightarrow ')
    .replace(/\bxor\b|⊕|\^/gi, ' \\oplus ')
    .replace(/\band\b|&&|&|∧/gi, ' \\land ')
    .replace(/\bor\b|\|\||\||∨/gi, ' \\lor ')
    .replace(/\bnot\b|¬|!/gi, ' \\lnot ')
    .replace(/\s+/g, ' ')
    .trim()
  return `$${body}$`
}

export interface TexListingOptions {
  /** the `language=` key; listings knows Python, Java, C, … */
  language?: string
  caption?: string
  label?: string
}

/** A `listings` block. Nothing inside is escaped — that is the point of the
 *  environment — so the only hazard is code containing \end{lstlisting}. */
export function texListing(code: string, opts: TexListingOptions = {}): string {
  const keys = [
    opts.language ? `language=${opts.language}` : null,
    opts.caption ? `caption={${escapeTex(opts.caption)}}` : null,
    opts.label ? `label={lst:${opts.label}}` : null,
    'basicstyle=\\ttfamily\\small',
    'frame=single',
  ].filter(Boolean)
  return [
    '% \\usepackage{listings}',
    `\\begin{lstlisting}[${keys.join(',')}]`,
    code.replace(/\\end\{lstlisting\}/g, '\\end {lstlisting}'),
    '\\end{lstlisting}',
    '',
  ].join('\n')
}
