#!/usr/bin/env bash
# Run every two minutes by khapee-update.timer (see setup.sh).
#
#  - A new commit on main is deployed, so shipping stays `git push`, as it was
#    on Render. Only the app is rebuilt; the database volume is untouched.
#  - Once a day the database is copied to /data/backups inside the volume,
#    keeping the last fourteen days.
set -euo pipefail

DIR="/opt/khapee"
COMPOSE=(sudo docker compose -f "$DIR/deploy/docker-compose.yml")
cd "$DIR"

git fetch --quiet origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  git reset --quiet --hard origin/main
  echo "khapee: deploying $(git log --oneline -1)"
  "${COMPOSE[@]}" up -d --build
  sudo docker image prune -f >/dev/null
fi

today="$(date +%F)"
if ! "${COMPOSE[@]}" exec -T app test -f "/data/backups/khapee-$today.db" 2>/dev/null; then
  "${COMPOSE[@]}" exec -T app node -e "
    const Database = require('better-sqlite3');
    const fs = require('fs');
    fs.mkdirSync('/data/backups', { recursive: true });
    new Database('/data/khapee.db', { readonly: true })
      .backup('/data/backups/khapee-$today.db')
      .then(() => {
        const old = fs.readdirSync('/data/backups').filter(f => f.endsWith('.db')).sort().slice(0, -14);
        for (const f of old) fs.unlinkSync('/data/backups/' + f);
        console.log('khapee: backed up to /data/backups/khapee-$today.db');
      })
      .catch(e => { console.error('khapee: backup failed', e); process.exit(1) });
  "
fi
