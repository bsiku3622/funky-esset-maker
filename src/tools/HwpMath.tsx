import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import katex from 'katex'
import { useHistory, usePersist, useStored } from './hooks'
import UndoRedo from './UndoRedo'
import { hwpToLatex, latexToHwp } from './hwp'
import 'katex/dist/katex.min.css'
import './HwpMath.css'

/* LaTeX와 한글(HWP) 수식 편집기 문법 사이를 옮기는 도구.
 *
 * 다른 도구들과 달리 결과물이 그림이 아니라 글자다. 그래서 체스판 배경도,
 * PNG 버튼도, 배율 맞추기도 없다. 대신 화면이 두 칸으로 나뉜다 — 왼쪽이 원본,
 * 오른쪽이 결과. 변환은 실패하지 않으므로(모르는 것도 최선을 내고 지나간다)
 * 오른쪽 칸은 늘 채워져 있고, 미심쩍은 곳만 경고로 따로 모인다.
 *
 * 두 칸 모두 자기 내용을 그려서 보여 준다. 브라우저는 한글 스크립트를 그릴 줄
 * 모르지만, 이 도구에는 그것을 LaTeX로 읽는 파서가 이미 있다 — 한글 쪽 미리보기는
 * `hwpToLatex`로 한 번 되읽은 뒤 KaTeX에 넘긴 것이다. 그래서 LaTeX → 한글 방향
 * 에서는 두 미리보기가 나란히 서고, 둘이 다르면 옮기는 중에 무언가 샜다는 뜻이다.
 *
 * ⚠️ 다만 그것은 **이 도구가 읽은** 스크립트지 한글이 읽은 스크립트가 아니다.
 * 두 방향이 같은 맹점을 공유하면 미리보기끼리는 맞아떨어지면서 정작 한글에서만
 * 다르게 보일 수 있다. 미리보기는 확인이지 보증이 아니다. */

const STORE_KEY = 'fem.hwpmath.v1'

type Dir = 'toHwp' | 'toTex'

const SAMPLE_TEX = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'
const SAMPLE_HWP = 'x = {-b PLUSMINUS sqrt {b ^2 - 4ac}} over {2a}'

interface Example {
  label: string
  tex: string
  hwp: string
}

const EXAMPLES: Example[] = [
  { label: '근의 공식', tex: SAMPLE_TEX, hwp: SAMPLE_HWP },
  {
    label: '적분',
    tex: '\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
    hwp: 'int _{0} ^{inf} e ^{-x ^2} ` dx = {sqrt {pi}} over {2}',
  },
  {
    label: '행렬',
    tex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\\begin{pmatrix} x \\\\ y \\end{pmatrix}',
    hwp: 'pmatrix{a & b # c & d} pmatrix{x # y}',
  },
  {
    label: '경우 나눔',
    tex: 'f(x) = \\begin{cases} x^2 & x \\ge 0 \\\\ -x^2 & x < 0 \\end{cases}',
    hwp: 'f(x) = cases{x ^2 & x geq 0 # -x ^2 & x < 0}',
  },
  {
    label: '기울기',
    tex: '\\nabla_{\\theta}\\mathcal{L} = 2\\left\\{G(X)\\right\\}^{2}\\frac{\\partial M_0(X)}{\\partial \\theta}',
    hwp: 'NABLA _{theta} LAPLACE = 2 LEFT { G(X) RIGHT } ^{2} {Partial M _0 (X)} over {Partial theta}',
  },
]

interface Persisted {
  dir: Dir
  latex: string
  hwp: string
}

const DEFAULTS: Persisted = { dir: 'toHwp', latex: SAMPLE_TEX, hwp: SAMPLE_HWP }

const TOAST_MS = 1800

type Line = { kind: 'html'; html: string } | { kind: 'blank' }

/** LaTeX 한 덩어리를 줄마다 그린다. 줄이 곧 수식 하나다. */
function useLines(tex: string): Line[] {
  return useMemo(() => {
    const raw = tex.length ? tex.split('\n') : ['']
    return raw.map((line): Line => {
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
  }, [tex])
}

export default function HwpMathTool() {
  const initial = useStored(STORE_KEY, DEFAULTS)
  const [dir, setDir] = useState<Dir>(initial.dir)
  const [latex, setLatex] = useState(initial.latex)
  const [script, setScript] = useState(initial.hwp)
  const [toast, setToast] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const persisted = { dir, latex, hwp: script }
  usePersist(STORE_KEY, persisted)
  const history = useHistory(persisted, (s) => {
    setDir(s.dir)
    setLatex(s.latex)
    setScript(s.hwp)
  })

  const toHwp = dir === 'toHwp'
  /* 방향마다 원본을 따로 기억한다. 토글이 상대편 칸을 덮어써 버리면, 한글
     문서에서 붙여 넣어 둔 것이 LaTeX를 한 번 옮겼다고 사라진다. */
  const source = toHwp ? latex : script
  const setSource = toHwp ? setLatex : setScript

  const result = useMemo(
    () => (toHwp ? latexToHwp(source) : hwpToLatex(source)),
    [toHwp, source],
  )

  /* 두 칸의 내용. 방향에 따라 어느 쪽이 원본이고 어느 쪽이 결과인지만 바뀐다. */
  const tex = toHwp ? source : result.out

  /* 한글 스크립트를 그리려면 LaTeX로 한 번 되읽어야 한다. 되돌리기 파서가
     이미 있으니 미리보기는 그것을 다시 쓰는 것으로 충분하다. 한글 → LaTeX
     방향에서는 그 결과가 곧 오른쪽 칸이므로 다시 계산하지 않는다. */
  const scriptAsTex = useMemo(
    () => (toHwp ? hwpToLatex(result.out).out : result.out),
    [toHwp, result.out],
  )

  const texLines = useLines(tex)
  const scriptLines = useLines(scriptAsTex)

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
      () => flash(toHwp ? '한글 수식을 복사했습니다' : 'LaTeX를 복사했습니다'),
      () => flash('복사 실패 — 결과를 직접 선택해 주세요'),
    )
  }, [result.out, toHwp, flash])

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

  const preview = (lines: Line[], label: string) => (
    <div className="hwp-preview" aria-label={label}>
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
  )

  return (
    <div className="app">
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          HWP Math
        </Text>

        <UndoRedo history={history} />

        <div className="toolbar__group" role="group" aria-label="변환 방향">
          <Button
            variant={toHwp ? 'primary' : 'neutral'}
            size="sm"
            onClick={() => setDir('toHwp')}
            aria-pressed={toHwp}
          >
            LaTeX → 한글
          </Button>
          <Button
            variant={toHwp ? 'neutral' : 'primary'}
            size="sm"
            onClick={() => setDir('toTex')}
            aria-pressed={!toHwp}
          >
            한글 → LaTeX
          </Button>
        </div>

        <div className="toolbar__group" role="group" aria-label="예시">
          <span className="toolbar__label">예시</span>
          {EXAMPLES.map((ex) => (
            <Button
              key={ex.label}
              variant="neutral"
              size="sm"
              onClick={() => {
                setSource(toHwp ? ex.tex : ex.hwp)
                inputRef.current?.focus()
              }}
            >
              {ex.label}
            </Button>
          ))}
        </div>

        <div className="toolbar__spacer" />

        <Button
          variant="success"
          size="sm"
          title={`${toHwp ? '한글 수식' : 'LaTeX'} 복사 (⌘⇧C)`}
          onClick={copy}
        >
          {toHwp ? '한글 수식 복사' : 'LaTeX 복사'}
        </Button>
      </div>

      <div className="hwp-body">
        <section className="hwp-pane">
          <header className={`hwp-pane__bar hwp-pane__bar--${toHwp ? 'tex' : 'hwp'}`}>
            <span className="hwp-pane__name">{toHwp ? 'LaTeX' : '한글 수식'}</span>
            <span className="hwp-pane__note">
              {toHwp ? '$…$ 는 알아서 벗깁니다' : '한글에서 복사한 스크립트를 붙여넣기'}
            </span>
          </header>
          <textarea
            ref={inputRef}
            className="hwp-src"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={
              toHwp
                ? 'LaTeX 수식을 붙여넣으세요 — 예: \\frac{a}{b}, \\sum_{i=1}^{n}, \\begin{pmatrix}…'
                : '한글 수식 스크립트를 붙여넣으세요 — 예: {a} over {b}, sum _{i=1} ^{n}, pmatrix{a & b # c & d}'
            }
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={toHwp ? 'LaTeX 입력' : '한글 수식 입력'}
          />
          {toHwp
            ? preview(texLines, 'LaTeX 미리보기')
            : preview(scriptLines, '한글 수식 미리보기')}
        </section>

        <section className="hwp-pane">
          <header className={`hwp-pane__bar hwp-pane__bar--${toHwp ? 'hwp' : 'tex'}`}>
            <span className="hwp-pane__name">{toHwp ? '한글 수식' : 'LaTeX'}</span>
            <span className="hwp-pane__note">
              {toHwp ? 'Ctrl+N, M → 스크립트 입력 창에 붙여넣기' : '$…$ 안에 넣어 쓰세요'}
            </span>
          </header>
          <pre className="hwp-out" aria-label="변환 결과">
            {result.out || ' '}
          </pre>
          {/* 결과 쪽 미리보기. LaTeX → 한글 방향에서는 이것이 옮긴 스크립트를
              되읽어 그린 것이라, 왼쪽 미리보기와 나란히 놓고 비교하면 무엇이
              샜는지 눈으로 보인다. */}
          {toHwp
            ? preview(scriptLines, '한글 수식 미리보기')
            : preview(texLines, 'LaTeX 미리보기')}
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
        {toHwp
          ? '한글 수식은 명령어에 백슬래시를 붙이지 않고, 빈칸으로 항을 나눕니다 — 결과의 빈칸을 지우면 수식이 깨집니다. 줄바꿈은 \\\\ 가 아니라 #입니다.'
          : '한글의 over는 앞뒤에서 한 항씩만 가져갑니다 — 여러 항을 묶으려면 원본에 { }가 있어야 제대로 읽힙니다. 모르는 낱말은 명령어가 아니라 변수 이름으로 봅니다.'}
      </Text>
    </div>
  )
}
