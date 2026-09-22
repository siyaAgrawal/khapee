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

const show = (into: string[], text: string, size: number, bold: boolean, cx: number, y: number) => {
  const t = pdfText(text)
  const x = cx - textWidth(text, size) / 2
  into.push(`BT /${bold ? 'FB' : 'FR'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${t}) Tj ET`)
}

/**
 * Six to a page — three across, two down — spilling onto as many pages as
 * that takes.
 *
 * Fitting everything onto one sheet shrinks the code once a restaurant has
 * more than half a dozen tables, and a small code is the whole problem: it
 * has to scan from a phone held at arm's length across a table, in a café's
 * lighting, on a laminated card that has been wiped down a hundred times.
 * Paper is cheaper than a code nobody can read.
 */
const cols = Math.max(1, Number(process.env.KHAPEE_COLS ?? 3))
const rows = Math.max(1, Number(process.env.KHAPEE_ROWS ?? 2))
const PER_PAGE = cols * rows
const cardW = (PAGE_W - MARGIN * 2) / cols
const cardH = (PAGE_H - MARGIN * 2 - 46) / rows
const pageCount = Math.ceil(tables.length / PER_PAGE)

/** One content stream per sheet. */
const streams: string[][] = Array.from({ length: pageCount }, () => [])

tables.forEach((table, index) => {
  const page = Math.floor(index / PER_PAGE)
  const i = index % PER_PAGE
  const parts = streams[page]
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

  const url = `${site}/t/${table.token}`
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const size = qr.modules.size

  /**
   * As large as the card allows, and centred in what is left.
   *
   * Three columns means width is what limits the code, so the side padding is
   * kept tight — every point taken off the margin goes into the code itself,
   * and the code is the only part of this page that has to work from across a
   * table. The block is then centred vertically rather than pinned to the top,
   * because two rows on A4 leaves a card much taller than its contents and
   * everything sitting at the top of an empty box looks like a mistake.
   */
  const box = Math.min(cardW - 26, cardH - 116)
  const module = box / size
  const blockH = 22 + 26 + box + 26
  const blockTop = top - (cardH - blockH) / 2

  show(parts, restaurant.name, 9, false, cx, blockTop - 16)
  show(parts, table.label, 19, true, cx, blockTop - 40)

  const qrLeft = cx - box / 2
  const qrBottom = blockTop - 52 - box

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
  show(parts, 'Scan to see the menu and order', 7.5, false, cx, qrBottom - 16)
  parts.push('0 g')
})

streams.forEach((parts, page) => {
  parts.unshift('0 g')
  parts.push('0 g')
  show(parts, `${restaurant.name} - table codes`, 12, true, PAGE_W / 2, PAGE_H - MARGIN - 14)
  parts.push('0.45 g')
  const what = pageCount > 1 ? `page ${page + 1} of ${pageCount} - ` : ''
  show(parts, `${what}${tables.length} tables - khapee.com`, 8, false, PAGE_W / 2, PAGE_H - MARGIN - 30)
})

/**
 * Catalog, the page tree, then a Page and a content stream for each sheet,
 * and the two fonts last so their numbers do not move as pages are added.
 */
const FONT_R = 3 + pageCount * 2
const FONT_B = FONT_R + 1
const pageObjects: string[] = []
const streamObjects: string[] = []
const kids: string[] = []
streams.forEach((parts, page) => {
  const pageObj = 3 + page * 2
  const streamObj = pageObj + 1
  kids.push(`${pageObj} 0 R`)
  pageObjects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /FR ${FONT_R} 0 R /FB ${FONT_B} 0 R >> >> /Contents ${streamObj} 0 R >>`,
  )
  const content = parts.join('\n')
  streamObjects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
})

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`,
  ...pageObjects.flatMap((p, i) => [p, streamObjects[i]]),
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

console.log(
  `\n  ${restaurant.name}: ${tables.length} table codes, ${cols} across x ${rows} down` +
    ` = ${PER_PAGE} a page, ${pageCount} page${pageCount === 1 ? '' : 's'}`,
)
for (const t of tables) console.log(`    ${t.label.padEnd(10)} ${site}/t/${t.token}`)
console.log(`\n  PDF:  ${path.relative(process.cwd(), out)}\n`)
