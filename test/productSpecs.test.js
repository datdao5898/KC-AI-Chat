const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isProductSpecsRequest,
  buildSearchQuery,
  buildProductSpecsFallbackReply,
  catalogHasClearSpecs,
  extractCatalogSpecFacts,
  buildProductSpecsEvidenceReply,
  generateReply
} = require('../src/ai');
const { searchProducts } = require('../src/rag');

test('product specification follow-up keeps the previously requested model', () => {
  const userText = 'g\u1eedi tr\u1ef1c ti\u1ebfp qua \u0111\u00e2y nh\u00e9';
  const history = [
    {
      sender_type: 'customer',
      text: 'g\u1eedi cho m\u00ecnh th\u00f4ng s\u1ed1 c\u1ee7a Cadothy AMAZE 5Pro'
    },
    {
      sender_type: 'ai',
      text: 'Anh/ch\u1ecb c\u1ea7n th\u00f4ng s\u1ed1 k\u1ef9 thu\u1eadt chi ti\u1ebft h\u01a1n kh\u00f4ng \u1ea1?'
    },
    { sender_type: 'customer', text: userText }
  ];

  assert.equal(isProductSpecsRequest(userText, history), true);
  assert.match(buildSearchQuery(userText, history, {}), /Cadothy AMAZE 5Pro/i);
  assert.equal(isProductSpecsRequest('g\u1eedi link s\u1ea3n ph\u1ea9m', history), false);
});

test('product specification fallback uses description from the matching product', () => {
  const products = searchProducts(
    'thong so Cadothy AMAZE 5Pro',
    1,
    { sourceKey: 'website/newlite', requireIdentityMatch: true }
  );
  const reply = buildProductSpecsFallbackReply(products, 'vi');

  assert.match(reply, /Cadothy AMAZE 5Pro/i);
  assert.match(reply, /camera/i);
  assert.match(reply, /newlite\.vn\/products\/cadothy-amaze-5pro/i);
});

test('a newly named product does not inherit the previous product context', () => {
  const userText = 'M\u00e1y T\u1ea1o Kh\u00f3i C\u1ea7m Tay Lensgo Smoke B th\u00f4ng s\u1ed1 v\u00e0 h\u01b0\u1edbng d\u1eabn s\u1eed d\u1ee5ng';
  const history = [
    {
      sender_type: 'customer',
      text: 'g\u1eedi cho m\u00ecnh th\u00f4ng s\u1ed1 c\u1ee7a Cadothy AMAZE 5Pro'
    },
    {
      sender_type: 'ai',
      text: 'D\u1ea1, em g\u1eedi anh/ch\u1ecb th\u00f4ng s\u1ed1 Cadothy AMAZE 5Pro.'
    },
    { sender_type: 'customer', text: userText }
  ];
  const query = buildSearchQuery(userText, history, {});
  const products = searchProducts(
    query,
    1,
    { sourceKey: 'website/newlite', requireIdentityMatch: true }
  );

  assert.doesNotMatch(query, /Cadothy/i);
  assert.match(query, /Lensgo Smoke B/i);
  assert.equal(products[0]?.sku, 'XLS1');
});

test('a contextual follow-up uses only the latest explicitly named product', () => {
  const userText = 'g\u1eedi tr\u1ef1c ti\u1ebfp qua \u0111\u00e2y nh\u00e9';
  const history = [
    { sender_type: 'customer', text: 'th\u00f4ng s\u1ed1 Cadothy AMAZE 5Pro' },
    { sender_type: 'ai', text: 'Th\u00f4ng s\u1ed1 Cadothy.' },
    { sender_type: 'customer', text: 'th\u00f4ng s\u1ed1 Lensgo Smoke B' },
    { sender_type: 'ai', text: 'Anh/ch\u1ecb mu\u1ed1n em g\u1eedi chi ti\u1ebft qua \u0111\u00e2y kh\u00f4ng?' },
    { sender_type: 'customer', text: userText }
  ];
  const query = buildSearchQuery(userText, history, {});

  assert.match(query, /Lensgo Smoke B/i);
  assert.doesNotMatch(query, /Cadothy/i);
});

test('catalogHasClearSpecs detects whether the catalog already states specs clearly', () => {
  assert.equal(catalogHasClearSpecs({
    description: 'Compact creator accessory with clean marketing copy only.'
  }), false);

  assert.equal(catalogHasClearSpecs({
    description: 'Sensor 24MP, weight 280g, battery 1200mAh, dimensions 120 x 80 x 55 mm, USB-C charging.'
  }), true);
});

test('catalog evidence extracts the requested Ulanzi MT85 height from KingCom catalog', () => {
  const product = searchProducts(
    'Ulanzi MT85 cao bao nhieu m',
    1,
    { sourceKey: 'website/kingcom', requireIdentityMatch: true }
  )[0];
  const facts = extractCatalogSpecFacts(product, 'Ulanzi MT85 cao bao nhi\u00eau m');
  const reply = buildProductSpecsEvidenceReply([product], 'Ulanzi MT85 cao bao nhi\u00eau m', 'vi');

  assert.equal(product?.sku, 'FUCB8A');
  assert.ok(facts.some(fact => /Chi/i.test(fact.label) && /1\.5m|150cm/i.test(fact.value)));
  assert.match(reply, /1\.5m|150cm/);
  assert.match(reply, /ulanzi-mt85-automatic-pop-up-phone-tripod-magsafe/);
});

test('generateReply answers Ulanzi MT85 height directly from catalog evidence', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'Ulanzi MT85 cao bao nhi\u00eau m',
    history: [],
    customer: {},
    intent: 'product_specs',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'direct_catalog_product_specs');
  assert.match(result.reply, /1\.5m|150cm/);
  assert.equal(result.ragProducts[0]?.sku, 'FUCB8A');
});

test('NewLite missing Ulanzi MT85 keeps source isolation and clean product label', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'Th\u00f4ng s\u1ed1 c\u1ee7a Ulanzi MT85 l\u00e0 g\u00ec?',
    history: [],
    customer: {},
    intent: 'product_specs',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule_no_catalog_match');
  assert.match(result.reply, /Ulanzi MT85/i);
  assert.doesNotMatch(result.reply, /so cua/i);
});
