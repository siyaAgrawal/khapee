/**
 * Page visits, for Khapee insights.
 *
 * Until this existed Khapee knew who had ordered and nothing about who had
 * looked: how many people open a menu, how they got there — the QR on a table,
 * a search, an Instagram link — and how many of them go on to check out.
 *
 * Kept deliberately thin. A visitor is a random id the browser makes up and
 * keeps (no name, number, IP address or cookie); a visit is that id, the page,
 * when, and where the visit came from. Restaurant dashboards and insights
 * itself are not counted, so the numbers are customers and not the people
 * running the place.
 */
import { db } from './db.ts'

db.exec(`
CREATE TABLE IF NOT EXISTS page_visits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT    NOT NULL DEFAULT (datetime('now')),
  visitor       TEXT    NOT NULL,
  path          TEXT    NOT NULL,
  page          TEXT    NOT NULL,
  restaurant_id INTEGER,
  source        TEXT    NOT NULL,
  referrer      TEXT    NOT NULL DEFAULT '',
  landing       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_page_visits_at ON page_visits(at);
CREATE INDEX IF NOT EXISTS idx_page_visits_visitor ON page_visits(visitor, path, at);
`)

/** Where a visit came from, as the browser worked it out. Anything else is "other". */
const SOURCES = new Set(['qr', 'search', 'instagram', 'whatsapp', 'facebook', 'app', 'link', 'direct', 'other'])

/** Crawlers that run scripts still say so; they are not people. */
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor/i

/** What kind of page a path is, and which restaurant it belongs to. */
function classify(path: string): { page: string; restaurantId: number | null } | null {
  if (path.startsWith('/staff') || path.startsWith('/insights')) return null
  let m = path.match(/^\/r\/(\d+)(?:\/(car|delivery|nearby))?/)
  if (m) return { page: m[2] ? `menu-${m[2]}` : 'menu', restaurantId: Number(m[1]) }
  m = path.match(/^\/t\/([A-Za-z0-9]+)/)
  if (m) {
    const t = db.prepare('SELECT restaurant_id FROM restaurant_tables WHERE token = ?').get(m[1]) as any
    return { page: 'table-qr', restaurantId: t?.restaurant_id ?? null }
  }
  m = path.match(/^\/z\/([A-Za-z0-9]+)/)
  if (m) {
    const z = db.prepare('SELECT restaurant_id FROM service_zones WHERE token = ?').get(m[1]) as any
    return { page: 'car-qr', restaurantId: z?.restaurant_id ?? null }
  }
  if (path === '/' || path === '') return { page: 'home', restaurantId: null }
  if (path.startsWith('/p/')) return { page: 'area', restaurantId: null }
  if (path.startsWith('/checkout')) return { page: 'checkout', restaurantId: null }
  if (path.startsWith('/cart')) return { page: 'cart', restaurantId: null }
  if (path.startsWith('/order/')) return { page: 'order', restaurantId: null }
  if (path.startsWith('/orders')) return { page: 'my-orders', restaurantId: null }
  if (path.startsWith('/for-restaurants')) return { page: 'for-restaurants', restaurantId: null }
  return { page: 'other', restaurantId: null }
}

export function recordVisit(body: any, userAgent: string): void {
  if (BOT.test(userAgent || '')) return
  const visitor = String(body?.visitor ?? '')
  if (!/^[A-Za-z0-9-]{8,64}$/.test(visitor)) return
  const path = String(body?.path ?? '').slice(0, 200)
  if (!path.startsWith('/')) return
  const kind = classify(path)
  if (!kind) return
  const source = SOURCES.has(String(body?.source)) ? String(body.source) : 'other'
  const referrer = String(body?.referrer ?? '')
    .replace(/[^A-Za-z0-9.-]/g, '')
    .slice(0, 100)
  // A reload, or coming back to the same page a minute later, is one visit.
  const recent = db
    .prepare(`SELECT 1 FROM page_visits WHERE visitor = ? AND path = ? AND at >= datetime('now', '-10 minutes') LIMIT 1`)
    .get(visitor, path)
  if (recent) return
  db.prepare(
    `INSERT INTO page_visits (visitor, path, page, restaurant_id, source, referrer, landing)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(visitor, path, kind.page, kind.restaurantId, source, referrer, body?.landing ? 1 : 0)
}

const IST = `datetime(v.at, '+330 minutes')`

export function visitStats(opts: { days: number; restaurantId?: number | null }) {
  const days = Math.max(0, Math.min(3650, Math.floor(opts.days || 0)))
  const where: string[] = []
  const params: any[] = []
  if (days) where.push(`v.at >= datetime('now', '-${days} days')`)
  if (opts.restaurantId) {
    where.push('v.restaurant_id = ?')
    params.push(opts.restaurantId)
  }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const AND = where.length ? ' AND ' : 'WHERE '
  const one = (sql: string) => db.prepare(sql).get(...params) as any
  const all = (sql: string) => db.prepare(sql).all(...params) as any[]

  const totals = one(`SELECT COUNT(*) AS views, COUNT(DISTINCT v.visitor) AS visitors FROM page_visits v ${W}`)
  const today = one(
    `SELECT COUNT(*) AS views, COUNT(DISTINCT v.visitor) AS visitors FROM page_visits v
      ${W}${AND}date(${IST}) = date('now', '+330 minutes')`,
  )
  const checkout = one(
    `SELECT COUNT(DISTINCT v.visitor) AS n FROM page_visits v ${W}${AND}v.page IN ('checkout', 'order')`,
  )
  // How people arrived: the first page of each visit carries the source; a
  // table or car QR opened from inside the app counts as a QR visit as well.
  const sources = all(
    `SELECT v.source AS source, COUNT(*) AS visits, COUNT(DISTINCT v.visitor) AS visitors
       FROM page_visits v ${W}${AND}(v.landing = 1 OR v.source = 'qr')
      GROUP BY v.source ORDER BY visits DESC`,
  )
  const byDay = all(
    `SELECT date(${IST}) AS day, COUNT(*) AS views, COUNT(DISTINCT v.visitor) AS visitors
       FROM page_visits v ${W} GROUP BY day ORDER BY day`,
  )
  const byRestaurant = all(
    `SELECT v.restaurant_id AS id, r.name AS name, COUNT(*) AS views, COUNT(DISTINCT v.visitor) AS visitors,
            SUM(CASE WHEN v.page IN ('table-qr', 'car-qr') THEN 1 ELSE 0 END) AS scans
       FROM page_visits v JOIN restaurants r ON r.id = v.restaurant_id
       ${W}${AND}v.restaurant_id IS NOT NULL
      GROUP BY v.restaurant_id ORDER BY visitors DESC, views DESC LIMIT 15`,
  )
  const byPage = all(
    `SELECT v.page AS page, COUNT(*) AS views, COUNT(DISTINCT v.visitor) AS visitors
       FROM page_visits v ${W} GROUP BY v.page ORDER BY views DESC`,
  )
  const referrers = all(
    `SELECT v.referrer AS host, COUNT(*) AS visits FROM page_visits v
      ${W}${AND}v.landing = 1 AND v.referrer <> '' GROUP BY v.referrer ORDER BY visits DESC LIMIT 10`,
  )
  const first = db.prepare('SELECT MIN(at) AS at FROM page_visits').get() as any

  return {
    since: first?.at ?? null,
    views: Number(totals.views ?? 0),
    visitors: Number(totals.visitors ?? 0),
    todayViews: Number(today.views ?? 0),
    todayVisitors: Number(today.visitors ?? 0),
    checkoutVisitors: Number(checkout.n ?? 0),
    sources,
    byDay,
    byRestaurant,
    byPage,
    referrers,
  }
}
