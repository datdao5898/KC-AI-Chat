const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');

// Real pipeline on an in-memory Postgres with a scripted model, so the order of the
// translate / answer / translate-back steps is what gets tested.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test@localhost/test';
process.env.AI_TRACE_LOG = 'false';
process.env.REPLY_JUDGE_ENABLED = 'false';
const memoryDb = newDb();
memoryDb.public.registerFunction({
  name: 'nullif',
  args: [DataType.text, DataType.text],
  returns: DataType.text,
  implementation: (value, other) => (value === other ? null : value)
});
require.cache[require.resolve('pg')] = { exports: memoryDb.adapters.createPg() };
require.cache[require.resolve('../src/staffAlert')] = {
  exports: { notifyStaff: async () => {}, notifyNewMessage: async () => {} }
};

const llmClient = require('../src/llmClient');
const modelCalls = [];
let answers = {};
llmClient.chatCompletion = async request => {
  const content = request.messages.map(message => message.content).join('\n');
  const step = content.includes('prepare a shop customer')
    ? 'understand'
    : content.includes("Translate a shop's Vietnamese reply") ? 'translate' : 'answer';
  modelCalls.push({ step, content });
  return answers[step];
};

const dbModule = require('../src/db');
const { processIncoming } = require('../src/messagePipeline');

let nextId = 0;
async function send(text) {
  modelCalls.length = 0;
  const sent = [];
  nextId += 1;
  const result = await processIncoming({
    channel: 'haravan_website',
    externalUserId: `foreign-visitor-${nextId}`,
    text,
    externalMessageId: `foreign-${nextId}`,
    raw: { siteName: 'kingcom' },
    testMode: true,
    sendFn: async (user, reply) => { sent.push(reply); return {}; }
  });
  return { result, sent };
}

test('a foreign question is answered from the FAQ in Vietnamese, then translated back', async () => {
  await dbModule.initDb();
  answers = {
    understand: '{"language":"en","vietnamese":"Chủ nhật cửa hàng có làm việc không?"}',
    translate: 'Hotlines: 0903 898 478, 070 447 1438. Open 08:30 – 17:30, Monday to Saturday. Lunch break 12:00 – 13:00.'
  };
  const { result, sent } = await send('are you open on sundays?');

  assert.deepEqual(sent, ['Hotlines: 0903 898 478, 070 447 1438. Open 08:30 – 17:30, Monday to Saturday. Lunch break 12:00 – 13:00.']);
  assert.match(modelCalls.at(-1).content, /Giờ làm việc: 8h30/, 'the Vietnamese reply quotes the FAQ');
  assert.equal(result.debug.customerLanguage, 'en');
  assert.equal(result.debug.vietnameseText, 'Chủ nhật cửa hàng có làm việc không?');
  assert.equal(modelCalls[0].step, 'understand');
  assert.equal(modelCalls.at(-1).step, 'translate');
  assert.match(modelCalls.at(-1).content, /are you open on sundays\?/);
});

test('a general question reaches the model with the FAQ instead of a canned clarifying question', async () => {
  answers = {
    understand: '{"language":"en","vietnamese":"Chủ nhật có ai trực không?"}',
    answer: 'Dạ, cửa hàng làm việc từ Thứ 2 đến Thứ 7 ạ.',
    translate: 'We work Monday to Saturday.'
  };
  const { result, sent } = await send('anyone working on sunday?');

  const answerCall = modelCalls.find(call => call.step === 'answer');
  assert.ok(answerCall, 'the model writes the answer');
  assert.match(answerCall.content, /8h30/, 'the FAQ is in the prompt');
  assert.equal(result.debug.aiSource, 'provider');
  assert.deepEqual(sent, ['We work Monday to Saturday.']);
});

test('a Vietnamese customer gets no translation step', async () => {
  answers = { understand: '{"language":"vi","vietnamese":""}', answer: 'Dạ, cửa hàng làm việc từ Thứ 2 đến Thứ 7 ạ.' };
  const { sent } = await send('chu nhat co ai truc khong');

  assert.equal(modelCalls.filter(call => call.step === 'translate').length, 0);
  assert.deepEqual(sent, ['Dạ, cửa hàng làm việc từ Thứ 2 đến Thứ 7 ạ.']);
});

test('a translation that changes the hotline is not sent', async () => {
  answers = {
    understand: '{"language":"en","vietnamese":"cho xin hotline"}',
    translate: 'Our hotline is 1900 1234.'
  };
  const { result, sent } = await send('give me your hotline');

  assert.doesNotMatch(sent[0], /1900 1234/);
  assert.match(sent[0], /0903 898 478/);
  assert.match(result.debug.translationError, /changed/);
});
