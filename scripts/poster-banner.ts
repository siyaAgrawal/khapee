/**
 * The existing poster laid out for a 3ft × 6ft banner.
 *
 *   npx tsx scripts/poster-banner.ts data/qr/khapee-poster.png [ft wide] [ft tall] [dpi]
 *
 * The artwork is 1024 pixels across and a three-foot print wants about five
 * thousand, so this enlarges it — which cannot invent detail that was never
 * there, and the wordmark and the photograph will be softer than the vector
 * version in scripts/poster-print.ts. That is the trade, made knowingly:
 * this keeps the original fonts and the photograph.
 *
 * The page is 2:3 and a 3×6 banner is 1:2, so it has to gain height. Stretching
 * it would squash the logo and the wordmark, and putting the difference at the
 * top leaves a foot and a half of nothing. So the extra height goes into the
 * gaps that are already there: the rows that are blank right across the page,
 * between the logo and the wordmark, between the wordmark and the code, and so
 * on. Every element keeps its own proportions and its own typeface — nothing is
 * redrawn and nothing is scaled unevenly — and the layout simply breathes out
 * to the taller format, which is what somebody would do by hand.
 *
 * The QR is the exception: it is thrown away and drawn again at full size,
 * because a blurred code is a code that does not scan, and it is the only part
 * of a poster a person cannot check by looking at it.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import QRCode from 'qrcode'

const src = process.argv[2] ?? 'data/qr/khapee-poster.png'
const feetWide = Number(process.argv[3] ?? 3)
const feetTall = Number(process.argv[4] ?? 6)
const dpi = Number(process.argv[5] ?? 150)
const target = process.env.KHAPEE_SITE ?? 'https://khapee.com'

if (!fs.existsSync(src)) {
  console.error(`\n  No artwork at ${src}\n`)
  process.exit(1)
}

const pxWide = Math.round(feetWide * 12 * dpi)
const pxTall = Math.round(feetTall * 12 * dpi)

/**
 * The rows that are blank right across the artwork — the gaps between one
 * element and the next. Adding rows inside one of these is invisible, because
 * every row in it is identical; adding them anywhere else would cut something
 * in half.
 */
function blankBands(img: PNG): [number, number][] {
  const clear = (y: number) => {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      if (img.data[i] < 244 || img.data[i + 1] < 244 || img.data[i + 2] < 244) return false
    }
    return true
  }
  const out: [number, number][] = []
  let from = -1
  for (let y = 0; y < img.height; y++) {
    if (clear(y)) {
      if (from < 0) from = y
    } else if (from >= 0) {
      if (y - from >= 4) out.push([from, y - 1])
      from = -1
    }
  }
  if (from >= 0 && img.height - from >= 4) out.push([from, img.height - 1])
  return out
}

/** One row's average colour, so a gap can be filled with no grain in it. */
function flatColour(img: PNG, y: number): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4
    r += img.data[i]
    g += img.data[i + 1]
    b += img.data[i + 2]
  }
  const n = img.width
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
}

const source = PNG.sync.read(fs.readFileSync(src))
const wantTall = Math.round((source.width * feetTall) / feetWide)
const extra = wantTall - source.height
if (extra < 0) {
  console.error(`\n  ${feetWide}×${feetTall} is shorter than the artwork; it would have to be cropped.\n`)
  process.exit(1)
}

const bands = blankBands(source)
if (!bands.length) {
  console.error('\n  No blank rows to grow — the artwork has no gaps to open up.\n')
  process.exit(1)
}

/**
 * How the extra height is shared out.
 *
 * A quarter goes to the margin at the top, which a taller page wants more of;
 * the rest is split between the inside gaps in proportion to the room already
 * there, so the spacing the design already had is kept and simply scaled.
 */
const insideBands = bands.slice(1)
const insideRoom = insideBands.reduce((n, [a, b]) => n + (b - a + 1), 0) || 1
const grow = new Map<number, number>()
grow.set(bands[0][1], Math.round(extra * 0.25))
let handed = Math.round(extra * 0.25)
insideBands.forEach(([a, b], i) => {
  const share =
    i === insideBands.length - 1
      ? extra - handed
      : Math.round(((b - a + 1) / insideRoom) * (extra - Math.round(extra * 0.25)))
  grow.set(b, share)
  handed += share
})

const spaced = new PNG({ width: source.width, height: wantTall })
let write = 0
for (let y = 0; y < source.height; y++) {
  for (let x = 0; x < source.width; x++) {
    const from = (y * source.width + x) * 4
    const to = (write * source.width + x) * 4
    spaced.data[to] = source.data[from]
    spaced.data[to + 1] = source.data[from + 1]
    spaced.data[to + 2] = source.data[from + 2]
    spaced.data[to + 3] = 255
  }
  write++
  const add = grow.get(y) ?? 0
  if (add) {
    // Flat, not a copy of the row.
    //
    // The row looks blank but is not uniform — the background runs 253 to 255
    // across it — and copying it a few hundred times turns that into vertical
    // streaks a foot long. Its own average, laid down flat, has no structure
    // to stretch.
    const flat = flatColour(source, y)
    for (let n = 0; n < add && write < wantTall; n++) {
      for (let x = 0; x < source.width; x++) {
        const to = (write * source.width + x) * 4
        spaced.data[to] = flat[0]
        spaced.data[to + 1] = flat[1]
        spaced.data[to + 2] = flat[2]
        spaced.data[to + 3] = 255
      }
      write++
    }
  }
}
// Rounding can leave a row or two short; the top gap absorbs it rather than
// the bottom, where the photograph is.
if (write < wantTall) {
  const flat = flatColour(source, bands[0][1])
  const shift = wantTall - write
  spaced.data.copyWithin(shift * source.width * 4, 0, write * source.width * 4)
  for (let y = 0; y < shift; y++)
    for (let x = 0; x < source.width; x++) {
      const to = (y * source.width + x) * 4
      spaced.data[to] = flat[0]
      spaced.data[to + 1] = flat[1]
      spaced.data[to + 2] = flat[2]
      spaced.data[to + 3] = 255
    }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khapee-banner-'))
const big = path.join(tmp, 'big.png')
fs.writeFileSync(big, PNG.sync.write(spaced))
execFileSync('sips', ['--resampleWidth', String(pxWide), big], { stdio: 'ignore' })
const sheet = PNG.sync.read(fs.readFileSync(big))

// --- the code, drawn again rather than enlarged ------------------------------
const at = (x: number, y: number) => {
  const i = (y * pxWide + x) * 4
  return [sheet.data[i], sheet.data[i + 1], sheet.data[i + 2]]
}
const tan = (c: number[]) => c[0] > 125 && c[0] < 225 && c[1] < c[0] - 25 && c[2] < c[1] + 12

/** The frame around the code, found by its colour in the enlarged sheet. */
function frame() {
  const mid = Math.round(pxWide / 2)
  const bands: number[] = []
  for (let y = 0; y < pxTall; y++) if (tan(at(mid, y))) bands.push(y)
  for (let i = 0; i < bands.length - 1; i++) {
    const a = bands[i]
    const b = bands[i + 1]
    if (b - a < pxWide * 0.15) continue
    let dark = 0
    for (let y = a; y < b; y++) {
      const c = at(mid, y)
      if (c[0] < 110 && c[1] < 110 && c[2] < 110) dark++
    }
    if (dark <= (b - a) * 0.2) continue
    const row = Math.round((a + b) / 2)
    const cols: number[] = []
    for (let x = 0; x < pxWide; x++) if (tan(at(x, row))) cols.push(x)
    let t = a
    while (t < b && tan(at(mid, t))) t++
    let bo = b
    while (bo > a && tan(at(mid, bo))) bo--
    let l = cols[0]
    while (l < cols[cols.length - 1] && tan(at(l, row))) l++
    let r = cols[cols.length - 1]
    while (r > cols[0] && tan(at(r, row))) r--
    return { x0: l, y0: t, x1: r, y1: bo }
  }
  throw new Error('could not find the code frame in the enlarged artwork')
}

const box = frame()
const boxW = box.x1 - box.x0 + 1
const boxH = box.y1 - box.y0 + 1
for (let y = box.y0; y <= box.y1; y++)
  for (let x = box.x0; x <= box.x1; x++) {
    const i = (y * pxWide + x) * 4
    sheet.data[i] = 255
    sheet.data[i + 1] = 255
    sheet.data[i + 2] = 255
  }

const side = Math.min(boxW, boxH) - Math.round(pxWide * 0.006)
const qrFile = path.join(tmp, 'qr.png')
await QRCode.toFile(qrFile, target, {
  errorCorrectionLevel: 'H',
  margin: 4,
  width: side,
  color: { dark: '#111111', light: '#ffffff' },
})
const qr = PNG.sync.read(fs.readFileSync(qrFile))
const qx = box.x0 + Math.round((boxW - qr.width) / 2)
const qy = box.y0 + Math.round((boxH - qr.height) / 2)
for (let y = 0; y < qr.height; y++)
  for (let x = 0; x < qr.width; x++) {
    const from = (y * qr.width + x) * 4
    const to = ((qy + y) * pxWide + qx + x) * 4
    sheet.data[to] = qr.data[from]
    sheet.data[to + 1] = qr.data[from + 1]
    sheet.data[to + 2] = qr.data[from + 2]
  }

// --- only ship it if the code reads -----------------------------------------
const pad = Math.round(pxWide * 0.02)
const winSide = qr.width + pad * 2
const win = new Uint8ClampedArray(winSide * winSide * 4)
for (let y = 0; y < winSide; y++)
  for (let x = 0; x < winSide; x++) {
    const from = ((qy - pad + y) * pxWide + (qx - pad + x)) * 4
    const to = (y * winSide + x) * 4
    win[to] = sheet.data[from]
    win[to + 1] = sheet.data[from + 1]
    win[to + 2] = sheet.data[from + 2]
    win[to + 3] = 255
  }
const read = jsQR(win, winSide, winSide)
if (read?.data !== target) {
  console.error(`\n  The code does not read back (${read?.data ?? 'nothing read'}). Not written.\n`)
  process.exit(1)
}

const out = path.resolve(
  path.dirname(src),
  `khapee-banner-${feetWide}x${feetTall}ft-${dpi}dpi.png`,
)
fs.writeFileSync(out, PNG.sync.write(sheet))
fs.rmSync(tmp, { recursive: true, force: true })

console.log(`
  ${path.relative(process.cwd(), out)}

    ${pxWide} × ${pxTall} for ${feetWide}ft × ${feetTall}ft at ${dpi} dpi
    ${(fs.statSync(out).size / 1e6).toFixed(1)} MB
    the code is drawn at full size and scans as ${read.data}
    everything else is your artwork, respaced into ${bands.length} existing gaps and enlarged ${(pxWide / source.width).toFixed(1)}×
`)
