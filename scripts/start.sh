#!/bin/sh
# How Khapee starts in production (`npm start`).
#
# With BACKUP_BUCKET set, the database is backed up continuously to free
# S3-compatible storage (Supabase Storage, or Backblaze B2) by Litestream and put back before the app starts. This
# is what lets a host with no disk — Render's free plan — restart, sleep and
# redeploy without losing a single order, access code or phone registered for
# order alerts. Without it, the app starts exactly as it always has.
set -e
cd "$(dirname "$0")/.."
export NODE_ENV=production

run_app() {
  exec npx tsx server/index.ts
}

if [ -z "$BACKUP_BUCKET" ]; then
  run_app
fi

# The database has to live at a known path for the backup to follow it.
export KHAPEE_DB="${KHAPEE_DB:-$PWD/data/live/khapee.db}"
mkdir -p "$(dirname "$KHAPEE_DB")"

LITESTREAM="${LITESTREAM_BIN:-$PWD/bin/litestream}"
CONFIG="${LITESTREAM_CONFIG:-litestream.yml}"
if [ ! -x "$LITESTREAM" ]; then
  node scripts/fetch-litestream.mjs
fi

# Put the latest backup back before anything opens the database. If there is
# a backup and it cannot be restored, stop: starting on an empty or seeded
# database and then backing THAT up is the one way to lose everything, and a
# host that fails to start is retried and noticed.
if [ ! -f "$KHAPEE_DB" ]; then
  echo "[backup] restoring the database from $BACKUP_BUCKET"
  "$LITESTREAM" restore -config "$CONFIG" -if-replica-exists "$KHAPEE_DB"
  if [ -f "$KHAPEE_DB" ]; then
    echo "[backup] restored"
  else
    echo "[backup] no backup yet — first start, the catalogue comes from the snapshot"
  fi
fi

# Litestream runs the app as its child, copies every change to the bucket
# within about a second, and makes a last copy when the host stops the app.
exec "$LITESTREAM" replicate -config "$CONFIG" -exec "npx tsx server/index.ts"
