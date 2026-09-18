/**
 * The thank-you a customer gets, and the number it goes to.
 *
 * Written once and shared, because it goes out three ways — a tap on the
 * restaurant's own WhatsApp, a push notification, and Meta's paid API if that
 * is ever switched on — and three copies of a sentence drift apart.
 */
export function thanksText(customerName: string, restaurantName: string): string {
  return `Hi ${customerName}, Thanks for ordering from ${restaurantName} today! We hope you enjoyed your food. 🍕`
}

/**
 * A number WhatsApp will open, from one somebody typed.
 *
 * People write their own number the way they say it — ten digits, sometimes
 * spaced, sometimes with +91 in front. Returns '' for anything that cannot be
 * a real number, so a broken link is never offered.
 */
export function waNumber(raw: string, countryCode = '91'): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10) return countryCode + digits
  if (digits.length > 10 && digits.length <= 15) return digits.replace(/^0+/, '')
  return ''
}

/** wa.me opens WhatsApp on a phone and web.whatsapp.com on a computer. */
export function waLink(phone: string, message: string): string {
  const to = waNumber(phone)
  return to ? `https://wa.me/${to}?text=${encodeURIComponent(message)}` : ''
}
