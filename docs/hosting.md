# AutoHouse hosten – Anleitung

Ziel: AutoHouse läuft rund um die Uhr auf einem kleinen Server, ist unter
deiner Cloudflare-Domain erreichbar, nur du und dein Freundeskreis kommen rein,
und auf dem iPhone liegt ein Symbol auf dem Home-Bildschirm, das sich wie eine
App anfühlt – ohne App Store.

```
iPhone / Browser
      │  https://autohouse.deine-domain.de
      ▼
Cloudflare  ──►  Access (wer darf rein?)  ──►  Tunnel
      │                                          │  ausgehende Verbindung,
      │                                          ▼  kein offener Port
   ┌──┴──────────────────── Server (VPS oder Rechner bei dir) ────────────┐
   │  cloudflared ──► autohouse:4000 ──► SQLite + Chromium               │
   └──────────────────────────────────────────────────────────────────────┘
```

Zeitaufwand beim ersten Mal: etwa eine Stunde.

---

## Inhalt

- [Vorab: die Oberfläche ohne Server ansehen](#vorab-die-oberfläche-ohne-server-ansehen)
1. [Was der Server können muss](#1-was-der-server-können-muss)
2. [Server vorbereiten](#2-server-vorbereiten)
3. [AutoHouse einrichten](#3-autohouse-einrichten)
4. [Cloudflare Tunnel anlegen](#4-cloudflare-tunnel-anlegen)
5. [Starten](#5-starten)
6. [Zugang für den Freundeskreis](#6-zugang-für-den-freundeskreis)
7. [Konten anlegen](#7-konten-anlegen)
8. [Shops verbinden – auch ohne Bildschirm](#8-shops-verbinden--auch-ohne-bildschirm)
9. [Auf dem iPhone installieren](#9-auf-dem-iphone-installieren)
10. [Betrieb: Updates, Sicherungen, Logs](#10-betrieb-updates-sicherungen-logs)
11. [Fehlersuche](#11-fehlersuche)
12. [Den Build automatisieren](#12-den-build-automatisieren)
13. [Kosten](#13-kosten)

---

## Vorab: die Oberfläche ohne Server ansehen

Bevor irgendein Server läuft, lässt sich das Frontend schon bedienen. Es gibt
dafür einen Demo-Build: dieselbe Oberfläche, aber mit Beispieldaten im
Browser statt einer echten Verbindung. Es werden keine Anfragen an dm oder
REWE gestellt und nichts bestellt.

```bash
npm install
npm run build:demo        # -> dist/demo/autohouse-demo.html
```

Heraus kommt **eine einzige HTML-Datei** ohne Abhängigkeiten. Drei Wege, sie
aufs Telefon zu bekommen:

| Weg | Vorgehen | Wofür |
| --- | --- | --- |
| Datei teilen | Per AirDrop, Mail oder in iCloud Drive legen, auf dem iPhone in Safari öffnen | Layout, Bedienbarkeit, Daumenwege |
| Zum Home-Bildschirm | Datei öffnen, *Teilen → Zum Home-Bildschirm* | Wie es sich als App anfühlt |
| Im Freundeskreis zeigen | Datei verschicken, jeder kann gefahrlos herumklicken | Rückmeldungen einsammeln |

Die Demo enthält Beispiel-Shops, drei Bestellpläne und ein paar Läufe. *Jetzt
ausführen* startet einen simulierten Lauf, dessen Protokoll über einige
Sekunden mitläuft – so sieht man die Live-Ansicht in Bewegung.

**Die echte App im heimischen WLAN testen** – für alles, was einen Server
braucht (Anmeldung, Produktsuche, Bestellpläne speichern):

```bash
npm run dev -- --host          # bindet den Vite-Server an alle Adressen
```

Dann auf dem Telefon `http://<ip-des-laptops>:5173` aufrufen; beide Geräte
müssen im selben WLAN sein. Die IP liefert `ipconfig getifaddr en0` (macOS)
oder `hostname -I` (Linux).

Soll auch jemand von außerhalb kurz draufschauen, geht das ohne feste
Einrichtung mit einem Wegwerf-Tunnel:

```bash
npm run build && npm start                          # Terminal 1
cloudflared tunnel --url http://localhost:4000      # Terminal 2
```

`cloudflared` gibt eine zufällige `https://…trycloudflare.com`-Adresse aus,
die gilt, solange der Befehl läuft. Für den Dauerbetrieb ist der eingerichtete
Tunnel aus Schritt 4 gedacht.

## 1. Was der Server können muss

AutoHouse startet für jede Bestellung einen echten Chromium. Das schließt
Serverless-Dienste (Vercel, Netlify, Cloudflare Workers) aus: Es braucht einen
dauerhaft laufenden Prozess, echten Arbeitsspeicher und eine Festplatte, die
Neustarts überlebt.

**Mindestens:** 2 CPU-Kerne, 2 GB RAM, 20 GB SSD.
**Angenehm:** 2 Kerne, 4 GB RAM, 40 GB SSD.

Empfehlung: ein kleiner VPS, z. B. **Hetzner CX22** (2 Kerne, 4 GB, 40 GB,
rund 4,50 €/Monat, Rechenzentrum Nürnberg/Falkenstein). Netcup, Contabo oder
Ionos tun es genauso.

Zwei Alternativen, falls du keinen VPS willst:

- **Rechner bei dir zuhause** (Mini-PC, NAS mit Docker, Raspberry Pi 4/5 mit
  4 GB). Funktioniert mit exakt derselben Anleitung – der Cloudflare-Tunnel
  baut die Verbindung von innen nach außen auf, du brauchst also weder eine
  feste IP noch Portfreigaben im Router. Nachteil: Der Rechner muss laufen,
  wenn ein Bestelltermin fällig ist.
- **ARM-Server** (Hetzner CAX11, Raspberry Pi): läuft, Playwright liefert
  Chromium auch für arm64 – ist aber weniger erprobt als x86. Im Zweifel x86.

Die folgenden Befehle gehen von **Ubuntu 24.04** aus.

---

## 2. Server vorbereiten

> **Schnellweg.** Die Schritte 2 und 3 erledigt auch ein Skript. Auf dem
> frischen Server als root:
>
> ```bash
> apt update && apt install -y git
> git clone https://github.com/fresus90/AutoHouse.git /opt/autohouse-setup
> TUNNEL_TOKEN="ey…" bash /opt/autohouse-setup/deploy/setup.sh
> ```
>
> Das legt Docker, den Benutzer, die Firewall, bei wenig RAM eine
> Auslagerungsdatei, die `.env` mit frisch erzeugtem `ENCRYPTION_KEY` und die
> Container an. Den Token holst du dir vorher aus Schritt 4 – oder lässt ihn
> weg und trägst ihn später nach. Wer lieber weiß, was passiert, geht die
> Schritte unten von Hand durch; das Skript tut genau dasselbe.
>
> Geholt wird der **Standardzweig** des Repositorys. Einen bestimmten Zweig
> nimmt `REPO_BRANCH=<name> bash …/setup.sh`.

Nach dem Anlegen des Servers per SSH verbinden (`ssh root@<server-ip>`).

**a) System aktualisieren und Docker installieren**

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
```

**b) Einen eigenen Benutzer statt `root`**

```bash
adduser --gecos "" autohouse
usermod -aG docker autohouse
rsync --archive --chown=autohouse:autohouse ~/.ssh /home/autohouse
```

Ab hier als dieser Benutzer arbeiten: `ssh autohouse@<server-ip>`.

**c) Firewall – es muss nichts nach außen offen sein**

Der Tunnel verbindet sich von innen nach außen. Deshalb bleibt nur SSH offen:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable
```

**d) Auslagerungsdatei (nur bei 2 GB RAM nötig)**

Chromium ist speicherhungrig. Zwei Gigabyte Swap verhindern, dass das System
bei einem Ausreißer den Prozess abschießt:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**e) Automatische Sicherheitsupdates**

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## 3. AutoHouse einrichten

```bash
git clone https://github.com/fresus90/AutoHouse.git
cd AutoHouse
cp .env.example .env
```

`git clone` ohne weitere Angabe holt den Standardzweig – der heißt nicht
zwingend `main`. Welcher es ist, zeigt `git branch --show-current`. Wer es
konventionell mag, benennt den Zweig einmalig auf GitHub um (*Settings →
General → Default branch*); nötig ist das nicht, die Auslieferung in
Abschnitt 12 richtet sich ohnehin nach dem Standardzweig.

Jetzt den Verschlüsselungsschlüssel erzeugen. Mit ihm werden die
Shop-Zugangsdaten und die gespeicherten Browser-Sessions verschlüsselt:

```bash
docker run --rm node:22-bookworm-slim \
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Die Ausgabe in die `.env` eintragen und die Datei so ausfüllen:

```ini
ENCRYPTION_KEY=<die eben erzeugte lange Hex-Zeichenkette>

TIMEZONE=Europe/Berlin
SESSION_TTL_DAYS=60          # damit das iPhone nicht ständig nach dem Login fragt

# Sicherheitsschalter: erst umstellen, wenn ein Testlauf sauber durchgelaufen ist
ALLOW_REAL_ORDERS=false

SCHEDULER_ENABLED=true
MAX_CONCURRENT_RUNS=1        # bei 2 GB RAM unbedingt bei 1 lassen
HEADLESS=true

# wird in Schritt 4 gefüllt
TUNNEL_TOKEN=
# Diese Zeile einkommentieren, sobald der Token eingetragen ist –
# sie schaltet den Tunnel-Dienst ein.
# COMPOSE_PROFILES=tunnel
```

> Ohne `COMPOSE_PROFILES=tunnel` startet nur die App. Das ist Absicht: So
> lässt sich alles schon einrichten und testen, bevor der Tunnel steht.

Die `.env` gehört niemandem sonst:

```bash
chmod 600 .env
```

> **Schlüssel sichern.** Schreib den `ENCRYPTION_KEY` zusätzlich in deinen
> Passwortmanager. Geht er verloren, sind alle gespeicherten Shop-Zugangsdaten
> unbrauchbar und müssen neu eingegeben werden.

---

## 4. Cloudflare Tunnel anlegen

Der Tunnel ist der Grund, warum am Server kein Port offen sein muss:
`cloudflared` baut die Verbindung zu Cloudflare selbst auf. Von außen ist der
Server unsichtbar; erreichbar ist nur, was du im Tunnel freigibst.

Cloudflare beschriftet Menüpunkte gelegentlich um. Wo ein Name nicht passt,
steht unten jeweils, wonach du suchst.

### 4.1 Voraussetzung prüfen

Auf [dash.cloudflare.com](https://dash.cloudflare.com) muss deine Domain in
der Liste stehen und den Status **Active** haben. Bei einer über Cloudflare
registrierten Domain ist das automatisch so. Steht dort *Pending nameserver
update*, warte damit, bis es *Active* ist – sonst legt der Tunnel zwar einen
DNS-Eintrag an, aber niemand fragt ihn ab.

### 4.2 Zero Trust einmalig einrichten

Zero Trust ist der Bereich, in dem Tunnel und Zugangsregeln liegen.

1. [one.dash.cloudflare.com](https://one.dash.cloudflare.com) öffnen.
2. Beim allerersten Mal fragt Cloudflare nach einem **Team-Namen**. Der wird
   Teil der Anmeldeadresse `https://<team>.cloudflareaccess.com`, die deine
   Freunde später zu sehen bekommen – also etwas Kurzes, Bleibendes
   (z. B. dein Nachname oder Haushaltsname). Nachträglich ändern geht, ist
   aber lästig.
3. Tarif: **Free** (bis 50 Nutzer). Cloudflare verlangt dabei eine
   Zahlungsmethode – berechnet wird auf diesem Tarif nichts.

### 4.3 Tunnel anlegen

1. Links **Networks → Tunnels** (in älteren Ansichten: *Access → Tunnels*).
2. **Create a tunnel** → Connector-Typ **Cloudflared** → **Next**.
3. Name: `autohouse` → **Save tunnel**.

Danach zeigt Cloudflare eine Seite *Install and run a connector* mit
Befehlen für verschiedene Betriebssysteme. **Führe keinen davon aus** –
`cloudflared` läuft bei uns schon als Container. Du brauchst nur den
**Token**: die lange Zeichenkette hinter `--token` im angezeigten Befehl.
Sie beginnt mit `eyJ` und ist mehrere hundert Zeichen lang.

> Die drei Punkte in den Beispielen dieser Anleitung (`ey…`) stehen für den
> Rest des Tokens. Kopiere immer die **ganze** Zeichenkette.

### 4.4 Token eintragen und den Tunnel starten

Auf dem Server:

```bash
cd /home/autohouse/AutoHouse
nano .env
```

Zwei Zeilen setzen – den Token einfügen und das Profil aktivieren:

```ini
TUNNEL_TOKEN=eyJhIjoiMGYxZDM0NmU4ZDk5YzExZmE1NDkwNjQ4ZDgyMjM3ZWEiLCJ0Ijoi…
COMPOSE_PROFILES=tunnel
```

Speichern (in `nano`: `Strg+O`, `Enter`, `Strg+X`), dann:

```bash
docker compose up -d
docker compose logs --tail 20 tunnel
```

**Checkpoint.** Im Log muss stehen:

```
Registered tunnel connection  connIndex=0 ...
```

Meist erscheinen zwei bis vier solcher Zeilen – Cloudflare baut mehrere
Verbindungen auf. Steht dort stattdessen `Couldn't decode the token` oder
`provided Tunnel token is not valid`, wurde der Token unvollständig kopiert.

Im Dashboard wechselt der Tunnel jetzt von *Inactive* auf **Healthy**.

### 4.5 Öffentliche Adresse festlegen

Zurück im Dashboard beim Tunnel: **Public Hostname** → **Add a public
hostname** (je nach Ansicht heißt der Schritt *Route Traffic* oder
*Published application routes*).

| Feld | Wert |
| --- | --- |
| Subdomain | `autohouse` |
| Domain | deine Domain aus der Auswahlliste |
| Path | leer lassen |
| Type | `HTTP` |
| URL | `app:4000` |

**Save hostname.**

Zwei Dinge, die hier gern schiefgehen:

- Bei *Type* wirklich **HTTP** wählen, nicht HTTPS. Innerhalb des
  Docker-Netzwerks spricht die App einfaches HTTP.
- Bei *URL* steht `app:4000` – kein `http://` davor, keine IP-Adresse.
  `app` ist der Dienstname aus der `docker-compose.yml`; beide Container
  liegen im selben Docker-Netzwerk und finden sich über diesen Namen.

> Dass hinter dem Tunnel unverschlüsseltes HTTP läuft, ist in Ordnung: Die
> Strecke Browser → Cloudflare ist HTTPS, die Strecke Cloudflare → Server
> läuft verschlüsselt im Tunnel, und die letzten Zentimeter bleiben innerhalb
> des Servers.

### 4.6 DNS prüfen – aber nichts von Hand anlegen

Cloudflare legt den Eintrag selbst an. Unter **dash.cloudflare.com → deine
Domain → DNS → Records** taucht jetzt auf:

| Typ | Name | Inhalt | Proxy |
| --- | --- | --- | --- |
| CNAME | `autohouse` | `<tunnel-id>.cfargotunnel.com` | Proxied (orange Wolke) |

Lege hier **keinen** eigenen A- oder CNAME-Eintrag für `autohouse` an. Ein
von Hand gesetzter Eintrag kollidiert mit dem des Tunnels, und die Wolke muss
orange bleiben – grau (*DNS only*) umgeht den Tunnel und führt ins Leere.

### 4.7 Erster Aufruf

```bash
curl -I https://autohouse.deine-domain.de
```

Erwartet wird `HTTP/2 200`. Im Browser erscheint die Einrichtungsseite von
AutoHouse. **Lege hier noch kein Konto an** – erst kommt der Zugangsschutz in
Abschnitt 6, sonst steht die Anmeldeseite kurzzeitig offen im Netz.

Kommt eine Cloudflare-Fehlerseite, hilft die Tabelle in Abschnitt 11: `1033`
heißt Tunnel nicht verbunden, `502` heißt Tunnel steht, aber die App
antwortet nicht.

---

## 5. Starten

```bash
docker compose up -d --build
```

Startet nur `app` und du erwartest auch den Tunnel? Dann fehlt in der `.env`
die Zeile `COMPOSE_PROFILES=tunnel`. Nachtragen und den Befehl wiederholen.

Der erste Durchlauf dauert ein paar Minuten – Chromium und seine
Systembibliotheken werden ins Image gepackt. Danach:

```bash
docker compose ps          # beide Dienste sollten "running" sein, app "healthy"
docker compose logs -f app
```

Im Log sollte stehen:

```
AutoHouse laeuft auf http://localhost:4000
ALLOW_REAL_ORDERS=false – alle Laeufe enden im Warenkorb (Testlauf).
Scheduler laeuft (Takt 30000 ms, Zeitzone Europe/Berlin).
```

Jetzt `https://autohouse.deine-domain.de` im Browser aufrufen. Es erscheint die
Einrichtungsseite von AutoHouse. **Noch nicht registrieren** – erst Schritt 6.

---

## 6. Zugang für den Freundeskreis

AutoHouse hat einen eigenen Login. Trotzdem lohnt sich **Cloudflare Access**
davor: Dann erreicht die App überhaupt nur, wer auf deiner Liste steht. Der
Rest des Internets – Scanner, Bots, Zufallsfunde – sieht nur eine
Anmeldeseite von Cloudflare.

Zwei Türen also: erst Cloudflare (alle vier Wochen), dann AutoHouse (bestimmt
durch `SESSION_TTL_DAYS`).

### 6.1 Anwendung anlegen

Zero Trust → **Access → Applications → Add an application** → **Self-hosted**.

| Feld | Wert |
| --- | --- |
| Application name | `AutoHouse` |
| Session Duration | `1 month` |
| Subdomain | `autohouse` |
| Domain | deine Domain |
| Path | leer lassen |

Die Adresse muss exakt die aus Abschnitt 4.5 sein. Weicht sie ab, greift die
Regel nicht und die App steht offen.

### 6.2 Regel festlegen

Im nächsten Schritt (*Policies*, je nach Ansicht *Add policy* oder
*Create new policy*):

| Feld | Wert |
| --- | --- |
| Policy name | `Freundeskreis` |
| Action | `Allow` |
| Include → Selector | `Emails` |
| Value | deine Adresse, dann je eine weitere pro Zeile |

Für eine ganze Domain gibt es stattdessen den Selector `Emails ending in`.

**Trag dich selbst zuerst ein.** Wer nicht in der Liste steht, kommt nicht
mehr rein – auch du nicht.

### 6.3 Anmeldeverfahren

Unter **Login methods** reicht **One-time PIN**. Deine Freunde geben ihre
E-Mail-Adresse ein, bekommen einen sechsstelligen Code zugeschickt und sind
drin – kein Konto bei Google, GitHub oder sonstwo nötig. One-time PIN ist ab
Werk aktiv; lass ruhig *Accept all available identity providers* stehen,
solange du keinen anderen Anbieter eingerichtet hast.

**Save application.**

### 6.4 Prüfen

Ruf `https://autohouse.deine-domain.de` in einem **privaten Fenster** auf
(sonst bist du womöglich schon angemeldet). Erwarteter Ablauf:

1. Cloudflare fragt nach der E-Mail-Adresse
2. Code aus der Mail eingeben
3. danach erst die Anmeldeseite von AutoHouse

Kommt AutoHouse sofort ohne Cloudflare-Abfrage, passt die Adresse in der
Anwendung nicht zu der im Tunnel – Schreibweise in 6.1 vergleichen.

Teste zusätzlich mit einer Adresse, die **nicht** auf der Liste steht: Da
muss Cloudflare abweisen. Das ist der eigentliche Beweis, dass die Regel
greift.

### 6.5 Was deine Freunde brauchen

Schick ihnen drei Zeilen:

> 1. `https://autohouse.deine-domain.de` in **Safari** öffnen
> 2. E-Mail-Adresse eingeben, Code aus der Mail eintippen
> 3. mit den Zugangsdaten anmelden, die du mitgeschickt hast

Für das Symbol auf dem Home-Bildschirm siehe Abschnitt 9.

> **Wenn du Access weglässt:** Die App ist trotzdem passwortgeschützt und die
> Registrierung schließt sich nach dem ersten Konto. Aber die Anmeldeseite
> wäre für jeden im Internet sichtbar. Mit Access ist sie es nicht.

---

## 7. Konten anlegen

**Dein eigenes Konto** entsteht im Browser: Seite aufrufen, E-Mail und ein
Passwort mit mindestens 10 Zeichen eingeben. Danach ist die Registrierung
geschlossen – niemand kann sich mehr selbst anlegen.

**Konten für Freunde** legst du auf dem Server an:

```bash
docker compose exec app node dist/cli/create-user.js \
  --email freundin@example.de --name "Anna"
```

Ohne `--password` erzeugt der Befehl eines und gibt es aus – das gibst du
weiter, und derjenige ändert es in der App unter *Einstellungen*.

> Jedes Konto hat seine eigenen Shops, Bestellpläne und Läufe. Niemand sieht
> die Daten der anderen, auch nicht die hinterlegten Shop-Zugangsdaten.

Im Container heißen die Befehle `node dist/cli/<name>.js` – die kurzen
`npm run …`-Varianten aus dem README gibt es nur in der Entwicklungsumgebung.

| Zweck | Befehl im Container |
| --- | --- |
| Konto anlegen | `node dist/cli/create-user.js --email … --name …` |
| Shops auflisten | `node dist/cli/shop-login.js --list` |
| Anmelden mit gespeicherten Zugangsdaten | `node dist/cli/shop-login.js --shop <id> --headless` |
| Session importieren | `node dist/cli/shop-session.js --import <id> --file …` |
| Plan sofort ausführen | `node dist/cli/run-plan.js --plan <id>` |

---

## 8. Shops verbinden – auch ohne Bildschirm

In der App unter *Shops* einen Shop anlegen (bei REWE mit Postleitzahl) und die
Zugangsdaten eintragen. Dann **Verbindung testen**.

Klappt der Test: fertig. Die Anmeldung wird verschlüsselt gespeichert und
künftig wiederverwendet.

Kommt stattdessen *„zeigt ein Captcha"*, hilft der übliche Trick – einmal von
Hand anmelden – nicht direkt, weil auf dem Server kein Bildschirm existiert.
Dafür gibt es den Umweg über deinen eigenen Rechner:

**Auf deinem Laptop** (einmalig, Node 22.13+ nötig):

```bash
git clone https://github.com/fresus90/AutoHouse.git && cd AutoHouse
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # in .env eintragen
npx playwright install chromium

npm run dev            # kurz aufrufen, Konto anlegen, denselben Shop anlegen
npm run shop:login -- --list
npm run shop:login -- --shop shop_abc123      # sichtbarer Browser: anmelden, Enter drücken
npm run shop:session -- --export shop_abc123 --out session.json
```

**Auf den Server übertragen und importieren:**

```bash
scp session.json autohouse@<server-ip>:~/AutoHouse/
ssh autohouse@<server-ip>
cd AutoHouse

docker compose exec app node dist/cli/shop-login.js --list     # Shop-ID auf dem Server ablesen
docker compose cp session.json app:/tmp/session.json
docker compose exec app node dist/cli/shop-session.js \
  --import shop_xyz789 --file /tmp/session.json

docker compose exec app rm /tmp/session.json
rm session.json                                # auch lokal löschen
```

Danach in der App *Verbindung testen* – der Status sollte auf „Verbunden"
springen.

> Die Exportdatei enthält die Anmelde-Cookies des Shops im Klartext. Sie ist so
> schützenswert wie das Passwort selbst: nur per `scp` übertragen, danach auf
> beiden Seiten löschen.

**Der erste echte Lauf.** Lass `ALLOW_REAL_ORDERS=false` stehen und starte den
Plan über *Jetzt ausführen*. Das füllt den Warenkorb und protokolliert alles,
ohne zu bestellen. Sieht der Warenkorb richtig aus, schaltest du frei:

```bash
sed -i 's/ALLOW_REAL_ORDERS=false/ALLOW_REAL_ORDERS=true/' .env
docker compose up -d
```

Und im Plan selbst dann noch *Testlauf* aus und *Bestellung kostenpflichtig
abschicken* an. Erst wenn beides steht, wird wirklich gekauft.

---

## 9. Auf dem iPhone installieren

AutoHouse bringt ein Web-App-Manifest und die passenden Symbole mit. Damit
landet es wie eine native App auf dem Home-Bildschirm – ohne App Store, ohne
Entwicklerkonto, ohne die 7-Tage-Ablauffrist von AltStore und Konsorten.

1. `https://autohouse.deine-domain.de` in **Safari** öffnen (nicht Chrome –
   nur Safari darf auf iOS zum Home-Bildschirm hinzufügen).
2. Bei Cloudflare Access anmelden, dann bei AutoHouse.
3. Teilen-Symbol (Rechteck mit Pfeil nach oben) → **Zum Home-Bildschirm**.
4. Name bestätigen → **Hinzufügen**.

Das Symbol startet die App im Vollbild, ohne Safari-Leisten. Die Anmeldung
bleibt gespeichert (`SESSION_TTL_DAYS=60` aus Schritt 3, Cloudflare Access
einen Monat). Für deine Freunde ist es derselbe Weg – schick ihnen einfach den
Link und diese vier Zeilen.

Auf Android funktioniert es genauso, dort bietet Chrome „App installieren"
von selbst an.

Was eine installierte Web-App **nicht** kann: Push-Mitteilungen auf iOS sind
nur eingeschränkt möglich und in AutoHouse nicht eingebaut. Ob eine Bestellung
geklappt hat, steht in der App unter *Läufe*.

---

## 10. Betrieb: Updates, Sicherungen, Logs

**Updates einspielen**

```bash
cd ~/AutoHouse
git pull
docker compose up -d --build
```

Die Datenbank liegt im Docker-Volume `autohouse-data` und übersteht den Neubau.

**Sicherungen**

```bash
./scripts/backup.sh                 # legt backups/autohouse-<zeitstempel>.db an
```

Das Skript nutzt `sqlite3 .backup`, sichert also im laufenden Betrieb
konsistent. Täglich per Cron:

```bash
crontab -e
# 0 3 * * * cd /home/autohouse/AutoHouse && ./scripts/backup.sh >> backup.log 2>&1
```

Sichere zusätzlich den `ENCRYPTION_KEY` getrennt – ohne ihn nützt die
Datenbank-Sicherung nur halb.

**Logs**

```bash
docker compose logs -f app          # AutoHouse
docker compose logs -f tunnel       # Cloudflare-Verbindung
docker compose logs --since 1h app  # letzte Stunde
```

**Speicherplatz**

Screenshots gescheiterter Läufe sammeln sich unter `/app/data/runs`. Alles
älter als 30 Tage aufräumen:

```bash
docker compose exec app sh -c 'find /app/data/runs -type f -mtime +30 -delete'
```

**Neustart nach Server-Reboot** passiert von selbst: Beide Container haben
`restart: unless-stopped`, und Docker startet mit dem System.

---

## 11. Fehlersuche

| Symptom | Ursache | Abhilfe |
| --- | --- | --- |
| Cloudflare zeigt **Error 1033** | Tunnel nicht verbunden | `docker compose logs tunnel`; meist ein unvollständig kopierter `TUNNEL_TOKEN` |
| `Couldn't decode the token` im Tunnel-Log | Token unvollständig oder Platzhalter | Ganze Zeichenkette hinter `--token` erneut kopieren |
| Tunnel-Log bleibt leer, nur `app` läuft | `COMPOSE_PROFILES=tunnel` fehlt | Zeile in die `.env`, dann `docker compose up -d` |
| Seite meldet **DNS_PROBE_FINISHED_NXDOMAIN** | Öffentliche Adresse noch nicht gespeichert | Abschnitt 4.5; danach steht der CNAME unter DNS → Records |
| Cloudflare-Anmeldung erscheint gar nicht | Adresse in der Access-Anwendung weicht ab | Abschnitt 6.1, Schreibweise vergleichen |
| Cloudflare zeigt **Error 502** | Tunnel läuft, App nicht | `docker compose ps`, `docker compose logs app` |
| Cloudflare zeigt **Error 524** beim Verbindungstest | Cloudflare bricht nach 100 s ab; der Login im Hintergrund läuft weiter | Seite neu laden, der Shop-Status ist meist schon aktualisiert |
| `fatal: Remote branch main not found` | Der Standardzweig heißt anders | Ohne `--branch` klonen; das Setup-Skript tut das seit der aktuellen Fassung von selbst |
| `required variable TUNNEL_TOKEN is missing a value` | Ältere `docker-compose.yml` | `git pull`; der Tunnel hängt jetzt am Profil `tunnel` |
| `docker compose up` startet nur `app` | `COMPOSE_PROFILES=tunnel` fehlt in der `.env` | Zeile ergänzen |
| Container startet neu in Schleife | `ENCRYPTION_KEY` fehlt oder ist zu kurz | 64 Hex-Zeichen, siehe Schritt 3 |
| Lauf endet mit *Aktion nötig* | Captcha, kein Login, Mindestbestellwert | Details unter *Läufe*, Screenshots ansehen |
| Lauf bricht ohne Meldung ab, Container startet neu | Arbeitsspeicher voll | Swap anlegen (Schritt 2d), `MAX_CONCURRENT_RUNS=1` |
| App zeigt nach längerer Pause seltsames Verhalten | Access-Sitzung abgelaufen, API bekommt HTML statt JSON | Seite neu laden |
| Bestellungen laufen nicht zur richtigen Zeit | falsche Zeitzone | `TIMEZONE=Europe/Berlin` in der `.env`, dann `docker compose up -d` |

Zustand auf einen Blick:

```bash
docker compose ps
docker stats --no-stream
curl -s localhost:4000/api/health    # nur wenn du den Port lokal freigegeben hast
```

---

## 12. Den Build automatisieren

Das Image auf einem 2-GB-Server zu bauen dauert und belegt Speicher. Besser:
GitHub baut es, der Server lädt es nur herunter. Dafür liegt
`.github/workflows/deploy.yml` bereit. Der Ablauf:

```
git push  ──►  Tests + Typprüfung  ──►  Image nach ghcr.io  ──►  Server aktualisiert sich
```

**a) Ohne weitere Einrichtung** laufen bei jedem Push Tests, Typprüfung und
Build. Das allein lohnt sich schon: Ein Fehler fällt auf, bevor er auf dem
Server landet.

**b) Image bauen lassen.** Sobald der Workflow einmal auf `main` gelaufen ist,
liegt das Image unter `ghcr.io/<dein-benutzer>/autohouse:latest`. Damit der
Server es ohne Anmeldung ziehen kann, das Paket einmalig öffentlich stellen:
GitHub → dein Profil → *Packages* → `autohouse` → *Package settings* →
*Change visibility* → *Public*. (Alternativ meldet sich der Server mit
`docker login ghcr.io` an.)

Auf dem Server dann in der `.env` eintragen:

```ini
AUTOHOUSE_IMAGE=ghcr.io/<dein-benutzer>/autohouse:latest
```

Ab jetzt genügt zum Aktualisieren:

```bash
cd ~/AutoHouse && git pull && docker compose pull app && docker compose up -d
```

**c) Ganz ohne Handgriff.** Hinterlege drei Geheimnisse im Repository unter
*Settings → Secrets and variables → Actions*:

| Name | Wert |
| --- | --- |
| `DEPLOY_HOST` | IP oder Hostname des Servers |
| `DEPLOY_USER` | `autohouse` |
| `DEPLOY_SSH_KEY` | privater SSH-Schlüssel ohne Passphrase |

Den Schlüssel erzeugst du auf deinem Rechner und hinterlegst den öffentlichen
Teil auf dem Server:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/autohouse-deploy -N "" -C "github-actions"
ssh-copy-id -i ~/.ssh/autohouse-deploy.pub autohouse@<server-ip>
cat ~/.ssh/autohouse-deploy        # Inhalt als DEPLOY_SSH_KEY einfügen
```

Danach aktualisiert sich der Server bei jedem Push auf `main` selbst. Fehlen
die Geheimnisse, überspringt der Workflow den Schritt und meldet nur, welches
Image bereitsteht – kein roter Lauf.

> Ein Deploy-Schlüssel ohne Passphrase ist ein vollwertiger Zugang zum Server.
> Nutze einen eigenen Schlüssel nur für diesen Zweck und nicht denselben, mit
> dem du dich selbst anmeldest.

---

## 13. Kosten

| Posten | Preis |
| --- | --- |
| VPS (Hetzner CX22 o. ä.) | ca. 4,50 € / Monat |
| Domain | hast du schon |
| Cloudflare Tunnel + Access (Free, bis 50 Nutzer) | 0 € |
| App Store Entwicklerkonto | entfällt – 99 € / Jahr gespart |

Rund 55 € im Jahr, und der Server hat nebenbei Luft für andere Dienste.
