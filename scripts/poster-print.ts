/**
 * The Khapee poster at any size, drawn rather than enlarged.
 *
 *   npx tsx scripts/poster-print.ts              3ft × 6ft
 *   npx tsx scripts/poster-print.ts 2 3 300      2ft × 3ft at 300dpi
 *
 * The poster that came out of the design tool is 1024 pixels across. Printed
 * three feet wide that is 28 dots to the inch, which is a blurred photograph
 * of a poster rather than a poster — and no amount of upscaling invents detail
 * that was never captured. So it is drawn again here as vector: shapes and
 * text with no resolution of their own, which are exactly as sharp at six feet
 * as at six inches.
 *
 * Two files come out. The SVG is the real artwork and is what a print shop
 * should be given. The PNG is rendered here at the requested dpi so the text
 * is already drawn in the fonts this machine has — which is the usual way an
 * SVG goes wrong at a print shop that does not have them.
 *
 * The photograph in the corner of the original is deliberately not here. It
 * was a few hundred pixels wide; at this size it would be the one soft thing
 * on an otherwise sharp poster, which is worse than an honest empty corner.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import QRCode from 'qrcode'

/**
 * The photograph from the original artwork, if it is there to take.
 *
 * Everything else on this page is drawn and therefore sharp at any size. A
 * photograph cannot be — it has the resolution it was captured at — so it is
 * the one element enlarged rather than redrawn, and it is put in the corner
 * where it bleeds off two edges, which is where softness is least visible.
 */
function pastaFromOriginal(file: string): { href: string; ratio: number } | null {
  if (!fs.existsSync(file)) return null
  const art = PNG.sync.read(fs.readFileSync(file))
  // Under the last line of type, to the right: the bowl and nothing else.
  const x0 = Math.round(art.width * 0.407)
  const y0 = Math.round(art.height * 0.9)
  const w = art.width - x0
  const h = art.height - y0
  if (w < 40 || h < 40) return null
  const crop = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const from = ((y + y0) * art.width + (x + x0)) * 4
      const to = (y * w + x) * 4
      crop.data[to] = art.data[from]
      crop.data[to + 1] = art.data[from + 1]
      crop.data[to + 2] = art.data[from + 2]
      crop.data[to + 3] = 255
    }
  return {
    href: `data:image/png;base64,${PNG.sync.write(crop).toString('base64')}`,
    ratio: w / h,
  }
}

const feetWide = Number(process.argv[2] ?? 3)
const feetTall = Number(process.argv[3] ?? 6)
const dpi = Number(process.argv[4] ?? 150)
const target = process.env.KHAPEE_SITE ?? 'https://khapee.com'
const photoFrom = process.env.KHAPEE_ARTWORK ?? 'data/qr/khapee-poster.png'
const host = target.replace(/^https?:\/\//, '').replace(/\/$/, '')

// One unit is a thousandth of the width, so the layout below reads the same
// whatever it is printed at.
const W = 1000
const H = Math.round((W * feetTall) / feetWide)

const INK = '#141210'
const LINE = '#a8785a'
const MUTED = '#6f6a66'
const PAPER = '#ffffff'

const SERIF = "Didot, 'Bodoni 72', 'Playfair Display', Georgia, serif"
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const SCRIPT = "'Snell Roundhand', 'Savoye LET', 'Brush Script MT', cursive"

/** The code itself, as paths, so it is a shape and not a picture of one. */
const qrSvg = await QRCode.toString(target, {
  type: 'svg',
  errorCorrectionLevel: 'H',
  margin: 0,
  color: { dark: INK, light: PAPER },
})
const qrGrid = Number(qrSvg.match(/viewBox="0 0 (\d+)/)?.[1] ?? 0)
const qrInner = qrSvg.slice(qrSvg.indexOf('>', qrSvg.indexOf('<svg')) + 1, qrSvg.lastIndexOf('</svg>'))

/**
 * The line-art marks around the edge. Each is drawn in its own hundred-unit
 * box and placed, so one can be moved or resized without redrawing it.
 */
const MARKS: Record<string, string> = {
  pizza: `
    <path d="M50 8 L86 82 Q50 96 14 82 Z"/>
    <path d="M19 74 Q50 87 81 74"/>
    <circle cx="42" cy="44" r="4"/><circle cx="59" cy="57" r="4"/><circle cx="40" cy="65" r="3"/>`,
  burger: `
    <path d="M14 46 a36 24 0 0 1 72 0"/>
    <path d="M12 54 q9 7 18 0 t18 0 t18 0 t18 0"/>
    <path d="M14 63 h72"/>
    <path d="M16 70 h68 a11 11 0 0 1 -11 13 H27 a11 11 0 0 1 -11 -13 Z"/>`,
  coffee: `
    <path d="M22 44 h48 v20 a24 24 0 0 1 -48 0 Z"/>
    <path d="M70 48 a13 13 0 0 1 0 22"/>
    <path d="M14 76 h64"/>
    <path d="M38 34 q7 -9 0 -18"/><path d="M50 32 q7 -9 0 -18"/><path d="M62 34 q7 -9 0 -18"/>`,
  noodles: `
    <path d="M14 54 h68 a34 34 0 0 1 -68 0 Z"/>
    <path d="M28 52 q8 -15 21 -11 q13 4 21 -7"/>
    <path d="M60 24 L92 50"/><path d="M66 17 L96 43"/>`,
  cone: `
    <circle cx="50" cy="31" r="20"/>
    <path d="M32 45 L68 45 L50 96 Z"/>
    <path d="M39 54 L58 78"/><path d="M49 52 L64 70"/>
    <path d="M61 54 L43 78"/><path d="M51 52 L38 68"/>`,
}

/** `at` is the centre, `size` the width of that hundred-unit box. */
function mark(name: string, at: [number, number], size: number, tilt = 0, weight = 3.2): string {
  const s = size / 100
  return `<g transform="translate(${at[0] - size / 2} ${at[1] - size / 2}) scale(${s}) rotate(${tilt} 50 50)"
    fill="none" stroke="${LINE}" stroke-width="${weight / s}" stroke-linecap="round" stroke-linejoin="round">
    ${MARKS[name]}
  </g>`
}

// --- the page ---------------------------------------------------------------
const mid = W / 2
const logo = W * 0.26
const logoTop = H * 0.045
const qrBox = W * 0.62
const qrTop = H * 0.35

/**
 * Text with its width decided here rather than by the font.
 *
 * A print shop without Didot substitutes something wider and the wordmark runs
 * off the page; textLength pins it, so the worst a substitution can do is look
 * slightly different rather than break the layout.
 */
const line = (
  text: string,
  y: number,
  size: number,
  width: number,
  opts: { family?: string; fill?: string; weight?: string; track?: number } = {},
) =>
  `<text x="${mid}" y="${y}" text-anchor="middle" textLength="${width}" lengthAdjust="spacingAndGlyphs"
         font-family="${opts.family ?? SANS}" font-size="${size}" fill="${opts.fill ?? INK}"
         ${opts.weight ? `font-weight="${opts.weight}"` : ''}
         ${opts.track ? `letter-spacing="${opts.track}"` : ''}>${text}</text>`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"
     width="${feetWide * 12}in" height="${feetTall * 12}in">
  <rect width="${W}" height="${H}" fill="${PAPER}"/>

  <!-- the mark: a rounded square with a hole, which is the app icon -->
  <path fill="${INK}" fill-rule="evenodd"
        d="M${mid - logo / 2} ${logoTop + logo * 0.28}
           a${logo * 0.28} ${logo * 0.28} 0 0 1 ${logo * 0.28} -${logo * 0.28}
           h${logo * 0.44} a${logo * 0.28} ${logo * 0.28} 0 0 1 ${logo * 0.28} ${logo * 0.28}
           v${logo * 0.44} a${logo * 0.28} ${logo * 0.28} 0 0 1 -${logo * 0.28} ${logo * 0.28}
           h-${logo * 0.44} a${logo * 0.28} ${logo * 0.28} 0 0 1 -${logo * 0.28} -${logo * 0.28} Z
           M${mid} ${logoTop + logo * 0.27}
           a${logo * 0.185} ${logo * 0.185} 0 1 0 0.01 0 Z"/>

  ${line('Khapee', logoTop + logo + H * 0.058, W * 0.2, W * 0.74, { family: SERIF })}

  <!-- the code, in a frame, with its quiet zone inside it -->
  <rect x="${mid - qrBox / 2}" y="${qrTop}" width="${qrBox}" height="${qrBox}"
        rx="${qrBox * 0.06}" fill="${PAPER}" stroke="${LINE}" stroke-width="${W * 0.009}"/>
  <g transform="translate(${mid - qrBox * 0.42} ${qrTop + qrBox * 0.08}) scale(${(qrBox * 0.84) / qrGrid})">${qrInner}</g>

  ${line('Scan. Order. Pay.', qrTop + qrBox + H * 0.05, W * 0.082, W * 0.56, { weight: '600' })}
  ${line('Through Khapee.', qrTop + qrBox + H * 0.086, W * 0.06, W * 0.4, { fill: LINE })}
  <path d="M${mid - W * 0.06} ${qrTop + qrBox + H * 0.112} H${mid + W * 0.06}"
        stroke="${INK}" stroke-width="${W * 0.005}" stroke-linecap="round"/>

  ${line('Kuch Khapee lo', qrTop + qrBox + H * 0.175, W * 0.135, W * 0.62, { family: SCRIPT, fill: LINE })}
  <path d="M${mid - W * 0.1} ${qrTop + qrBox + H * 0.191} q${W * 0.1} ${H * 0.009} ${W * 0.2} -${H * 0.003}"
        fill="none" stroke="${LINE}" stroke-width="${W * 0.006}" stroke-linecap="round"/>

  ${line(host, H * 0.9, W * 0.045, W * 0.3, { track: W * 0.004 })}
  ${(() => {
    const pasta = pastaFromOriginal(photoFrom)
    if (!pasta) return ''
    const w = W * 0.88
    const h = w / pasta.ratio
    // Bleeding off the right and bottom edges, the way it does on the original.
    return `<image href="${pasta.href}" x="${W - w + W * 0.08}" y="${H - h + H * 0.012}"
                   width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
  })()}

  <!-- the line at the top corner -->
  ${['GOOD', 'FOOD', 'LESS', 'WAIT']
    .map(
      (word, i) =>
        `<text x="${W * 0.93}" y="${H * 0.03 + i * H * 0.019}" text-anchor="end" font-family="${SANS}"
               font-size="${W * 0.026}" letter-spacing="${W * 0.007}" fill="${MUTED}">${word}</text>`,
    )
    .join('\n  ')}
  <path d="M${W * 0.87} ${H * 0.107} H${W * 0.93}" stroke="${LINE}" stroke-width="${W * 0.003}"/>

  <!-- Down the margins, clear of the type. The burger sat at the wordmark's
       own height and the last "e" of Khapee ran into it. -->
  ${mark('pizza', [W * 0.12, H * 0.105], W * 0.13, -14)}
  ${mark('burger', [W * 0.89, H * 0.3], W * 0.14, 0)}
  ${mark('coffee', [W * 0.1, H * 0.4], W * 0.15, -6)}
  ${mark('noodles', [W * 0.91, H * 0.6], W * 0.15, 0)}
  ${mark('cone', [W * 0.095, H * 0.775], W * 0.12, -8)}

  <!-- the little marks either side of the code -->
  <g stroke="${LINE}" stroke-width="${W * 0.007}" stroke-linecap="round">
    <path d="M${W * 0.24} ${qrTop + qrBox * 0.14} l${W * 0.035} ${W * 0.026}"/>
    <path d="M${W * 0.235} ${qrTop + qrBox * 0.3} l${W * 0.04} -${W * 0.012}"/>
    <path d="M${W * 0.725} ${qrTop + qrBox * 0.74} l${W * 0.04} ${W * 0.012}"/>
    <path d="M${W * 0.73} ${qrTop + qrBox * 0.88} l${W * 0.035} -${W * 0.026}"/>
  </g>
</svg>
`

const outDir = path.resolve(import.meta.dirname, '..', 'data', 'qr')
fs.mkdirSync(outDir, { recursive: true })
const base = `khapee-poster-${feetWide}x${feetTall}ft`
const svgFile = path.join(outDir, `${base}.svg`)
fs.writeFileSync(svgFile, svg)

// --- and a raster of it, at the size it will actually be printed ------------
//
// Rendered in square tiles and stitched. The renderer on this machine draws an
// SVG into a square frame and crops whatever does not fit, so a poster twice
// as tall as it is wide came back as its own top half — and the code, being in
// the middle, was cut in two.
const tileUnits = W
const tiles = Math.ceil(H / tileUnits)
const tilePx = Math.round((feetWide * 12 * dpi))
const pxWide = tilePx
const pxTall = Math.round((tilePx * H) / W)

let pngFile = ''
try {
  const sheet = new PNG({ width: pxWide, height: pxTall })
  for (let i = 0; i < tiles; i++) {
    const top = i * tileUnits
    const slice = svg.replace(
      /viewBox="0 0 [\d.]+ [\d.]+"[^>]*>/,
      `viewBox="0 ${top} ${W} ${tileUnits}" width="${tilePx}" height="${tilePx}">`,
    )
    const sliceFile = path.join(outDir, `.tile-${i}.svg`)
    fs.writeFileSync(sliceFile, slice)
    execFileSync('qlmanage', ['-t', '-s', String(tilePx), '-o', outDir, sliceFile], { stdio: 'ignore' })
    const made = path.join(outDir, `.tile-${i}.svg.png`)
    if (!fs.existsSync(made)) throw new Error('tile did not render')
    const part = PNG.sync.read(fs.readFileSync(made))
    for (let y = 0; y < part.height; y++) {
      const intoY = i * tilePx + y
      if (intoY >= pxTall) break
      for (let x = 0; x < Math.min(part.width, pxWide); x++) {
        const from = (y * part.width + x) * 4
        const to = (intoY * pxWide + x) * 4
        sheet.data[to] = part.data[from]
        sheet.data[to + 1] = part.data[from + 1]
        sheet.data[to + 2] = part.data[from + 2]
        sheet.data[to + 3] = 255
      }
    }
    fs.rmSync(sliceFile, { force: true })
    fs.rmSync(made, { force: true })
  }
  pngFile = path.join(outDir, `${base}-${dpi}dpi.png`)
  fs.writeFileSync(pngFile, PNG.sync.write(sheet))
} catch {
  /* no renderer here: the vector is the deliverable */
}

// The code has to survive being redrawn at this size, so it is read back.
let scans = 'not checked'
if (pngFile) {
  const png = PNG.sync.read(fs.readFileSync(pngFile))
  // Read back from a crop around the frame, not the whole sheet. A decoder
  // handed a six-foot page finds nothing, because the code is a small part of
  // it — which is a limit of the checker, not of the artwork. A phone is
  // pointed at the code.
  const cx = Math.round(png.width * (0.5 - qrBox / W / 2) - png.width * 0.03)
  const cy = Math.round(png.height * (qrTop / H) - png.width * 0.03)
  const side = Math.round(png.width * (qrBox / W) + png.width * 0.06)
  const win = new Uint8ClampedArray(side * side * 4)
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const from = ((y + cy) * png.width + (x + cx)) * 4
      const to = (y * side + x) * 4
      win[to] = png.data[from]
      win[to + 1] = png.data[from + 1]
      win[to + 2] = png.data[from + 2]
      win[to + 3] = 255
    }
  const hit = jsQR(win, side, side)
  scans = hit?.data === target ? `scans as ${hit.data}` : `DOES NOT SCAN (${hit?.data ?? 'nothing read'})`
  if (hit?.data !== target) {
    console.error(
      `\n  The code does not read back (${hit?.data ?? 'nothing read'}).` +
        ` Sheet is ${png.width}×${png.height}. Left at ${path.relative(process.cwd(), pngFile)} to look at.\n`,
    )
    process.exit(1)
  }
  console.log(
    `\n  ${feetWide}ft × ${feetTall}ft\n\n` +
      `    ${path.relative(process.cwd(), svgFile)}\n` +
      `      vector — give this to the printer, it has no resolution to lose\n` +
      `    ${path.relative(process.cwd(), pngFile)}\n` +
      `      ${png.width} × ${png.height} at ${dpi}dpi, ${(fs.statSync(pngFile).size / 1e6).toFixed(1)} MB, ${scans}\n`,
  )
} else {
  console.log(`\n  ${path.relative(process.cwd(), svgFile)} — vector only, no renderer on this machine\n`)
}
