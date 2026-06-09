const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, queryWords, parsePriceNumber, searchProducts } = require('../src/rag');

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
