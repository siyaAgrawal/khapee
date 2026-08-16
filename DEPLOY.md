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

## Render — the published app (recommended)

`render.yaml` is ready. One Node process, one SQLite file on a mounted disk, so
a code generated at the counter reaches any phone anywhere.

1. Push this folder to a Git repo.
2. On Render: **New -> Blueprint**, point it at the repo. It reads `render.yaml`.
3. Deploy.

The `starter` plan is required: the free plan has no persistent disk. (The free
plan still fixes the two-phone problem, because it is still one process — but
the database resets whenever the service sleeps, so order history is lost.)

First boot lands on an empty disk. `ORDRO_SEED=snapshot` in the blueprint tells
the app to lay down the committed catalogue and its photos, so it comes up with
the restaurants rather than blank, then persists from there. Verified against a
simulated empty disk: 8 open restaurants, 13 cuisines, and 25 of 25 concurrent
code lookups answered.

To publish menu or photo changes made locally, re-run `npm run snapshot`, commit
and push -- or edit through the dashboard on the live site, which now sticks.

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
