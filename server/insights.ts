/**
 * Khapee's own numbers — for whoever runs Khapee, not for any one restaurant.
 *
 * Read from a record of its own rather than from `orders`, because orders can
 * now be removed: a restaurant clearing its history, or taking one ticket
 * off, would otherwise take that order out of "how many people have ordered
 * through Khapee" and out of every chart, and the count would go backwards.
 *
 * The record is kept by the database itself, with triggers, so no code path —
 * a checkout, a waiter's round, the till, an import — can forget to write it.
 * Deleting an order does not touch it. Existing orders are copied in once.
 *
 * Times are stored as SQLite writes them (UTC) and read in India time, since
 * "which hour are we busiest" means the hour on the wall in Indore.
 */
import { db } from './db.ts'

db.exec(`
CREATE TABLE IF NOT EXISTS order_facts (
  order_id        INTEGER PRIMARY KEY,
  restaurant_id   INTEGER NOT NULL,
  created_at      TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT '',
  total_cents     INTEGER NOT NULL DEFAULT 0,
  payment_status  TEXT    NOT NULL DEFAULT 'UNPAID',
  payment_method  TEXT    NOT NULL DEFAULT '',
  service_mode    TEXT    NOT NULL DEFAULT '',
  order_type      TEXT    NOT NULL DEFAULT '',
  customer_key    TEXT    NOT NULL DEFAULT '',
  accepted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_facts_created ON order_facts(created_at);
CREATE INDEX IF NOT EXISTS idx_order_facts_restaurant ON order_facts(restaurant_id, created_at);

CREATE TABLE IF NOT EXISTS order_item_facts (
  item_id          INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL,
  restaurant_id    INTEGER NOT NULL,
  name             TEXT    NOT NULL,
  quantity         INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  accepted         INTEGER,
  created_at       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_item_facts_order ON order_item_facts(order_id);
`)

/*
 * Who "a person" is. A phone number is the best handle there is — most
 * orders are placed without an account — so the last ten digits of it, with
 * the spaces, dashes and +91 taken off. Failing that the account; failing
 * that, the order itself, so somebody with neither is still counted once.
 */
const CUSTOMER_KEY = (o: string) => `
  CASE
    WHEN length(replace(replace(replace(replace(replace(COALESCE(${o}.contact_phone, ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')) >= 10
      THEN 'p' || substr(replace(replace(replace(replace(replace(${o}.contact_phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), -10)
    WHEN ${o}.user_id IS NOT NULL THEN 'u' || ${o}.user_id
    ELSE 'o' || ${o}.id
  END`

db.exec(`
CREATE TRIGGER IF NOT EXISTS facts_order_insert AFTER INSERT ON orders BEGIN
  INSERT OR IGNORE INTO order_facts
    (order_id, restaurant_id, created_at, status, total_cents, payment_status, payment_method, service_mode, order_type, customer_key)
  VALUES (NEW.id, NEW.restaurant_id, NEW.created_at, NEW.status, NEW.total_cents, NEW.payment_status,
          COALESCE(NEW.payment_method, ''), COALESCE(NEW.service_mode, ''), NEW.order_type, ${CUSTOMER_KEY('NEW')});
END;

CREATE TRIGGER IF NOT EXISTS facts_order_update AFTER UPDATE ON orders BEGIN
  UPDATE order_facts SET
    status = NEW.status,
    total_cents = NEW.total_cents,
    payment_status = NEW.payment_status,
    payment_method = COALESCE(NEW.payment_method, ''),
    service_mode = COALESCE(NEW.service_mode, ''),
    customer_key = ${CUSTOMER_KEY('NEW')},
    accepted_at = CASE
      WHEN accepted_at IS NULL AND NEW.status NOT IN ('REQUESTED', 'NEW', 'CANCELLED', 'DECLINED')
        THEN datetime('now') ELSE accepted_at END
  WHERE order_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS facts_item_insert AFTER INSERT ON order_items BEGIN
  INSERT OR IGNORE INTO order_item_facts
    (item_id, order_id, restaurant_id, name, quantity, unit_price_cents, accepted, created_at)
  VALUES (NEW.id, NEW.order_id, (SELECT restaurant_id FROM orders WHERE id = NEW.order_id),
          NEW.name, NEW.quantity, NEW.unit_price_cents, NEW.accepted, datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS facts_item_update AFTER UPDATE ON order_items BEGIN
  UPDATE order_item_facts SET quantity = NEW.quantity, accepted = NEW.accepted, name = NEW.name
   WHERE item_id = NEW.id;
END;
`)

// Everything that was ordered before the record existed, copied in once.
// INSERT OR IGNORE, so it is harmless on every later start.
db.exec(`
INSERT OR IGNORE INTO order_facts
  (order_id, restaurant_id, created_at, status, total_cents, payment_status, payment_method, service_mode, order_type, customer_key, accepted_at)
SELECT o.id, o.restaurant_id, o.created_at, o.status, o.total_cents, o.payment_status,
       COALESCE(o.payment_method, ''), COALESCE(o.service_mode, ''), o.order_type, ${CUSTOMER_KEY('o')},
       (SELECT MIN(e.created_at) FROM order_events e WHERE e.order_id = o.id AND e.status = 'ACCEPTED')
  FROM orders o;
INSERT OR IGNORE INTO order_item_facts
  (item_id, order_id, restaurant_id, name, quantity, unit_price_cents, accepted, created_at)
SELECT i.id, i.order_id, o.restaurant_id, i.name, i.quantity, i.unit_price_cents, i.accepted, o.created_at
  FROM order_items i JOIN orders o ON o.id = i.order_id;
`)

/** Whoever may see these: a list of account emails, kept out of the repository. */
export function canSeeInsights(user: { id: number; email?: string } | undefined): boolean {
  if (!user) return false
  const allowed = String(process.env.KHAPEE_INSIGHTS_EMAILS ?? process.env.KHAPEE_OWNER_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (!allowed.length) return false
  const email = String(
    user.email ?? (db.prepare('SELECT email FROM users WHERE id = ?').get(user.id) as any)?.email ?? '',
  )
    .trim()
    .toLowerCase()
  return !!email && allowed.includes(email)
}

/** India time, as SQLite reads it. */
const IST = `datetime(f.created_at, '+330 minutes')`
/** An order that happened, as opposed to one called off. */
const REAL = `f.status NOT IN ('CANCELLED', 'DECLINED')`

/** The number on the wall: everyone who has ever ordered, updated with every order. */
export function liveCount() {
  const all = db
    .prepare(`SELECT COUNT(*) AS orders, COUNT(DISTINCT customer_key) AS people FROM order_facts f WHERE ${REAL}`)
    .get() as any
  const today = db
    .prepare(
      `SELECT COUNT(*) AS orders, COUNT(DISTINCT customer_key) AS people FROM order_facts f
        WHERE ${REAL} AND date(${IST}) = date('now', '+330 minutes')`,
    )
    .get() as any
  const last = db.prepare(`SELECT MAX(created_at) AS at FROM order_facts`).get() as any
  return {
    orders: Number(all.orders),
    people: Number(all.people),
    todayOrders: Number(today.orders),
    todayPeople: Number(today.people),
    lastOrderAt: last?.at ?? null,
  }
}

/**
 * Everything else, for a period and optionally one restaurant.
 *
 * `days` 0 means all time. Every figure is computed over the same slice so the
 * numbers on the page agree with each other.
 */
export function insights(opts: { days: number; restaurantId?: number | null }) {
  const days = Math.max(0, Math.min(3650, Math.floor(opts.days || 0)))
  const where: string[] = []
  const params: any[] = []
  if (days) where.push(`f.created_at >= datetime('now', '-${days} days')`)
  if (opts.restaurantId) {
    where.push('f.restaurant_id = ?')
    params.push(opts.restaurantId)
  }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const AND = where.length ? ' AND ' : 'WHERE '
  const all = (sql: string, extra: any[] = []) => db.prepare(sql).all(...params, ...extra) as any[]
  const one = (sql: string, extra: any[] = []) => db.prepare(sql).get(...params, ...extra) as any

  // --- Headline -------------------------------------------------------------
  const totals = one(`
    SELECT COUNT(*) AS placed,
           SUM(CASE WHEN ${REAL} THEN 1 ELSE 0 END) AS orders,
           SUM(CASE WHEN f.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
           SUM(CASE WHEN f.status = 'DECLINED' THEN 1 ELSE 0 END) AS declined,
           SUM(CASE WHEN ${REAL} THEN f.total_cents ELSE 0 END) AS revenue,
           COUNT(DISTINCT CASE WHEN ${REAL} THEN f.customer_key END) AS people
      FROM order_facts f ${W}`)
  const orders = Number(totals.orders ?? 0)
  const revenue = Number(totals.revenue ?? 0)

  // Returning = has at least one earlier real order, ever (not just in the period).
  const people = all(`
    SELECT f.customer_key AS k, COUNT(*) AS n, MIN(f.created_at) AS first_here
      FROM order_facts f ${W}${AND}${REAL}
     GROUP BY f.customer_key`)
  const firstEver = new Map(
    (db.prepare(`SELECT customer_key AS k, MIN(created_at) AS at FROM order_facts f WHERE ${REAL} GROUP BY customer_key`).all() as any[]).map(
      (r) => [r.k, r.at],
    ),
  )
  const newPeople = people.filter((p) => firstEver.get(p.k) === p.first_here).length
  const repeatInPeriod = people.filter((p) => Number(p.n) > 1).length

  const acceptTimes = all(`
    SELECT (julianday(f.accepted_at) - julianday(f.created_at)) * 1440 AS mins
      FROM order_facts f ${W}${AND}f.accepted_at IS NOT NULL`)
    .map((r) => Number(r.mins))
    .filter((m) => m >= 0 && m < 240)
    .sort((a, b) => a - b)
  const median = (xs: number[]) => (xs.length ? xs[Math.floor((xs.length - 1) / 2)] : null)

  const items = one(`
    SELECT COALESCE(SUM(i.quantity), 0) AS n
      FROM order_item_facts i JOIN order_facts f ON f.order_id = i.order_id
      ${W}${AND}${REAL} AND (i.accepted IS NULL OR i.accepted = 1)`)

  // --- When -----------------------------------------------------------------
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, revenue: 0 }))
  for (const r of all(`
    SELECT CAST(strftime('%H', ${IST}) AS INTEGER) AS h, COUNT(*) AS n, SUM(f.total_cents) AS rev
      FROM order_facts f ${W}${AND}${REAL} GROUP BY h`)) {
    byHour[r.h].orders = Number(r.n)
    byHour[r.h].revenue = Number(r.rev)
  }
  // Monday first, as a week is read in India.
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const r of all(`
    SELECT (CAST(strftime('%w', ${IST}) AS INTEGER) + 6) % 7 AS d,
           CAST(strftime('%H', ${IST}) AS INTEGER) AS h, COUNT(*) AS n
      FROM order_facts f ${W}${AND}${REAL} GROUP BY d, h`)) {
    heat[r.d][r.h] = Number(r.n)
  }
  const byDay = all(`
    SELECT date(${IST}) AS day, COUNT(*) AS orders, SUM(f.total_cents) AS revenue,
           COUNT(DISTINCT f.customer_key) AS people
      FROM order_facts f ${W}${AND}${REAL} GROUP BY day ORDER BY day`).map((r) => ({
    day: r.day,
    orders: Number(r.orders),
    revenue: Number(r.revenue),
    people: Number(r.people),
  }))

  // --- What -----------------------------------------------------------------
  const dishes = all(`
    SELECT i.name, SUM(i.quantity) AS qty, SUM(i.quantity * i.unit_price_cents) AS revenue,
           COUNT(DISTINCT i.order_id) AS orders, COUNT(DISTINCT f.customer_key) AS people,
           COUNT(DISTINCT i.restaurant_id) AS places
      FROM order_item_facts i JOIN order_facts f ON f.order_id = i.order_id
      ${W}${AND}${REAL} AND (i.accepted IS NULL OR i.accepted = 1)
     GROUP BY lower(trim(i.name)) ORDER BY qty DESC, revenue DESC LIMIT 20`).map((r) => ({
    name: r.name,
    qty: Number(r.qty),
    revenue: Number(r.revenue),
    orders: Number(r.orders),
    people: Number(r.people),
    places: Number(r.places),
  }))
  const unavailable = all(`
    SELECT i.name, SUM(i.quantity) AS qty, COUNT(DISTINCT i.order_id) AS orders
      FROM order_item_facts i JOIN order_facts f ON f.order_id = i.order_id
      ${W}${AND}i.accepted = 0
     GROUP BY lower(trim(i.name)) ORDER BY orders DESC, qty DESC LIMIT 10`).map((r) => ({
    name: r.name,
    qty: Number(r.qty),
    orders: Number(r.orders),
  }))
  // Dishes ordered together: every pair within one order, counted once per order.
  const pairs = all(`
    SELECT a.name AS a, b.name AS b, COUNT(DISTINCT a.order_id) AS n
      FROM order_item_facts a
      JOIN order_item_facts b ON b.order_id = a.order_id AND lower(trim(a.name)) < lower(trim(b.name))
      JOIN order_facts f ON f.order_id = a.order_id
      ${W}${AND}${REAL} AND (a.accepted IS NULL OR a.accepted = 1) AND (b.accepted IS NULL OR b.accepted = 1)
     GROUP BY lower(trim(a.name)), lower(trim(b.name)) HAVING n > 1 ORDER BY n DESC LIMIT 8`).map((r) => ({
    a: r.a,
    b: r.b,
    orders: Number(r.n),
  }))
  const basket = all(`
    SELECT n, COUNT(*) AS orders FROM (
      SELECT f.order_id, SUM(i.quantity) AS n
        FROM order_facts f JOIN order_item_facts i ON i.order_id = f.order_id
        ${W}${AND}${REAL} AND (i.accepted IS NULL OR i.accepted = 1)
       GROUP BY f.order_id)
     GROUP BY CASE WHEN n >= 6 THEN 6 ELSE n END ORDER BY n`).map((r) => ({
    items: Math.min(6, Number(r.n)),
    orders: Number(r.orders),
  }))

  // --- How ------------------------------------------------------------------
  const MODE = `CASE
      WHEN f.service_mode = 'car' THEN 'From the car'
      WHEN f.service_mode = 'delivery' THEN 'Delivery'
      WHEN f.service_mode = 'precinct' THEN 'Nearby spot'
      WHEN f.order_type = 'pickup' THEN 'Pickup'
      ELSE 'At the table' END`
  const modes = all(`
    SELECT ${MODE} AS mode, COUNT(*) AS orders, SUM(f.total_cents) AS revenue
      FROM order_facts f ${W}${AND}${REAL} GROUP BY mode ORDER BY orders DESC`).map((r) => ({
    mode: r.mode,
    orders: Number(r.orders),
    revenue: Number(r.revenue),
  }))
  const payments = all(`
    SELECT CASE WHEN f.payment_method = 'app' OR EXISTS (
                  SELECT 1 FROM payments p WHERE p.order_id = f.order_id AND p.method = 'upi')
                THEN 'UPI in the app' ELSE 'Cash / at the counter' END AS method,
           COUNT(*) AS orders, SUM(f.total_cents) AS revenue
      FROM order_facts f ${W}${AND}${REAL} GROUP BY method ORDER BY orders DESC`).map((r) => ({
    method: r.method,
    orders: Number(r.orders),
    revenue: Number(r.revenue),
  }))

  // --- Where ----------------------------------------------------------------
  const places = all(`
    SELECT f.restaurant_id AS id, COALESCE(r.name, 'Removed restaurant') AS name,
           SUM(CASE WHEN ${REAL} THEN 1 ELSE 0 END) AS orders,
           SUM(CASE WHEN ${REAL} THEN f.total_cents ELSE 0 END) AS revenue,
           COUNT(DISTINCT CASE WHEN ${REAL} THEN f.customer_key END) AS people,
           SUM(CASE WHEN NOT (${REAL}) THEN 1 ELSE 0 END) AS called_off,
           COUNT(*) AS placed
      FROM order_facts f LEFT JOIN restaurants r ON r.id = f.restaurant_id
      ${W} GROUP BY f.restaurant_id ORDER BY orders DESC, revenue DESC`).map((r) => {
    const peak = db
      .prepare(
        `SELECT CAST(strftime('%H', ${IST}) AS INTEGER) AS h, COUNT(*) AS n FROM order_facts f
          ${W}${AND}${REAL} AND f.restaurant_id = ? GROUP BY h ORDER BY n DESC, h LIMIT 1`,
      )
      .get(...params, r.id) as any
    const top = db
      .prepare(
        `SELECT i.name, SUM(i.quantity) AS q FROM order_item_facts i JOIN order_facts f ON f.order_id = i.order_id
          ${W}${AND}${REAL} AND f.restaurant_id = ? AND (i.accepted IS NULL OR i.accepted = 1)
          GROUP BY lower(trim(i.name)) ORDER BY q DESC LIMIT 1`,
      )
      .get(...params, r.id) as any
    const accepts = (
      db
        .prepare(
          `SELECT (julianday(f.accepted_at) - julianday(f.created_at)) * 1440 AS m FROM order_facts f
            ${W}${AND}f.accepted_at IS NOT NULL AND f.restaurant_id = ?`,
        )
        .all(...params, r.id) as any[]
    )
      .map((x) => Number(x.m))
      .filter((m) => m >= 0 && m < 240)
      .sort((a, b) => a - b)
    return {
      id: r.id,
      name: r.name,
      orders: Number(r.orders),
      revenue: Number(r.revenue),
      people: Number(r.people),
      avgCents: Number(r.orders) ? Math.round(Number(r.revenue) / Number(r.orders)) : 0,
      calledOffRate: Number(r.placed) ? Number(r.called_off) / Number(r.placed) : 0,
      peakHour: peak ? Number(peak.h) : null,
      topDish: top?.name ?? null,
      medianAcceptMins: median(accepts),
    }
  })

  return {
    period: { days, restaurantId: opts.restaurantId ?? null },
    totals: {
      placed: Number(totals.placed ?? 0),
      orders,
      revenue,
      people: Number(totals.people ?? 0),
      newPeople,
      returningPeople: people.length - newPeople,
      repeatInPeriod,
      avgOrderCents: orders ? Math.round(revenue / orders) : 0,
      itemsPerOrder: orders ? Number(items.n) / orders : 0,
      cancelled: Number(totals.cancelled ?? 0),
      declined: Number(totals.declined ?? 0),
      medianAcceptMins: median(acceptTimes),
    },
    byHour,
    heat,
    byDay,
    dishes,
    unavailable,
    pairs,
    basket,
    modes,
    payments,
    places,
    restaurants: (db.prepare('SELECT id, name FROM restaurants ORDER BY name').all() as any[]).map((r) => ({
      id: r.id,
      name: r.name,
    })),
  }
}
