/**
 * Einstiegspunkt für den API-Zugriff.
 *
 * `@client` ist ein Alias, den web/vite.config.ts setzt: im normalen Build auf
 * den echten HTTP-Client, im Demo-Build (VITE_DEMO=1) auf die Variante mit
 * Beispieldaten im Browser. So landet immer nur einer der beiden im Bundle.
 */
import { client } from '@client';

export { ApiError, type ApiClient } from './http-api';
export type { PlanPayload } from './http-api';

export const api = client;

/** true, wenn dieses Bundle der Demo-Build ist. */
export const isDemoMode = import.meta.env.VITE_DEMO === '1';
