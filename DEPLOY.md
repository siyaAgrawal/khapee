# Putting Ordro online

The app is one Node process: it serves the API and the built React app on a
single port, and keeps its data in a SQLite file plus an uploads folder next to
it. So it needs a host that gives you **a persistent disk and a long-running
process** — not a serverless one.

```bash
npm run build && npm start
```

That serves everything on `PORT` (default 4273). Verified working locally.

## Why not Vercel

Vercel runs serverless functions on a read-only, ephemeral filesystem. On Vercel
this app would deploy and look correct, but:

- every order, access code, dining session and menu edit would be lost the
  moment the function finished, and would not be shared between requests;
- uploaded restaurant and dish photos would disappear;
- the live orders board (server-sent events) needs a connection held open, which
  a serverless function will not do.

Making it work on Vercel means replacing SQLite with a hosted Postgres, uploads
with blob storage, and SSE with polling — a rewrite of the data layer, and it
adds the external database service the project set out to avoid.

## Render (recommended)

`render.yaml` in this folder is ready. The disk keeps `ordro.db` and the photos.

1. Push this folder to a Git repo (GitHub/GitLab).
2. On Render: **New → Blueprint**, point it at the repo. It reads `render.yaml`.
3. Deploy. The `starter` plan is required — the free plan has no persistent disk.

`TABLO_DB` is set to `/var/data/ordro.db` on the mounted disk, so data survives
deploys. Uploads land beside it automatically.

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
