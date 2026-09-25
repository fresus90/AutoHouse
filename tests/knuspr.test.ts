/**
 * Prueft die Auswertung der Knuspr-Antworten gegen eine echte Antwort aus
 * den Entwicklerwerkzeugen – gekuerzt, aber in Struktur und Zahlen unveraendert.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractKnusprProducts, normalizeKnusprCart } from '../src/automation/drivers/knuspr.driver.ts';

/** Echte Antwort des Warenkorb-Endpunkts (Auszug). */
const CART_RESPONSE = {
  status: 200,
  messages: [],
  data: {
    cartId: 56628274,
    totalPrice: 2.69,
    totalSavings: 0,
    minimalStandardOrderPrice: 39.0,
    minimalDeliveryPointOrderPrice: 39.0,
    submitConditionPassed: false,
    items: {
      '1': {
        productId: 1,
        orderFieldId: 270144576,
        imgPath: '/images/grocery/products/1/1-1701242956132.jpg',
        productName: 'Avocado Hass, essreif, 1 Stk.',
        baseLink: '1-avocado-hass-essreif-1-stk',
        quantity: 1,
        unit: 'piece',
        maxBasketAmount: 50,
        maxBasketAmountReason: 'ALLOWED',
        originalPricePerUnit: 2.69,
        price: 2.69,
        currency: 'EUR',
        textualAmount: '1 Stk',
        brand: 'Struwwelpeter',
      },
    },
    minimalOrderPrice: 39.0,
  },
};

test('Warenkorb wird aus der verpackten Antwort gelesen', () => {
  const cart = normalizeKnusprCart(CART_RESPONSE);
  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0]!.externalId, '1');
  assert.equal(cart.lines[0]!.label, 'Avocado Hass, essreif, 1 Stk.');
  assert.equal(cart.lines[0]!.quantity, 1);
  assert.equal(cart.lines[0]!.unitPriceCents, 269);
  assert.equal(cart.totalCents, 269);
});

test('Mindestbestellwert von 39 Euro wird nicht zu 39 Cent', () => {
  // Der springende Punkt: JSON liefert 39.00 als ganze Zahl 39. Wuerde das
  // als Cent gelesen, waere der Mindestbestellwert immer erreicht.
  const cart = normalizeKnusprCart(CART_RESPONSE);
  assert.equal(cart.minimumOrderCents, 3900);
});

test('mehrere Positionen summieren sich korrekt', () => {
  const cart = normalizeKnusprCart({
    data: {
      totalPrice: 12.45,
      minimalOrderPrice: 39,
      items: {
        '1': { productId: 1, productName: 'Avocado', quantity: 3, price: 2.69 },
        '77': { productId: 77, productName: 'Vollmilch', quantity: 2, price: 1.19 },
      },
    },
  });
  assert.equal(cart.lines.length, 2);
  const avocado = cart.lines.find((line) => line.externalId === '1')!;
  assert.equal(avocado.unitPriceCents, 269);
  assert.equal(avocado.totalCents, 807, '3 x 2,69 €');
  // Die Summe kommt vom Shop, nicht aus der eigenen Rechnung.
  assert.equal(cart.totalCents, 1245);
});

test('leerer Warenkorb und Unsinn ergeben keine Ausnahme', () => {
  assert.deepEqual(normalizeKnusprCart({ data: { totalPrice: 0, items: {} } }).lines, []);
  assert.equal(normalizeKnusprCart(null).totalCents, 0);
  assert.equal(normalizeKnusprCart({ status: 500 }).totalCents, 0);
});

test('Produkte werden aus derselben Struktur gelesen', () => {
  const products = extractKnusprProducts(CART_RESPONSE);
  assert.equal(products.length, 1);
  const product = products[0]!;
  assert.equal(product.externalId, '1');
  assert.equal(product.name, 'Avocado Hass, essreif, 1 Stk.');
  assert.equal(product.brand, 'Struwwelpeter');
  assert.equal(product.grammage, '1 Stk');
  assert.equal(product.priceCents, 269);
  assert.equal(product.productUrl, 'https://www.knuspr.de/1-avocado-hass-essreif-1-stk');
  assert.match(product.imageUrl ?? '', /^https:\/\/cdn\.knuspr\.de\/images\//);
  assert.equal(product.available, true);
});

test('nicht bestellbare Artikel werden als nicht verfuegbar gefuehrt', () => {
  const products = extractKnusprProducts({
    data: {
      products: [
        { productId: 9, productName: 'Ausverkauft', price: 1.0, maxBasketAmountReason: 'NOT_ALLOWED' },
      ],
    },
  });
  assert.equal(products[0]!.available, false);
});
