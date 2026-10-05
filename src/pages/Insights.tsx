import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'

/**
 * Khapee's own numbers, for whoever runs Khapee.
 *
 * One page, read top to bottom in the order the questions come: how many
 * people have ordered through us (live), how busy the chosen period was,
 * when people order, what they order, how they order and pay, and how each
 * restaurant is doing. Every chart has its numbers in a table one tap away,
 * because a chart is for seeing the shape and a table is for reading a value.
 *
 * Data comes from the server's own record of orders (server/insights.ts), so
 * a restaurant clearing its history does not change anything here.
 */

type Live = { orders: number; people: number; todayOrders: number; todayPeople: number; lastOrderAt: string | null }
type Data = any

const PERIODS = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 0, label: 'All time' },
]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Where the numbers come from: the real record, or — on /insights/demo — the
 * sample one (server/insights-demo.ts), which looks the same and is labelled.
 */
const DEMO = () => window.location.pathname.startsWith('/insights/demo')
const BASE = () => (DEMO() ? '/insights/demo' : '/insights')
const num = (n: number) => Math.round(n).toLocaleString('en-IN')
const rupees = (cents: number) => '₹' + Math.round(cents / 100).toLocaleString('en-IN')
const pct = (x: number) => `${Math.round(x * 100)}%`
function hourLabel(h: number): string {
  const suffix = h < 12 ? 'am' : 'pm'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh}${suffix}`
}
function hourRange(h: number): string {
  return `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`
}
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  // Steps whose halves are whole numbers too, so the middle gridline never
  // reads "3" when it means 2.5.
  for (const m of [1, 2, 4, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}
function ago(at: string | null): string {
  if (!at) return 'no orders yet'
  const t = Date.parse(at.replace(' ', 'T') + 'Z')
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}

/* ---------------------------------------------------------------- tooltip */

type Tip = { x: number; y: number; value: string; label: string } | null
function useTip() {
  const [tip, setTip] = useState<Tip>(null)
  const show = (e: { clientX: number; clientY: number } | null, el: Element | null, value: string, label: string) => {
    if (e) setTip({ x: e.clientX, y: e.clientY, value, label })
    else if (el) {
      const r = el.getBoundingClientRect()
      setTip({ x: r.left + r.width / 2, y: r.top, value, label })
    }
  }
  const hide = () => setTip(null)
  const node = tip ? (
    <div className="ins-tip" style={{ left: tip.x, top: tip.y }} role="status">
      <strong>{tip.value}</strong>
      <span>{tip.label}</span>
    </div>
  ) : null
  return { show, hide, node }
}
type TipApi = ReturnType<typeof useTip>

/** The props that make a mark answer hover and keyboard focus alike. */
function markProps(tip: TipApi, value: string, label: string) {
  return {
    tabIndex: 0,
    'aria-label': `${label}: ${value}`,
    onPointerMove: (e: React.PointerEvent) => tip.show(e, null, value, label),
    onPointerLeave: tip.hide,
    onFocus: (e: React.FocusEvent) => tip.show(null, e.currentTarget, value, label),
    onBlur: tip.hide,
  }
}

/* ------------------------------------------------------------------ charts */

/** Vertical columns on one baseline — hours, days, basket sizes. */
function Columns({
  data,
  tip,
  format = num,
  labelEvery = 1,
  height = 170,
}: {
  data: { key: string; label: string; value: number; tipLabel: string }[]
  tip: TipApi
  format?: (n: number) => string
  labelEvery?: number
  height?: number
}) {
  const max = Math.max(0, ...data.map((d) => d.value))
  const top = niceMax(max)
  const peak = data.findIndex((d) => d.value === max && max > 0)
  const ticks = [0, top / 2, top]
  return (
    <div className="ins-cols" style={{ height: height + 28 }}>
      <div className="ins-cols-axis" style={{ height }}>
        {ticks
          .slice()
          .reverse()
          .map((t) => (
            <span key={t}>{format(t)}</span>
          ))}
      </div>
      <div className="ins-cols-plot" style={{ height }}>
        {ticks.map((t) => (
          <i key={t} className="ins-gridline" style={{ bottom: `${(t / top) * 100}%` }} />
        ))}
        <div className="ins-cols-bars" style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)` }}>
          {data.map((d, i) => (
            <div key={d.key} className="ins-col-slot" {...markProps(tip, format(d.value), d.tipLabel)}>
              {i === peak && (
                <b className="ins-col-cap" style={{ bottom: `calc(${(d.value / top) * 100}% + 4px)` }}>
                  {format(d.value)}
                </b>
              )}
              <span className="ins-col" style={{ height: `${(d.value / top) * 100}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="ins-cols-x" style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)` }}>
        {data.map((d, i) => (
          <span key={d.key}>{i % labelEvery === 0 ? d.label : ''}</span>
        ))}
      </div>
    </div>
  )
}

/** Horizontal bars with the name on the left and the value at the tip. */
function Bars({
  rows,
  tip,
  format = num,
  sub,
}: {
  rows: { key: string; name: string; value: number; note?: string }[]
  tip: TipApi
  format?: (n: number) => string
  sub?: (r: any) => string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="ins-bars">
      {rows.map((r) => (
        <div key={r.key} className="ins-bar-row" {...markProps(tip, format(r.value), r.name)}>
          <span className="ins-bar-name" title={r.name}>
            {r.name}
            {sub && <em>{sub(r)}</em>}
          </span>
          <span className="ins-bar-track">
            <span className="ins-bar" style={{ width: `${(r.value / max) * 100}%` }} />
            <b>{format(r.value)}</b>
          </span>
        </div>
      ))}
    </div>
  )
}

/** Day × hour, one blue from pale (quiet) to deep (busiest). */
const RAMP = ['var(--seq-0)', 'var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)']
function Heat({ heat, tip }: { heat: number[][]; tip: TipApi }) {
  const max = Math.max(0, ...heat.flat())
  // Five shades above "none"; the busiest hour always gets the deepest.
  const step = (v: number) => (v === 0 || max === 0 ? 0 : Math.max(1, Math.min(5, Math.ceil((v / max) * 5))))
  return (
    <div className="ins-heat-wrap">
      <div className="ins-heat" role="grid" aria-label="Orders by day and hour">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="ins-heat-h">
            {h % 3 === 0 ? hourLabel(h) : ''}
          </span>
        ))}
        {heat.map((row, d) => (
          <div key={d} className="ins-heat-row" role="row">
            <span className="ins-heat-d">{DAYS[d]}</span>
            {row.map((v, h) => (
              <span
                key={h}
                role="gridcell"
                className="ins-cell"
                style={{ background: RAMP[step(v)] }}
                {...markProps(tip, `${num(v)} order${v === 1 ? '' : 's'}`, `${DAYS[d]} ${hourRange(h)}`)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="ins-heat-key">
        <span>Quiet</span>
        {RAMP.map((c, i) => (
          <i key={i} style={{ background: c }} />
        ))}
        <span>Busiest ({num(max)})</span>
      </div>
    </div>
  )
}

/** A card with a title, a one-line reading of it, and its table one tap away. */
function Card({
  title,
  read,
  table,
  children,
  wide,
}: {
  title: string
  read?: string
  table?: { head: string[]; rows: (string | number)[][] }
  children: React.ReactNode
  wide?: boolean
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={`ins-card ${wide ? 'ins-wide' : ''}`}>
      <header>
        <div>
          <h2>{title}</h2>
          {read && <p>{read}</p>}
        </div>
        {table && (
          <button className="ins-toggle" onClick={() => setAsTable((v) => !v)}>
            {asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </header>
      {asTable && table ? (
        <div className="ins-table-wrap">
          <table className="ins-table">
            <thead>
              <tr>
                {table.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  )
}

function Tile({ label, value, note, onOpen }: { label: string; value: string; note?: string; onOpen?: () => void }) {
  if (onOpen) {
    return (
      <button className="ins-tile ins-tile-open" onClick={onOpen} aria-label={`${label}: ${value}. See the orders`}>
        <span>{label}</span>
        <strong>{value}</strong>
        {note && <em>{note}</em>}
        <i className="ins-tile-more">See orders →</i>
      </button>
    )
  }
  return (
    <div className="ins-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <em>{note}</em>}
    </div>
  )
}

const STATUS_WORD: Record<string, string> = {
  REQUESTED: 'Waiting to accept',
  NEW: 'New',
  ACCEPTED: 'Accepted',
  PREPARING: 'Being made',
  READY: 'Ready',
  SERVED: 'Served',
  COMPLETED: 'Done',
  PICKED_UP: 'Picked up',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  DECLINED: 'Turned down',
}

/**
 * The orders behind a figure: which café, whose name, how much, and what was
 * on it. Same period and restaurant as the page, fifty at a time.
 */
function OrdersSheet({
  title,
  days,
  restaurant,
  which,
  onClose,
  onChanged,
}: {
  title: string
  days: number
  restaurant: string
  which: 'all' | 'ahead' | 'off' | 'hidden'
  onClose: () => void
  onChanged: () => void
}) {
  const [rows, setRows] = useState<any[] | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  /** Out of the numbers, or back in. The order itself is never deleted. */
  const setHidden = async (o: any, hidden: boolean) => {
    if (
      hidden &&
      !window.confirm(
        `Remove order #${o.orderNumber || '—'} (${o.customerName || 'Guest'}, ${rupees(o.totalCents)}) from insights?\n\n` +
          'It stops counting in every number and chart here. You can put it back from "Removed orders".',
      )
    ) {
      return
    }
    setBusy(o.id)
    try {
      await api(`${BASE()}/orders/${o.id}/hide`, { body: { hidden } })
      setRows((prev) => prev?.filter((r) => r.id !== o.id) ?? null)
      setTotal((n) => Math.max(0, n - 1))
      setOpen(null)
      onChanged()
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(null)
    }
  }
  const [total, setTotal] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState('')

  const fetchPage = useCallback(
    async (offset: number) => {
      try {
        const q = new URLSearchParams({ days: String(days), which, offset: String(offset), limit: '50' })
        if (restaurant) q.set('restaurant', restaurant)
        const r = await api<{ total: number; orders: any[] }>(`${BASE()}/orders?${q}`)
        setTotal(r.total)
        setRows((prev) => (offset && prev ? [...prev, ...r.orders] : r.orders))
      } catch (e) {
        setError((e as ApiError).message)
      }
    },
    [days, restaurant, which],
  )
  useEffect(() => {
    void fetchPage(0)
  }, [fetchPage])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="ins-sheet-back" onClick={onClose}>
      <div className="ins-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>{title}</h2>
            <p>{rows ? `${num(total)} order${total === 1 ? '' : 's'}` : 'Loading…'}</p>
          </div>
          <button className="ins-toggle" onClick={onClose} autoFocus>
            Close
          </button>
        </header>
        {error && <p className="ins-error">{error}</p>}
        {rows && rows.length === 0 && <p className="ins-empty">No orders here.</p>}
        <ul className="ins-orders">
          {(rows ?? []).map((o) => (
            <li key={o.id}>
              <button
                className="ins-order"
                aria-expanded={open === o.id}
                onClick={() => setOpen(open === o.id ? null : o.id)}
              >
                <span className="ins-order-main">
                  <b>{o.restaurant}</b>
                  <span>
                    {o.customerName || 'Guest'}
                    {o.customerPhone ? ` · ${o.customerPhone}` : ''}
                  </span>
                  <em>
                    #{o.orderNumber || '—'} · {o.at?.slice(0, 16).replace('T', ' ')} · {o.mode}
                  </em>
                </span>
                <span className="ins-order-side">
                  <strong>{rupees(o.totalCents)}</strong>
                  <em className={/CANCELLED|DECLINED/.test(o.status) ? 'ins-off' : ''}>
                    {STATUS_WORD[o.status] ?? o.status}
                    {o.paid ? ' · paid' : ''}
                  </em>
                </span>
              </button>
              {open === o.id && (
                <div className="ins-order-items">
                  {o.items.length ? (
                    o.items.map((i: any, k: number) => (
                      <div key={k} className={i.off ? 'ins-item-off' : ''}>
                        <span>
                          {i.quantity}× {i.name}
                          {i.off ? ' (not available)' : ''}
                        </span>
                        <span>{rupees(i.cents)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="ins-empty">No dishes recorded.</p>
                  )}
                  {o.customerPhone && (
                    <a className="ins-call" href={`tel:${o.customerPhone.replace(/[^0-9+]/g, '')}`}>
                      Call {o.customerName || 'customer'}
                    </a>
                  )}
                  {o.removedFromHistory && <p className="ins-note">Removed from the café’s own history; kept here.</p>}
                  {!DEMO() && (
                  <button
                    className="ins-hide"
                    disabled={busy === o.id}
                    onClick={() => void setHidden(o, which !== 'hidden')}
                  >
                    {busy === o.id ? 'Saving…' : which === 'hidden' ? 'Put back in insights' : 'Remove from insights'}
                  </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {rows && rows.length < total && (
          <button className="ins-more" onClick={() => void fetchPage(rows.length)}>
            Show 50 more
          </button>
        )}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="ins-empty">{text}</p>
}

/* -------------------------------------------------------------------- page */

/** Plain names for where a visit came from. */
const SOURCE_NAMES: Record<string, string> = {
  qr: 'Scanned a QR',
  search: 'Google or another search',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  app: 'The installed app',
  link: 'A link on another site',
  direct: 'Typed in or a saved link',
  other: 'Other',
}
const PAGE_NAMES: Record<string, string> = {
  home: 'Front page',
  menu: 'A menu',
  'menu-car': 'Ordering from the car',
  'menu-delivery': 'Delivery',
  'menu-nearby': 'Ordering nearby',
  'table-qr': 'Table QR',
  'car-qr': 'Car QR',
  area: 'An area page',
  cart: 'Cart',
  checkout: 'Checkout',
  order: 'Order tracking',
  'my-orders': 'My orders',
  'for-restaurants': 'For restaurants',
  other: 'Other pages',
}

/**
 * Who looked, not only who ordered: page visits, where they came from, and
 * which menus they opened. Counted from 4 Oct 2026 — nothing before that was
 * recorded.
 */
function Visits({ days, restaurant, tip }: { days: number; restaurant: string; tip: TipApi }) {
  const [v, setV] = useState<any>(null)
  useEffect(() => {
    const q = new URLSearchParams({ days: String(days) })
    if (restaurant) q.set('restaurant', restaurant)
    let stop = false
    const get = () =>
      api<any>(`${BASE()}/visits?${q}`)
        .then((r) => !stop && setV(r))
        .catch(() => {})
    void get()
    const t = setInterval(get, 30000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [days, restaurant])
  if (!v) return null
  const since = v.since ? new Date(v.since.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null
  return (
    <>
      <h2 className="ins-section-title">Visits</h2>
      <p className="ins-note">
        {since ? `Counted since ${since}. ` : 'Counting starts with the next visit. '}
        One visitor is one phone or browser; restaurant dashboards are not counted.
      </p>
      <div className="ins-tiles">
        <Tile label="Visitors" value={num(v.visitors)} note={`${num(v.todayVisitors)} today`} />
        <Tile label="Page visits" value={num(v.views)} note={`${num(v.todayViews)} today`} />
        <Tile
          label="Reached checkout"
          value={num(v.checkoutVisitors)}
          note={v.visitors ? `${pct(v.checkoutVisitors / v.visitors)} of visitors` : 'of visitors'}
        />
      </div>
      {v.views > 0 && (
        <div className="ins-grid">
          <Card
            title="Where visitors come from"
            table={{
              head: ['From', 'Visits', 'Visitors'],
              rows: v.sources.map((s: any) => [SOURCE_NAMES[s.source] ?? s.source, num(s.visits), num(s.visitors)]),
            }}
          >
            <Bars
              tip={tip}
              rows={v.sources.map((s: any) => ({
                key: s.source,
                name: SOURCE_NAMES[s.source] ?? s.source,
                value: s.visitors,
                visits: s.visits,
              }))}
              sub={(r) => ` · ${num(r.visits)} visits`}
            />
          </Card>
          <Card
            title="Menus people opened"
            table={{
              head: ['Restaurant', 'Visitors', 'Visits', 'QR scans'],
              rows: v.byRestaurant.map((r: any) => [r.name, num(r.visitors), num(r.views), num(r.scans)]),
            }}
          >
            {v.byRestaurant.length ? (
              <Bars
                tip={tip}
                rows={v.byRestaurant.map((r: any) => ({ key: String(r.id), name: r.name, value: r.visitors, scans: r.scans }))}
                sub={(r) => (r.scans ? ` · ${num(r.scans)} QR scans` : '')}
              />
            ) : (
              <Empty text="No menu opened yet." />
            )}
          </Card>
          <Card
            wide
            title="Visitors per day"
            table={{
              head: ['Day', 'Visitors', 'Page visits'],
              rows: v.byDay.map((d: any) => [d.day, num(d.visitors), num(d.views)]),
            }}
          >
            <Columns
              tip={tip}
              labelEvery={Math.max(1, Math.ceil(v.byDay.length / 8))}
              data={v.byDay.map((d: any) => ({
                key: d.day,
                label: d.day.slice(5),
                value: d.visitors,
                tipLabel: `${d.day} · ${num(d.views)} page visits`,
              }))}
            />
          </Card>
          <Card
            title="Pages"
            table={{
              head: ['Page', 'Visits', 'Visitors'],
              rows: v.byPage.map((p: any) => [PAGE_NAMES[p.page] ?? p.page, num(p.views), num(p.visitors)]),
            }}
          >
            <Bars
              tip={tip}
              rows={v.byPage.map((p: any) => ({ key: p.page, name: PAGE_NAMES[p.page] ?? p.page, value: p.views }))}
            />
          </Card>
          {v.referrers.length > 0 && (
            <Card
              title="Sites that sent people"
              table={{ head: ['Site', 'Visits'], rows: v.referrers.map((r: any) => [r.host, num(r.visits)]) }}
            >
              <Bars tip={tip} rows={v.referrers.map((r: any) => ({ key: r.host, name: r.host, value: r.visits }))} />
            </Card>
          )}
        </div>
      )}
    </>
  )
}

export default function Insights() {
  const [live, setLive] = useState<Live | null>(null)
  const [bump, setBump] = useState(false)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [denied, setDenied] = useState<'' | 'signin' | 'no'>('')
  const [error, setError] = useState('')
  const [days, setDays] = useState(30)
  const [restaurant, setRestaurant] = useState('')
  const tip = useTip()
  const lastCount = useRef<number | null>(null)
  const [sheet, setSheet] = useState<null | { title: string; which: 'all' | 'ahead' | 'off' | 'hidden' }>(null)

  useEffect(() => {
    const prev = document.title
    document.title = 'Khapee insights'
    return () => {
      document.title = prev
    }
  }, [])

  const refuse = (e: unknown) => {
    const status = (e as ApiError)?.status
    if (status === 401) setDenied('signin')
    else if (status === 403) setDenied('no')
    else setError((e as ApiError)?.message ?? 'Could not load insights.')
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({ days: String(days) })
      if (restaurant) q.set('restaurant', restaurant)
      setData(await api<Data>(`${BASE()}?${q}`))
      setError('')
    } catch (e) {
      refuse(e)
    } finally {
      setLoading(false)
    }
  }, [days, restaurant])

  // The live number: asked for every five seconds, and when it moves the
  // rest of the page is refreshed too, so every figure includes the new order.
  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const l = await api<Live>(`${BASE()}/live`)
        if (stop) return
        if (lastCount.current !== null && l.orders !== lastCount.current) {
          setBump(true)
          setTimeout(() => setBump(false), 1200)
          void load()
        }
        lastCount.current = l.orders
        setLive(l)
      } catch (e) {
        if (!stop) refuse(e)
      }
    }
    void tick()
    const t = setInterval(tick, 5000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [load])

  useEffect(() => {
    void load()
  }, [load])

  if (denied) {
    return (
      <div className="ins-root ins-gate">
        <div className="ins-gate-card">
          <div className="ins-brand">
            khapee<span>.</span> insights
          </div>
          {denied === 'signin' ? (
            <>
              <p>Sign in with the Khapee account that runs insights.</p>
              <Link className="ins-btn" to="/login" state={{ from: '/insights' }}>
                Sign in
              </Link>
            </>
          ) : (
            <p>This account can’t see Khapee insights. Sign in with the account that runs Khapee.</p>
          )}
        </div>
      </div>
    )
  }

  const t = data?.totals
  const busiestHour = data ? data.byHour.reduce((a: any, b: any) => (b.orders > a.orders ? b : a), data.byHour[0]) : null
  const busiestDay = data
    ? data.heat
        .map((row: number[], d: number) => ({ d, n: row.reduce((a, b) => a + b, 0) }))
        .reduce((a: any, b: any) => (b.n > a.n ? b : a), { d: 0, n: 0 })
    : null
  const periodName = PERIODS.find((p) => p.days === days)?.label.toLowerCase() ?? ''

  return (
    <div className="ins-root">
      {tip.node}
      <header className="ins-top">
        <div className="ins-brand">
          khapee<span>.</span> insights
          {DEMO() && <em className="ins-sample-tag">Sample data</em>}
        </div>
        <span className="ins-live">
          <i aria-hidden /> Live · last order {ago(live?.lastOrderAt ?? null)}
        </span>
        {/* The labelled sample, one tap from the real numbers. A full page
            load, so nothing from one is left showing in the other. */}
        {!DEMO() && (
          <a className="ins-switch" href="/insights/demo">
            Sample view
          </a>
        )}
      </header>

      {/* The one number this page leads with. */}
      <section className="ins-hero" aria-live="polite">
        <span className="ins-hero-label">People who have ordered through Khapee</span>
        <strong className={`ins-hero-num ${bump ? 'ins-bump' : ''}`}>{live ? num(live.people) : '—'}</strong>
        <button className="ins-hero-sub ins-link" onClick={() => setSheet({ title: 'Every order', which: 'ahead' })}>
          {live
            ? `${num(live.orders)} orders in all · ${num(live.todayOrders)} today from ${num(live.todayPeople)} ${
                live.todayPeople === 1 ? 'person' : 'people'
              }`
            : 'Counting…'}
        </button>
      </section>
      {sheet && (
        <OrdersSheet
          title={sheet.title}
          which={sheet.which}
          days={sheet.title === 'Every order' || sheet.which === 'hidden' ? 0 : days}
          restaurant={sheet.title === 'Every order' || sheet.which === 'hidden' ? '' : restaurant}
          onClose={() => setSheet(null)}
          onChanged={() => {
            lastCount.current = null
            void load()
          }}
        />
      )}

      <div className="ins-filters">
        <div className="ins-seg" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              role="tab"
              aria-selected={days === p.days}
              className={days === p.days ? 'on' : ''}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          className="ins-select"
          value={restaurant}
          onChange={(e) => setRestaurant(e.target.value)}
          aria-label="Restaurant"
        >
          <option value="">All restaurants</option>
          {(data?.restaurants ?? []).map((r: any) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {data?.hiddenOrders > 0 && (
          <button className="ins-link" onClick={() => setSheet({ title: 'Removed from insights', which: 'hidden' })}>
            Removed orders ({num(data.hiddenOrders)})
          </button>
        )}
      </div>

      {error && <p className="ins-error">{error}</p>}

      {!data ? (
        <p className="ins-empty">Loading…</p>
      ) : (
        <div className={`ins-body ${loading ? 'ins-refetch' : ''}`}>
          <div className="ins-tiles">
            <Tile
              label="Orders"
              value={num(t.orders)}
              note={`from ${num(t.people)} ${t.people === 1 ? 'person' : 'people'}`}
              onOpen={() => setSheet({ title: `Orders · ${periodName}`, which: 'ahead' })}
            />
            <Tile
              label="Order value"
              value={rupees(t.revenue)}
              note="of orders that went ahead"
              onOpen={() => setSheet({ title: `Orders · ${periodName}`, which: 'ahead' })}
            />
            <Tile label="Average order" value={rupees(t.avgOrderCents)} note={`${t.itemsPerOrder.toFixed(1)} items each`} />
            <Tile
              label="People"
              value={num(t.people)}
              note={`${num(t.newPeople)} new · ${num(t.returningPeople)} came back`}
            />
            <Tile
              label="Ordered more than once"
              value={t.people ? pct(t.repeatInPeriod / t.people) : '—'}
              note={`${num(t.repeatInPeriod)} people, ${periodName}`}
            />
            <Tile
              label="Time to accept"
              value={t.medianAcceptMins == null ? '—' : `${t.medianAcceptMins < 1 ? '<1' : Math.round(t.medianAcceptMins)} min`}
              note="median, order to Accept"
            />
          </div>

          <Visits days={days} restaurant={restaurant} tip={tip} />

          <h2 className="ins-section-title">Orders</h2>
          {t.orders === 0 ? (
            <Empty text={`No orders ${periodName === 'all time' ? 'yet' : `in the last ${periodName}`}. Try a longer period.`} />
          ) : (
            <div className="ins-grid">
              <Card
                wide
                title="When people order"
                read={
                  busiestHour?.orders
                    ? `Busiest hour: ${hourRange(busiestHour.hour)} (${num(busiestHour.orders)} orders). India time.`
                    : undefined
                }
                table={{
                  head: ['Hour', 'Orders', 'Order value'],
                  rows: data.byHour.map((h: any) => [hourRange(h.hour), num(h.orders), rupees(h.revenue)]),
                }}
              >
                <Columns
                  tip={tip}
                  labelEvery={3}
                  data={data.byHour.map((h: any) => ({
                    key: String(h.hour),
                    label: hourLabel(h.hour),
                    value: h.orders,
                    tipLabel: `${hourRange(h.hour)} · ${rupees(h.revenue)}`,
                  }))}
                />
              </Card>

              <Card
                wide
                title="Busiest times of the week"
                read={busiestDay?.n ? `${DAYS[busiestDay.d]} is the busiest day.` : undefined}
                table={{
                  head: ['Day', ...Array.from({ length: 24 }, (_, h) => hourLabel(h))],
                  rows: data.heat.map((row: number[], d: number) => [DAYS[d], ...row.map((v) => (v ? v : ''))]),
                }}
              >
                <Heat heat={data.heat} tip={tip} />
              </Card>

              <Card
                wide
                title="Orders per day"
                table={{
                  head: ['Day', 'Orders', 'People', 'Order value'],
                  rows: data.byDay.map((d: any) => [d.day, num(d.orders), num(d.people), rupees(d.revenue)]),
                }}
              >
                <Columns
                  tip={tip}
                  labelEvery={Math.max(1, Math.ceil(data.byDay.length / 8))}
                  data={data.byDay.map((d: any) => ({
                    key: d.day,
                    label: d.day.slice(5),
                    value: d.orders,
                    tipLabel: `${d.day} · ${num(d.people)} people`,
                  }))}
                />
              </Card>

              <Card
                wide
                title="Order value per day"
                table={{
                  head: ['Day', 'Order value', 'Orders'],
                  rows: data.byDay.map((d: any) => [d.day, rupees(d.revenue), num(d.orders)]),
                }}
              >
                <Columns
                  tip={tip}
                  format={rupees}
                  labelEvery={Math.max(1, Math.ceil(data.byDay.length / 8))}
                  data={data.byDay.map((d: any) => ({
                    key: d.day,
                    label: d.day.slice(5),
                    value: d.revenue,
                    tipLabel: `${d.day} · ${num(d.orders)} orders`,
                  }))}
                />
              </Card>

              <Card
                title="Most ordered dishes"
                read={data.dishes[0] ? `${data.dishes[0].name} leads with ${num(data.dishes[0].qty)} ordered.` : undefined}
                table={{
                  head: ['Dish', 'Ordered', 'Orders', 'People', 'Value'],
                  rows: data.dishes.map((d: any) => [d.name, num(d.qty), num(d.orders), num(d.people), rupees(d.revenue)]),
                }}
              >
                <Bars
                  tip={tip}
                  rows={data.dishes.slice(0, 12).map((d: any) => ({
                    key: d.name,
                    name: d.name,
                    value: d.qty,
                    revenue: d.revenue,
                  }))}
                  sub={(r) => ` · ${rupees(r.revenue)}`}
                />
              </Card>

              <Card
                title="Dishes that bring in the most"
                table={{
                  head: ['Dish', 'Value', 'Ordered'],
                  rows: [...data.dishes]
                    .sort((a: any, b: any) => b.revenue - a.revenue)
                    .map((d: any) => [d.name, rupees(d.revenue), num(d.qty)]),
                }}
              >
                <Bars
                  tip={tip}
                  format={rupees}
                  rows={[...data.dishes]
                    .sort((a: any, b: any) => b.revenue - a.revenue)
                    .slice(0, 12)
                    .map((d: any) => ({ key: d.name, name: d.name, value: d.revenue }))}
                />
              </Card>

              <Card
                title="How people order"
                table={{
                  head: ['How', 'Orders', 'Share', 'Value'],
                  rows: data.modes.map((m: any) => [m.mode, num(m.orders), pct(m.orders / t.orders), rupees(m.revenue)]),
                }}
              >
                <Bars
                  tip={tip}
                  format={(n) => `${num(n)} · ${pct(n / t.orders)}`}
                  rows={data.modes.map((m: any) => ({ key: m.mode, name: m.mode, value: m.orders }))}
                />
              </Card>

              <Card
                title="How people pay"
                table={{
                  head: ['Paid by', 'Orders', 'Share', 'Value'],
                  rows: data.payments.map((m: any) => [m.method, num(m.orders), pct(m.orders / t.orders), rupees(m.revenue)]),
                }}
              >
                <Bars
                  tip={tip}
                  format={(n) => `${num(n)} · ${pct(n / t.orders)}`}
                  rows={data.payments.map((m: any) => ({ key: m.method, name: m.method, value: m.orders }))}
                />
              </Card>

              <Card
                title="Items per order"
                read="How big a typical order is."
                table={{
                  head: ['Items', 'Orders'],
                  rows: data.basket.map((b: any) => [b.items >= 6 ? '6 or more' : b.items, num(b.orders)]),
                }}
              >
                <Columns
                  tip={tip}
                  height={130}
                  data={data.basket.map((b: any) => ({
                    key: String(b.items),
                    label: b.items >= 6 ? '6+' : String(b.items),
                    value: b.orders,
                    tipLabel: `${b.items >= 6 ? '6 or more' : b.items} item${b.items === 1 ? '' : 's'}`,
                  }))}
                />
              </Card>

              <Card title="Often ordered together" read="Pairs that turn up in the same order — ideas for combos.">
                {data.pairs.length ? (
                  <ol className="ins-list">
                    {data.pairs.map((p: any) => (
                      <li key={p.a + p.b}>
                        <span>
                          {p.a} + {p.b}
                        </span>
                        <b>{num(p.orders)} orders</b>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Empty text="No pair has been ordered together twice yet." />
                )}
              </Card>

              <Card title="Most often not available" read="Dishes kitchens turned down — worth restocking or taking off the menu.">
                {data.unavailable.length ? (
                  <ol className="ins-list">
                    {data.unavailable.map((u: any) => (
                      <li key={u.name}>
                        <span>{u.name}</span>
                        <b>
                          {num(u.orders)} order{u.orders === 1 ? '' : 's'}
                        </b>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Empty text="No dish has been turned down in this period." />
                )}
              </Card>

              <Card wide title="Restaurants">
                <div className="ins-table-wrap">
                  <table className="ins-table">
                    <thead>
                      <tr>
                        <th>Restaurant</th>
                        <th>Orders</th>
                        <th>Order value</th>
                        <th>Average</th>
                        <th>People</th>
                        <th>Busiest hour</th>
                        <th>Top dish</th>
                        <th>Time to accept</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.places.map((p: any) => (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td>{num(p.orders)}</td>
                          <td>{rupees(p.revenue)}</td>
                          <td>{rupees(p.avgCents)}</td>
                          <td>{num(p.people)}</td>
                          <td>{p.peakHour == null ? '—' : hourRange(p.peakHour)}</td>
                          <td>{p.topDish ?? '—'}</td>
                          <td>
                            {p.medianAcceptMins == null
                              ? '—'
                              : `${p.medianAcceptMins < 1 ? '<1' : Math.round(p.medianAcceptMins)} min`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
