/**
 * The QR for Khapee itself — the one that goes on a poster, a flyer, a card
 * by the till, or an Instagram story.
 *
 *   npx tsx scripts/site-qr.ts
 *   npx tsx scripts/site-qr.ts https://khapee.com/r/14   # straight to Revery
 *
 * Writes three things to data/qr/, because they get used differently:
 *
 *   <name>.png        the bare code, 1400px, nothing around it but its quiet
 *                     zone — for dropping into someone else's design
 *   <name>-card.svg   a card with the address written under the code, as
 *                     vector, which is what a print shop wants
 *   <name>-card.png   the same card as an image, which is what everything
 *                     else wants: WhatsApp, a phone gallery, a slide
 *
 * PNG and not only SVG on purpose. An SVG sent to a phone previews as a blank
 * square in most galleries, and a QR nobody can see is a QR nobody scans.
 *
 * The quiet zone is four modules, which is the spec. It was one here once and
 * the codes read fine on a good camera and failed on a cheap one held at an
 * angle, which is exactly the phone a customer has.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'

const target = process.argv[2] ?? process.env.KHAPEE_SITE ?? 'https://khapee.com'
const host = target.replace(/^https?:\/\//, '').replace(/\/$/, '')
const name = host.replace(/[^a-z0-9]+/gi, '-').toLowerCase()

const outDir = path.resolve(import.meta.dirname, '..', 'data', 'qr')
fs.mkdirSync(outDir, { recursive: true })

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** High correction: a printed code gets creased, taped and photographed badly. */
const OPTS = { errorCorrectionLevel: 'H' as const, color: { dark: '#111111', light: '#ffffff' } }

const bare = path.join(outDir, `${name}.png`)
await QRCode.toFile(bare, target, { ...OPTS, margin: 4, width: 1400 })

/** The code's own drawing, and the grid it was drawn against, so it can be
 *  placed on a card at any size without guessing. */
const svg = await QRCode.toString(target, { ...OPTS, type: 'svg', margin: 0 })
const size = Number(svg.match(/viewBox="0 0 (\d+)/)?.[1] ?? 0)
const inner = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'))

// Square on purpose. macOS renders a thumbnail into a square frame and crops
// whatever does not fit, so a tall card came out with the bottom third of the
// code sliced off — an image that looks like a QR and scans as nothing.
const W = 340
const H = 340
const box = 196
const card = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${W / 2}" y="46" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="30" fill="#111111">Khapee</text>
  <text x="${W / 2}" y="68" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="11" letter-spacing="1.6" fill="#777777">SCAN TO ORDER</text>
  <g transform="translate(${(W - box) / 2}, 86) scale(${box / size})">${inner}</g>
  <text x="${W / 2}" y="316" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" letter-spacing="2.2" fill="#555555">${escape(host)}</text>
</svg>
`
const cardSvg = path.join(outDir, `${name}-card.svg`)
fs.writeFileSync(cardSvg, card)

// macOS renders the card to an image without a toolchain. If it is not there —
// another machine, a CI box — the vector is still written and still prints.
let cardPng = ''
try {
  execFileSync('qlmanage', ['-t', '-s', '1200', '-o', outDir, cardSvg], { stdio: 'ignore' })
  const made = path.join(outDir, `${name}-card.svg.png`)
  if (fs.existsSync(made)) {
    cardPng = path.join(outDir, `${name}-card.png`)
    fs.renameSync(made, cardPng)
  }
} catch {
  /* no qlmanage: the SVG is the deliverable */
}

const rel = (f: string) => path.relative(process.cwd(), f)
console.log(`
  ${target}

    ${rel(bare)}         the code on its own
    ${rel(cardSvg)}   a card, vector, for printing${cardPng ? `\n    ${rel(cardPng)}   the same card as an image` : ''}
`)
