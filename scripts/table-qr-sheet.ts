/**
 * Prints the table QR codes for a restaurant.
 *
 *   npx tsx scripts/table-qr-sheet.ts revery
 *
 * Writes one A4 page per three tables to data/qr/<slug>-tables.html, ready to
 * open and print. Each card carries one table's own QR: scanning it opens
 * Khapee at that restaurant with that table already chosen, so a customer
 * sitting at table 2 never has to say they are at table 2.
 *
 * The QR is drawn here with the bundled `qrcode` package and written into the
 * page as inline SVG, so the printed sheet needs no network and no service.
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
  console.error(`\n  ${restaurant.name} has no tables to print.\n`)
  process.exit(1)
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The QR for one table, as SVG. High correction: these get printed, taped
 *  down, and scanned across a table at night under a glass of water. */
const qrSvg = (url: string) =>
  QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 0,
    color: { dark: '#111111', light: '#ffffff' },
  })

/** The drawing inside a QR's <svg>, plus the grid size it was drawn against. */
function qrParts(svg: string): { inner: string; size: number } {
  const box = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) /)
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')
  return { inner, size: box ? Number(box[1]) : 25 }
}

const host = site.replace(/^https?:\/\//, '').replace(/\/$/, '')

const cards = await Promise.all(
  tables.map(async (t) => {
    const svg = await qrSvg(`${site}/t/${t.token}`)
    // Three things in order, and nothing else on the card: which table this is,
    // the code for it, and where it goes.
    return `    <section class="card">
      <h2 class="table">${escape(t.label)}</h2>
      <div class="qr">${svg.replace(/<\?xml[^>]*\?>/, '')}</div>
      <p class="url">${escape(host)}</p>
    </section>`
  }),
)

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(restaurant.name)} — table QR codes</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #111;
    background: #f6f5f2;
  }
  .sheet { max-width: 190mm; margin: 0 auto; padding: 10mm 0; }
  .lede { text-align: center; margin: 0 0 8mm; }
  .lede h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .lede p { margin: 0; font-size: 12px; color: #666; }
  .cards { display: grid; gap: 8mm; grid-template-columns: repeat(auto-fit, minmax(58mm, 1fr)); }
  .card {
    background: #fff;
    border: 1px dashed #bbb;
    border-radius: 6mm;
    padding: 9mm 5mm 8mm;
    text-align: center;
    break-inside: avoid;
  }
  .table {
    margin: 0 0 6mm;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 30px;
    font-weight: 400;
    letter-spacing: -0.01em;
  }
  .qr { width: 44mm; height: 44mm; margin: 0 auto 6mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .url { margin: 0; font-size: 13px; letter-spacing: 0.12em; color: #555; }
  @media print {
    body { background: #fff; }
    .lede { display: none; }
    .card { border-color: #ddd; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="lede">
      <h1>${escape(restaurant.name)} — one QR per table</h1>
      <p>Print, cut along the dashed edge, and put each card on its own table. Printing hides this line.</p>
    </div>
    <div class="cards">
${cards.join('\n')}
    </div>
  </div>
</body>
</html>
`

const outDir = path.resolve(import.meta.dirname, '..', 'data', 'qr')
fs.mkdirSync(outDir, { recursive: true })
const file = path.join(outDir, `${slug}-tables.html`)
fs.writeFileSync(file, html)

// Each card on its own, as a vector: the same three things, drawn rather than
// laid out, so it prints crisply at a business card or a whole page and can be
// handed to a print shop as-is.
const CARD_W = 300
const CARD_H = 400
for (const t of tables) {
  const { inner, size } = qrParts(await qrSvg(`${site}/t/${t.token}`))
  const qrBox = 200
  const scale = qrBox / size
  const card = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}">
  <rect width="${CARD_W}" height="${CARD_H}" fill="#ffffff"/>
  <text x="${CARD_W / 2}" y="76" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="40" fill="#111111">${escape(t.label)}</text>
  <g transform="translate(${(CARD_W - qrBox) / 2}, 112) scale(${scale})">${inner}</g>
  <text x="${CARD_W / 2}" y="364" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="19" letter-spacing="2.2" fill="#555555">${escape(host)}</text>
</svg>
`
  const base = `${slug}-${t.label.toLowerCase().replace(/\s+/g, '-')}`
  fs.writeFileSync(path.join(outDir, `${base}-card.svg`), card)

  // The bare code as an image too, for dropping into a poster or a menu.
  await QRCode.toFile(path.join(outDir, `${base}.png`), `${site}/t/${t.token}`, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 900,
  })
}

console.log(`\n  ${restaurant.name}: ${tables.length} table QR code${tables.length === 1 ? '' : 's'}`)
for (const t of tables) console.log(`    ${t.label.padEnd(9)} ${site}/t/${t.token}`)
console.log(`\n  Sheet:  ${path.relative(process.cwd(), file)}   (all ${tables.length} on one page)`)
console.log(`  Cards:  ${path.relative(process.cwd(), outDir)}/${slug}-table-*-card.svg`)
console.log(`  Codes:  ${path.relative(process.cwd(), outDir)}/${slug}-table-*.png\n`)
