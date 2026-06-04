require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const Database = require('better-sqlite3');
const { newDb, DataType } = require('pg-mem');

process.env.DATABASE_URL = 'postgresql://smoke:smoke@localhost/smoke';
const memory = newDb();
memory.public.registerFunction({
  name: 'nullif',
  args: [DataType.text, DataType.text],
  returns: DataType.text,
  implementation: (left, right) => left === right ? null : left
});
const pg = memory.adapters.createPg();
require.cache[require.resolve('pg')] = {
  id: require.resolve('pg'),
  filename: require.resolve('pg'),
  loaded: true,
  exports: pg
};

const runtime = require('../src/db');
const { migrateSqliteToPostgres } = require('./migrate-sqlite-to-postgres');
const sqlitePath = path.join(__dirname, '..', 'kingcom_ai_agent.db');

function sqliteCount(sqlite, table) {
  return sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

async function main() {
  const sqlite = new Database(sqlitePath, { readonly: true });
  const expected = {
    customers: sqliteCount(sqlite, 'customers'),
    conversations: sqlite.prepare('SELECT COUNT(*) AS n FROM conversations WHERE deleted_at IS NULL').get().n,
    messages: sqlite.prepare('SELECT COUNT(*) AS n FROM messages WHERE deleted_at IS NULL').get().n,
    needs_human: sqlite.prepare('SELECT COUNT(*) AS n FROM conversations WHERE needs_human=1 AND deleted_at IS NULL').get().n,
    open_alerts: sqlite.prepare(`
      SELECT COUNT(*) AS n
      FROM staff_alerts a
      JOIN conversations c ON c.id=a.conversation_id
      WHERE a.status='open' AND c.deleted_at IS NULL
    `).get().n
  };
  sqlite.close();

  await migrateSqliteToPostgres({ sourcePath: sqlitePath, closePool: false });
  const migrated = await runtime.getStats();
  for (const key of Object.keys(expected)) {
    if (Number(migrated[key]) !== expected[key]) {
      throw new Error(`Count mismatch for ${key}: expected ${expected[key]}, got ${migrated[key]}`);
    }
  }

  const customer = await runtime.getOrCreateCustomer('haravan_website', 'smoke-visitor', { name: 'Smoke Test' });
  const conversation = await runtime.getOrCreateConversation(customer.id, 'haravan_website', 'website/smoke', 'Smoke', 'website');
  await runtime.saveMessage({
    conversationId: conversation.id,
    customerId: customer.id,
    channel: 'haravan_website',
    externalMessageId: 'smoke-in-1',
    direction: 'in',
    senderType: 'customer',
    text: 'xin chao',
    intent: 'greeting',
    sourceGroup: 'website',
    sourceKey: 'website/smoke',
    sourceName: 'Smoke'
  });
  const alertId = await runtime.flagHandoff({
    conversationId: conversation.id,
    customerId: customer.id,
    channel: 'haravan_website',
    reason: 'Smoke alert',
    message: 'smoke',
    sourceGroup: 'website',
    sourceKey: 'website/smoke',
    sourceName: 'Smoke'
  });
  const afterAlert = await runtime.getConversation(conversation.id);
  if (Number(afterAlert.conversation.auto_reply) !== 1) throw new Error('flagHandoff unexpectedly disabled auto_reply');
  await runtime.updateAlertDelivery(alertId, 'logged', '');
  await runtime.addStaffReply(conversation.id, 'Nhan vien da nhan tin');
  const polled = await runtime.listWebsiteConversationMessages('smoke-visitor', '', 20);
  if (polled.messages.length !== 2) throw new Error(`Expected 2 widget messages, got ${polled.messages.length}`);
  if (!await runtime.markProcessed('smoke', 'event-1')) throw new Error('First processed event insert failed');
  if (await runtime.markProcessed('smoke', 'event-1')) throw new Error('Duplicate processed event was not rejected');
  const review = await runtime.addAiReplyReview({
    sourceGroup: 'website',
    sourceKey: 'website/smoke',
    sourceName: 'Smoke',
    conversationId: conversation.id,
    messageId: polled.messages[1].id,
    issueType: 'wrong_reply',
    customerText: 'full vat',
    aiReply: 'wrong',
    notes: 'Review only'
  });
  if (!review.id) throw new Error('AI reply review was not saved');
  const reviews = await runtime.listAiReplyReviews({ sourceKey: 'website/smoke', limit: 5 });
  if (!reviews.some(item => item.notes === 'Review only')) throw new Error('AI reply review was not returned');
  await runtime.resolveHandoff(conversation.id, 'done');
  const hardDeleted = await runtime.hardDeleteConversation(conversation.id);
  if (!hardDeleted?.hardDeleted) throw new Error('Conversation was not hard-deleted');
  const deleted = await runtime.getConversation(conversation.id);
  if (deleted.conversation) throw new Error('Hard-deleted conversation is still visible');
  const leftovers = await runtime.db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM conversations WHERE id=$1) AS conversations,
      (SELECT COUNT(*)::int FROM messages WHERE conversation_id=$1) AS messages,
      (SELECT COUNT(*)::int FROM staff_alerts WHERE conversation_id=$1) AS alerts,
      (SELECT COUNT(*)::int FROM ai_reply_reviews WHERE conversation_id=$1) AS reviews
  `, [conversation.id]);
  const remaining = leftovers.rows[0];
  for (const [table, count] of Object.entries(remaining)) {
    if (Number(count) !== 0) throw new Error(`Hard delete left ${count} rows in ${table}`);
  }

  console.log(JSON.stringify({ ok: true, migrated: expected, autoReplyAfterAlert: 1, widgetMessages: polled.messages.length }));
  await runtime.db.end();
}

main().catch(async err => {
  console.error('[SMOKE] failed:', err.message);
  await runtime.db.end().catch(() => {});
  process.exit(1);
});
