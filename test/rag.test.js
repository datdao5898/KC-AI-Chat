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

test('product URL matches by slug across KingCom and NewLite domains', () => {
  const products = searchProducts(
    'https://newlite.vn/products/boya-by-m100ua-mic-thu-am-danh-cho-may-tinh-win-mac',
    1,
    { sourceKey: 'website/kingcom', requireIdentityMatch: true }
  );

  assert.equal(products[0]?.sku, 'FB334');
  assert.match(products[0]?.url || '', /store\.kingcom\.com\.vn/);
});

test('full product name outranks accessory products with overlapping words', () => {
  const products = searchProducts(
    'May Tao Khoi Cam Tay Lensgo Smoke B thong so',
    3,
    { sourceKey: 'website/newlite', requireIdentityMatch: true }
  );

  assert.equal(products[0]?.sku, 'XLS1');
  assert.match(products[0]?.name || '', /Lensgo Smoke B/i);
  assert.doesNotMatch(normalize(products[0]?.name || ''), /\b(dung dich|binh chua)\b/i);
});

test('same query stays isolated by website source products', () => {
  const kingcomProducts = searchProducts(
    'boya mini',
    1,
    { sourceKey: 'website/kingcom', requireIdentityMatch: true }
  );
  const newliteProducts = searchProducts(
    'boya mini',
    1,
    { sourceKey: 'website/newlite', requireIdentityMatch: true }
  );

  assert.equal(kingcomProducts[0]?.sku, 'FB153');
  assert.equal(newliteProducts[0]?.sku, 'FB127');
  assert.notEqual(kingcomProducts[0]?.url, newliteProducts[0]?.url);
});

test('strict brand fanpages do not return products from another brand', () => {
  const syncoPageProducts = searchProducts(
    'ulanzi tripod',
    3,
    { sourceKey: 'facebook/1184640711390003', requireIdentityMatch: true }
  );
  const viltroxPageProducts = searchProducts(
    'synco mic',
    3,
    { sourceKey: 'facebook/260016447958834', requireIdentityMatch: true }
  );

  assert.deepEqual(syncoPageProducts, []);
  assert.deepEqual(viltroxPageProducts, []);
});
