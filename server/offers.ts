/**
 * A restaurant's offer for people from one place — the first being 20% off at
 * Mr. Beans Saket for anyone with a @dalycollege.org email.
 *
 * The customer must be signed in with that email confirmed by Google
 * ("Continue with Google", routes/auth.ts) — a typed address proves nothing —
 * and must press Apply on the coupon; it is never applied on its own. The
 * address rides on the order and is shown to the restaurant beside it.
 *
 * The discount is a share of the dishes, never of a delivery fee, and it is
 * kept as a percentage on the order so that when the kitchen declines a dish
 * the discount is worked out again on what is left.
 */
import { db } from './db.ts'

db.exec(`
CREATE TABLE IF NOT EXISTS restaurant_offers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  email_domain  TEXT    NOT NULL,
  percent       INTEGER NOT NULL,
  label         TEXT    NOT NULL DEFAULT '',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_restaurant_offers ON restaurant_offers(restaurant_id, is_active);
`)

/*
 * The first one: 20% off at Mr. Beans Saket for Daly College. Made once, if
 * that restaurant has never had an offer, so switching it off later is not
 * undone on the next start.
 */
{
  const r = db.prepare("SELECT id FROM restaurants WHERE slug = 'mr-beans-saket'").get() as any
  if (r && !db.prepare('SELECT 1 FROM restaurant_offers WHERE restaurant_id = ?').get(r.id)) {
    db.prepare(
      "INSERT INTO restaurant_offers (restaurant_id, email_domain, percent, label) VALUES (?, 'dalycollege.org', 20, 'Daly College')",
    ).run(r.id)
  }
}

export type Offer = { id: number; domain: string; percent: number; label: string }

/** The offer running at a restaurant right now, if it has one. */
export function offerFor(restaurantId: number): Offer | null {
  const row = db
    .prepare('SELECT * FROM restaurant_offers WHERE restaurant_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1')
    .get(restaurantId) as any
  if (!row) return null
  return { id: row.id, domain: String(row.email_domain).toLowerCase(), percent: Number(row.percent), label: row.label }
}

/** The email, tidied, if it really ends in the offer's domain; otherwise null. */
export function qualifyingEmail(offer: Offer | null, email: unknown): string | null {
  if (!offer) return null
  const e = String(email ?? '').trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at < 1) return null
  const local = e.slice(0, at)
  const domain = e.slice(at + 1)
  if (domain !== offer.domain) return null
  if (!/^[a-z0-9._%+-]+$/.test(local)) return null
  return e
}

/** The discount on a dish total, in paise, rounded to the rupee. */
export function discountOn(dishesCents: number, percent: number): number {
  if (!(percent > 0) || dishesCents <= 0) return 0
  return Math.min(dishesCents, Math.round((dishesCents * percent) / 100 / 100) * 100)
}
