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

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="ins-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <em>{note}</em>}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="ins-empty">{text}</p>
}

/* -------------------------------------------------------------------- page */

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
      setData(await api<Data>(`/insights?${q}`))
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
        const l = await api<Live>('/insights/live')
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
        </div>
        <span className="ins-live">
          <i aria-hidden /> Live · last order {ago(live?.lastOrderAt ?? null)}
        </span>
      </header>

      {/* The one number this page leads with. */}
      <section className="ins-hero" aria-live="polite">
        <span className="ins-hero-label">People who have ordered through Khapee</span>
        <strong className={`ins-hero-num ${bump ? 'ins-bump' : ''}`}>{live ? num(live.people) : '—'}</strong>
        <span className="ins-hero-sub">
          {live
            ? `${num(live.orders)} orders in all · ${num(live.todayOrders)} today from ${num(live.todayPeople)} ${
                live.todayPeople === 1 ? 'person' : 'people'
              }`
            : 'Counting…'}
        </span>
      </section>

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
      </div>

      {error && <p className="ins-error">{error}</p>}

      {!data ? (
        <p className="ins-empty">Loading…</p>
      ) : (
        <div className={`ins-body ${loading ? 'ins-refetch' : ''}`}>
          <div className="ins-tiles">
            <Tile label="Orders" value={num(t.orders)} note={`${num(t.placed - t.orders)} called off`} />
            <Tile label="Order value" value={rupees(t.revenue)} note="of orders that went ahead" />
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
            <Tile
              label="Cancelled or turned down"
              value={t.placed ? pct((t.cancelled + t.declined) / t.placed) : '—'}
              note={`${num(t.cancelled)} cancelled · ${num(t.declined)} turned down`}
            />
          </div>

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
                        <th>Called off</th>
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
                          <td>{pct(p.calledOffRate)}</td>
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
