# Putting Ordro online

The app is one Node process: it serves the API and the built React app on a
single port, and keeps its data in a SQLite file plus an uploads folder next to
it. So it needs a host that gives you **a persistent disk and a long-running
process** — not a serverless one.

```bash
npm run build && npm start
```

That serves everything on `PORT` (default 4273). Verified working locally.

## Vercel — live, but read-only

The app is deployed at **https://cafe-gamma-wheat.vercel.app** (`npx vercel --prod`).
That link stays the same across deploys.

Vercel runs serverless functions on a read-only filesystem whose `/tmp` does not
survive a cold start, so there the app boots from a seed built by:

```bash
npm run snapshot
```

That writes `data/snapshot.db` and `data/snapshot-uploads/` from the working
database — checkpointing the write-ahead log, dropping login sessions and the
unassigned photo pool, and copying only the photos a restaurant or dish points
at. Both are committed, and `vercel.json` includes them in the function.

Everything works there — browsing, ordering, codes, rooms, the dashboard — but
anything written goes to that instance's `/tmp` and is lost when it sleeps.
Re-run `npm run snapshot` and redeploy to publish new menus or photos.

For a real restaurant, use a host with a disk.

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
