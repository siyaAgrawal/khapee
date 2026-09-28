import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, openStream } from '../../lib/api'
import { EmptyState, LoadingBlock, money, timeAgo, useToast, clockTime } from '../../components/ui'
import { Link } from 'react-router-dom'
import { announceOrder, askToNotify, notifyPermission } from '../../lib/notify'
import { currentEndpoint, enablePush, pushSupported, type AlertState } from '../../lib/push'
import { thanksText, waAppLink, waLink } from '../../../shared/thanks'
import { printReceipt, printWord } from '../../lib/receipt'
import {
  nextStatus,
  SERVICE_LABEL,
  STATUS_LABEL,
  type OrderStatus,
  type ServiceType,
} from '../../../shared/orders'

/**
 * "For 9:30", when the order is not for now.
 *
 * The one thing a kitchen must not miss, so it is on the row rather than
 * inside it — an order booked for half past that looks identical to one
 * placed thirty seconds ago gets cooked immediately, which is exactly the
 * waste the pre-order exists to remove.
 *
 * Nothing at all on an ordinary order. Most orders are for now, and a badge
 * saying "for now" on every one of them would be the label nobody reads,
 * which is how the one that matters gets missed.
 */
function WantedFor({ order }: { order: any }) {
  if (!order.wantedAt) return null
  const at = new Date(`${String(order.wantedAt).replace(' ', 'T')}Z`)
  if (Number.isNaN(at.getTime())) return null
  const mins = Math.round((at.getTime() - Date.now()) / 60_000)
  return (
    <span className={`wanted-for ${mins <= 10 ? 'soon' : ''}`}>
      for {at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      {mins > 0 ? <em> · in {mins} min</em> : <em> · now</em>}
    </span>
  )
}

/** Keeps each person's items together on a shared group ticket. */
function groupByPerson(items: any[]): { name: string; items: any[] }[] {
  const buckets = new Map<string, any[]>()
  for (const item of items) {
    const key = item.memberName ?? 'Table'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(item)
  }
  return [...buckets.entries()].map(([name, list]) => ({ name, items: list }))
}

type Order = any

/** Where this one is going, in the words staff use for it. */
function placeOf(o: any): string {
  if (o.serviceMode === 'delivery' || o.serviceType === 'delivery') return o.deliveryArea || 'Delivery'
  if (o.serviceMode === 'car' || o.serviceType === 'car') return o.zoneName ? `Car · ${o.zoneName}` : 'Car outside'
  if (o.tableLabel) return o.tableLabel
  return SERVICE_LABEL[(o.serviceType ?? o.type) as ServiceType]
}

/** Placed today, read the way the server stores it: "YYYY-MM-DD HH:MM:SS" UTC. */
function isToday(createdAt: string): boolean {
  const d = new Date(String(createdAt).replace(' ', 'T') + 'Z')
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  )
}

/**
 * Three columns, because an order is only ever in three places.
 *
 * There were five, two of which existed to say things everybody in the room
 * could already see: that cooking was happening, and that a plate had been
 * handed over. Ready is where an order ends now, so it is the last column,
 * and PREPARING keeps a home only because orders placed before the change
 * still sit in it and must not vanish off the board.
 */
const COLUMNS: { key: string; title: string; statuses: OrderStatus[] }[] = [
  // Everything nobody has answered yet, plus anything already paid for and
  // therefore straight into the kitchen.
  { key: 'new', title: 'To accept', statuses: ['REQUESTED', 'NEW'] },
  { key: 'accepted', title: 'Accepted', statuses: ['ACCEPTED', 'PREPARING'] },
  {
    key: 'done',
    title: 'Ready',
    statuses: ['READY', 'READY_FOR_PICKUP', 'COMPLETED', 'PICKED_UP', 'DELIVERED', 'CANCELLED', 'DECLINED'],
  },
]


/**
 * What the restaurant needs to know about the money on one order.
 *
 * Three states, because there are three: nobody has paid, the customer has
 * sent it over UPI and nobody has checked, and it is confirmed. The middle one
 * used to show as UNPAID with a small grey "claim" beside it, which reads at a
 * glance as an unpaid order — so a table that had already paid looked exactly
 * like one about to walk out without paying.
 */
/**
 * What the button that moves an order along should say.
 *
 * Every other step is named after the state it reaches — Preparing, Ready —
 * and reads as an instruction because that is where the order is going. The
 * first one does not: an order waiting on a yes needs a button that says yes,
 * and "Accepted" on a thing that has not been accepted reads as a label
 * somebody forgot to make into a button.
 */
/**
 * What the button does, said as the thing you are about to do.
 *
 * It used to be the name of the status it would move to — so the button on an
 * accepted order read "Preparing", which is a description of a state and not
 * an instruction. Behind a counter that reads as a label: this order is
 * preparing. People stopped pressing it, and orders sat in ACCEPTED all
 * service while the food went out anyway.
 *
 * Every one of these is now a verb, and the verb is the real-world action the
 * person is taking at the moment they press it.
 */
const GO_WORDS: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: 'Accept',
  PREPARING: 'Start cooking',
  // Retained above only for orders placed before the app was cut to two
  // steps; no flow offers it any more.
  READY: 'Food is ready',
  READY_FOR_PICKUP: 'Food is ready',
  COMPLETED: 'Handed over',
  PICKED_UP: 'They collected it',
  DELIVERING: 'Send it out',
  OUT_FOR_DELIVERY: 'Send it out',
  DELIVERED: 'Delivered',
}

function goLabel(_o: Order, next: OrderStatus): string {
  return GO_WORDS[next] ?? STATUS_LABEL[next]
}


/** What the server managed when it tried to nudge somebody to say thank you. */
type Thanked = { to: string; sent: number; devices: number; why: string }

/**
 * Accepting an order, said out loud.
 *
 * The thank-you arrives as a notification, and a notification that does not
 * arrive is indistinguishable from one that was never sent — which is how a
 * working system and a broken one came to look identical from behind the
 * counter. Three different things can happen and they need three different
 * answers: it went, there is nobody to send it to, or no phone is listening.
 */
function thankWord(t: Thanked): [string, 'good' | 'bad' | 'info'] {
  if (!t.to) {
    return ['Accepted. This order has no phone number on it, so there is nobody to message.', 'info']
  }
  if (t.sent) {
    return ['Accepted. Tap the “Thank …” notification just sent to you — it opens WhatsApp.', 'good']
  }
  if (!t.devices) {
    return ['Accepted — but no phone is signed up for alerts, so nothing was sent. Settings → Notifications.', 'bad']
  }
  return [`Accepted, but the notification could not be delivered${t.why ? `: ${t.why}` : '.'}`, 'bad']
}

/**
 * Yes or no to one dish on an order.
 *
 * Shown only while the answer still means something: once an order is
 * finished, or paid for, the kitchen's view of what it will cook is history
 * rather than a decision. Paid especially — lowering the total of an order
 * somebody has settled leaves the books and the money disagreeing, and the
 * customer owed a refund nothing would raise. The server refuses it too; this
 * is so the button is not there to be pressed in the first place.
 *
 * Two marks rather than one toggle, because "off" and "not yet looked at" are
 * different states and a single tick cannot show three things. Pressing the
 * same answer again clears it.
 */
function ItemCall({
  order,
  item,
  busy,
  decide,
}: {
  order: Order
  item: any
  busy: boolean
  decide: (accepted: boolean) => void
}) {
  const settled = ['COMPLETED', 'PICKED_UP', 'DELIVERED', 'CANCELLED', 'DECLINED'].includes(order.status)
  if (settled || order.paymentStatus === 'PAID') {
    return item.accepted === false ? <span className="item-call-off">off</span> : null
  }
  /*
   * One button, not two.
   *
   * There was a tick beside the cross, and the tick never had anything to do:
   * accepting the order accepts every dish on it, which is what Accept has
   * always meant. So the tick said yes to something that was already yes, and
   * put a second control on every line of every ticket for it — on a screen
   * where the whole point is reading eight tickets at a glance.
   *
   * The cross is the only real decision here: we have run out of this one.
   * Pressing it again undoes it, which is the only thing the tick was ever
   * genuinely needed for.
   */
  const off = item.accepted === false
  return (
    <span className="item-call">
      <button
        type="button"
        className={`item-call-btn ${off ? 'is-off' : ''}`}
        disabled={busy}
        aria-pressed={off}
        title={off ? `Put ${item.name} back on this order` : `We have run out of ${item.name}`}
        onClick={() => decide(off)}
      >
        ✕
      </button>
    </span>
  )
}

/**
 * How this one is being paid for, which the board never said.
 *
 * It showed PAID or UNPAID and left the rest to be guessed at, so a counter
 * could not tell an order already settled by UPI from one whose money is
 * still to be collected on the doorstep — the difference between handing food
 * over and asking for two hundred rupees first.
 *
 * "UPI" means paid through the app before the kitchen ever saw it. "COD" is
 * this app's counter method: cash or UPI, taken when the food changes hands.
 * Deliberately not called CASH, because half of those are paid by phone at
 * the counter and the till would then disagree with the board.
 */
function payLook(o: Order): { cls: string; label: string; hint: string } {
  const inApp = o.paymentMethod === 'app'
  if (o.paymentState === 'paid') {
    return {
      cls: 'badge-open',
      label: inApp ? 'PAID · UPI' : 'PAID · COD',
      hint: inApp ? 'Paid in the app. Tap to undo.' : 'Taken at the counter. Tap to undo.',
    }
  }
  if (o.paymentState === 'sent')
    return {
      cls: 'badge-paid-upi',
      label: `UPI · CHECK`,
      hint: `Customer sent ${money(o.claimedCents)}${o.upiRef ? ` · ref ${o.upiRef}` : ''}. Check your UPI app, then tap to confirm.`,
    }
  return {
    cls: 'badge-warn',
    label: inApp ? 'UPI · UNPAID' : 'COD',
    hint: inApp
      ? 'They chose to pay in the app and have not sent it yet.'
      : 'Cash or UPI when the food changes hands. Tap when they have paid.',
  }
}

export default function StaffOrders() {
  const toast = useToast()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [summary, setSummary] = useState<any>(null)
  const [filter, setFilter] = useState<'all' | 'dine_in' | 'pickup'>('all')
  const [scope, setScope] = useState<'active' | 'all'>('active')
  const [busyId, setBusyId] = useState<number | null>(null)
  /** Work that belongs to the board rather than to one order on it. */
  const [busy, setBusy] = useState('')
  /** The order whose bill is on its way to the printer. */
  const [printing, setPrinting] = useState<number | null>(null)
  const [error, setError] = useState('')
  // A board needs five columns of width. On a phone it had one, so the queue
  // is what opens there; anything wide enough for the board gets the board.
  const [view, setView] = useState<'queue' | 'board' | 'list'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 860 ? 'queue' : 'board',
  )
  const [openId, setOpenId] = useState<number | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState<string | null>(null)
  const [alerts, setAlerts] = useState(notifyPermission())
  /** Whether this browser is already signed up for alerts with the tab shut. */
  const [pushedHere, setPushedHere] = useState(true)
  const knownIds = useRef<Set<number>>(new Set())
  const firstLoad = useRef(true)

  // Start as "already on" so the button never flashes in for a second on a
  // device that has had alerts for weeks.
  useEffect(() => {
    if (!pushSupported()) return
    void currentEndpoint().then((e) => setPushedHere(!!e))
  }, [])

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([
        api<{ orders: Order[] }>(`/staff/orders?scope=${scope}`),
        api<{ summary: any }>('/staff/summary'),
      ])
      if (!firstLoad.current) {
        const fresh = o.orders.filter(
          (x) => (x.status === 'REQUESTED' || x.status === 'NEW') && !knownIds.current.has(x.id),
        )
        if (fresh.length === 1) toast(`New order #${fresh[0].orderNumber}`, 'good')
        else if (fresh.length > 1) toast(`${fresh.length} new orders came in`, 'good')
        for (const order of fresh) {
          announceOrder(
            order.orderNumber,
            `${placeOf(order)} · ${order.customerName} · ${order.items.reduce((n: number, i: any) => n + i.quantity, 0)} items · ${money(order.totalCents)}` +
              (order.status === 'REQUESTED' ? ' · needs your yes' : ''),
          )
        }
      }
      knownIds.current = new Set(o.orders.map((x) => x.id))
      firstLoad.current = false
      setOrders(o.orders)
      setSummary(s.summary)
      setError('')
    } catch (e) {
      setError((e as ApiError).message)
    }
  }, [scope, toast])

  useEffect(() => {
    load()
  }, [load])

  // Live push from the server, with a slow poll as a safety net.
  //
  // A phone left on the counter is the normal case, and a backgrounded tab gets
  // its timers throttled to nothing and its event stream dropped. Coming back
  // to it, the board could be minutes stale with no sign of it — which is what
  // made reloading by hand feel necessary. So it also refreshes the moment the
  // screen is looked at again.
  useEffect(() => {
    const close = openStream(() => load())
    const poll = setInterval(load, 8000)
    const onWake = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onWake)
    return () => {
      close()
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('online', onWake)
    }
  }, [load])

  const advance = async (order: Order, to: OrderStatus) => {
    setBusyId(order.id)
    try {
      const r = await api<{ order: Order; thanked?: Thanked }>(`/staff/orders/${order.id}/status`, {
        body: { status: to },
      })
      setOrders((prev) => prev?.map((o) => (o.id === r.order.id ? r.order : o)) ?? null)
      /**
       * Saying out loud what accepting just did.
       *
       * The thank-you goes out as a notification, and a notification that does
       * not arrive looks the same as one that was never sent — so an order
       * with no phone number on it, which correctly sends nothing because
       * there is nowhere to send it, was indistinguishable from the whole
       * system being broken. One line on screen at the moment of the tap is
       * the difference between knowing and guessing.
       */
      if (to === 'ACCEPTED' && r.thanked) toast(...thankWord(r.thanked))
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Refusing an order, which needs a reason: the customer is told it, and
   * "could not be taken" on its own leaves somebody waiting for food wondering
   * whether to order again or go somewhere else.
   */
  const decline = async (order: Order) => {
    const reason = window.prompt(
      `Why can't you take #${order.orderNumber}? The customer sees this.`,
      'Kitchen is full right now',
    )
    if (!reason?.trim()) return
    setBusyId(order.id)
    try {
      await api(`/staff/orders/${order.id}/decline`, { body: { reason: reason.trim() } })
      toast(`#${order.orderNumber} turned down`, 'info')
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Emptying the board, with the number said out loud first.
   *
   * Two round trips on purpose. The board only holds what its current scope
   * asked for, so it cannot say how much history is behind it — and agreeing
   * to delete "everything" without being told what everything is, is not
   * agreeing to anything. The first call counts and changes nothing; the
   * confirmation is written from what it found, including how many orders are
   * still in progress, because those go too.
   */
  const clearHistory = async () => {
    setBusy('clear')
    try {
      const look = await api<{ total: number; active: number }>('/staff/orders/clear', {
        body: { dryRun: true },
      })
      if (!look.total) {
        toast('There is no order history to clear.', 'info')
        return
      }
      const warning = look.active
        ? `\n\n${look.active} of them ${look.active === 1 ? 'is' : 'are'} still in progress and will be deleted too.`
        : ''
      if (
        !window.confirm(
          `Delete all ${look.total} order${look.total === 1 ? '' : 's'} for this restaurant?${warning}` +
            '\n\nThis cannot be undone. Invoices are kept.',
        )
      ) {
        return
      }
      const r = await api<{ cleared: number }>('/staff/orders/clear', { body: {} })
      toast(`Cleared ${r.cleared} order${r.cleared === 1 ? '' : 's'}.`, 'good')
      knownIds.current = new Set()
      load()
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy('')
    }
  }

  /**
   * Yes or no to one dish.
   *
   * The thing that actually happens at eight in the evening is that one item
   * is off and the rest is fine, and the board could only ever answer for the
   * whole order — so a table that would happily have eaten the rest got
   * turned away over the paneer. Tapping the same answer again undoes it,
   * because the commonest correction to a mis-tap is the mis-tap back.
   */
  const decideItem = async (order: Order, item: any, accepted: boolean) => {
    setBusyId(order.id)
    try {
      const r = await api<{ order: Order; allDeclined: boolean }>(
        `/staff/orders/${order.id}/items/${item.id}/decide`,
        { body: { accepted } },
      )
      setOrders((prev) => prev?.map((o) => (o.id === r.order.id ? r.order : o)) ?? null)
      if (r.allDeclined) {
        toast('Nothing left on this order — turn the whole thing down so the customer is told why.', 'info')
      } else if (!accepted) {
        toast(`${item.name} is off. The total has come down.`, 'info')
      }
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusyId(null)
    }
  }

  /**
   * "Prepaid only" — the car order's other answer besides Accept. The customer
   * is asked to pay online or cancel; the order waits on them until then.
   */
  const askPrepay = async (order: Order) => {
    setBusyId(order.id)
    try {
      const r = await api<{ order: Order }>(`/staff/orders/${order.id}/prepay`, { body: {} })
      setOrders((prev) => prev?.map((o) => (o.id === r.order.id ? r.order : o)) ?? null)
      toast('Asked the customer to pay online first. The order waits until they pay or cancel.', 'info')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusyId(null)
    }
  }

  const togglePaid = async (order: Order) => {
    setBusyId(order.id)
    try {
      const r = await api<{ order: Order }>(`/staff/orders/${order.id}/payment`, {
        body: { paymentStatus: order.paymentStatus === 'PAID' ? 'UNPAID' : 'PAID' },
      })
      setOrders((prev) => prev?.map((o) => (o.id === r.order.id ? r.order : o)) ?? null)
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Paper, from the screen the kitchen is already on.
   *
   * Printing existed, and worked, but only on the bill screen behind
   * /staff/table/:id — which is two taps away and named after tables, so on a
   * pickup order nobody went looking for it. From here it looked exactly like
   * a till that cannot print at all, which is how it was reported.
   *
   * The bill is fetched rather than assembled from the row: a row knows the
   * dishes and the total, but not the tax split, what has already been paid
   * against it, or anything a waiter added by hand, and a printed bill that
   * disagrees with the one at the counter is worse than no printing.
   */
  const printBill = async (order: Order) => {
    setPrinting(order.id)
    try {
      const { bill } = await api<{ bill: any }>(`/staff/bill/${order.id}`)
      toast(...printWord(await printReceipt(bill), `Bill ${order.orderNumber ?? ''}`.trim()))
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setPrinting(null)
    }
  }

  /**
   * The numbers along the top are the quickest way to say what you want to look
   * at, and they were only ever decoration — you read "3 unpaid" and then went
   * hunting for which three. Tapping one now narrows the screen to exactly
   * those orders, and says so in a line you can dismiss.
   */
  const FOCUS: Record<string, { label: string; match: (o: Order) => boolean; asList?: boolean }> = {
    new: { label: 'Waiting on you', match: (o) => o.status === 'REQUESTED' || o.status === 'NEW' },
    active: {
      label: 'Orders in progress',
      match: (o) => !['COMPLETED', 'PICKED_UP', 'CANCELLED', 'DECLINED'].includes(o.status),
    },
    today: { label: "Today's orders", match: (o) => isToday(o.createdAt), asList: true },
    paid: {
      label: 'Paid today',
      match: (o) => isToday(o.createdAt) && o.paymentStatus === 'PAID' && o.status !== 'CANCELLED',
      asList: true,
    },
    unpaid: {
      label: 'Waiting to be paid',
      match: (o) => o.paymentStatus === 'UNPAID' && o.status !== 'CANCELLED',
      asList: true,
    },
  }

  const focusOn = (key: string) => {
    setFocus(key)
    // History has to be in scope for anything that can include a finished
    // order, or tapping "Today" on a quiet afternoon shows nothing at all.
    if (FOCUS[key]?.asList) {
      setScope('all')
      // The table view is eight columns wide; on a phone that is the thing
      // being escaped, so narrow screens stay in the queue.
      setView(window.innerWidth < 860 ? 'queue' : 'list')
    }
  }

  const visible = useMemo(() => {
    const f = focus ? FOCUS[focus] : null
    const q = query.trim().toLowerCase()
    const hit = (o: Order) =>
      !q ||
      [o.orderNumber, o.customerName, o.tableLabel, placeOf(o), ...o.items.map((i: any) => i.name)]
        .filter(Boolean)
        .some((s: string) => String(s).toLowerCase().includes(q))
    return (orders ?? []).filter(
      (o) => (filter === 'all' || o.type === filter) && (!f || f.match(o)) && hit(o),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, filter, focus, query])

  return (
    <>
      <div className="staff-controls">
        <div className="tabs" style={{ marginBottom: 0 }}>
          {(['queue', 'board', 'list'] as const).map((v) => (
            <button
              key={v}
              /* Board and Table both need width they do not have on a phone,
                 and offering them there is offering the problem. */
              className={`tab ${view === v ? 'active' : ''} ${v !== 'queue' ? 'hide-phone' : ''}`}
              onClick={() => setView(v)}
            >
              {v === 'queue' ? 'Queue' : v === 'board' ? 'Board' : 'Table'}
            </button>
          ))}
        </div>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {(['all', 'dine_in', 'pickup'] as const).map((f) => (
            <button key={f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'dine_in' ? 'Dine in' : 'Pickup'}
            </button>
          ))}
        </div>
        {/* On a busy night the board is thirty rows long and the one you are
            being asked about is somewhere in it. Typing any part of the order
            number, the name, or the table finds it. */}
        <input
          className="input input-sm order-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an order…"
          aria-label="Find an order by number, name or table"
        />
        <span className="spacer" />
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setScope(scope === 'active' ? 'all' : 'active')}
        >
          {scope === 'active' ? 'Show history' : 'Active only'}
        </button>
        {/* Next to the button that shows the history, because that is where
            somebody is standing when they decide there is too much of it. */}
        {scope === 'all' && (
          <button className="btn btn-ghost btn-sm" disabled={busy === 'clear'} onClick={clearHistory}>
            {busy === 'clear' ? 'Clearing…' : 'Clear history'}
          </button>
        )}
        {/* One tap does both: the in-page chime, and the push subscription
            that keeps ringing after this tab is closed. The board is where
            somebody realises they want alerting, so it is where it is asked. */}
        {!pushedHere && alerts !== 'unsupported' && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              setAlerts((await askToNotify()) ? 'granted' : notifyPermission())
              try {
                const s = await api<AlertState>('/staff/alerts')
                if (s.push.available) {
                  const r = await enablePush(s.push.publicKey)
                  if (r.ok) {
                    setPushedHere(true)
                    toast('This device will ring for every new order.', 'good')
                  } else if (r.error) toast(r.error, 'info')
                }
              } catch {
                /* the in-page chime still works without it */
              }
            }}
          >
            🔔 <span className="hide-phone">Alert me</span>
          </button>
        )}
      </div>

      {/*
        Five numbers, on one line.

        These were five cards the height of a thumb, which put the least
        urgent thing on the screen — how much came in today — above the most
        urgent, which is the order nobody has accepted yet. On a laptop at a
        counter that was the top third of the window before a single ticket.
        They are still here and still tap to filter; they are just no longer
        the headline.
      */}
      {summary && (
        <div className="stat-row stat-row-thin">
          {(
            [
              ['new', 'New', summary.newOrders, null],
              ['active', 'In progress', summary.activeOrders, null],
              ['today', 'Today', summary.todayOrders, null],
              ['paid', 'Taken today', money(summary.todayCents), 'paid in full'],
              ['unpaid', 'Unpaid', summary.unpaid, summary.unpaidCents ? money(summary.unpaidCents) : null],
            ] as const
          ).map(([key, label, value, note]) => (
            <button
              key={key}
              type="button"
              className={`stat stat-btn ${focus === key ? 'on' : ''}`}
              aria-pressed={focus === key}
              onClick={() => (focus === key ? setFocus(null) : focusOn(key))}
            >
              <span>{label}</span>
              <strong>{value}</strong>
              {note && <em className="stat-note">{note}</em>}
            </button>
          ))}
        </div>
      )}

      {focus && (
        <div className="focus-bar">
          <strong>{FOCUS[focus]?.label}</strong>
          <span className="tiny muted">
            {visible.length} order{visible.length === 1 ? '' : 's'}
          </span>
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setFocus(null)}>
            Show everything
          </button>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}
      {!orders && <LoadingBlock label="Loading the board…" />}

      {orders && visible.length === 0 && (
        <EmptyState
          emoji="✨"
          title="No orders right now"
          body="New orders appear here the moment a customer places one."
        />
      )}

      {orders && visible.length > 0 && view === 'list' && (
        <div className="card ledger-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>Order</th>
                <th>Where</th>
                <th>Who</th>
                <th>Items</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Status</th>
                <th>Placed</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.id} className={o.status === 'NEW' ? 'is-new' : ''}>
                  <td>
                    <Link className="mono" to={`/staff/table/${o.id}`}>
                      <strong>#{o.orderNumber}</strong>
                    </Link>
                    {o.isGroup && <span className="o-group-tag" style={{ marginLeft: 6 }}>GROUP</span>}
                  </td>
                  <td>
                    {o.serviceType === 'dine_in' ? o.tableLabel : SERVICE_LABEL[(o.serviceType ?? o.type) as ServiceType]}
                  </td>
                  <td>
                    {o.customerName}
                    {o.customerPhone && <div className="tiny muted">{o.customerPhone}</div>}
                  </td>
                  <td className="ledger-items">
                    {groupByPerson(o.items).map((person) => (
                      <div key={person.name}>
                        {o.isGroup && <span className="tiny muted">{person.name}: </span>}
                        {person.items.map((i: any) => `${i.quantity}× ${i.name}`).join(', ')}
                      </div>
                    ))}
                  </td>
                  <td>
                    <strong>{money(o.totalCents)}</strong>
                  </td>
                  <td>
                    <button
                      className={`badge ${payLook(o).cls}`}
                      style={{ border: 0, cursor: 'pointer' }}
                      disabled={busyId === o.id}
                      onClick={() => togglePaid(o)}
                      title={payLook(o).hint}
                    >
                      {payLook(o).label}
                    </button>
                  </td>
                  <td>
                    <span className="badge">{STATUS_LABEL[o.status as OrderStatus]}</span>
                  </td>
                  <td className="tiny muted">{clockTime(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        The queue.

        A board is five columns side by side, which is a shape a phone does not
        have: it became one narrow column you scrolled sideways through, and
        with thirty orders on a Friday night you could not see the one you
        wanted in any of them. This is the same work as one column down the
        page — grouped by what has to happen to it, newest first, each order a
        line you can read at arm's length with its next step on it. Tapping a
        line opens what is in it.
      */}
      {orders && visible.length > 0 && view === 'queue' && (
        <div className="queue">
          {COLUMNS.map((col) => {
            const rows = visible.filter((o) => col.statuses.includes(o.status))
            if (!rows.length) return null
            const done = col.key === 'done'
            return (
              <section key={col.key} className="queue-group">
                <h3 className="queue-head">
                  {col.title}
                  <span className="queue-count">{rows.length}</span>
                </h3>
                {(done && !showDone ? rows.slice(0, 3) : rows).map((o) => {
                  const next = nextStatus(o.serviceType ?? o.type, o.status)
                  const open = openId === o.id
                  return (
                    <article
                      key={o.id}
                      className={[
                        'qrow',
                        // Waiting on a decision, in either of the two ways an
                        // order can be: never looked at, or looked at and not
                        // yet answered.
                        o.status === 'NEW' || o.status === 'REQUESTED' ? 'needs-you' : '',
                        done ? 'is-done' : '',
                        open ? 'open' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <button
                        className="qrow-main"
                        aria-expanded={open}
                        /* Says what it opens, now that it no longer hides the
                           dishes — "expand" is not a thing anybody behind a
                           counter is looking for; paying and printing are. */
                        aria-label={`${placeOf(o)} — payment, bill and more`}
                        onClick={() => setOpenId(open ? null : o.id)}
                      >
                        <span className="qrow-where">
                          <b>
                            {placeOf(o)}
                            <WantedFor order={o} />
                            {/* Turned round: this one is not waiting on the
                                kitchen any more, and a board that does not
                                say so looks like an order nobody has touched. */}
                            {o.needsCustomerOk && (
                              <span className="waiting-them" title={`Asked about ${o.declinedItems}`}>
                                waiting on the customer
                              </span>
                            )}
                            {o.needsPrepay && (
                              <span className="waiting-them" title="Asked to pay online before it goes ahead">
                                waiting for online payment
                              </span>
                            )}
                            {/*
                              And their answer, once it comes.

                              Without this the board went straight back to
                              looking like an ordinary untouched order the
                              moment the customer replied — so whoever was
                              deciding whether to cook could not tell "they
                              have agreed to the smaller order" from "nobody
                              has answered yet", which is the one thing they
                              needed to know.
                            */}
                            {/*
                              Somebody who ordered ahead is now standing in
                              the room. The loudest thing on the ticket,
                              because until they arrive nothing can be handed
                              over, and the moment they do, everything can.
                            */}
                            {o.arrivedAt && (
                              <span className="has-arrived">
                                HERE ·{' '}
                                {o.arrivalChoice === 'dine_in'
                                  ? o.tableLabel
                                    ? `eating in · ${o.tableLabel}`
                                    : 'eating in'
                                  : 'takeaway'}
                              </span>
                            )}
                            {!o.needsCustomerOk && o.customerOkAt && (
                              <span
                                className="customer-said-yes"
                                title={o.declinedItems ? `They agreed to go without ${o.declinedItems}` : undefined}
                              >
                                customer said go ahead
                              </span>
                            )}
                          </b>
                          <em>
                            {/*
                              The number is on the ticket, not only in the
                              history. It is how a kitchen asks "did you want
                              this without onion" or says "we have run out" —
                              and looking it up afterwards is no use while the
                              person is still waiting.
                            */}
                            #{o.orderNumber} · {o.customerName || 'Guest'}
                            {o.customerPhone ? ` · ${o.customerPhone}` : ''}
                          </em>
                        </span>
                        <span className="qrow-meta">
                          <b>{money(o.totalCents)}</b>
                          <em>
                            {o.items.reduce((n: number, i: any) => n + i.quantity, 0)} items ·{' '}
                            {timeAgo(o.createdAt)}
                          </em>
                        </span>
                        {/* Not just whether, but how. A dot said "not paid"
                            and left a counter guessing whether to ask for
                            money or hand the food over. */}
                        <span className={`qrow-pay badge ${payLook(o).cls}`} title={payLook(o).hint}>
                          {payLook(o).label}
                        </span>
                        {/* An affordance, because the row no longer hides the
                            dishes and nothing else says there is more here. */}
                        <span className="qrow-caret" aria-hidden>
                          {open ? '⌃' : '⌄'}
                        </span>
                      </button>

                      {/*
                        Yes and no, side by side, on the order that is asking.

                        Accept stood alone here, so the only answer the board
                        offered was yes — and no lived behind the tap that
                        opens the row, which is the wrong place for it. A
                        kitchen that is full, or has run out of the one thing
                        somebody ordered, has to be able to say so in the same
                        breath and from the same place.

                        Only while the question is open. Once an order is
                        accepted it can still be cancelled, but that is a
                        different act with a different weight and it stays
                        where it was, inside the row.
                      */}
                      <span className="qrow-answer">
                        {(o.status === 'REQUESTED' || o.status === 'NEW') && (
                          <button
                            className="btn btn-danger btn-sm qrow-no"
                            disabled={busyId === o.id}
                            onClick={() => void decline(o)}
                          >
                            Can’t take it
                          </button>
                        )}
                        {/* A car order that could be paid at the car: the kitchen
                            can ask for it to be paid online first instead. */}
                        {(o.serviceMode === 'car' || o.serviceType === 'car') &&
                          (o.status === 'REQUESTED' || o.status === 'NEW') &&
                          o.paymentState === 'unpaid' &&
                          !o.needsPrepay && (
                            <button
                              className="btn btn-secondary btn-sm qrow-prepay"
                              disabled={busyId === o.id}
                              onClick={() => void askPrepay(o)}
                            >
                              Prepaid only
                            </button>
                          )}
                        {next && (
                          <button
                            className="btn btn-accent btn-sm qrow-go"
                            disabled={busyId === o.id}
                            onClick={() => advance(o, next)}
                          >
                            {/* Naming what is being accepted, once some of it
                                has been taken off. "Accept" on a ticket with
                                two dishes struck through does not say which
                                order is being agreed to. */}
                            {o.customerOkAt && o.declinedItems && next === 'ACCEPTED'
                              ? 'Accept the rest'
                              : goLabel(o, next)}
                          </button>
                        )}
                      </span>

                      {/*
                        What is actually in the order, on every order, always.

                        This was behind the tap that opens the row, which meant
                        the one thing a kitchen needs — what to cook — was the
                        one thing the board would not tell it. Eight tickets on
                        a Friday meant eight taps to read eight orders, and then
                        eight more to close them again. A ticket that does not
                        say what is on it is not a ticket.

                        The note rides with it for the same reason: "no onion,
                        allergy" is not a detail to go looking for.
                      */}
                      <ul className="qrow-items">
                        {o.items.map((i: any) => (
                          <li key={i.id} className={i.accepted === false ? 'item-off' : ''}>
                            <b>{i.quantity}×</b> {i.name}
                            {i.memberName ? <em> · {i.memberName}</em> : null}
                            <ItemCall
                              order={o}
                              item={i}
                              busy={busyId === o.id}
                              decide={(yes) => void decideItem(o, i, yes)}
                            />
                          </li>
                        ))}
                      </ul>
                      {o.note && <p className="qrow-note">“{o.note}”</p>}

                      {open && (
                        <div className="qrow-body">
                          <div className="qrow-actions">
                            <button
                              className={`badge ${o.paymentStatus === 'PAID' ? 'badge-open' : 'badge-warn'}`}
                              style={{ border: 0, cursor: 'pointer' }}
                              disabled={busyId === o.id}
                              onClick={() => togglePaid(o)}
                            >
                              {o.paymentStatus === 'PAID' ? 'Paid' : 'Mark paid'}
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={printing === o.id}
                              onClick={() => void printBill(o)}
                            >
                              {printing === o.id ? 'Printing…' : '🖨 Print bill'}
                            </button>
                            <Link className="btn btn-secondary btn-sm" to={`/staff/table/${o.id}`}>
                              Open bill
                            </Link>
                            {/* From the restaurant's own WhatsApp, which is
                                free and unlimited — Meta only charges a
                                business for messaging somebody who has not
                                messaged them. One tap, already written. */}
                            {!!waLink(o.customerPhone ?? '', '') && (
                              <a
                                className="btn btn-ghost btn-sm"
                                href={waAppLink(
                                  o.customerPhone,
                                  thanksText(o.customerName || 'there'),
                                )}
                                target="_blank"
                                rel="noreferrer"
                                title={`Thank ${o.customerName || 'them'} on WhatsApp`}
                              >
                                Thank on WhatsApp
                              </a>
                            )}
                            <span className="spacer" />
                            {!['COMPLETED', 'PICKED_UP', 'CANCELLED', 'DECLINED'].includes(o.status) && (
                              <button
                                className="btn btn-danger btn-sm"
                                disabled={busyId === o.id}
                                onClick={() =>
                                  o.status === 'REQUESTED' ? decline(o) : advance(o, 'CANCELLED')
                                }
                              >
                                {o.status === 'REQUESTED' ? 'Can’t take it' : 'Cancel'}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
                {done && rows.length > 3 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowDone(!showDone)}>
                    {showDone ? 'Show fewer' : `Show ${rows.length - 3} more`}
                  </button>
                )}
              </section>
            )
          })}
        </div>
      )}

      {orders && visible.length > 0 && view === 'board' && (
        <div className="board">
          {COLUMNS.map((col) => {
            const cards = visible.filter((o) => col.statuses.includes(o.status))
            return (
              <section key={col.key} className="board-col">
                <div className="board-col-head">
                  <h3>{col.title}</h3>
                  <span className="board-col-count">{cards.length}</span>
                </div>
                {cards.length === 0 ? (
                  <div className="board-empty">Nothing here</div>
                ) : (
                  cards.map((o) => {
                    const next = nextStatus(o.serviceType ?? o.type, o.status)
                    return (
                      <article key={o.id} className={`o-card ${o.status === 'NEW' ? 'is-new' : ''}`}>
                        <div className="o-card-top">
                          <Link className="o-number" to={`/staff/table/${o.id}`}>
                            #{o.orderNumber}
                          </Link>
                          <span className={`badge ${o.serviceType === 'dine_in' ? 'badge-accent' : 'badge-info'}`}>
                            {SERVICE_LABEL[(o.serviceType ?? o.type) as ServiceType]}
                          </span>
                          {o.isGroup && <span className="o-group-tag">GROUP</span>}
                          <span className="spacer" />
                          <span className="tiny muted">{timeAgo(o.createdAt)}</span>
                          <WantedFor order={o} />
                        </div>

                        <div className="o-where">
                          {o.serviceType === 'dine_in' ? o.tableLabel : 'Counter'}
                        </div>
                        <div className="o-name">
                          {o.customerName} · {clockTime(o.createdAt)}
                          {/* Tappable, because the two calls a kitchen makes
                              are "we are out of that" and "we cannot find
                              you", and both start with finding the number. */}
                          {o.customerPhone && (
                            <>
                              {' · '}
                              <a className="o-phone" href={`tel:${o.customerPhone.replace(/[^0-9+]/g, '')}`}>
                                {o.customerPhone}
                              </a>
                            </>
                          )}
                        </div>

                        <div className="o-items">
                          {o.isGroup
                            ? groupByPerson(o.items).map((person) => (
                                <div key={person.name}>
                                  <div className="o-person">{person.name}</div>
                                  {person.items.map((i: any) => (
                                    <div key={i.id} className="o-item">
                                      <b>{i.quantity}×</b>
                                      <span>{i.name}</span>
                                      {i.paid && <span className="tiny muted">paid</span>}
                                    </div>
                                  ))}
                                </div>
                              ))
                            : o.items.map((i: any) => (
                                <div key={i.id} className={`o-item ${i.accepted === false ? 'item-off' : ''}`}>
                                  <b>{i.quantity}×</b>
                                  <span>{i.name}</span>
                                  <ItemCall
                                    order={o}
                                    item={i}
                                    busy={busyId === o.id}
                                    decide={(yes) => void decideItem(o, i, yes)}
                                  />
                                </div>
                              ))}
                        </div>

                        {o.note && (
                          <p className="tiny" style={{ color: 'var(--warn)', marginBottom: 8 }}>
                            “{o.note}”
                          </p>
                        )}

                        <div className="o-foot" style={{ marginBottom: 8 }}>
                          <button
                            className={`badge ${payLook(o).cls}`}
                            style={{ border: 0, cursor: 'pointer' }}
                            disabled={busyId === o.id}
                            onClick={() => togglePaid(o)}
                            title={payLook(o).hint}
                          >
                            {payLook(o).label}
                          </button>
                          {o.paymentState === 'sent' && !!o.upiRef && (
                            <span className="tiny muted">ref {o.upiRef}</span>
                          )}
                          <span className="spacer" />
                          <span className="o-total">{money(o.totalCents)}</span>
                        </div>

                        <div className="o-foot">
                          {next ? (
                            <button
                              className="btn btn-accent btn-sm"
                              disabled={busyId === o.id}
                              onClick={() => advance(o, next)}
                            >
                              {goLabel(o, next)}
                            </button>
                          ) : (
                            <span className="badge badge-open">{STATUS_LABEL[o.status as OrderStatus]}</span>
                          )}
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={printing === o.id}
                            onClick={() => void printBill(o)}
                          >
                            {printing === o.id ? 'Printing…' : '🖨 Print bill'}
                          </button>
                          <span className="spacer" />
                          {!['COMPLETED', 'PICKED_UP', 'CANCELLED', 'DECLINED'].includes(o.status) && (
                            <button
                              className="btn btn-danger btn-sm"
                              disabled={busyId === o.id}
                              onClick={() => (o.status === 'REQUESTED' ? decline(o) : advance(o, 'CANCELLED'))}
                            >
                              {o.status === 'REQUESTED' ? 'Can’t take it' : 'Cancel'}
                            </button>
                          )}
                        </div>
                      </article>
                    )
                  })
                )}
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
