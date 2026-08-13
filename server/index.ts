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
import { groupsRouter } from './routes/groups.ts'
import { sessionsRouter } from './routes/sessions.ts'
import { ensureSeed } from './seed.ts'

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
// Generous enough for a downsized dish photo posted as a data URL.
app.use(express.json({ limit: '8mb' }))
app.use(attachUser)

// Restaurant and dish photos, stored on this machine only.
app.use('/api/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: true }))

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

  const client = addClient(res, {
    restaurantId: req.user?.role === 'staff' ? req.user.restaurantId : null,
    userId: req.user?.id ?? null,
  })
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`)

  req.on('close', () => removeClient(client))
})

setInterval(heartbeat, 25_000).unref?.()

// Serve the built SPA when it exists (npm run build), otherwise Vite serves it in dev.
const dist = process.env.VERCEL
  ? path.resolve(process.cwd(), 'dist')
  : path.resolve(__dirname, '..', 'dist')
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }))

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[tablo]', err)
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' })
})

// On serverless the platform owns the listener; everywhere else we bind here.
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ▲ Ordro API  →  http://localhost:${PORT}`)
    console.log(`    database   →  ${path.relative(process.cwd(), db.name)}\n`)
  })
}

export default app
