import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, openStream } from '../../lib/api'
import { LoadingBlock, Modal, Spinner, clockTime, money, timeAgo, useToast } from '../../components/ui'
import { printKot, printReceipt, printWord } from '../../lib/receipt'
import { STATUS_LABEL, isAccepted, nextStatus, type OrderStatus } from '../../../shared/orders'

/**
 * The floor, as the room is actually laid out.
 *
 * Everything else in the dashboard is a list of orders, which is what a
 * computer has. What a restaurant has is tables — and the question asked
 * across the pass forty times a night is never "what is order 8F3K", it is
 * "what does table six want, and how much do they owe". A board of cards
 * cannot answer that without somebody adding four of them up in their head.
 *
 * So the tables are the navigation. Each one carries its own running total and
 * says when something on it needs a person, and an order arriving announces
 * itself against the table it arrived at, because the useful fact is not that
 * an order came in — it is which table is waiting.
 *
 * Two documents come off this screen and they are different documents. A KOT
 * is one round, for the range, no prices, printed once. The bill is the whole
 * table added up, for the customer, printed at the end. See server/floor.ts.
 */
type FloorItem = {
  id: number
  name: string
  quantity: number
  unitPriceCents: number
  accepted: boolean | null
  kotId: number | null
}
type FloorOrder = {
  id: number
  orderNumber: string
  status: OrderStatus
  serviceMode: string
  customerName: string
  customerPhone: string
  note: string
  createdAt: string
  totalCents: number
  paymentStatus: string
  items: FloorItem[]
  kots: { id: number; seqNo: number; createdAt: string; printedAt: string | null; items: { name: string; quantity: number }[] }[]
}
type Spot = {
  orders: FloorOrder[]
  totalCents: number
  paidCents: number
  claimedCents: number
  dueCents: number
  waiting: number
  unsent: number
  since: string | null
}
type FloorTable = Spot & { id: number; label: string; seats: number }
type Board = { tables: FloorTable[]; elsewhere: Spot }

type MenuItem = { id: number; name: string; section: string; priceCents: number }

/** The counter tab has no table id, and nothing else may collide with one. */
const ELSEWHERE = -1

export default function StaffFloor() {
  const toast = useToast()
  const [board, setBoard] = useState<Board | null>(null)
  const [tab, setTab] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [settling, setSettling] = useState(false)
  const [addFor, setAddFor] = useState<number | null>(null)
  /**
   * What has arrived since somebody last looked at each table.
   *
   * Kept per table rather than as one list, because "an order came in" is not
   * the actionable fact — a waiter carrying plates to six wants to know that
   * six is the one that needs them.
   */
  const [alerts, setAlerts] = useState<{ tableId: number; label: string; order: FloorOrder }[]>([])
  const seen = useRef<Set<number>>(new Set())
  const first = useRef(true)

  const load = useCallback(async () => {
    try {
      const r = await api<Board>('/staff/floor')
      const all = [...r.tables.flatMap((t) => t.orders.map((o) => ({ t, o }))), ...r.elsewhere.orders.map((o) => ({ t: null, o }))]
      if (!first.current) {
        const fresh = all.filter(({ o }) => !seen.current.has(o.id))
        if (fresh.length) {
          setAlerts((prev) => [
            ...fresh.map(({ t, o }) => ({ tableId: t?.id ?? ELSEWHERE, label: t?.label ?? 'Counter', order: o })),
            ...prev,
          ].slice(0, 4))
        }
      }
      seen.current = new Set(all.map(({ o }) => o.id))
      first.current = false
      setBoard(r)
      setTab((current) => (current === null ? (r.tables[0]?.id ?? ELSEWHERE) : current))
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  // Live, with a poll behind it: a screen left open on a counter is exactly
  // the case where an event stream quietly stops and nobody can tell.
  useEffect(() => {
    const close = openStream(() => void load())
    const poll = setInterval(() => void load(), 8000)
    const wake = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      close()
      clearInterval(poll)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [load])

  const spot: (Spot & { id: number; label: string }) | null = useMemo(() => {
    if (!board) return null
    if (tab === ELSEWHERE) return { ...board.elsewhere, id: ELSEWHERE, label: 'Counter & takeaway' }
    return board.tables.find((t) => t.id === tab) ?? null
  }, [board, tab])

  const act = async (orderId: number, run: () => Promise<void>) => {
    setBusy(orderId)
    try {
      await run()
      await load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(null)
    }
  }

  const accept = (o: FloorOrder) =>
    act(o.id, async () => {
      const to = nextStatus(o.serviceMode as any, o.status) ?? 'ACCEPTED'
      await api(`/staff/orders/${o.id}/status`, { body: { status: to } })
    })

  /**
   * Sends the untold part of an order to the range, and prints the slip.
   *
   * The server decides what is on it — only what has not gone before — so
   * pressing this twice cannot put the starters on the range a second time.
   */
  const sendKot = (o: FloorOrder) =>
    act(o.id, async () => {
      const r = await api<{ kot: { seqNo: number; items: { name: string; quantity: number }[] } }>(
        `/staff/orders/${o.id}/kot`,
        { body: {} },
      )
      const outcome = await printKot({
        restaurant: { name: spot?.label ?? '' },
        orderNumber: `${o.orderNumber} · KOT ${r.kot.seqNo}`,
        tableLabel: spot?.label ?? null,
        customerName: o.customerName,
        note: o.note,
        items: r.kot.items.map((i, n) => ({ id: n, name: i.name, quantity: i.quantity, unitPriceCents: 0 })),
        totalCents: 0,
      })
      toast(...printWord(outcome, `KOT ${r.kot.seqNo}`))
    })

  /** A slip that went under the pass, printed again exactly as it was. */
  const reprintKot = async (o: FloorOrder, kotId: number, seqNo: number) => {
    try {
      const r = await api<{ kot: { seqNo: number; items: { name: string; quantity: number }[] } }>(`/staff/kot/${kotId}`)
      const outcome = await printKot({
        restaurant: { name: spot?.label ?? '' },
        orderNumber: `${o.orderNumber} · KOT ${seqNo} (copy)`,
        tableLabel: spot?.label ?? null,
        customerName: o.customerName,
        note: o.note,
        items: r.kot.items.map((i, n) => ({ id: n, name: i.name, quantity: i.quantity, unitPriceCents: 0 })),
        totalCents: 0,
      })
      toast(...printWord(outcome, `KOT ${seqNo} (copy)`))
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  /** The whole table, added up, on paper. */
  const printTableBill = async () => {
    if (!spot || spot.id === ELSEWHERE) return
    try {
      const r = await api<{ bill: any }>(`/staff/floor/table/${spot.id}/bill`)
      toast(...printWord(await printReceipt(r.bill), `Bill for ${spot.label}`))
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    }
  }

  const settle = async (method: string) => {
    if (!spot || spot.id === ELSEWHERE) return
    setSettling(true)
    try {
      const r = await api<{ settled: number; amountCents: number }>(`/staff/floor/table/${spot.id}/settle`, {
        body: { method },
      })
      toast(`${spot.label} settled — ${money(r.amountCents)} by ${method}.`, 'good')
      await load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setSettling(false)
    }
  }

  if (!board) return <LoadingBlock label="Reading the floor…" />

  return (
    <>
      {/*
        The pop-up, against the table it belongs to.

        Not a toast that slides away: somebody carrying two plates cannot read
        a message with a four-second life, and an order they missed is an order
        nobody is cooking. It stays until it is answered or put away, and
        opening it goes to that table.
      */}
      {alerts.length > 0 && (
        <div className="floor-alerts" role="status" aria-live="polite">
          {alerts.map((a) => (
            <article key={a.order.id} className="floor-alert">
              <div className="floor-alert-body">
                <strong>New order · {a.label}</strong>
                <p className="tiny">
                  {a.order.customerName || 'Guest'} ·{' '}
                  {a.order.items.reduce((n, i) => n + i.quantity, 0)} items · {money(a.order.totalCents)}
                </p>
              </div>
              <button
                className="btn btn-accent btn-sm"
                onClick={() => {
                  setTab(a.tableId)
                  setAlerts((p) => p.filter((x) => x.order.id !== a.order.id))
                }}
              >
                Open {a.label}
              </button>
              <button
                className="icon-btn"
                aria-label="Dismiss"
                onClick={() => setAlerts((p) => p.filter((x) => x.order.id !== a.order.id))}
              >
                ×
              </button>
            </article>
          ))}
        </div>
      )}

      {/* Every table, always, whether or not anything is on it. An empty table
          is the answer to "where do these four people go", which is asked more
          often than anything else on this screen. */}
      <div className="floor-tabs" role="tablist" aria-label="Tables">
        {board.tables.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`floor-tab ${tab === t.id ? 'on' : ''} ${t.orders.length ? 'busy' : ''} ${t.waiting ? 'waiting' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="floor-tab-name">{t.label}</span>
            <span className="floor-tab-sub">
              {t.orders.length ? money(t.totalCents) : `${t.seats} seats`}
            </span>
            {t.waiting > 0 && <span className="floor-tab-dot" aria-label={`${t.waiting} waiting`} />}
          </button>
        ))}
        <button
          role="tab"
          aria-selected={tab === ELSEWHERE}
          className={`floor-tab ${tab === ELSEWHERE ? 'on' : ''} ${board.elsewhere.orders.length ? 'busy' : ''}`}
          onClick={() => setTab(ELSEWHERE)}
        >
          <span className="floor-tab-name">Counter</span>
          <span className="floor-tab-sub">
            {board.elsewhere.orders.length ? money(board.elsewhere.totalCents) : 'Takeaway'}
          </span>
        </button>
      </div>

      {!spot ? (
        <LoadingBlock />
      ) : (
        <div className="floor-body">
          <section className="floor-orders">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>{spot.label}</h2>
              <button className="btn btn-accent btn-sm" onClick={() => setAddFor(spot.id)}>
                + Take an order
              </button>
            </div>

            {spot.orders.length === 0 ? (
              <div className="card card-pad center">
                <p className="muted" style={{ margin: 0 }}>
                  Nothing on {spot.label} right now.
                </p>
                <p className="tiny muted" style={{ marginTop: 6 }}>
                  Orders scanned at this table land here, or take one yourself.
                </p>
              </div>
            ) : (
              spot.orders.map((o) => {
                // Counted as plates rather than menu lines, to match the number
                // the table tab shows and what the kitchen is about to cook.
                const unsent = o.items
                  .filter((i) => i.kotId === null && i.accepted !== false)
                  .reduce((q, i) => q + i.quantity, 0)
                return (
                  <article key={o.id} className={`card card-pad floor-order ${isAccepted(o.status) ? '' : 'is-new'}`}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <strong>{o.customerName || 'Guest'}</strong>
                        <p className="tiny muted mono">
                          #{o.orderNumber} · {clockTime(o.createdAt)} · {timeAgo(o.createdAt)}
                        </p>
                      </div>
                      <span className={`badge ${isAccepted(o.status) ? '' : 'badge-warn'}`}>
                        {STATUS_LABEL[o.status]}
                      </span>
                    </div>

                    <ul className="floor-items">
                      {o.items.map((i) => (
                        <li key={i.id} className={i.accepted === false ? 'item-off' : ''}>
                          <b>{i.quantity}×</b>
                          <span>{i.name}</span>
                          {/* Which round it went out on, so nobody has to
                              remember whether the kitchen has it. */}
                          {i.kotId === null ? (
                            <em className="floor-pending">not sent</em>
                          ) : (
                            <em className="floor-sent">sent</em>
                          )}
                          <span className="mono">{money(i.unitPriceCents * i.quantity)}</span>
                        </li>
                      ))}
                    </ul>

                    {o.note && <p className="qrow-note">“{o.note}”</p>}

                    <div className="floor-order-acts">
                      {/* The customer's tick is drawn by this press and no
                          other, so it comes first and says what it does. */}
                      {!isAccepted(o.status) && (
                        <button className="btn btn-accent btn-sm" disabled={busy === o.id} onClick={() => accept(o)}>
                          {busy === o.id ? <Spinner /> : 'Accept'}
                        </button>
                      )}
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={busy === o.id || unsent === 0}
                        onClick={() => sendKot(o)}
                        title={unsent ? `Send ${unsent} to the kitchen` : 'The kitchen has all of this'}
                      >
                        {busy === o.id ? <Spinner /> : `🍳 KOT${unsent ? ` · ${unsent}` : ''}`}
                      </button>
                      {o.kots.map((k) => (
                        <button
                          key={k.id}
                          className="btn btn-ghost btn-sm"
                          onClick={() => void reprintKot(o, k.id, k.seqNo)}
                          title={`Sent ${clockTime(k.createdAt)}`}
                        >
                          ↻ {k.seqNo}
                        </button>
                      ))}
                      <span className="spacer" />
                      <strong>{money(o.totalCents)}</strong>
                    </div>
                  </article>
                )
              })
            )}
          </section>

          <aside className="floor-bill card card-pad">
            <h2 style={{ marginBottom: 4 }}>{spot.label}</h2>
            <p className="tiny muted">
              {spot.orders.length
                ? `${spot.orders.length} round${spot.orders.length === 1 ? '' : 's'} since ${spot.since ? clockTime(spot.since) : ''}`
                : 'Nothing open'}
            </p>

            <div className="summary-total" style={{ marginTop: 12 }}>
              <span>Running total</span>
              <span>{money(spot.totalCents)}</span>
            </div>
            {spot.paidCents > 0 && (
              <div className="summary-row">
                <span>Paid</span>
                <span>{money(spot.paidCents)}</span>
              </div>
            )}
            {spot.claimedCents > 0 && (
              <div className="summary-row">
                <span>Says they have sent</span>
                <span>{money(spot.claimedCents)}</span>
              </div>
            )}
            <div className="bill-due" style={{ marginTop: 10 }}>
              <span className="tiny muted">Due</span>
              <strong>{money(spot.dueCents)}</strong>
            </div>

            {spot.id !== ELSEWHERE && (
              <>
                <button
                  className="btn btn-secondary btn-block mt-3"
                  disabled={!spot.orders.length}
                  onClick={printTableBill}
                >
                  🖨 Print the bill
                </button>
                <p className="tiny muted" style={{ marginTop: 8 }}>
                  Every round on this table on one bill. The kitchen's slips stay separate.
                </p>
                <div className="stack mt-3">
                  {(['Cash', 'UPI', 'Card'] as const).map((m) => (
                    <button
                      key={m}
                      className={m === 'Cash' ? 'btn btn-accent' : 'btn btn-secondary'}
                      disabled={settling || !spot.orders.length}
                      onClick={() => void settle(m.toLowerCase())}
                    >
                      {settling ? <Spinner /> : `Settle · ${m}`}
                    </button>
                  ))}
                </div>
                <p className="tiny muted" style={{ marginTop: 8 }}>
                  Settling closes every round on this table at once, so none of them is left half paid.
                </p>
              </>
            )}
          </aside>
        </div>
      )}

      <TakeOrder
        tableId={addFor}
        tableLabel={addFor === ELSEWHERE ? 'the counter' : (board.tables.find((t) => t.id === addFor)?.label ?? '')}
        onClose={() => setAddFor(null)}
        onPlaced={() => {
          setAddFor(null)
          void load()
        }}
      />
    </>
  )
}

/**
 * An order taken at this end: a waiter with a pad, or somebody at the counter.
 *
 * It is ACCEPTED the moment it is placed, because the restaurant is the one
 * placing it. Making staff then accept their own order would be a step that
 * asks nobody anything.
 */
function TakeOrder({
  tableId,
  tableLabel,
  onClose,
  onPlaced,
}: {
  tableId: number | null
  tableLabel: string
  onClose: () => void
  onPlaced: () => void
}) {
  const toast = useToast()
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (tableId === null) return
    setPicked({})
    setSearch('')
    setName('')
    setPhone('')
    setNote('')
    api<{ categories: any[] }>('/staff/menu')
      .then((r) =>
        setMenu(
          r.categories.flatMap((c: any) =>
            c.items.map((i: any) => ({ id: i.id, name: i.name, section: c.name, priceCents: i.priceCents })),
          ),
        ),
      )
      .catch(() => setMenu([]))
  }, [tableId])

  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (q ? menu.filter((i) => i.name.toLowerCase().includes(q)) : menu).slice(0, 80)
  }, [menu, search])

  const count = Object.values(picked).reduce((n, q) => n + q, 0)
  const totalCents = Object.entries(picked).reduce(
    (n, [id, q]) => n + (menu.find((m) => m.id === Number(id))?.priceCents ?? 0) * q,
    0,
  )

  const place = async () => {
    setBusy(true)
    try {
      await api('/staff/pos/sale', {
        body: {
          tableId: tableId === ELSEWHERE ? null : tableId,
          serviceMode: tableId === ELSEWHERE ? 'counter' : 'dine_in',
          items: Object.entries(picked).map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
          customerName: name.trim(),
          contactPhone: phone.trim(),
          note: note.trim(),
        },
      })
      toast('Order taken.', 'good')
      onPlaced()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={tableId !== null} onClose={onClose} title={`Take an order for ${tableLabel}`} wide>
      <input
        className="input"
        placeholder="Search the menu"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <div className="add-list">
        {results.map((i) => (
          <div key={i.id} className="list-row">
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontSize: 14 }}>{i.name}</strong>
              <p className="tiny muted">
                {i.section} · {money(i.priceCents)}
              </p>
            </div>
            <span className="spacer" />
            {picked[i.id] ? (
              <div className="stepper">
                <button
                  onClick={() =>
                    setPicked((p) => {
                      const n = { ...p }
                      if (n[i.id] > 1) n[i.id]--
                      else delete n[i.id]
                      return n
                    })
                  }
                >
                  −
                </button>
                <span>{picked[i.id]}</span>
                <button onClick={() => setPicked((p) => ({ ...p, [i.id]: p[i.id] + 1 }))}>+</button>
              </div>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => setPicked((p) => ({ ...p, [i.id]: 1 }))}>
                Add
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="row row-wrap" style={{ marginTop: 10 }}>
        <input
          className="input"
          style={{ maxWidth: 180 }}
          placeholder="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {/* Optional here and not on the customer's own path: the person is
            standing in front of you, so the counter is the way to reach them. */}
        <input
          className="input"
          style={{ maxWidth: 170 }}
          placeholder="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
        />
        <input
          className="input"
          placeholder="Note for the kitchen"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <button className="btn btn-accent btn-lg btn-block mt-3" disabled={!count || busy} onClick={place}>
        {busy ? <Spinner /> : count ? `Place ${count} item${count === 1 ? '' : 's'} · ${money(totalCents)}` : 'Pick something first'}
      </button>
    </Modal>
  )
}
