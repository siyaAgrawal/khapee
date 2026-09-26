# Putting Khapee online

> **How khapee.com runs now:** Render's free plan, with the database backed up
> continuously to Supabase Storage and restored on every start — see the next
> section. Nothing is lost on a restart, sleep or deploy, and nothing needs a
> card. An Oracle Cloud alternative (needs a card to sign up) is in
> [`deploy/README.md`](deploy/README.md).

The app is one Node process: it serves the API and the built React app on a
single port, and keeps its data in a SQLite file plus an uploads folder next to
it. So it needs a host that gives you **a persistent disk and a long-running
process** — not a serverless one.

```bash
npm run build && npm start
```

That serves everything on `PORT` (default 4273). Verified working locally.

## Render free + Supabase Storage — keeping everything, free, no card

Render's free plan has no disk, so every restart, sleep and deploy rebuilt the
database from the snapshot: orders, access codes and every phone registered for
order alerts were lost, and the next order rang nobody. Now the database is
backed up continuously and put back on every start. Nothing in the app changed
how it reads or writes; `npm start` runs `scripts/start.sh`, which:

1. restores the latest copy from the storage bucket (Litestream) if the disk is empty,
2. starts the app under Litestream, which copies every change to the bucket
   within about a second and makes a last copy when Render stops the app.

Photos uploaded from the dashboard are stored in the database too
(`upload_files`), so they come back with it.

The bucket is Supabase Storage through its S3 connection (Storage → Settings →
S3 Connection). Backblaze B2 works the same way with its own endpoint.

Set these under **Environment** on the Render service (see `render.yaml`):
`BACKUP_BUCKET`, `BACKUP_ENDPOINT`, `BACKUP_REGION`, `BACKUP_KEY_ID`,
`BACKUP_SECRET`. Without them the app runs exactly as before.

If a backup exists but cannot be restored, the app refuses to start rather than
start empty and back that up over the real data. Render retries it, and the
reason is in the log (`[backup]` lines).

**Kept awake** by `.github/workflows/keep-awake.yml`, which asks
`/api/health` every 10 minutes from GitHub's free scheduler. GitHub pauses
scheduled workflows in a repository with no commits for 60 days; re-enable it
under Actions if that happens.

The same workflow also fetches a tiny public file from Supabase every 10
minutes (the `SUPABASE_PING_URL` repository variable), because Supabase pauses
free projects after a week without activity — and a paused bucket would stop
the app from restoring on its next start.

Free limits worth knowing: Supabase stores 1 GB free (the database is well
under 10 MB); Render gives 750 free hours a month, and one server kept awake
uses about 744.

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

### Making alerts reliable

Phones registered for order alerts are kept in the database, which is now
backed up and restored on every start (see the Supabase section above), so a
restart, sleep or deploy no longer signs anybody out of alerts. Two things are
still worth doing:

**1. Turn email on as a second channel.** A phone can still miss a push — it is
off, notifications are blocked, or an iPhone was never added to the Home
Screen. Email catches those. Free through Gmail with an app password; add under
Environment on the service:

    SMTP_HOST  smtp.gmail.com
    SMTP_PORT  465
    SMTP_USER  the full Gmail address
    SMTP_PASS  the 16-character app password

Without these, `mailConfigured()` is false and order emails never send.

**2. Check the log when an order seems to ring nobody.** Every order logs
`[alerts] order #… : …` with how many phones it reached. "No phone is signed up"
means the owner has to turn alerts on in the app once.

### Every order, on every restaurant

An owner with more than one place wants one phone for all of them. Set
`KHAPEE_OWNER_EMAILS` to a comma-separated list of account emails; anyone on
it who turns notifications on gets every order on Khapee, from any device they
sign in on. Everyone else keeps getting only the places they work at.

It is an environment variable rather than a database column deliberately — it
was chosen when the database did not survive a restart, and it still means the
grant never depends on the data.

### What free costs

No disk, and the instance sleeps after ~15 minutes idle; the keep-awake workflow
stops that. On every start the database is restored from the Supabase backup,
so orders, access codes, alert phones and dashboard photos all come back.

### Changing menus, photos or data on the live site

**Make the change on the live site** — in the dashboard, where it is saved and
backed up like everything else.

`data/snapshot.db` is only read on the very first start, when the backup is
empty. After that, a new snapshot pushed to GitHub does **not** reach
khapee.com: the backup is restored instead. (`npm run snapshot` is still how a
fresh copy of the app, or a local clone, gets the catalogue.)

To deliberately start the live site over from the snapshot — losing every order,
code and alert phone since — empty the `khapee` folder in the `khapee-backup`
bucket and restart the service. Do not do this for a small fix.

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
