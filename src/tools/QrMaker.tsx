/* QR Maker — the editor around the encoder.
 *
 * The odd tool of the set, because its output has to *work*: every other figure
 * here is finished when it looks right, and this one is finished when a phone
 * can read it. That difference shapes the whole screen. The controls that
 * decorate the code (module shape, colour, a logo in the middle) sit next to
 * the three numbers that decide whether the decoration went too far — contrast
 * against the plate, how much of the symbol the logo hides, and how large a
 * module lands on the printed page — and the warnings are on the same strip as
 * the hint, not behind a tooltip, because all three failure modes look perfect
 * on screen and fail in the room.
 *
 * The background default is white rather than the transparent every other tool
 * starts with. A transparent PNG dropped on a dark slide is a code with no
 * quiet zone and inverted contrast; making the user discover that from a
 * failed scan would be a poor trade for consistency. */

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { useFitScale, useHistory, usePersist, useStored, useSvgExport } from './hooks'
import BgPicker from './BgPicker'
import { BG_HEX, type BgKey } from './bg'
import { figColors, ptOf, printWidthIn as widthInOf } from './paper'
import { useTheme } from '../theme'
import Inspector, { Field, Group, Row, Swatches } from './Inspector'
import PrintBar from './PrintBar'
import UndoRedo from './UndoRedo'
import SharedNumField from './NumField'
import { fileToImage } from './aifig/image'
import {
  ECLS,
  ECL_LABEL,
  MAX_VERSION,
  MODE_LABEL,
  encodeQr,
  type Ecl,
} from './qr/encode'
import {
  EYE_LABEL,
  MIN_CONTRAST,
  MIN_MODULE_MM,
  MODULE_LABEL,
  SPEC_QUIET,
  contrastRatio,
  coverage,
  eyesPath,
  isInverted,
  layout,
  logoFits,
  logoFontSize,
  logoRect,
  moduleMm,
  modulesPath,
  type EyeStyle,
  type ModuleStyle,
} from './qr/paint'
import './QrMaker.css'

const STORE_KEY = 'fem.qr.v1'

/* Dark enough to scan on a light plate — every one of these clears 4.5:1 on
   white. The neon palette is one click away in the hex field, and the contrast
   readout will say what it costs. */
const PALETTE = ['#222222', '#7828c8', '#0a4fa0', '#0d6b3f', '#8c1c3a', '#d6219b']

const LOGO_MAX_EDGE = 512

type LogoKind = 'none' | 'text' | 'image'

interface Persisted {
  text: string
  ecl: Ecl
  /** version floor; 1 means "as small as the content allows" */
  minVersion: number
  style: ModuleStyle
  eyes: EyeStyle
  fg: string
  /** quiet zone in modules */
  quiet: number
  figW: number
  caption: string
  captionSize: number
  logoKind: LogoKind
  logoText: string
  /** data URL, so an exported SVG carries the logo with it */
  logoSrc: string
  /** logo width as a fraction of the code */
  logoPct: number
  /** clear the modules under the logo instead of covering them */
  logoWell: boolean
  bg: BgKey
  widthId: string
  dpi: number
}

const DEFAULTS: Persisted = {
  text: 'https://funky-esset-maker.vercel.app',
  ecl: 'M',
  minVersion: 1,
  style: 'square',
  eyes: 'square',
  fg: '#222222',
  quiet: SPEC_QUIET,
  figW: 420,
  caption: '',
  captionSize: 22,
  logoKind: 'none',
  logoText: '',
  logoSrc: '',
  logoPct: 0.18,
  logoWell: true,
  bg: 'white',
  widthId: 'screen',
  dpi: 600,
}

const MODULE_STYLES: ModuleStyle[] = ['square', 'rounded', 'dot']
const EYE_STYLES: EyeStyle[] = ['square', 'rounded', 'circle']

const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v)

/* ---------- app ---------- */

export default function QrMakerTool() {
  const theme = useTheme()
  const initial = useStored(STORE_KEY, DEFAULTS)

  const [text, setText] = useState(initial.text)
  const [ecl, setEcl] = useState<Ecl>(initial.ecl)
  const [minVersion, setMinVersion] = useState(initial.minVersion)
  const [style, setStyle] = useState<ModuleStyle>(initial.style)
  const [eyes, setEyes] = useState<EyeStyle>(initial.eyes)
  const [fg, setFg] = useState(initial.fg)
  const [quiet, setQuiet] = useState(initial.quiet)
  const [figW, setFigW] = useState(initial.figW)
  const [caption, setCaption] = useState(initial.caption)
  const [captionSize, setCaptionSize] = useState(initial.captionSize)
  const [logoKind, setLogoKind] = useState<LogoKind>(initial.logoKind)
  const [logoText, setLogoText] = useState(initial.logoText)
  const [logoSrc, setLogoSrc] = useState(initial.logoSrc)
  const [logoPct, setLogoPct] = useState(initial.logoPct)
  const [logoWell, setLogoWell] = useState(initial.logoWell)
  const [bg, setBg] = useState<BgKey>(initial.bg)
  const [widthId, setWidthId] = useState(initial.widthId)
  const [dpi, setDpi] = useState(initial.dpi)

  /* The hex field keeps its own text so a half-typed '#7828' is not pushed
     into the figure as a colour. Same shape as NumField: re-sync during render
     when the committed value changes underneath (a swatch, an undo). */
  const [fgText, setFgText] = useState(fg)
  const [lastFg, setLastFg] = useState(fg)
  if (fg !== lastFg) {
    setLastFg(fg)
    setFgText(fg)
  }

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const persisted: Persisted = {
    text, ecl, minVersion, style, eyes, fg, quiet, figW, caption, captionSize,
    logoKind, logoText, logoSrc, logoPct, logoWell, bg, widthId, dpi,
  }
  usePersist(STORE_KEY, persisted)

  const history = useHistory(persisted, (s) => {
    setText(s.text)
    setEcl(s.ecl)
    setMinVersion(s.minVersion)
    setStyle(s.style)
    setEyes(s.eyes)
    setFg(s.fg)
    setQuiet(s.quiet)
    setFigW(s.figW)
    setCaption(s.caption)
    setCaptionSize(s.captionSize)
    setLogoKind(s.logoKind)
    setLogoText(s.logoText)
    setLogoSrc(s.logoSrc)
    setLogoPct(s.logoPct)
    setLogoWell(s.logoWell)
    setBg(s.bg)
    setWidthId(s.widthId)
    setDpi(s.dpi)
  })

  /* ---- the code ---- */

  // masks are trialled on every encode, so this is the one thing worth memoing
  const encoded = useMemo(
    () => encodeQr(text, { ecl, minVersion }),
    [text, ecl, minVersion],
  )
  const qr = encoded.ok ? encoded.qr : null

  const bgHex = BG_HEX[bg]
  const dark = bg === 'dark'
  const c = figColors(theme, dark, PALETTE)
  const paper = theme === 'paper'

  /* Paper mode paints a code the way a journal prints one: square modules,
     square eyes, one ink. The stored choices are untouched, so switching back
     to funky restores the shaped version exactly. */
  const inkUsed = paper ? c.ink : fg
  const styleUsed: ModuleStyle = paper ? 'square' : style
  const eyesUsed: EyeStyle = paper ? 'square' : eyes

  const logoOn = logoKind !== 'none' && (logoKind === 'text' ? !!logoText : !!logoSrc)
  const well = logoOn && logoWell

  const dModules = useMemo(() => {
    if (!qr) return ''
    return modulesPath(qr, {
      style: styleUsed,
      clear: well ? logoRect(qr, logoPct) : null,
    })
  }, [qr, styleUsed, well, logoPct])

  const dEyes = useMemo(() => (qr ? eyesPath(qr, eyesUsed) : ''), [qr, eyesUsed])

  const geo = qr
    ? layout(qr, { figW, quiet, captionSize: caption ? captionSize : 0 })
    : { module: 0, x: 0, y: 0, figW, figH: figW, captionY: 0 }

  /* ---- what the decorations cost ---- */

  const printIn = widthInOf(widthId, figW)
  const plate = bgHex ?? '#ffffff'
  const ratio = contrastRatio(inkUsed, plate)
  const inverted = isInverted(inkUsed, plate)
  const mm = moduleMm(geo.module, printIn, figW)
  const cover = qr && logoOn ? coverage(qr, logoRect(qr, logoPct)) : 0
  const logoTooBig = !!qr && logoOn && !logoFits(qr, logoRect(qr, logoPct))

  const warnings: string[] = []
  if (bg === 'transparent')
    warnings.push('배경이 투명합니다 — 어두운 슬라이드 위에 얹으면 스캔되지 않습니다')
  else if (ratio < MIN_CONTRAST)
    warnings.push(
      `전경과 배경의 대비가 ${ratio.toFixed(1)}:1입니다 — ${MIN_CONTRAST}:1 아래로는 카메라가 읽기 어렵습니다`,
    )
  if (inverted) warnings.push('밝은 코드에 어두운 배경입니다 — 반전 코드를 못 읽는 리더가 있습니다')
  if (quiet < SPEC_QUIET) warnings.push(`여백이 ${quiet}칸입니다 — 규격은 ${SPEC_QUIET}칸입니다`)
  if (logoTooBig && qr)
    warnings.push(
      `로고가 코드의 ${Math.round(cover * 100)}%를 가립니다 — ${ecl} 레벨이 복원하는 ${Math.round(qr.recovery * 100)}%에는 과합니다. 정정 레벨을 올리거나 로고를 줄이세요`,
    )
  if (mm > 0 && mm < MIN_MODULE_MM)
    warnings.push(
      `모듈이 ${mm.toFixed(2)}mm로 인쇄됩니다 — ${MIN_MODULE_MM}mm 아래에서는 인쇄 번짐으로 읽히지 않습니다`,
    )

  /* ---- export ---- */

  useLayoutEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(160, ta.scrollHeight)}px`
  }, [text])

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    signature: `${figW}|${geo.figH}|${bg}|${theme}|${qr?.size ?? 0}`,
  })

  const { saveSvg, savePng, copyPng, pixels, busy, toast, flash } = useSvgExport({
    svgRef,
    filename: 'qrcode',
    printWidthIn: printIn,
    figPxWidth: figW,
    figPxHeight: geo.figH,
    bg: bgHex,
    fontFamily: c.text,
    dpi,
    title: 'Made with Funky Esset Maker — QR Maker',
  })

  /* ---- the logo image ---- */

  const takeImage = useCallback(
    async (file: File) => {
      try {
        const img = await fileToImage(file, LOGO_MAX_EDGE)
        setLogoSrc(img.src)
        setLogoKind('image')
        flash('로고를 넣었습니다')
      } catch {
        flash('이미지를 읽지 못했습니다')
      }
    },
    [flash],
  )

  const pickImage = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) void takeImage(file)
    }
    input.click()
  }, [takeImage])

  /* An image dropped on the stage is a logo. The event is marked handled so
     App's project-file drop zone leaves it alone. */
  const onDrop = (e: DragEvent) => {
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
    if (!file) return
    e.preventDefault()
    void takeImage(file)
  }
  const onDragOver = (e: DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
  }

  /* ---- the figure ---- */

  const logoBox = qr && logoOn ? logoRect(qr, logoPct) : null
  // inset a little so the logo never touches the modules it sits between
  const logoPx = logoBox
    ? {
        x: geo.x + (logoBox.x + 0.5) * geo.module,
        y: geo.y + (logoBox.y + 0.5) * geo.module,
        size: (logoBox.w - 1) * geo.module,
      }
    : null

  return (
    <div className="app">
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          QR Maker
        </Text>

        <UndoRedo history={history} />

        <div className="toolbar__group">
          <span className="toolbar__label">정정</span>
          <select
            className="fx-print__select qr-select"
            value={ecl}
            aria-label="오류 정정 레벨"
            onChange={(e) => setEcl(e.target.value as Ecl)}
          >
            {ECLS.map((e) => (
              <option key={e} value={e}>
                {ECL_LABEL[e]}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar__group">
          <span className="toolbar__label">모양</span>
          <select
            className="fx-print__select qr-select"
            value={style}
            aria-label="모듈 모양"
            title={paper ? '논문 모드는 사각으로 그립니다 — 고른 값은 그대로 저장됩니다' : undefined}
            onChange={(e) => setStyle(e.target.value as ModuleStyle)}
          >
            {MODULE_STYLES.map((s) => (
              <option key={s} value={s}>
                {MODULE_LABEL[s]}
              </option>
            ))}
          </select>
          <select
            className="fx-print__select qr-select"
            value={eyes}
            aria-label="눈 모양"
            title={paper ? '논문 모드는 사각으로 그립니다 — 고른 값은 그대로 저장됩니다' : undefined}
            onChange={(e) => setEyes(e.target.value as EyeStyle)}
          >
            {EYE_STYLES.map((s) => (
              <option key={s} value={s}>
                눈 {EYE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar__group">
          <span className="toolbar__label">색</span>
          <div className="swatches">
            {PALETTE.map((hex) => (
              <button
                key={hex}
                type="button"
                title={hex}
                aria-label={hex}
                aria-pressed={fg.toLowerCase() === hex}
                className={`swatch${fg.toLowerCase() === hex ? ' swatch--active' : ''}`}
                style={{ background: hex }}
                onClick={() => setFg(hex)}
              />
            ))}
          </div>
        </div>

        <div className="toolbar__group">
          <span className="toolbar__label">크기</span>
          <SharedNumField
            className="qr-num"
            integer
            value={figW}
            onCommit={(n) => setFigW(Math.max(120, n))}
          />
        </div>

        <PrintBar
          widthId={widthId}
          onWidth={(id, px) => {
            setWidthId(id)
            if (px) setFigW(px)
          }}
          dpi={dpi}
          onDpi={setDpi}
          labelPt={caption ? ptOf(captionSize, printIn, figW) : 0}
          pixels={pixels}
        />

        {/* The number that actually decides whether a printed code scans. It
            sits beside the pt readout because they answer the same question
            about the same page. */}
        <div className="toolbar__group">
          <span className="toolbar__label">모듈</span>
          <span
            className={`fx-print__readout${mm > 0 && mm < MIN_MODULE_MM ? ' is-warn' : ''}`}
            title={`인쇄했을 때 모듈 한 칸의 크기 · ${MIN_MODULE_MM}mm 미만이면 번집니다`}
          >
            {mm > 0 ? `${mm.toFixed(2)}mm` : '—'}
          </span>
        </div>

        <BgPicker value={bg} onChange={setBg} />

        <div className="toolbar__spacer" />

        <Button
          variant="warning"
          size="sm"
          title="벡터 SVG로 저장 (⌘⇧E)"
          onClick={saveSvg}
          disabled={!qr}
        >
          SVG
        </Button>
        <Button
          variant="success"
          size="sm"
          title="PNG로 저장 (⌘E)"
          onClick={savePng}
          disabled={busy || !qr}
        >
          PNG 저장
        </Button>
        <Button
          variant="info"
          size="sm"
          title="클립보드로 복사 (⌘⇧C)"
          onClick={copyPng}
          disabled={busy || !qr}
        >
          복사
        </Button>
      </div>

      <div
        className="stage fx-insp-host"
        ref={stageRef}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div
          className="fitbox"
          style={nat.w ? { width: nat.w * scale, height: nat.h * scale } : undefined}
        >
          <div
            className="shot"
            ref={shotRef}
            style={{
              transform: `scale(${scale})`,
              ...(bgHex ? { background: bgHex } : null),
            }}
          >
            {qr ? (
              <svg
                ref={svgRef}
                className="qr-svg"
                width={geo.figW}
                height={geo.figH}
                viewBox={`0 0 ${geo.figW} ${geo.figH}`}
              >
                <g
                  transform={`translate(${geo.x} ${geo.y}) scale(${geo.module})`}
                  fill={inkUsed}
                >
                  <path d={dModules} />
                  <path d={dEyes} fillRule="evenodd" />
                </g>

                {logoPx && logoKind === 'image' && (
                  <image
                    href={logoSrc}
                    x={logoPx.x}
                    y={logoPx.y}
                    width={logoPx.size}
                    height={logoPx.size}
                    preserveAspectRatio="xMidYMid meet"
                  />
                )}
                {logoPx && logoKind === 'text' && (
                  <text
                    x={logoPx.x + logoPx.size / 2}
                    y={logoPx.y + logoPx.size / 2}
                    fontSize={logoFontSize(logoText, logoPx.size)}
                    fontFamily={c.text}
                    fontWeight={c.bold}
                    fill={inkUsed}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {logoText}
                  </text>
                )}

                {caption && (
                  <text
                    x={geo.figW / 2}
                    y={geo.captionY}
                    fontSize={captionSize}
                    fontFamily={c.text}
                    fontWeight={c.bold}
                    fill={c.ink}
                    textAnchor="middle"
                  >
                    {caption}
                  </text>
                )}
              </svg>
            ) : (
              <div className="qr-empty">{encoded.ok ? '' : encoded.error}</div>
            )}
          </div>
        </div>

        <Inspector
          title="QR"
          hint={qr ? `${qr.version}버전 · ${qr.size}×${qr.size}` : '내용을 입력하세요'}
        >
          <Group label="코드">
            <Field label="정정 레벨">
              <select value={ecl} onChange={(e) => setEcl(e.target.value as Ecl)}>
                {ECLS.map((e) => (
                  <option key={e} value={e}>
                    {ECL_LABEL[e]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="최소 버전">
              <select
                value={minVersion}
                onChange={(e) => setMinVersion(Number(e.target.value))}
              >
                <option value={1}>자동</option>
                {Array.from({ length: MAX_VERSION - 1 }, (_, i) => i + 2).map((v) => (
                  <option key={v} value={v}>
                    {v}버전 · {v * 4 + 17}칸
                  </option>
                ))}
              </select>
            </Field>
            <Field label="여백">
              <SharedNumField
                integer
                value={quiet}
                onCommit={(n) => setQuiet(Math.max(0, Math.min(12, n)))}
              />
            </Field>
            <Field label="색">
              <input
                type="text"
                value={fgText}
                spellCheck={false}
                aria-label="전경색 (#rrggbb)"
                onChange={(e) => {
                  const v = e.target.value
                  setFgText(v)
                  if (isHex(v)) setFg(v)
                }}
                onBlur={() => setFgText(fg)}
              />
            </Field>
            <Row label="">
              <Swatches colors={PALETTE} value={fg} onChange={setFg} />
            </Row>
            <Row label="대비">
              <span className={`qr-stat${ratio < MIN_CONTRAST ? ' is-warn' : ''}`}>
                {ratio.toFixed(1)}:1
              </span>
            </Row>
          </Group>

          <Group label="캡션">
            <Field label="문구">
              <input
                type="text"
                value={caption}
                placeholder="없음"
                onChange={(e) => setCaption(e.target.value)}
              />
            </Field>
            <Field label="크기">
              <SharedNumField
                integer
                value={captionSize}
                onCommit={(n) => setCaptionSize(Math.max(8, Math.min(120, n)))}
              />
            </Field>
          </Group>

          <Group label="가운데 로고">
            <Row label="종류">
              {(['none', 'text', 'image'] as LogoKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`fx-insp__btn${logoKind === k ? ' is-on' : ''}`}
                  onClick={() => setLogoKind(k)}
                >
                  {k === 'none' ? '없음' : k === 'text' ? '문자' : '이미지'}
                </button>
              ))}
            </Row>
            {logoKind === 'text' && (
              <Field label="문자">
                <input
                  type="text"
                  value={logoText}
                  placeholder="이모지 또는 한두 글자"
                  onChange={(e) => setLogoText(e.target.value)}
                />
              </Field>
            )}
            {logoKind === 'image' && (
              <Row label="파일">
                <button type="button" className="fx-insp__btn" onClick={pickImage}>
                  {logoSrc ? '바꾸기' : '고르기'}
                </button>
                {logoSrc && (
                  <button
                    type="button"
                    className="fx-insp__btn fx-insp__btn--danger"
                    onClick={() => setLogoSrc('')}
                  >
                    지우기
                  </button>
                )}
              </Row>
            )}
            {logoKind !== 'none' && (
              <>
                <Field label="크기 %">
                  <SharedNumField
                    integer
                    value={Math.round(logoPct * 100)}
                    onCommit={(n) => setLogoPct(Math.max(5, Math.min(40, n)) / 100)}
                  />
                </Field>
                <Row label="자리">
                  <button
                    type="button"
                    className={`fx-insp__btn${logoWell ? ' is-on' : ''}`}
                    onClick={() => setLogoWell((v) => !v)}
                    title="로고 자리의 모듈을 지워 깨끗한 바탕 위에 얹습니다"
                  >
                    {logoWell ? '모듈 비움' : '모듈 위에'}
                  </button>
                </Row>
                <Row label="가림">
                  <span className={`qr-stat${logoTooBig ? ' is-warn' : ''}`}>
                    {Math.round(cover * 100)}% / {qr ? Math.round(qr.recovery * 100) : 0}%
                  </span>
                </Row>
              </>
            )}
          </Group>
        </Inspector>

        {toast && <div className="toast">{toast}</div>}
      </div>

      <div className="editor">
        <span className="editor__prompt">▩</span>
        <textarea
          ref={inputRef}
          className="editor__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="URL이든 문장이든 — 여기 적은 그대로 인코딩됩니다"
          spellCheck={false}
          rows={1}
          aria-label="QR에 담을 내용"
        />
      </div>

      {warnings.length > 0 && (
        <div className="qr-warn" role="status">
          {warnings.map((w) => (
            <span key={w}>⚠ {w}</span>
          ))}
        </div>
      )}

      <Text variant="chrome" muted className="hint">
        {encoded.ok
          ? `${encoded.qr.version}버전 · ${encoded.qr.size}×${encoded.qr.size} · ${MODE_LABEL[encoded.qr.mode]} 모드 · 용량 ${Math.round(encoded.qr.fill * 100)}% · 이미지를 끌어다 놓으면 가운데 로고가 됩니다`
          : encoded.error}
      </Text>
    </div>
  )
}
