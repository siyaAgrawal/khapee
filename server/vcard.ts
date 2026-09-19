/**
 * A contact card, so the thank-you arrives from a name instead of a number.
 *
 * WhatsApp shows a business name in place of its number only on Meta's paid
 * platform, after verification and a display-name review — weeks of paperwork
 * for a restaurant that is trying to send one sentence. Everywhere else, and
 * for everyone else, the chat is titled with eleven digits nobody recognises,
 * and a message that opens "Thanks for ordering" from an unknown number reads
 * like the beginning of a scam.
 *
 * But a saved contact wins over all of it. A number in somebody's address book
 * shows the name they saved it under, in the chat list, in notifications,
 * forever, with no verification and nothing paid. The only obstacle was ever
 * that saving a number is fiddly — copy it, open Contacts, paste, type a name.
 *
 * This is that, as one tap. The phone opens its own "add contact" screen with
 * the name and number already filled in, and the customer presses Save. It is
 * the same result Meta charges for, arrived at from the other side.
 */

/**
 * vCard escaping, which is its own small dialect.
 *
 * Commas and semicolons are field separators in this format, so a restaurant
 * called "Bread, Butter & Co" would otherwise arrive as several broken fields.
 */
function esc(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/**
 * Folds a line to 75 octets, which the spec requires and some phones enforce.
 *
 * Android is forgiving about long lines and iOS is not: an unfolded card with
 * a long note is silently rejected there, which looks like a button that does
 * nothing. Continuation lines begin with a single space.
 */
function fold(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = [line.slice(0, 75)]
  let rest = line.slice(75)
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74))
    rest = rest.slice(74)
  }
  if (rest) parts.push(' ' + rest)
  return parts.join('\r\n')
}

export type ContactCard = {
  /** The restaurant this number belongs to, for a name somebody will recognise. */
  restaurant: string
  phone: string
  website?: string
}

/**
 * The card itself.
 *
 * Named "Khapee · <restaurant>" rather than one or the other. The restaurant
 * is who the customer thinks they ordered from and the only name they will
 * recognise in a list; Khapee is what the message says and what a second
 * order from a different kitchen will also say. Leading with Khapee also
 * groups every one of them together in an alphabetical address book.
 *
 * CRLF line endings throughout, because the format says so and because the
 * phones that care are the ones that fail silently.
 */
export function contactCard(card: ContactCard): string {
  const digits = String(card.phone ?? '').replace(/[^\d+]/g, '')
  const name = `Khapee · ${card.restaurant}`.trim()
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    fold(`FN:${esc(name)}`),
    // Family name is left empty: this is an organisation, and filing it under
    // a surname puts it somewhere nobody will look for it.
    fold(`N:;${esc(name)};;;`),
    fold(`ORG:${esc(card.restaurant)};Khapee`),
    fold(`TEL;TYPE=CELL,VOICE:${digits}`),
  ]
  if (card.website) lines.push(fold(`URL:${esc(card.website)}`))
  lines.push(fold(`NOTE:${esc(`Your orders from ${card.restaurant}, through Khapee.`)}`))
  lines.push('END:VCARD')
  return lines.join('\r\n') + '\r\n'
}
