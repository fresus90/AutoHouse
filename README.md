# AutoHouse

Web-App hinter einem Login, die wiederkehrende Lebensmittelbestellungen bei
**dm** und **REWE Lieferservice** automatisch auslöst. Die Bestellungen laufen
über einen echten (headless) Browser: Shops pflegen, Produkte auswählen,
Budget und Termin festlegen – den Rest erledigt der Scheduler.

```
Browser (React)  ──►  Express-API  ──►  SQLite
                          │
                          ├─ Scheduler (Intervall je Bestellplan)
                          └─ Warteschlange ──► Playwright/Chromium ──► dm | REWE
```

---

## Inhalt

- [Schnellstart](#schnellstart)
- [Sicherheitsschalter](#sicherheitsschalter)
- [Bedienung](#bedienung)
- [Wie die Automatisierung arbeitet](#wie-die-automatisierung-arbeitet)
- [Architektur](#architektur)
- [Kommandozeile](#kommandozeile)
- [Konfiguration](#konfiguration)
- [Tests](#tests)
- [Betrieb](#betrieb)
- [Grenzen und Verantwortung](#grenzen-und-verantwortung)

---

## Schnellstart

Voraussetzung: **Node.js 22.13 oder neuer** (die App nutzt das eingebaute
`node:sqlite`, deshalb gibt es keine Datenbank-Abhängigkeit).

```bash
npm install

# Konfiguration anlegen und einen Schlüssel erzeugen
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Ausgabe in .env bei ENCRYPTION_KEY eintragen

# Chromium für Playwright (einmalig, falls noch nicht vorhanden)
npx playwright install --with-deps chromium

# Entwicklung: API auf :4000, Oberfläche auf :5173
npm run dev

# Produktion
npm run build && npm start      # alles auf :4000
```

Beim ersten Aufruf legt die Oberfläche das Verwalterkonto an. Danach ist die
Registrierung geschlossen; weitere Konten kommen über
`npm run user:create -- --email …`.

**Empfohlener erster Schritt:** einen Shop vom Typ *Demo-Shop* anlegen. Der
läuft ohne Netzwerk und ohne Browser und zeigt die komplette Kette vom
Bestellplan bis zum Protokoll, ohne dass irgendwo etwas gekauft wird.

---

## Sicherheitsschalter

Es geht um echtes Geld, deshalb gibt es zwei Schlösser, die **beide** offen
sein müssen, bevor eine kostenpflichtige Bestellung abgeschickt wird:

| Schloss | Ort | Standard |
| --- | --- | --- |
| `ALLOW_REAL_ORDERS=true` | `.env`, gilt serverweit | `false` |
| „Bestellung kostenpflichtig abschicken" | je Bestellplan in der Oberfläche | aus |

Solange eines davon zu ist, endet jeder Lauf im gefüllten Warenkorb, wird
protokolliert und als *Testlauf* markiert. Zusätzlich gilt immer:

- Der Warenkorb wird **vor** dem Bestellen erneut gegen das Budget geprüft.
  Liegt er darüber, wird nicht bestellt, sondern der Lauf auf *Aktion nötig*
  gesetzt.
- Ein Mindestbestellwert, der nicht erreicht wird, verhindert die Bestellung
  ebenfalls.
- Vor jedem Lauf wird der Warenkorb geleert, damit Reste aus früheren
  Versuchen nicht mitbestellt werden.

---

## Bedienung

### Shops

Ein „Shop" ist ein Konto bei einem Anbieter. Angelegt werden

- **Typ** (`REWE Lieferservice`, `dm Onlineshop`, `Demo-Shop`),
- eine **Bezeichnung**,
- bei REWE die **Postleitzahl** (bestimmt Liefergebiet und Sortiment),
- optional **Zugangsdaten**.

Zugangsdaten werden mit AES-256-GCM verschlüsselt gespeichert und verlassen die
API nie wieder – die Oberfläche sieht nur „hinterlegt: ja/nein".

„Verbindung testen" prüft die gespeicherte Browser-Session und meldet sich bei
Bedarf neu an. Klappt der automatische Login wegen Captcha nicht, hilft der
[Login-Assistent](#kommandozeile).

### Bestellpläne

Ein Bestellplan beantwortet: *Was, wo, wann, wie teuer?*

- **Rhythmus** – alle N Tage/Wochen/Monate, Wochentag, Uhrzeit, optionales
  Startdatum (legt den Takt fest, z. B. „jeden zweiten Dienstag").
- **Budget** – maximale Ausgaben je Bestellung, optionaler Mindestbestellwert
  und die Strategie, wenn es nicht reicht:
  - *Artikel weglassen* (nach Priorität, optionale zuerst),
  - *Mengen reduzieren*,
  - *Bestellung abbrechen*.
- **Artikel** – Bezeichnung, Menge, Preisgrenze je Stück, Priorität (0–100),
  „optional" und „Ersatzartikel erlauben". Über *Artikel suchen* wird direkt im
  Shop gesucht; der Treffer setzt die Artikelnummer, damit später genau dieses
  Produkt bestellt wird.
- **Lieferzeitfenster** (nur REWE) – frühestmöglich, günstigstes oder nur
  Fenster, die zu Wochentag und Uhrzeit passen.
- **Ausführung** – Testlauf und Bestellbestätigung (siehe oben).

Nach dem Speichern zeigt die **Vorschau**, was mit den zuletzt bekannten
Preisen im Budget landen würde – ohne Browser, sofort.

### Läufe

Jede Ausführung wird protokolliert: Status, geplante Summe, tatsächlicher
Warenkorb, Lieferzeitfenster, Bestellnummer, Zeile für Zeile das Protokoll und
bei Problemen Screenshots der Seite. Ein laufender Vorgang aktualisiert sich
in der Ansicht selbst.

---

## Wie die Automatisierung arbeitet

Ein Lauf durchläuft immer dieselben Schritte – die Reihenfolge ist bewusst
konservativ:

1. **Vorbereiten** – Seite öffnen, Cookie-Banner bestätigen, bei REWE
   Liefergebiet/Markt setzen.
2. **Anmelden** – gespeicherte Session prüfen; nur wenn nötig neu einloggen.
   Die Session wird verschlüsselt gesichert und wiederverwendet.
3. **Artikel auflösen** – über die Artikelnummer, sonst über die Suche.
   Ersatzartikel nur, wenn der Plan es erlaubt.
4. **Budget rechnen** – Preisgrenzen prüfen, nach Priorität einplanen,
   Strategie anwenden. Ergebnis wird gespeichert, bevor irgendetwas passiert.
5. **Warenkorb füllen** – leeren, dann Position für Position hinzufügen. Die
   Preise aus dem Warenkorb überschreiben die Schätzung.
6. **Nachprüfen** – Warenkorbsumme gegen Budget und Mindestbestellwert.
7. **Lieferzeitfenster** wählen (falls der Shop welche hat).
8. **Bestellen** – nur wenn beide Sicherheitsschalter offen sind.

**Warum das schnell ist:** Der Browser stellt nur die Session her. Suche,
Warenkorb und Zeitfenster laufen anschließend über die JSON-Endpunkte derselben
Session (`page.request` teilt Cookies und Header mit der Seite). Das spart pro
Artikel mehrere Seitenaufrufe und ist deutlich unempfindlicher gegen
Layout-Änderungen. Antwortet ein Endpunkt nicht, fällt der Treiber automatisch
auf das DOM zurück.

Details zu Endpunkten, Selektoren und deren Pflege: **[docs/shops.md](docs/shops.md)**.

---

## Architektur

```
src/
├── config.ts              Konfiguration inkl. schlankem .env-Loader
├── index.ts               Serverstart: API + Scheduler
├── core/
│   ├── crypto.ts          scrypt (Passwörter), AES-256-GCM (Geheimnisse)
│   ├── schedule.ts        nächster Termin, Zeitzonen-sicher
│   ├── time.ts            Wanduhrzeit ⇄ UTC ohne externe Bibliothek
│   └── types.ts           Domänentypen
├── db/
│   ├── schema.sql         Tabellen
│   ├── index.ts           node:sqlite, Migration, Transaktionen
│   └── repo/              users, sessions, shops, products, plans, runs
├── http/
│   ├── app.ts             Express-App, liefert auch das gebaute Frontend
│   ├── auth.ts            Cookie-Session
│   ├── validation.ts      zod-Schemas (deutsche Fehlermeldungen)
│   └── routes/            auth, shops, plans, runs, meta
├── automation/
│   ├── types.ts           ShopDriver – der Vertrag für einen Shop
│   ├── browser.ts         Chromium starten, Screenshots ablegen
│   ├── context.ts         Treiber-Kontext, Protokoll, Session-Speicherung
│   ├── budget.ts          Prioritäten und Budget (rein, gut testbar)
│   ├── run-order.ts       Ablauf einer Bestellung (shop-unabhängig)
│   └── drivers/           rewe, dm, demo
├── scheduler/
│   ├── index.ts           Takt, fällige Pläne finden
│   └── queue.ts           Warteschlange mit Parallelitätsgrenze
└── cli/                   Konto anlegen, Login-Assistent, Plan starten

web/                       React-Oberfläche (Vite)
tests/                     Unit-, API-, Browser- und End-to-End-Tests
```

**Der wichtigste Entwurfsgedanke:** Die Bestell-*Logik* (Budget, Prioritäten,
Reihenfolge, Sicherheitsprüfungen, Protokoll) steht **einmal** in
`run-order.ts`. Ein Shop-Treiber liefert nur Bausteine: anmelden, suchen,
Warenkorb, Zeitfenster, bestellen. Ein weiterer Shop besteht deshalb aus einer
Datei in `src/automation/drivers/` und einem Eintrag in `registry.ts` – die
Oberfläche und der Scheduler bleiben unverändert.

---

## Kommandozeile

```bash
# Konto anlegen (Passwort wird erzeugt, wenn keines angegeben wird)
npm run user:create -- --email ich@example.de --name "Tim"

# Login-Assistent: sichtbarer Browser, manuell anmelden, Session sichern
npm run shop:login -- --list
npm run shop:login -- --shop shop_abc123
npm run shop:login -- --shop shop_abc123 --headless   # mit gespeicherten Zugangsdaten

# Bestellplan sofort ausführen (zeigt das Ergebnis im Terminal)
npm run plan:run -- --list
npm run plan:run -- --plan plan_xyz789
```

Der Login-Assistent ist der empfohlene Weg für den **ersten** Login bei dm und
REWE: Captcha und Zwei-Faktor-Abfragen erledigt man einmal von Hand, danach
läuft alles mit der gespeicherten Session.

---

## Konfiguration

Alle Werte stehen in `.env` (Vorlage: `.env.example`).

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `PORT` | Port der API und des Frontends | `4000` |
| `DATABASE_FILE` | SQLite-Datei | `./data/autohouse.db` |
| `ENCRYPTION_KEY` | 32 Byte als Hex – **erforderlich** für Zugangsdaten | – |
| `TIMEZONE` | Zeitzone für Bestelltermine | `Europe/Berlin` |
| `ALLOW_REAL_ORDERS` | Erlaubt kostenpflichtige Bestellungen | `false` |
| `SCHEDULER_ENABLED` | Automatische Ausführung | `true` |
| `SCHEDULER_TICK_MS` | Prüfintervall für fällige Pläne | `30000` |
| `MAX_CONCURRENT_RUNS` | Gleichzeitige Bestellungen | `1` |
| `HEADLESS` | Browser unsichtbar starten | `true` |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Pfad zur Chromium-Binary | automatisch |
| `BROWSER_TIMEOUT_MS` | Zeitlimit für Browser-Aktionen | `45000` |
| `ARTIFACT_DIR` | Screenshots und HTML-Dumps | `./data/runs` |
| `SESSION_TTL_DAYS` | Gültigkeit der Anmeldung in der Web-App | `14` |

---

## Tests

```bash
npm test        # Unit-, API-, Browser- und End-to-End-Tests
npm run typecheck
```

Abgedeckt sind unter anderem:

- Terminberechnung inklusive Sommer-/Winterzeitwechsel,
- Budget- und Prioritätslogik in allen drei Strategien,
- Preis-Parsing und die Normalisierung der Shop-Antworten,
- Anmeldung, Zugriffsschutz und Validierung über die echte HTTP-API,
- ein kompletter Durchlauf über den Demo-Shop (Plan → Lauf → Ergebnis),
- die Browser-Infrastruktur gegen einen lokalen Test-Server (Cookie-Sharing
  zwischen Seite und HTTP-Client, verschlüsselter Storage-State).

Der Browser-Test überspringt sich selbst, wenn kein Chromium installiert ist.

---

## Betrieb

Die App ist ein einzelner Node-Prozess mit einer SQLite-Datei. Für den
Dauerbetrieb genügt ein systemd-Dienst:

```ini
[Unit]
Description=AutoHouse
After=network-online.target

[Service]
WorkingDirectory=/opt/autohouse
ExecStart=/usr/bin/node dist/index.js
Restart=always
User=autohouse
EnvironmentFile=/opt/autohouse/.env

[Install]
WantedBy=multi-user.target
```

Zu sichern sind `data/autohouse.db` **und** der `ENCRYPTION_KEY` – ohne den
Schlüssel sind die gespeicherten Shop-Zugangsdaten wertlos. Wird die App über
das Internet erreichbar gemacht, gehört ein HTTPS-Reverse-Proxy davor
(`NODE_ENV=production` setzt das Session-Cookie dann auf `secure`).

Der eingebaute Scheduler kann mit `SCHEDULER_ENABLED=false` abgeschaltet und
durch einen externen Zeitplan ersetzt werden, der `npm run plan:run` aufruft.

---

## Grenzen und Verantwortung

Ehrlich gesagt, damit es keine Überraschungen gibt:

- **Die Selektoren und Endpunkte von dm und REWE sind nicht offiziell.** Sie
  sind in `src/automation/drivers/*.ts` gebündelt und dokumentiert, damit sie
  sich schnell nachziehen lassen – aber beide Shops ändern ihr Frontend
  regelmäßig. Nach einer Änderung muss die Tabelle im jeweiligen Treiber
  angepasst werden; wie man das prüft, steht in [docs/shops.md](docs/shops.md).
  Die zugehörigen Werte wurden nicht gegen die Live-Seiten verifiziert – der
  erste echte Lauf gehört deshalb als Testlauf gefahren.
- **Bot-Erkennung.** Beide Shops setzen Schutzmechanismen ein. Der Browser
  läuft mit deutschem Gebietsschema, realistischem User-Agent und ohne das
  offensichtlichste Automatisierungs-Merkmal, tippt mit Pausen und nutzt
  gespeicherte Sessions statt ständiger Logins. Eine Garantie ist das nicht;
  bei einem Captcha meldet der Lauf sauber *Aktion nötig*, statt blind
  weiterzumachen.
- **AGB.** Automatisierte Bestellungen können den Nutzungsbedingungen der Shops
  widersprechen. Der Betrieb erfolgt auf eigene Verantwortung – bitte vorher
  prüfen.
- **dm hat keinen Lieferdienst mit Zeitfenstern**, sondern Paketversand. Die
  Zeitfenster-Auswahl ist dort deshalb ausgeblendet.
