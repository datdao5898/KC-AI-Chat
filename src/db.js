const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, '..', 'kingcom_ai_agent.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      external_id TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      email TEXT,
      tags TEXT DEFAULT '[]',
      profile_summary TEXT DEFAULT '',
      last_intent TEXT DEFAULT '',
      interested_products TEXT DEFAULT '[]',
      hot_score INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel, external_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      auto_reply INTEGER DEFAULT 1,
      summary TEXT DEFAULT '',
      last_intent TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      external_message_id TEXT,
      direction TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      text TEXT NOT NULL,
      raw_json TEXT,
      intent TEXT DEFAULT '',
      ai_used INTEGER DEFAULT 0,
      delivery_status TEXT DEFAULT '',
      delivery_error TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id),
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      intent TEXT NOT NULL,
      confidence REAL DEFAULT 0,
      entities TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(message_id) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS knowledge_items (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS processed_events (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      external_event_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel, external_event_id)
    );

    CREATE TABLE IF NOT EXISTS staff_alerts (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      reason TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      delivery_status TEXT DEFAULT 'pending',
      delivery_error TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id),
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );
  `);

  ensureColumn('conversations', 'needs_human', 'INTEGER DEFAULT 0');
  ensureColumn('conversations', 'handoff_reason', "TEXT DEFAULT ''");
  ensureColumn('conversations', 'handoff_status', "TEXT DEFAULT ''");
  ensureColumn('conversations', 'handoff_at', 'DATETIME');
  ensureColumn('conversations', 'handled_at', 'DATETIME');
  ensureColumn('messages', 'delivery_status', "TEXT DEFAULT ''");
  ensureColumn('messages', 'delivery_error', "TEXT DEFAULT ''");
}

function getOrCreateCustomer(channel, externalId, attrs = {}) {
  let row = db.prepare('SELECT * FROM customers WHERE channel=? AND external_id=?').get(channel, externalId);
  if (row) return row;
  const id = uuidv4();
  db.prepare(`INSERT INTO customers (id, channel, external_id, name, phone, email) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, channel, externalId, attrs.name || '', attrs.phone || '', attrs.email || '');
  return db.prepare('SELECT * FROM customers WHERE id=?').get(id);
}

function getOrCreateConversation(customerId, channel) {
  let row = db.prepare(`SELECT * FROM conversations WHERE customer_id=? AND channel=? AND status='open' ORDER BY created_at DESC LIMIT 1`).get(customerId, channel);
  if (row) return row;
  const id = uuidv4();
  db.prepare(`INSERT INTO conversations (id, customer_id, channel) VALUES (?, ?, ?)`).run(id, customerId, channel);
  return db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
}

function saveMessage({ conversationId, customerId, channel, externalMessageId, direction, senderType, text, rawJson, intent='', aiUsed=0, deliveryStatus='', deliveryError='' }) {
  const id = uuidv4();
  db.prepare(`INSERT INTO messages (id, conversation_id, customer_id, channel, external_message_id, direction, sender_type, text, raw_json, intent, ai_used, delivery_status, delivery_error)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, conversationId, customerId, channel, externalMessageId || '', direction, senderType, text || '', rawJson ? JSON.stringify(rawJson) : '', intent, aiUsed ? 1 : 0, deliveryStatus || '', deliveryError || ''
  );
  db.prepare("UPDATE conversations SET updated_at=CURRENT_TIMESTAMP, last_intent=COALESCE(NULLIF(?, ''), last_intent) WHERE id=?").run(intent, conversationId);
  db.prepare("UPDATE customers SET updated_at=CURRENT_TIMESTAMP, last_intent=COALESCE(NULLIF(?, ''), last_intent) WHERE id=?").run(intent, customerId);
  return db.prepare('SELECT * FROM messages WHERE id=?').get(id);
}

function markProcessed(channel, externalEventId) {
  if (!externalEventId) return true;
  try {
    db.prepare('INSERT INTO processed_events (id, channel, external_event_id) VALUES (?, ?, ?)').run(uuidv4(), channel, externalEventId);
    return true;
  } catch { return false; }
}

function getRecentMessages(conversationId, limit = 12) {
  return db.prepare(`SELECT direction, sender_type, text, intent, created_at FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?`)
    .all(conversationId, limit).reverse();
}

function listConversations() {
  return db.prepare(`
    SELECT c.*, cu.name, cu.external_id, cu.profile_summary, cu.interested_products,
      (SELECT text FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT COUNT(*) FROM staff_alerts WHERE conversation_id=c.id AND status='open') as open_alerts
    FROM conversations c JOIN customers cu ON cu.id=c.customer_id
    ORDER BY c.needs_human DESC, c.updated_at DESC LIMIT 100
  `).all();
}

function getConversation(id) {
  const conversation = db.prepare(`SELECT c.*, cu.name, cu.external_id, cu.profile_summary, cu.interested_products FROM conversations c JOIN customers cu ON cu.id=c.customer_id WHERE c.id=?`).get(id);
  const messages = db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC').all(id);
  const alerts = db.prepare('SELECT * FROM staff_alerts WHERE conversation_id=? ORDER BY created_at DESC LIMIT 20').all(id);
  return { conversation, messages, alerts };
}

function updateConversationSummary(conversationId, customerId, summary) {
  db.prepare('UPDATE conversations SET summary=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(summary || '', conversationId);
  if (customerId) db.prepare('UPDATE customers SET profile_summary=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(summary || '', customerId);
}

function flagHandoff({ conversationId, customerId, channel, reason, message, disableAutoReply = true }) {
  const existing = db.prepare("SELECT id FROM staff_alerts WHERE conversation_id=? AND status='open' AND reason=? ORDER BY created_at DESC LIMIT 1").get(conversationId, reason);
  db.prepare(`UPDATE conversations SET needs_human=1, handoff_reason=?, handoff_status='open', handoff_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP${disableAutoReply ? ', auto_reply=0' : ''} WHERE id=?`)
    .run(reason || 'needs_human', conversationId);
  if (existing) return existing.id;
  const id = uuidv4();
  db.prepare(`INSERT INTO staff_alerts (id, conversation_id, customer_id, channel, reason, message) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, conversationId, customerId, channel, reason || 'needs_human', message || 'Cần nhân viên xử lý');
  return id;
}

function resolveHandoff(conversationId, note = '') {
  db.prepare("UPDATE conversations SET needs_human=0, handoff_status='resolved', handled_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(conversationId);
  db.prepare("UPDATE staff_alerts SET status='resolved', resolved_at=CURRENT_TIMESTAMP, delivery_error=COALESCE(NULLIF(delivery_error,''),'') || ? WHERE conversation_id=? AND status='open'")
    .run(note ? `\nResolved note: ${note}` : '', conversationId);
}

function updateAlertDelivery(alertId, status, error = '') {
  db.prepare('UPDATE staff_alerts SET delivery_status=?, delivery_error=? WHERE id=?').run(status, error || '', alertId);
}

function listStaffAlerts(status = 'open') {
  return db.prepare(`SELECT a.*, c.auto_reply, cu.external_id, cu.name FROM staff_alerts a JOIN conversations c ON c.id=a.conversation_id JOIN customers cu ON cu.id=a.customer_id WHERE a.status=? ORDER BY a.created_at DESC LIMIT 100`).all(status);
}

function updateCustomerLearning(customerId, conversationId, intent, userText) {
  const productWords = (userText.match(/[A-Za-z0-9\-]{3,}|[\p{L}]{3,}/gu) || []).filter(w => !['mua','giá','bao','nhiêu','cần','tìm','sản','phẩm','cho','tôi'].includes(w.toLowerCase())).slice(0, 8);
  const customer = db.prepare('SELECT interested_products, hot_score FROM customers WHERE id=?').get(customerId);
  let arr = [];
  try { arr = JSON.parse(customer.interested_products || '[]'); } catch {}
  for (const w of productWords) if (!arr.includes(w)) arr.push(w);
  arr = arr.slice(-30);
  const hotInc = ['buy','price','order','human'].includes(intent) ? 2 : 1;
  db.prepare('UPDATE customers SET interested_products=?, hot_score=?, last_intent=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(JSON.stringify(arr), Math.min(100, (customer.hot_score || 0) + hotInc), intent, customerId);
}

module.exports = { db, initDb, getOrCreateCustomer, getOrCreateConversation, saveMessage, markProcessed, getRecentMessages, listConversations, getConversation, updateConversationSummary, updateCustomerLearning, flagHandoff, resolveHandoff, updateAlertDelivery, listStaffAlerts };
