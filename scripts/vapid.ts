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
 * You almost certainly do not need this. A host with a disk keeps its pair in
 * data/.vapid.json, and one without works it out from KHAPEE_SECRET, which
 * outlives its deploys — both give the same pair on every boot, which is the
 * only thing push actually requires. This is for moving to a key of your own.
 *
 * Whatever the source, the pair has to stay the same between restarts: a
 * subscription is bound to the public half, so a new pair silently
 * unsubscribes every device that had signed up — which looks exactly like
 * alerts quietly not working.
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
