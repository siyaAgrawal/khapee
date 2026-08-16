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

## Render free — the published app

`render.yaml` is ready and set to the **free** instance type, which needs no
card. One Node process, one database, so a code generated at the counter reaches
any phone on any network.

1. Push this folder to a Git repo (already done: siyaAgrawal/ordro).
2. On Render: **New -> Blueprint**, point it at the repo. It reads `render.yaml`.
3. Apply.

What free costs you: no disk, and the service sleeps after ~15 minutes idle,
taking about a minute to wake. On every boot the database is rebuilt from the
committed snapshot, so restaurants, menus and photos always come back — orders
and access codes made since the last boot do not.

That is fine for testing with real phones, and fine for a demo. Before real
customers, add the disk: set `plan: starter` and uncomment the two blocks at the
bottom of `render.yaml`. Nothing else changes.

Verified on a clean container with only the committed snapshot present: 8 open
restaurants, 13 cuisines, 25 of 25 concurrent lookups of a freshly generated
code answered, a dining session opened, and dish photos served.

To publish menu or photo changes made locally, run `npm run snapshot`, then
commit and push — Render redeploys on push.

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
