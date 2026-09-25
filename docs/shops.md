# Shop-Treiber: Aufbau, Pflege, Fehlersuche

Dieses Dokument richtet sich an die Person, die einen Treiber am Laufen halten
oder einen neuen Shop ergänzen will.

---

## 1. Der Vertrag

Ein Treiber implementiert `ShopDriver` aus `src/automation/types.ts`:

| Methode | Aufgabe |
| --- | --- |
| `prepare` | Seite öffnen, Cookie-Banner, Marktwahl/PLZ |
| `isLoggedIn` | prüft schnell, ob die mitgebrachte Session gilt |
| `login` | ruft `performLogin` aus `src/automation/login.ts` mit den Adressen des Shops auf |
| `searchProducts` | Suchbegriff → Trefferliste mit Artikelnummer und Preis |
| `getProduct` | Artikelnummer → Produkt |
| `clearCart` | Warenkorb leeren |
| `addToCart` | Position hinzufügen, liefert den tatsächlichen Preis zurück |
| `readCart` | Warenkorb auslesen (Wahrheit für die Budgetprüfung) |
| `listDeliverySlots` / `chooseDeliverySlot` | nur bei Shops mit Zeitfenstern |
| `placeOrder` | letzter Schritt, kostenpflichtig |

**Nicht** im Treiber: Budget, Prioritäten, Reihenfolge, Protokoll,
Sicherheitsprüfungen. Das steht einmal in `src/automation/run-order.ts` und
gilt damit für jeden Shop gleich.

---

## 2. Warum Browser *und* HTTP

Der Browser erledigt, was nur er kann: JavaScript ausführen, Consent-Layer
wegklicken, sich anmelden, Bot-Erkennung überstehen. Sobald die Session steht,
ist jeder weitere Klick reine Verschwendung.

Deshalb bekommt jeder Treiber neben `page` auch `api` – den HTTP-Client des
Browser-Kontexts (`page.request`). Der teilt Cookies, Header und
TLS-Fingerabdruck mit der Seite, spricht aber direkt die JSON-Endpunkte an, die
das Shop-Frontend selbst benutzt:

```ts
const { page, api } = requireBrowser(ctx);
const response = await api.get(`${REWE.baseUrl}/api/products?search=Milch`, {
  headers: { accept: 'application/json' },
  failOnStatusCode: false,
});
```

Das ist pro Artikel um ein Vielfaches schneller als Suchseite laden, Kachel
finden, Button klicken, auf das Warenkorb-Overlay warten – und es bricht nicht,
wenn sich eine CSS-Klasse ändert. Antwortet ein Endpunkt nicht (Status ≠ 2xx),
fällt der Treiber automatisch auf den DOM-Weg zurück; beide Wege sind in
`rewe.driver.ts` und `dm.driver.ts` implementiert.

---

## 2b. Was ohne Selektoren auskommt

Zwei Stellen suchen ihre Felder inzwischen selbst und brauchen keine gepflegten
Selektoren mehr:

- **Postleitzahl** (`findPostalCodeInput`): probiert die bekannten Selektoren,
  dann Beschriftung, Platzhalter, `aria-label`, umschließendes Label und
  schließlich „fünfstellig und numerisch".
- **Anmeldemaske** (`findLoginFields`): Anker ist `input[type="password"]` –
  das überlebt Umbauten deutlich besser als Klassennamen, weil Browser und
  Passwortmanager darauf angewiesen sind. Das Benutzerfeld ist das letzte
  Textfeld davor, die Schaltfläche der Absende-Knopf desselben Formulars.
  Fehlt das Passwortfeld, gilt die Anmeldung als **mehrstufig**: Erst wird die
  E-Mail abgeschickt, dann wird erneut gesucht.

Steckt die Anmeldung in einem eingebetteten Rahmen (ausgelagerter
Anmeldedienst), meldet der Treiber das samt Adresse und verweist auf den
Login-Assistenten, statt ins Leere zu laufen.

## 3. Endpunkte und Selektoren prüfen

Alle veränderlichen Werte stehen ganz oben im jeweiligen Treiber als `REWE`
bzw. `DM`. Diese Werte sind **nicht offiziell dokumentiert** und können sich
jederzeit ändern. So zieht man sie nach:

**Der schnellste Weg: den Shop von AutoHouse selbst beschreiben lassen.**

```bash
# Fuer beliebige oeffentliche Seiten – ohne dass ein Shop angelegt sein muss:
npm run shop:inspect -- --url https://www.knuspr.de/anmeldung

# Mit angelegtem Shop: nutzt dessen gespeicherte Anmeldung und erreicht
# damit auch Seiten hinter dem Login. Pfadangaben genuegen.
npm run shop:inspect -- --shop <shop-id> --url /marktwahl

# im Container jeweils:
docker compose exec app node dist/cli/shop-inspect.js --url https://…
```

Das öffnet die Seite mit der gespeicherten Session, bestätigt den
Cookie-Banner und listet auf, welche Eingabefelder und Schaltflächen dort
tatsächlich stehen – mit `id`, `name`, `placeholder`, `aria-label` und
`data-testid`. Screenshot und HTML landen zusätzlich unter
`data/runs/diagnose/`. Aus dieser Liste lässt sich der passende Selektor
direkt ablesen und oben im Treiber eintragen.

Zwei Zusätze, die bei modernen Shops fast immer gebraucht werden:

```bash
# Maske, die erst auf Klick erscheint (Knuspr: <div aria-label="Konto">)
npm run shop:inspect -- --url https://www.knuspr.de --click "Anmelden"

# Gezielt Produktkacheln samt HTML auflisten
npm run shop:inspect -- --url "https://www.knuspr.de/suche?q=Vollmilch" \
  --selector ".product-card"
```

Welchen Selektor man dort einsetzt, verrät der Abschnitt **„Wiederkehrende
Blöcke"** im Bericht: Er gruppiert gleich aufgebaute Elemente und zeigt
Anzahl und Beispieltext. Acht gleiche Blöcke auf einer Suchseite sind so gut
wie immer die Produktkacheln.

**Endpunkte mitschneiden.** Statt im Netzwerk-Reiter der Entwicklerwerkzeuge
zu suchen, zeichnet das Werkzeug die JSON-Anfragen selbst auf – samt
gesendeten Daten und Form der Antwort:

```bash
# Welchen Endpunkt spricht die Suche an?
npm run shop:inspect -- --url "https://www.knuspr.de/suche?q=Vollmilch" \
  --network --wait 6000

# Was geht beim Hinzufuegen zum Warenkorb raus?
npm run shop:inspect -- --url "https://www.knuspr.de/suche?q=Vollmilch" \
  --network --click "In den Warenkorb"
```

Ausgegeben wird je Anfrage Methode, Status, Adresse, der gesendete Rumpf und
die obersten Schlüssel der Antwort – genug, um den Treiber darauf zu setzen.

### Knuspr: Stand des Treibers

`src/automation/drivers/knuspr.driver.ts` deckt ab: Anmeldung, Lieferadresse,
Suche, Warenkorb. **Nicht umgesetzt ist der Bestellabschluss** – der Lauf
endet dort mit einer klaren Meldung, Testläufe funktionieren vollständig.

| Schritt | Befund | geprüft |
| --- | --- | --- |
| Anmeldung | Maske hinter `<div aria-label="Konto">`, darin `input#email` und `input#password` | ja, Seitenbericht |
| Liefergebiet | `Adresse ändern` öffnet `input#fullAddress`, bestätigt mit `Speichern`. Die Adresse wird im Feld **Markt-ID** des Shops hinterlegt | ja, Seitenbericht |
| Warenkorb-Antwort | `{ status, messages, data }` mit `data.items` als **Objekt**, Schlüssel = Produktnummer | ja, gegen eine echte Antwort (`tests/knuspr.test.ts`) |
| Suche | `/suche?q=…` liefert nur die Seitenhülle, Treffer kommen per JSON nach | teilweise |
| Endpunkt-Adressen | Vermutungen, mit `--network` zu bestätigen | **nein** |
| Kasse | nicht umgesetzt | – |

> **Preise sind Euro-Beträge.** Ganze Beträge kommen im JSON ohne
> Nachkommastellen an: `minimalOrderPrice: 39` meint 39 Euro. Deshalb wird bei
> Knuspr überall `parsePriceToCents(wert, 'euros')` benutzt – sonst würde aus
> dem Mindestbestellwert von 39 Euro einer von 39 Cent, und die Prüfung liefe
> immer durch.

> **Ohne Adresse rät Knuspr das Liefergebiet aus der IP.** Ein Server in
> Nürnberg bekommt das Berliner Sortiment, mit falschen Preisen und
> Lieferzeiten. Beim Anlegen des Shops die Lieferadresse in „Markt-ID"
> eintragen, z. B. `Musterstraße 1, München`.

Für Endpunkte, die sich so nicht zeigen, weiterhin von Hand:

1. Shop im normalen Browser öffnen, Entwicklerwerkzeuge → **Netzwerk**, Filter
   auf `Fetch/XHR`.
2. Die Aktion ausführen, die im Treiber nachgebaut wird (suchen, in den
   Warenkorb legen, Zeitfenster öffnen).
3. Die passende Anfrage anschauen: Pfad, Methode, Nutzdaten, Antwortformat.
4. Werte in der Tabelle im Treiber anpassen.
5. Antwortformat geändert? Dann die `extract…`/`normalize…`-Funktion am Ende
   des Treibers anpassen – die sind bewusst exportiert und in
   `tests/parsing.test.ts` mit Beispielantworten abgedeckt. Erst den Test um
   die neue Form ergänzen, dann die Funktion.

Für Selektoren gilt dasselbe über den **Elemente**-Reiter. Jeder Eintrag ist
eine Liste, die der Reihe nach probiert wird – neue Kandidaten kommen einfach
nach vorne, alte dürfen stehen bleiben:

```ts
loginEmail: ['input#email', 'input[name="email"]', 'input[type="email"]'],
```

---

## 4. Fehlersuche bei einem gescheiterten Lauf

Jeder Lauf legt bei Problemen einen Screenshot **und** den HTML-Stand der Seite
unter `data/runs/<lauf-id>/` ab; in der Oberfläche stehen die Screenshots unter
*Läufe → Details*. Typische Meldungen:

| Meldung | Bedeutung | Abhilfe |
| --- | --- | --- |
| `Login-Formular nicht gefunden` | Selektoren veraltet | Abschnitt 3, am schnellsten mit `shop:inspect` |
| `Eingabefeld fuer die Postleitzahl nicht gefunden` | REWE hat die Marktwahl umgebaut | `shop:inspect --url /marktwahl`, Selektor in `REWE.selectors.postalCodeInput` ergänzen |
| `… zeigt ein Captcha` | Bot-Erkennung beim Login | `npm run shop:login -- --shop …` |
| `Produktsuche über die API nicht möglich (Status 403)` | Endpunkt geändert oder blockiert | Abschnitt 3; der DOM-Weg greift automatisch |
| `Bestellbutton im Checkout nicht gefunden` | Checkout umgebaut | Selektor `placeOrderButton` prüfen |
| `Warenkorb liegt über dem Limit` | Preise gestiegen | Budget oder Artikelliste anpassen |
| `Mindestbestellwert nicht erreicht` | Korb zu klein | mehr Artikel oder `minTotalCents` senken |

Für die Sitzung mit sichtbarem Browser:

```bash
HEADLESS=false BROWSER_SLOWMO_MS=250 npm run plan:run -- --plan plan_xyz
```

---

## 5. Bot-Erkennung

Was der Browser-Aufbau in `src/automation/browser.ts` bereits tut:

- deutsches Gebietsschema, Zeitzone `Europe/Berlin`, realistischer User-Agent,
  gewöhnliche Fenstergröße,
- `--disable-blink-features=AutomationControlled` und `navigator.webdriver`
  entfernt,
- Eingaben werden mit zufälligen Pausen getippt (`typeLikeHuman`),
- Sessions werden gespeichert und wiederverwendet, statt sich ständig neu
  anzumelden – das ist der wirksamste Punkt der Liste.

Was bewusst **nicht** getan wird: Captchas umgehen, IP-Adressen rotieren,
Fingerabdrücke fälschen. Erkennt ein Shop die Automatisierung, endet der Lauf
mit *Aktion nötig* und einem Screenshot – und ein Mensch entscheidet.

### Vorgeschaltete Prüfseiten

Statt der erwarteten Seite kommt manchmal eine Zwischenseite mit einem Titel
wie **„Nur einen Moment…"**, *„Checking your browser"* oder *„Access Denied"*.
AutoHouse erkennt diese Beschriftungen (`detectBotChallenge`) und wartet bis zu
30 Sekunden, ob sie sich von selbst auflöst – viele Prüfungen tun das, sobald
ihr JavaScript durchgelaufen ist. Erst wenn sie stehen bleibt, meldet der Lauf
*Aktion nötig* und nennt Beschriftung und Adresse.

Bleibt sie stehen, liegt es fast immer an der **Herkunft der Anfrage**:
Adressen aus Rechenzentren (Hetzner, Netcup, AWS …) werden deutlich strenger
behandelt als private Anschlüsse.

### REWE: Cloudflare Turnstile

Bei `shop.rewe.de` sind zwei verschiedene Fälle zu unterscheiden – das war
beim ersten Befund noch nicht klar:

**a) Prüfseite statt Inhalt.** Manchmal kommt gar keine Seite, sondern eine
Zwischenseite mit dem Titel „Nur einen Moment…" und einem Rahmen von
`challenges.cloudflare.com`. Der Seitenbericht zeigt dann null Eingabefelder
und null Schaltflächen. Die Freigabe landet im Cookie **`cf_clearance`**, das
**an die IP-Adresse gebunden** ist – eine von einem anderen Anschluss
übertragene Session hilft dagegen nicht.

**b) Turnstile im Anmeldeformular.** Häufiger führt der Weg über die
Startseite auf den Anmeldedienst `account.rewe.de` (Keycloak, Titel
„Anmeldung bei REWE"). Die Maske ist dann vorhanden, das Formular aber mit
einem Turnstile-Widget abgesichert. Hier blockiert nur der **Anmeldevorgang**,
nicht der Seitenabruf. Eine einmal von Hand erzeugte Anmelde-Session kann
deshalb durchaus tragen – die Sitzungs-Cookies des Shops sind nicht in
derselben Weise an die IP gebunden wie `cf_clearance`. Ob es hält, zeigt
nur der Versuch (Login-Assistent plus `shop:session`, siehe
[hosting.md, Abschnitt 8](hosting.md#8-shops-verbinden--auch-ohne-bildschirm)).

Für Fall a) gilt weiterhin:
- Realistisch bleibt, AutoHouse **von einem privaten Anschluss** aus zu
  betreiben: Raspberry Pi, Mini-PC oder NAS mit Docker. Dann kommen die
  Anfragen von einer gewöhnlichen Privatadresse. Der Cloudflare-Tunnel
  funktioniert unverändert, die Anleitung bleibt dieselbe – und der Server
  kostet nichts mehr. Eine Garantie ist auch das nicht: Ein headless
  gestarteter Browser bleibt erkennbar.

Was AutoHouse dafür **nicht** tut: Turnstile lösen oder umgehen, IP-Adressen
rotieren, Fingerabdrücke fälschen. Erkennt der Shop die Automatisierung, endet
der Lauf mit einer verständlichen Meldung – und ein Mensch entscheidet.

---

## 6. Einen neuen Shop ergänzen

### Zuerst: lohnt sich die Arbeit überhaupt?

Bevor ein Treiber entsteht, klärt eine Messung, ob der Shop einen Server
überhaupt heranlässt. Dafür muss **kein Shop in AutoHouse angelegt** sein:

```bash
npm run shops:probe                       # die mitgelieferte Auswahl
npm run shops:probe -- --only knuspr,dm   # nur bestimmte
npm run shops:probe -- --url https://www.beispiel.de --login /anmelden

# im Container:
docker compose exec app node dist/cli/probe-shops.js
```

Geöffnet werden nur Start- und Anmeldeseite – keine Anmeldung, keine
Bestellung, keine Zugangsdaten. Masken, die sich erst auf Klick öffnen
(etwa ein Konto-Symbol im Kopfbereich), werden dabei geöffnet. Je Shop kommt eine von vier Einschätzungen:

| Ergebnis | Bedeutung |
| --- | --- |
| `aussichtsreich` | Anmeldemaske ist erreichbar – ein Treiber kann ansetzen |
| `unklar` | Seite lädt, aber keine Maske gefunden; Screenshot ansehen |
| `pruefung` | Bot-Erkennung vorgeschaltet (Anbieter wird benannt) |
| `nicht erreichbar` | Netzwerkfehler oder Zeitüberschreitung |

Screenshots und ein JSON-Bericht je Shop landen unter `data/runs/probe/`.

Wichtig: `aussichtsreich` heißt nur, dass die **Tür offen** ist. Ob Suche,
Warenkorb und Kasse mitspielen, zeigt erst der Treiber. Und das Ergebnis hängt
an der **Herkunft der Anfrage** – dieselbe Prüfung fällt von einem
Privatanschluss oft anders aus als aus dem Rechenzentrum. Am besten dort
messen, wo AutoHouse später laufen soll.

### Dann den Treiber schreiben

1. `src/automation/drivers/<name>.driver.ts` anlegen und `ShopDriver`
   implementieren. `demo.driver.ts` ist die kürzeste Vorlage,
   `rewe.driver.ts` die vollständigste.
2. In `src/automation/registry.ts` eintragen.
3. Den Slug in `src/core/types.ts` (`ProviderSlug`), in
   `src/http/validation.ts` (`providerSchema`) und in
   `web/src/lib/types.ts` ergänzen.
4. Antwort-Normalisierung mit Beispielantworten in `tests/parsing.test.ts`
   absichern.

Oberfläche, Scheduler, Budgetlogik und Protokoll müssen dafür nicht angefasst
werden.
