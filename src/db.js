const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { buildSourceContext, lookupEnvMap } = require('./sourceRegistry');
const { normalizeRating, normalizeRatingFeedback } = require('./conversationRating');

function postgresConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' } : undefined
    };
  }
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' } : undefined
  };
}

function hasPostgresConfig() {
  return Boolean(process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER));
}

const db = new Pool(postgresConfig());
db.on('error', err => {
  console.error('PostgreSQL pool error:', err.message);
});

function requirePostgresConfig() {
  if (!hasPostgresConfig()) {
    throw new Error('PostgreSQL is not configured. Set DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD.');
  }
}

async function withTransaction(work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
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
  return row ? {
    ...row,
    conversation_context: safeJsonParse(row.conversation_context, {}),
    ...buildConversationSource(row)
  } : row;
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

async function initDb() {
  requirePostgresConfig();
  await db.query(`
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
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel, external_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      channel TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      auto_reply INTEGER DEFAULT 1,
      summary TEXT DEFAULT '',
      last_intent TEXT DEFAULT '',
      source_group TEXT DEFAULT '',
      source_key TEXT DEFAULT '',
      source_name TEXT DEFAULT '',
      conversation_context TEXT DEFAULT '{}',
      needs_human INTEGER DEFAULT 0,
      handoff_reason TEXT DEFAULT '',
      handoff_status TEXT DEFAULT '',
      handoff_at TIMESTAMPTZ,
      handled_at TIMESTAMPTZ,
      customer_rating INTEGER,
      customer_rating_feedback TEXT DEFAULT '',
      customer_rated_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
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
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id),
      intent TEXT NOT NULL,
      confidence REAL DEFAULT 0,
      entities TEXT DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS knowledge_items (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS processed_events (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      external_event_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel, external_event_id)
    );

    CREATE TABLE IF NOT EXISTS staff_alerts (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      channel TEXT NOT NULL,
      reason TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      delivery_status TEXT DEFAULT 'pending',
      delivery_error TEXT DEFAULT '',
      source_group TEXT DEFAULT '',
      source_key TEXT DEFAULT '',
      source_name TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS ai_reply_reviews (
      id TEXT PRIMARY KEY,
      source_group TEXT DEFAULT '',
      source_key TEXT DEFAULT '',
      source_name TEXT DEFAULT '',
      conversation_id TEXT DEFAULT '',
      message_id TEXT DEFAULT '',
      issue_type TEXT DEFAULT 'wrong_reply',
      customer_text TEXT DEFAULT '',
      ai_reply TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
      ON messages(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_customer_channel_source_updated
      ON conversations(customer_id, channel, source_key, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_dashboard
      ON conversations(deleted_at, needs_human DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_staff_alerts_conversation_status_created
      ON staff_alerts(conversation_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_reply_reviews_source_status_created
      ON ai_reply_reviews(source_key, status, created_at DESC);
  `);
  await db.query(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_rating INTEGER;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_rating_feedback TEXT DEFAULT '';
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_rated_at TIMESTAMPTZ;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS conversation_context TEXT DEFAULT '{}';
  `);
  await backfillConversationSources();
  await refreshConfiguredSourceNames();
}

async function backfillConversationSources() {
  const { rows } = await db.query(`
    SELECT c.id, c.channel, c.source_group, c.source_key, c.source_name, cu.name, cu.phone, cu.email
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    WHERE c.deleted_at IS NULL
      AND (COALESCE(c.source_key, '') = ''
       OR COALESCE(c.source_name, '') = ''
       OR COALESCE(c.source_group, '') = '')
  `);
  for (const row of rows) {
    const inbound = await db.query(`
      SELECT raw_json
      FROM messages
      WHERE conversation_id=$1 AND direction='in' AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `, [row.id]);
    const raw = safeJsonParse(inbound.rows[0]?.raw_json, null);
    const ctx = buildConversationSource(row, raw, { name: row.name, phone: row.phone, email: row.email });
    await db.query(`
      UPDATE conversations
      SET source_group=$1, source_key=$2, source_name=$3, updated_at=CURRENT_TIMESTAMP
      WHERE id=$4
    `, [ctx.source_group || '', ctx.source_key || '', ctx.source_name || '', row.id]);
  }
}

function configuredSourceName(sourceKey = '') {
  const [sourceGroup, ...sourceIdParts] = String(sourceKey || '').split('/');
  const sourceId = sourceIdParts.join('/');
  if (!sourceId) return '';
  if (sourceGroup === 'facebook') return lookupEnvMap('FACEBOOK_PAGE_NAMES', sourceId);
  if (sourceGroup === 'zalo') return lookupEnvMap('ZALO_OA_NAMES', sourceId);
  return '';
}

async function refreshConfiguredSourceNames() {
  const { rows } = await db.query(`
    SELECT DISTINCT source_key
    FROM (
      SELECT source_key FROM conversations WHERE deleted_at IS NULL
      UNION
      SELECT source_key FROM messages WHERE deleted_at IS NULL
      UNION
      SELECT source_key FROM staff_alerts
    ) configured_sources
    WHERE COALESCE(source_key, '') <> ''
  `);
  for (const row of rows) {
    const sourceName = configuredSourceName(row.source_key);
    if (!sourceName) continue;
    await db.query(`
      UPDATE conversations
      SET source_name=$1
      WHERE source_key=$2 AND source_name IS DISTINCT FROM $1
    `, [sourceName, row.source_key]);
    await db.query(`
      UPDATE messages
      SET source_name=$1
      WHERE source_key=$2 AND source_name IS DISTINCT FROM $1
    `, [sourceName, row.source_key]);
    await db.query(`
      UPDATE staff_alerts
      SET source_name=$1
      WHERE source_key=$2 AND source_name IS DISTINCT FROM $1
    `, [sourceName, row.source_key]);
  }
}

async function getOrCreateCustomer(channel, externalId, attrs = {}) {
  const { rows } = await db.query(`
    INSERT INTO customers (id, channel, external_id, name, phone, email)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT(channel, external_id) DO UPDATE SET
      name=COALESCE(NULLIF(EXCLUDED.name, ''), customers.name),
      phone=COALESCE(NULLIF(EXCLUDED.phone, ''), customers.phone),
      email=COALESCE(NULLIF(EXCLUDED.email, ''), customers.email),
      updated_at=CURRENT_TIMESTAMP
    RETURNING *
  `, [uuidv4(), channel, externalId, attrs.name || '', attrs.phone || '', attrs.email || '']);
  return rows[0];
}

async function getOrCreateConversation(customerId, channel, sourceKey = '', sourceName = '', sourceGroup = '') {
  const params = [customerId, channel];
  const queryBase = `
    SELECT *
    FROM conversations
    WHERE customer_id=$1 AND channel=$2 AND status='open' AND deleted_at IS NULL
  `;
  if (sourceKey) {
    const exact = await db.query(`${queryBase} AND source_key=$3 ORDER BY updated_at DESC, id DESC LIMIT 1`, [...params, sourceKey]);
    if (exact.rows[0]) {
      if (!sourceName && !sourceGroup) return exact.rows[0];
      const updated = await db.query(`
        UPDATE conversations
        SET source_group=COALESCE(NULLIF(source_group,''), $1),
            source_key=COALESCE(NULLIF(source_key,''), $2),
            source_name=COALESCE(NULLIF($3,''), source_name),
            updated_at=CURRENT_TIMESTAMP
        WHERE id=$4
        RETURNING *
      `, [sourceGroup || '', sourceKey, sourceName || '', exact.rows[0].id]);
      return updated.rows[0];
    }
    const legacy = await db.query(`${queryBase} AND COALESCE(source_key,'')='' ORDER BY updated_at DESC, id DESC LIMIT 1`, params);
    if (legacy.rows[0]) {
      const updated = await db.query(`
        UPDATE conversations
        SET source_group=COALESCE(NULLIF(source_group,''), $1),
            source_key=COALESCE(NULLIF(source_key,''), $2),
            source_name=COALESCE(NULLIF($3,''), source_name),
            updated_at=CURRENT_TIMESTAMP
        WHERE id=$4
        RETURNING *
      `, [sourceGroup || '', sourceKey, sourceName || '', legacy.rows[0].id]);
      return updated.rows[0];
    }
  }
  const fallback = await db.query(`${queryBase} ORDER BY updated_at DESC, id DESC LIMIT 1`, params);
  if (fallback.rows[0]) return fallback.rows[0];
  const id = uuidv4();
  const inserted = await db.query(`
    INSERT INTO conversations (id, customer_id, channel, source_group, source_key, source_name)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [id, customerId, channel, sourceGroup || channelToSourceGroup(channel), sourceKey || '', sourceName || '']);
  return inserted.rows[0];
}

async function getConversationContext(conversationId) {
  const { rows } = await db.query('SELECT conversation_context FROM conversations WHERE id=$1', [conversationId]);
  return safeJsonParse(rows[0]?.conversation_context, {});
}

async function updateConversationContext(conversationId, context = {}) {
  const safeContext = context && typeof context === 'object' ? context : {};
  const { rows } = await db.query(`
    UPDATE conversations
    SET conversation_context=$1, updated_at=CURRENT_TIMESTAMP
    WHERE id=$2
    RETURNING conversation_context
  `, [JSON.stringify(safeContext), conversationId]);
  return safeJsonParse(rows[0]?.conversation_context, {});
}

async function saveMessage({
  conversationId, customerId, channel, externalMessageId, direction, senderType, text, rawJson,
  intent = '', aiUsed = 0, deliveryStatus = '', deliveryError = '', sourceGroup = '', sourceKey = '', sourceName = ''
}) {
  return withTransaction(async client => {
    const id = uuidv4();
    const message = await client.query(`
      INSERT INTO messages (
        id, conversation_id, customer_id, channel, external_message_id, direction, sender_type, text,
        raw_json, intent, ai_used, delivery_status, delivery_error, source_group, source_key, source_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [
      id, conversationId, customerId, channel, externalMessageId || '', direction, senderType, text || '',
      rawJson ? JSON.stringify(rawJson) : '', intent, aiUsed ? 1 : 0, deliveryStatus || '', deliveryError || '',
      sourceGroup || '', sourceKey || '', sourceName || ''
    ]);
    await client.query(`
      UPDATE conversations
      SET updated_at=CURRENT_TIMESTAMP,
          last_intent=COALESCE(NULLIF($1, ''), last_intent),
          source_group=COALESCE(NULLIF(source_group,''), $2),
          source_key=COALESCE(NULLIF(source_key,''), $3),
          source_name=COALESCE(NULLIF($4,''), source_name)
      WHERE id=$5
    `, [intent, sourceGroup || '', sourceKey || '', sourceName || '', conversationId]);
    await client.query(`
      UPDATE customers
      SET updated_at=CURRENT_TIMESTAMP, last_intent=COALESCE(NULLIF($1, ''), last_intent)
      WHERE id=$2
    `, [intent, customerId]);
    return message.rows[0];
  });
}

async function softDeleteMessage(messageId) {
  return withTransaction(async client => {
    const found = await client.query('SELECT id, conversation_id, deleted_at FROM messages WHERE id=$1', [messageId]);
    const row = found.rows[0];
    if (!row) return null;
    if (row.deleted_at) return { ...row, alreadyDeleted: true };
    await client.query('UPDATE messages SET deleted_at=CURRENT_TIMESTAMP WHERE id=$1', [messageId]);
    if (row.conversation_id) {
      await client.query('UPDATE conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=$1', [row.conversation_id]);
    }
    return { ...row, deleted: true };
  });
}

async function softDeleteConversation(conversationId) {
  return withTransaction(async client => {
    const found = await client.query('SELECT id, deleted_at FROM conversations WHERE id=$1', [conversationId]);
    const row = found.rows[0];
    if (!row) return null;
    if (row.deleted_at) return { conversation_id: conversationId, alreadyDeleted: true };
    await client.query(`
      UPDATE conversations
      SET deleted_at=CURRENT_TIMESTAMP, status='deleted', auto_reply=0, needs_human=0,
          handoff_status='deleted', updated_at=CURRENT_TIMESTAMP
      WHERE id=$1
    `, [conversationId]);
    await client.query(`
      UPDATE messages SET deleted_at=COALESCE(deleted_at, CURRENT_TIMESTAMP)
      WHERE conversation_id=$1 AND deleted_at IS NULL
    `, [conversationId]);
    await client.query(`
      UPDATE staff_alerts SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP)
      WHERE conversation_id=$1 AND status='open'
    `, [conversationId]);
    return { conversation_id: conversationId, deleted: true, deletedAt: new Date().toISOString() };
  });
}

async function hardDeleteConversation(conversationId) {
  return withTransaction(async client => {
    const found = await client.query('SELECT id, customer_id FROM conversations WHERE id=$1', [conversationId]);
    const row = found.rows[0];
    if (!row) return null;

    const reviews = await client.query('DELETE FROM ai_reply_reviews WHERE conversation_id=$1', [conversationId]);
    const alerts = await client.query('DELETE FROM staff_alerts WHERE conversation_id=$1', [conversationId]);
    const intents = await client.query(`
      DELETE FROM intents
      WHERE message_id IN (
        SELECT id FROM messages WHERE conversation_id=$1
      )
    `, [conversationId]);
    const messages = await client.query('DELETE FROM messages WHERE conversation_id=$1', [conversationId]);
    const conversation = await client.query('DELETE FROM conversations WHERE id=$1', [conversationId]);

    return {
      conversation_id: conversationId,
      customer_id: row.customer_id,
      deleted: true,
      hardDeleted: true,
      deletedCounts: {
        reviews: reviews.rowCount || 0,
        alerts: alerts.rowCount || 0,
        intents: intents.rowCount || 0,
        messages: messages.rowCount || 0,
        conversations: conversation.rowCount || 0
      }
    };
  });
}

async function markProcessed(channel, externalEventId) {
  if (!externalEventId) return true;
  try {
    await db.query(`
      INSERT INTO processed_events (id, channel, external_event_id)
      VALUES ($1, $2, $3)
    `, [uuidv4(), channel, externalEventId]);
    return true;
  } catch (e) {
    if (e.code === '23505') return false;
    throw e;
  }
}

async function getRecentMessages(conversationId, limit = 12) {
  const { rows } = await db.query(`
    SELECT id, conversation_id, customer_id, channel, external_message_id, direction, sender_type, text, raw_json, intent,
           ai_used, delivery_status, delivery_error, source_group, source_key, source_name, deleted_at, created_at
    FROM messages
    WHERE conversation_id=$1 AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT $2
  `, [conversationId, Number(limit)]);
  return rows.reverse();
}

async function listConversations() {
  const { rows } = await db.query(`
    SELECT c.*, cu.name, cu.phone, cu.email, cu.external_id, cu.profile_summary, cu.interested_products,
      (SELECT text FROM messages WHERE conversation_id=c.id AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1) AS last_message,
      (SELECT COUNT(*)::int FROM staff_alerts WHERE conversation_id=c.id AND status='open') AS open_alerts,
      COALESCE(r.reply_review_count, 0)::int AS reply_review_count
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    LEFT JOIN (
      SELECT conversation_id, COUNT(*)::int AS reply_review_count
      FROM ai_reply_reviews
      WHERE status='active'
      GROUP BY conversation_id
    ) r ON r.conversation_id = c.id
    WHERE c.deleted_at IS NULL
    ORDER BY c.needs_human DESC, c.updated_at DESC
    LIMIT 100
  `);
  return rows.map(decorateConversation);
}

async function getConversation(id) {
  const found = await db.query(`
    SELECT c.*, cu.name, cu.phone, cu.email, cu.external_id, cu.profile_summary, cu.interested_products,
      COALESCE(r.reply_review_count, 0)::int AS reply_review_count
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    LEFT JOIN (
      SELECT conversation_id, COUNT(*)::int AS reply_review_count
      FROM ai_reply_reviews
      WHERE status='active'
      GROUP BY conversation_id
    ) r ON r.conversation_id = c.id
    WHERE c.id=$1 AND c.deleted_at IS NULL
  `, [id]);
  const conversation = found.rows[0];
  if (!conversation) return { conversation: null, messages: [], alerts: [] };
  const [messages, alerts] = await Promise.all([
    db.query(`SELECT * FROM messages WHERE conversation_id=$1 AND deleted_at IS NULL ORDER BY created_at ASC, id ASC`, [id]),
    db.query(`SELECT * FROM staff_alerts WHERE conversation_id=$1 ORDER BY created_at DESC, id DESC LIMIT 20`, [id])
  ]);
  return { conversation: decorateConversation(conversation), messages: messages.rows, alerts: alerts.rows.map(decorateAlert) };
}

async function getWebsiteConversationByVisitor(visitorId) {
  const externalId = String(visitorId || '').trim();
  if (!externalId) return null;
  const { rows } = await db.query(`
    SELECT c.*, cu.name, cu.phone, cu.email, cu.external_id, cu.profile_summary, cu.interested_products
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    WHERE c.channel='haravan_website' AND cu.channel='haravan_website' AND cu.external_id=$1 AND c.deleted_at IS NULL
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT 1
  `, [externalId]);
  return decorateConversation(rows[0]);
}

async function listWebsiteConversationMessages(visitorId, since = '', limit = 20) {
  const conversation = await getWebsiteConversationByVisitor(visitorId);
  if (!conversation) return { conversation: null, messages: [] };
  const sinceText = String(since || '').trim();
  const safeLimit = Math.max(1, Math.min(50, Number(limit || 20)));
  if (sinceText) {
    const { rows } = await db.query(`
      SELECT id, direction, sender_type, text, raw_json, created_at
      FROM messages
      WHERE conversation_id=$1 AND deleted_at IS NULL AND created_at >= $2::timestamptz
      ORDER BY created_at ASC, id ASC
      LIMIT $3
    `, [conversation.id, sinceText, safeLimit]);
    return { conversation, messages: rows };
  }
  const { rows } = await db.query(`
    SELECT id, direction, sender_type, text, raw_json, created_at
    FROM (
      SELECT id, direction, sender_type, text, raw_json, created_at
      FROM messages
      WHERE conversation_id=$1 AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT $2
    ) recent
    ORDER BY created_at ASC, id ASC
  `, [conversation.id, safeLimit]);
  return { conversation, messages: rows };
}

async function rateWebsiteConversation(visitorId, conversationIdValue, ratingValue, feedbackValue = '') {
  const externalId = String(visitorId || '').trim();
  const conversationId = String(conversationIdValue || '').trim();
  const rating = normalizeRating(ratingValue);
  if (!externalId) {
    const error = new Error('visitor_id_required');
    error.code = 'visitor_id_required';
    throw error;
  }
  if (!rating) {
    const error = new Error('invalid_rating');
    error.code = 'invalid_rating';
    throw error;
  }

  const feedback = normalizeRatingFeedback(feedbackValue);
  const { rows } = await db.query(`
    WITH target AS (
      SELECT c.id
      FROM conversations c
      JOIN customers cu ON cu.id=c.customer_id
      WHERE c.channel='haravan_website'
        AND cu.channel='haravan_website'
        AND cu.external_id=$3
        AND c.deleted_at IS NULL
        AND c.status='open'
        AND ($4='' OR c.id=$4)
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT 1
    )
    UPDATE conversations c
    SET customer_rating=$1,
        customer_rating_feedback=$2,
        customer_rated_at=CURRENT_TIMESTAMP,
        status='closed',
        updated_at=CURRENT_TIMESTAMP
    FROM target
    WHERE c.id=target.id
    RETURNING c.*
  `, [rating, feedback, externalId, conversationId]);

  return decorateConversation(rows[0]);
}

async function addStaffReply(conversationId, text, attachments = []) {
  const cleanText = String(text || '').trim();
  const cleanAttachments = (Array.isArray(attachments) ? attachments : []).slice(0, 3);
  if (!cleanText && !cleanAttachments.length) return null;
  const found = await db.query(`
    SELECT c.*, cu.id AS customer_id
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    WHERE c.id=$1 AND c.deleted_at IS NULL
  `, [conversationId]);
  const conversation = found.rows[0];
  if (!conversation) return null;
  if (conversation.channel !== 'haravan_website') {
    const err = new Error('staff_reply_only_supports_website_chat');
    err.code = 'unsupported_channel';
    throw err;
  }
  const message = await saveMessage({
    conversationId: conversation.id, customerId: conversation.customer_id, channel: conversation.channel,
    externalMessageId: `staff-${Date.now()}`, direction: 'out', senderType: 'staff',
    text: cleanText,
    rawJson: {
      source: 'admin_live_chat',
      attachments: cleanAttachments,
      _media: { imageUrls: cleanAttachments.map(item => item.url) }
    },
    intent: 'staff_reply', aiUsed: 0, deliveryStatus: 'returned_via_poll',
    sourceGroup: conversation.source_group || 'website', sourceKey: conversation.source_key || '',
    sourceName: conversation.source_name || ''
  });
  await db.query(`
    UPDATE conversations
    SET handoff_status=CASE WHEN needs_human=1 THEN 'in_progress' ELSE handoff_status END, updated_at=CURRENT_TIMESTAMP
    WHERE id=$1
  `, [conversation.id]);
  return message;
}

async function updateConversationSummary(conversationId, customerId, summary) {
  await db.query('UPDATE conversations SET summary=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [summary || '', conversationId]);
  if (customerId) {
    await db.query('UPDATE customers SET profile_summary=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [summary || '', customerId]);
  }
}

async function flagHandoff({ conversationId, customerId, channel, reason, message, sourceGroup = '', sourceKey = '', sourceName = '' }) {
  return withTransaction(async client => {
    const existing = await client.query(`
      SELECT id FROM staff_alerts
      WHERE conversation_id=$1 AND status='open' AND reason=$2
      ORDER BY created_at DESC, id DESC LIMIT 1
    `, [conversationId, reason]);
    await client.query(`
      UPDATE conversations
      SET needs_human=1, handoff_reason=$1, handoff_status='open', handoff_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=$2
    `, [reason || 'needs_human', conversationId]);
    if (existing.rows[0]) return existing.rows[0].id;
    const id = uuidv4();
    await client.query(`
      INSERT INTO staff_alerts (id, conversation_id, customer_id, channel, reason, message, source_group, source_key, source_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      id, conversationId, customerId, channel, reason || 'needs_human', message || 'Cần nhân viên xử lý',
      sourceGroup || channelToSourceGroup(channel), sourceKey || '', sourceName || sourceGroupLabel(channel)
    ]);
    return id;
  });
}

async function resolveHandoff(conversationId, note = '') {
  await withTransaction(async client => {
    await client.query(`
      UPDATE conversations SET needs_human=0, handoff_status='resolved', handled_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=$1
    `, [conversationId]);
    await client.query(`
      UPDATE staff_alerts
      SET status='resolved', resolved_at=CURRENT_TIMESTAMP, delivery_error=COALESCE(NULLIF(delivery_error,''),'') || $1
      WHERE conversation_id=$2 AND status='open'
    `, [note ? `\nResolved note: ${note}` : '', conversationId]);
  });
}

async function updateAlertDelivery(alertId, status, error = '') {
  await db.query('UPDATE staff_alerts SET delivery_status=$1, delivery_error=$2 WHERE id=$3', [status, error || '', alertId]);
}

async function listStaffAlerts(status = 'open') {
  const { rows } = await db.query(`
    SELECT a.*, c.auto_reply, cu.external_id, cu.name,
      c.source_group AS conversation_source_group, c.source_key AS conversation_source_key, c.source_name AS conversation_source_name
    FROM staff_alerts a
    JOIN conversations c ON c.id = a.conversation_id
    JOIN customers cu ON cu.id = a.customer_id
    WHERE a.status=$1
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 100
  `, [status]);
  return rows.map(row => decorateAlert({
    ...row,
    source_group: row.source_group || row.conversation_source_group || row.channel,
    source_key: row.source_key || row.conversation_source_key || '',
    source_name: row.source_name || row.conversation_source_name || sourceGroupLabel(row.source_group || row.conversation_source_group || row.channel)
  }));
}

async function addAiReplyReview({
  sourceGroup = '', sourceKey = '', sourceName = '', conversationId = '', messageId = '',
  issueType = 'wrong_reply', customerText = '', aiReply = '', notes = ''
}) {
  const cleanIssue = String(issueType || 'wrong_reply').trim() || 'wrong_reply';
  const { rows } = await db.query(`
    INSERT INTO ai_reply_reviews (
      id, source_group, source_key, source_name, conversation_id, message_id,
      issue_type, customer_text, ai_reply, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
    uuidv4(),
    sourceGroup || '',
    sourceKey || '',
    sourceName || '',
    conversationId || '',
    messageId || '',
    cleanIssue,
    customerText || '',
    aiReply || '',
    notes || ''
  ]);
  return rows[0];
}

async function listAiReplyReviews({ sourceKey = '', status = 'active', limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit || 100), 300));
  const params = [status || 'active'];
  let where = 'WHERE status=$1';
  if (sourceKey) {
    params.push(sourceKey);
    where += ` AND source_key=$${params.length}`;
  }
  const { rows } = await db.query(`
    SELECT *
    FROM ai_reply_reviews
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ${safeLimit}
  `, params);
  return rows;
}

async function updateCustomerLearning(customerId, conversationId, intent, userText) {
  const productWords = (String(userText || '').match(/[A-Za-z0-9\-]{3,}|[\p{L}]{3,}/gu) || [])
    .filter(w => !['mua', 'giá', 'bao', 'nhiêu', 'cần', 'tìm', 'sản', 'phẩm', 'cho', 'tôi'].includes(w.toLowerCase()))
    .slice(0, 8);
  if (!['product_search', 'buy', 'price', 'order', 'warranty'].includes(intent)) productWords.length = 0;
  const found = await db.query('SELECT interested_products, hot_score FROM customers WHERE id=$1', [customerId]);
  const customer = found.rows[0];
  if (!customer) return;
  let arr = [];
  try { arr = JSON.parse(customer.interested_products || '[]'); } catch { arr = []; }
  for (const word of productWords) if (!arr.includes(word)) arr.push(word);
  arr = arr.slice(-30);
  const hotInc = ['buy', 'price', 'order', 'human'].includes(intent) ? 2 : 1;
  await db.query(`
    UPDATE customers SET interested_products=$1, hot_score=$2, last_intent=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4
  `, [JSON.stringify(arr), Math.min(100, (customer.hot_score || 0) + hotInc), intent, customerId]);
}

async function getStats() {
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM customers) AS customers,
      (SELECT COUNT(*)::int FROM conversations WHERE deleted_at IS NULL) AS conversations,
      (SELECT COUNT(*)::int FROM messages WHERE deleted_at IS NULL) AS messages,
      (SELECT COUNT(*)::int FROM conversations WHERE needs_human=1 AND deleted_at IS NULL) AS needs_human,
      (SELECT COUNT(*)::int FROM staff_alerts a JOIN conversations c ON c.id=a.conversation_id WHERE a.status='open' AND c.deleted_at IS NULL) AS open_alerts
  `);
  return rows[0];
}

module.exports = {
  db, initDb, getOrCreateCustomer, getOrCreateConversation, saveMessage, markProcessed, getRecentMessages,
  listConversations, getConversation, updateConversationSummary, updateCustomerLearning, flagHandoff, resolveHandoff,
  updateAlertDelivery, listStaffAlerts, softDeleteMessage, softDeleteConversation, hardDeleteConversation, getWebsiteConversationByVisitor,
  listWebsiteConversationMessages, rateWebsiteConversation, addStaffReply, getStats, addAiReplyReview, listAiReplyReviews,
  getConversationContext, updateConversationContext
};
