const test = require('node:test');
const assert = require('node:assert/strict');
const { generateReply } = require('../src/ai');

test('generateReply answers VAT policy without product clarification or links', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'gi\u00e1 s\u1ea3n ph\u1ea9m tr\u00ean web bao g\u1ed3m vat ch\u01b0a \u1ea1',
    history: [],
    customer: { phone: '0944190237' },
    intent: 'price',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website',
    conversationContext: {
      needs_clarification: true,
      clarification_options: [
        { current_product_name: 'M705BSWH Carbon fiber - Miliboo Monopod' },
        { current_product_name: 'ULANZI MT-39 Tripod' }
      ]
    }
  });

  assert.equal(result.aiSource, 'rule_policy');
  assert.equal(result.ragProducts.length, 0);
  assert.match(result.reply, /VAT/);
  assert.match(result.reply, /\u0111\u00e3 bao g\u1ed3m VAT/i);
  assert.doesNotMatch(result.reply, /Miliboo|ULANZI|https?:\/\//i);
});
