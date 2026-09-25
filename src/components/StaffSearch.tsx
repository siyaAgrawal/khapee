import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { money } from './ui'

/**
 * One search box for the whole dashboard.
 *
 * A counter looks things up constantly — "what did table 4 order", "is the
 * paneer tikka still on", "find the bill for the man who rang about his
 * order" — and each of those lived behind a different screen with its own
 * search. Knowing which screen to go to first is the part nobody should have
 * to learn.
 *
 * It sits in the shell, so it is on every screen. Slash focuses it from
 * anywhere that is not already a text box, Escape closes it, and the arrow
 * keys and Enter work, because the person using this has one hand on a
 * card machine.
 */
type Hit =
  | { kind: 'order'; id: number; title: string; sub: string; to: string }
  | { kind: 'dish'; id: number; title: string; sub: string; to: string }
  | { kind: 'table'; id: number; title: string; sub: string; to: string }

type Results = { orders: any[]; dishes: any[]; tables: any[] }

export default function StaffSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const [loading, setLoading] = useState(false)
  const box = useRef<HTMLInputElement>(null)
  const wrap = useRef<HTMLDivElement>(null)

  /* Slash to search, from anywhere. Not while something is already being
     typed into, or the first letter of every dish name opens this instead. */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        box.current?.focus()
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  /* A click anywhere else puts it away. */
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  /*
   * Debounced, because this runs against the kitchen's own server while it is
   * also taking orders. 200ms is under the time between keystrokes for
   * somebody typing properly and far under it for somebody hunting for keys.
   */
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    let live = true
    const timer = setTimeout(() => {
      api<Results>(`/staff/search?q=${encodeURIComponent(term)}`)
        .then((r) => {
          if (!live) return
          setHits(flatten(r))
          setAt(0)
          setOpen(true)
        })
        .catch(() => live && setHits([]))
        .finally(() => live && setLoading(false))
    }, 200)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q])

  const go = (hit: Hit) => {
    setOpen(false)
    setQ('')
    box.current?.blur()
    navigate(hit.to)
  }

  const keys = (e: React.KeyboardEvent) => {
    if (!open || !hits.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAt((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAt((i) => (i - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(hits[at])
    }
  }

  return (
    <div className="staff-search" ref={wrap}>
      <input
        ref={box}
        className="staff-search-box"
        value={q}
        placeholder="Search orders, dishes, tables"
        aria-label="Search the dashboard"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={keys}
      />
      {open && (
        <div className="staff-search-out" role="listbox">
          {loading && !hits.length && <p className="tiny muted staff-search-empty">Looking…</p>}
          {!loading && !hits.length && (
            <p className="tiny muted staff-search-empty">Nothing matches “{q.trim()}”.</p>
          )}
          {hits.map((h, i) => (
            <button
              key={`${h.kind}-${h.id}`}
              role="option"
              aria-selected={i === at}
              className={`staff-search-hit ${i === at ? 'on' : ''}`}
              onMouseEnter={() => setAt(i)}
              onClick={() => go(h)}
            >
              <span className="staff-search-kind">{LABEL[h.kind]}</span>
              <span className="staff-search-title">{h.title}</span>
              <span className="staff-search-sub">{h.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const LABEL: Record<Hit['kind'], string> = { order: 'Order', dish: 'Dish', table: 'Table' }

/**
 * Orders first, then dishes, then tables.
 *
 * Not alphabetical and not by score: the order somebody is asking about is
 * nearly always the thing in front of them right now, and a dish with a
 * similar name should never come above it.
 */
function flatten(r: Results): Hit[] {
  return [
    ...r.orders.map(
      (o): Hit => ({
        kind: 'order',
        id: o.id,
        title: `#${o.orderNumber}`,
        sub: [o.place, o.customerName, money(o.totalCents)].filter(Boolean).join(' · '),
        to: `/staff/table/${o.id}`,
      }),
    ),
    ...r.dishes.map(
      (d): Hit => ({
        kind: 'dish',
        id: d.id,
        title: d.name,
        sub: [d.section, money(d.priceCents), d.isAvailable ? '' : 'off the menu']
          .filter(Boolean)
          .join(' · '),
        to: `/staff/menu?find=${encodeURIComponent(d.name)}`,
      }),
    ),
    ...r.tables.map(
      (t): Hit => ({
        kind: 'table',
        id: t.id,
        title: t.label,
        sub: `${t.seats} seats`,
        to: '/staff/floor',
      }),
    ),
  ]
}
