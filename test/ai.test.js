const test = require('node:test');
const assert = require('node:assert/strict');
const { generateReply } = require('../src/ai');

test('generateReply answers landscape lens starting price from catalog', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'vay lens phong canh co gia tu bao nhieu shop',
    history: [],
    customer: {},
    intent: 'price',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'direct_starting_price_lookup');
  assert.match(result.reply, /2\.290\.000/);
  assert.ok(result.ragProducts.length > 0);
});

test('generateReply uses NewLite identity for NewLite website rules', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'shop ban nhung san pham nao',
    history: [],
    customer: {},
    intent: 'catalog_info',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.match(result.reply, /NewLite/);
  assert.doesNotMatch(result.reply, /\bKingCom\b/);
});

test('generateReply uses configured Facebook brand identity', async () => {
  const result = await generateReply({
    channel: 'facebook',
    userText: 'shop ban nhung san pham nao',
    history: [],
    customer: {},
    intent: 'catalog_info',
    sourceKey: 'facebook/260016447958834',
    sourceName: 'AI Agent Seting Up',
    sourceGroup: 'facebook'
  });

  assert.match(result.reply, /Viltrox/);
  assert.doesNotMatch(result.reply, /\bKingCom\b/);
});

test('generateReply answers NewLite store address from source FAQ', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'địa chỉ cửa hàng ở đâu vậy ạ',
    history: [],
    customer: {},
    intent: 'store_info',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule_source_store_info');
  assert.match(result.reply, /NewLite/);
  assert.match(result.reply, /65 Nguyen Minh Hoang/);
  assert.match(result.reply, /96-96B Nguyen Huy Tuong/);
  assert.doesNotMatch(result.reply, /phường Bảy Hiền/i);
});
