/**
 * Puts the real Khapee QR into the poster, and swaps the block of small text
 * on the left for one more of its line-art icons.
 *
 *   npx tsx scripts/poster-qr.ts <poster.png> [out.png]
 *
 * The poster came back from a design tool with a QR-shaped pattern in it
 * rather than a QR — the right size, the right corners, and it decodes to
 * nothing. Nobody notices that by looking, which is the danger: it is the one
 * element on the page whose entire job is to be machine-read, and it is the
 * one element a person cannot check by eye.
 *
 * So the code is regenerated properly and pasted in, and the result is decoded
 * back at the end. If the check fails, nothing is written.
 *
 * Everything is measured off the poster rather than hard-coded, so a reissued
 * poster at another size still works: the tan rounded border is found by
 * colour, and the text block by looking for ink in the left margin.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import QRCode from 'qrcode'

const src = process.argv[2]
const out = process.argv[3] ?? path.join(path.dirname(src ?? '.'), 'khapee-poster.png')
const target = process.env.KHAPEE_SITE ?? 'https://khapee.com'
if (!src || !fs.existsSync(src)) {
  console.error('\n  Usage: npx tsx scripts/poster-qr.ts <poster.png> [out.png]\n')
  process.exit(1)
}

const png = PNG.sync.read(fs.readFileSync(src))
const W = png.width
const H = png.height
const at = (x: number, y: number) => {
  const i = (y * W + x) * 4
  return [png.data[i], png.data[i + 1], png.data[i + 2]]
}
const put = (x: number, y: number, r: number, g: number, b: number) => {
  const i = (y * W + x) * 4
  png.data[i] = r
  png.data[i + 1] = g
  png.data[i + 2] = b
  png.data[i + 3] = 255
}
const ink = (c: number[]) => c[0] < 245 || c[1] < 245 || c[2] < 245
/** The warm brown the icons and the QR frame are drawn in. */
const tan = (c: number[]) => c[0] > 125 && c[0] < 225 && c[1] < c[0] - 25 && c[2] < c[1] + 12

// --- Where the QR frame is ---------------------------------------------------
// Widest run of frame colour, scanning down the middle, is the box's own border.
function frameBounds() {
  const mid = Math.round(W / 2)
  const vertical: number[] = []
  for (let y = 0; y < H; y++) if (tan(at(mid, y))) vertical.push(y)
  if (vertical.length < 4) throw new Error('no QR frame found on this poster')
  // The frame is the first pair of bands with a lot of dark between them.
  let top = -1
  let bottom = -1
  for (let i = 0; i < vertical.length - 1; i++) {
    const a = vertical[i]
    const b = vertical[i + 1]
    if (b - a < 150) continue
    let dark = 0
    for (let y = a; y < b; y++) {
      const c = at(mid, y)
      if (c[0] < 110 && c[1] < 110 && c[2] < 110) dark++
    }
    if (dark > (b - a) * 0.2) { top = a; bottom = b; break }
  }
  if (top < 0) throw new Error('could not tell the QR frame from the decorations')
  const row = Math.round((top + bottom) / 2)
  const cols: number[] = []
  for (let x = 0; x < W; x++) if (tan(at(x, row))) cols.push(x)
  const left = cols[0]
  const right = cols[cols.length - 1]
  // Step past the border's own thickness to the white inside it.
  let t = top
  while (t < bottom && tan(at(mid, t))) t++
  let b2 = bottom
  while (b2 > top && tan(at(mid, b2))) b2--
  let l = left
  while (l < right && tan(at(l, row))) l++
  let r = right
  while (r > left && tan(at(r, row))) r--
  return { x0: l, y0: t, x1: r, y1: b2 }
}

const box = frameBounds()
const boxW = box.x1 - box.x0 + 1
const boxH = box.y1 - box.y0 + 1
console.log(`  QR frame inside edge: ${boxW}×${boxH} at ${box.x0},${box.y0}`)

// Wipe whatever was in there, including any smudge the design tool left.
for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) put(x, y, 255, 255, 255)

// --- The real code -----------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khapee-poster-'))
const side = Math.min(boxW, boxH) - 12
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
    const i = (y * qr.width + x) * 4
    put(qx + x, qy + y, qr.data[i], qr.data[i + 1], qr.data[i + 2])
  }
console.log(`  code placed: ${qr.width}×${qr.height} at ${qx},${qy}`)

// --- The block of small text on the left ------------------------------------
// Found rather than assumed: ink in the left margin, below the QR and above
// the script line, is that block and nothing else.
function leftBlock() {
  // Only the outer fifth of the page. The script line below reaches further in
  // than the text block does with the tail of its first letter, and a wider
  // column took that tail as part of the block and erased the letter with it.
  const margin = Math.round(W * 0.2)
  const from = box.y1 + Math.round(H * 0.04)
  const to = Math.round(H * 0.84)

  const rows: number[] = []
  for (let y = from; y < to; y++)
    for (let x = 0; x < margin; x++)
      if (ink(at(x, y))) { rows.push(y); break }
  if (!rows.length) return null

  // Lines of a block sit a few pixels apart; anything further down is a
  // different thing that happens to share the column.
  let last = rows[0]
  const run: number[] = []
  for (const y of rows) {
    if (y - last > 40) break
    run.push(y)
    last = y
  }

  let x0 = W
  let x1 = -1
  for (const y of run)
    for (let x = 0; x < margin; x++)
      if (ink(at(x, y))) { if (x < x0) x0 = x; if (x > x1) x1 = x }
  return { x0, y0: run[0], x1, y1: run[run.length - 1] }
}

const block = leftBlock()
if (!block) {
  console.log('  no text block on the left to replace')
} else {
  console.log(`  left text: ${block.x1 - block.x0 + 1}×${block.y1 - block.y0 + 1} at ${block.x0},${block.y0}`)
  const pad = 8
  for (let y = block.y0 - pad; y <= block.y1 + pad; y++)
    for (let x = Math.max(0, block.x0 - pad); x <= block.x1 + pad; x++) put(x, y, 255, 255, 255)

  // A fifth icon in the same family as the pizza, burger, coffee and noodles:
  // line art, one weight, the same warm brown, no fill.
  const line = '#956e52'
  // Square, because macOS renders a thumbnail into a square frame and squashes
  // anything that is not — the first attempt came out a third of the size it
  // asked for, letterboxed inside its own white.
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 130" width="130" height="130">
  <rect width="130" height="130" fill="#ffffff"/>
  <!-- Leaning a few degrees, like the pizza slice and the coffee cup do. Upright
       among them looks like it was dropped in rather than drawn with them. -->
  <g transform="rotate(-8 65 70)" stroke="${line}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <!-- An ice cream cone, and not the fries that were here before: thin
         strokes rising out of a tapered tub read as a plant in a pot no matter
         how they are drawn, and an icon you have to explain is the wrong icon.
         A cone's silhouette cannot be mistaken for anything else. -->
    <circle cx="65" cy="40" r="26" fill="#ffffff"/>
    <path d="M41 58 L89 58 L65 124 Z" fill="#ffffff"/>
    <g stroke-width="2.6">
      <path d="M50 70 L74 100"/>
      <path d="M63 68 L82 90"/>
      <path d="M79 70 L56 100"/>
      <path d="M66 68 L49 88"/>
    </g>
  </g>
</svg>
`
  const iconSvg = path.join(tmp, 'icon.svg')
  fs.writeFileSync(iconSvg, icon)
  execFileSync('qlmanage', ['-t', '-s', '520', '-o', tmp, iconSvg], { stdio: 'ignore' })
  const rendered = path.join(tmp, 'icon.svg.png')
  if (fs.existsSync(rendered)) {
    const art = PNG.sync.read(fs.readFileSync(rendered))
    // Measured off the drawing rather than the canvas it came back on. The
    // renderer pads an SVG inside a square thumbnail by an amount it does not
    // tell you, so scaling by the canvas produced an icon a third the size
    // asked for.
    let ax0 = art.width
    let ay0 = art.height
    let ax1 = -1
    let ay1 = -1
    for (let y = 0; y < art.height; y++)
      for (let x = 0; x < art.width; x++) {
        const i = (y * art.width + x) * 4
        if ((art.data[i] + art.data[i + 1] + art.data[i + 2]) / 3 < 235) {
          if (x < ax0) ax0 = x
          if (x > ax1) ax1 = x
          if (y < ay0) ay0 = y
          if (y > ay1) ay1 = y
        }
      }
    const artW = ax1 - ax0 + 1
    const artH = ay1 - ay0 + 1

    // Sized to the neighbours: the coffee cup and the noodle bowl are about a
    // seventh of the page tall, and an icon here that is smaller reads as a
    // mistake rather than a member of the set.
    const targetH = Math.round(H * 0.092)
    const targetW = Math.round((targetH * artW) / artH)
    const ix = Math.round((block.x0 + block.x1) / 2 - targetW / 2)
    const iy = Math.round((block.y0 + block.y1) / 2 - targetH / 2)

    // Drawn as coverage rather than pasted as a block: the stroke's own
    // anti-aliasing becomes its opacity, so no white square shows against a
    // page that is not quite white.
    const rgb = [0x95, 0x6e, 0x52]
    for (let y = 0; y < targetH; y++)
      for (let x = 0; x < targetW; x++) {
        const sx = ax0 + Math.min(artW - 1, Math.floor((x * artW) / targetW))
        const sy = ay0 + Math.min(artH - 1, Math.floor((y * artH) / targetH))
        const i = (sy * art.width + sx) * 4
        const lum = (art.data[i] + art.data[i + 1] + art.data[i + 2]) / 3
        const a = Math.max(0, Math.min(1, (250 - lum) / 190))
        if (a <= 0.01) continue
        const dst = at(ix + x, iy + y)
        put(
          ix + x,
          iy + y,
          Math.round(rgb[0] * a + dst[0] * (1 - a)),
          Math.round(rgb[1] * a + dst[1] * (1 - a)),
          Math.round(rgb[2] * a + dst[2] * (1 - a)),
        )
      }
    console.log(`  icon drawn ${targetW}×${targetH} at ${ix},${iy}`)
  }
}

// --- Only ship it if it reads ------------------------------------------------
const finished = PNG.sync.write(png)
const check = PNG.sync.read(finished)
const read = jsQR(new Uint8ClampedArray(check.data), check.width, check.height)
if (read?.data !== target) {
  console.error(`\n  The finished poster does not scan (${read?.data ?? 'nothing read'}). Not written.\n`)
  process.exit(1)
}
fs.writeFileSync(out, finished)
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n  ${path.relative(process.cwd(), out)} — scans back as ${read.data}\n`)
