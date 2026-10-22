const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');

// Real pipeline on an in-memory Postgres, with staff notifications captured.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test@localhost/test';
process.env.AI_TRACE_LOG = 'false';
const memoryDb = newDb();
memoryDb.public.registerFunction({
  name: 'nullif',
  args: [DataType.text, DataType.text],
  returns: DataType.text,
  implementation: (value, other) => (value === other ? null : value)
});
require.cache[require.resolve('pg')] = { exports: memoryDb.adapters.createPg() };
const notifications = [];
require.cache[require.resolve('../src/staffAlert')] = {
  exports: { notifyStaff: async (alertId, payload) => { notifications.push(payload); }, notifyWebsiteMessage: async () => {} }
};

const dbModule = require('../src/db');
const { saveReplySchedule } = require('../src/replySchedule');
const { processIncoming } = require('../src/messagePipeline');

const ALWAYS_STAFF = { start: '00:00', end: '23:59' };

function message(text, id) {
  return processIncoming({
    channel: 'haravan_website',
    externalUserId: 'schedule-visitor-1',
    text,
    externalMessageId: `schedule-${id}`,
    raw: { siteName: 'kingcom' },
    sendFn: null
  });
}

test('during staff hours the AI stays silent and staff are notified once per conversation', async () => {
  await dbModule.initDb();
  await saveReplySchedule({
    enabled: true,
    notifyStaff: true,
    staffHours: { mon: ALWAYS_STAFF, tue: ALWAYS_STAFF, wed: ALWAYS_STAFF, thu: ALWAYS_STAFF, fri: ALWAYS_STAFF, sat: ALWAYS_STAFF, sun: ALWAYS_STAFF }
  });

  const first = await message('Hotline', 1);
  assert.equal(first.skipped, 'staff_hours');
  assert.equal(first.reply, undefined);

  const second = await message('bảo hành bao lâu', 2);
  assert.equal(second.skipped, 'staff_hours');
  assert.equal(notifications.length, 1, 'one notification per conversation');

  const conversation = await dbModule.db.query('SELECT needs_human, handoff_status FROM conversations');
  assert.equal(conversation.rows[0].needs_human, 1);
  assert.equal(conversation.rows[0].handoff_status, 'open');

  // Staff picked it up: further messages are not re-notified.
  await dbModule.db.query("UPDATE conversations SET handoff_status='in_progress'");
  await message('ok cảm ơn', 3);
  assert.equal(notifications.length, 1);
  const status = await dbModule.db.query('SELECT handoff_status FROM conversations');
  assert.equal(status.rows[0].handoff_status, 'in_progress');
});

test('outside staff hours the AI replies as usual', async () => {
  await saveReplySchedule({ enabled: true, staffHours: {} });
  const result = await processIncoming({
    channel: 'haravan_website',
    externalUserId: 'schedule-visitor-2',
    text: 'Hotline',
    externalMessageId: 'schedule-outside-1',
    raw: { siteName: 'kingcom' },
    sendFn: null
  });
  assert.equal(result.skipped, undefined);
  assert.match(result.reply, /0903 898 478/);
});
