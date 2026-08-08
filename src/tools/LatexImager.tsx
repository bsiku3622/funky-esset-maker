import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { useFitScale, usePersist, usePngExport, useStored } from './hooks'
import katex from 'katex'
import './LatexImager.css'

/* ---------- model ---------- */

type ColorKey =
  | 'ink'
  | 'white'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange'
  | 'sky'
  | 'green'

type BgKey = 'transparent' | 'cream' | 'white' | 'dark'

type Mode = 'math' | 'document'

// funky palette mirrored for the equation color
const COLOR_HEX: Record<ColorKey, string> = {
  ink: '#222222',
  white: '#ffffff',
  pink: '#ff4eba',
  purple: '#7828c8',
  cyan: '#3decfd',
  orange: '#ff9100',
  sky: '#00c8ff',
  green: '#00c22a',
}

const COLORS: ColorKey[] = [
  'ink',
  'white',
  'pink',
  'purple',
  'cyan',
  'orange',
  'sky',
  'green',
]

const BGS: { key: BgKey; label: string; hex: string | null }[] = [
  { key: 'transparent', label: '투명', hex: null },
  { key: 'cream', label: '크림', hex: '#fff5d1' },
  { key: 'white', label: '흰색', hex: '#ffffff' },
  { key: 'dark', label: '어두움', hex: '#1e1e22' },
]

const FONT_MIN = 16
const FONT_MAX: number = 160
const FONT_STEP = 6

const DOC_WIDTH_MIN = 160

const SAMPLE = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'

/* ---------- document mode: a small LaTeX-text shim + KaTeX for $...$ ----
   This is NOT full LaTeX — it covers prose markup commonly mixed with math:
   font commands, quotes, dashes, ellipsis, spacing, and inline / display math.
   Environments, sectioning, numbering, etc. are out of scope. */

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// replace innermost \cmd{...} repeatedly so nested commands resolve inside-out
function wrapCmd(s: string, name: string, open: string, close: string): string {
  const re = new RegExp(`\\\\${name}\\{([^{}]*)\\}`)
  let out = s
  let guard = 0
  while (re.test(out) && guard++ < 100) out = out.replace(re, open + '$1' + close)
  return out
}

// render a text-mode fragment (no math) to HTML
function renderText(raw: string): string {
  let s = escapeHtml(raw)
  s = s.replace(/\\\\/g, '<br>') // explicit line break
  s = s.replace(/\\q?quad/g, ' ') // \quad / \qquad → em space
  s = s.replace(/\\[,;:! ]/g, ' ') // thin spacing commands
  s = s.replace(/\\(?:ldots|dots|cdots)/g, '…')
  s = s.replace(/---/g, '—').replace(/--/g, '–')
  s = s.replace(/``/g, '“').replace(/''/g, '”')
  s = s.replace(/`/g, '‘').replace(/'/g, '’')
  s = s.replace(/~/g, ' ')
  s = wrapCmd(s, 'textbf', '<b>', '</b>')
  s = wrapCmd(s, 'textit', '<i>', '</i>')
  s = wrapCmd(s, 'emph', '<i>', '</i>')
  s = wrapCmd(s, 'texttt', '<code>', '</code>')
  s = wrapCmd(s, 'underline', '<u>', '</u>')
  s = wrapCmd(s, 'textrm', '<span>', '</span>')
  s = wrapCmd(s, 'text', '<span>', '</span>')
  return s
}

interface DocResult {
  html: string
  error: boolean
}

/* Stand-in for an escaped `\$` while we scan for math delimiters, so a literal
   dollar in prose never opens a formula. U+0001 cannot occur in real input.
   Written as an escape (not a raw byte) so it survives copy-paste and shows up
   in a diff; substitution uses split/join to keep it out of a regex. */
const ESC_DOLLAR = '\u0001'

// render the whole document (paragraphs split by blank lines)
function renderDocument(src: string): DocResult {
  let hadError = false
  const katexHtml = (text: string, display: boolean): string => {
    const html = katex.renderToString(text, {
      displayMode: display,
      throwOnError: false,
      output: 'html',
    })
    if (html.includes('katex-error')) hadError = true
    return html
  }

  const renderParagraph = (p: string): string => {
    // a single newline in LaTeX is just a space within a paragraph
    let text = p.replace(/\s*\n\s*/g, ' ')
    // unify \(\) \[\] to $ $$, then protect escaped \$
    text = text
      .replace(/\\\[/g, () => '$$')
      .replace(/\\\]/g, () => '$$')
      .replace(/\\\(/g, () => '$')
      .replace(/\\\)/g, () => '$')
      .replace(/\\\$/g, ESC_DOLLAR)

    const re = /\$\$([\s\S]*?)\$\$|\$([^$]*)\$/g
    let out = ''
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      if (m.index > last)
        out += renderText(text.slice(last, m.index).split(ESC_DOLLAR).join('$'))
      const body = (m[1] ?? m[2] ?? '').split(ESC_DOLLAR).join('\\$')
      out += katexHtml(body, m[1] !== undefined)
      last = re.lastIndex
    }
    if (last < text.length)
      out += renderText(text.slice(last).split(ESC_DOLLAR).join('$'))
    return out
  }

  const html = src
    .split(/\n[ \t]*\n/)
    .map((p) => `<p class="doc__p">${renderParagraph(p)}</p>`)
    .join('')
  return { html, error: hadError }
}

const STORE_KEY = 'lateximager.v1'

interface Persisted {
  mode: Mode
  latex: string
  fontSize: number
  color: ColorKey
  bg: BgKey
  docWidth: number
  docUnlimited: boolean
}

const DEFAULTS: Persisted = {
  mode: 'math',
  latex: SAMPLE,
  fontSize: 64,
  color: 'ink',
  bg: 'transparent',
  docWidth: 560,
  docUnlimited: false,
}

/* ---------- app ---------- */

export default function LatexImagerTool() {
  const initial = useStored(STORE_KEY, DEFAULTS)
  const [mode, setMode] = useState<Mode>(initial.mode)
  const [latex, setLatex] = useState(initial.latex)
  const [fontSize, setFontSize] = useState(initial.fontSize)
  const [color, setColor] = useState<ColorKey>(initial.color)
  const [bg, setBg] = useState<BgKey>(initial.bg)
  const [docWidth, setDocWidth] = useState(initial.docWidth)
  const [docUnlimited, setDocUnlimited] = useState(initial.docUnlimited)
  // raw text of the width field — decoupled from docWidth so typing is free
  const [widthText, setWidthText] = useState(String(initial.docWidth))

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // cached @font-face CSS with only the KaTeX fonts inlined (built once).
  // avoids re-embedding the huge Pretendard subset set on every export.
  const fontCssRef = useRef<string | null>(null)

  usePersist(STORE_KEY, {
    mode,
    latex,
    fontSize,
    color,
    bg,
    docWidth,
    docUnlimited,
  })

  /* render each line as its own KaTeX display equation, stacked vertically.
     Enter in the editor → a new line → a new equation block. */
  type Line =
    | { kind: 'html'; html: string }
    | { kind: 'error'; msg: string }
    | { kind: 'blank' }
  const lines = useMemo<Line[]>(() => {
    if (mode !== 'math') return []
    const raw = latex.length ? latex.split('\n') : ['']
    return raw.map((line) => {
      const src = line.trim()
      if (!src) return { kind: 'blank' }
      try {
        return {
          kind: 'html',
          html: katex.renderToString(src, {
            displayMode: true,
            throwOnError: false,
            output: 'html',
          }),
        }
      } catch (e) {
        return { kind: 'error', msg: e instanceof Error ? e.message : '수식 오류' }
      }
    })
  }, [mode, latex])

  const doc = useMemo(
    () => (mode === 'document' ? renderDocument(latex) : null),
    [mode, latex],
  )

  const hasContent = latex.trim().length > 0
  const hasError =
    mode === 'math'
      ? lines.some((l) => l.kind === 'error')
      : doc?.error ?? false

  const bgHex = BGS.find((b) => b.key === bg)?.hex ?? null

  /* ---- editor auto-grow ---- */
  useLayoutEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(180, ta.scrollHeight)}px`
  }, [latex])

  /* ---- font size ---- */
  const bumpFont = (delta: number) =>
    setFontSize((s) => Math.min(FONT_MAX, Math.max(FONT_MIN, s + delta)))

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    signature: `${mode}|${fontSize}|${docWidth}|${docUnlimited}`,
  })

  /* build @font-face CSS containing only the KaTeX fonts, inlined as data URIs.
     html-to-image's default embedding would also inline funky-ui's Pretendard
     (hundreds of Korean subset files ≈ 68 MB) which the equation never uses —
     filtering to KaTeX (~340 KB) and caching it makes every export fast. */
  const buildKatexFontCss = useCallback(async (): Promise<string> => {
    if (fontCssRef.current != null) return fontCssRef.current
    const urlRe = /url\(["']?([^"')]+\.woff2)["']?\)/i
    let css = ''
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue // cross-origin sheet — skip
      }
      for (const rule of Array.from(rules)) {
        if (
          !(rule instanceof CSSFontFaceRule) ||
          !/KaTeX/i.test(rule.style.getPropertyValue('font-family'))
        )
          continue
        const m = urlRe.exec(rule.style.getPropertyValue('src'))
        if (!m) continue
        try {
          const abs = new URL(m[1], location.href).href
          const blob = await (await fetch(abs)).blob()
          const data = await new Promise<string>((res, rej) => {
            const fr = new FileReader()
            fr.onload = () => res(fr.result as string)
            fr.onerror = rej
            fr.readAsDataURL(blob)
          })
          const s = rule.style
          css +=
            `@font-face{font-family:${s.getPropertyValue('font-family')};` +
            `font-style:${s.getPropertyValue('font-style') || 'normal'};` +
            `font-weight:${s.getPropertyValue('font-weight') || 'normal'};` +
            `src:url(${data}) format('woff2');}\n`
        } catch {
          /* skip a font that fails to load */
        }
      }
    }
    fontCssRef.current = css
    return css
  }, [])

  const { savePng, copyPng, busy, toast, flash } = usePngExport({
    shotRef,
    filename: 'equation',
    // the KaTeX faces are embedded explicitly below, so skip the default sweep
    skipFonts: false,
    options: async () => {
      const fontEmbedCSS = await buildKatexFontCss()
      // fall back to default embedding if no KaTeX faces were found, so the
      // export stays correct even when the filter comes up empty
      return fontEmbedCSS ? { fontEmbedCSS } : {}
    },
    guard: () =>
      !hasContent
        ? '먼저 수식을 입력하세요'
        : hasError
          ? '수식 오류를 먼저 고쳐주세요'
          : null,
  })

  return (
    <div className="app">
      {/* toolbar */}
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          LaTeX Imager
        </Text>

        <div className="toolbar__group" role="group" aria-label="모드">
          <Button
            variant={mode === 'math' ? 'primary' : 'neutral'}
            size="sm"
            onClick={() => setMode('math')}
          >
            수식
          </Button>
          <Button
            variant={mode === 'document' ? 'primary' : 'neutral'}
            size="sm"
            onClick={() => setMode('document')}
          >
            문서
          </Button>
        </div>

        <div className="toolbar__group" role="group" aria-label="폰트 크기">
          <Button
            variant="neutral"
            size="sm"
            onClick={() => bumpFont(-FONT_STEP)}
            disabled={fontSize <= FONT_MIN}
          >
            A−
          </Button>
          <span className="toolbar__font">{fontSize}px</span>
          <Button
            variant="neutral"
            size="sm"
            onClick={() => bumpFont(FONT_STEP)}
            disabled={fontSize >= FONT_MAX}
          >
            A+
          </Button>
        </div>

        <div className="toolbar__group" role="group" aria-label="수식 색">
          <span className="toolbar__label">색</span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                className={`swatch${color === c ? ' swatch--active' : ''}`}
                style={{ background: COLOR_HEX[c] }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="toolbar__group" role="group" aria-label="배경">
          <span className="toolbar__label">배경</span>
          {BGS.map((b) => (
            <Button
              key={b.key}
              variant={bg === b.key ? 'secondary' : 'neutral'}
              size="sm"
              onClick={() => setBg(b.key)}
            >
              {b.label}
            </Button>
          ))}
        </div>

        {mode === 'document' && (
          <div className="toolbar__group" role="group" aria-label="폭">
            <span className="toolbar__label">폭</span>
            <Button
              variant={docUnlimited ? 'secondary' : 'neutral'}
              size="sm"
              onClick={() => setDocUnlimited((v) => !v)}
            >
              {docUnlimited ? '무제한' : '고정'}
            </Button>
            {!docUnlimited && (
              <span className="field__px">
                <input
                  className="num"
                  type="text"
                  inputMode="numeric"
                  value={widthText}
                  onChange={(e) => {
                    const t = e.target.value
                    if (!/^\d*$/.test(t)) return // digits only, empty allowed
                    setWidthText(t)
                    const n = parseInt(t, 10)
                    // apply live only when it's already a valid width
                    if (!Number.isNaN(n) && n >= DOC_WIDTH_MIN) setDocWidth(n)
                  }}
                  onBlur={() => {
                    const n = parseInt(widthText, 10)
                    if (Number.isNaN(n) || n < DOC_WIDTH_MIN) {
                      flash(`최소 너비는 ${DOC_WIDTH_MIN}px입니다 — ${DOC_WIDTH_MIN}으로 적용`)
                      setDocWidth(DOC_WIDTH_MIN)
                      setWidthText(String(DOC_WIDTH_MIN))
                    } else {
                      setDocWidth(n)
                      setWidthText(String(n))
                    }
                  }}
                />
                px
              </span>
            )}
          </div>
        )}

        <div className="toolbar__spacer" />

        <Button variant="success" size="sm" onClick={savePng} disabled={busy}>
          PNG 저장
        </Button>
        <Button variant="info" size="sm" onClick={copyPng} disabled={busy}>
          복사
        </Button>
      </div>

      {/* stage — checkerboard shows transparency; holds the export target */}
      <div className="stage" ref={stageRef}>
        <div
          className="fitbox"
          style={nat.w ? { width: nat.w * scale, height: nat.h * scale } : undefined}
        >
          <div
            className={`shot${bg === 'transparent' ? ' shot--transparent' : ''}`}
            ref={shotRef}
            style={{
              transform: `scale(${scale})`,
              padding: `${Math.round(fontSize * 0.35)}px ${Math.round(
                fontSize * 0.5,
              )}px`,
              ...(bgHex ? { background: bgHex } : null),
            }}
          >
            {mode === 'document' ? (
              <div
                className={`doc${docUnlimited ? ' doc--unlimited' : ''}`}
                style={{
                  fontSize,
                  color: COLOR_HEX[color],
                  width: docUnlimited ? 'max-content' : docWidth,
                }}
                dangerouslySetInnerHTML={{ __html: doc?.html ?? '' }}
              />
            ) : (
              <div className="eq" style={{ fontSize, color: COLOR_HEX[color] }}>
                {lines.map((ln, i) =>
                  ln.kind === 'blank' ? (
                    <div key={i} className="eq__line eq__line--blank" />
                  ) : ln.kind === 'error' ? (
                    <div key={i} className="eq__line eq__line--error">
                      {ln.msg}
                    </div>
                  ) : (
                    <div
                      key={i}
                      className="eq__line"
                      dangerouslySetInnerHTML={{ __html: ln.html }}
                    />
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* editor */}
      <div className="editor">
        <span className="editor__prompt">{mode === 'document' ? '¶' : 'f(x)'}</span>
        <textarea
          ref={inputRef}
          className="editor__input"
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          placeholder={
            mode === 'document'
              ? '텍스트 + $수식$ 을 입력하세요 — \\textbf{...}, 따옴표, 빈 줄로 단락 구분'
              : 'LaTeX 수식을 입력하세요 — Enter로 줄바꿈 (예: e^{i\\pi} + 1 = 0)'
          }
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={1}
          aria-label="LaTeX 입력"
        />
      </div>

      <Text variant="chrome" muted className="hint">
        {mode === 'document'
          ? '문서 모드 — 본문 텍스트 + $...$ 인라인 수식, \\textbf · 따옴표 · 빈 줄 단락 지원'
          : '수식 모드 — Enter로 여러 줄 수식 · 색 / 배경 / 크기 조절 후 투명 PNG로 저장'}
      </Text>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
