/**
 * Makes the keypair that signs push notifications.
 *
 *   npx tsx scripts/vapid.ts
 *
 * Push is the one way of telling a restaurant about an order that needs no
 * account with anybody: these keys are generated here, the message is signed
 * here, and the browser's own push service delivers it. Nothing is billed and
 * nobody issues us a key.
 *
 * The pair has to stay the same between restarts. A subscription is bound to
 * the public half, so minting a new pair silently unsubscribes every device
 * that had signed up — which looks exactly like alerts quietly not working.
 * On a host with a disk the pair lives in data/.vapid.json; on one without,
 * put it in the environment as VAPID_PUBLIC and VAPID_PRIVATE.
 */
import webpush from 'web-push'

const keys = webpush.generateVAPIDKeys()

console.log(`
  A new VAPID keypair. Setting these replaces any existing one, which
  unsubscribes every device currently signed up.

    VAPID_PUBLIC    ${keys.publicKey}
    VAPID_PRIVATE   ${keys.privateKey}

  Add both under Environment on the host. Keep the private half secret;
  it is never sent to a browser and never belongs in the repository.
`)
