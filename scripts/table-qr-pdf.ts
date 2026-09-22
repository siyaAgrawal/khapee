/**
 * Every table's QR on one printable page, as a PDF.
 *
 *   npx tsx scripts/table-qr-pdf.ts cafe-vijay-bhaiya-saket-wale
 *
 * The HTML sheet beside this one is for reading on a screen; a print shop
 * wants a file. So this writes the PDF itself rather than screenshotting the
 * page: the codes are drawn as vector rectangles, which means they are exact
 * at any size a printer is set to — a rasterised QR blown up to a table tent
 * goes soft at the edges, and a soft edge is the difference between a code
 * that scans from across the table and one somebody gives up on.
 *
 * Written by hand rather than with a PDF library, because the whole of what
 * is needed here is rectangles and a handful of words in Helvetica, and both
 * are a few lines of the format. Nothing is installed to print a page.
 */
import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'
import { db } from '../server/db.ts'

const slug = process.argv[2] ?? 'revery'
const site = process.env.KHAPEE_SITE ?? 'https://khapee.com'

const restaurant = db.prepare('SELECT * FROM restaurants WHERE slug = ?').get(slug) as any
if (!restaurant) {
  console.error(`\n  No restaurant with slug "${slug}".\n`)
  process.exit(1)
}
const tables = db
  .prepare('SELECT label, seats, token FROM restaurant_tables WHERE restaurant_id = ? ORDER BY id')
  .all(restaurant.id) as any[]
if (!tables.length) {
  console.error(`\n  ${restaurant.name} has no tables. Add some: npx tsx scripts/tables.ts ${slug} 6\n`)
  process.exit(1)
}

/** A4, in points, which is the only unit PDF measures anything in. */
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 34

/**
 * Helvetica's built-in encoding is Latin-1, and this is a menu from Indore:
 * the restaurant's own name carries an em dash and its dishes carry curly
 * quotes. Rather than embed a font to say "—", say "-".
 */
function ascii(value: string): string {
  return String(value ?? '')
    .replace(/[—–]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e]/g, '')
}

/** Parentheses and backslashes end a string early if they are not escaped. */
function pdfText(value: string): string {
  return ascii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/** Helvetica's own widths, near enough to centre a line of text on a card. */
const WIDTH: Record<string, number> = {}
function textWidth(text: string, size: number): number {
  // Averaged rather than exact: this centres headings, and being a point out
  // on a table tent is invisible. Digits and capitals are wider than the mean.
  let units = 0
  for (const ch of ascii(text)) {
    units += WIDTH[ch] ?? (/[A-Z0-9]/.test(ch) ? 667 : /[ .,'ilj]/.test(ch) ? 300 : 556)
  }
  return (units / 1000) * size
}

const parts: string[] = []
const show = (text: string, size: number, bold: boolean, cx: number, y: number) => {
  const t = pdfText(text)
  const x = cx - textWidth(text, size) / 2
  parts.push(`BT /${bold ? 'FB' : 'FR'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${t}) Tj ET`)
}

/** How many across. Three is the most that leaves a code big enough to scan. */
const cols = tables.length <= 2 ? 1 : tables.length <= 6 ? 2 : 3
const rows = Math.ceil(tables.length / cols)
const cardW = (PAGE_W - MARGIN * 2) / cols
const cardH = (PAGE_H - MARGIN * 2 - 46) / rows

tables.forEach((table, i) => {
  const col = i % cols
  const row = Math.floor(i / cols)
  const left = MARGIN + col * cardW
  // PDF counts up from the bottom of the page; the cards read down from the
  // top, so the row index is subtracted rather than added.
  const top = PAGE_H - MARGIN - 46 - row * cardH
  const cx = left + cardW / 2

  // A hairline box, so whoever cuts these up has a line to cut along.
  parts.push(
    `0.8 G 0.5 w ${(left + 6).toFixed(2)} ${(top - cardH + 8).toFixed(2)} ${(cardW - 12).toFixed(2)} ${(cardH - 14).toFixed(2)} re S`,
  )

  show(restaurant.name, 9, false, cx, top - 22)
  show(table.label, 19, true, cx, top - 46)

  const url = `${site}/t/${table.token}`
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  // As large as the card allows, less room for the label above and the
  // address below. A code that fills its card is a code that scans standing up.
  const box = Math.min(cardW - 46, cardH - 104)
  const module = box / size
  const qrLeft = cx - box / 2
  const qrBottom = top - 62 - box

  parts.push('0 g')
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!qr.modules.get(y, x)) continue
      // Each dark module is one filled rectangle. Drawn a whisker over a
      // module wide so neighbours meet exactly: a printer that rounds each
      // edge independently otherwise leaves white hairlines through the code.
      const px = qrLeft + x * module
      const py = qrBottom + (size - 1 - y) * module
      parts.push(`${px.toFixed(3)} ${py.toFixed(3)} ${(module + 0.04).toFixed(3)} ${(module + 0.04).toFixed(3)} re f`)
    }
  }

  parts.push('0.35 g')
  show('Scan to see the menu and order', 7.5, false, cx, qrBottom - 16)
  parts.push('0 g')
})

parts.unshift('0 g')
parts.push('0 g')
show(`${restaurant.name} - table codes`, 12, true, PAGE_W / 2, PAGE_H - MARGIN - 14)
parts.push('0.45 g')
show(`${tables.length} tables - khapee.com`, 8, false, PAGE_W / 2, PAGE_H - MARGIN - 30)

const content = parts.join('\n')

/** The smallest PDF that holds a page: catalog, pages, page, stream, fonts. */
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
    `/Resources << /Font << /FR 5 0 R /FB 6 0 R >> >> /Contents 4 0 R >>`,
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
]

let pdf = '%PDF-1.4\n'
const offsets: number[] = []
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf))
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
})
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

const out = path.resolve(import.meta.dirname, '..', 'data', 'qr', `${slug}-tables.pdf`)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, pdf, 'latin1')

console.log(`\n  ${restaurant.name}: ${tables.length} table codes on one A4 page`)
for (const t of tables) console.log(`    ${t.label.padEnd(10)} ${site}/t/${t.token}`)
console.log(`\n  PDF:  ${path.relative(process.cwd(), out)}\n`)
