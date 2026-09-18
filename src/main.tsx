import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { SessionProvider } from './lib/session'
import { CartProvider } from './lib/cart'
import { ToastProvider } from './components/ui'
import { keepAlertsAlive } from './lib/push'
import './styles.css'

// A phone that was set up for order alerts checks, quietly, that the server
// still knows about it — see keepAlertsAlive. Also whenever the app is brought
// back to the front, because that is when somebody is about to rely on it.
void keepAlertsAlive()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void keepAlertsAlive()
})

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
