/**
 * Draws the app icons.
 *
 * The icon is the wordmark in a purple tile — the name written out, the way a
 * food app's icon on a home screen has its name written out. It used to be an
 * abstract crescent, which is a fine shape and tells somebody scrolling their
 * phone nothing at all about what they are about to open.
 *
 * Rendered rather than drawn by hand because the letterforms are Bricolage
 * Grotesque at a weight no SVG path in this repo carries, and because the four
 * sizes have to be the same picture. Run it after changing the brand colour or
 * the wordmark:
 *
 *     node scripts/make-icons.mjs
 *
 * Needs a network fetch for the font, and Playwright's Chromium.
 */
// Playwright is installed globally in this environment rather than as a
// dependency — the app itself has no use for a browser at runtime.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

/** Kept in step with --brand-fixed and --gold in src/styles.css. */
const BRAND = '#7a3fd9'
const GOLD = '#d9a441'

/**
 * `maskable` leaves a ring of bare purple around the word, because Android
 * crops a maskable icon to whatever shape the launcher prefers — a circle on
 * most phones — and a wordmark set to the edges loses its first and last
 * letter to that crop.
 */
const page = (size, { maskable = false } = {}) => {
  const pad = maskable ? 0.2 : 0.11
  const radius = maskable ? 0 : size * 0.22
  return `<!doctype html>
<html>
  <head>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&display=block"
      rel="stylesheet"
    />
    <style>
      * { margin: 0; padding: 0; }
      html, body { width: ${size}px; height: ${size}px; }
      body {
        display: grid;
        place-items: center;
        background: transparent;
      }
      .tile {
        width: ${size}px;
        height: ${size}px;
        border-radius: ${radius}px;
        background: ${BRAND};
        display: grid;
        place-items: center;
        overflow: hidden;
      }
      .word {
        font-family: 'Bricolage Grotesque', sans-serif;
        font-weight: 800;
        font-variation-settings: 'opsz' 96;
        /* Sized off the tile so every icon is the same picture, and off the
           padding so the maskable one simply sets the word smaller rather
           than being a different drawing. */
        font-size: ${size * (1 - pad * 2) * 0.295}px;
        letter-spacing: -0.045em;
        line-height: 1;
        color: #ffffff;
        white-space: nowrap;
      }
      .dot { color: ${GOLD}; }
    </style>
  </head>
  <body>
    <div class="tile"><div class="word">khapee<span class="dot">.</span></div></div>
  </body>
</html>`
}

const browser = await chromium.launch()

async function shoot(size, file, opts) {
  const ctx = await browser.newContext({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  })
  const p = await ctx.newPage()
  await p.setContent(page(size, opts), { waitUntil: 'networkidle' })
  await p.evaluate(() => document.fonts.ready)
  const buf = await p.screenshot({ omitBackground: true })
  writeFileSync(join(OUT, file), buf)
  await ctx.close()
  console.log('wrote', file, `${size}×${size}`)
}

mkdirSync(OUT, { recursive: true })
await shoot(512, 'icon-512.png')
await shoot(192, 'icon-192.png')
await shoot(512, 'icon-512-maskable.png', { maskable: true })
await shoot(180, 'apple-touch-icon.png')
await shoot(32, 'favicon-32.png')
await browser.close()
