/* QR Code encoding — ISO/IEC 18004.
 *
 * Written here rather than pulled in as a dependency for the same reason the
 * 한글 converter and the plot engine are: the spec is fixed, small enough to
 * own, and owning it means a code arrives as *data* — a grid of booleans plus
 * which of them are function patterns — instead of as somebody else's canvas or
 * SVG string. Every visual choice this tool makes (rounded runs, dot modules, a
 * knocked-out logo well, a finder pattern drawn differently from the payload)
 * needs that grid; a library that hands back a picture can do none of it.
 *
 * Exact where the spec leaves no room — mode indicators, the Reed–Solomon
 * remainder, the BCH format and version bits, the interleave order. Pragmatic
 * in the two places it only asks for a *good* choice: one segment mode for the
 * whole string rather than optimal mixed segmentation, and the usual
 * approximation of penalty rule 3. Neither can make a code unreadable; they
 * cost at most a version, or a slightly busier mask.
 *
 * ⚠️ The tables below are the spec's, not derived. A single wrong entry
 * produces codes that fail to decode only at that one version and level, which
 * is exactly the bug that ships. encode.test.ts round-trips real payloads
 * through a real decoder (jsQR) across every block-count regime and all four
 * levels, so a bad row fails the suite instead of a user's phone. */

export type Ecl = 'L' | 'M' | 'Q' | 'H'

/** The three segment modes this encoder writes. Kanji mode is deliberately
 *  absent: it only pays off for Shift-JIS text, and byte mode with UTF-8 is
 *  what readers actually expect from Korean or emoji content. */
export type QrMode = 'numeric' | 'alnum' | 'byte'

export const MODE_LABEL: Record<QrMode, string> = {
  numeric: '숫자',
  alnum: '영숫자',
  byte: '바이트',
}

export interface QrCode {
  version: number
  ecl: Ecl
  /** the mask that was applied, 0–7 */
  mask: number
  /** modules per side, 17 + 4 × version */
  size: number
  /** `[y][x]`, true = dark */
  modules: boolean[][]
  /** `[y][x]`, true = finder / timing / alignment / format / version module.
   *  The renderer draws those differently, and the logo must never sit on one. */
  fn: boolean[][]
  mode: QrMode
  /** data codeword bits used ÷ available, 0–1 — how close to the next version */
  fill: number
  /** how much of the code the error correction could lose and still decode,
   *  as a fraction of all modules. Drives the "your logo is too big" check. */
  recovery: number
}

export type EncodeResult = { ok: true; qr: QrCode } | { ok: false; error: string }

export const ECLS: Ecl[] = ['L', 'M', 'Q', 'H']

/** Nominal recovery capacity, the numbers the spec advertises for each level.
 *  Real capacity is a little higher; staying with the advertised figure is what
 *  keeps a logo inside what every reader can handle, not just a good one. */
export const ECL_RECOVERY: Record<Ecl, number> = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 }

export const ECL_LABEL: Record<Ecl, string> = {
  L: 'L — 7%',
  M: 'M — 15%',
  Q: 'Q — 25%',
  H: 'H — 30%',
}

export const MIN_VERSION = 1
export const MAX_VERSION = 40

/* ---------- spec tables ---------- */

/** Error correction codewords per block, indexed [ecl][version]. */
const ECC_PER_BLOCK: Record<Ecl, number[]> = {
  // v: 0(unused) 1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
}

/** Number of error correction blocks, indexed [ecl][version]. */
const NUM_BLOCKS: Record<Ecl, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
}

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'

/* ---------- capacity arithmetic ---------- */

/** Modules available to data and error correction, before the codeword split.
 *  Everything else on the symbol is a function pattern. */
function rawDataModules(version: number): number {
  let n = (16 * version + 128) * version + 64
  if (version >= 2) {
    const aligns = Math.floor(version / 7) + 2
    n -= (25 * aligns - 10) * aligns - 55
    if (version >= 7) n -= 36
  }
  return n
}

const rawCodewords = (version: number) => Math.floor(rawDataModules(version) / 8)

/** Bits a version and level leave for the data segment itself. */
export function capacityBits(version: number, ecl: Ecl): number {
  return (rawCodewords(version) - ECC_PER_BLOCK[ecl][version] * NUM_BLOCKS[ecl][version]) * 8
}

function charCountBits(mode: QrMode, version: number): number {
  const band = version <= 9 ? 0 : version <= 26 ? 1 : 2
  if (mode === 'numeric') return [10, 12, 14][band]
  if (mode === 'alnum') return [9, 11, 13][band]
  return [8, 16, 16][band]
}

const MODE_BITS: Record<QrMode, number> = { numeric: 0b0001, alnum: 0b0010, byte: 0b0100 }

/** The cheapest mode that can carry the text as one segment. */
export function pickMode(text: string): QrMode {
  if (/^[0-9]*$/.test(text)) return 'numeric'
  for (const ch of text) if (!ALNUM.includes(ch)) return 'byte'
  return 'alnum'
}

const utf8 = (text: string) => Array.from(new TextEncoder().encode(text))

/** Payload bits for `text` in `mode`, excluding the header. */
function payloadBits(text: string, mode: QrMode): number {
  if (mode === 'numeric') {
    const n = text.length
    return 10 * Math.floor(n / 3) + [0, 4, 7][n % 3]
  }
  if (mode === 'alnum') {
    const n = text.length
    return 11 * Math.floor(n / 2) + 6 * (n % 2)
  }
  return utf8(text).length * 8
}

/** How long a single segment of `mode` can get at the largest version. Only
 *  used to say something useful when the text does not fit. */
export function maxUnits(mode: QrMode, ecl: Ecl): number {
  const bits = capacityBits(MAX_VERSION, ecl) - 4 - charCountBits(mode, MAX_VERSION)
  if (mode === 'numeric') return Math.floor((bits / 10) * 3)
  if (mode === 'alnum') return Math.floor((bits / 11) * 2)
  return Math.floor(bits / 8)
}

/* ---------- bit assembly ---------- */

class Bits {
  readonly bits: number[] = []

  push(value: number, len: number) {
    for (let i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1)
  }

  get length() {
    return this.bits.length
  }
}

function writeSegment(bb: Bits, text: string, mode: QrMode, version: number) {
  bb.push(MODE_BITS[mode], 4)
  const count = mode === 'byte' ? utf8(text).length : text.length
  bb.push(count, charCountBits(mode, version))

  if (mode === 'numeric') {
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3)
      bb.push(parseInt(chunk, 10), chunk.length * 3 + 1)
    }
    return
  }
  if (mode === 'alnum') {
    for (let i = 0; i < text.length; i += 2) {
      const a = ALNUM.indexOf(text[i])
      if (i + 1 < text.length) bb.push(a * 45 + ALNUM.indexOf(text[i + 1]), 11)
      else bb.push(a, 6)
    }
    return
  }
  for (const b of utf8(text)) bb.push(b, 8)
}

/** Header + payload + terminator + padding, as whole codewords. */
function dataCodewords(text: string, mode: QrMode, version: number, ecl: Ecl): number[] {
  const cap = capacityBits(version, ecl)
  const bb = new Bits()
  writeSegment(bb, text, mode, version)

  // terminator, then zeroes up to the next byte boundary
  bb.push(0, Math.min(4, cap - bb.length))
  bb.push(0, (8 - (bb.length % 8)) % 8)

  // the spec's two pad bytes, alternating, until the version is full
  for (let pad = 0xec; bb.length < cap; pad ^= 0xec ^ 0x11) bb.push(pad, 8)

  const out: number[] = []
  for (let i = 0; i < bb.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bb.bits[i + j]
    out.push(byte)
  }
  return out
}

/* ---------- Reed–Solomon over GF(256) ---------- */

/** Multiply in GF(2^8) with the QR primitive polynomial x^8+x^4+x^3+x^2+1. */
function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

/** Coefficients of (x − α^0)(x − α^1)…(x − α^(degree−1)), highest term implicit. */
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 2)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ result[0]
    result.shift()
    result.push(0)
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor)
  }
  return result
}

/** Split into blocks, add the remainder to each, then interleave — the order
 *  the codewords are actually written onto the symbol. */
function interleave(data: number[], version: number, ecl: Ecl): number[] {
  const blocks = NUM_BLOCKS[ecl][version]
  const eccLen = ECC_PER_BLOCK[ecl][version]
  const raw = rawCodewords(version)
  const shortCount = blocks - (raw % blocks)
  const shortLen = Math.floor(raw / blocks)

  const divisor = rsDivisor(eccLen)
  const built: number[][] = []
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - eccLen + (i < shortCount ? 0 : 1)
    const dat = data.slice(k, k + len)
    k += len
    const ecc = rsRemainder(dat, divisor)
    // a short block is padded to the long length so the interleave loop can be
    // one rectangular pass; the pad is skipped on the way out
    if (i < shortCount) dat.push(0)
    built.push(dat.concat(ecc))
  }

  const out: number[] = []
  for (let i = 0; i < built[0].length; i++)
    built.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortCount) out.push(block[i])
    })
  return out
}

/* ---------- the symbol ---------- */

const grid = (size: number, value = false): boolean[][] =>
  Array.from({ length: size }, () => new Array<boolean>(size).fill(value))

/** Centres of the alignment patterns, per version. */
function alignPositions(version: number): number[] {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const size = version * 4 + 17
  // v32 is the one version where the even-spacing rule and the table disagree
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
  const out = [6]
  for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos)
  return out
}

class QrSymbol {
  readonly version: number
  readonly ecl: Ecl
  readonly size: number
  readonly modules: boolean[][]
  readonly fn: boolean[][]

  constructor(version: number, ecl: Ecl) {
    this.version = version
    this.ecl = ecl
    this.size = version * 4 + 17
    this.modules = grid(this.size)
    this.fn = grid(this.size)
  }

  private set(x: number, y: number, dark: boolean, isFn = true) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return
    this.modules[y][x] = dark
    if (isFn) this.fn[y][x] = true
  }

  /** Finder eye plus its separator, given the centre. */
  private finder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        this.set(cx + dx, cy + dy, d !== 2 && d !== 4)
      }
  }

  private align(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }

  drawFunctionPatterns() {
    const n = this.size
    for (let i = 0; i < n; i++) {
      this.set(6, i, i % 2 === 0)
      this.set(i, 6, i % 2 === 0)
    }
    this.finder(3, 3)
    this.finder(n - 4, 3)
    this.finder(3, n - 4)

    const pos = alignPositions(this.version)
    for (let i = 0; i < pos.length; i++)
      for (let j = 0; j < pos.length; j++) {
        // the three corners already carry finders
        const corner =
          (i === 0 && j === 0) ||
          (i === 0 && j === pos.length - 1) ||
          (i === pos.length - 1 && j === 0)
        if (!corner) this.align(pos[i], pos[j])
      }

    // reserve the format area; the real bits go in once the mask is chosen
    this.drawFormat(0)
    this.drawVersion()
  }

  /** 15-bit BCH(15,5) format information, written twice. */
  drawFormat(mask: number) {
    const ecl = { L: 1, M: 0, Q: 3, H: 2 }[this.ecl]
    const data = (ecl << 3) | mask
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = (((data << 10) | rem) ^ 0x5412) >>> 0
    const bit = (i: number) => ((bits >>> i) & 1) === 1
    const n = this.size

    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i))
    this.set(8, 7, bit(6))
    this.set(8, 8, bit(7))
    this.set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i))

    for (let i = 0; i < 8; i++) this.set(n - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) this.set(8, n - 15 + i, bit(i))
    // the module that is dark in every symbol ever made
    this.set(8, n - 8, true)
  }

  /** 18-bit BCH(18,6) version information — only from version 7 up. */
  private drawVersion() {
    if (this.version < 7) return
    let rem = this.version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (this.version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1
      const a = this.size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      this.set(a, b, dark)
      this.set(b, a, dark)
    }
  }

  /** Zigzag up and down the two-module columns, skipping the timing column. */
  drawCodewords(codewords: number[]) {
    let i = 0
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      for (let v = 0; v < this.size; v++)
        for (let j = 0; j < 2; j++) {
          const x = right - j
          const upward = ((right + 1) & 2) === 0
          const y = upward ? this.size - 1 - v : v
          if (this.fn[y][x] || i >= codewords.length * 8) continue
          this.modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
          i++
        }
    }
  }

  /** XOR the mask over everything that is not a function module. Applying it
   *  twice removes it, which is how the eight candidates are trialled. */
  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) {
        if (this.fn[y][x]) continue
        let invert: boolean
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break
          case 1: invert = y % 2 === 0; break
          case 2: invert = x % 3 === 0; break
          case 3: invert = (x + y) % 3 === 0; break
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break
          default: invert = ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0; break
        }
        if (invert) this.modules[y][x] = !this.modules[y][x]
      }
  }

  /** The spec's four penalty rules — lower is a code readers cope with better. */
  penalty(): number {
    const n = this.size
    const at = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < n && y < n && this.modules[y][x]
    let score = 0

    // rule 1 — runs of five or more
    for (let i = 0; i < n; i++)
      for (const row of [true, false]) {
        let run = 1
        for (let j = 1; j < n; j++) {
          const cur = row ? at(j, i) : at(i, j)
          const prev = row ? at(j - 1, i) : at(i, j - 1)
          if (cur === prev) {
            run++
            if (run === 5) score += 3
            else if (run > 5) score += 1
          } else run = 1
        }
      }

    // rule 2 — 2×2 blocks of one colour
    for (let y = 0; y + 1 < n; y++)
      for (let x = 0; x + 1 < n; x++) {
        const a = at(x, y)
        if (a === at(x + 1, y) && a === at(x, y + 1) && a === at(x + 1, y + 1)) score += 3
      }

    // rule 3 — a finder-alike (1:1:3:1:1) with four light modules beside it.
    // Outside the symbol counts as light, which is what the quiet zone is.
    const shape = [true, false, true, true, true, false, true]
    const light4 = (x: number, y: number, dx: number, dy: number) => {
      for (let k = 0; k < 4; k++) if (at(x + dx * k, y + dy * k)) return false
      return true
    }
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          if (!shape.every((want, k) => at(x + dx * k, y + dy * k) === want)) continue
          if (
            light4(x - dx, y - dy, -dx, -dy) ||
            light4(x + dx * 7, y + dy * 7, dx, dy)
          )
            score += 40
        }

    // rule 4 — drift away from half dark
    let dark = 0
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (this.modules[y][x]) dark++
    const total = n * n
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10

    return score
  }
}

/* ---------- entry point ---------- */

export interface EncodeOptions {
  ecl?: Ecl
  /** never go below this version, so a code keeps its size as text is edited */
  minVersion?: number
  /** 0–7 to pin a mask, or undefined to pick the lowest-penalty one */
  mask?: number
}

/** Encode `text` into a QR symbol, or say why it does not fit. */
export function encodeQr(text: string, opts: EncodeOptions = {}): EncodeResult {
  const ecl = opts.ecl ?? 'M'
  const floor = Math.min(MAX_VERSION, Math.max(MIN_VERSION, opts.minVersion ?? MIN_VERSION))
  if (!text) return { ok: false, error: '내용이 비어 있습니다' }

  const mode = pickMode(text)
  const bits = payloadBits(text, mode)

  let version = 0
  for (let v = floor; v <= MAX_VERSION; v++) {
    if (4 + charCountBits(mode, v) + bits <= capacityBits(v, ecl)) {
      version = v
      break
    }
  }
  if (!version) {
    const unit = mode === 'byte' ? '바이트' : '자'
    return {
      ok: false,
      error: `내용이 너무 깁니다 — ${ecl} 레벨에서 최대 ${maxUnits(mode, ecl).toLocaleString()}${unit}`,
    }
  }

  const sym = new QrSymbol(version, ecl)
  sym.drawFunctionPatterns()
  sym.drawCodewords(interleave(dataCodewords(text, mode, version, ecl), version, ecl))

  const pinned = opts.mask
  let mask = pinned !== undefined && pinned >= 0 && pinned <= 7 ? pinned : 0
  if (pinned === undefined || pinned < 0 || pinned > 7) {
    let best = Infinity
    for (let m = 0; m < 8; m++) {
      sym.applyMask(m)
      sym.drawFormat(m)
      const p = sym.penalty()
      if (p < best) {
        best = p
        mask = m
      }
      sym.applyMask(m) // XOR again to undo, ready for the next candidate
    }
  }
  sym.applyMask(mask)
  sym.drawFormat(mask)

  const capacity = capacityBits(version, ecl)
  return {
    ok: true,
    qr: {
      version,
      ecl,
      mask,
      size: sym.size,
      modules: sym.modules,
      fn: sym.fn,
      mode,
      fill: (4 + charCountBits(mode, version) + bits) / capacity,
      recovery: ECL_RECOVERY[ecl],
    },
  }
}
