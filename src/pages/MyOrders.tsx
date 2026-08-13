import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { EmptyState, LoadingBlock, money, timeAgo } from '../components/ui'
import { allReceipts } from '../lib/table-context'
import { SERVICE_LABEL, STATUS_LABEL, type OrderStatus, type ServiceType } from '../../shared/orders'

function statusTone(status: OrderStatus) {
  if (status === 'CANCELLED') return 'badge-closed'
  if (status === 'COMPLETED' || status === 'PICKED_UP') return 'badge-open'
  if (status === 'READY' || status === 'READY_FOR_PICKUP') return 'badge-accent'
  return 'badge-info'
}

export default function MyOrders() {
  const { user, loading } = useSession()
  const [orders, setOrders] = useState<any[] | null>(null)

  useEffect(() => {
    if (loading) return
    if (user && user.role === 'customer') {
      api<{ orders: any[] }>('/orders/mine')
        .then((r) => setOrders(r.orders))
        .catch(() => setOrders([]))
      return
    }
    // Guests: rebuild the list from receipts saved on this device.
    const receipts = allReceipts()
    if (!receipts.length) {
      setOrders([])
      return
    }
    Promise.all(
      receipts.map((r) =>
        api<{ order: any }>(`/orders/${r.orderNumber}?token=${encodeURIComponent(r.token)}`)
          .then((x) => x.order)
          .catch(() => null),
      ),
    ).then((list) => setOrders(list.filter(Boolean).sort((a, b) => b.id - a.id)))
  }, [user, loading])

  return (
    <div className="app">
      <Header />
      <main className="page page-narrow">
        <h1 style={{ marginBottom: 6 }}>Your orders</h1>
        <p className="muted mb-2">
          {user ? `Signed in as ${user.name}` : 'Orders placed on this device. Sign in to keep them anywhere.'}
        </p>

        {!orders ? (
          <LoadingBlock />
        ) : orders.length === 0 ? (
          <EmptyState
            emoji="🧾"
            title="No orders yet"
            body="When you place an order it will show up here with live status."
            action={
              <Link className="btn btn-accent" to="/restaurants">
                Browse restaurants
              </Link>
            }
          />
        ) : (
          <div className="stack">
            {orders.map((o) => (
              <Link key={o.id} to={`/order/${o.orderNumber}`} className="card card-pad">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong className="mono" style={{ fontSize: 16 }}>
                    #{o.orderNumber}
                  </strong>
                  <span className={`badge ${statusTone(o.status)}`}>{STATUS_LABEL[o.status as OrderStatus]}</span>
                </div>
                <p style={{ marginTop: 6, fontWeight: 600 }}>{o.restaurantName}</p>
                <p className="tiny muted">
                  {o.serviceType === 'dine_in' ? o.tableLabel : SERVICE_LABEL[(o.serviceType ?? o.type) as ServiceType]} · {o.itemCount} item
                  {o.itemCount > 1 ? 's' : ''} · {money(o.totalCents)} · {timeAgo(o.createdAt)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
