const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');

// Real db/pipeline on an in-memory Postgres; Zalo's HTTP API and Lark are stubbed.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test@localhost/test';
process.env.AI_TRACE_LOG = 'false';
process.env.ZALO_OA_ACCESS_TOKEN = 'test-token';
process.env.ZALO_OA_ECHO_WAIT_MS = '0';
process.env.HUMAN_REPLY_DELAY_ENABLED = 'false';
const memoryDb = newDb();
memoryDb.public.registerFunction({
  name: 'nullif',
  args: [DataType.text, DataType.text],
  returns: DataType.text,
  implementation: (value, other) => (value === other ? null : value)
});
require.cache[require.resolve('pg')] = { exports: memoryDb.adapters.createPg() };
const newMessages = [];
require.cache[require.resolve('../src/staffAlert')] = {
  exports: { notifyStaff: async () => {}, notifyNewMessage: async payload => { newMessages.push(payload); } }
};

const zaloApi = { history: [], sent: [] };
async function fakeAxios(request) {
  if (request.url.endsWith('/v2.0/oa/conversation')) {
    const { offset, count } = JSON.parse(request.params.data);
    return { data: { error: 0, data: zaloApi.history.slice(offset, offset + count) } };
  }
  if (request.url.endsWith('/v3.0/oa/message/cs')) {
    zaloApi.sent.push(request.data.message.text);
    return { data: { error: 0, data: { message_id: `ai-${zaloApi.sent.length}` } } };
  }
  return { data: { error: 0, data: {} } };
}
require.cache[require.resolve('axios')] = { exports: fakeAxios };

const dbModule = require('../src/db');
const { importZaloHistory, recordZaloStaffMessage, sendZaloMessage } = require('../src/channels/zalo');
const { processIncoming } = require('../src/messagePipeline');

const OA = 'oa-1';
const minutesAgo = minutes => Date.now() - minutes * 60 * 1000;

async function messagesOf(userId) {
  const { rows } = await dbModule.db.query(`
    SELECT m.sender_type, m.text, m.external_message_id FROM messages m
    JOIN customers cu ON cu.id = m.customer_id
    WHERE cu.channel='zalo' AND cu.external_id=$1
    ORDER BY m.created_at, m.id
  `, [userId]);
  return rows;
}

test('first contact imports the recent Zalo chat oldest first, once', async () => {
  await dbModule.initDb();
  // Zalo returns newest first; src 1 = from the customer, 0 = from the OA.
  zaloApi.history = [
    { message_id: 'current', src: 1, type: 'text', message: 'Còn hàng không?', time: minutesAgo(0) },
    { message_id: 'h3', src: 0, type: 'text', message: 'Dạ mẫu này giá 1.200.000đ ạ', time: minutesAgo(50) },
    { message_id: 'h2', src: 1, type: 'photo', message: '', time: minutesAgo(55) },
    { message_id: 'h1', src: 1, type: 'text', message: 'Shop ơi', time: minutesAgo(60) }
  ];

  const result = await importZaloHistory({ userId: 'user-a', oaId: OA, excludeMessageId: 'current', before: Date.now() });
  assert.equal(result.imported, 3);
  assert.deepEqual(await messagesOf('user-a'), [
    { sender_type: 'customer', text: 'Shop ơi', external_message_id: 'h1' },
    { sender_type: 'customer', text: '[Hình ảnh]', external_message_id: 'h2' },
    { sender_type: 'staff', text: 'Dạ mẫu này giá 1.200.000đ ạ', external_message_id: 'h3' }
  ]);

  const again = await importZaloHistory({ userId: 'user-a', oaId: OA, excludeMessageId: 'current' });
  assert.equal(again.skipped, 'has_messages');
});

test('staff replies typed in the OA inbox are recorded, the AI echoes are not', async () => {
  zaloApi.history = [];
  await sendZaloMessage('user-b', 'Dạ em chào anh', { raw: { recipient: { id: OA } } });

  const echo = await recordZaloStaffMessage({ userId: 'user-b', oaId: OA, messageId: 'ai-1', text: 'Dạ em chào anh', time: Date.now() });
  assert.equal(echo.skipped, 'ai_message');

  const staff = await recordZaloStaffMessage({ userId: 'user-b', oaId: OA, messageId: 'staff-1', text: 'Anh để lại SĐT em gọi lại nhé', time: Date.now() });
  assert.ok(staff.saved);
  assert.deepEqual((await messagesOf('user-b')).map(row => [row.sender_type, row.text]), [
    ['staff', 'Anh để lại SĐT em gọi lại nhé']
  ]);
});

test('the AI stays silent while staff are chatting and only alerts Lark', async () => {
  const sentBefore = zaloApi.sent.length;
  const result = await processIncoming({
    channel: 'zalo',
    externalUserId: 'user-b',
    text: 'Hotline',
    externalMessageId: 'cust-b-1',
    raw: { recipient: { id: OA } },
    sendFn: sendZaloMessage
  });
  assert.equal(result.skipped, 'staff_active');
  assert.equal(zaloApi.sent.length, sentBefore, 'nothing sent to the customer');
  assert.match(newMessages.at(-1).status, /Staff replied in the last 30 minutes/);
});

test('the AI answers again once staff have been quiet for the pause window', async () => {
  await recordZaloStaffMessage({ userId: 'user-c', oaId: OA, messageId: 'staff-c', text: 'Dạ vâng', time: minutesAgo(45) });
  const result = await processIncoming({
    channel: 'zalo',
    externalUserId: 'user-c',
    text: 'Hotline',
    externalMessageId: 'cust-c-1',
    raw: { recipient: { id: OA } },
    sendFn: sendZaloMessage
  });
  assert.equal(result.skipped, undefined);
  assert.equal(result.deliveryStatus, 'sent');
  assert.equal(zaloApi.sent.at(-1), result.reply);
});
