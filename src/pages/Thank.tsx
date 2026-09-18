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
   * No automatic redirect, on purpose.
   *
   * A page cannot hand you over to another app unless you asked it to: iOS
   * refuses a navigation into WhatsApp that nobody tapped, silently, and what
   * is left on screen is this page looking like the notification did nothing.
   * A button is the ask. It costs one tap and it works every time, which is
   * the better trade.
   */

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
