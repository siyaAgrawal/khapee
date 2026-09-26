import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { SessionProvider } from './lib/session'
import { CartProvider } from './lib/cart'
import { ToastProvider } from './components/ui'
import { keepAlertsAlive } from './lib/push'
import { adoptOldKeys } from './lib/renamed-storage'
import './styles.css'

// Before anything reads a key: the old names still hold real state on every
// phone that has used Khapee before today. See renamed-storage.
adoptOldKeys()

// A phone that was set up for order alerts checks, quietly, that the server
// still knows about it — see keepAlertsAlive. Also whenever the app is brought
// back to the front, because that is when somebody is about to rely on it.
void keepAlertsAlive()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void keepAlertsAlive()
})
// And while it stays open, which a till or a kitchen tablet does all day: when
// the live stream comes back after the server restarted, when the network
// returns, and every few minutes regardless, so a device the server forgot is
// back on the list long before the next order.
window.addEventListener('khapee:stream-reopened', () => void keepAlertsAlive())
window.addEventListener('online', () => void keepAlertsAlive())
setInterval(() => void keepAlertsAlive(), 5 * 60 * 1000)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <CartProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </CartProvider>
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
