import { randomBytes } from 'node:crypto'
import { db } from './db.ts'
import { flowFor } from '../shared/orders.ts'
import { serviceOf } from './order-status.ts'
import { computeBill } from './tax.ts'

/**
 * Petpooja, the till that is already on the counter.
 * ---------------------------------------------------------------------------
 * Half the kitchens worth having in Indore run Petpooja, and the ones that do
 * have solved — years ago, on a Windows machine with a thermal printer bolted
 * to it — every problem Khapee keeps rediscovering: printing a KOT, printing a
 * bill, keeping a menu, knowing what sold out. The right move is not to
 * out-build that. It is to put our orders inside it.
 *
 * What that buys, concretely: an order placed on a customer's phone appears on
 * the restaurant's own till in Pending state. They press Accept there, exactly
 * as they do for somebody standing at the counter, and their own printer
 * prints the KOT and the bill. Khapee never has to print anything for those
 * restaurants, and the staff never have to learn a second screen.
 *
 * There is no printing API here and there is not meant to be. The word does
 * not appear anywhere in Petpooja's documentation, because printing is what
 * their POS does once an order is in it — which is the whole point.
 *
 * Ten endpoints, in two directions:
 *
 *   We call them          saveorder, orderstatus, fetchmenu
 *   They call us          pushmenu, item_stock, get_store_status,
 *                         update_store_status, callback
 *
 * Everything outbound is in this file. Everything inbound is in
 * server/routes/petpooja.ts, which does the HTTP and calls back in here.
 */

/** Live endpoints are per-integration; these are the documented dev ones. */
const DEV = {
  saveOrder: 'https://47pfzh5sf2.execute-api.ap-southeast-1.amazonaws.com/V1/save_order',
  orderStatus: 'https://qle1yy2ydc.execute-api.ap-southeast-1.amazonaws.com/V1/update_order_status',
  fetchMenu: 'https://qle1yy2ydc.execute-api.ap-southeast-1.amazonaws.com/V1/mapped_restaurant_menus',
}

/**
 * Where the calls go.
 *
 * Petpooja hand out a production host per integration and it is not in the
 * documentation, so it is an environment variable and the staging URLs are
 * the default. A deployment with no variable set talks to staging, which is
 * the right way round: the failure mode of a missing variable is a test
 * order, not a real one on a real counter.
 */
function endpoint(name: keyof typeof DEV): string {
  const base = process.env.PETPOOJA_BASE_URL?.replace(/\/+$/, '')
  if (!base) return DEV[name]
  const path = { saveOrder: 'save_order', orderStatus: 'update_order_status', fetchMenu: 'mapped_restaurant_menus' }[name]
  return `${base}/${path}`
}

export type Link = {
  id: number
  restaurantId: number
  restId: string
  menusharingCode: string
  appKey: string
  appSecret: string
  accessToken: string
  webhookSecret: string
  enabled: boolean
  pushOrders: boolean
  lastMenuAt: string | null
  lastOrderAt: string | null
  lastError: string
}

function shapeLink(row: any): Link {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    restId: row.rest_id,
    menusharingCode: row.menusharing_code ?? '',
    // The application credentials, restaurant first and environment second.
    appKey: row.app_key || process.env.PETPOOJA_APP_KEY || '',
    appSecret: row.app_secret || process.env.PETPOOJA_APP_SECRET || '',
    accessToken: row.access_token || process.env.PETPOOJA_ACCESS_TOKEN || '',
    webhookSecret: row.webhook_secret,
    enabled: !!row.enabled,
    pushOrders: !!row.push_orders,
    lastMenuAt: row.last_menu_at ?? null,
    lastOrderAt: row.last_order_at ?? null,
    lastError: row.last_error ?? '',
  }
}

export function linkFor(restaurantId: number): Link | null {
  const row = db.prepare('SELECT * FROM petpooja_links WHERE restaurant_id = ?').get(restaurantId) as any
  return row ? shapeLink(row) : null
}

/** Whoever this webhook URL belongs to. The secret is the whole credential. */
export function linkBySecret(secret: string): Link | null {
  if (!secret || secret.length < 16) return null
  const row = db.prepare('SELECT * FROM petpooja_links WHERE webhook_secret = ?').get(secret) as any
  return row ? shapeLink(row) : null
}

/** Their restID, used when a payload names the restaurant and not the URL. */
export function linkByRestId(restId: string): Link | null {
  const row = db.prepare('SELECT * FROM petpooja_links WHERE rest_id = ?').get(String(restId)) as any
  return row ? shapeLink(row) : null
}

export function saveLink(
  restaurantId: number,
  input: { restId: string; menusharingCode?: string; appKey?: string; appSecret?: string; accessToken?: string; enabled?: boolean; pushOrders?: boolean },
): Link {
  const existing = db.prepare('SELECT * FROM petpooja_links WHERE restaurant_id = ?').get(restaurantId) as any
  if (existing) {
    db.prepare(
      `UPDATE petpooja_links
          SET rest_id = ?, menusharing_code = ?, app_key = ?, app_secret = ?, access_token = ?,
              enabled = ?, push_orders = ?
        WHERE restaurant_id = ?`,
    ).run(
      input.restId.trim(),
      (input.menusharingCode ?? existing.menusharing_code ?? '').trim(),
      (input.appKey ?? existing.app_key ?? '').trim(),
      (input.appSecret ?? existing.app_secret ?? '').trim(),
      (input.accessToken ?? existing.access_token ?? '').trim(),
      input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
      input.pushOrders === undefined ? existing.push_orders : input.pushOrders ? 1 : 0,
      restaurantId,
    )
  } else {
    db.prepare(
      `INSERT INTO petpooja_links
         (restaurant_id, rest_id, menusharing_code, app_key, app_secret, access_token, webhook_secret, enabled, push_orders)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      restaurantId,
      input.restId.trim(),
      (input.menusharingCode ?? '').trim(),
      (input.appKey ?? '').trim(),
      (input.appSecret ?? '').trim(),
      (input.accessToken ?? '').trim(),
      // 32 bytes of URL-safe randomness. This is the only thing standing
      // between a stranger and somebody's menu, so it is not a short id.
      randomBytes(24).toString('base64url'),
      input.enabled === false ? 0 : 1,
      input.pushOrders === false ? 0 : 1,
    )
  }
  return linkFor(restaurantId)!
}

export function removeLink(restaurantId: number) {
  db.prepare('DELETE FROM petpooja_links WHERE restaurant_id = ?').run(restaurantId)
}

function note(restaurantId: number, error: string) {
  db.prepare('UPDATE petpooja_links SET last_error = ? WHERE restaurant_id = ?').run(error.slice(0, 400), restaurantId)
}

/** Whether there is enough to make a call at all. */
export function linkReady(link: Link | null): link is Link {
  return !!link && link.enabled && !!link.restId && !!link.appKey && !!link.appSecret && !!link.accessToken
}

/* --- Calling them ---------------------------------------------------------- */

type Reply = { ok: boolean; status: number; body: any; error: string }

async function call(url: string, body: any, headers: Record<string, string> = {}): Promise<Reply> {
  try {
    /* A counter is not going to wait fifteen seconds to be told the till is
       unreachable, and neither is a customer placing an order. */
    const stop = AbortSignal.timeout(12_000)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: stop,
    })
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text.slice(0, 500) }
    }
    // Petpooja answer 200 with success:"0" for business failures, so HTTP
    // status alone is not the answer to whether it worked.
    const succeeded = res.ok && (json?.success === undefined || String(json.success) === '1')
    return {
      ok: succeeded,
      status: res.status,
      body: json,
      error: succeeded ? '' : String(json?.message ?? `HTTP ${res.status}`),
    }
  } catch (e: any) {
    return { ok: false, status: 0, body: null, error: e?.name === 'TimeoutError' ? 'Petpooja did not answer in time' : String(e?.message ?? e) }
  }
}

const money = (cents: number) => (cents / 100).toFixed(2)

/**
 * One Khapee order, in the shape Petpooja's till expects.
 *
 * Kept as a pure function of rows that have already been read, so it can be
 * tested and looked at without a network anywhere near it — and so the exact
 * payload can be shown to a restaurant that asks what we are sending.
 *
 * Two mappings matter and both are ours to get right:
 *
 * order_type is D for anything eaten in, P for anything carried out. Khapee
 * has six service modes and Petpooja has three, so a car and a precinct
 * pickup are both parcels — which is what they are.
 *
 * The item ids must be theirs. An order containing a dish that has never come
 * through a menu push has no id to send, and rather than invent one the push
 * is refused: an order that arrives at a till with an item the till does not
 * know is worse than an order that arrives by the normal route.
 */
export function orderPayload(link: Link, order: any, items: any[], restaurant: any, callbackUrl: string) {
  const dineIn = order.service_mode === 'dine_in' || (order.order_type === 'dine_in' && !order.takeaway)
  const created = String(order.created_at ?? '').replace('T', ' ').slice(0, 19)
  const [date, time] = created.split(' ')

  return {
    app_key: link.appKey,
    app_secret: link.appSecret,
    access_token: link.accessToken,
    orderinfo: {
      OrderInfo: {
        Restaurant: {
          details: {
            res_name: restaurant.name ?? '',
            address: restaurant.address ?? '',
            contact_information: restaurant.phone ?? '',
            restID: link.restId,
          },
        },
        Customer: {
          details: {
            email: '',
            name: order.customer_name ?? '',
            address: order.delivery_address ?? '',
            phone: String(order.contact_phone ?? order.delivery_phone ?? '').replace(/\D/g, '').slice(-10),
            latitude: '',
            longitude: '',
          },
        },
        Order: {
          details: {
            orderID: order.order_number,
            preorder_date: date ?? '',
            preorder_time: time ?? '',
            service_charge: '0.00',
            sc_tax_amount: '0.00',
            delivery_charges: money(order.delivery_fee_cents ?? 0),
            dc_tax_percentage: '0',
            dc_tax_amount: '0.00',
            packing_charges: '0.00',
            pc_tax_amount: '0.00',
            pc_tax_percentage: '0',
            /* The tax the customer is actually being charged.
               See the note on taxOf below for why this is not simply left to
               their till to work out. */
            order_type: dineIn ? 'D' : 'P',
            /* Their name for the table when we know it, ours only as a last
               resort — a table_no their till does not recognise is an order
               that lands nowhere. */
            advanced_order: order.wanted_at ? 'Y' : 'N',
            /* Paid in the app is ONLINE; anything settled at the counter is
               cash on delivery as far as their till is concerned, which is
               what stops it asking a customer to pay twice. */
            payment_type: order.payment_status === 'PAID' ? 'ONLINE' : 'COD',
            table_no: dineIn ? String(order.pos_table_id || order.table_label || '') : '',
            no_of_persons: '',
            discount_total: '0.00',
            tax_total: money(order.tax_total_cents ?? 0),
            discount_type: 'F',
            total: money(order.total_cents ?? 0),
            description: order.note ?? '',
            created_on: created,
            /* The pre-order, which is the one thing Khapee has that their
               till does not: how long until the customer is actually here. */
            min_prep_time: minutesUntil(order.wanted_at),
            callback_url: callbackUrl,
            collect_cash: order.payment_status === 'PAID' ? '' : money(order.total_cents ?? 0),
          },
          OrderItem: {
            details: items.map((i) => ({
              id: String(i.pos_item_id),
              name: i.name,
              gst_liability: 'restaurant',
              /* Keyed by their own tax ids, which arrive on the menu push.
                 An amount with no id for it is an amount their till cannot
                 file, so a dish we have no mapping for sends none. */
              item_tax: Array.isArray(i.item_tax) ? i.item_tax : [],
              item_discount: '0.00',
              price: money(i.unit_price_cents),
              final_price: money(i.unit_price_cents * i.quantity),
              quantity: String(i.quantity),
              description: '',
            })),
          },
          Tax: { details: Array.isArray(order.tax_details) ? order.tax_details : [] },
          Discount: { details: [] },
        },
      },
      udid: '',
      device_type: 'Web',
    },
  }
}

/** Whole minutes from now until the customer wants it; 0 when they want it now. */
function minutesUntil(wantedAt: string | null): number {
  if (!wantedAt) return 0
  const at = Date.parse(`${String(wantedAt).replace(' ', 'T')}Z`)
  if (Number.isNaN(at)) return 0
  return Math.max(0, Math.round((at - Date.now()) / 60_000))
}

/**
 * The tax on the round being sent, in the shape their till files it under.
 *
 * Khapee used to send zero here and leave their POS to work it out. That is
 * fine for an unpaid order and wrong for a paid one: the customer has already
 * been charged our total, tax included, and a till that recomputes tax on top
 * of a price it believes is net prints a different number to the one taken.
 * For a prepaid dine-in order that is the customer being asked for the
 * difference at the counter.
 *
 * So the amounts sent are the ones actually charged, computed by the same
 * engine that prints Khapee's own GST invoice, and filed under Petpooja's own
 * tax ids — which arrive on the menu push and are kept on menu_items as
 * pos_tax_ids. A dish with no mapping sends no tax rather than an amount their
 * till cannot account for.
 *
 * A restaurant with tax switched off sends nothing at all, which is the
 * correct bill for them.
 */
function taxOf(order: any, items: any[], restaurant: any) {
  if (!restaurant?.tax_enabled) return { totalCents: 0, byItem: new Map<number, any[]>(), details: [] as any[] }

  const bill = computeBill({
    lines: items.map((i) => ({
      name: i.name,
      hsnSac: '',
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      rateBp: i.tax_rate_bp ?? 0,
      inclusive: i.tax_inclusive !== 0,
    })),
    billDiscountCents: 0,
    charges: [],
    // CGST and SGST split, or one IGST line, exactly as the invoice does it.
    interState: !!order.inter_state,
    roundToRupee: false,
  })

  const byItem = new Map<number, any[]>()
  let totalCents = 0
  bill.lines.forEach((line: any, n: number) => {
    const item = items[n]
    const cents = line.cgstCents + line.sgstCents + line.igstCents
    totalCents += cents
    const ids = String(item?.pos_tax_ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!ids.length || cents <= 0) return
    // Split evenly across their ids, with the remainder on the first, so the
    // parts add back up to the amount charged.
    const each = Math.floor(cents / ids.length)
    byItem.set(
      item.id,
      ids.map((id, k) => ({ id, amount: money(k === 0 ? cents - each * (ids.length - 1) : each) })),
    )
  })

  const details = totalCents > 0
    ? [
        {
          id: '',
          title: order.inter_state ? 'IGST' : 'GST',
          type: 'P',
          price: '',
          tax: money(totalCents),
          restaurant_liable_amt: money(totalCents),
        },
      ]
    : []

  return { totalCents, byItem, details }
}

export type PushResult = { ok: boolean; skipped?: string; posOrderId?: string; error?: string }

/**
 * Send one order to the till.
 *
 * Never throws and never blocks anything a customer is waiting on. A till that
 * is switched off, a network that is down, a restaurant halfway through being
 * set up — all of them end with the order living perfectly well in Khapee and
 * a line recorded against it saying what happened, because the alternative is
 * a customer being told their food failed because somebody's Windows machine
 * was asleep.
 */
export async function pushOrder(orderId: number, origin: string): Promise<PushResult> {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any
  if (!order) return { ok: false, skipped: 'no such order' }

  const link = linkFor(order.restaurant_id)
  if (!linkReady(link) || !link.pushOrders) return { ok: false, skipped: 'not linked' }

  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(order.restaurant_id) as any

  /* Their id for this table, when the menu push has told us one. */
  const posTableId = order.table_id
    ? ((db.prepare('SELECT pos_table_id FROM restaurant_tables WHERE id = ?').get(order.table_id) as any)
        ?.pos_table_id ?? '')
    : ''

  /*
   * The round: everything on this order that has not been sent yet.
   *
   * This used to return early the moment the order had a pos_order_id, on the
   * assumption that an order goes to the till once. It does not. A table
   * orders drinks, then starters, then somebody's friend arrives — and every
   * one of those rounds after the first was silently dropped here, so the
   * kitchen cooked the first round and never heard about the rest.
   */
  const items = db
    .prepare(
      `SELECT oi.id, oi.name, oi.quantity, oi.unit_price_cents,
              m.pos_item_id, m.pos_tax_ids,
              COALESCE(t.rate_bp, d.rate_bp, 0)     AS tax_rate_bp,
              COALESCE(t.inclusive, d.inclusive, 1) AS tax_inclusive
         FROM order_items oi
         LEFT JOIN menu_items m ON m.id = oi.menu_item_id
         LEFT JOIN tax_rates  t ON t.id = m.tax_rate_id AND t.restaurant_id = ?
         LEFT JOIN tax_rates  d ON d.restaurant_id = ? AND d.is_default = 1
        WHERE oi.order_id = ? AND oi.pos_order_id IS NULL
          AND (oi.accepted IS NULL OR oi.accepted = 1)
        ORDER BY oi.id`,
    )
    .all(order.restaurant_id, order.restaurant_id, orderId) as any[]

  if (!items.length) {
    return order.pos_order_id
      ? { ok: true, posOrderId: order.pos_order_id }
      : { ok: false, skipped: 'nothing to send' }
  }

  const unknown = items.filter((i) => !i.pos_item_id)
  if (unknown.length) {
    const why = `Not sent to Petpooja: ${unknown.map((i) => i.name).join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not in the Petpooja menu yet.`
    db.prepare('UPDATE orders SET pos_error = ? WHERE id = ?').run(why, orderId)
    note(order.restaurant_id, why)
    return { ok: false, skipped: why }
  }

  /*
   * Their order id has to be new every round or the second one is rejected as
   * a duplicate, so rounds after the first carry a suffix. The callback looks
   * an order up by this string, so it is matched back with the suffix stripped
   * rather than by remembering what we sent.
   */
  const roundNo =
    ((db
      .prepare('SELECT COUNT(DISTINCT pos_order_id) AS n FROM order_items WHERE order_id = ? AND pos_order_id IS NOT NULL')
      .get(orderId) as any)?.n ?? 0) + 1
  const clientOrderId = roundNo === 1 ? order.order_number : `${order.order_number}-${roundNo}`

  const tax = taxOf(order, items, restaurant)
  const payload = orderPayload(
    link,
    {
      ...order,
      order_number: clientOrderId,
      pos_table_id: posTableId,
      tax_total_cents: tax.totalCents,
      tax_details: tax.details,
    },
    items.map((i) => ({ ...i, item_tax: tax.byItem.get(i.id) ?? [] })),
    restaurant,
    `${origin}/api/petpooja/${link.webhookSecret}/callback`,
  )
  const reply = await call(endpoint('saveOrder'), payload)

  if (!reply.ok) {
    db.prepare('UPDATE orders SET pos_error = ? WHERE id = ?').run(reply.error.slice(0, 400), orderId)
    note(order.restaurant_id, reply.error)
    return { ok: false, error: reply.error }
  }

  const posOrderId = String(reply.body?.orderID ?? '')
  /* Stamped only on the lines that actually went, and only after they went:
     a round marked as sent before the till answered is a round nobody cooks. */
  const stamp = db.prepare("UPDATE order_items SET pos_order_id = ?, pos_pushed_at = datetime('now') WHERE id = ?")
  db.transaction(() => {
    for (const i of items) stamp.run(posOrderId || clientOrderId, i.id)
    db.prepare(
      "UPDATE orders SET pos_order_id = COALESCE(NULLIF(pos_order_id, ''), ?), pos_pushed_at = datetime('now'), pos_error = '' WHERE id = ?",
    ).run(posOrderId, orderId)
  })()
  db.prepare("UPDATE petpooja_links SET last_order_at = datetime('now'), last_error = '' WHERE restaurant_id = ?").run(
    order.restaurant_id,
  )
  return { ok: true, posOrderId }
}

/** Tell the till an order is off. Their API only supports cancellation. */
export async function cancelOrder(orderId: number, reason: string): Promise<PushResult> {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any
  if (!order?.pos_order_id) return { ok: false, skipped: 'never went to Petpooja' }
  const link = linkFor(order.restaurant_id)
  if (!linkReady(link)) return { ok: false, skipped: 'not linked' }

  const reply = await call(endpoint('orderStatus'), {
    app_key: link.appKey,
    app_secret: link.appSecret,
    access_token: link.accessToken,
    restID: link.restId,
    orderID: '',
    clientorderID: order.order_number,
    cancelReason: reason || 'Cancelled in Khapee',
    status: '-1',
  })
  if (!reply.ok) note(order.restaurant_id, reply.error)
  return reply.ok ? { ok: true } : { ok: false, error: reply.error }
}

/**
 * Ask for the menu rather than waiting to be given it.
 *
 * Petpooja push a menu whenever the restaurant edits one, which is the right
 * way round for keeping in step but no use at all on the day somebody is
 * setting this up and wants to see it work. This is the button for that day.
 */
export async function fetchMenu(restaurantId: number): Promise<{ ok: boolean; body?: any; error?: string }> {
  const link = linkFor(restaurantId)
  if (!linkReady(link)) return { ok: false, error: 'This restaurant is not connected to Petpooja yet.' }
  const reply = await call(
    endpoint('fetchMenu'),
    {
      restID: link.restId,
      /* The menu sharing code, when the restaurant has one. It was collected
         on the connect form and then never sent anywhere, which is the only
         request it belongs on. Omitted rather than sent empty, because a blank
         value is not the same as no value to the other end. */
      ...(link.menusharingCode ? { menusharingcode: link.menusharingCode } : {}),
    },
    { 'app-key': link.appKey, 'app-secret': link.appSecret, 'access-token': link.accessToken },
  )
  if (!reply.ok) {
    note(restaurantId, reply.error)
    return { ok: false, error: reply.error }
  }
  return { ok: true, body: reply.body }
}

/* --- Them calling us -------------------------------------------------------- */

/**
 * A menu, as the restaurant keeps it on their own till.
 *
 * This is the part that matters most and the part most able to do damage, so
 * it is deliberately conservative: dishes are matched on the Petpooja item id
 * and updated in place, new ones are added, and anything that has stopped
 * appearing is taken *off the menu* rather than deleted. A restaurant's menu
 * is months of somebody's work and a bad payload must not be able to wipe it.
 *
 * Prices arrive in rupees and are stored in paise, because every price in this
 * database is an integer and always has been.
 */
export function applyMenuPush(link: Link, payload: any): { categories: number; items: number; retired: number; tables: number } {
  const restaurants = Array.isArray(payload?.restaurants) ? payload.restaurants : []
  const categories = Array.isArray(payload?.categories) ? payload.categories : []
  const items = Array.isArray(payload?.items) ? payload.items : []
  const restaurantId = link.restaurantId

  // Opening hours and prep time come along with it when they are offered.
  const details = restaurants[0]?.details ?? restaurants[0]
  if (details?.minimum_prep_time) {
    db.prepare('UPDATE restaurants SET prep_minutes = ? WHERE id = ?').run(
      Math.max(1, Math.min(240, Number(details.minimum_prep_time) || 15)),
      restaurantId,
    )
  }

  const seen = new Set<string>()
  let addedCategories = 0
  let wrote = 0

  const run = db.transaction(() => {
    /* Sections first, because a dish cannot be filed before its section
       exists. Matched on their id, then on the name, so a restaurant that
       already typed "Starters" into Khapee does not end up with two of them. */
    const catIdFor = new Map<string, number>()
    for (const c of categories) {
      const posId = String(c.categoryid ?? c.category_id ?? '')
      const name = String(c.categoryname ?? c.name ?? '').trim()
      if (!posId || !name) continue
      const byPos = db
        .prepare('SELECT id FROM menu_categories WHERE restaurant_id = ? AND pos_category_id = ?')
        .get(restaurantId, posId) as any
      const byName = byPos
        ? null
        : (db
            .prepare('SELECT id FROM menu_categories WHERE restaurant_id = ? AND name = ? COLLATE NOCASE')
            .get(restaurantId, name) as any)
      if (byPos) {
        db.prepare('UPDATE menu_categories SET name = ? WHERE id = ?').run(name, byPos.id)
        catIdFor.set(posId, byPos.id)
      } else if (byName) {
        db.prepare('UPDATE menu_categories SET pos_category_id = ? WHERE id = ?').run(posId, byName.id)
        catIdFor.set(posId, byName.id)
      } else {
        const info = db
          .prepare(
            'INSERT INTO menu_categories (restaurant_id, name, sort_order, pos_category_id) VALUES (?, ?, ?, ?)',
          )
          .run(restaurantId, name, Number(c.categoryrank ?? 0) || 0, posId)
        catIdFor.set(posId, Number(info.lastInsertRowid))
        addedCategories++
      }
    }

    // A dish whose section did not come with the payload still has to land
    // somewhere a person can find it.
    let fallback: number | null = null
    const fallbackId = () => {
      if (fallback) return fallback
      const row = db
        .prepare("SELECT id FROM menu_categories WHERE restaurant_id = ? AND name = 'Menu'")
        .get(restaurantId) as any
      fallback =
        row?.id ??
        Number(
          db
            .prepare('INSERT INTO menu_categories (restaurant_id, name, sort_order) VALUES (?, ?, 999)')
            .run(restaurantId, 'Menu').lastInsertRowid,
        )
      return fallback
    }

    for (const it of items) {
      const posId = String(it.itemid ?? '')
      const name = String(it.itemname ?? '').trim()
      if (!posId || !name) continue
      seen.add(posId)

      const rupees = Number(it.price ?? 0)
      const priceCents = Math.max(0, Math.round((Number.isFinite(rupees) ? rupees : 0) * 100))
      const categoryId = catIdFor.get(String(it.item_categoryid ?? '')) ?? fallbackId()
      // 1=Veg, 2=Non-Veg, 5=Other, 24=Egg. Anything that is not plainly veg
      // is shown as non-veg, which is the safe direction to be wrong in.
      const isVeg = String(it.item_attributeid ?? '') === '1' ? 1 : 0
      const available = String(it.in_stock ?? '1') !== '0' && String(it.active ?? '1') !== '0' ? 1 : 0
      const description = String(it.itemdescription ?? '').slice(0, 500)
      const taxIds = String(it.item_tax ?? '')

      const existing = db
        .prepare('SELECT id FROM menu_items WHERE restaurant_id = ? AND pos_item_id = ?')
        .get(restaurantId, posId) as any

      if (existing) {
        db.prepare(
          `UPDATE menu_items
              SET name = ?, description = ?, price_cents = ?, category_id = ?, is_veg = ?,
                  is_available = ?, pos_tax_ids = ?
            WHERE id = ?`,
        ).run(name, description, priceCents, categoryId, isVeg, available, taxIds, existing.id)
      } else {
        // A dish the restaurant already typed into Khapee by hand, matched on
        // its name, is adopted rather than duplicated.
        const byName = db
          .prepare(
            'SELECT id FROM menu_items WHERE restaurant_id = ? AND name = ? COLLATE NOCASE AND pos_item_id IS NULL',
          )
          .get(restaurantId, name) as any
        if (byName) {
          db.prepare(
            `UPDATE menu_items
                SET pos_item_id = ?, description = ?, price_cents = ?, category_id = ?, is_veg = ?,
                    is_available = ?, pos_tax_ids = ?
              WHERE id = ?`,
          ).run(posId, description, priceCents, categoryId, isVeg, available, taxIds, byName.id)
        } else {
          db.prepare(
            `INSERT INTO menu_items
               (restaurant_id, category_id, name, description, price_cents, is_veg, is_available, sort_order, pos_item_id, pos_tax_ids)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            restaurantId,
            categoryId,
            name,
            description,
            priceCents,
            isVeg,
            available,
            Number(it.itemrank ?? 0) || 0,
            posId,
            taxIds,
          )
        }
      }
      wrote++
    }
  })

  run()

  /* Anything that came from Petpooja before and is not in this payload has
     been removed over there. Taken off the menu, never deleted — a menu push
     that arrives truncated should cost a restaurant an afternoon, not a year
     of photographs and descriptions. */
  let retired = 0
  if (seen.size) {
    const placeholders = [...seen].map(() => '?').join(',')
    const info = db
      .prepare(
        `UPDATE menu_items SET is_available = 0
          WHERE restaurant_id = ? AND pos_item_id IS NOT NULL AND pos_item_id NOT IN (${placeholders})`,
      )
      .run(link.restaurantId, ...seen)
    retired = info.changes
  }

  const tables = applyTables(link, payload)

  db.prepare("UPDATE petpooja_links SET last_menu_at = datetime('now'), last_error = '' WHERE restaurant_id = ?").run(
    link.restaurantId,
  )
  return { categories: addedCategories, items: wrote, retired, tables }
}

/**
 * The restaurant's own tables, which arrive with the menu.
 *
 * Petpooja confirmed this directly when asked where table_no comes from: the
 * outlet's table list is part of the menu payload, and those are the names
 * their till knows. Khapee used to invent its own — Table 1 to 7, whatever
 * somebody typed — and a dine-in order then named a table that did not exist
 * over there.
 *
 * Matched on their id first and the name second, so a restaurant that already
 * typed "T4" into Khapee gets it adopted rather than sat beside a duplicate.
 * Nothing is ever deleted: a table with a QR code on it has been printed and
 * stuck to furniture, and a menu push that arrives short of one table must not
 * quietly unpoint that code.
 */
function applyTables(link: Link, payload: any): number {
  const rows = [payload?.tables, payload?.Tables, payload?.restaurants?.[0]?.tables].find(Array.isArray) as any[] | undefined
  if (!rows?.length) return 0

  let touched = 0
  db.transaction(() => {
    for (const t of rows) {
      const posId = String(t.tableid ?? t.table_id ?? t.id ?? '').trim()
      const name = String(t.tablename ?? t.table_name ?? t.name ?? '').trim()
      if (!posId && !name) continue
      const label = name || posId

      const byPos = posId
        ? (db
            .prepare('SELECT id FROM restaurant_tables WHERE restaurant_id = ? AND pos_table_id = ?')
            .get(link.restaurantId, posId) as any)
        : null
      const byName = byPos
        ? null
        : (db
            .prepare('SELECT id FROM restaurant_tables WHERE restaurant_id = ? AND label = ? COLLATE NOCASE')
            .get(link.restaurantId, label) as any)

      if (byPos) {
        db.prepare('UPDATE restaurant_tables SET label = ? WHERE id = ?').run(label, byPos.id)
      } else if (byName) {
        db.prepare('UPDATE restaurant_tables SET pos_table_id = ? WHERE id = ?').run(posId, byName.id)
      } else {
        // The token is what a QR code resolves to, so it is made the same way
        // a hand-added table's is rather than left null.
        db.prepare(
          'INSERT INTO restaurant_tables (restaurant_id, label, seats, token, pos_table_id) VALUES (?, ?, ?, ?, ?)',
        ).run(link.restaurantId, label, Math.max(1, Number(t.seats ?? t.capacity) || 4), randomBytes(9).toString('base64url'), posId)
      }
      touched++
    }
  })()
  return touched
}

/** Sold out, from the kitchen's own screen. */
export function applyStock(link: Link, itemIds: string[], inStock: boolean): number {
  if (!itemIds.length) return 0
  const placeholders = itemIds.map(() => '?').join(',')
  const info = db
    .prepare(
      `UPDATE menu_items SET is_available = ?
        WHERE restaurant_id = ? AND pos_item_id IN (${placeholders})`,
    )
    .run(inStock ? 1 : 0, link.restaurantId, ...itemIds.map(String))
  return info.changes
}

/**
 * What the restaurant said, arriving back from their till.
 *
 * This is the half that makes the customer's screen honest. The tick on a
 * customer's phone has always belonged to the restaurant rather than to the
 * act of ordering, and for a Petpooja kitchen the restaurant is a person
 * pressing Accept on a Windows machine — so this is where that press lands.
 *
 *   -1  cancelled        1, 2, 3  accepted        5  food ready       10  delivered
 */
export function applyCallback(link: Link, orderNumber: string, status: string, cancelReason: string) {
  /*
   * Rounds after the first went over as ORDER-2, ORDER-3 and so on, because
   * their API rejects an order id it has already seen. The answer coming back
   * carries whichever one it was about, so the suffix comes off before the
   * order is looked up — every round belongs to the same order here, and the
   * restaurant accepting the third one is accepting the table.
   */
  const asked = String(orderNumber).toUpperCase().trim()
  const base = asked.replace(/-\d+$/, '')
  const order = db
    .prepare('SELECT * FROM orders WHERE restaurant_id = ? AND order_number = ?')
    .get(link.restaurantId, base) as any
  if (!order) return { ok: false, error: 'No such order' }

  /*
   * Their five statuses onto ours, which are not the same five.
   *
   * "Food ready" is one word in Petpooja and three different statuses here: a
   * table order is READY, a counter order is READY_FOR_PICKUP, and a delivery
   * is READY before somebody walks it out. Hard-coding READY worked for a
   * table and silently refused every pickup order — which is most of them.
   * The same is true of the end: handed over, collected, delivered.
   */
  const flow = flowFor(serviceOf(order))
  const ready = (['READY', 'READY_FOR_PICKUP'] as const).find((s) => flow.includes(s as any)) ?? null
  const finished = (['COMPLETED', 'PICKED_UP', 'DELIVERED'] as const).find((s) => flow.includes(s as any)) ?? null

  const to =
    status === '-1'
      ? order.status === 'REQUESTED'
        ? 'DECLINED'
        : 'CANCELLED'
      : status === '5'
        ? ready
        : status === '10'
          ? finished
          : ['1', '2', '3'].includes(status)
            ? 'ACCEPTED'
            : null

  if (!to) return { ok: false, error: `Unknown status ${status}` }
  return { ok: true, status: to as string, reason: String(cancelReason ?? '').slice(0, 300), orderId: order.id as number }
}

/** The four URLs a restaurant hands to Petpooja. Built from the live host. */
export function webhookUrls(link: Link, origin: string) {
  const base = `${origin.replace(/\/+$/, '')}/api/petpooja/${link.webhookSecret}`
  return {
    menu: `${base}/menu`,
    itemStock: `${base}/item-stock`,
    storeStatus: `${base}/store-status`,
    updateStoreStatus: `${base}/store-status/update`,
    callback: `${base}/callback`,
  }
}
