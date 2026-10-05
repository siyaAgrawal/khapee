/**
 * Sample insights, for showing what the page looks like with a month of
 * orders on it — about fifty-six orders from fifty-odd people.
 *
 * Nothing here touches the real numbers. The sample is a separate database
 * held in memory, filled with made-up orders built from the real menus, and
 * the very same functions that read the real record read this one — so the
 * demo looks exactly like the real page and cannot drift from it. The page
 * that shows it says "Sample data" across the top.
 *
 * The orders are drawn from a fixed seed, so the sample is the same on every
 * reload; it is laid out over the last four weeks counted back from today.
 */
import Database from 'better-sqlite3'
import { db } from './db.ts'
import { insights, liveCount, orderList } from './insights.ts'
import { visitStats } from './visits.ts'

/** A small, fixed-seed random number generator (mulberry32). */
function seeded(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Where the sample orders are placed, and how many at each. */
const PLACES: [slug: string, orders: number][] = [['revery', 56]]
const PEOPLE = 52

/** First names for the order list — sample names, not anybody's order. */
const NAMES = [
  'Aarav', 'Ananya', 'Rohan', 'Ishita', 'Kabir', 'Meera', 'Vihaan', 'Saanvi', 'Arjun', 'Diya', 'Aditya',
  'Kavya', 'Reyansh', 'Myra', 'Vivaan', 'Anika', 'Krish', 'Pari', 'Dhruv', 'Riya', 'Yash', 'Navya', 'Aryan',
  'Tara', 'Shaurya', 'Siya', 'Atharv', 'Kiara', 'Advait', 'Avni', 'Ayaan', 'Ira', 'Rudra', 'Aadhya', 'Parth',
  'Mahi', 'Laksh', 'Sara', 'Om', 'Prisha', 'Neel', 'Zara', 'Dev', 'Anvi', 'Kian', 'Mishka', 'Shiv', 'Inaya',
  'Ved', 'Jiya', 'Rishi', 'Aarohi',
]

/** Hours people order at, weighted the way a café's day actually goes. */
const HOURS: [hour: number, weight: number][] = [
  [11, 3], [12, 5], [13, 6], [14, 4], [15, 3], [16, 4], [17, 6], [18, 8], [19, 10], [20, 11], [21, 9], [22, 5],
]

let cached: { built: string; d: Database.Database } | null = null

/** The sample database, built once a day. */
function sample(): Database.Database {
  const today = new Date().toISOString().slice(0, 10)
  if (cached?.built === today) return cached.d

  const d = new Database(':memory:')
  // The two record tables exactly as the real database has them.
  for (const name of ['order_facts', 'order_item_facts']) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as any
    d.exec(row.sql)
  }
  // Only what the read functions look at, from the rest.
  d.exec(`
    CREATE TABLE restaurants (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE orders (id INTEGER PRIMARY KEY);
    CREATE TABLE payments (order_id INTEGER, method TEXT);
  `)
  const visitsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'page_visits'").get() as any
  if (visitsSql) d.exec(visitsSql.sql)

  const rand = seeded(187)
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
  const weighted = <T>(xs: [T, number][]) => {
    let r = rand() * xs.reduce((n, [, w]) => n + w, 0)
    for (const [x, w] of xs) if ((r -= w) <= 0) return x
    return xs[xs.length - 1][0]
  }
  const sqlTime = (t: Date) => t.toISOString().replace('T', ' ').slice(0, 19)

  // Fifty-two people; the first four come back for a second order.
  const people = Array.from({ length: PEOPLE }, (_, i) => ({
    key: `sample-${i + 1}`,
    name: NAMES[i % NAMES.length],
  }))
  const queue = [...people, ...people.slice(0, 4)]

  const addFact = d.prepare(
    `INSERT INTO order_facts
       (order_id, restaurant_id, created_at, status, total_cents, payment_status, payment_method, service_mode,
        order_type, customer_key, accepted_at, order_number, customer_name, customer_phone, takeaway)
     VALUES (?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`,
  )
  const addItem = d.prepare(
    `INSERT INTO order_item_facts (item_id, order_id, restaurant_id, name, quantity, unit_price_cents, accepted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  )
  const addPayment = d.prepare('INSERT INTO payments (order_id, method) VALUES (?, ?)')

  let orderId = 0
  let itemId = 0
  const now = Date.now()
  for (const [slug, count] of PLACES) {
    const r = db.prepare('SELECT id, name, featured_items FROM restaurants WHERE slug = ?').get(slug) as any
    if (!r) continue
    d.prepare('INSERT INTO restaurants (id, name) VALUES (?, ?)').run(r.id, r.name)
    const menu = db
      .prepare('SELECT id, name, price_cents FROM menu_items WHERE restaurant_id = ? AND is_available = 1 ORDER BY sort_order LIMIT 60')
      .all(r.id) as any[]
    if (!menu.length) continue
    // A café's favourites are ordered far more than the rest of the menu.
    const favs = String(r.featured_items ?? '')
      .split(',')
      .map((x) => menu.find((m) => String(m.id) === x.trim()))
      .filter(Boolean)
    const pool: [any, number][] = menu.map((m) => [m, favs.includes(m) ? 9 : 1])

    for (let n = 0; n < count && queue.length; n++) {
      const who = queue.splice(Math.floor(rand() * queue.length), 1)[0]
      const daysAgo = Math.floor(Math.pow(rand(), 0.8) * 28)
      const hour = weighted(HOURS)
      // The hour is India time; stored as UTC, five and a half hours earlier.
      const at = new Date(now - daysAgo * 86400000)
      at.setUTCHours(hour, Math.floor(rand() * 60), Math.floor(rand() * 60), 0)
      at.setTime(at.getTime() - 330 * 60000)
      if (at.getTime() > now) at.setTime(at.getTime() - 86400000)

      orderId += 1
      const lines = 1 + Math.floor(rand() * rand() * 3)
      let total = 0
      const chosen = new Set<number>()
      for (let l = 0; l < lines; l++) {
        const m = weighted(pool)
        if (chosen.has(m.id)) continue
        chosen.add(m.id)
        const qty = rand() < 0.8 ? 1 : 2
        total += m.price_cents * qty
        itemId += 1
        addItem.run(itemId, orderId, r.id, m.name, qty, m.price_cents, sqlTime(at))
      }
      const mode = weighted<string>([['', 7], ['takeaway', 2], ['car', 1]])
      const app = mode === 'takeaway' || mode === 'car' || rand() < 0.65
      addFact.run(
        orderId,
        r.id,
        sqlTime(at),
        total,
        'PAID',
        app ? 'app' : 'cash',
        mode === 'car' ? 'car' : 'dine_in',
        'dine_in',
        who.key,
        sqlTime(new Date(at.getTime() + (40 + rand() * 200) * 1000)),
        `K${String(1000 + orderId)}`,
        who.name,
        mode === 'takeaway' ? 1 : 0,
      )
      if (app) addPayment.run(orderId, 'upi')
      d.prepare('INSERT INTO orders (id) VALUES (?)').run(orderId)
    }
  }

  // Visits: three to four people look for every one who orders, and most
  // arrive by the table QR.
  if (visitsSql) {
    const addVisit = d.prepare(
      `INSERT INTO page_visits (at, visitor, path, page, restaurant_id, source, referrer, landing)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const revery = (db.prepare("SELECT id FROM restaurants WHERE slug = 'revery'").get() as any)?.id ?? null
    const sources: [string, number][] = [['qr', 52], ['instagram', 16], ['direct', 12], ['search', 9], ['whatsapp', 8], ['app', 3]]
    for (let v = 0; v < 190; v++) {
      const visitor = `sample-visitor-${v}`
      const source = weighted(sources)
      const at = new Date(now - Math.floor(Math.pow(rand(), 0.8) * 28) * 86400000)
      at.setUTCHours(weighted(HOURS), Math.floor(rand() * 60), 0, 0)
      at.setTime(Math.min(now, at.getTime() - 330 * 60000))
      const place = source === 'qr' ? revery : rand() < 0.7 ? revery : pick(PLACES.map(([s]) => s))
      const placeId =
        typeof place === 'number' ? place : ((db.prepare('SELECT id FROM restaurants WHERE slug = ?').get(place) as any)?.id ?? revery)
      const path = source === 'qr' ? '/t/sample' : source === 'search' || source === 'direct' ? '/' : `/r/${placeId}`
      const page = source === 'qr' ? 'table-qr' : path === '/' ? 'home' : 'menu'
      const referrer = source === 'instagram' ? 'instagram.com' : source === 'search' ? 'google.com' : ''
      addVisit.run(sqlTime(at), visitor, path, page, page === 'home' ? null : placeId, source, referrer, 1)
      let t = at.getTime()
      const step = (p: string, kind: string, rid: number | null) => {
        t += 20000 + rand() * 60000
        addVisit.run(sqlTime(new Date(Math.min(now, t))), visitor, p, kind, rid, source, '', 0)
      }
      if (page !== 'menu') step(`/r/${placeId}`, 'menu', placeId)
      if (v < 70) step('/checkout', 'checkout', null)
      if (v < 56) step('/order/sample', 'order', null)
    }
  }

  cached = { built: today, d }
  return d
}

export const demoInsights = (opts: { days: number; restaurantId?: number | null }) => insights(opts, sample())
export const demoLive = () => liveCount(sample())
export const demoOrders = (opts: Parameters<typeof orderList>[0]) => orderList(opts, sample())
export const demoVisits = (opts: { days: number; restaurantId?: number | null }) => visitStats(opts, sample())
