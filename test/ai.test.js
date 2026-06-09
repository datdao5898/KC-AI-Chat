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
