/**
 * The thank-you a customer gets, and the number it goes to.
 *
 * Written once and shared, because it goes out three ways — a tap on the
 * restaurant's own WhatsApp, a push notification, and Meta's paid API if that
 * is ever switched on — and three copies of a sentence drift apart.
 */
export function thanksText(customerName: string): string {
  return `Hi ${customerName}, Thanks for ordering through Khapee today! We hope you enjoy your food. 🍕`
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

/**
 * WhatsApp's own address, which opens the app rather than a web page about it.
 *
 * wa.me is a website. On a phone it loads Safari, shows a "Continue to Chat"
 * page and offers to hand over — and inside an app installed on a Home Screen
 * that detour frequently dead-ends, which is what made "open WhatsApp" look
 * broken. whatsapp:// is the app itself and opens straight into the chat.
 *
 * It fails silently when WhatsApp is not installed, which is why waLink below
 * still exists and is offered underneath.
 */
export function waAppLink(phone: string, message: string): string {
  const to = waNumber(phone)
  return to ? `whatsapp://send?phone=${to}&text=${encodeURIComponent(message)}` : ''
}

/** The web address, for a computer or a phone without the app. */
export function waLink(phone: string, message: string): string {
  const to = waNumber(phone)
  return to ? `https://wa.me/${to}?text=${encodeURIComponent(message)}` : ''
}
