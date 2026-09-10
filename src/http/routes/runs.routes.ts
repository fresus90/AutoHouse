import path from 'node:path';
import { existsSync } from 'node:fs';
import { Router } from 'express';
import { getRun, listRunLogs, listRuns } from '../../db/repo/runs.js';
import { config } from '../../config.js';
import { asyncHandler, notFound } from '../errors.js';
import { currentUser, requireAuth } from '../auth.js';

export const runsRouter = Router();
runsRouter.use(requireAuth);

runsRouter.get('/', (req, res) => {
  const planId = typeof req.query.planId === 'string' ? req.query.planId : undefined;
  const limit = Number.parseInt(String(req.query.limit ?? '50'), 10);
  res.json({
    runs: listRuns(currentUser(req).id, {
      ...(planId ? { planId } : {}),
      limit: Number.isFinite(limit) ? Math.min(200, Math.max(1, limit)) : 50,
    }),
  });
});

runsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const run = getRun(currentUser(req).id, req.params.id!);
    if (!run) throw notFound('Lauf nicht gefunden.');
    res.json({ run });
  }),
);

/** Fuer das Live-Protokoll: nur die Zeilen nach `after` nachliefern. */
runsRouter.get(
  '/:id/logs',
  asyncHandler(async (req, res) => {
    const run = getRun(currentUser(req).id, req.params.id!);
    if (!run) throw notFound('Lauf nicht gefunden.');
    const after = Number.parseInt(String(req.query.after ?? '0'), 10);
    const logs = listRunLogs(run.id, Number.isFinite(after) ? after : 0);
    res.json({ logs, status: run.status, finishedAt: run.finishedAt });
  }),
);

/** Screenshots eines Laufs ausliefern – strikt innerhalb des Artefakt-Ordners. */
runsRouter.get(
  '/:id/artifacts/:artifactId',
  asyncHandler(async (req, res) => {
    const run = getRun(currentUser(req).id, req.params.id!);
    if (!run) throw notFound('Lauf nicht gefunden.');
    const artifact = (run.artifacts ?? []).find((entry) => entry.id === req.params.artifactId);
    if (!artifact) throw notFound('Artefakt nicht gefunden.');

    const absolute = path.resolve(artifact.path);
    const root = path.resolve(config.artifactDir);
    if (!absolute.startsWith(root + path.sep) || !existsSync(absolute)) {
      throw notFound('Datei nicht mehr vorhanden.');
    }
    res.sendFile(absolute);
  }),
);
