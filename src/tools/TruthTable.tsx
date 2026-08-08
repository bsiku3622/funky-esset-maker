import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { useFitScale, usePersist, usePngExport, useStored } from './hooks'
import './TruthTable.css'

/* ---------- model ---------- */

type ColorKey = 'cyan' | 'pink' | 'purple' | 'yellow' | 'orange' | 'sky' | 'green'
type BgKey = 'transparent' | 'cream' | 'white' | 'dark'

const COLOR_HEX: Record<ColorKey, string> = {
  cyan: '#3decfd', pink: '#ff4eba', purple: '#7828c8', yellow: '#ffd500',
  orange: '#ff9100', sky: '#00c8ff', green: '#00c22a',
}
const COLORS: ColorKey[] = ['cyan', 'pink', 'purple', 'yellow', 'orange', 'sky', 'green']
const HEADER_TEXT: Record<ColorKey, string> = {
  cyan: '#222', pink: '#222', purple: '#fff', yellow: '#222',
  orange: '#222', sky: '#222', green: '#222',
}

const BGS: { key: BgKey; label: string; hex: string | null }[] = [
  { key: 'transparent', label: '투명', hex: null },
  { key: 'cream', label: '크림', hex: '#fff5d1' },
  { key: 'white', label: '흰색', hex: '#ffffff' },
  { key: 'dark', label: '어두움', hex: '#1e1e22' },
]

const SAMPLE = `p and q
p or not q
p -> q`

const STORE_KEY = 'fem.truth.v1'

interface Persisted {
  input: string
  useTF: boolean
  colorize: boolean
  header: ColorKey
  fontSize: number
  bg: BgKey
}
const DEFAULTS: Persisted = {
  input: SAMPLE,
  useTF: true,
  colorize: true,
  header: 'cyan',
  fontSize: 26,
  bg: 'transparent',
}
/* ---------- boolean expression parser ---------- */

type Env = Record<string, boolean>
type BoolFn = (e: Env) => boolean
type Tok =
  | { t: 'VAR'; name: string }
  | { t: 'CONST'; v: boolean }
  | { t: 'NOT' | 'AND' | 'OR' | 'XOR' | 'IMP' | 'IFF' | 'LP' | 'RP' }

type OpType = 'NOT' | 'AND' | 'OR' | 'XOR' | 'IMP' | 'IFF'
const WORD: Record<string, OpType> = {
  not: 'NOT', and: 'AND', or: 'OR', xor: 'XOR', implies: 'IMP', iff: 'IFF',
}

function lex(s: string): Tok[] {
  const re = /\s+|<->|->|&&|\|\||[()!&|^¬∧∨↔→⊕]|[A-Za-z_]\w*/g
  const toks: Tok[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index !== last) throw new Error(`알 수 없는 문자 '${s.slice(last, m.index)}'`)
    last = re.lastIndex
    const x = m[0]
    if (/^\s+$/.test(x)) continue
    switch (x) {
      case '(': toks.push({ t: 'LP' }); break
      case ')': toks.push({ t: 'RP' }); break
      case '!': case '¬': toks.push({ t: 'NOT' }); break
      case '&&': case '&': case '∧': toks.push({ t: 'AND' }); break
      case '||': case '|': case '∨': toks.push({ t: 'OR' }); break
      case '^': case '⊕': toks.push({ t: 'XOR' }); break
      case '->': case '→': toks.push({ t: 'IMP' }); break
      case '<->': case '↔': toks.push({ t: 'IFF' }); break
      default: {
        const lw = x.toLowerCase()
        if (lw === 'true' || lw === 't') toks.push({ t: 'CONST', v: true })
        else if (lw === 'false' || lw === 'f') toks.push({ t: 'CONST', v: false })
        else if (WORD[lw]) toks.push({ t: WORD[lw] })
        else toks.push({ t: 'VAR', name: x })
      }
    }
  }
  if (last !== s.length) throw new Error('알 수 없는 문자')
  return toks
}

function compileBool(s: string): { fn: BoolFn; vars: string[] } {
  const toks = lex(s)
  const vars = new Set<string>()
  for (const t of toks) if (t.t === 'VAR') vars.add(t.name)
  let i = 0
  const peek = () => toks[i]
  const iff = (): BoolFn => {
    let n = imp()
    while (peek()?.t === 'IFF') {
      i++
      const r = imp()
      const a = n
      n = (e) => a(e) === r(e)
    }
    return n
  }
  const imp = (): BoolFn => {
    let n = orx()
    while (peek()?.t === 'IMP') {
      i++
      const r = orx()
      const a = n
      n = (e) => !a(e) || r(e)
    }
    return n
  }
  const orx = (): BoolFn => {
    let n = and()
    while (peek() && (peek().t === 'OR' || peek().t === 'XOR')) {
      const op = toks[i++].t
      const r = and()
      const a = n
      n = op === 'OR' ? (e) => a(e) || r(e) : (e) => a(e) !== r(e)
    }
    return n
  }
  const and = (): BoolFn => {
    let n = nott()
    while (peek()?.t === 'AND') {
      i++
      const r = nott()
      const a = n
      n = (e) => a(e) && r(e)
    }
    return n
  }
  const nott = (): BoolFn => {
    if (peek()?.t === 'NOT') {
      i++
      const r = nott()
      return (e) => !r(e)
    }
    return atom()
  }
  const atom = (): BoolFn => {
    const t = peek()
    if (!t) throw new Error('식이 비었습니다')
    if (t.t === 'VAR') {
      i++
      return (e) => e[t.name]
    }
    if (t.t === 'CONST') {
      i++
      return () => t.v
    }
    if (t.t === 'LP') {
      i++
      const n = iff()
      if (peek()?.t !== 'RP') throw new Error("')' 누락")
      i++
      return n
    }
    throw new Error('예상치 못한 토큰')
  }
  const fn = iff()
  if (i !== toks.length) throw new Error('남은 토큰')
  return { fn, vars: [...vars] }
}

interface Compiled {
  exprs: { text: string; fn: BoolFn }[]
  vars: string[]
  error: string | null
}
function build(input: string): Compiled {
  const lines = input.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  const exprs: { text: string; fn: BoolFn }[] = []
  const varSet = new Set<string>()
  for (const line of lines) {
    try {
      const { fn, vars } = compileBool(line)
      vars.forEach((v) => varSet.add(v))
      exprs.push({ text: line, fn })
    } catch (e) {
      return { exprs: [], vars: [], error: `"${line}" — ${e instanceof Error ? e.message : '식 오류'}` }
    }
  }
  const vars = [...varSet].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  return { exprs, vars, error: null }
}

/* ---------- app ---------- */

export default function TruthTableTool() {
  const initial = useStored(STORE_KEY, DEFAULTS)
  const [input, setInput] = useState(initial.input)
  const [useTF, setUseTF] = useState(initial.useTF)
  const [colorize, setColorize] = useState(initial.colorize)
  const [header, setHeader] = useState<ColorKey>(initial.header)
  const [fontSize, setFontSize] = useState(initial.fontSize)
  const [bg, setBg] = useState<BgKey>(initial.bg)

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const compiled = useMemo(() => build(input), [input])
  const bgHex = BGS.find((b) => b.key === bg)?.hex ?? null

  const rows = useMemo(() => {
    const { vars, exprs, error } = compiled
    if (error || vars.length === 0 || vars.length > 12) return []
    const n = vars.length
    const out: { vals: boolean[]; res: boolean[] }[] = []
    for (let r = 0; r < 1 << n; r++) {
      const env: Env = {}
      const vals: boolean[] = []
      for (let j = 0; j < n; j++) {
        const v = (r & (1 << (n - 1 - j))) === 0 // first row all true
        env[vars[j]] = v
        vals.push(v)
      }
      out.push({ vals, res: exprs.map((e) => e.fn(env)) })
    }
    return out
  }, [compiled])

  const show = (b: boolean) => (useTF ? (b ? 'T' : 'F') : b ? '1' : '0')

  usePersist(STORE_KEY, { input, useTF, colorize, header, fontSize, bg })

  useLayoutEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(180, ta.scrollHeight)}px`
  }, [input])

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    signature: `${fontSize}|${bg}|${useTF}`,
  })

  const { savePng, copyPng, busy, toast } = usePngExport({
    shotRef,
    filename: 'truthtable',
  })
  const hHex = COLOR_HEX[header]
  const hText = HEADER_TEXT[header]
  const cellT = colorize ? (bg === 'dark' ? 'rgba(0,194,42,0.32)' : 'rgba(0,194,42,0.18)') : 'transparent'
  const cellF = colorize ? (bg === 'dark' ? 'rgba(255,78,186,0.28)' : 'rgba(255,78,186,0.14)') : 'transparent'

  return (
    <div className="app">
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          Truth Table
        </Text>

        <div className="toolbar__group">
          <Button variant={useTF ? 'primary' : 'neutral'} size="sm" onClick={() => setUseTF(true)}>
            T / F
          </Button>
          <Button variant={!useTF ? 'primary' : 'neutral'} size="sm" onClick={() => setUseTF(false)}>
            1 / 0
          </Button>
        </div>

        <Button variant={colorize ? 'secondary' : 'neutral'} size="sm" onClick={() => setColorize((v) => !v)}>
          색칠 {colorize ? '켜짐' : '꺼짐'}
        </Button>

        <div className="toolbar__group">
          <span className="toolbar__label">헤더</span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${header === c ? ' swatch--active' : ''}`}
                style={{ background: COLOR_HEX[c] }}
                onClick={() => setHeader(c)}
              />
            ))}
          </div>
        </div>

        <div className="toolbar__group">
          <Button variant="neutral" size="sm" onClick={() => setFontSize((s) => Math.max(16, s - 2))} disabled={fontSize <= 16}>
            A−
          </Button>
          <span className="tt-font">{fontSize}px</span>
          <Button variant="neutral" size="sm" onClick={() => setFontSize((s) => Math.min(48, s + 2))} disabled={fontSize >= 48}>
            A+
          </Button>
        </div>

        <div className="toolbar__group">
          <span className="toolbar__label">배경</span>
          {BGS.map((b) => (
            <Button key={b.key} variant={bg === b.key ? 'secondary' : 'neutral'} size="sm" onClick={() => setBg(b.key)}>
              {b.label}
            </Button>
          ))}
        </div>

        <div className="toolbar__spacer" />

        <Button variant="success" size="sm" onClick={savePng} disabled={busy}>
          PNG 저장
        </Button>
        <Button variant="info" size="sm" onClick={copyPng} disabled={busy}>
          복사
        </Button>
      </div>

      <div className="stage" ref={stageRef}>
        <div
          className="fitbox"
          style={nat.w ? { width: nat.w * scale, height: nat.h * scale } : undefined}
        >
          <div
            className="shot"
            ref={shotRef}
            style={{
              transform: `scale(${scale})`,
              fontSize,
              ...(bgHex ? { background: bgHex } : null),
            }}
          >
            {compiled.error ? (
              <div className="tt-error">⚠ {compiled.error}</div>
            ) : compiled.vars.length === 0 ? (
              <div className="tt-error">변수가 있는 불리언 식을 입력하세요</div>
            ) : compiled.vars.length > 12 ? (
              <div className="tt-error">변수가 너무 많습니다 (최대 12)</div>
            ) : (
              <table className="tt">
                <thead>
                  <tr>
                    {compiled.vars.map((v) => (
                      <th key={v} className="tt-h tt-var" style={{ background: hHex, color: hText }}>
                        {v}
                      </th>
                    ))}
                    {compiled.exprs.map((e, i) => (
                      <th key={i} className="tt-h tt-expr" style={{ background: hHex, color: hText }}>
                        {e.text}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.vals.map((b, j) => (
                        <td key={j} className="tt-c tt-vc" style={{ background: b ? cellT : cellF }}>
                          {show(b)}
                        </td>
                      ))}
                      {row.res.map((b, j) => (
                        <td key={j} className="tt-c tt-rc" style={{ background: b ? cellT : cellF }}>
                          {show(b)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="editor">
        <span className="editor__prompt">∴</span>
        <textarea
          ref={inputRef}
          className="editor__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'한 줄에 식 하나 — p and q / p or not q / p -> q'}
          spellCheck={false}
          rows={1}
          aria-label="불리언 식 입력"
        />
      </div>

      <Text variant="chrome" muted className="hint">
        연산자: not ¬ ! · and ∧ &amp; · or ∨ | · xor ⊕ ^ · implies → -&gt; · iff ↔
        &lt;-&gt; · 변수는 자동 감지 · 여러 줄이면 열이 늘어남
      </Text>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
