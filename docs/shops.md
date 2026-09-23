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
npm run shop:inspect -- --shop <shop-id> --url /marktwahl
# im Container:
docker compose exec app node dist/cli/shop-inspect.js --shop <shop-id> --url /marktwahl
```

Das öffnet die Seite mit der gespeicherten Session, bestätigt den
Cookie-Banner und listet auf, welche Eingabefelder und Schaltflächen dort
tatsächlich stehen – mit `id`, `name`, `placeholder`, `aria-label` und
`data-testid`. Screenshot und HTML landen zusätzlich unter
`data/runs/diagnose/`. Aus dieser Liste lässt sich der passende Selektor
direkt ablesen und oben im Treiber eintragen.

Für Endpunkte (die im Bericht nicht auftauchen) weiterhin von Hand:

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

Bei `shop.rewe.de` ist der Fall konkret. Von einem Server im Rechenzentrum
kommt statt der Seite eine Prüfung mit dem Titel „Nur einen Moment…" und einem
eingebetteten Rahmen von `challenges.cloudflare.com/…/turnstile/…`. Der
Seitenbericht zeigt dann null Eingabefelder und null Schaltflächen.

Das ist **kein Selektorproblem** und lässt sich auch nicht durch Warten lösen.
Wichtig für die Planung:

- Die Freigabe landet im Cookie **`cf_clearance`**, und das ist **an die
  IP-Adresse gebunden**. Eine Session, die von einem anderen Anschluss
  übertragen wurde, hilft hier also **nicht** – anders als bei einfacheren
  Prüfungen. Abschnitt 8 der Hosting-Anleitung ist für diesen Fall der
  falsche Weg.
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
