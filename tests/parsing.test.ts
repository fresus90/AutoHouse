import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCents, parsePriceToCents } from '../src/automation/util.ts';
import { extractReweProducts, extractReweSlots, normalizeReweCart } from '../src/automation/drivers/rewe.driver.ts';
import { extractDmProducts, normalizeDmCart } from '../src/automation/drivers/dm.driver.ts';

test('deutsche und englische Preisschreibweisen', () => {
  assert.equal(parsePriceToCents('1,99 €'), 199);
  assert.equal(parsePriceToCents('€ 1.99'), 199);
  assert.equal(parsePriceToCents('1.234,56 €'), 123_456);
  assert.equal(parsePriceToCents('1,234.56'), 123_456);
  assert.equal(parsePriceToCents('0,89'), 89);
  assert.equal(parsePriceToCents(199), 199, 'ganze Zahlen gelten als Cent');
  assert.equal(parsePriceToCents(1.99), 199, 'Kommazahlen gelten als Euro');
  assert.equal(parsePriceToCents('keine Angabe'), null);
  assert.equal(parsePriceToCents(null), null);
});

test('Betraege werden deutsch formatiert', () => {
  assert.equal(formatCents(1999), '19,99 €');
  assert.equal(formatCents(null), '–');
});

test('REWE-Suchantwort wird normalisiert', () => {
  const payload = {
    products: [
      {
        id: '1234567',
        title: 'Vollmilch 3,5 %',
        brand: { name: 'REWE Beste Wahl' },
        imageURL: 'https://example.invalid/milch.jpg',
        articles: [
          {
            grammage: '1 l',
            listing: { isAvailable: true, pricing: { currentRetailPrice: 1.09, basePrice: '1,09 €/l' } },
          },
        ],
      },
    ],
  };
  const products = extractReweProducts(payload);
  assert.equal(products.length, 1);
  assert.equal(products[0]!.externalId, '1234567');
  assert.equal(products[0]!.priceCents, 109);
  assert.equal(products[0]!.grammage, '1 l');
  assert.equal(products[0]!.available, true);
});

test('REWE-Warenkorb wird normalisiert', () => {
  const cart = normalizeReweCart({
    orderCart: {
      lineItems: [
        { productId: '111', title: 'Butter', quantity: 2, unitPrice: 2.29, totalPrice: 4.58 },
        { productId: '222', title: 'Brot', quantity: 1, unitPrice: 1.89 },
      ],
      totalPrice: 6.47,
      minimumOrderValue: 30,
    },
  });
  assert.equal(cart.lines.length, 2);
  assert.equal(cart.totalCents, 647);
  assert.equal(cart.minimumOrderCents, 3000);
  assert.equal(cart.lines[1]!.totalCents, 189);
});

test('REWE-Lieferzeitfenster werden flachgezogen', () => {
  const slots = extractReweSlots({
    days: [
      {
        timeSlots: [
          { id: 'a', startTime: '2026-09-12T08:00:00', endTime: '2026-09-12T10:00:00', price: 2.9 },
          { id: 'b', startTime: '2026-09-12T10:00:00', endTime: '2026-09-12T12:00:00', available: false },
        ],
      },
    ],
  });
  assert.equal(slots.length, 2);
  assert.equal(slots[0]!.priceCents, 290);
  assert.equal(slots[1]!.available, false);
});

test('dm-Suchantwort wird normalisiert', () => {
  const products = extractDmProducts({
    products: [
      {
        gtin: '4058172001234',
        name: 'Zahncreme Complete',
        brandName: 'Dontodent',
        netQuantityContent: '75 ml',
        price: { value: 0.95, formattedValue: '0,95 €' },
        relativeProductUrl: '/dontodent-zahncreme-p4058172001234.html',
      },
    ],
  });
  assert.equal(products.length, 1);
  assert.equal(products[0]!.priceCents, 95);
  assert.equal(products[0]!.productUrl, 'https://www.dm.de/dontodent-zahncreme-p4058172001234.html');
});

test('dm-Warenkorb wird normalisiert', () => {
  const cart = normalizeDmCart({
    entries: [
      {
        quantity: 3,
        product: { gtin: '111', name: 'Shampoo' },
        totalPrice: { value: 8.97 },
      },
    ],
    totalPrice: { value: 8.97 },
  });
  assert.equal(cart.totalCents, 897);
  assert.equal(cart.lines[0]!.unitPriceCents, 299);
});
