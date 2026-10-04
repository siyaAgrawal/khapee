/**
 * Counting page visits for Khapee insights — see server/visits.ts.
 *
 * The visitor is a random id made up here and kept on this phone; nothing
 * about the person is sent. Where the visit came from is worked out once, on
 * the first page of the visit, from the address and the page that linked here.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const VISITOR = 'khapee.visitor'
const SOURCE = 'khapee.visitSource'

function visitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR)
    if (!id) {
      id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
      localStorage.setItem(VISITOR, id)
    }
    return id
  } catch {
    // Storage blocked: still a visit, just one we cannot tie to the next.
    return `x-${Math.random().toString(36).slice(2, 14)}`
  }
}

/** How this visit started: the QR, a search, a link from somewhere, or typed in. */
function arrival(path: string): { source: string; referrer: string } {
  const params = new URLSearchParams(window.location.search)
  const tagged = (params.get('utm_source') || params.get('src') || '').toLowerCase()
  let host = ''
  try {
    host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''
  } catch {
    host = ''
  }
  if (host === window.location.hostname.replace(/^www\./, '')) host = ''
  const from = `${tagged} ${host}`
  let source = 'direct'
  if (/^\/(t|z)\//.test(path) || tagged === 'qr') source = 'qr'
  else if (/google|bing|duckduckgo|yahoo|ecosia|yandex|search/.test(from)) source = 'search'
  else if (/instagram/.test(from)) source = 'instagram'
  else if (/whatsapp|wa\.me/.test(from)) source = 'whatsapp'
  else if (/facebook|fb\./.test(from)) source = 'facebook'
  else if (window.matchMedia?.('(display-mode: standalone)').matches) source = 'app'
  else if (host || tagged) source = 'link'
  return { source, referrer: host }
}

function send(body: object) {
  const json = JSON.stringify(body)
  try {
    if (navigator.sendBeacon?.('/api/visit', new Blob([json], { type: 'application/json' }))) return
  } catch {
    /* fall through to fetch */
  }
  fetch('/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(
    () => {},
  )
}

/** Mounted once, in App: one visit per page the customer opens. */
export function useVisitCounter() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (pathname.startsWith('/staff') || pathname.startsWith('/insights')) return
    let landing = false
    let came: { source: string; referrer: string }
    try {
      const kept = sessionStorage.getItem(SOURCE)
      if (kept) came = JSON.parse(kept)
      else {
        came = arrival(pathname)
        landing = true
        sessionStorage.setItem(SOURCE, JSON.stringify(came))
      }
    } catch {
      came = arrival(pathname)
      landing = true
    }
    // A QR opened from inside the app is still a scan.
    const source = /^\/(t|z)\//.test(pathname) ? 'qr' : came.source
    send({ visitor: visitorId(), path: pathname, source, referrer: landing ? came.referrer : '', landing })
  }, [pathname])
}
