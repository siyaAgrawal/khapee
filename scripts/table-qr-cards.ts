/**
 * Table cards in Khapee's own look — jamun, haldi, the ticket edge — with a
 * line that gives people a reason to scan instead of walking to the counter.
 *
 *   npx tsx scripts/table-qr-cards.ts revery
 *
 * Writes data/qr/<slug>-khapee-cards.html: one card per table, 100 × 150 mm,
 * two to an A4 page when printed (Chrome → Print → Save as PDF, margins
 * none, background graphics on). The QR is inline SVG drawn by the bundled
 * `qrcode` package, so it is sharp at any size.
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
  .prepare('SELECT label, token FROM restaurant_tables WHERE restaurant_id = ? ORDER BY id')
  .all(restaurant.id) as any[]

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const cards = await Promise.all(
  tables.map(async (t) => {
    const svg = (
      await QRCode.toString(`${site}/t/${t.token}`, {
        type: 'svg',
        errorCorrectionLevel: 'H',
        margin: 0,
        color: { dark: '#2a1259', light: '#ffffff' },
      })
    ).replace(/<\?xml[^>]*\?>/, '')
    const number = String(t.label).replace(/^Table\s*/i, '')
    return `
  <section class="card">
    <header class="top">
      <span class="word">khapee<i></i></span>
      <span class="stub"><small>Table</small><b>${escape(number)}</b></span>
    </header>

    <div class="middle">
    <h1 class="head">Don’t get up.<br /><em>Order from your seat.</em></h1>

    <div class="qr-wrap">
      <div class="qr">${svg}</div>
      <span class="corner tl"></span><span class="corner tr"></span>
      <span class="corner bl"></span><span class="corner br"></span>
    </div>

    <p class="sub">Scan, pay by UPI, and it goes straight to ${escape(restaurant.name)}’s kitchen.</p>

    <ol class="steps">
      <li><b>1</b>Scan</li>
      <li><b>2</b>Order &amp; pay</li>
      <li><b>3</b>It comes to you</li>
    </ol>
    </div>

    <footer class="foot">
      <span>kuch khapee lo.</span>
      <span>khapee.com</span>
    </footer>
  </section>`
  }),
)

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(restaurant.name)} — Khapee table cards</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Inter:wght@500;600;700&display=swap" />
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #ece8f2; }
  body {
    display: flex; flex-wrap: wrap; justify-content: center; gap: 8mm; padding: 8mm;
    font-family: Inter, system-ui, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .card {
    position: relative;
    width: 100mm; height: 150mm;
    padding: 9mm 8mm 0;
    border-radius: 5mm;
    overflow: hidden;
    background:
      radial-gradient(120% 60% at 85% 0%, rgba(242, 178, 58, 0.16), transparent 60%),
      #4b2390;
    color: #f6f0e4;
    display: flex; flex-direction: column;
    break-inside: avoid;
  }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .word {
    font-family: 'Bricolage Grotesque', sans-serif; font-variation-settings: 'opsz' 96;
    font-weight: 800; font-size: 9mm; letter-spacing: -0.055em; line-height: 1;
  }
  .word i {
    display: inline-block; width: 2.3mm; height: 2.3mm; margin-left: 0.5mm;
    border-radius: 50%; background: #f2b23a;
  }
  /* The table number as a ticket stub, punched on its left. */
  .stub {
    position: relative;
    display: flex; flex-direction: column; align-items: center;
    padding: 1.6mm 4mm 1.6mm 5mm;
    background: #f2b23a; color: #1e1528; border-radius: 2.5mm;
    line-height: 1;
  }
  .stub::before {
    content: ''; position: absolute; left: -1.6mm; top: 50%;
    width: 3.2mm; height: 3.2mm; margin-top: -1.6mm; border-radius: 50%; background: #4b2390;
  }
  .stub small { font-size: 2.2mm; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }
  .stub b { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 7.5mm; letter-spacing: -0.04em; }

  /* Everything between the top bar and the footer, centred in the space. */
  .middle {
    flex: 1;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center;
    padding-bottom: 13mm;
  }
  .head {
    margin: 0;
    font-family: 'Bricolage Grotesque', sans-serif; font-variation-settings: 'opsz' 48;
    font-weight: 700; font-size: 5.6mm; line-height: 1.2; letter-spacing: -0.03em;
  }
  .head em { font-style: normal; color: #f2b23a; }
  .sub {
    margin: 3mm 0 0; max-width: 70mm;
    font-size: 3mm; line-height: 1.4; color: rgba(246, 240, 228, 0.75);
  }

  .qr-wrap { position: relative; margin-top: 5mm; padding: 3.5mm; }
  .qr {
    width: 50mm; height: 50mm; padding: 3mm;
    background: #fff; border-radius: 3.5mm;
    box-shadow: 0 2mm 6mm rgba(0, 0, 0, 0.25);
  }
  .qr svg { display: block; width: 100%; height: 100%; }
  /* Haldi brackets, like a camera's viewfinder, saying "point here". */
  .corner { position: absolute; width: 6mm; height: 6mm; border: 0.9mm solid #f2b23a; }
  .tl { top: 0; left: 0; border-right: 0; border-bottom: 0; border-top-left-radius: 2mm; }
  .tr { top: 0; right: 0; border-left: 0; border-bottom: 0; border-top-right-radius: 2mm; }
  .bl { bottom: 0; left: 0; border-right: 0; border-top: 0; border-bottom-left-radius: 2mm; }
  .br { bottom: 0; right: 0; border-left: 0; border-top: 0; border-bottom-right-radius: 2mm; }

  .steps {
    list-style: none; margin: 4mm 0 0; padding: 0;
    display: flex; justify-content: center; gap: 4mm;
    font-size: 3mm; font-weight: 600; color: #f6f0e4;
  }
  .steps li { display: flex; align-items: center; gap: 1.4mm; white-space: nowrap; }
  .steps b {
    display: grid; place-items: center; width: 4.6mm; height: 4.6mm; border-radius: 50%;
    background: rgba(246, 240, 228, 0.14); color: #f2b23a; font-size: 2.6mm;
  }

  /* The footer is a torn-off ticket: cream, with the zigzag along its top. */
  .foot {
    position: absolute; left: 0; right: 0; bottom: 0;
    display: flex; justify-content: space-between; align-items: center;
    padding: 4mm 8mm 3.6mm;
    background: #f6f0e4; color: #4b2390;
    font-size: 3.1mm; font-weight: 700;
  }
  .foot span:first-child { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 4mm; letter-spacing: -0.03em; }
  .foot::before {
    content: ''; position: absolute; left: 0; right: 0; top: -2.4mm; height: 2.5mm;
    background:
      linear-gradient(135deg, transparent 50%, #f6f0e4 50%) 0 0 / 3.6mm 2.5mm repeat-x,
      linear-gradient(225deg, transparent 50%, #f6f0e4 50%) 0 0 / 3.6mm 2.5mm repeat-x;
  }
  @media print {
    html, body { background: #fff; }
    body { padding: 10mm 0; gap: 8mm 6mm; }
  }
</style>
</head>
<body>${cards.join('\n')}
</body>
</html>
`

const out = path.join(process.cwd(), 'data', 'qr', `${slug}-khapee-cards.html`)
fs.writeFileSync(out, html)
console.log(`\n  ${tables.length} cards → ${path.relative(process.cwd(), out)}\n`)
for (const t of tables) console.log(`  ${t.label}: ${site}/t/${t.token}`)
