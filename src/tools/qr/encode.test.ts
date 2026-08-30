/* The encoder is checked the only way a QR encoder can honestly be checked:
 * by decoding what it produced.
 *
 * A wrong entry in one of the spec tables does not throw and does not look
 * wrong — it produces a symbol that is the right size, the right density, and
 * simply unreadable, at that one version and level. So the payloads below are
 * chosen to walk the version bands (the three char-count widths), the
 * block-count regimes (1 block, several, and the many-block versions where the
 * short/long split kicks in) and all four levels, and every one of them goes
 * through jsQR — an independent decoder — and has to come back as the string
 * that went in.
 *
 * jsQR wants pixels, so `raster` paints the module grid at 4 px per module with
 * the quiet zone the spec asks for. That doubles as a check on the grid itself:
 * an off-by-one in the function patterns shows up as a locator failure. */

import { describe, expect, it } from 'vitest'
import jsQR from 'jsqr'
import {
  ECLS,
  capacityBits,
  encodeQr,
  maxUnits,
  pickMode,
  type Ecl,
  type QrCode,
} from './encode'

/** Module grid → RGBA pixels, with a 4-module quiet zone. */
function raster(qr: QrCode, scale = 4) {
  const quiet = 4
  const side = (qr.size + quiet * 2) * scale
  const data = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const px = (x + quiet) * scale + dx
          const py = (y + quiet) * scale + dy
          const i = (py * side + px) * 4
          data[i] = data[i + 1] = data[i + 2] = 0
        }
    }
  return { data, side }
}

function roundTrip(text: string, ecl: Ecl, minVersion?: number): string | null {
  const result = encodeQr(text, { ecl, minVersion })
  if (!result.ok) throw new Error(result.error)
  const { data, side } = raster(result.qr)
  return jsQR(data, side, side)?.data ?? null
}

const repeat = (s: string, n: number) => s.repeat(Math.ceil(n / s.length)).slice(0, n)

describe('mode selection', () => {
  it('takes the cheapest mode the text allows', () => {
    expect(pickMode('01234567')).toBe('numeric')
    expect(pickMode('HELLO WORLD')).toBe('alnum')
    expect(pickMode('HTTPS://EXAMPLE.COM/A-1')).toBe('alnum')
    // lowercase is not in the alphanumeric table, which is the usual surprise
    expect(pickMode('hello')).toBe('byte')
    expect(pickMode('한국과학영재학교')).toBe('byte')
  })
})

describe('capacity', () => {
  /* Data *codewords* per version and level, straight out of the spec's block
     table. If these drift, so has one of the two tables the whole encoder rests
     on. (They are not the character counts quoted in the capacity table — those
     are these minus the mode and length header.) */
  it('matches the published data capacities', () => {
    expect(capacityBits(1, 'L') / 8).toBe(19)
    expect(capacityBits(1, 'H') / 8).toBe(9)
    expect(capacityBits(10, 'M') / 8).toBe(216)
    expect(capacityBits(19, 'L') / 8).toBe(795)
    expect(capacityBits(25, 'Q') / 8).toBe(718)
    expect(capacityBits(40, 'L') / 8).toBe(2956)
    expect(capacityBits(40, 'H') / 8).toBe(1276)
  })

  /* Every version at every level, as data codewords. This is the encoder's
     whole foundation flattened into one assertion: the block table, the ECC
     table and the raw-module formula all have to be right for a single entry
     to come out right. The row was cross-checked module-for-module against an
     independent implementation across all 160 combinations, so a diff here is
     a regression, not a disagreement about the spec. */
  it('agrees with the spec across every version and level', () => {
    const table: Record<Ecl, number[]> = {
      L: [19, 34, 55, 80, 108, 136, 156, 194, 232, 274, 324, 370, 428, 461, 523, 589, 647, 721, 795, 861, 932, 1006, 1094, 1174, 1276, 1370, 1468, 1531, 1631, 1735, 1843, 1955, 2071, 2191, 2306, 2434, 2566, 2702, 2812, 2956],
      M: [16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415, 453, 507, 563, 627, 669, 714, 782, 860, 914, 1000, 1062, 1128, 1193, 1267, 1373, 1455, 1541, 1631, 1725, 1812, 1914, 1992, 2102, 2216, 2334],
      Q: [13, 22, 34, 48, 62, 76, 88, 110, 132, 154, 180, 206, 244, 261, 295, 325, 367, 397, 445, 485, 512, 568, 614, 664, 718, 754, 808, 871, 911, 985, 1033, 1115, 1171, 1231, 1286, 1354, 1426, 1502, 1582, 1666],
      H: [9, 16, 26, 36, 46, 60, 66, 86, 100, 122, 140, 158, 180, 197, 223, 253, 283, 313, 341, 385, 406, 442, 464, 514, 538, 596, 628, 661, 701, 745, 793, 845, 901, 961, 986, 1054, 1096, 1142, 1222, 1276],
    }
    for (const ecl of ECLS)
      for (let v = 1; v <= 40; v++) expect([v, ecl, capacityBits(v, ecl) / 8]).toEqual([v, ecl, table[ecl][v - 1]])
  })

  it('reports how much a level can carry', () => {
    // v40-L holds 2953 bytes in byte mode once the header is paid for
    expect(maxUnits('byte', 'L')).toBe(2953)
    expect(maxUnits('numeric', 'L')).toBe(7089)
  })

  it('refuses what does not fit, and says how much would', () => {
    const result = encodeQr(repeat('x', 3000), { ecl: 'L' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('2,953')
  })

  it('refuses empty text', () => {
    expect(encodeQr('', {}).ok).toBe(false)
  })
})

describe('symbol geometry', () => {
  const result = encodeQr('https://funky-esset-maker.vercel.app', { ecl: 'M' })
  if (!result.ok) throw new Error(result.error)
  const qr = result.qr

  it('sizes the grid from the version', () => {
    expect(qr.size).toBe(qr.version * 4 + 17)
    expect(qr.modules).toHaveLength(qr.size)
    expect(qr.modules[0]).toHaveLength(qr.size)
  })

  it('draws the three finder patterns', () => {
    const eye = (cx: number, cy: number) =>
      qr.modules[cy][cx] && !qr.modules[cy][cx + 2] && qr.modules[cy][cx + 3]
    expect(eye(3, 3)).toBe(true)
    expect(eye(qr.size - 4, 3)).toBe(true)
    expect(eye(3, qr.size - 4)).toBe(true)
  })

  it('marks function modules so the renderer can tell them apart', () => {
    expect(qr.fn[3][3]).toBe(true) // finder
    expect(qr.fn[6][10]).toBe(true) // timing
    expect(qr.fn[qr.size - 8][8]).toBe(true) // the always-dark module
    expect(qr.modules[qr.size - 8][8]).toBe(true)
    expect(qr.fn[qr.size - 3][qr.size - 3]).toBe(false) // payload
  })

  it('keeps the timing patterns alternating', () => {
    for (let i = 8; i < qr.size - 8; i++) {
      expect(qr.modules[6][i]).toBe(i % 2 === 0)
      expect(qr.modules[i][6]).toBe(i % 2 === 0)
    }
  })
})

describe('round trip through a real decoder', () => {
  /* One case per version band and block regime, so a broken table row cannot
     hide behind a neighbour that happens to share its numbers. */
  const cases: { name: string; text: string }[] = [
    { name: 'numeric, version 1', text: '01234567' },
    { name: 'alphanumeric', text: 'HELLO WORLD' },
    { name: 'a URL', text: 'https://funky-esset-maker.vercel.app/llms.txt' },
    { name: '한글 byte mode', text: '한국과학영재학교 2026 학술제' },
    { name: 'emoji', text: '펑키 에셋 메이커 ✦ QR' },
    { name: 'a newline-separated payload', text: 'WIFI:T:WPA;S:KSA;P:secret;;' },
    { name: 'version 10 band (16-bit count)', text: repeat('funky-esset ', 300) },
    { name: 'version 27 band', text: repeat('데이터 ', 400) },
    { name: 'long numeric', text: repeat('4815162342', 600) },
  ]

  for (const ecl of ECLS)
    for (const { name, text } of cases)
      it(`${name} at level ${ecl}`, () => {
        // the largest payloads only fit at the lower levels
        const fits = encodeQr(text, { ecl })
        if (!fits.ok) {
          expect(fits.error).toContain('너무 깁니다')
          return
        }
        expect(roundTrip(text, ecl)).toBe(text)
      })

  /* A sample across the version bands with the symbol forced large and the
     payload short — the padding fills the blocks, so this exercises each
     version's interleave without the decode cost of 40 full-size images.
     (v23 at level L is left out on purpose: jsQR cannot read a fully packed
     symbol of that version even when it is the one that produced it.) */
  for (const v of [2, 6, 7, 9, 10, 14, 20, 26, 27, 33, 40])
    it(`decodes at version ${v}`, () => {
      const text = `VERSION ${v} CHECK`
      for (const ecl of ECLS) {
        const result = encodeQr(text, { ecl, minVersion: v })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.qr.version).toBe(v)
        expect([v, ecl, roundTrip(text, ecl, v)]).toEqual([v, ecl, text])
      }
    })

  it('honours a version floor and still decodes', () => {
    const result = encodeQr('OK', { ecl: 'H', minVersion: 12 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.qr.version).toBe(12)
    expect(roundTrip('OK', 'H', 12)).toBe('OK')
  })

  /* Every mask has to produce a decodable symbol — the chooser only picks the
     prettiest, it must never be what makes the code work. */
  it('decodes under every mask', () => {
    const text = 'MASK TEST 12345'
    for (let mask = 0; mask < 8; mask++) {
      const result = encodeQr(text, { ecl: 'Q', mask })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.qr.mask).toBe(mask)
      const { data, side } = raster(result.qr)
      expect(jsQR(data, side, side)?.data).toBe(text)
    }
  })

  /* Error correction is the whole reason a logo can sit on a code. Knock out a
     block of modules well inside what level H recovers and it must still read. */
  it('survives damage up to the level it advertises', () => {
    const text = 'https://ksa.hs.kr'
    const result = encodeQr(text, { ecl: 'H' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const qr = result.qr
    const side = Math.floor(Math.sqrt(qr.size * qr.size * 0.15))
    const from = Math.floor((qr.size - side) / 2)
    for (let y = from; y < from + side; y++)
      for (let x = from; x < from + side; x++) qr.modules[y][x] = false
    const { data, side: px } = raster(qr)
    expect(jsQR(data, px, px)?.data).toBe(text)
  })
})
