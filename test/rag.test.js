const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, queryWords, parsePriceNumber, searchProducts, buildContext } = require('../src/rag');

test('normalize strips accents and punctuation', () => {
  assert.equal(normalize('Đèn LED Ulanzi!'), 'den led ulanzi');
});

test('queryWords removes stopwords', () => {
  const words = queryWords('anh can tim tripod ulanzi cho dien thoai');
  assert.ok(words.includes('tripod'));
  assert.ok(words.includes('ulanzi'));
  assert.ok(!words.includes('anh'));
});

test('parsePriceNumber reads numeric price text', () => {
  assert.equal(parsePriceNumber('1.390.000đ'), 1390000);
});

test('landscape lens search excludes phone lenses and lens accessories', () => {
  const products = searchProducts(
    'can tu van lens chup phong canh gia duoi 9tr',
    5,
    { sourceKey: 'website/kingcom' }
  );

  assert.ok(products.length > 0);
  assert.ok(products.every(product => parsePriceNumber(product.price) < 9000000));
  assert.ok(products.every(product => !/\b(smartphone|dien thoai|khan|adapter|gia do|support)\b/i.test(normalize(product.name))));
  assert.ok(products.some(product => /\b(viltrox|ong kinh)\b/i.test(normalize(product.name))));
});

test('product specification context includes the matched catalog description', () => {
  const result = buildContext(
    'thong so Cadothy AMAZE 5Pro',
    {
      sourceKey: 'website/newlite',
      topK: 1,
      includeDescriptions: true,
      requireIdentityMatch: true
    }
  );

  assert.equal(result.products.length, 1);
  assert.match(result.products[0].name, /Cadothy AMAZE 5Pro/i);
  assert.match(result.context, /Mo ta va thong so tu catalog:/);
  assert.match(result.context, /\bRAM\b|\bRam\b/);
});

test('product URL retrieves the exact catalog product', () => {
  const products = searchProducts(
    'https://newlite.vn/products/may-tao-khoi-cam-tay-lensgo-smoke-b',
    1,
    { sourceKey: 'website/newlite', requireIdentityMatch: true }
  );

  assert.equal(products[0]?.sku, 'XLS1');
});
