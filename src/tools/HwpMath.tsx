import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import katex from 'katex'
import { useHistory, usePersist, useStored } from './hooks'
import UndoRedo from './UndoRedo'
import { latexToHwp } from './hwp'
import './HwpMath.css'

/* LaTeX를 한글(HWP) 수식 편집기의 스크립트로 옮기는 도구.
 *
 * 다른 도구들과 달리 결과물이 그림이 아니라 글자다. 그래서 체스판 배경도,
 * PNG 버튼도, 배율 맞추기도 없다. 대신 화면이 두 칸으로 나뉜다 — 왼쪽에 원본과
 * 그 미리보기, 오른쪽에 옮긴 결과와 사람이 손봐야 할 것들. 변환은 실패하지
 * 않으므로(모르는 명령어도 이름만 남기고 지나간다) 오른쪽 칸은 늘 채워져
 * 있고, 미심쩍은 곳만 경고로 따로 모인다. */

const STORE_KEY = 'fem.hwpmath.v1'

const SAMPLE = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'

const EXAMPLES: { label: string; tex: string }[] = [
  { label: '근의 공식', tex: SAMPLE },
  {
    label: '적분',
    tex: '\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
  },
  {
    label: '행렬',
    tex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\\begin{pmatrix} x \\\\ y \\end{pmatrix}',
  },
  {
    label: '경우 나눔',
    tex: 'f(x) = \\begin{cases} x^2 & x \\ge 0 \\\\ -x^2 & x < 0 \\end{cases}',
  },
  {
    label: '기울기',
    tex: '\\nabla_{\\theta}\\mathcal{L} = 2\\left\\{G(X)\\right\\}^{2}\\frac{\\partial M_0(X)}{\\partial \\theta}',
  },
]

interface Persisted {
  latex: string
}

const DEFAULTS: Persisted = { latex: SAMPLE }

const TOAST_MS = 1800

type Line = { kind: 'html'; html: string } | { kind: 'blank' }

export default function HwpMathTool() {
  const initial = useStored(STORE_KEY, DEFAULTS)
  const [latex, setLatex] = useState(initial.latex)
  const [toast, setToast] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const persisted = { latex }
  usePersist(STORE_KEY, persisted)
  const history = useHistory(persisted, (s) => setLatex(s.latex))

  const result = useMemo(() => latexToHwp(latex), [latex])

  /* 미리보기는 원본을 확인하는 용도다 — 한글이 무엇을 그릴지가 아니라 내가
     무엇을 넣었는지를 보여준다. 그래서 KaTeX로 LaTeX 쪽을 그린다. */
  const lines = useMemo<Line[]>(() => {
    const raw = latex.length ? latex.split('\n') : ['']
    return raw.map((line) => {
      const src = line.trim()
      if (!src) return { kind: 'blank' }
      return {
        kind: 'html',
        html: katex.renderToString(src, {
          displayMode: true,
          throwOnError: false,
          output: 'html',
        }),
      }
    })
  }, [latex])

  const flash = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), TOAST_MS)
  }, [])

  const copy = useCallback(() => {
    if (!result.out) {
      flash('먼저 수식을 입력하세요')
      return
    }
    navigator.clipboard.writeText(result.out).then(
      () => flash('한글 수식을 복사했습니다'),
      () => flash('복사 실패 — 결과를 직접 선택해 주세요'),
    )
  }, [result.out, flash])

  /* ⌘⇧C — 다른 도구에서 그림을 복사하는 자리다. 여기서 복사할 것은 글자뿐이라
     같은 손가락에 같은 뜻을 준다. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() === 'c' && e.shiftKey) {
        e.preventDefault()
        copy()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [copy])

  return (
    <div className="app">
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          HWP Math
        </Text>

        <UndoRedo history={history} />

        <div className="toolbar__group" role="group" aria-label="예시">
          <span className="toolbar__label">예시</span>
          {EXAMPLES.map((ex) => (
            <Button
              key={ex.label}
              variant="neutral"
              size="sm"
              onClick={() => {
                setLatex(ex.tex)
                inputRef.current?.focus()
              }}
            >
              {ex.label}
            </Button>
          ))}
        </div>

        <div className="toolbar__spacer" />

        <Button variant="success" size="sm" title="한글 수식 복사 (⌘⇧C)" onClick={copy}>
          한글 수식 복사
        </Button>
      </div>

      <div className="hwp-body">
        <section className="hwp-pane">
          <header className="hwp-pane__bar hwp-pane__bar--src">
            <span className="hwp-pane__name">LaTeX</span>
            <span className="hwp-pane__note">붙여넣기 · $…$ 는 알아서 벗깁니다</span>
          </header>
          <textarea
            ref={inputRef}
            className="hwp-src"
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            placeholder="LaTeX 수식을 붙여넣으세요 — 예: \frac{a}{b}, \sum_{i=1}^{n}, \begin{pmatrix}…"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="LaTeX 입력"
          />
          <div className="hwp-preview" aria-label="원본 미리보기">
            {lines.map((ln, i) =>
              ln.kind === 'blank' ? (
                <div key={i} className="hwp-preview__blank" />
              ) : (
                <div
                  key={i}
                  className="hwp-preview__line"
                  dangerouslySetInnerHTML={{ __html: ln.html }}
                />
              ),
            )}
          </div>
        </section>

        <section className="hwp-pane">
          <header className="hwp-pane__bar hwp-pane__bar--out">
            <span className="hwp-pane__name">한글 수식</span>
            <span className="hwp-pane__note">Ctrl+N, M → 스크립트 입력 창에 붙여넣기</span>
          </header>
          <pre className="hwp-out" aria-label="한글 수식 결과">
            {result.out || ' '}
          </pre>
          {result.warnings.length > 0 && (
            <ul className="hwp-warn">
              {result.warnings.map((w) => (
                <li key={w} className="hwp-warn__item">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </section>

        {toast && <div className="hwp-toast">{toast}</div>}
      </div>

      <Text variant="chrome" muted className="hint">
        한글 수식은 명령어에 백슬래시를 붙이지 않고, 빈칸으로 항을 나눕니다 — 결과의
        빈칸을 지우면 수식이 깨집니다. 줄바꿈은 \\ 가 아니라 #입니다.
      </Text>
    </div>
  )
}
