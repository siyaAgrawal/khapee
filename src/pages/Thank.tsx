import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Header from '../components/Header'

/**
 * The step between tapping "thank them" and WhatsApp opening.
 *
 * The notification could carry the wa.me link itself, and on a desktop it
 * would work. An app installed on an iPhone Home Screen is another matter: it
 * runs in its own window with its own scope, and a service worker asking that
 * window to open somebody else's site is the kind of thing Safari declines
 * quietly. The result is a notification that does nothing when tapped, which
 * is worse than no notification.
 *
 * So the notification points here — our own page, always allowed — and here
 * asks for WhatsApp, which is an ordinary navigation of the kind every browser
 * permits. The button underneath is for when even that is refused, and is the
 * reason this page has anything on it at all rather than being a redirect.
 */
export default function Thank() {
  const [params] = useSearchParams()
  const to = (params.get('to') ?? '').replace(/\D/g, '')
  const text = params.get('text') ?? ''
  const who = params.get('who') ?? 'them'
  const [tried, setTried] = useState(false)

  const link = to ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : ''

  useEffect(() => {
    if (!link) return
    // Straight away, before anything is painted — the page somebody wanted is
    // WhatsApp, not this one.
    const go = setTimeout(() => {
      setTried(true)
      window.location.href = link
    }, 60)
    return () => clearTimeout(go)
  }, [link])

  return (
    <div className="app">
      <Header />
      <main className="page page-narrow">
        <div className="card card-pad invite">
          <span className="invite-bell" aria-hidden>
            💬
          </span>
          <h1>Thank {who}</h1>
          {link ? (
            <>
              <p className="muted">
                {tried ? 'WhatsApp should be opening.' : 'Opening WhatsApp…'} The message is already
                written — you just press send.
              </p>
              <a className="btn btn-accent btn-lg btn-block" href={link}>
                Open WhatsApp
              </a>
              <p className="tiny muted" style={{ marginTop: 14 }}>
                Going to {to.replace(/^91/, '+91 ')}
              </p>
            </>
          ) : (
            <p className="muted">
              This order has no phone number on it, so there is nowhere to send a message.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
