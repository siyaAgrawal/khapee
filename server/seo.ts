/**
 * What a search engine sees.
 *
 * The app is rendered in the browser, so a crawler that does not run JavaScript
 * gets an empty shell — one title, no description, nothing about any restaurant.
 * Google does run JavaScript, but it queues those pages and treats them less
 * kindly than plain HTML, and other crawlers (and every link preview on
 * WhatsApp, iMessage and the rest) do not run it at all.
 *
 * So the head is filled in on the server before the page is sent: a real title
 * and description per page, Open Graph for link previews, and a sitemap built
 * from the restaurants that actually exist. The body still comes from React.
 */
import { db } from './db.ts'
import { imageUrl } from './uploads.ts'

/** The product's name as a searcher would type it, alongside what it does. */
const SITE_NAME = 'Khapee'
const TAGLINE = 'Order at the table, from your car, or to your door'

export type PageMeta = { title: string; description: string; image?: string | null; canonical: string }

export function metaFor(pathname: string, origin: string): PageMeta {
  const canonical = origin + pathname

  const restaurant = pathname.match(/^\/r\/(\d+)/)
  if (restaurant) {
    const r = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(Number(restaurant[1])) as any
    if (r) {
      const cuisines = String(r.categories || '')
        .split(',')
        .map((c: string) => c.trim())
        .filter(Boolean)
      const where = [r.city, 'Indore'].find(Boolean)
      const ways = [
        'order at your table',
        r.accepts_car ? 'from your car' : null,
        r.accepts_delivery ? 'or have it delivered' : null,
      ].filter(Boolean)
      return {
        title: `${r.name} — menu and ordering | ${SITE_NAME}`,
        description:
          `${r.name}${cuisines.length ? ` · ${cuisines.slice(0, 3).join(', ')}` : ''}${where ? ` in ${where}` : ''}. ` +
          `See the menu and ${ways.join(', ')}. ${r.description || ''}`.trim().slice(0, 300),
        image: imageUrl(r.image_path),
        canonical,
      }
    }
  }

  if (pathname === '/' || pathname === '') {
    const names = (
      db
        .prepare(
          `SELECT r.name FROM restaurants r
            WHERE r.is_open = 1 AND EXISTS (SELECT 1 FROM menu_items m WHERE m.restaurant_id = r.id)
            ORDER BY r.name LIMIT 6`,
        )
        .all() as any[]
    ).map((r) => r.name)
    return {
      title: `${SITE_NAME} — ${TAGLINE}`,
      description:
        `${SITE_NAME} is how you order at restaurants and cafes in Indore — at the table, parked outside, ` +
        `or delivered. ${names.length ? `Now on ${SITE_NAME}: ${names.join(', ')}.` : ''}`.trim().slice(0, 300),
      canonical,
    }
  }

  return { title: `${SITE_NAME} — ${TAGLINE}`, description: `${SITE_NAME}. ${TAGLINE}.`, canonical }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Rewrites the built shell's head for this particular page. */
export function injectMeta(html: string, meta: PageMeta, origin: string): string {
  const image = meta.image ? (meta.image.startsWith('http') ? meta.image : origin + meta.image) : `${origin}/icon-512.png`
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
  ].join('\n    ')

  // The shell ships with one hardcoded title; this replaces it rather than
  // adding a second one, which crawlers treat as a mistake.
  return html.replace(/<title>[\s\S]*?<\/title>/, tags)
}

export function robotsTxt(origin: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    // Nothing here is secret, but a staff dashboard or someone's order has no
    // business in a search result.
    'Disallow: /staff',
    'Disallow: /order/',
    'Disallow: /checkout',
    'Disallow: /cart',
    'Disallow: /g/',
    'Disallow: /t/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n')
}

/** Every page worth indexing: the front page and each restaurant with a menu. */
export function sitemapXml(origin: string): string {
  const rows = db
    .prepare(
      `SELECT r.id, r.slug FROM restaurants r
        WHERE EXISTS (SELECT 1 FROM menu_items m WHERE m.restaurant_id = r.id)
        ORDER BY r.id`,
    )
    .all() as any[]

  const urls = [
    { loc: `${origin}/`, priority: '1.0' },
    ...rows.map((r) => ({ loc: `${origin}/r/${r.id}`, priority: '0.8' })),
  ]

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <priority>${u.priority}</priority>\n  </url>`)
      .join('\n') +
    '\n</urlset>\n'
  )
}

/**
 * Structured data, so a result can carry the restaurant's own name, cuisine and
 * picture rather than a bare blue link.
 */
export function structuredData(pathname: string, origin: string): string | null {
  const m = pathname.match(/^\/r\/(\d+)/)
  if (!m) {
    return JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: origin + '/',
    })
  }
  const r = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(Number(m[1])) as any
  if (!r) return null
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: r.name,
    url: `${origin}/r/${r.id}`,
    image: r.image_path ? origin + imageUrl(r.image_path) : undefined,
    servesCuisine: String(r.categories || '')
      .split(',')
      .map((c: string) => c.trim())
      .filter(Boolean),
    address: { '@type': 'PostalAddress', addressLocality: r.city || 'Indore', addressCountry: 'IN' },
    telephone: r.phone || undefined,
    openingHours: r.hours || undefined,
    acceptsReservations: false,
  })
}
