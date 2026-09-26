# Putting Khapee online

The app is one Node process: it serves the API and the built React app on a
single port, and keeps its data in a SQLite file plus an uploads folder next to
it. So it needs a host that gives you **a persistent disk and a long-running
process** — not a serverless one.

```bash
npm run build && npm start
```

That serves everything on `PORT` (default 4273). Verified working locally.

## Oracle Cloud Always Free — the host to use

Render's free plan sleeps and rebuilds the database on every wake, which wipes
every push subscription: an order placed after a quiet spell reaches no phone,
and the customer waits for a kitchen that never heard about it. An Oracle
Always Free VM never sleeps and has a real disk, so subscriptions, orders and
codes stay put. Free for good, not a trial.

1. Sign up at cloud.oracle.com (a card is asked for identity; Always Free
   resources are never charged).
2. **Compute → Instances → Create**. Image: Ubuntu 22.04 or 24.04. Shape:
   `VM.Standard.A1.Flex` (ARM, 1 OCPU / 6 GB is plenty) — or
   `VM.Standard.E2.1.Micro` if A1 is out of capacity. Add your SSH key.
3. **Networking → the VM's subnet → Security list → Add ingress rules**:
   source `0.0.0.0/0`, TCP, destination ports `80` and `443`.
4. SSH in and run:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/siyaAgrawal/khapee/main/deploy/oracle/setup.sh | DOMAIN=khapee.com WWW=1 bash
   ```

5. Point `khapee.com` and `www` (A records) at the VM's public IP. HTTPS is
   issued automatically by Caddy once DNS resolves — push needs HTTPS.
6. Once it answers on khapee.com, suspend the Render service so two copies are
   not running.

After that, **every push to main deploys itself within 2 minutes** (a timer on
the VM pulls and rebuilds; `deploy/oracle/update.sh`). Settings live in
`/etc/khapee.env` on the VM; the database is `/var/lib/khapee/khapee.db`,
outside the checkout, so no deploy or reboot touches it.

Moving hosts gives a new `KHAPEE_SECRET`, so everyone signs in once more and
each owner turns notifications on again, once. After that they stay on.

## Why the current Vercel link cannot work for two phones

Vercel runs the app as serverless functions. Each one boots its own private copy
of `data/snapshot.db` into `/tmp`, and there is no shared disk between them.

That is not a small caveat — it breaks the product. Generate a staff code, then
ask for it 25 times:

    13 x 200 OK
    12 x 404 "That code isn't valid"

Same code, same second. The counter's write landed on one instance; the
customer's phone was routed to another that had never seen it. Orders, dining
sessions and staff logins split the same way. No code change fixes this; it is
what the host is.

Keep the Vercel link for showing the app off. Do not run a restaurant on it.

## Live: https://khapee.com

Render free instance, deployed from `render.yaml`, connected to this GitHub
repo. **It redeploys on every push to main**, so shipping is `git push` and
nothing else — no dashboard, no CLI, no account access needed.

    git push origin main          # Render builds and deploys
    curl https://khapee.com/api/health

Verified end to end against the live site:

    app shell / health           200 / 200
    catalogue                    8 restaurants, 13 cuisines
    25 concurrent code lookups   25 ok     (Vercel: 13 ok, 12 lost)
    same code entered twice      201, 201  (the bug that started this)
    scanned QR payload           201
    order placed via session     J485
    25 concurrent order reads    25 ok     (Vercel: 12 ok, 13 lost)
    kitchen board                sees J485
    dish photos                  200 image/png

Two phones on different networks now work, which was the whole point.

### Making alerts reliable without paying

Three things, in the order they matter.

**1. Turn email on.** It is the only channel that survives a rebuild. A push
subscription lives in the database, and a free instance rebuilds the database
from the snapshot every time it wakes — so the phone that was signed up last
night is not signed up this morning. The email address is not runtime data: it
is `restaurants.order_email`, or the owner's account, both of which come back
with the snapshot. So email is the one route that cannot be silently lost.

Free through Gmail with an app password. Add under Environment on the service:

    SMTP_HOST  smtp.gmail.com
    SMTP_PORT  465
    SMTP_USER  the full Gmail address
    SMTP_PASS  the 16-character app password

Without these, `mailConfigured()` is false and order emails never send — which
looks exactly like a quiet evening.

**2. Push repairs itself, but only while somebody has the dashboard open.**
The dashboard re-sends its subscription on every page load, which is what
repopulates the wiped table. That covers a till that is open all service. It
does not cover an order arriving after a sleep with every dashboard shut —
nothing is subscribed at that moment, and only the email gets through.

**3. Keep it awake, so the rebuild stops happening.** The wipe is a symptom of
spinning down. An uptime pinger hitting `/api/health` every 10 minutes keeps
one instance up, and then the database simply persists between customers —
orders and access codes included. Free pingers that do this: cron-job.org,
UptimeRobot.

> Worth checking before relying on it: a free Render service is capped at a
> monthly pool of instance-hours, and a service kept awake all month spends
> nearly all of it. Confirm the current allowance covers a 31-day month
> (744 hours) on Render's own pricing page — if it does not, the pinger should
> run only during opening hours, which is the same fix and costs nothing.

None of this is as good as a disk. It is what works at zero cost.

### Every order, on every restaurant

An owner with more than one place wants one phone for all of them. Set
`KHAPEE_OWNER_EMAILS` to a comma-separated list of account emails; anyone on
it who turns notifications on gets every order on Khapee, from any device they
sign in on. Everyone else keeps getting only the places they work at.

It is an environment variable rather than a database column deliberately — it
has to outlive the rebuild described above.

### What free costs

No disk, and the instance sleeps after ~15 minutes idle — the first request
after that takes up to a minute while it wakes. On every boot the database is
rebuilt from the committed snapshot, so restaurants, menus and photos always
come back; orders and access codes made since the last boot do not.

Before real customers: change `plan` to `starter` in `render.yaml` and uncomment
the disk blocks at the bottom. Nothing else changes.

### Publishing local menu or photo changes

    npm run snapshot && git add -A && git commit && git push

The snapshot is the seed the deployed app boots from, so changes made locally
only reach the live site through it. Changes made *on* the live site through the
dashboard are lost at the next sleep until the disk is added.

## Railway / Fly.io

Both work the same way — a Node service plus a volume:

- Build: `npm install && npm run build`
- Start: `npm start`
- Volume mounted at `/var/data`, and `KHAPEE_DB=/var/data/khapee.db`

## Moving your existing data up

The restaurants and menus already imported live in `data/khapee.db`. To carry
them over, copy that file onto the host's disk (Render and Railway both offer a
shell), or re-run the importers against the deployed instance:

```bash
npm run import -- data/yazu.json
npm run import -- data/sassy-house.json
npm run import -- data/kitchen99.json --merge
```

## Before real customers use it

- Change the imported restaurant passwords — they all start as `password123`.
- Put it behind HTTPS. The host gives you that, and it is required for the
  camera (QR scanning) and geolocation to work on phones.
