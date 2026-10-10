/**
 * Scratch cards: a small prize, now and then, for ordering again.
 *
 * How often one comes is the restaurant's call: every order, every second,
 * every third, or never. Revery runs it on every order. That is the most
 * generous setting and the one to watch — a prize that always comes is a
 * standing discount with a scratch animation on top, and the cost is real
 * even when each prize is small.
 *
 * The prizes are deliberately small. A café's margin is not a lottery, and
 * ₹10 off a ₹180 order is a nice surprise rather than a discount somebody
 * plans their evening around. The two percentage prizes are capped for the
 * same reason: 20% off a ₹2,000 table booking is not a scratch card, it is an
 * accident.
 *
 * How it hangs together:
 *
 *   won    — minted when an order is placed, if this customer is due one
 *   scratched — the customer rubbed it and saw the prize. Theirs now.
 *   used   — it came off a later order, automatically, with no code to type
 *
 * A card is won on one order and spent on the next: the order that earned it
 * has already been paid for by the time it appears. That is also why it can be
 * trusted — the prize is decided by the server when the card is minted, and
 * the client is only ever told what it already holds.
 */
import { db } from './db.ts'

export type ScratchKind = 'flat' | 'percent'

export type ScratchCard = {
  id: number
  restaurantId: number
  kind: ScratchKind
  /** Rupees for `flat`, percentage points for `percent`. */
  value: number
  /** The most a percentage prize can take off. Null for a flat one. */
  maxOffCents: number | null
  minOrderCents: number
  scratchedAt: string | null
  usedOnOrderId: number | null
  expiresAt: string
  /** What it says on the front, once it is scratched. */
  label: string
}

db.exec(`
CREATE TABLE IF NOT EXISTS scratch_cards (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id    INTEGER NOT NULL,
  customer_key     TEXT    NOT NULL,
  won_on_order_id  INTEGER,
  kind             TEXT    NOT NULL,
  value            INTEGER NOT NULL,
  max_off_cents    INTEGER,
  min_order_cents  INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  scratched_at     TEXT,
  used_on_order_id INTEGER,
  expires_at       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scratch_owner ON scratch_cards(restaurant_id, customer_key);
CREATE INDEX IF NOT EXISTS idx_scratch_order ON scratch_cards(won_on_order_id);
`)

/**
 * Who this is, across orders.
 *
 * The same rule the insights tables use: the last ten digits of the phone
 * number, because a guest leaves no account behind and that number is the one
 * thing they give every time. Signed-in customers key on the account instead,
 * so changing phone does not lose their card.
 */
export function customerKey(userId: number | null, phone: string): string {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length >= 10) return 'p' + digits.slice(-10)
  if (userId) return 'u' + userId
  return ''
}

/**
 * The prizes, and how often each one comes up.
 *
 * Percentages only, never a flat rupee amount. A percentage scales with the
 * basket, so it is never out of proportion to what was ordered: "₹20 off"
 * is a pleasant surprise on a ₹180 dinner and half the bill on a ₹40 coffee,
 * while 20% is 20% of whatever was actually bought.
 *
 * Weighted so the small ones are most of what gets won — 5% is the usual
 * outcome and 20% is the one somebody mentions to a friend.
 *
 * Capped, because a percentage that scales up also scales up: 20% of a table
 * of eight is a bill the restaurant did not agree to. The cap is what keeps
 * the money small while the number on the card stays worth winning.
 */
const PRIZES: { kind: ScratchKind; value: number; weight: number; maxOffCents: number | null; minOrderCents: number }[] = [
  { kind: 'percent', value: 5, weight: 60, maxOffCents: 3000, minOrderCents: 9900 },
  { kind: 'percent', value: 10, weight: 25, maxOffCents: 5000, minOrderCents: 9900 },
  { kind: 'percent', value: 15, weight: 10, maxOffCents: 6000, minOrderCents: 9900 },
  { kind: 'percent', value: 20, weight: 5, maxOffCents: 8000, minOrderCents: 9900 },
]

/** How long a card is good for once it has been won. */
const GOOD_FOR_DAYS = 30

function drawPrize() {
  const total = PRIZES.reduce((n, p) => n + p.weight, 0)
  // Not Math.random() alone: a draw that can be predicted is a draw somebody
  // can wait for. crypto gives a number nobody can line up against.
  const roll = (crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * total
  let seen = 0
  for (const p of PRIZES) {
    seen += p.weight
    if (roll < seen) return p
  }
  return PRIZES[0]
}

export function labelFor(kind: ScratchKind, value: number): string {
  return kind === 'flat' ? `₹${value} off` : `${value}% off`
}

function shape(row: any): ScratchCard {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    kind: row.kind as ScratchKind,
    value: row.value,
    maxOffCents: row.max_off_cents ?? null,
    minOrderCents: row.min_order_cents ?? 0,
    scratchedAt: row.scratched_at ?? null,
    usedOnOrderId: row.used_on_order_id ?? null,
    expiresAt: row.expires_at,
    label: labelFor(row.kind, row.value),
  }
}

/**
 * Has this customer earned one with this order?
 *
 * Counted on orders they have actually placed at this restaurant, so every
 * second order means their second here rather than a number carried in from
 * somewhere else. `every` of 1 is every order; 0 is switched off.
 */
export function maybeAward(input: {
  restaurantId: number
  orderId: number
  userId: number | null
  phone: string
}): ScratchCard | null {
  const r = db
    .prepare('SELECT scratch_every FROM restaurants WHERE id = ?')
    .get(input.restaurantId) as any
  // 0 is off. 1 is every order, 2 every second, and so on.
  const every = Number(r?.scratch_every ?? 0)
  if (!every || every < 1) return null

  const key = customerKey(input.userId, input.phone)
  if (!key) return null

  // Their order count here, this one included. The trigger that fills
  // order_facts has already run by the time this is called.
  const seen = db
    .prepare(
      `SELECT COUNT(*) AS n FROM order_facts
       WHERE restaurant_id = ? AND customer_key = ? AND status NOT IN ('CANCELLED', 'DECLINED')`,
    )
    .get(input.restaurantId, key) as any
  const count = Number(seen?.n ?? 0)
  if (count < 1 || count % every !== 0) return null

  // One card per order, whatever else happens. A retry must not mint a second.
  const already = db
    .prepare('SELECT * FROM scratch_cards WHERE won_on_order_id = ?')
    .get(input.orderId) as any
  if (already) return shape(already)

  const prize = drawPrize()
  const info = db
    .prepare(
      `INSERT INTO scratch_cards
        (restaurant_id, customer_key, won_on_order_id, kind, value, max_off_cents, min_order_cents, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+${GOOD_FOR_DAYS} days'))`,
    )
    .run(input.restaurantId, key, input.orderId, prize.kind, prize.value, prize.maxOffCents, prize.minOrderCents)
  return shape(db.prepare('SELECT * FROM scratch_cards WHERE id = ?').get(Number(info.lastInsertRowid)))
}

/** The card won on this order, if there is one. */
export function cardForOrder(orderId: number): ScratchCard | null {
  const row = db.prepare('SELECT * FROM scratch_cards WHERE won_on_order_id = ?').get(orderId) as any
  return row ? shape(row) : null
}

/**
 * Rub it off.
 *
 * The prize was decided when the card was minted, so this only records that
 * they have seen it — there is nothing here for a client to influence. Calling
 * it twice is not an error: a phone that loses the response still has a card,
 * and asking again should show the same prize rather than a failure.
 */
export function scratch(cardId: number, orderId: number): ScratchCard | null {
  const row = db
    .prepare('SELECT * FROM scratch_cards WHERE id = ? AND won_on_order_id = ?')
    .get(cardId, orderId) as any
  if (!row) return null
  if (!row.scratched_at) {
    db.prepare("UPDATE scratch_cards SET scratched_at = datetime('now') WHERE id = ?").run(cardId)
  }
  return shape(db.prepare('SELECT * FROM scratch_cards WHERE id = ?').get(cardId))
}

/**
 * The card waiting to come off this order, if one fits.
 *
 * Scratched first of all: a card nobody rubbed is not a prize they won, it is
 * a prize they were offered and left. Nothing comes off a bill for it, and it
 * expires where it sits. That is the whole point of the scratching — it is the
 * moment the prize becomes theirs, and a prize that applied itself quietly
 * would make the card a decoration on a discount they already had.
 *
 * Then unspent, unexpired, and for a bill big enough to carry it. The oldest
 * first, so a card does not sit until it dies while newer ones are spent
 * ahead of it.
 */
export function cardToSpend(restaurantId: number, key: string, subtotalCents: number): ScratchCard | null {
  if (!key) return null
  const row = db
    .prepare(
      `SELECT * FROM scratch_cards
       WHERE restaurant_id = ? AND customer_key = ?
         AND scratched_at IS NOT NULL AND used_on_order_id IS NULL
         AND expires_at > datetime('now') AND min_order_cents <= ?
       ORDER BY created_at ASC LIMIT 1`,
    )
    .get(restaurantId, key, subtotalCents) as any
  return row ? shape(row) : null
}

/** What it takes off a bill of this size. */
export function discountFor(card: ScratchCard, subtotalCents: number): number {
  if (subtotalCents < card.minOrderCents) return 0
  const off =
    card.kind === 'flat'
      ? card.value * 100
      : Math.round((subtotalCents * card.value) / 100)
  const capped = card.maxOffCents ? Math.min(off, card.maxOffCents) : off
  // Never more than the food. A free order was not the offer.
  return Math.max(0, Math.min(capped, subtotalCents))
}

/** Spend it. Guarded so two orders at once cannot both take the same card. */
export function spend(cardId: number, orderId: number): boolean {
  const done = db
    .prepare('UPDATE scratch_cards SET used_on_order_id = ? WHERE id = ? AND used_on_order_id IS NULL')
    .run(orderId, cardId)
  return done.changes > 0
}
