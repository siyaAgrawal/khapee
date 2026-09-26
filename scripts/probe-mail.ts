/**
 * Proves the order-alert email actually sends, without a real mail account.
 *
 * A local TLS server speaking just enough SMTP to be Gmail: greet, EHLO,
 * AUTH LOGIN, MAIL FROM, RCPT TO, DATA, QUIT. Whatever the app writes is
 * captured and printed, so the message can be read exactly as a restaurant
 * would receive it.
 */
import tls from 'node:tls'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** A throwaway certificate, so the probe needs nothing prepared beforehand. */
function selfSigned(): { key: string; cert: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khapee-probe-'))
  const key = path.join(dir, 'key.pem')
  const crt = path.join(dir, 'cert.pem')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', crt,
    '-days', '1', '-nodes', '-subj', '/CN=localhost',
  ], { stdio: 'ignore' })
  const pair = { key: fs.readFileSync(key, 'utf8'), cert: fs.readFileSync(crt, 'utf8') }
  fs.rmSync(dir, { recursive: true, force: true })
  return pair
}


const PORT = 4465

const seen: { user?: string; pass?: string; from?: string; to?: string; body?: string } = {}

const server = tls.createServer(
  selfSigned(),
  (socket) => {
    socket.setEncoding('utf8')
    let inData = false
    let data = ''
    let expectUser = false
    let expectPass = false

    socket.write('220 localhost ESMTP ready\r\n')
    socket.on('data', (chunk: string) => {
      if (inData) {
        data += chunk
        if (data.includes('\r\n.\r\n')) {
          seen.body = data.split('\r\n.\r\n')[0]
          inData = false
          socket.write('250 2.0.0 OK queued\r\n')
        }
        return
      }
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        const up = line.toUpperCase()
        if (expectUser) {
          seen.user = Buffer.from(line, 'base64').toString('utf8')
          expectUser = false
          expectPass = true
          socket.write('334 UGFzc3dvcmQ6\r\n')
        } else if (expectPass) {
          seen.pass = Buffer.from(line, 'base64').toString('utf8')
          expectPass = false
          socket.write('235 2.7.0 Accepted\r\n')
        } else if (up.startsWith('EHLO')) {
          socket.write('250-localhost\r\n250 AUTH LOGIN\r\n')
        } else if (up.startsWith('AUTH LOGIN')) {
          expectUser = true
          socket.write('334 VXNlcm5hbWU6\r\n')
        } else if (up.startsWith('MAIL FROM')) {
          seen.from = line.slice(line.indexOf('<') + 1, line.lastIndexOf('>'))
          socket.write('250 2.1.0 OK\r\n')
        } else if (up.startsWith('RCPT TO')) {
          seen.to = line.slice(line.indexOf('<') + 1, line.lastIndexOf('>'))
          socket.write('250 2.1.5 OK\r\n')
        } else if (up.startsWith('DATA')) {
          inData = true
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
        } else if (up.startsWith('QUIT')) {
          socket.write('221 2.0.0 Bye\r\n')
          socket.end()
        } else {
          socket.write('250 2.0.0 OK\r\n')
        }
      }
    })
    socket.on('error', () => {})
  },
)

await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r))

// Self-signed, and only this process talks to it.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
process.env.SMTP_HOST = 'localhost'
process.env.SMTP_PORT = String(PORT)
process.env.SMTP_USER = 'khapee.orders@gmail.test'
process.env.SMTP_PASS = 'abcd efgh ijkl mnop'

const { sendMail, mailConfigured } = await import('../server/mail.ts')
console.log('configured:', mailConfigured())

const result = await sendMail({
  to: 'revery@khapee.local',
  subject: '#D473 needs your yes — Revery',
  text: [
    'A new order is waiting for you to accept it.',
    '',
    'Order   #D473',
    'Where   Table 4',
    'Who     Dev Patel · 98765 43210',
    'Total   ₹460',
    '',
    '2 × Banana Walnut Loaf',
    '1 × Flat White',
    '',
    'Open Khapee: https://khapee.com/staff/orders',
  ].join('\n'),
})

console.log('result:', result)
console.log('envelope from:', seen.from)
console.log('envelope to  :', seen.to)
console.log('auth user    :', seen.user)
console.log('auth pass ok :', seen.pass === 'abcd efgh ijkl mnop')
console.log('\n----- the message a restaurant receives -----')
console.log(seen.body)
server.close()
process.exit(0)
