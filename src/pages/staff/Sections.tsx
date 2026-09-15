import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import SectionTabs from '../../components/SectionTabs'
import { api, openStream } from '../../lib/api'

/**
 * The four sections of the dashboard, each a title and the views that belong
 * to one job. Everything under them is the screen that was already there —
 * this only decides what sits beside what, and what it is called.
 */

function Section({
  title,
  blurb,
  tabs,
  children,
}: {
  title: string
  blurb: string
  tabs: { to: string; label: string; end?: boolean; count?: number }[]
  children?: React.ReactNode
}) {
  return (
    <div className="section">
      <header className="section-head">
        <div>
          <h1>{title}</h1>
          <p className="section-blurb">{blurb}</p>
        </div>
        {children}
      </header>
      <SectionTabs tabs={tabs} />
      <Outlet />
    </div>
  )
}

/** Live counts, so a tab can say how much is waiting behind it. */
function useWaiting() {
  const [n, setN] = useState<{ payments: number; deliveries: number }>({ payments: 0, deliveries: 0 })
  useEffect(() => {
    const load = () =>
      Promise.all([
        api<{ payments: any[] }>('/staff/payments').catch(() => ({ payments: [] })),
        api<any>('/staff/ops').catch(() => null),
      ]).then(([p, ops]) =>
        setN({
          payments: (p.payments ?? []).filter((x: any) => x.status === 'CLAIMED').length,
          deliveries: ops?.summary?.deliveryRequests ?? 0,
        }),
      )
    load()
    const close = openStream(() => load())
    const poll = setInterval(load, 15000)
    return () => {
      close()
      clearInterval(poll)
    }
  }, [])
  return n
}

export function OrdersSection() {
  const waiting = useWaiting()
  return (
    <Section
      title="Orders"
      blurb="Everything being cooked, carried and collected right now."
      tabs={[
        { to: '/staff/orders', label: 'All orders', end: true },
        { to: '/staff/orders/floor', label: 'Tables & cars' },
        { to: '/staff/orders/deliveries', label: 'Deliveries', count: waiting.deliveries },
        { to: '/staff/orders/check', label: 'Check a code' },
      ]}
    />
  )
}

export function TillSection() {
  const waiting = useWaiting()
  return (
    <Section
      title="Till"
      blurb="Ring up a sale at the counter, and confirm money that has come in."
      tabs={[
        { to: '/staff/till', label: 'Counter sale', end: true },
        { to: '/staff/till/payments', label: 'To confirm', count: waiting.payments },
      ]}
    />
  )
}

export function MenuSection() {
  return (
    <Section
      title="Menu"
      blurb="The dishes customers see, and the photographs of them."
      tabs={[
        { to: '/staff/menu', label: 'Dishes', end: true },
        { to: '/staff/menu/photos', label: 'Photos' },
      ]}
    />
  )
}

export function SettingsSection() {
  return (
    <Section
      title="Settings"
      blurb="Set these up once: who you are, where people sit, and how they get in."
      tabs={[
        { to: '/staff/settings', label: 'Restaurant', end: true },
        { to: '/staff/settings/tables', label: 'Tables & QR codes' },
        { to: '/staff/settings/codes', label: 'Access codes' },
        { to: '/staff/settings/zones', label: 'Kerbside' },
      ]}
    />
  )
}
