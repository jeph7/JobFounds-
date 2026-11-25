#!/usr/bin/env bash
set -euo pipefail

# JOBFOUNDS — Hostinger Ubuntu VPS Setup & Deploy Script
# Target Domain: https://jobfounds.com
# Usage: sudo bash deploy/setup-hostinger-vps.sh

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="jobfounds.com"

echo "=== JOBFOUNDS Hostinger VPS Deployment ($DOMAIN) ==="
echo "App directory: $APP_DIR"

# 1. Verify or install Node.js 22 LTS (required for built-in node:sqlite)
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 22 ]; then
  echo "[1/7] Installing Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "[1/7] Node.js $(node -v) already installed."
fi

# 2. Install Nginx, Certbot & PM2
echo "[2/7] Ensuring Nginx, Certbot & PM2 are installed..."
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

# 3. Install dependencies & build production frontend
echo "[3/7] Installing npm dependencies & compiling production Vite bundle..."
cd "$APP_DIR"
mkdir -p logs data
npm install
npm run build

# 4. Ensure .env exists (never overwrites an existing .env)
if [ ! -f "$APP_DIR/.env" ]; then
  echo "[4/7] Creating .env from .env.example — remember to fill GEMINI_API_KEY and RESEND_API_KEY!"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
else
  echo "[4/7] Existing .env preserved."
fi

# 5. Bootstrap initial monitored ATS companies if database is brand new
if [ ! -f "$APP_DIR/data/jobfonds_engine.sqlite" ]; then
  echo "[5/7] Initializing SQLite intelligence database & scanning initial ATS targets..."
  npx tsx scripts/bootstrap-targets.ts
else
  echo "[5/7] Existing SQLite database found at data/jobfonds_engine.sqlite — skipping initial bootstrap."
fi

# 6. Install Nginx reverse proxy for jobfounds.com
echo "[6/7] Configuring Nginx reverse proxy for $DOMAIN..."
cp "$APP_DIR/deploy/nginx-jobfounds.conf" "/etc/nginx/sites-available/$DOMAIN"
ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# 7. Start or reload JOBFOUNDS via PM2
echo "[7/7] Starting JOBFOUNDS server + autonomous background worker under PM2..."
pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --env production
pm2 save

echo ""
echo "=== Deployment complete! Next steps ==="
echo "1. Edit $APP_DIR/.env and set GEMINI_API_KEY (+ RESEND_API_KEY & NOTIFICATION_FROM_EMAIL if using Resend), then run: pm2 restart jobfounds"
echo "2. Enable HTTPS SSL once DNS A records point to this VPS:"
echo "   sudo certbot --nginx -d jobfounds.com -d www.jobfounds.com"
echo "3. Enable PM2 auto-start on server reboot:"
echo "   pm2 startup"
echo "4. Verify health endpoint: curl -s https://jobfounds.com/api/health"
