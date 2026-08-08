/* Syntax highlighting, shared by the CodeBlock core and the Highlighter tool.
 *
 * The tool cannot embed CodeBlock — it overlays an editable textarea on the
 * highlighted markup and adds crop / pan / ratio machinery — but both must
 * produce the *same* markup, or a snippet would look different once it lands in
 * a slide. So the markup step lives here and the two share it. */

import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-markdown'

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Highlight `code` as `lang`, falling back to escaped plain text for 'plain'
 *  and for any language Prism has no grammar for. The trailing newline keeps
 *  the last line's height stable (and, in the tool, keeps the <pre> in step
 *  with the textarea behind it). */
export function highlightCode(code: string, lang: string): string {
  const grammar = Prism.languages[lang]
  const out =
    lang === 'plain' || !grammar
      ? escapeHtml(code)
      : Prism.highlight(code, grammar, lang)
  return out + '\n'
}
