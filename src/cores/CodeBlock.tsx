import { useMemo } from 'react'
import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-markdown'
import './cores.css'

/* CodeBlock — display-only render core extracted from the Highlighter tool.
   No toolbar, no editing textarea, no fit/scroll machinery: it just paints the
   neo-brutalist code window so it can be embedded in slides (or anywhere). */

export type CodeTheme = 'light' | 'dark'

export interface CodeBlockProps {
  code: string
  /** prism language id — falls back to escaped plain text when unknown */
  lang?: string
  theme?: CodeTheme
  /** px */
  fontSize?: number
  /** window title shown in the bar; hidden when omitted */
  fileName?: string
  /** fixed content width in px; content sizes to its lines when omitted */
  width?: number
  /** soft-wrap long lines (requires an explicit width to matter) */
  wrap?: boolean
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function CodeBlock({
  code,
  lang = 'plain',
  theme = 'dark',
  fontSize = 18,
  fileName,
  width,
  wrap = true,
}: CodeBlockProps) {
  const html = useMemo(() => {
    const grammar = Prism.languages[lang]
    const out =
      lang === 'plain' || !grammar
        ? escapeHtml(code)
        : Prism.highlight(code, grammar, lang)
    return out + '\n' // trailing newline keeps the last line height stable
  }, [code, lang])

  return (
    <div className={`fx-frame fx-frame--${theme}`}>
      <div className="fx-frame__bar">
        <span className="fx-dot fx-dot--pink" />
        <span className="fx-dot fx-dot--yellow" />
        <span className="fx-dot fx-dot--green" />
        {fileName && <span className="fx-frame__name">{fileName}</span>}
      </div>
      <div
        className={`fx-code ${wrap ? 'fx-code--wrap' : 'fx-code--nowrap'}`}
        style={{
          fontSize: `${fontSize}px`,
          ...(width ? { width: `${width}px` } : {}),
        }}
      >
        <pre className="fx-code__pre">
          <code
            className={`language-${lang}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
      </div>
    </div>
  )
}
