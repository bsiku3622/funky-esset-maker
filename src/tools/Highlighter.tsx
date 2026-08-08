import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { highlightCode } from '../cores/highlight'
import { useFitScale, usePersist, usePngExport, useStored } from './hooks'
import './Highlighter.css'

/* ---------- model ---------- */

type Lang = 'python' | 'markdown' | 'plain'
type Theme = 'light' | 'dark'

const LANGS: { key: Lang; label: string }[] = [
  { key: 'python', label: 'Python' },
  { key: 'markdown', label: 'Markdown' },
  { key: 'plain', label: 'Plain Text' },
]

// default file label shown in the window title bar (per language, editable)
const FILE_NAME: Record<Lang, string> = {
  python: 'snippet.py',
  markdown: 'snippet.md',
  plain: 'snippet.txt',
}

const SAMPLE: Record<Lang, string> = {
  python: `from dataclasses import dataclass


@dataclass
class Point:
    x: float
    y: float

    def norm(self) -> float:
        # Euclidean distance from origin
        return (self.x ** 2 + self.y ** 2) ** 0.5


points = [Point(3, 4), Point(1, 2)]
for p in points:
    print(f"|{p}| = {p.norm():.2f}")
`,
  markdown: `# Highlighter

코드를 붙여넣으면 **자동으로** 하이라이트됩니다.

- 폰트 크기 조절
- 언어 선택 (Python, Markdown)
- PNG로 저장 / 복사

\`\`\`python
print("hello, slides!")
\`\`\`

> PPT에 바로 붙여 쓰세요.
`,
  plain: `Plain Text — 하이라이트 없이 그대로 보여줍니다.

들여쓰기, 줄바꿈, 기호( <>&"' )까지 입력한 그대로 렌더됩니다.
폰트 크기 · 테마 · 줄바꿈 · 크롭은 동일하게 동작합니다.
`,
}

const FONT_MIN = 12
const FONT_MAX = 40
const FONT_STEP = 2
const CROP_HEIGHT_MIN = 160 // render floor — values below this are forced to 160

// frame sizing defaults (user-editable)
const DEFAULTS = {
  width: 1280, // fixed window width
  wrap: true, // soft-wrap long lines to the fixed width
  ratioW: 16, // aspect ratio → min-height (un-cropped) & crop height default
  ratioH: 9,
  crop: false, // crop the height (scroll to choose the visible region)
  cropHeight: 720, // 1280 * 9 / 16
}

const STORE_KEY = 'highlighter.v1'
// bump to re-pull sizing defaults (width / ratio / crop) on existing sessions
// while keeping the user's code and file names
const SIZING_VERSION = 2

interface Persisted {
  version: number
  lang: Lang
  theme: Theme
  fontSize: number
  codes: Record<Lang, string>
  names: Record<Lang, string>
  width: number
  wrap: boolean
  ratioW: number
  ratioH: number
  crop: boolean
  cropHeight: number
}

const FALLBACK: Persisted = {
  version: SIZING_VERSION,
  lang: 'python',
  theme: 'dark',
  fontSize: 18,
  codes: { ...SAMPLE },
  names: { ...FILE_NAME },
  ...DEFAULTS,
}

/* ---------- app ---------- */

export default function HighlighterTool() {
  const initial = useStored(STORE_KEY, FALLBACK, (saved, fallback) => {
    // older sizing schema → keep the code buffers, reset sizing to defaults
    const freshSizing = saved.version !== SIZING_VERSION
    return {
      ...fallback,
      ...saved,
      version: SIZING_VERSION,
      codes: { ...fallback.codes, ...saved.codes },
      names: { ...fallback.names, ...saved.names },
      ...(freshSizing ? DEFAULTS : null),
    }
  })
  const [lang, setLang] = useState<Lang>(initial.lang)
  const [theme, setTheme] = useState<Theme>(initial.theme)
  const [fontSize, setFontSize] = useState(initial.fontSize)
  const [codes, setCodes] = useState<Record<Lang, string>>(initial.codes)
  const [names, setNames] = useState<Record<Lang, string>>(initial.names)

  // frame sizing
  const [width, setWidth] = useState(initial.width)
  const [wrap, setWrap] = useState(initial.wrap)
  const [ratioW, setRatioW] = useState(initial.ratioW)
  const [ratioH, setRatioH] = useState(initial.ratioH)
  const [crop, setCrop] = useState(initial.crop)
  const [cropHeight, setCropHeight] = useState(initial.cropHeight)
  // raw text of the height field — decoupled from cropHeight so typing is free
  const [cropHeightText, setCropHeightText] = useState(String(initial.cropHeight))
  const [sizeOpen, setSizeOpen] = useState(false)

  // scroll offset for cropped / non-wrapped content (transform-based so the
  // PNG export captures the exact visible region)
  const [scroll, setScroll] = useState({ x: 0, y: 0 })

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const layersRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const code = codes[lang]
  const setCode = (value: string) =>
    setCodes((prev) => ({ ...prev, [lang]: value }))

  const name = names[lang]
  const setName = (value: string) =>
    setNames((prev) => ({ ...prev, [lang]: value }))

  // min-height enforced when not cropped → keeps small snippets at the ratio
  const minHeight = useMemo(
    () => (ratioW > 0 && ratioH > 0 ? Math.round((width * ratioH) / ratioW) : 0),
    [width, ratioW, ratioH],
  )

  // height used for the actual render — anything under the floor is forced to it,
  // while the input keeps showing whatever was typed
  const effectiveCropHeight = Math.max(CROP_HEIGHT_MIN, cropHeight)

  /* Snap the crop height back to the ratio whenever width / ratio change (and
     when crop is first turned on). Manual edits survive until the next such
     change. Done during render instead of in an effect so the new height is
     part of the same commit — an effect would paint the old height first. */
  const ratioKey = `${crop}|${width}|${ratioW}|${ratioH}`
  const [lastRatioKey, setLastRatioKey] = useState<string | null>(null)
  if (ratioKey !== lastRatioKey) {
    setLastRatioKey(ratioKey)
    if (crop && minHeight > 0) {
      setCropHeight(minHeight)
      setCropHeightText(String(minHeight))
    }
  }

  usePersist(STORE_KEY, {
    version: SIZING_VERSION,
    lang,
    theme,
    fontSize,
    codes,
    names,
    width,
    wrap,
    ratioW,
    ratioH,
    crop,
    cropHeight,
  } satisfies Persisted)

  /* highlighted markup — shared with the CodeBlock core so a snippet looks the
     same here and wherever the core renders it */
  const highlighted = useMemo(() => highlightCode(code, lang), [code, lang])

  /* ---- scroll bounds (vertical when cropped, horizontal when not wrapped) ---- */
  const bounds = useCallback(() => {
    const box = boxRef.current
    const layers = layersRef.current
    if (!box || !layers) return { maxX: 0, maxY: 0 }
    const maxY = crop ? Math.max(0, layers.offsetHeight - box.clientHeight) : 0
    const maxX = !wrap ? Math.max(0, layers.offsetWidth - box.clientWidth) : 0
    return { maxX, maxY }
  }, [crop, wrap])

  /* Re-clamp the pan offset whenever the content or sizing changes. The bound
     comes from measuring the DOM, so it cannot be derived during render — and
     it has to land before paint or a shrunk window shows blank space for a
     frame. The updater returns the same object when nothing moved, so this
     settles immediately instead of cascading. */
  useLayoutEffect(() => {
    const { maxX, maxY } = bounds()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScroll((s) => {
      const x = Math.min(s.x, maxX)
      const y = Math.min(s.y, maxY)
      return x === s.x && y === s.y ? s : { x, y }
    })
  }, [bounds, code, lang, fontSize, width, wrap, crop, effectiveCropHeight, minHeight])

  /* ---- wheel to pan the cropped / overflowing code (non-passive) ---- */
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const onWheel = (e: WheelEvent) => {
      const { maxX, maxY } = bounds()
      if (maxX === 0 && maxY === 0) return
      e.preventDefault()
      setScroll((s) => ({
        x: Math.min(maxX, Math.max(0, s.x + e.deltaX)),
        y: Math.min(maxY, Math.max(0, s.y + e.deltaY)),
      }))
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [bounds])

  /* ---- preview scale: fit the window into the stage ----
     the denominator uses the *cropped* height so the zoom level stays put
     whether crop is on or off; the export is unaffected either way. */
  const targetHeight = useCallback(
    (shot: HTMLElement) => {
      const box = boxRef.current
      if (!box) return shot.offsetHeight
      const chromeV = shot.offsetHeight - box.offsetHeight // bar + borders + padding
      return chromeV + effectiveCropHeight
    },
    [effectiveCropHeight],
  )

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    targetHeight,
    signature: `${fontSize}|${width}|${wrap}|${crop}|${minHeight}|${sizeOpen}`,
  })

  /* ---- font size ---- */
  const bumpFont = (delta: number) =>
    setFontSize((s) => Math.min(FONT_MAX, Math.max(FONT_MIN, s + delta)))

  /* ---- editing: Tab inserts spaces instead of leaving the field ---- */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const ta = e.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const indent = '    '
    const next = code.slice(0, start) + indent + code.slice(end)
    setCode(next)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + indent.length
    })
  }

  const { savePng, copyPng, busy, toast } = usePngExport({
    shotRef,
    // the window's title bar carries the file name — reuse it for the PNG
    filename: () => name.replace(/\.[^.]+$/, '').trim() || 'code',
    pixelRatio: 2, // already crisp: the shot is rendered at full size
    cacheBust: true,
  })

  const resetSize = () => {
    setWidth(DEFAULTS.width)
    setWrap(DEFAULTS.wrap)
    setRatioW(DEFAULTS.ratioW)
    setRatioH(DEFAULTS.ratioH)
    setCrop(DEFAULTS.crop)
    setCropHeight(DEFAULTS.cropHeight)
    setCropHeightText(String(DEFAULTS.cropHeight))
    setScroll({ x: 0, y: 0 })
  }

  // numeric field helper — clamps to a minimum, keeps integers
  const numField = (
    value: number,
    onChange: (n: number) => void,
    min: number,
  ) => (
    <input
      className="num"
      type="number"
      min={min}
      value={value}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10)
        onChange(Number.isNaN(n) ? min : Math.max(min, n))
      }}
    />
  )

  return (
    <div className="app">
      {/* toolbar */}
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          Highlighter
        </Text>

        <div className="toolbar__group" role="group" aria-label="언어">
          {LANGS.map((l) => (
            <Button
              key={l.key}
              variant={lang === l.key ? 'primary' : 'neutral'}
              size="sm"
              onClick={() => setLang(l.key)}
            >
              {l.label}
            </Button>
          ))}
        </div>

        <div className="toolbar__group" role="group" aria-label="테마">
          <Button
            variant={theme === 'light' ? 'warning' : 'neutral'}
            size="sm"
            onClick={() => setTheme('light')}
          >
            Light
          </Button>
          <Button
            variant={theme === 'dark' ? 'ink' : 'neutral'}
            size="sm"
            onClick={() => setTheme('dark')}
          >
            Dark
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

        <Button
          variant={sizeOpen ? 'secondary' : 'neutral'}
          size="sm"
          onClick={() => setSizeOpen((v) => !v)}
        >
          크기
        </Button>

        <div className="toolbar__spacer" />

        <Button variant="success" size="sm" title="PNG로 저장 (⌘E)" onClick={savePng} disabled={busy}>
          PNG 저장
        </Button>
        <Button variant="info" size="sm" title="클립보드로 복사 (⌘⇧C)" onClick={copyPng} disabled={busy}>
          복사
        </Button>
      </div>

      {/* size settings row */}
      {sizeOpen && (
        <div className="settings">
          <label className="field">
            <span>너비 (고정)</span>
            <span className="field__px">
              {numField(width, setWidth, 120)}px
            </span>
          </label>

          <Button
            variant={wrap ? 'secondary' : 'neutral'}
            size="sm"
            onClick={() => setWrap((v) => !v)}
          >
            자동 줄바꿈 {wrap ? '켜짐' : '꺼짐'}
          </Button>

          <label className="field">
            <span>최소 비율 (가로:세로)</span>
            <span className="field__ratio">
              {numField(ratioW, setRatioW, 0)}
              <b>:</b>
              {numField(ratioH, setRatioH, 0)}
            </span>
          </label>

          <Button
            variant={crop ? 'secondary' : 'neutral'}
            size="sm"
            onClick={() => setCrop((v) => !v)}
          >
            크롭 {crop ? '켜짐' : '꺼짐'}
          </Button>

          {crop && (
            <label className="field">
              <span>높이</span>
              <span className="field__px">
                <input
                  className="num"
                  type="text"
                  inputMode="numeric"
                  value={cropHeightText}
                  onChange={(e) => {
                    const t = e.target.value
                    if (!/^\d*$/.test(t)) return // digits only, empty allowed
                    setCropHeightText(t)
                    const n = parseInt(t, 10)
                    // store whatever was typed; the render floor is applied
                    // separately via effectiveCropHeight, so no min clamp here
                    if (!Number.isNaN(n)) setCropHeight(n)
                  }}
                />
                px
              </span>
            </label>
          )}

          <Button variant="neutral" size="sm" onClick={resetSize}>
            기본값
          </Button>

          <Text variant="chrome" muted className="settings__hint">
            너비 고정 · 자동 줄바꿈으로 폭 맞춤 · 크롭 시 휠로 보일 영역 선택
          </Text>
        </div>
      )}

      {/* stage — scrollable canvas holding the export target */}
      <div className="stage" ref={stageRef}>
        <div
          className="fitbox"
          style={
            nat.w
              ? { width: nat.w * scale, height: nat.h * scale }
              : undefined
          }
        >
          <div
            className="shot"
            ref={shotRef}
            style={{ transform: `scale(${scale})` }}
          >
            <div className={`frame frame--${theme}`}>
              <div className="frame__bar">
                <span className="dot dot--pink" />
                <span className="dot dot--yellow" />
                <span className="dot dot--green" />
                <input
                  className="frame__name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  spellCheck={false}
                  aria-label="파일명"
                />
              </div>

              <div
                ref={boxRef}
                className={`code ${wrap ? 'code--wrap' : 'code--nowrap'}`}
                style={{
                  fontSize: `${fontSize}px`,
                  width: `${width}px`,
                  ...(crop
                    ? { height: `${effectiveCropHeight}px` }
                    : { minHeight: `${minHeight}px` }),
                }}
              >
                <div
                  ref={layersRef}
                  className="code__layers"
                  style={{
                    transform: `translate(${-scroll.x}px, ${-scroll.y}px)`,
                    width: wrap ? '100%' : 'max-content',
                  }}
                >
                  <pre className="code__pre" aria-hidden="true">
                    <code
                      className={`language-${lang}`}
                      dangerouslySetInnerHTML={{ __html: highlighted }}
                    />
                  </pre>
                  <textarea
                    ref={taRef}
                    className="code__input"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={onKeyDown}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    wrap={wrap ? 'soft' : 'off'}
                    aria-label="코드 입력"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Text variant="chrome" muted className="hint">
        가운데에 코드를 입력하면 자동으로 하이라이트됩니다 · Tab으로 들여쓰기 ·
        PNG 저장 / 복사로 슬라이드에 붙여넣기
      </Text>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
