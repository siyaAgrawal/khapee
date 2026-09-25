import { randomBytes } from 'node:crypto'
import { db } from './db.ts'
import { flowFor } from '../shared/orders.ts'
import { serviceOf } from './order-status.ts'

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
            order_type: dineIn ? 'D' : 'P',
            advanced_order: order.wanted_at ? 'Y' : 'N',
            /* Paid in the app is ONLINE; anything settled at the counter is
               cash on delivery as far as their till is concerned, which is
               what stops it asking a customer to pay twice. */
            payment_type: order.payment_status === 'PAID' ? 'ONLINE' : 'COD',
            table_no: dineIn ? String(order.table_label ?? '') : '',
            no_of_persons: '',
            discount_total: '0.00',
            tax_total: '0.00',
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
              item_tax: [],
              item_discount: '0.00',
              price: money(i.unit_price_cents),
              final_price: money(i.unit_price_cents * i.quantity),
              quantity: String(i.quantity),
              description: '',
            })),
          },
          Tax: { details: [] },
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
  if (order.pos_order_id) return { ok: true, posOrderId: order.pos_order_id }

  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(order.restaurant_id) as any
  const items = db
    .prepare(
      `SELECT oi.name, oi.quantity, oi.unit_price_cents, m.pos_item_id
         FROM order_items oi LEFT JOIN menu_items m ON m.id = oi.menu_item_id
        WHERE oi.order_id = ? AND (oi.accepted IS NULL OR oi.accepted = 1)`,
    )
    .all(orderId) as any[]

  if (!items.length) return { ok: false, skipped: 'nothing to send' }
  const unknown = items.filter((i) => !i.pos_item_id)
  if (unknown.length) {
    const why = `Not sent to Petpooja: ${unknown.map((i) => i.name).join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not in the Petpooja menu yet.`
    db.prepare('UPDATE orders SET pos_error = ? WHERE id = ?').run(why, orderId)
    note(order.restaurant_id, why)
    return { ok: false, skipped: why }
  }

  const payload = orderPayload(link, order, items, restaurant, `${origin}/api/petpooja/${link.webhookSecret}/callback`)
  const reply = await call(endpoint('saveOrder'), payload)

  if (!reply.ok) {
    db.prepare('UPDATE orders SET pos_error = ? WHERE id = ?').run(reply.error.slice(0, 400), orderId)
    note(order.restaurant_id, reply.error)
    return { ok: false, error: reply.error }
  }

  const posOrderId = String(reply.body?.orderID ?? '')
  db.prepare(
    "UPDATE orders SET pos_order_id = ?, pos_pushed_at = datetime('now'), pos_error = '' WHERE id = ?",
  ).run(posOrderId, orderId)
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
    { restID: link.restId },
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
export function applyMenuPush(link: Link, payload: any): { categories: number; items: number; retired: number } {
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

  db.prepare("UPDATE petpooja_links SET last_menu_at = datetime('now'), last_error = '' WHERE restaurant_id = ?").run(
    link.restaurantId,
  )
  return { categories: addedCategories, items: wrote, retired }
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
  const order = db
    .prepare('SELECT * FROM orders WHERE restaurant_id = ? AND order_number = ?')
    .get(link.restaurantId, String(orderNumber).toUpperCase()) as any
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
