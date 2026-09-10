import { Router } from 'express';
import {
  clearSessionState,
  createShop,
  deleteShop,
  getCredentials,
  getShop,
  listShops,
  setConnectionStatus,
  updateShop,
} from '../../db/repo/shops.js';
import { listProducts, upsertProduct } from '../../db/repo/products.js';
import { withDriverContext } from '../../automation/context.js';
import { errorMessage } from '../../automation/util.js';
import { isEncryptionConfigured } from '../../core/crypto.js';
import { asyncHandler, badRequest, notFound } from '../errors.js';
import { currentUser, requireAuth } from '../auth.js';
import { searchSchema, shopSchema, shopUpdateSchema } from '../validation.js';

export const shopsRouter = Router();
shopsRouter.use(requireAuth);

shopsRouter.get('/', (req, res) => {
  res.json({ shops: listShops(currentUser(req).id) });
});

shopsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = shopSchema.parse(req.body);
    if (payload.credentials && !isEncryptionConfigured()) {
      throw badRequest(
        'ENCRYPTION_KEY ist nicht gesetzt – Zugangsdaten koennen nicht sicher gespeichert werden.',
      );
    }
    const shop = createShop(currentUser(req).id, {
      provider: payload.provider,
      name: payload.name,
      enabled: payload.enabled ?? true,
      postalCode: payload.postalCode ?? null,
      marketId: payload.marketId ?? null,
      credentials: payload.credentials ?? null,
    });
    res.status(201).json({ shop });
  }),
);

shopsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const shop = getShop(currentUser(req).id, req.params.id!);
    if (!shop) throw notFound('Shop nicht gefunden.');
    res.json({ shop });
  }),
);

shopsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const payload = shopUpdateSchema.parse(req.body);
    if (payload.credentials && !isEncryptionConfigured()) {
      throw badRequest('ENCRYPTION_KEY ist nicht gesetzt – Zugangsdaten koennen nicht gespeichert werden.');
    }
    const shop = updateShop(currentUser(req).id, req.params.id!, payload);
    if (!shop) throw notFound('Shop nicht gefunden.');
    res.json({ shop });
  }),
);

shopsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!deleteShop(currentUser(req).id, req.params.id!)) throw notFound('Shop nicht gefunden.');
    res.status(204).end();
  }),
);

/** Gespeicherte Browser-Session verwerfen (z. B. nach Passwortwechsel im Shop). */
shopsRouter.delete(
  '/:id/session',
  asyncHandler(async (req, res) => {
    const shop = getShop(currentUser(req).id, req.params.id!);
    if (!shop) throw notFound('Shop nicht gefunden.');
    clearSessionState(shop.id);
    setConnectionStatus(shop.id, 'unknown', 'Session verworfen.');
    res.status(204).end();
  }),
);

/** Verbindungstest: Session pruefen, notfalls anmelden. */
shopsRouter.post(
  '/:id/test',
  asyncHandler(async (req, res) => {
    const shop = getShop(currentUser(req).id, req.params.id!);
    if (!shop) throw notFound('Shop nicht gefunden.');

    try {
      const result = await withDriverContext({ shop, dryRun: true }, async (driver, ctx) => {
        await driver.prepare(ctx);
        if (await driver.isLoggedIn(ctx)) {
          await ctx.persistSession();
          return { ok: true, message: 'Bestehende Session ist gueltig.' };
        }
        const credentials = getCredentials(shop.id);
        if (!credentials) {
          return {
            ok: false,
            needsManualAction: true,
            message: 'Keine Zugangsdaten hinterlegt und keine gueltige Session.',
          };
        }
        return driver.login(ctx, credentials);
      });
      setConnectionStatus(shop.id, result.ok ? 'ok' : 'error', result.message ?? null);
      res.json({ result, shop: getShop(currentUser(req).id, shop.id) });
    } catch (error) {
      const message = errorMessage(error);
      setConnectionStatus(shop.id, 'error', message);
      res.status(200).json({
        result: { ok: false, message },
        shop: getShop(currentUser(req).id, shop.id),
      });
    }
  }),
);

/** Zwischengespeicherte Produkte – schnell und ohne Browser. */
shopsRouter.get(
  '/:id/products',
  asyncHandler(async (req, res) => {
    const shop = getShop(currentUser(req).id, req.params.id!);
    if (!shop) throw notFound('Shop nicht gefunden.');
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    res.json({ products: listProducts(shop.id, search) });
  }),
);

/** Live-Suche im Shop; Treffer landen im lokalen Katalog. */
shopsRouter.post(
  '/:id/search',
  asyncHandler(async (req, res) => {
    const shop = getShop(currentUser(req).id, req.params.id!);
    if (!shop) throw notFound('Shop nicht gefunden.');
    const payload = searchSchema.parse(req.body);

    try {
      const candidates = await withDriverContext({ shop, dryRun: true }, async (driver, ctx) => {
        await driver.prepare(ctx);
        // Fuer die Suche ist bei beiden Shops keine Anmeldung noetig.
        return driver.searchProducts(ctx, payload.query, payload.limit ?? 20);
      });
      const products = candidates.map((candidate) =>
        upsertProduct(shop.id, {
          externalId: candidate.externalId,
          name: candidate.name,
          brand: candidate.brand ?? null,
          grammage: candidate.grammage ?? null,
          priceCents: candidate.priceCents ?? null,
          basePrice: candidate.basePrice ?? null,
          imageUrl: candidate.imageUrl ?? null,
          productUrl: candidate.productUrl ?? null,
        }),
      );
      res.json({ products });
    } catch (error) {
      throw badRequest(`Suche fehlgeschlagen: ${errorMessage(error)}`);
    }
  }),
);
