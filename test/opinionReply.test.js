const test = require('node:test');
const assert = require('node:assert/strict');

// "Is X good?" goes to the model with the products the catalog search found.
process.env.AI_TRACE_LOG = 'false';
const llmClient = require('../src/llmClient');
const prompts = [];
const MODEL_REPLY = 'Dạ đây là nhận xét của em về sản phẩm ạ.';
llmClient.chatCompletion = async request => {
  prompts.push(request.messages.map(message => message.content).join('\n'));
  return MODEL_REPLY;
};
const { generateReply } = require('../src/ai');

const ASK = {
  channel: 'haravan_website',
  history: [],
  customer: {},
  intent: 'product_search',
  sourceKey: 'website/kingcom',
  sourceName: 'KingCom',
  sourceGroup: 'website'
};

test('"is <brand> good" is answered by the model with that brand\'s products', async () => {
  prompts.length = 0;
  const result = await generateReply({ ...ASK, userText: 'Sản phẩm nanlite có tốt không' });

  assert.ok(result.reply.startsWith(MODEL_REPLY), result.reply);
  assert.equal(result.aiUsed, 1);
  const names = (result.ragProducts || []).map(product => product.name || '');
  assert.ok(names.length, 'products were found');
  assert.ok(names.every(name => /nanlite/i.test(name)), `only Nanlite products: ${names.join(' | ')}`);
  assert.doesNotMatch(names.join(' '), /SK-21/, 'a size like 80cm must not pull in a 180cm tripod');
});

test('"is <model> good" gives the model that product', async () => {
  const result = await generateReply({
    ...ASK,
    userText: 'ulanzi mt85 nghe on khong',
    conversationContext: {
      current_product_name: 'Gay Selfie Tripod MagSafe Ulanzi MT85 Tu Dong Bung Chan',
      current_product_sku: 'FUCB8A',
      requested_category: 'tripod',
      context_confidence: 0.9
    }
  });

  assert.ok(result.reply.startsWith(MODEL_REPLY), result.reply);
  assert.ok((result.ragProducts || []).some(product => /mt85/i.test(product.name || '')));
});

test('the model is told to answer "is X good" directly with what X is good for, from catalog data', async () => {
  prompts.length = 0;
  await generateReply({ ...ASK, userText: 'nanlite có tốt không' });
  const prompt = prompts.find(text => text.includes('Khach hoi san pham/thuong hieu co tot khong'));
  assert.ok(prompt, 'the opinion instruction is in the prompt');
  assert.match(prompt, /la lua chon tot cho/);
  assert.match(prompt, /Khong neu giai thuong, so lieu, so sanh voi hang khac/);
});
