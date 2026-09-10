import path from 'node:path';
import { existsSync } from 'node:fs';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../config.js';
import { attachUser } from './auth.js';
import { errorHandler, notFound } from './errors.js';
import { authRouter } from './routes/auth.routes.js';
import { shopsRouter } from './routes/shops.routes.js';
import { plansRouter } from './routes/plans.routes.js';
import { runsRouter } from './routes/runs.routes.js';
import { metaRouter } from './routes/meta.routes.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // CORS nur fuer den Vite-Dev-Server; im Betrieb liefert Express das Frontend selbst.
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(attachUser);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/shops', shopsRouter);
  app.use('/api/plans', plansRouter);
  app.use('/api/runs', runsRouter);
  app.use('/api/meta', metaRouter);

  app.use('/api', (_req, _res, next) => next(notFound('Unbekannter API-Endpunkt.')));

  // Gebautes Frontend (npm run build:web) ausliefern, inkl. SPA-Fallback.
  const publicDir = path.resolve(process.cwd(), 'dist/public');
  if (existsSync(publicDir)) {
    app.use(express.static(publicDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text/plain; charset=utf-8')
        .send(
          'AutoHouse-API laeuft.\n' +
            'Das Frontend wurde noch nicht gebaut: "npm run build" ausfuehren\n' +
            'oder im Entwicklungsbetrieb "npm run dev" nutzen (Vite auf Port 5173).',
        );
    });
  }

  app.use(errorHandler);
  return app;
}
