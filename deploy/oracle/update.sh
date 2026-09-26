#!/usr/bin/env bash
# Pull, build and restart — but only when main has actually moved.
# Run every 2 minutes by khapee-update.timer, so shipping is `git push` and
# nothing else, the same as it was on Render. Safe to run by hand too:
#   sudo khapee-update
set -euo pipefail

APP_DIR=/opt/khapee
cd "$APP_DIR"

as_app() { if [ "$(id -un)" = khapee ]; then bash -c "$1"; else sudo -u khapee bash -c "$1"; fi; }

branch=$(as_app "git rev-parse --abbrev-ref HEAD")
as_app "git fetch --quiet origin '$branch'"
here=$(as_app "git rev-parse HEAD")
there=$(as_app "git rev-parse 'origin/$branch'")
[ "$here" = "$there" ] && exit 0

echo "Deploying ${there:0:7} (was ${here:0:7})"
as_app "git reset --hard --quiet 'origin/$branch'"
as_app "npm ci --include=dev && npm run build"
[ -f /etc/caddy/Caddyfile ] && grep -q "$APP_DIR/website/dist" /etc/caddy/Caddyfile \
  && as_app "cd website && npm ci --include=dev && npm run build"

# The database lives in /var/lib/khapee, outside the checkout, so a restart
# keeps every order, code and push subscription.
systemctl restart khapee
echo "Deployed ${there:0:7}"
