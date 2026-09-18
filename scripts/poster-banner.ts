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
 * Two things are done properly rather than enlarged. The page is 2:3 and a
 * 3×6 banner is 1:2, so the artwork is set against the bottom edge — where
 * the photograph is anchored — and the extra height becomes margin above,
 * rather than the whole thing being stretched out of proportion. And the QR
 * is thrown away and drawn again at full size, because it is the one element
 * that has to be exact: a blurred code is a code that does not scan, and it
 * is the only part of a poster a person cannot check by looking at it.
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

// sips resamples far better than anything written here would, and it is on
// every Mac.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khapee-banner-'))
const big = path.join(tmp, 'big.png')
fs.copyFileSync(src, big)
execFileSync('sips', ['--resampleWidth', String(pxWide), big], { stdio: 'ignore' })

const art = PNG.sync.read(fs.readFileSync(big))
if (art.height > pxTall) {
  console.error(`\n  ${feetWide}×${feetTall} is taller than the artwork allows without cropping it.\n`)
  process.exit(1)
}

const sheet = new PNG({ width: pxWide, height: pxTall })
sheet.data.fill(255)

/**
 * Where the artwork sits in the taller page: hard against the bottom.
 *
 * The extra height was split, with the artwork's last row repeated downwards
 * to fill the bottom. One row of pixels stretched a foot is a row of vertical
 * streaks, and under a photograph of pasta it looked like the bowl was
 * dripping. There is nothing below the bowl to invent, so nothing is
 * invented — the bowl runs off the bottom edge where it belongs and the spare
 * height becomes margin above, which is what the top of a banner is for.
 */
const top = pxTall - art.height
for (let y = 0; y < art.height; y++)
  for (let x = 0; x < Math.min(art.width, pxWide); x++) {
    const from = (y * art.width + x) * 4
    const to = ((y + top) * pxWide + x) * 4
    sheet.data[to] = art.data[from]
    sheet.data[to + 1] = art.data[from + 1]
    sheet.data[to + 2] = art.data[from + 2]
    sheet.data[to + 3] = 255
  }
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
    everything else is the original artwork enlarged ${(pxWide / 1024).toFixed(1)}×
`)
