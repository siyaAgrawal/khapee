import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useSession } from '../lib/session'
import { Art, Spinner, useToast } from './ui'

/**
 * Switches the dashboard between the restaurants on this account, and offers
 * to add another. One account can run several places — and still order as a
 * customer — so this is the only thing that decides which one you are looking at.
 */
export default function RestaurantSwitcher() {
  const { user, refresh } = useSession()
  const navigate = useNavigate()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null
  const list = user.restaurants ?? []
  const active = list.find((r) => r.id === user.restaurantId) ?? list[0]

  const switchTo = async (id: number) => {
    if (id === user.restaurantId) {
      setOpen(false)
      return
    }
    setBusy(true)
    try {
      await api('/staff/switch', { body: { restaurantId: id } })
      await refresh()
      setOpen(false)
      navigate('/staff/orders')
    } catch (e) {
      toast((e as ApiError).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="switcher" ref={ref}>
      <button className="switcher-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Art emoji={active?.emoji ?? '🍽️'} hue={210} className="switcher-art" rounded={10} />
        <span className="switcher-label">
          <strong>{active?.name ?? 'No restaurant'}</strong>
          <span className="tiny">
            {list.length > 1 ? `${list.length} restaurants` : (active?.jobTitle ?? 'Owner')}
          </span>
        </span>
        {busy ? <Spinner /> : <span className="switcher-chevron" aria-hidden>⌄</span>}
      </button>

      {open && (
        <div className="switcher-menu" role="menu">
          {list.map((r) => (
            <button
              key={r.id}
              className={`switcher-item ${r.id === user.restaurantId ? 'active' : ''}`}
              onClick={() => switchTo(r.id)}
              role="menuitem"
            >
              <span className="switcher-emoji" aria-hidden>
                {r.emoji}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{r.name}</strong>
                <span className="tiny muted">{r.jobTitle}</span>
              </span>
              {r.id === user.restaurantId && <span aria-hidden>✓</span>}
            </button>
          ))}
          <button
            className="switcher-item switcher-add"
            onClick={() => {
              setOpen(false)
              navigate('/for-restaurants')
            }}
            role="menuitem"
          >
            <span className="switcher-emoji" aria-hidden>
              ＋
            </span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <strong>Add a restaurant</strong>
              <span className="tiny muted">Run another place from this account</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
