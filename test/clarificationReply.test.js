const test = require('node:test');
const assert = require('node:assert/strict');

// When the product match is unsure, the model reads the message and writes the reply;
// the fixed "which model do you mean" text is only a fallback when the model is down.
process.env.AI_TRACE_LOG = 'false';
const llmClient = require('../src/llmClient');
const prompts = [];
let modelReply = 'Dạ KingCom làm việc theo giờ trong FAQ ạ.';
let modelDown = false;
llmClient.chatCompletion = async request => {
  prompts.push(request.messages.map(message => message.content).join('\n'));
  if (modelDown) throw new Error('model unavailable');
  return modelReply;
};
const { generateReply } = require('../src/ai');

const ASK = {
  history: [],
  channel: 'website',
  sourceKey: 'website/kingcom',
  sourceGroup: 'website'
};

test('an hours question labelled as a product question is answered by the model, not a fixed template', async () => {
  for (const intent of ['product_specs', 'price']) {
    prompts.length = 0;
    const result = await generateReply({ ...ASK, userText: 'thời gian làm việc', intent });
    assert.equal(result.reply, modelReply, intent);
    assert.equal(result.aiUsed, 1, intent);
    assert.doesNotMatch(result.reply, /xác nhận giúp em đúng model/, intent);
  }
});

test('an unsure product match goes to the model with the candidates and the instruction to read the message', async () => {
  prompts.length = 0;
  modelReply = 'Dạ anh/chị đang hỏi mẫu Ulanzi nào ạ?';
  const result = await generateReply({ ...ASK, userText: 'giá ulanzi', intent: 'price' });
  assert.equal(result.aiSource, 'provider_clarification');
  assert.equal(result.reply, modelReply);
  const prompt = prompts.find(text => text.includes('Hệ thống tìm sản phẩm chưa chắc'));
  assert.ok(prompt, 'the clarification prompt was sent');
  assert.match(prompt, /Nếu khách không hỏi về sản phẩm/);
  assert.match(prompt, /Tin nhắn mới nhất của khách: giá ulanzi/);
});

test('a model reply with a link that is not one of the candidates is replaced by the fixed text', async () => {
  modelReply = 'Dạ anh/chị xem mẫu này https://example.com/fake ạ';
  try {
    const result = await generateReply({ ...ASK, userText: 'giá ulanzi', intent: 'price' });
    assert.doesNotMatch(result.reply, /example\.com/);
  } finally {
    modelReply = 'Dạ KingCom làm việc theo giờ trong FAQ ạ.';
  }
});

test('when the model is down an unsure match still gets the fixed clarification', async () => {
  modelDown = true;
  try {
    const result = await generateReply({ ...ASK, userText: 'giá ulanzi', intent: 'price' });
    assert.match(result.aiSource, /^rule_/);
    assert.match(result.reply, /^Dạ/);
  } finally {
    modelDown = false;
  }
});
