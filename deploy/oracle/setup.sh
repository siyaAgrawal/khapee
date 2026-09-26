#!/usr/bin/env bash
# Khapee on an Oracle Cloud "Always Free" VM.
#
# Why Oracle and not Render's free plan: Render sleeps after 15 idle minutes and
# rebuilds the database from the snapshot on every wake, which wipes every push
# subscription — so an order placed after a quiet spell rings nobody. An Oracle
# VM never sleeps and has a real disk, so the database, the push subscriptions
# and the access codes simply stay. No app code changes: KHAPEE_DB pointing at a
# persistent file is the switch the app already has for this (see server/db.ts).
#
# Run once, as the default `ubuntu` user, on a fresh Ubuntu 22.04/24.04 VM:
#
#   curl -fsSL https://raw.githubusercontent.com/siyaAgrawal/khapee/main/deploy/oracle/setup.sh \
#     | DOMAIN=khapee.com bash
#
# Optional:
#   WWW=1                 also serve www.<DOMAIN>
#   SITE_DOMAIN=...       also serve the marketing site (website/) on this name
#   REPO=... BRANCH=...   deploy from somewhere else
#
# Safe to re-run: it never regenerates the secret or touches the database.
set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN, e.g. DOMAIN=khapee.com}"
REPO="${REPO:-https://github.com/siyaAgrawal/khapee.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/khapee
DATA_DIR=/var/lib/khapee
ENV_FILE=/etc/khapee.env

say() { printf '\n\033[1;35m▲ %s\033[0m\n' "$*"; }

# --- Memory -------------------------------------------------------------------
# The AMD micro shape has 1 GB, and the vite build alone wants more than that.
# A swap file keeps the build from being killed; harmless on the bigger ARM shape.
if ! swapon --show | grep -q /swapfile; then
  say "Adding 2 GB swap"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# --- Packages -----------------------------------------------------------------
say "Installing Node 22, build tools and Caddy"
sudo apt-get update -y
sudo apt-get install -y curl git ca-certificates gnupg build-essential python3 \
  debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

# --- Firewall -----------------------------------------------------------------
# Oracle's Ubuntu images ship an iptables REJECT rule that blocks 80 and 443 even
# after the cloud security list allows them. Both have to be opened.
say "Opening ports 80 and 443 in the VM's firewall"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
done
sudo netfilter-persistent save >/dev/null

# --- The app ------------------------------------------------------------------
say "Creating the khapee user and folders"
id khapee >/dev/null 2>&1 || sudo useradd --system --create-home --shell /usr/sbin/nologin khapee
sudo mkdir -p "$APP_DIR" "$DATA_DIR"
sudo chown khapee:khapee "$APP_DIR" "$DATA_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  say "Cloning $REPO"
  sudo -u khapee git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

# The secret signs logins and derives the push keypair. Generated once and never
# again: changing it signs everybody out and unsubscribes every phone.
if [ ! -f "$ENV_FILE" ]; then
  say "Writing $ENV_FILE"
  sudo tee "$ENV_FILE" >/dev/null <<EOF
# Khapee settings. Edit, then: sudo systemctl restart khapee
PORT=4273
KHAPEE_DB=$DATA_DIR/khapee.db
KHAPEE_SEED=snapshot
KHAPEE_SECRET=$(openssl rand -hex 32)

# Whose phone rings for every restaurant (comma-separated account emails).
KHAPEE_OWNER_EMAILS=

# Order emails — a second channel alongside push. Gmail app password works free.
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
EOF
  sudo chown root:khapee "$ENV_FILE"
  sudo chmod 640 "$ENV_FILE"
fi

say "Building"
sudo install -m 755 "$APP_DIR/deploy/oracle/update.sh" /usr/local/bin/khapee-update
sudo -u khapee bash -c "cd '$APP_DIR' && npm ci --include=dev && npm run build"
[ -n "${SITE_DOMAIN:-}" ] && sudo -u khapee bash -c "cd '$APP_DIR/website' && npm ci --include=dev && npm run build"

# --- Services -----------------------------------------------------------------
say "Installing services"
sudo cp "$APP_DIR/deploy/oracle/khapee.service" /etc/systemd/system/
sudo cp "$APP_DIR/deploy/oracle/khapee-update.service" /etc/systemd/system/
sudo cp "$APP_DIR/deploy/oracle/khapee-update.timer" /etc/systemd/system/

HOSTS="$DOMAIN"
[ "${WWW:-}" = 1 ] && HOSTS="$DOMAIN, www.$DOMAIN"
{
  echo "$HOSTS {"
  echo "	encode gzip"
  echo "	reverse_proxy 127.0.0.1:4273"
  echo "}"
  if [ -n "${SITE_DOMAIN:-}" ]; then
    echo
    echo "$SITE_DOMAIN {"
    echo "	root * $APP_DIR/website/dist"
    echo "	encode gzip"
    echo "	try_files {path} /index.html"
    echo "	header /assets/* Cache-Control \"public, max-age=31536000, immutable\""
    echo "	file_server"
    echo "}"
  fi
} | sudo tee /etc/caddy/Caddyfile >/dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now khapee khapee-update.timer
sudo systemctl reload-or-restart caddy

say "Waiting for the app"
for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:4273/api/health >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS http://127.0.0.1:4273/api/health && echo

IP=$(curl -fsS https://ifconfig.me || echo "<this VM's public IP>")
cat <<EOF

Done. Khapee is running on this VM and restarts itself on crash or reboot.

Next:
  1. Point DNS for $DOMAIN (A record) at $IP. Caddy issues the HTTPS
     certificate on its own as soon as that resolves — push needs HTTPS.
  2. Optional: fill in SMTP_* and KHAPEE_OWNER_EMAILS in $ENV_FILE,
     then  sudo systemctl restart khapee
  3. Every push to $BRANCH deploys itself within 2 minutes.

Logs:     journalctl -u khapee -f
Deploys:  journalctl -u khapee-update -f
EOF
