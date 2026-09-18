/**
 * Sending one email, over SMTP, with nothing in between.
 *
 * The restaurant wanted order alerts by email as well as on the phone, and
 * email is the one that always arrives: a push subscription can be revoked by
 * a phone reset or a cleared cache without anybody noticing, whereas an inbox
 * is an inbox. Gmail will relay this for a normal account with an app
 * password, free, so there is no provider in the middle and no per-message
 * charge — the same standard the app holds everywhere else.
 *
 * Deliberately not a library. Everything below is one plain SMTP conversation
 * over TLS: greet, authenticate, name the sender and recipient, send the
 * message. A mail library would bring a dependency tree to do that, and this
 * app sends exactly one kind of message.
 *
 * Set in the environment to switch it on:
 *
 *   SMTP_HOST   smtp.gmail.com
 *   SMTP_PORT   465            (implicit TLS; 587 is not supported here)
 *   SMTP_USER   the full Gmail address
 *   SMTP_PASS   a 16-character app password, NOT the account password
 *   SMTP_FROM   optional display address, defaults to SMTP_USER
 *
 * A Gmail app password needs 2-step verification switched on first, at
 * myaccount.google.com → Security → App passwords.
 */
import tls from 'node:tls'

export function mailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

export type Mail = { to: string; subject: string; text: string }

/** One line of an address or subject, with anything that could inject a header stripped. */
function headerSafe(value: string): string {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

/**
 * A line of message body, escaped for the DATA section.
 *
 * SMTP ends a message with a lone dot on its own line, so a body line that is
 * itself a dot has to be doubled or the message stops early.
 */
function dotStuff(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => (line.startsWith('.') ? '.' + line : line))
    .join('\r\n')
}

/** Non-ASCII in a header has to be encoded; ₹ and a café's name both are. */
function encodeHeader(value: string): string {
  const safe = headerSafe(value)
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(safe)) return safe
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`
}

/**
 * Sends the mail, and never throws.
 *
 * Returns what happened rather than a boolean, so a caller logging this can
 * say "not switched on" and "the server said no" differently — those need
 * different things done about them.
 */
export function sendMail(mail: Mail): Promise<'sent' | 'off' | 'failed'> {
  if (!mailConfigured()) return Promise.resolve('off')
  const to = headerSafe(mail.to)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return Promise.resolve('failed')

  const host = String(process.env.SMTP_HOST)
  const port = Number(process.env.SMTP_PORT || 465)
  const user = String(process.env.SMTP_USER)
  const pass = String(process.env.SMTP_PASS)
  const from = headerSafe(process.env.SMTP_FROM || user)

  const message = [
    `From: ${encodeHeader('Khapee')} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    `Date: ${new Date().toUTCString()}`,
    '',
    dotStuff(mail.text),
    '',
  ].join('\r\n')

  // The conversation, in order. Each step waits for a reply code in `expect`
  // before the next is written; anything else ends the attempt.
  const steps: { send: string; expect: number }[] = [
    { send: `EHLO khapee\r\n`, expect: 250 },
    { send: `AUTH LOGIN\r\n`, expect: 334 },
    { send: `${Buffer.from(user, 'utf8').toString('base64')}\r\n`, expect: 334 },
    { send: `${Buffer.from(pass, 'utf8').toString('base64')}\r\n`, expect: 235 },
    { send: `MAIL FROM:<${from}>\r\n`, expect: 250 },
    { send: `RCPT TO:<${to}>\r\n`, expect: 250 },
    { send: `DATA\r\n`, expect: 354 },
    { send: `${message}\r\n.\r\n`, expect: 250 },
    { send: `QUIT\r\n`, expect: 221 },
  ]

  return new Promise<'sent' | 'off' | 'failed'>((resolve) => {
    let done = false
    const finish = (result: 'sent' | 'failed') => {
      if (done) return
      done = true
      try {
        socket.destroy()
      } catch {
        /* already gone */
      }
      resolve(result)
    }

    const socket = tls.connect({ host, port, servername: host })
    socket.setEncoding('utf8')
    socket.setTimeout(20_000, () => finish('failed'))
    socket.on('error', () => finish('failed'))

    // -1 is the server's opening greeting, which arrives unprompted.
    let step = -1
    let buffer = ''

    socket.on('data', (chunk: string) => {
      buffer += chunk
      // A multi-line reply repeats its code with a hyphen; the last line has a
      // space. Waiting for that is what keeps EHLO's capability list from
      // being read as nine separate replies.
      const lines = buffer.split(/\r?\n/).filter(Boolean)
      const last = lines[lines.length - 1] ?? ''
      if (!/^\d{3} /.test(last)) return
      buffer = ''

      const code = Number(last.slice(0, 3))
      const expected = step === -1 ? 220 : steps[step].expect
      if (code !== expected) return finish(code === 221 ? 'sent' : 'failed')

      step++
      if (step >= steps.length) return finish('sent')
      socket.write(steps[step].send)
    })
  }).catch((): 'failed' => 'failed')
}
