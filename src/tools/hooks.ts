/* Shared machinery for the tools.
 *
 * Highlighter … Number Line each began life as a separate project, so every one
 * of them carried its own copy of the same three mechanisms: restore state from
 * localStorage, fit the preview into the stage, and rasterise the preview to a
 * PNG. The copies had drifted only in a pixel ratio and a file name, so they
 * live here once. `useLatest` is used more widely — the two canvas editors
 * (Grapher, AI Figure Maker) lean on it for their event handlers.
 *
 * AI Figure Maker is deliberately not a client of usePngExport — it renders SVG
 * and serialises its own DOM rather than rasterising it (see aifig/export.ts). */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { toBlob } from 'html-to-image'
import type { Options } from 'html-to-image/lib/types'
import { buildSvgDoc, download, pngPixels, svgToPng, textBlob } from './svg'

/* ---------- latest-value ref ---------- */

/** Mirror a value into a ref so long-lived handlers can read the current one
 *  without being torn down and re-bound on every change.
 *
 *  The write happens after commit, never during render: a render that React
 *  throws away (concurrent rendering does this) must not leave the ref holding
 *  a value that was never shown. Handlers run in response to user input, which
 *  is always after a commit, so they see the fresh value either way. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}

/* ---------- localStorage ---------- */

/** Read `key` once, on mount, merged over `defaults`. The result is frozen for
 *  the life of the component: tools spread it into their own `useState`
 *  initialisers, so a later re-read would have nowhere to go. */
export function useStored<T extends object>(
  key: string,
  defaults: T,
  /** fixup for older saved shapes — Highlighter drops stale sizing fields */
  migrate?: (saved: Partial<T>, defaults: T) => T,
): T {
  const [initial] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return defaults
      const saved = JSON.parse(raw) as Partial<T>
      return migrate ? migrate(saved, defaults) : { ...defaults, ...saved }
    } catch {
      return defaults
    }
  })
  return initial
}

/** Mirror `value` into localStorage whenever it actually changes.
 *
 *  The comparison is on the serialised form, so callers can pass a fresh object
 *  literal every render without writing every render. Quota failures are
 *  swallowed — none of these tools hold enough to be worth interrupting over.
 *  (AI Figure Maker embeds bitmaps and reports its own quota failures instead.) */
export function usePersist(key: string, value: unknown) {
  const json = JSON.stringify(value)
  useEffect(() => {
    try {
      localStorage.setItem(key, json)
    } catch {
      /* ignore */
    }
  }, [key, json])
}

/* ---------- undo / redo ---------- */

export interface History {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export interface HistoryOptions {
  /** how many steps to keep — a table of text is small, but AI Figure Maker
   *  embeds bitmaps, so nothing here is unbounded */
  limit?: number
  /** changes closer together than this share one history entry, so a typed
   *  word is one undo rather than five */
  coalesceMs?: number
}

/** Undo/redo over the object a tool already persists.
 *
 *  Tools keep their state in a dozen separate `useState` calls, which is what
 *  makes them readable; asking every one of them to collapse into a reducer
 *  just to get undo would cost more than it buys. So the hook watches the same
 *  object that goes to localStorage and hands a snapshot back through
 *  `restore`, which spreads it across the setters — about six lines per tool.
 *
 *  ⌘Z is *not* intercepted while a text field has focus. Inside a textarea the
 *  browser's own undo is the one the user means, and stealing it would make
 *  typing feel broken. The toolbar buttons stay available either way. */
export function useHistory<T>(
  value: T,
  restore: (v: T) => void,
  { limit = 80, coalesceMs = 450 }: HistoryOptions = {},
): History {
  const json = JSON.stringify(value)
  const latestRestore = useLatest(restore)

  const past = useRef<string[]>([])
  const future = useRef<string[]>([])
  const current = useRef<string | null>(null)
  const lastPush = useRef(0)
  /** the next value change is one we caused — record it, don't push it */
  const replaying = useRef(false)

  /* The stacks have to be refs (they are pushed and popped imperatively) but
     the buttons need their depth at render time, and reading a ref during
     render is exactly the thing that breaks under concurrent rendering. So the
     depth is mirrored into state and the refs stay write-only from render's
     point of view. */
  const [depth, setDepth] = useState({ u: 0, r: 0 })
  const sync = useCallback(() => {
    setDepth((d) => {
      const u = past.current.length
      const r = future.current.length
      return d.u === u && d.r === r ? d : { u, r }
    })
  }, [])

  useEffect(() => {
    if (current.current === json) return
    if (current.current === null) {
      current.current = json // first commit: the baseline, not a change
      return
    }
    if (replaying.current) {
      replaying.current = false
      current.current = json
      return
    }
    const now = Date.now()
    if (!(now - lastPush.current < coalesceMs && past.current.length)) {
      past.current.push(current.current)
      if (past.current.length > limit) past.current.shift()
    }
    lastPush.current = now
    future.current = []
    current.current = json
    sync()
  }, [json, coalesceMs, limit, sync])

  const step = useCallback(
    (from: RefObject<string[]>, to: RefObject<string[]>) => {
      const next = from.current.pop()
      if (next === undefined || current.current === null) return
      to.current.push(current.current)
      replaying.current = true
      // coalescing must not swallow the change that follows an undo
      lastPush.current = 0
      try {
        latestRestore.current(JSON.parse(next) as T)
      } catch {
        replaying.current = false
      }
      sync()
    },
    [latestRestore, sync],
  )

  const undo = useCallback(() => step(past, future), [step])
  const redo = useCallback(() => step(future, past), [step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k !== 'z' && k !== 'y') return
      if (isTextTarget(e.target)) return
      e.preventDefault()
      if (k === 'y' || e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return { undo, redo, canUndo: depth.u > 0, canRedo: depth.r > 0 }
}

/** True for the fields where the browser's own editing shortcuts should win. */
export function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || el.isContentEditable === true
}

/* ---------- preview fit ---------- */

/** Never shrink below this — a preview scaled to nothing looks like a bug. */
const MIN_SCALE = 0.05
/** Ignore scale jitter under this; it only causes re-render churn. */
const SCALE_EPS = 0.001

export interface FitResult {
  /** preview transform, MIN_SCALE…1 — the PNG export neutralises it */
  scale: number
  /** natural (untransformed) size of the shot node */
  nat: { w: number; h: number }
}

export interface FitOptions {
  stageRef: RefObject<HTMLElement | null>
  shotRef: RefObject<HTMLElement | null>
  /** re-fit when this changes — for inputs that alter the fit without changing
   *  the shot's measured size. Size changes are caught by ResizeObserver. */
  signature?: string | number
  /** height to fit against when it differs from the shot's own. Highlighter
   *  fits the *cropped* height so the zoom level stays put as crop toggles.
   *  Must be stable (useCallback) or the fit recomputes every render. */
  targetHeight?: (shot: HTMLElement) => number
}

/** Scale the preview down until it fits inside its stage. */
export function useFitScale({
  stageRef,
  shotRef,
  signature,
  targetHeight,
}: FitOptions): FitResult {
  const [scale, setScale] = useState(1)
  const [nat, setNat] = useState({ w: 0, h: 0 })

  const recompute = useCallback(() => {
    const stage = stageRef.current
    const shot = shotRef.current
    if (!stage || !shot) return
    const cs = getComputedStyle(stage)
    const availW =
      stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const availH =
      stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    // offsetWidth/Height are unaffected by the shot's own transform
    const w = shot.offsetWidth
    const h = shot.offsetHeight
    if (!w || !h) return
    const fitH = targetHeight ? targetHeight(shot) : h
    const s = Math.max(MIN_SCALE, Math.min(1, availW / w, availH / fitH))
    setNat((p) => (p.w !== w || p.h !== h ? { w, h } : p))
    setScale((p) => (Math.abs(p - s) > SCALE_EPS ? s : p))
  }, [stageRef, shotRef, targetHeight])

  /* Measure-then-place: the state written here *is* the layout, so it has to
     land before paint. Both setters no-op when the value is unchanged, so this
     settles in one extra pass instead of looping. */
  useLayoutEffect(() => {
    recompute()
  }, [recompute, signature])

  useEffect(() => {
    const stage = stageRef.current
    const shot = shotRef.current
    if (!stage || !shot) return
    const ro = new ResizeObserver(recompute)
    ro.observe(stage)
    ro.observe(shot)
    return () => ro.disconnect()
  }, [recompute, stageRef, shotRef])

  return { scale, nat }
}

/* ---------- PNG export ---------- */

const TOAST_MS = 1800

export interface PngExport {
  /** rasterise and download */
  savePng: () => void
  /** rasterise and put on the clipboard */
  copyPng: () => void
  /** an export is in flight — bind to the buttons' `disabled` */
  busy: boolean
  /** current toast text, or null */
  toast: string | null
  /** show a toast (tools use it for their own messages too) */
  flash: (message: string) => void
}

export interface PngExportOptions {
  /** the node to rasterise */
  shotRef: RefObject<HTMLElement | null>
  /** download name without extension; a function is read at click time */
  filename: string | (() => string)
  /** 3 unless the shot is large enough that 3× is wasteful */
  pixelRatio?: number
  /** leave true unless the shot needs a web font to survive the raster —
   *  embedding refetches and inlines Pretendard on every export */
  skipFonts?: boolean
  cacheBust?: boolean
  /** extra html-to-image options resolved per export (LaTeX Imager builds a
   *  KaTeX-only font subset) */
  options?: () => Options | Promise<Options>
  /** message to refuse the export with, or null to allow it */
  guard?: () => string | null
}

export function usePngExport({
  shotRef,
  filename,
  pixelRatio = 3,
  skipFonts = true,
  cacheBust = false,
  options,
  guard,
}: PngExportOptions): PngExport {
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  /* Callers pass fresh closures every render. Keeping them in a ref (updated
     after commit, never during render) keeps `run` stable without asking every
     tool to wrap its guard in useCallback. */
  const latest = useRef({ filename, options, guard })
  useEffect(() => {
    latest.current = { filename, options, guard }
  })

  const flash = useCallback((message: string) => {
    setToast(message)
    // clear only our own message — a later toast must not be cut short by an
    // earlier timer
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), TOAST_MS)
  }, [])

  const run = useCallback(
    async (deliver: (blob: Blob) => void | Promise<void>) => {
      if (busy) return
      const refusal = latest.current.guard?.()
      if (refusal) {
        flash(refusal)
        return
      }
      const node = shotRef.current
      if (!node) return
      setBusy(true)
      try {
        const extra = await latest.current.options?.()
        const blob = await toBlob(node, {
          pixelRatio,
          cacheBust,
          skipFonts,
          width: node.offsetWidth,
          height: node.offsetHeight,
          // neutralise the preview transform so the PNG comes out full-size
          style: { transform: 'none', transformOrigin: 'top left' },
          ...extra,
        })
        if (!blob) {
          flash('이미지를 만들지 못했습니다')
          return
        }
        await deliver(blob)
      } catch {
        flash('내보내기 실패')
      } finally {
        setBusy(false)
      }
    },
    [busy, shotRef, pixelRatio, cacheBust, skipFonts, flash],
  )

  const savePng = useCallback(() => {
    void run((blob) => {
      const { filename: name } = latest.current
      const base = typeof name === 'function' ? name() : name
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${base}.png`
      a.click()
      URL.revokeObjectURL(url)
      flash('PNG로 저장했습니다')
    })
  }, [run, flash])

  const copyPng = useCallback(() => {
    void run(async (blob) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        flash('클립보드에 복사했습니다')
      } catch {
        flash('복사 실패 — 저장을 이용하세요')
      }
    })
  }, [run, flash])

  /* ⌘E export, ⌘⇧C copy — the same keys in every tool. ⇧ on copy keeps ⌘C free
     for the text selection the user is probably making in the editor. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'e' && !e.shiftKey) {
        e.preventDefault()
        savePng()
      } else if (k === 'c' && e.shiftKey) {
        e.preventDefault()
        copyPng()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [savePng, copyPng])

  return { savePng, copyPng, busy, toast, flash }
}

/* ---------- vector export ---------- */

export interface SvgExport {
  /** download the figure as a standalone SVG */
  saveSvg: () => void
  /** rasterise the SVG at the chosen dpi and download */
  savePng: () => void
  /** rasterise and put on the clipboard */
  copyPng: () => void
  /** output size the current dpi would produce, for the toolbar readout */
  pixels: { w: number; h: number }
  busy: boolean
  toast: string | null
  flash: (message: string) => void
}

export interface SvgExportOptions {
  /** the <svg> element on screen — it is serialised, never re-drawn */
  svgRef: RefObject<SVGSVGElement | null>
  filename: string | (() => string)
  /** printed width on the page; drives both the mm size and the dpi maths */
  printWidthIn: number
  /** figure width in its own coordinates, for the px ↔ inch conversion */
  figPxWidth: number
  figPxHeight: number
  /** opaque background, or null to keep the file transparent */
  bg?: string | null
  /** pinned on the exported root — a standalone SVG inherits no stylesheet */
  fontFamily?: string
  dpi?: number
  /** goes into <desc> */
  title?: string
}

/** Vector export for the tools that draw their figure as SVG.
 *
 *  These tools do not go through usePngExport at all: rasterising the DOM with
 *  html-to-image throws away the one advantage of having drawn vectors, and it
 *  is also where the webfont-embedding cost lives. Going SVG → <img> → canvas
 *  gives a PNG at any dpi from the same file the vector export produces, so the
 *  two can't disagree. */
export function useSvgExport({
  svgRef,
  filename,
  printWidthIn,
  figPxWidth,
  figPxHeight,
  bg = null,
  fontFamily,
  dpi = 600,
  title,
}: SvgExportOptions): SvgExport {
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const latest = useLatest({ filename, printWidthIn, bg, fontFamily, dpi, title })

  const flash = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), TOAST_MS)
  }, [])

  const frame = useCallback(() => {
    const el = svgRef.current
    if (!el) return null
    const o = latest.current
    return {
      framed: buildSvgDoc(el, {
        printWidthIn: o.printWidthIn,
        bg: o.bg,
        fontFamily: o.fontFamily,
        title: o.title,
      }),
      opts: o,
    }
  }, [svgRef, latest])

  const nameOf = (f: string | (() => string)) => (typeof f === 'function' ? f() : f)

  const saveSvg = useCallback(() => {
    const made = frame()
    if (!made) return
    download(textBlob(made.framed.svg, 'image/svg+xml'), `${nameOf(made.opts.filename)}.svg`)
    flash('SVG로 저장했습니다')
  }, [frame, flash])

  const raster = useCallback(
    async (deliver: (blob: Blob) => void | Promise<void>) => {
      if (busy) return
      const made = frame()
      if (!made) return
      setBusy(true)
      try {
        const blob = await svgToPng(
          made.framed,
          made.opts.dpi,
          made.opts.printWidthIn,
          made.framed.w,
        )
        await deliver(blob)
      } catch {
        flash('내보내기 실패')
      } finally {
        setBusy(false)
      }
    },
    [busy, frame, flash],
  )

  const savePng = useCallback(() => {
    void raster((blob) => {
      download(blob, `${nameOf(latest.current.filename)}.png`)
      flash('PNG로 저장했습니다')
    })
  }, [raster, flash, latest])

  const copyPng = useCallback(() => {
    void raster(async (blob) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        flash('클립보드에 복사했습니다')
      } catch {
        flash('복사 실패 — 저장을 이용하세요')
      }
    })
  }, [raster, flash])

  /* ⌘E PNG, ⌘⇧E SVG, ⌘⇧C copy — the PNG and copy keys match the raster tools
     so the shortcut means the same thing everywhere. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'e') {
        e.preventDefault()
        if (e.shiftKey) saveSvg()
        else savePng()
      } else if (k === 'c' && e.shiftKey) {
        e.preventDefault()
        copyPng()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveSvg, savePng, copyPng])

  const pixels = pngPixels({ w: figPxWidth, h: figPxHeight }, dpi, printWidthIn, figPxWidth)

  return { saveSvg, savePng, copyPng, pixels, busy, toast, flash }
}
