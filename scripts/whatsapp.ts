/**
 * The WhatsApp message customers get, and whether it is going anywhere.
 *
 *   npx tsx scripts/whatsapp.ts            what is set up, and the last attempts
 *   npx tsx scripts/whatsapp.ts A123       exactly what that order would send
 *
 * Sending is off unless WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are in the
 * environment, and this says so plainly rather than leaving somebody to
 * wonder why nobody is receiving anything. Every attempt, including the ones
 * that were never made because it is switched off, is in whatsapp_messages —
 * silence is the failure mode of outbound messaging, and a log is the only
 * thing that tells "nobody ordered" apart from "this never worked".
 */
import { db } from '../server/db.ts'
import {
  orderMessageText,
  toWhatsAppNumber,
  whatsappConfigured,
  WHATSAPP_TEMPLATE_BODY,
} from '../server/whatsapp.ts'

const wanted = process.argv[2]

if (wanted) {
  const row = db
    .prepare(
      `SELECT o.*, r.name AS restaurant_name FROM orders o
         JOIN restaurants r ON r.id = o.restaurant_id
        WHERE o.order_number = ?`,
    )
    .get(wanted.toUpperCase()) as any
  if (!row) {
    console.error(`\n  No order ${wanted.toUpperCase()}.\n`)
    process.exit(1)
  }
  const phone =
    row.contact_phone ||
    row.delivery_phone ||
    ((db.prepare('SELECT phone FROM users WHERE id = ?').get(row.user_id) as any)?.phone ?? '')
  const to = toWhatsAppNumber(phone)
  console.log(`
  Order ${row.order_number} — ${row.customer_name} at ${row.restaurant_name}

    to      ${to || '(no usable number on this order)'}
    message ${orderMessageText({
      phone,
      customerName: row.customer_name,
      restaurantName: row.restaurant_name,
      orderNumber: row.order_number,
      total: '',
      trackUrl: '',
    })}
`)
  process.exit(0)
}

console.log(`
  Sending is ${whatsappConfigured() ? 'ON' : 'OFF'}${
    whatsappConfigured() ? '' : ' — set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID to switch it on'
  }

  The sentence Meta has to approve, as a Utility template named
  "${process.env.WHATSAPP_TEMPLATE || 'order_confirmation'}":

    ${WHATSAPP_TEMPLATE_BODY}
`)

const rows = db
  .prepare(
    `SELECT w.*, o.order_number, o.customer_name FROM whatsapp_messages w
       LEFT JOIN orders o ON o.id = w.order_id
      ORDER BY w.id DESC LIMIT 15`,
  )
  .all() as any[]

if (!rows.length) {
  console.log('  Nothing attempted yet.\n')
} else {
  console.log('  The last attempts:\n')
  for (const r of rows) {
    console.log(
      `    ${String(r.created_at).slice(5, 16)}  ${String(r.order_number ?? '—').padEnd(6)} ` +
        `${String(r.phone || '—').padEnd(14)} ${r.status}`,
    )
  }
  const off = rows.filter((r) => r.status === 'off').length
  if (off) console.log(`\n  ${off} of those were never sent because sending is switched off.`)
  console.log('')
}
