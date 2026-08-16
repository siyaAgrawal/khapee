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

## Koyeb — the published app

Free instance, no card, HTTPS included (which the camera needs for QR scanning),
and it deploys straight from GitHub. One process, one database, so a code
generated at the counter reaches any phone on any network.

1. **koyeb.com** -> sign up with GitHub.
2. **Create Web Service** -> **GitHub** -> pick `siyaAgrawal/ordro`.
3. Instance type **Free**. Everything else is detected; the only thing to set is
   one environment variable:

       ORDRO_SEED = snapshot

   Without it the container boots with an empty database and no restaurants.
4. Deploy.

A `Dockerfile` is in the repo if you would rather Koyeb build from that, and it
makes the app portable to Fly, Cloud Run, Northflank or any container host —
nothing here is vendor-specific.

Free instances sleep when idle and have no disk, so every boot rebuilds the
catalogue from the committed snapshot: restaurants, menus and photos always come
back, orders and access codes made since the last boot do not. Fine for real
phones and demos; add a disk before real customers.

Verified against the exact runtime a container host produces — production build,
host-injected `PORT`, filesystem holding only the committed snapshot:

    health check            200
    app shell               200
    catalogue               8 restaurants, 13 cuisines
    25 concurrent code lookups   25 ok      (Vercel: 13 ok, 12 lost)
    dining session opened   201
    25 concurrent order reads    25 ok      (Vercel: 12 ok, 13 lost)
    kitchen board            sees the customer's order

To publish menu or photo changes made locally, run `npm run snapshot`, then
commit and push — Koyeb redeploys on push.

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
