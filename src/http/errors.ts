import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger.js';

const log = logger.child('http');

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, message, 'bad_request', details);
export const unauthorized = (message = 'Nicht angemeldet.'): HttpError =>
  new HttpError(401, message, 'unauthorized');
export const notFound = (message = 'Nicht gefunden.'): HttpError =>
  new HttpError(404, message, 'not_found');
export const conflict = (message: string): HttpError => new HttpError(409, message, 'conflict');

/** Async-Handler so einpacken, dass Fehler bei Express landen. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Die Eingaben sind unvollstaendig oder ungueltig.',
      code: 'validation',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, code: error.code, details: error.details });
    return;
  }
  log.error('Unerwarteter Fehler', error);
  res.status(500).json({
    error: 'Unerwarteter Serverfehler.',
    code: 'internal',
    details: error instanceof Error ? error.message : undefined,
  });
}
