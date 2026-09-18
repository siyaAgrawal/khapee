/**
 * The page a tapped notification lands on, whose whole job is not to be seen.
 *
 * Getting from a notification to WhatsApp has one unavoidable step in the
 * middle. A service worker cannot open WhatsApp itself — openWindow is
 * specified to reject anything that is not http or https, and Safari rejects
 * it — so the notification has to point at a page of ours, and that page hands
 * over. The hand-over is an ordinary navigation to whatsapp://, which every
 * phone allows; the thing that made it feel broken was never permission.
 *
 * It was weight. This used to be a route inside the app, which meant tapping
 * the notification downloaded half a megabyte of JavaScript, started React and
 * read the address bar before it could even try — and on a free host waking
 * from sleep that is several seconds of a white screen, by which point the
 * phone has been put back in a pocket. So this is not the app. It is one file
 * with no stylesheet, no bundle and no framework, and the redirect is the first
 * thing in it: it runs while the rest of the document is still arriving.
 *
 * The button underneath is not a fallback for a failed redirect so much as the
 * honest version of it. iOS asks "Open in WhatsApp?" for an automatic jump and
 * somebody has to say yes; if they said no, or the prompt never came, the
 * button is what is left on screen and it says what it does.
 */

/** Text going into markup, where the customer's own name decides the bytes. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Builds the page for one thank-you.
 *
 * `to` is already digits with the country code; `text` is the message. Both
 * come off the query string the push wrote, so both are treated as somebody
 * else's input on the way back out.
 */
export function thankPage(to: string, who: string, text: string): string {
  const number = String(to ?? '').replace(/\D/g, '')
  const message = String(text ?? '')
  const name = String(who ?? 'them')

  if (!number) {
    return page(
      'Nothing to send',
      `<h1>No number on this order</h1>
       <p>There is nowhere to send a message — the customer did not leave a mobile number.</p>
       <p><a class="alt" href="/staff/orders">Back to orders</a></p>`,
      '',
    )
  }

  const app = `whatsapp://send?phone=${number}&text=${encodeURIComponent(message)}`
  const web = `https://wa.me/${number}?text=${encodeURIComponent(message)}`
  const shown = number.replace(/^91/, '+91 ')

  return page(
    `Send to ${escapeHtml(name)}`,
    `<p class="kicker">Sending to ${escapeHtml(name)} · ${escapeHtml(shown)}</p>
     <p class="msg">${escapeHtml(message)}</p>
     <a class="go" id="go" href="${escapeHtml(app)}">Open WhatsApp</a>
     <p class="note">The message is already written. You just press send.</p>
     <p class="note"><a class="alt" href="${escapeHtml(web)}">Nothing happened? Try it this way</a></p>`,
    app,
  )
}

/**
 * The document itself, redirect first.
 *
 * The script sits above the content on purpose: a browser runs it the moment
 * it is parsed, so the jump is attempted before the rest of the page exists.
 * `replace` rather than `assign` so that coming back from WhatsApp does not
 * land on this page again with a back button that returns to it forever.
 */
function page(title: string, body: string, jump: string): string {
  const leave = jump
    ? `<script>
  (function () {
    var wa = ${JSON.stringify(jump)};
    // Once per visit. Coming back from WhatsApp re-shows this page from the
    // back-forward cache, and a page that throws you out every time you return
    // to it is a page you cannot get out of.
    try {
      if (!sessionStorage.getItem('k:' + wa)) {
        sessionStorage.setItem('k:' + wa, '1');
        location.replace(wa);
      }
    } catch (e) {
      location.replace(wa);
    }
  })();
</script>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
${leave}
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 28px 20px;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #fff; color: #14181f;
    display: flex; flex-direction: column; justify-content: center;
    min-height: 100vh; box-sizing: border-box;
  }
  h1 { font-size: 20px; margin: 0 0 10px; }
  .kicker { font-size: 13px; color: #6b7280; margin: 0 0 14px; }
  .msg {
    background: #f1f5f9; border-radius: 14px; padding: 14px 16px;
    margin: 0 0 22px; font-size: 15px;
  }
  .go {
    display: block; text-align: center; text-decoration: none;
    background: #25d366; color: #05300f; font-weight: 700; font-size: 18px;
    padding: 18px; border-radius: 14px;
  }
  .note { font-size: 13px; color: #6b7280; text-align: center; margin: 14px 0 0; }
  .alt { color: #6b7280; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1117; color: #e6edf3; }
    .msg { background: #161b22; }
    .kicker, .note, .alt { color: #9aa4b2; }
  }
</style>
</head>
<body>
${body}
</body>
</html>`
}
