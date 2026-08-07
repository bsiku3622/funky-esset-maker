/* Bringing bitmaps in: drag-and-drop, clipboard paste, file picker.
 *
 * Everything ends up as a data URL embedded in the node, which is what makes an
 * exported SVG self-contained — no sidecar files to lose when the figure is
 * handed to a co-author or dropped into a LaTeX tree. The trade-off is size, so
 * oversized bitmaps get resampled on the way in. */

export interface LoadedImage {
  src: string // data URL
  w: number // natural pixel width (after any downscale)
  h: number
  /** true when the original was resampled to fit `maxEdge` */
  resized: boolean
}

/** Longest edge we keep. 2400 px is ~4 inches at 600 dpi, which is already
 *  more than any single panel of a two-column figure needs. */
export const MAX_EDGE = 2400

const readDataUrl = (file: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error ?? new Error('read failed'))
    r.readAsDataURL(file)
  })

const decode = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('decode failed'))
    img.src = src
  })

/** Read a file into a data URL, downscaling if it is larger than `maxEdge`. */
export async function fileToImage(file: File, maxEdge = MAX_EDGE): Promise<LoadedImage> {
  const raw = await readDataUrl(file)
  const img = await decode(raw)
  const long = Math.max(img.naturalWidth, img.naturalHeight)
  if (long <= maxEdge)
    return { src: raw, w: img.naturalWidth, h: img.naturalHeight, resized: false }

  const k = maxEdge / long
  const w = Math.round(img.naturalWidth * k)
  const h = Math.round(img.naturalHeight * k)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return { src: raw, w: img.naturalWidth, h: img.naturalHeight, resized: false }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  // keep PNG for anything that might carry transparency; JPEG stays JPEG
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  return { src: canvas.toDataURL(type, 0.92), w, h, resized: true }
}

const isImage = (f: File | null) => !!f && f.type.startsWith('image/')

/** Image files out of a drop event. */
export function imagesFromDrop(dt: DataTransfer | null): File[] {
  if (!dt) return []
  return Array.from(dt.files).filter(isImage)
}

/** Image files out of a paste event — screenshots arrive here, not in `files`. */
export function imagesFromPaste(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out: File[] = []
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const f = item.getAsFile()
    if (f) out.push(f)
  }
  return out.length ? out : Array.from(dt.files).filter(isImage)
}

/** Box that fits `w × h` inside `maxW × maxH` without distorting it. */
export function fitBox(w: number, h: number, maxW: number, maxH: number) {
  const k = Math.min(1, maxW / w, maxH / h)
  return { w: Math.max(8, Math.round(w * k)), h: Math.max(8, Math.round(h * k)) }
}

/** Rough byte size of a data URL, for the "this figure is getting heavy" hint. */
export const dataUrlBytes = (src: string) => {
  const i = src.indexOf(',')
  if (i < 0) return src.length
  return Math.floor(((src.length - i - 1) * 3) / 4)
}

export const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
