#!/usr/bin/env bash
# Sichert die AutoHouse-Datenbank im laufenden Betrieb.
#
#   ./scripts/backup.sh [zielverzeichnis]
#
# Nutzt sqlite3 ".backup" – das ist auch bei aktivem WAL-Modus konsistent,
# anders als ein einfaches Kopieren der Datei.
set -euo pipefail

TARGET_DIR="${1:-./backups}"
VOLUME="${AUTOHOUSE_VOLUME:-autohouse-data}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$TARGET_DIR"
ABS_TARGET="$(cd "$TARGET_DIR" && pwd)"

docker run --rm \
  -v "${VOLUME}:/data:ro" \
  -v "${ABS_TARGET}:/backup" \
  alpine:3 \
  sh -c "apk add --no-cache sqlite >/dev/null && sqlite3 /data/autohouse.db \".backup '/backup/autohouse-${STAMP}.db'\""

echo "Sicherung geschrieben: ${ABS_TARGET}/autohouse-${STAMP}.db"
echo
echo "WICHTIG: Ohne den ENCRYPTION_KEY aus der .env sind die gespeicherten"
echo "Shop-Zugangsdaten in dieser Sicherung nicht zu gebrauchen."
echo "Den Schluessel getrennt aufbewahren (Passwortmanager)."

# Aeltere Sicherungen aufraeumen (die letzten 14 bleiben).
ls -1t "${ABS_TARGET}"/autohouse-*.db 2>/dev/null | tail -n +15 | xargs -r rm --
