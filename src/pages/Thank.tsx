import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Header from '../components/Header'
import { waAppLink, waLink } from '../../shared/thanks'

/**
 * The step between tapping "thank them" and WhatsApp opening.
 *
 * The notification cannot point straight at WhatsApp: an app installed on an
 * iPhone Home Screen runs in its own scope, and a service worker asking that
 * window to open somebody else's site is declined quietly. So it points here,
 * at our own page, which is always allowed.
 *
 * And this page does not redirect either, for the same family of reason: iOS
 * will not let a page hand you to another app unless you asked it to, so an
 * automatic jump into WhatsApp is refused silently and what is left on screen
 * is Khapee, looking as though the notification did nothing. The button is the
 * ask. One tap, and it works every time.
 */
export default function Thank() {
  const [params] = useSearchParams()
  const to = (params.get('to') ?? '').replace(/\D/g, '')
  const text = params.get('text') ?? ''
  const who = params.get('who') ?? 'them'

  // The app first, the website only if the app is not there.
  const appLink = waAppLink(to, text)
  const link = waLink(to, text)

  /**
   * Tries WhatsApp by itself, once, and keeps the button either way.
   *
   * Opening this page was itself a tap — on the notification — and on most
   * phones that is gesture enough for the jump to be allowed, which makes the
   * whole thing one tap instead of two. Where it is not allowed it is refused
   * silently and nothing at all happens, which is why the button below is not
   * an alternative to this but the thing that is always there: this is an
   * attempt, not the plan.
   *
   * Once, and marked as done, because coming back from WhatsApp lands on this
   * page again and a page that bounces you out every time you return to it is
   * a page you cannot leave.
   */
  useEffect(() => {
    if (!appLink) return
    const once = `khapee.sent.${to}.${text}`
    try {
      if (sessionStorage.getItem(once)) return
      sessionStorage.setItem(once, '1')
    } catch {
      return // a private window would loop; the button still works
    }
    const go = setTimeout(() => {
      window.location.href = appLink
    }, 120)
    return () => clearTimeout(go)
  }, [appLink, to, text])

  return (
    <div className="app">
      <Header />
      <main className="page page-narrow">
        <div className="card card-pad thank">
          {link ? (
            <>
              <p className="thank-kicker">Send to {who}</p>
              <p className="thank-message">{text}</p>
              <a className="btn btn-accent btn-lg btn-block thank-go" href={appLink}>
                Open WhatsApp
              </a>
              <p className="tiny muted">
                Opens the chat with {to.replace(/^91/, '+91 ')}, message already written. You press
                send.
              </p>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                Nothing happened?{' '}
                <a href={link} target="_blank" rel="noreferrer">
                  Try it through the browser
                </a>
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
