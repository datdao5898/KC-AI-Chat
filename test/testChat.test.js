const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');

// Run the real pipeline against an in-memory Postgres; replies used here come from
// deterministic rules, so no model call is made.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test@localhost/test';
process.env.REPLY_JUDGE_ENABLED = 'false';
process.env.LARK_ALERT_ENABLED = 'false';
process.env.AI_TRACE_LOG = 'false';
const memoryDb = newDb();
memoryDb.public.registerFunction({
  name: 'nullif',
  args: [DataType.text, DataType.text],
  returns: DataType.text,
  implementation: (value, other) => (value === other ? null : value)
});
require.cache[require.resolve('pg')] = { exports: memoryDb.adapters.createPg() };

const dbModule = require('../src/db');
const { processIncoming } = require('../src/messagePipeline');

test('admin test chat runs the pipeline but stays hidden and never alerts staff', async () => {
  await dbModule.initDb();
  const result = await processIncoming({
    channel: 'haravan_website',
    externalUserId: 'admin-test-session-0001',
    text: 'bảo hành bao lâu shop',
    externalMessageId: 'admin-test-1',
    raw: { siteName: 'newlite', adminTest: true },
    sendFn: null,
    testMode: true
  });

  assert.equal(result.debug.sourceKey, 'website/newlite');
  assert.equal(result.debug.aiSource, 'rule_policy');
  assert.equal(result.debug.wouldAlertStaff, true);
  assert.match(result.reply, /chưa có thông tin về bảo hành/);

  // Same filter as listConversations/getStats (pg-mem cannot run their correlated subqueries).
  const flagged = await dbModule.db.query('SELECT COUNT(*)::int AS count FROM conversations WHERE is_test=1');
  assert.equal(flagged.rows[0].count, 1);
  const visible = await dbModule.db.query('SELECT COUNT(*)::int AS count FROM conversations WHERE deleted_at IS NULL AND COALESCE(is_test, 0)=0');
  assert.equal(visible.rows[0].count, 0);
  const handoff = await dbModule.db.query('SELECT COUNT(*)::int AS count FROM conversations WHERE needs_human=1');
  assert.equal(handoff.rows[0].count, 0);
  const alerts = await dbModule.db.query('SELECT COUNT(*)::int AS count FROM staff_alerts');
  // flagHandoff and notifyStaff share one guard: no alert row means nothing was sent.
  assert.equal(alerts.rows[0].count, 0);

  const removed = await dbModule.deleteTestConversations();
  assert.equal(removed.deleted, 1);
  const left = await dbModule.db.query('SELECT COUNT(*)::int AS count FROM conversations');
  assert.equal(left.rows[0].count, 0);
});
