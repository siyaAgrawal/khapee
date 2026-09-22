import express from 'express'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { attachUser, purgeExpiredSessions } from './auth.ts'
import { db, UPLOAD_DIR } from './db.ts'
import { addClient, heartbeat, removeClient } from './events.ts'
import { authRouter } from './routes/auth.ts'
import { publicRouter } from './routes/public.ts'
import { ordersRouter } from './routes/orders.ts'
import { staffRouter } from './routes/staff.ts'
import { orderFeedRouter } from './routes/order-feed.ts'
import { groupsRouter } from './routes/groups.ts'
import { sessionsRouter } from './routes/sessions.ts'
import { ensureSeed } from './seed.ts'
import { injectMeta, metaFor, robotsTxt, sitemapXml, structuredData } from './seo.ts'
import { thankPage } from './thank-page.ts'
import { contactCard } from './vcard.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// In development this is deliberately not `PORT` — dev harnesses set that for
// the web server, and the API would steal Vite's port. In production the app is
// served from this one process, so we honour the host's PORT.
const IS_PROD = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.TABLO_PORT ?? (IS_PROD ? process.env.PORT ?? 4273 : 4273))
// Where customers reach the app (Vite in dev, this server once built).
const WEB_PORT = Number(process.env.TABLO_WEB_PORT ?? 5273)

ensureSeed()
purgeExpiredSessions()

const app = express()
// A host like Render terminates TLS at its edge and forwards to us over plain
// HTTP, so req.protocol reads "http" for a request the customer made over
// https. Everything we build from it then carries the wrong scheme: canonical
// links telling Google to prefer a URL that only redirects, share previews, and
// the URLs printed inside zone QR codes. Trusting the proxy's
// X-Forwarded-Proto makes req.protocol the scheme the customer actually used.
//
// Only in production: in development nothing sits in front of us, and trusting
// a header anyone can set would let a caller claim any scheme or address.
if (IS_PROD) app.set('trust proxy', true)

// Generous enough for a downsized dish photo posted as a data URL.
app.use(express.json({ limit: '8mb' }))
app.use(attachUser)

// Restaurant and dish photos, stored on this machine only.
app.use('/api/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: true }))

/**
 * Nothing the API answers is ever worth re-reading from a cache.
 *
 * None of these responses carried a Cache-Control header, which does not mean
 * "do not cache" — with an ETag and no explicit freshness, a browser is free to
 * guess a lifetime and serve a menu it fetched earlier without asking. That is
 * how a price changed in the dashboard keeps showing the old figure on the
 * restaurant's own page: nothing is broken, the phone simply never asked
 * again. Menus, orders, codes and session state are all live by definition, so
 * say so once, here, rather than per route.
 */
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, must-revalidate')
  next()
})

app.get('/api/health', (_req, res) => {
  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM restaurants) AS restaurants,
              (SELECT COUNT(*) FROM menu_items) AS items,
              (SELECT COUNT(*) FROM orders) AS orders`,
    )
    .get()
  res.json({ ok: true, ...(counts as object) })
})

/**
 * Addresses this machine is reachable on, so printed table QRs point somewhere
 * a phone can actually open (localhost only works on this computer).
 */
app.get('/api/network', (req, res) => {
  const nets = os.networkInterfaces()
  const urls: string[] = []
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${WEB_PORT}`)
    }
  }
  res.json({ localUrl: `http://localhost:${WEB_PORT}`, networkUrls: urls })
})

app.use('/api/auth', authRouter)
app.use('/api', publicRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/sessions', sessionsRouter)
app.use('/api/groups', groupsRouter)
app.use('/api/staff', staffRouter)
// Authenticated by a billing key rather than a session — see routes/billing.ts.
app.use('/api/billing', orderFeedRouter)

/** Server-sent events keep the staff board live without any polling loop. */
app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
  res.write('retry: 3000\n\n')

  // Membership, not the account's original role — the same rule requireStaff
  // follows. An address that signed up as a customer and later took over a
  // restaurant has role 'customer' forever, and this line was reading that as
  // "not staff" and subscribing them to nothing: their board only ever changed
  // when they reloaded it by hand.
  const client = addClient(res, {
    restaurantId: req.user?.restaurantId ?? null,
    userId: req.user?.id ?? null,
  })
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`)

  req.on('close', () => removeClient(client))
})

setInterval(heartbeat, 25_000).unref?.()

/**
 * The restaurant's number as a contact card the phone can save in one tap.
 *
 * Served outside the API and outside the app for the same reason /thank is:
 * it has to be an ordinary link that a phone recognises by its content type,
 * not something a bundle has to boot before it can respond. See server/vcard.ts
 * for why this exists at all.
 */
app.get('/r/:id/khapee.vcf', (req, res) => {
  const row = db
    .prepare('SELECT name, phone FROM restaurants WHERE id = ?')
    .get(Number(req.params.id)) as any
  if (!row) return res.status(404).type('text/plain').send('No such restaurant.')
  const digits = String(row.phone ?? '').replace(/\D/g, '')
  // Offering a card with no number in it would save an entry that can do
  // nothing, which is worse than not offering one.
  if (digits.length < 10) return res.status(404).type('text/plain').send('No number to save.')

  res.set('Cache-Control', 'no-store')
  res.set('Content-Disposition', 'attachment; filename="khapee.vcf"')
  res.type('text/vcard; charset=utf-8').send(
    contactCard({ restaurant: row.name, phone: row.phone, website: `${req.protocol}://${req.get('host')}` }),
  )
})

/**
 * The one page that is not the app.
 *
 * Tapping "thank them" used to open a route inside the SPA, so the phone had to
 * fetch and start the whole application before it could read the address bar
 * and hand over to WhatsApp — seconds, on a host waking from sleep, staring at
 * nothing. This answers in one round trip with a document that redirects while
 * it is still being parsed. Deliberately above the static and shell handlers so
 * it wins, and outside the built-app check so it behaves the same in dev.
 */
app.get('/thank', (req, res) => {
  const q = req.query as Record<string, string | undefined>
  res.set('Cache-Control', 'no-store')
  res.type('html').send(thankPage(q.to ?? '', q.who ?? 'them', q.text ?? ''))
})

// Serve the built SPA when it exists (npm run build), otherwise Vite serves it in dev.
const dist = process.env.VERCEL
  ? path.resolve(process.cwd(), 'dist')
  : path.resolve(__dirname, '..', 'dist')
if (fs.existsSync(path.join(dist, 'index.html'))) {
  /** Whatever host the visitor actually used, so links and tags match it. */
  const originOf = (req: any) => `${req.protocol}://${req.get('host')}`

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(robotsTxt(originOf(req)))
  })
  app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').send(sitemapXml(originOf(req)))
  })

  app.use(express.static(dist, { index: false }))

  // The shell is one file with one title. Crawlers and link previews get the
  // page's own title, description and picture written into it before it is
  // sent; the browser then renders the app over the top as usual.
  const shell = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
  app.get(/^(?!\/api).*/, (req, res) => {
    const origin = originOf(req)
    const meta = metaFor(req.path, origin)
    let html = injectMeta(shell, meta, origin)
    const ld = structuredData(req.path, origin)
    if (ld) html = html.replace('</head>', `  <script type="application/ld+json">${ld}</script>\n  </head>`)
    // Ask every time.
    //
    // This page names the build it belongs to — the asset filenames are
    // content-hashed — and it carried an ETag with nothing said about
    // freshness, which does not mean "do not cache": a browser is then free to
    // guess a lifetime and keep serving the copy it already has. The effect is
    // a phone that is still running last week's app and cannot be told
    // otherwise, with no error anywhere to explain it. The ETag still saves
    // the bytes when nothing has changed.
    res.set('Cache-Control', 'no-cache')
    res.type('html').send(html)
  })
}

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }))

/**
 * The last resort, with something to quote.
 *
 * "Something went wrong on our side" is true, sympathetic, and completely
 * undiagnosable: it says the same thing for every fault on every route, so a
 * restaurant reporting it hands over no more than the fact that something
 * broke. The only way to find it afterwards is to guess what they were doing.
 *
 * Each failure now carries a short reference, printed beside the error and
 * the route it came from in the log. Six characters somebody can read down a
 * phone turns "it is not working" into a line in a file.
 *
 * The error itself is never sent back — a stack trace tells an attacker what
 * the server is built from, and tells the person reading it nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: any, res: any, _next: any) => {
  const ref = Math.random().toString(36).slice(2, 8).toUpperCase()
  console.error(`[khapee] ${ref} ${req?.method} ${req?.originalUrl}`, err)
  res.status(500).json({
    error: `Something went wrong on our side (reference ${ref}). Please try again, and quote that reference if it keeps happening.`,
    reference: ref,
  })
})

// On serverless the platform owns the listener; everywhere else we bind here.
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ▲ Ordro API  →  http://localhost:${PORT}`)
    console.log(`    database   →  ${path.relative(process.cwd(), db.name)}\n`)
  })
}

export default app
