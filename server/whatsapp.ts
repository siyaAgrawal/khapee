/**
 * The thank-you message, sent from Khapee rather than by the customer.
 *
 * There is no way to send a WhatsApp message without WhatsApp. A number that
 * sends on its own behalf has to be registered as a WhatsApp Business account
 * and messages go out through Meta's Cloud API, with a token and a per-message
 * charge. That is a third party in the middle of every order, which is exactly
 * what this app has avoided everywhere else — so it is wired up here but left
 * switched off: with no credentials in the environment nothing is sent, no
 * request leaves the server, and ordering behaves as it always has.
 *
 * Turn it on by setting, in the environment:
 *
 *   WHATSAPP_TOKEN      the permanent access token from the Meta app
 *   WHATSAPP_PHONE_ID   the phone number ID of the registered sender
 *   WHATSAPP_TEMPLATE   name of the approved template (default order_confirmation)
 *   WHATSAPP_LANG       template language code        (default en)
 *   WHATSAPP_COUNTRY    dialling code for bare local numbers (default 91)
 *   WHATSAPP_FREEFORM   set to 1 to send plain text instead of a template
 *
 * Meta only allows plain text to someone who messaged the business in the last
 * day; for a first message it has to be an approved template. Hence the two
 * shapes — and why the sentence has to be registered before it can be sent,
 * even though it is the app's own sentence.
 */
import { db } from './db.ts'

const API = process.env.WHATSAPP_API || 'https://graph.facebook.com/v21.0'

export function whatsappConfigured(): boolean {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID)
}

/**
 * A number in the form WhatsApp wants: digits only, with a country code.
 *
 * People type their own number the way they say it — ten digits, sometimes
 * with spaces, sometimes with +91 in front. Returns '' for anything that
 * cannot be a real number rather than guessing.
 */
export function toWhatsAppNumber(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) return ''
  const cc = (process.env.WHATSAPP_COUNTRY || '91').replace(/\D/g, '')
  if (digits.length === 10) return cc + digits
  if (digits.length > 10 && digits.length <= 15) return digits.replace(/^0+/, '')
  return ''
}

export type OrderMessage = {
  phone: string
  customerName: string
  restaurantName: string
  orderNumber: string
  total: string
  trackUrl: string
}

/**
 * The message, word for word, in one place.
 *
 * The two names are the whole point of it: the customer's own, and the
 * restaurant they actually ordered from. Meta needs the same sentence
 * registered as a template with the names as {{1}} and {{2}} — see
 * WHATSAPP_TEMPLATE_BODY below — and the two have to match, so both are
 * written from here.
 */
export function orderMessageText(m: OrderMessage): string {
  return `Hi ${m.customerName}, Thanks for ordering from ${m.restaurantName} today! We hope you enjoyed your food. 🍕`
}

/**
 * What to register with Meta, exactly.
 *
 * A business cannot message somebody out of the blue on WhatsApp in its own
 * words: the sentence has to be approved in advance, with the variable parts
 * numbered. Submit this, with the name `order_confirmation`, under Message
 * Templates, category Utility. The numbers are filled in per order by
 * sendOrderConfirmation.
 */
export const WHATSAPP_TEMPLATE_BODY =
  'Hi {{1}}, Thanks for ordering from {{2}} today! We hope you enjoyed your food. 🍕'

function record(orderId: number | null, to: string, status: string, detail: string) {
  try {
    db.prepare(
      `INSERT INTO whatsapp_messages (order_id, phone, status, detail) VALUES (?, ?, ?, ?)`,
    ).run(orderId, to, status, detail.slice(0, 400))
  } catch {
    // A messaging log is never worth failing an order over.
  }
}

/**
 * Sends the confirmation, and never throws.
 *
 * Deliberately not awaited by the ordering path: an order that exists is an
 * order, whether or not Meta answered. Every outcome — including "not switched
 * on" — is written to whatsapp_messages so there is something to read when
 * somebody asks why a message did or did not arrive.
 */
export async function sendOrderConfirmation(
  orderId: number | null,
  m: OrderMessage,
): Promise<'sent' | 'skipped' | 'failed'> {
  const to = toWhatsAppNumber(m.phone)
  if (!to) {
    record(orderId, String(m.phone ?? ''), 'no-number', 'no usable phone number on the order')
    return 'skipped'
  }
  if (!whatsappConfigured()) {
    record(orderId, to, 'off', 'WHATSAPP_TOKEN / WHATSAPP_PHONE_ID not set')
    return 'skipped'
  }

  const freeform = process.env.WHATSAPP_FREEFORM === '1'
  const body = freeform
    ? { messaging_product: 'whatsapp', to, type: 'text', text: { body: orderMessageText(m) } }
    : {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE || 'order_confirmation',
          language: { code: process.env.WHATSAPP_LANG || 'en' },
          components: [
            {
              type: 'body',
              // {{1}} and {{2}} of the approved template, in that order.
              parameters: [m.customerName, m.restaurantName].map((text) => ({ type: 'text', text })),
            },
          ],
        },
      }

  try {
    const res = await fetch(`${API}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      record(orderId, to, 'failed', `${res.status} ${text}`)
      return 'failed'
    }
    record(orderId, to, 'sent', text)
    return 'sent'
  } catch (e) {
    record(orderId, to, 'failed', String((e as Error)?.message ?? e))
    return 'failed'
  }
}
