# ---------------------------------------------------------------------------
# AutoHouse – Produktions-Image
#
# Basis ist node:22-bookworm-slim (nicht das Playwright-Image), weil AutoHouse
# das eingebaute node:sqlite nutzt und dafuer Node 22.13+ braucht.
# Chromium und seine Systempakete kommen ueber "playwright install".
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS build
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    AUTOHOUSE_SKIP_BROWSER_CHECK=1

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY web ./web
RUN npm run build


FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    AUTOHOUSE_SKIP_BROWSER_CHECK=1

COPY package.json package-lock.json ./
COPY scripts ./scripts

# Produktionsabhaengigkeiten, dann Chromium samt Systembibliotheken.
RUN npm ci --omit=dev \
 && npx playwright install --with-deps chromium \
 && npm cache clean --force \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist

# Datenverzeichnisse gehoeren dem Anwendungsnutzer; ein benanntes Docker-Volume
# uebernimmt diese Rechte beim ersten Start.
RUN mkdir -p /app/data/runs /app/data/state \
 && chown -R node:node /app

USER node
EXPOSE 4000

# Chromium wird pro Lauf gestartet; der Healthcheck prueft nur die API.
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
