const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { buildSourceContext } = require('./sourceRegistry');

const dbPath = path.join(__dirname, '..', 'kingcom_ai_agent.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function channelToSourceGroup(channel) {
  if (channel === 'facebook') return 'facebook';
  if (channel === 'zalo') return 'zalo';
  if (channel === 'haravan_website' || channel === 'haravan' || channel === 'website') return 'website';
  return channel || 'common';
}

function sourceGroupLabel(group) {
  const normalized = channelToSourceGroup(group);
  return {
    facebook: 'Facebook',
    zalo: 'Zalo',
    website: 'Website',
    common: 'Chung'
  }[normalized] || normalized || 'Khác';
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function buildConversationSource(row = {}, raw = null, customerAttrs = {}) {
  const guessed = buildSourceContext({ channel: row.channel || row.source_group || 'common', raw, customerAttrs });
  return {
    source_group: row.source_group || guessed.sourceGroup || channelToSourceGroup(row.channel),
    source_key: row.source_key || guessed.sourceKey || '',
    source_name: row.source_name || guessed.sourceName || sourceGroupLabel(row.source_group || row.channel),
    source_group_label: sourceGroupLabel(row.source_group || row.channel),
    source_label: row.source_name || guessed.sourceName || sourceGroupLabel(row.source_group || row.channel)
  };
}

function decorateConversation(row) {
  if (!row) return row;
  const source = buildConversationSource(row);
  return {
    ...row,
    conversation_context: safeJsonParse(row.conversation_context, {}),
    ...source
  };
}

function decorateAlert(row) {
  if (!row) return row;
  const sourceGroup = row.source_group || row.channel;
  return {
    ...row,
    source_group: sourceGroup || '',
    source_group_label: sourceGroupLabel(sourceGroup),
    source_name: row.source_name || sourceGroupLabel(sourceGroup),
    source_key: row.source_key || ''
  };
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
      source_group TEXT DEFAULT '',
      source_key TEXT DEFAULT '',
      source_name TEXT DEFAULT '',
      needs_human INTEGER DEFAULT 0,
      handoff_reason TEXT DEFAULT '',
      handoff_status TEXT DEFAULT '',
      handoff_at DATETIME,
      handled_at DATETIME,
      deleted_at DATETIME,
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
      source_group TEXT DEFAULT '',
      source_key TEXT DEFAULT '',
      source_name TEXT DEFAULT '',
      deleted_at DATETIME,
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
      source_group TEXT DEFAULT '',
      source_key TEXT DEFAULT '',
      source_name TEXT DEFAULT '',
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
  ensureColumn('conversations', 'deleted_at', 'DATETIME');
  ensureColumn('conversations', 'source_group', "TEXT DEFAULT ''");
  ensureColumn('conversations', 'source_key', "TEXT DEFAULT ''");
  ensureColumn('conversations', 'source_name', "TEXT DEFAULT ''");
  ensureColumn('conversations', 'conversation_context', "TEXT DEFAULT '{}'");
  ensureColumn('messages', 'delivery_status', "TEXT DEFAULT ''");
  ensureColumn('messages', 'delivery_error', "TEXT DEFAULT ''");
  ensureColumn('messages', 'source_group', "TEXT DEFAULT ''");
  ensureColumn('messages', 'source_key', "TEXT DEFAULT ''");
  ensureColumn('messages', 'source_name', "TEXT DEFAULT ''");
  ensureColumn('messages', 'deleted_at', 'DATETIME');
  ensureColumn('staff_alerts', 'delivery_status', "TEXT DEFAULT ''");
  ensureColumn('staff_alerts', 'delivery_error', "TEXT DEFAULT ''");
  ensureColumn('staff_alerts', 'source_group', "TEXT DEFAULT ''");
  ensureColumn('staff_alerts', 'source_key', "TEXT DEFAULT ''");
  ensureColumn('staff_alerts', 'source_name', "TEXT DEFAULT ''");

  backfillConversationSources();
}

function backfillConversationSources() {
  const rows = db.prepare(`
    SELECT c.id, c.channel, c.source_group, c.source_key, c.source_name, cu.name, cu.phone, cu.email
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    WHERE COALESCE(c.deleted_at,'')=''
      AND (COALESCE(c.source_key, '') = ''
       OR COALESCE(c.source_name, '') = ''
       OR COALESCE(c.source_group, '') = '')
  `).all();
  if (!rows.length) return;

  const latestInbound = db.prepare(`
    SELECT raw_json
    FROM messages
    WHERE conversation_id=? AND direction='in' AND COALESCE(deleted_at,'')=''
    ORDER BY datetime(created_at) DESC, rowid DESC
    LIMIT 1
  `);
  const update = db.prepare(`
    UPDATE conversations
    SET source_group=?, source_key=?, source_name=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `);

  for (const row of rows) {
    const raw = safeJsonParse(latestInbound.get(row.id)?.raw_json, null);
    const ctx = buildConversationSource(row, raw, { name: row.name, phone: row.phone, email: row.email });
    update.run(ctx.source_group || '', ctx.source_key || '', ctx.source_name || '', row.id);
  }
}

function getOrCreateCustomer(channel, externalId, attrs = {}) {
  let row = db.prepare('SELECT * FROM customers WHERE channel=? AND external_id=?').get(channel, externalId);
  if (row) {
    const updates = [];
    const params = [];
    const name = String(attrs.name || '').trim();
    const phone = String(attrs.phone || '').trim();
    const email = String(attrs.email || '').trim();
    if (name) {
      updates.push('name=?');
      params.push(name);
    }
    if (phone) {
      updates.push('phone=?');
      params.push(phone);
    }
    if (email) {
      updates.push('email=?');
      params.push(email);
    }
    if (updates.length) {
      updates.push('updated_at=CURRENT_TIMESTAMP');
      db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id=?`).run(...params, row.id);
      row = db.prepare('SELECT * FROM customers WHERE id=?').get(row.id);
    }
    return row;
  }
  const id = uuidv4();
  db.prepare('INSERT INTO customers (id, channel, external_id, name, phone, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, channel, externalId, attrs.name || '', attrs.phone || '', attrs.email || '');
  return db.prepare('SELECT * FROM customers WHERE id=?').get(id);
}

function getOrCreateConversation(customerId, channel, sourceKey = '', sourceName = '', sourceGroup = '') {
  const queryBase = `
    SELECT *
    FROM conversations
    WHERE customer_id=? AND channel=? AND status='open' AND COALESCE(deleted_at,'')=''
  `;

  if (sourceKey) {
    const exact = db.prepare(`${queryBase} AND source_key=? ORDER BY datetime(updated_at) DESC, rowid DESC LIMIT 1`).get(customerId, channel, sourceKey);
    if (exact) {
      if (sourceName || sourceGroup) {
        db.prepare(`
          UPDATE conversations
          SET source_group=COALESCE(NULLIF(source_group,''), ?),
              source_key=COALESCE(NULLIF(source_key,''), ?),
              source_name=COALESCE(NULLIF(source_name,''), ?),
              updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `).run(sourceGroup || '', sourceKey || '', sourceName || '', exact.id);
        return db.prepare('SELECT * FROM conversations WHERE id=?').get(exact.id);
      }
      return exact;
    }

    const legacy = db.prepare(`${queryBase} AND COALESCE(source_key,'')='' ORDER BY datetime(updated_at) DESC, rowid DESC LIMIT 1`).get(customerId, channel);
    if (legacy) {
      db.prepare(`
        UPDATE conversations
        SET source_group=COALESCE(NULLIF(source_group,''), ?),
            source_key=COALESCE(NULLIF(source_key,''), ?),
            source_name=COALESCE(NULLIF(source_name,''), ?),
            updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(sourceGroup || '', sourceKey || '', sourceName || '', legacy.id);
      return db.prepare('SELECT * FROM conversations WHERE id=?').get(legacy.id);
    }
  }

  const fallback = db.prepare(`${queryBase} ORDER BY datetime(updated_at) DESC, rowid DESC LIMIT 1`).get(customerId, channel);
  if (fallback) return fallback;

  const id = uuidv4();
  db.prepare(`
    INSERT INTO conversations (id, customer_id, channel, source_group, source_key, source_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    customerId,
    channel,
    sourceGroup || channelToSourceGroup(channel),
    sourceKey || '',
    sourceName || ''
  );
  return db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
}

function getConversationContext(conversationId) {
  const row = db.prepare('SELECT conversation_context FROM conversations WHERE id=?').get(conversationId);
  return safeJsonParse(row?.conversation_context, {});
}

function updateConversationContext(conversationId, context = {}) {
  const safeContext = context && typeof context === 'object' ? context : {};
  db.prepare(`
    UPDATE conversations
    SET conversation_context=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(JSON.stringify(safeContext), conversationId);
  return getConversationContext(conversationId);
}

function saveMessage({
  conversationId,
  customerId,
  channel,
  externalMessageId,
  direction,
  senderType,
  text,
  rawJson,
  intent = '',
  aiUsed = 0,
  deliveryStatus = '',
  deliveryError = '',
  sourceGroup = '',
  sourceKey = '',
  sourceName = ''
}) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO messages (
      id, conversation_id, customer_id, channel, external_message_id, direction, sender_type, text,
      raw_json, intent, ai_used, delivery_status, delivery_error, source_group, source_key, source_name
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    conversationId,
    customerId,
    channel,
    externalMessageId || '',
    direction,
    senderType,
    text || '',
    rawJson ? JSON.stringify(rawJson) : '',
    intent,
    aiUsed ? 1 : 0,
    deliveryStatus || '',
    deliveryError || '',
    sourceGroup || '',
    sourceKey || '',
    sourceName || ''
  );

  db.prepare(`
    UPDATE conversations
    SET updated_at=CURRENT_TIMESTAMP,
        last_intent=COALESCE(NULLIF(?, ''), last_intent),
        source_group=COALESCE(NULLIF(source_group,''), ?),
        source_key=COALESCE(NULLIF(source_key,''), ?),
        source_name=COALESCE(NULLIF(source_name,''), ?)
    WHERE id=?
  `).run(intent, sourceGroup || '', sourceKey || '', sourceName || '', conversationId);

  db.prepare(`
    UPDATE customers
    SET updated_at=CURRENT_TIMESTAMP,
        last_intent=COALESCE(NULLIF(?, ''), last_intent)
    WHERE id=?
  `).run(intent, customerId);

  return db.prepare('SELECT * FROM messages WHERE id=?').get(id);
}

function softDeleteMessage(messageId) {
  const row = db.prepare('SELECT id, conversation_id, deleted_at FROM messages WHERE id=?').get(messageId);
  if (!row) return null;
  if (String(row.deleted_at || '').trim()) {
    return { ...row, alreadyDeleted: true };
  }
  db.prepare(`
    UPDATE messages
    SET deleted_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(messageId);
  if (row.conversation_id) {
    db.prepare(`
      UPDATE conversations
      SET updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(row.conversation_id);
  }
  return { ...row, deleted: true };
}

function softDeleteConversation(conversationId) {
  const conversation = db.prepare('SELECT id, deleted_at FROM conversations WHERE id=?').get(conversationId);
  if (!conversation) return null;
  if (String(conversation.deleted_at || '').trim()) {
    return { conversation_id: conversationId, alreadyDeleted: true };
  }
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE conversations
    SET deleted_at=CURRENT_TIMESTAMP,
        status='deleted',
        auto_reply=0,
        needs_human=0,
        handoff_status='deleted',
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(conversationId);
  db.prepare(`
    UPDATE messages
    SET deleted_at=COALESCE(deleted_at, CURRENT_TIMESTAMP)
    WHERE conversation_id=? AND COALESCE(deleted_at,'')=''
  `).run(conversationId);
  db.prepare(`
    UPDATE staff_alerts
    SET status='resolved',
        resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP)
    WHERE conversation_id=? AND status='open'
  `).run(conversationId);
  return { conversation_id: conversationId, deleted: true, deletedAt: now };
}

function markProcessed(channel, externalEventId) {
  if (!externalEventId) return true;
  try {
    db.prepare('INSERT INTO processed_events (id, channel, external_event_id) VALUES (?, ?, ?)').run(uuidv4(), channel, externalEventId);
    return true;
  } catch {
    return false;
  }
}

function getRecentMessages(conversationId, limit = 12) {
  return db.prepare(`
    SELECT id, conversation_id, customer_id, channel, external_message_id, direction, sender_type, text, raw_json, intent,
           ai_used, delivery_status, delivery_error, source_group, source_key, source_name, deleted_at, created_at
    FROM messages
    WHERE conversation_id=? AND COALESCE(deleted_at,'')=''
    ORDER BY datetime(created_at) DESC, rowid DESC
    LIMIT ?
  `).all(conversationId, limit).reverse();
}

function listConversations() {
  const rows = db.prepare(`
    SELECT c.*, cu.name, cu.phone, cu.email, cu.external_id, cu.profile_summary, cu.interested_products,
      (SELECT text FROM messages WHERE conversation_id=c.id AND COALESCE(deleted_at,'')='' ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1) as last_message,
      (SELECT COUNT(*) FROM staff_alerts WHERE conversation_id=c.id AND status='open') as open_alerts
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    WHERE COALESCE(c.deleted_at,'')=''
    ORDER BY c.needs_human DESC, datetime(c.updated_at) DESC
    LIMIT 100
  `).all();
  return rows.map(decorateConversation);
}

function getConversation(id) {
  const conversation = db.prepare(`
    SELECT c.*, cu.name, cu.phone, cu.email, cu.external_id, cu.profile_summary, cu.interested_products
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    WHERE c.id=? AND COALESCE(c.deleted_at,'')=''
  `).get(id);
  if (!conversation) return { conversation: null, messages: [], alerts: [] };
  const messages = db.prepare(`
    SELECT *
    FROM messages
    WHERE conversation_id=? AND COALESCE(deleted_at,'')=''
    ORDER BY datetime(created_at) ASC, rowid ASC
  `).all(id);
  const alerts = db.prepare(`
    SELECT *
    FROM staff_alerts
    WHERE conversation_id=?
    ORDER BY datetime(created_at) DESC, rowid DESC
    LIMIT 20
  `).all(id).map(decorateAlert);
  return {
    conversation: decorateConversation(conversation),
    messages,
    alerts
  };
}

function getWebsiteConversationByVisitor(visitorId) {
  const externalId = String(visitorId || '').trim();
  if (!externalId) return null;
  const row = db.prepare(`
    SELECT c.*, cu.name, cu.phone, cu.email, cu.external_id, cu.profile_summary, cu.interested_products
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    WHERE c.channel='haravan_website'
      AND cu.channel='haravan_website'
      AND cu.external_id=?
      AND COALESCE(c.deleted_at,'')=''
    ORDER BY datetime(c.updated_at) DESC, c.rowid DESC
    LIMIT 1
  `).get(externalId);
  return decorateConversation(row);
}

function listWebsiteConversationMessages(visitorId, since = '', limit = 20) {
  const conversation = getWebsiteConversationByVisitor(visitorId);
  if (!conversation) return { conversation: null, messages: [] };
  const sinceText = String(since || '').trim();
  const safeLimit = Math.max(1, Math.min(50, Number(limit || 20)));
  const params = [conversation.id];
  if (sinceText) {
    params.push(sinceText);
    const messages = db.prepare(`
      SELECT id, direction, sender_type, text, raw_json, created_at
      FROM messages
      WHERE conversation_id=?
        AND COALESCE(deleted_at,'')=''
        AND datetime(created_at) >= datetime(?)
      ORDER BY datetime(created_at) ASC, rowid ASC
      LIMIT ?
    `).all(...params, safeLimit);
    return { conversation, messages };
  }

  const messages = db.prepare(`
    SELECT *
    FROM (
      SELECT id, direction, sender_type, text, raw_json, created_at, rowid
      FROM messages
      WHERE conversation_id=?
        AND COALESCE(deleted_at,'')=''
      ORDER BY datetime(created_at) DESC, rowid DESC
      LIMIT ?
    )
    ORDER BY datetime(created_at) ASC, rowid ASC
  `).all(conversation.id, safeLimit);
  return { conversation, messages };
}

function addStaffReply(conversationId, text, attachments = []) {
  const cleanText = String(text || '').trim();
  const cleanAttachments = (Array.isArray(attachments) ? attachments : []).slice(0, 3);
  if (!cleanText && !cleanAttachments.length) return null;
  const conversation = db.prepare(`
    SELECT c.*, cu.id AS customer_id
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    WHERE c.id=? AND COALESCE(c.deleted_at,'')=''
  `).get(conversationId);
  if (!conversation) return null;
  if (conversation.channel !== 'haravan_website') {
    const err = new Error('staff_reply_only_supports_website_chat');
    err.code = 'unsupported_channel';
    throw err;
  }
  const message = saveMessage({
    conversationId: conversation.id,
    customerId: conversation.customer_id,
    channel: conversation.channel,
    externalMessageId: `staff-${Date.now()}`,
    direction: 'out',
    senderType: 'staff',
    text: cleanText,
    rawJson: {
      source: 'admin_live_chat',
      attachments: cleanAttachments,
      _media: { imageUrls: cleanAttachments.map(item => item.url) }
    },
    intent: 'staff_reply',
    aiUsed: 0,
    deliveryStatus: 'returned_via_poll',
    sourceGroup: conversation.source_group || 'website',
    sourceKey: conversation.source_key || '',
    sourceName: conversation.source_name || ''
  });
  db.prepare(`
    UPDATE conversations
    SET handoff_status=CASE WHEN needs_human=1 THEN 'in_progress' ELSE handoff_status END,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(conversation.id);
  return message;
}

function updateConversationSummary(conversationId, customerId, summary) {
  db.prepare('UPDATE conversations SET summary=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(summary || '', conversationId);
  if (customerId) db.prepare('UPDATE customers SET profile_summary=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(summary || '', customerId);
}

function flagHandoff({
  conversationId,
  customerId,
  channel,
  reason,
  message,
  sourceGroup = '',
  sourceKey = '',
  sourceName = ''
}) {
  const existing = db.prepare("SELECT id FROM staff_alerts WHERE conversation_id=? AND status='open' AND reason=? ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1").get(conversationId, reason);
  db.prepare(`
    UPDATE conversations
    SET needs_human=1,
        handoff_reason=?,
        handoff_status='open',
        handoff_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(reason || 'needs_human', conversationId);
  if (existing) return existing.id;
  const id = uuidv4();
  db.prepare(`
    INSERT INTO staff_alerts (
      id, conversation_id, customer_id, channel, reason, message, source_group, source_key, source_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    conversationId,
    customerId,
    channel,
    reason || 'needs_human',
    message || 'Cần nhân viên xử lý',
    sourceGroup || channelToSourceGroup(channel),
    sourceKey || '',
    sourceName || sourceGroupLabel(channel)
  );
  return id;
}

function resolveHandoff(conversationId, note = '') {
  db.prepare(`
    UPDATE conversations
    SET needs_human=0,
        handoff_status='resolved',
        handled_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(conversationId);
  db.prepare(`
    UPDATE staff_alerts
    SET status='resolved',
        resolved_at=CURRENT_TIMESTAMP,
        delivery_error=COALESCE(NULLIF(delivery_error,''),'') || ?
    WHERE conversation_id=? AND status='open'
  `).run(note ? `\nResolved note: ${note}` : '', conversationId);
}

function updateAlertDelivery(alertId, status, error = '') {
  db.prepare('UPDATE staff_alerts SET delivery_status=?, delivery_error=? WHERE id=?').run(status, error || '', alertId);
}

function listStaffAlerts(status = 'open') {
  const rows = db.prepare(`
    SELECT a.*, c.auto_reply, cu.external_id, cu.name, c.source_group AS conversation_source_group, c.source_key AS conversation_source_key, c.source_name AS conversation_source_name
    FROM staff_alerts a
    JOIN conversations c ON c.id = a.conversation_id
    JOIN customers cu ON cu.id = a.customer_id
    WHERE a.status=?
    ORDER BY datetime(a.created_at) DESC, a.rowid DESC
    LIMIT 100
  `).all(status);
  return rows.map(row => decorateAlert({
    ...row,
    source_group: row.source_group || row.conversation_source_group || row.channel,
    source_key: row.source_key || row.conversation_source_key || '',
    source_name: row.source_name || row.conversation_source_name || sourceGroupLabel(row.source_group || row.conversation_source_group || row.channel)
  }));
}

function updateCustomerLearning(customerId, conversationId, intent, userText) {
  const productWords = (String(userText || '').match(/[A-Za-z0-9\-]{3,}|[\p{L}]{3,}/gu) || [])
    .filter(w => !['mua', 'giá', 'bao', 'nhiêu', 'cần', 'tìm', 'sản', 'phẩm', 'cho', 'tôi'].includes(w.toLowerCase()))
    .slice(0, 8);
  if (!['product_search', 'buy', 'price', 'order', 'warranty'].includes(intent)) {
    productWords.length = 0;
  }
  const customer = db.prepare('SELECT interested_products, hot_score FROM customers WHERE id=?').get(customerId);
  if (!customer) return;
  let arr = [];
  try {
    arr = JSON.parse(customer.interested_products || '[]');
  } catch {
    arr = [];
  }
  for (const w of productWords) if (!arr.includes(w)) arr.push(w);
  arr = arr.slice(-30);
  const hotInc = ['buy', 'price', 'order', 'human'].includes(intent) ? 2 : 1;
  db.prepare(`
    UPDATE customers
    SET interested_products=?, hot_score=?, last_intent=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(JSON.stringify(arr), Math.min(100, (customer.hot_score || 0) + hotInc), intent, customerId);
}

module.exports = {
  db,
  initDb,
  getOrCreateCustomer,
  getOrCreateConversation,
  saveMessage,
  markProcessed,
  getRecentMessages,
  listConversations,
  getConversation,
  updateConversationSummary,
  updateCustomerLearning,
  flagHandoff,
  resolveHandoff,
  updateAlertDelivery,
  listStaffAlerts,
  softDeleteMessage,
  softDeleteConversation,
  getWebsiteConversationByVisitor,
  listWebsiteConversationMessages,
  addStaffReply,
  getConversationContext,
  updateConversationContext
};
