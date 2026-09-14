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

const cards = await Promise.all(
  tables.map(async (t) => {
    const url = `${site}/t/${t.token}`
    // High correction: these get printed, taped down, and scanned under a glass
    // of water at night.
    const svg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 0,
      color: { dark: '#111111', light: '#ffffff' },
    })
    return `    <section class="card">
      <p class="place">${escape(restaurant.name)}</p>
      <h2 class="table">${escape(t.label)}</h2>
      <div class="qr">${svg.replace(/<\?xml[^>]*\?>/, '')}</div>
      <p class="how">Point your camera here to see the menu and order</p>
      <p class="url">${escape(url.replace(/^https:\/\//, ''))}</p>
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
    padding: 8mm 5mm 6mm;
    text-align: center;
    break-inside: avoid;
  }
  .place {
    margin: 0 0 2mm;
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #8a8a8a;
  }
  .table { margin: 0 0 5mm; font-size: 26px; letter-spacing: -0.02em; }
  .qr { width: 42mm; height: 42mm; margin: 0 auto 5mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .how { margin: 0 0 2mm; font-size: 11px; line-height: 1.35; color: #444; }
  .url { margin: 0; font-size: 9px; color: #9a9a9a; font-family: ui-monospace, Menlo, monospace; }
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

// The same codes as standalone images, for anyone who would rather drop one
// into a poster than print the sheet.
for (const t of tables) {
  const url = `${site}/t/${t.token}`
  await QRCode.toFile(path.join(outDir, `${slug}-${t.label.toLowerCase().replace(/\s+/g, '-')}.png`), url, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 900,
  })
}

console.log(`\n  ${restaurant.name}: ${tables.length} table QR code${tables.length === 1 ? '' : 's'}`)
for (const t of tables) console.log(`    ${t.label.padEnd(9)} ${site}/t/${t.token}`)
console.log(`\n  Sheet:  ${path.relative(process.cwd(), file)}`)
console.log(`  Images: ${path.relative(process.cwd(), outDir)}/${slug}-table-*.png\n`)
