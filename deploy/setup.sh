#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# AutoHouse – Einrichtung eines frischen Ubuntu-Servers in einem Rutsch.
#
# Auf dem Server als root ausfuehren:
#
#   apt update && apt install -y git
#   git clone https://github.com/fresus90/AutoHouse.git /opt/autohouse-setup
#   TUNNEL_TOKEN="ey…" bash /opt/autohouse-setup/deploy/setup.sh
#
# Ohne TUNNEL_TOKEN fragt das Skript danach (oder ueberspringt den Tunnel).
# Das Skript ist wiederholbar: Vorhandenes wird nicht ueberschrieben.
# ---------------------------------------------------------------------------
set -euo pipefail

APP_USER="${APP_USER:-autohouse}"
APP_DIR="/home/${APP_USER}/AutoHouse"
REPO_URL="${REPO_URL:-https://github.com/fresus90/AutoHouse.git}"
# Leer = der Standardzweig des Repositorys. Einen bestimmten Zweig holt man
# mit REPO_BRANCH=<name> bash setup.sh
REPO_BRANCH="${REPO_BRANCH:-}"

info()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m    %s\033[0m\n' "$*"; }
die()   { printf '\n\033[1;31mFehler: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die 'Bitte als root ausfuehren (oder mit sudo).'
command -v apt-get >/dev/null || die 'Dieses Skript erwartet Ubuntu oder Debian.'

# --- 1. System -------------------------------------------------------------
info 'System aktualisieren'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq git curl ca-certificates ufw unattended-upgrades

# --- 2. Docker -------------------------------------------------------------
if command -v docker >/dev/null; then
  info 'Docker ist bereits installiert'
else
  info 'Docker installieren'
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# --- 3. Benutzer -----------------------------------------------------------
if id "$APP_USER" >/dev/null 2>&1; then
  info "Benutzer ${APP_USER} existiert bereits"
else
  info "Benutzer ${APP_USER} anlegen"
  adduser --disabled-password --gecos "" "$APP_USER"
fi
usermod -aG docker "$APP_USER"

# SSH-Schluessel von root uebernehmen, damit der Zugang erhalten bleibt.
if [ -d /root/.ssh ] && [ ! -f "/home/${APP_USER}/.ssh/authorized_keys" ]; then
  info 'SSH-Schluessel uebernehmen'
  mkdir -p "/home/${APP_USER}/.ssh"
  cp /root/.ssh/authorized_keys "/home/${APP_USER}/.ssh/authorized_keys" 2>/dev/null || true
  chown -R "${APP_USER}:${APP_USER}" "/home/${APP_USER}/.ssh"
  chmod 700 "/home/${APP_USER}/.ssh"
  chmod 600 "/home/${APP_USER}/.ssh/authorized_keys" 2>/dev/null || true
fi

# --- 4. Firewall -----------------------------------------------------------
# Der Cloudflare-Tunnel verbindet sich von innen nach aussen. Nach aussen
# muss deshalb nur SSH offen sein.
info 'Firewall einrichten (nur SSH offen)'
ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw --force enable >/dev/null
ufw status verbose | sed -n '1,12p'

# --- 5. Auslagerungsdatei bei wenig RAM ------------------------------------
RAM_MB=$(free -m | awk '/^Mem:/ {print $2}')
if [ "$RAM_MB" -lt 3000 ] && [ ! -f /swapfile ]; then
  info "Nur ${RAM_MB} MB RAM – 2 GB Auslagerungsdatei anlegen (Chromium braucht Luft)"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- 6. Anwendung holen ----------------------------------------------------
if [ -d "${APP_DIR}/.git" ]; then
  info 'Anwendung aktualisieren'
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  info 'Anwendung holen'
  if [ -n "$REPO_BRANCH" ]; then
    sudo -u "$APP_USER" git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
  else
    # Ohne Angabe den Standardzweig des Repositorys nehmen – der heisst
    # nicht zwingend "main".
    sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
  fi
fi
info "Zweig: $(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"

# --- 7. Konfiguration ------------------------------------------------------
ENV_FILE="${APP_DIR}/.env"
if [ -f "$ENV_FILE" ]; then
  info 'Vorhandene .env bleibt unveraendert'
else
  info 'Konfiguration anlegen'
  KEY="$(openssl rand -hex 32)"

  if [ -z "${TUNNEL_TOKEN:-}" ] && [ -t 0 ]; then
    echo
    echo 'Token des Cloudflare-Tunnels einfuegen (leer lassen und Enter zum Ueberspringen).'
    echo 'Zu finden im Zero-Trust-Dashboard unter Networks -> Tunnels.'
    read -r -p 'TUNNEL_TOKEN: ' TUNNEL_TOKEN || true
  fi

  if [ -n "${TUNNEL_TOKEN:-}" ]; then
    TUNNEL_PROFILE_LINE='COMPOSE_PROFILES=tunnel'
  else
    TUNNEL_PROFILE_LINE='# COMPOSE_PROFILES=tunnel'
  fi

  cat > "$ENV_FILE" <<EOF
# Von deploy/setup.sh erzeugt am $(date -Is)

PORT=4000
TIMEZONE=Europe/Berlin
SESSION_TTL_DAYS=60

# Verschluesselt Shop-Zugangsdaten und Browser-Sessions.
# UNBEDINGT zusaetzlich im Passwortmanager sichern.
ENCRYPTION_KEY=${KEY}

# Sicherheitsschalter: erst auf true stellen, wenn ein Testlauf sauber war.
ALLOW_REAL_ORDERS=false

SCHEDULER_ENABLED=true
SCHEDULER_TICK_MS=30000
MAX_CONCURRENT_RUNS=1
HEADLESS=true

# Cloudflare-Tunnel. COMPOSE_PROFILES=tunnel schaltet den Dienst ein;
# ohne die Zeile startet nur die App.
TUNNEL_TOKEN=${TUNNEL_TOKEN:-}
${TUNNEL_PROFILE_LINE}

# Optional: fertiges Image aus der Registry statt lokalem Bau,
# z. B. ghcr.io/fresus90/autohouse:latest
AUTOHOUSE_IMAGE=
EOF
  chown "${APP_USER}:${APP_USER}" "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  echo
  warn "ENCRYPTION_KEY = ${KEY}"
  warn 'Diesen Schluessel jetzt in den Passwortmanager kopieren.'
  warn 'Ohne ihn sind gespeicherte Shop-Zugangsdaten nach einem Verlust wertlos.'
fi

# --- 8. Starten ------------------------------------------------------------
# Ob der Tunnel mitstartet, entscheidet COMPOSE_PROFILES in der .env.
if ! grep -q '^COMPOSE_PROFILES=tunnel' "$ENV_FILE"; then
  info 'Kein Tunnel-Token hinterlegt – es startet nur die App'
  warn "Token spaeter in ${ENV_FILE} eintragen, dort ausserdem"
  warn "die Zeile COMPOSE_PROFILES=tunnel aktivieren, dann:"
  warn "  cd ${APP_DIR} && sudo -u ${APP_USER} docker compose up -d"
fi

info 'Container bauen und starten (der erste Bau dauert einige Minuten)'
cd "$APP_DIR"
sudo -u "$APP_USER" docker compose up -d --build

# --- 9. Warten und pruefen -------------------------------------------------
info 'Warte auf die Anwendung'
for _ in $(seq 1 60); do
  if sudo -u "$APP_USER" docker compose exec -T app \
       node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    info 'AutoHouse laeuft.'
    break
  fi
  sleep 3
done

cat <<EOF

------------------------------------------------------------------
Fertig. Naechste Schritte:

  1. Im Cloudflare-Dashboard die oeffentliche Adresse eintragen:
     Type HTTP, URL  app:4000
  2. Zugang begrenzen: Zero Trust -> Access -> Applications
  3. Seite aufrufen und das erste Konto anlegen
  4. Konten fuer weitere Personen:
     cd ${APP_DIR} && docker compose exec app \\
       node dist/cli/create-user.js --email name@example.de

Logs ansehen:   cd ${APP_DIR} && docker compose logs -f app
Sicherung:      cd ${APP_DIR} && ./scripts/backup.sh
Ausfuehrliche Anleitung: ${APP_DIR}/docs/hosting.md
------------------------------------------------------------------
EOF
