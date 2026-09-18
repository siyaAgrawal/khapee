/**
 * web-push ships no types. Only the three entry points this app uses are
 * declared, so a mistyped call is still caught rather than swallowed by `any`.
 */
declare module 'web-push' {
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string }
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void
  export function sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload?: string,
    options?: { TTL?: number },
  ): Promise<{ statusCode: number; body: string }>
}
