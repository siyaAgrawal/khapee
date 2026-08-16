# Putting Ordro online

The app is one Node process: it serves the API and the built React app on a
single port, and keeps its data in a SQLite file plus an uploads folder next to
it. So it needs a host that gives you **a persistent disk and a long-running
process** — not a serverless one.

```bash
npm run build && npm start
```

That serves everything on `PORT` (default 4273). Verified working locally.

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

## Live: https://ordro.onrender.com

Render free instance, deployed from `render.yaml`, connected to this GitHub
repo. **It redeploys on every push to main**, so shipping is `git push` and
nothing else — no dashboard, no CLI, no account access needed.

    git push origin main          # Render builds and deploys
    curl https://ordro.onrender.com/api/health

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
- Volume mounted at `/var/data`, and `TABLO_DB=/var/data/ordro.db`

## Moving your existing data up

The restaurants and menus already imported live in `data/ordro.db`. To carry
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
