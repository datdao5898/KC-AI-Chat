const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { listConversations, getConversation, updateConversationSummary, db, flagHandoff, resolveHandoff, listStaffAlerts, softDeleteMessage, hardDeleteConversation, addStaffReply, getStats, addAiReplyReview, listAiReplyReviews } = require('../db');
const { searchProducts, loadProducts } = require('../rag');
const { summarizeConversation, summarizeConversationFast } = require('../ai');
const { notifyStaff } = require('../staffAlert');
const { SOURCES_DIR, readSourceConfig, lookupEnvMap } = require('../sourceRegistry');
const {
  maxImageBytes,
  resolveWebsiteAttachments,
  saveWebsiteImage
} = require('../websiteMedia');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const WEBSITE_MEDIA_DIR = path.join(DATA_DIR, 'website-media');
const KNOWLEDGE_FILES = { faq: 'faq.md', policies: 'policies.md', catalog_summary: 'catalog_summary.md' };
const TRAINING_FILES = { products: 'products.csv', faq: 'faq.md', policies: 'policies.md' };
const LOG_FILES = {
  ai: 'ai_responses.log',
  alerts: 'staff_alerts.log'
};

function tailLines(filePath, maxLines = 120) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-Math.max(1, Math.min(Number(maxLines) || 120, 500)));
}

function readLogEntries(type = 'ai', limit = 120) {
  const normalized = LOG_FILES[type] ? type : 'ai';
  const filePath = path.join(DATA_DIR, LOG_FILES[normalized]);
  const lines = tailLines(filePath, limit);
  return lines.reverse().map((line, index) => {
    if (normalized === 'ai') {
      try {
        const data = JSON.parse(line);
        return {
          id: `${normalized}-${index}`,
          type: normalized,
          ts: data.ts || '',
          level: data.aiError === 'true' || data.deliveryError ? 'error' : 'info',
          title: data.customerText || data.intent || data.aiSource || 'AI response',
          source: data.sourceName || data.channel || '',
          status: data.deliveryStatus || data.aiSource || '',
          detail: data.reply || data.aiError || '',
          raw: data
        };
      } catch {
        return { id: `${normalized}-${index}`, type: normalized, level: 'info', title: line.slice(0, 160), detail: line };
      }
    }
    return {
      id: `${normalized}-${index}`,
      type: normalized,
      level: /failed|error|lỗi/i.test(line) ? 'error' : 'info',
      title: line.slice(0, 160),
      detail: line
    };
  });
}

function normalizeKnowledgeSourceKey(value = 'common') {
  const sourceKey = String(value ?? '').trim().toLowerCase();
  if (!sourceKey) return null;
  if (sourceKey === 'common') return sourceKey;
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(sourceKey)) return null;
  return sourceKey;
}

function knowledgeBaseDir(sourceKey = 'common') {
  const normalized = normalizeKnowledgeSourceKey(sourceKey);
  if (!normalized) return null;
  return normalized === 'common'
    ? DATA_DIR
    : path.join(SOURCES_DIR, ...normalized.split('/'));
}

function knowledgePath(type, sourceKey = 'common') {
  const file = KNOWLEDGE_FILES[type];
  if (!file) return null;
  const baseDir = knowledgeBaseDir(sourceKey);
  return baseDir ? path.join(baseDir, file) : null;
}

function trainingFilePath(type, sourceKey = 'common') {
  const file = TRAINING_FILES[type];
  if (!file) return null;
  const normalized = normalizeKnowledgeSourceKey(sourceKey);
  if (!normalized) return null;
  if (type === 'products' && normalized === 'common') return path.join(DATA_DIR, file);
  const baseDir = knowledgeBaseDir(normalized);
  return baseDir ? path.join(baseDir, file) : null;
}

function trainingFileInfo(type, sourceKey = 'common') {
  const p = trainingFilePath(type, sourceKey);
  if (!p || !fs.existsSync(p)) return { type, exists: false, bytes: 0, updatedAt: null };
  const stat = fs.statSync(p);
  return { type, exists: true, bytes: stat.size, updatedAt: stat.mtime.toISOString() };
}

function readKnowledge(sourceKey = 'common') {
  const normalized = normalizeKnowledgeSourceKey(sourceKey);
  if (!normalized) return null;
  const result = { sourceKey: normalized };
  for (const type of Object.keys(KNOWLEDGE_FILES)) {
    const p = knowledgePath(type, normalized);
    result[type] = p && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }
  return result;
}

function knowledgeSourceName(group, sourceId, sourceKey) {
  const config = readSourceConfig(sourceKey);
  if (group === 'facebook') {
    return lookupEnvMap('FACEBOOK_PAGE_NAMES', sourceId) || config.brand || `Facebook ${sourceId}`;
  }
  if (group === 'zalo') {
    return lookupEnvMap('ZALO_OA_NAMES', sourceId) || config.brand || `Zalo OA ${sourceId}`;
  }
  return config.brand || sourceId;
}

function listKnowledgeSources() {
  const result = [{ sourceKey: 'common', group: 'common', sourceId: 'common', name: 'Dùng chung' }];
  if (!fs.existsSync(SOURCES_DIR)) return result;

  for (const groupEntry of fs.readdirSync(SOURCES_DIR, { withFileTypes: true })) {
    if (!groupEntry.isDirectory()) continue;
    const groupDir = path.join(SOURCES_DIR, groupEntry.name);
    for (const sourceEntry of fs.readdirSync(groupDir, { withFileTypes: true })) {
      if (!sourceEntry.isDirectory()) continue;
      const sourceKey = normalizeKnowledgeSourceKey(`${groupEntry.name}/${sourceEntry.name}`);
      if (!sourceKey) continue;
      result.push({
        sourceKey,
        group: groupEntry.name,
        sourceId: sourceEntry.name,
        name: knowledgeSourceName(groupEntry.name, sourceEntry.name, sourceKey)
      });
    }
  }

  return result.sort((a, b) => {
    if (a.sourceKey === 'common') return -1;
    if (b.sourceKey === 'common') return 1;
    return a.group.localeCompare(b.group) || a.name.localeCompare(b.name, 'vi');
  });
}

function envFlag(name, fallback = true) {
  if (process.env[name] === 'false') return false;
  if (process.env[name] === 'true') return true;
  return fallback;
}

function fileStatus(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { exists: false, bytes: 0, updatedAt: null };
  }
  const stat = fs.statSync(filePath);
  return { exists: true, bytes: stat.size, updatedAt: stat.mtime.toISOString() };
}

async function countTable(table) {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return Number(rows?.[0]?.count || 0);
}

router.get('/conversations', async (req, res) => res.json(await listConversations()));
router.get('/conversations/:id', async (req, res) => res.json(await getConversation(req.params.id)));

router.get('/health/deep', async (req, res) => {
  try {
    const dbCheck = await db.query('SELECT 1 AS ok');
    const tableCounts = {};
    let dbOk = Number(dbCheck.rows?.[0]?.ok || 0) === 1;

    for (const table of ['customers', 'conversations', 'messages', 'staff_alerts']) {
      try {
        tableCounts[table] = await countTable(table);
      } catch {
        tableCounts[table] = null;
        dbOk = false;
      }
    }

    const payload = {
      ok: dbOk,
      uptime_seconds: Math.round(process.uptime()),
      db: {
        ok: dbOk,
        tables: tableCounts
      },
      flags: {
        autoReply: envFlag('AUTO_REPLY', true),
        replyJudgeEnabled: envFlag('REPLY_JUDGE_ENABLED', true),
        imageRecognitionEnabled: envFlag('WEBSITE_IMAGE_RECOGNITION_ENABLED', true)
      },
      files: {
        media: fileStatus(WEBSITE_MEDIA_DIR),
        aiTrace: fileStatus(path.join(DATA_DIR, 'ai_responses.log')),
        staffAlerts: fileStatus(path.join(DATA_DIR, 'staff_alerts.log'))
      }
    };

    res.status(dbOk ? 200 : 503).json(payload);
  } catch (err) {
    res.status(503).json({
      ok: false,
      uptime_seconds: Math.round(process.uptime()),
      error: 'health_check_failed',
      detail: err.message
    });
  }
});

router.delete('/messages/:id', async (req, res) => {
  const result = await softDeleteMessage(req.params.id);
  if (!result) return res.status(404).json({ error: 'message_not_found' });
  if (!result.conversation_id) return res.json({ ok: true, deleted: true });
  const data = await getConversation(result.conversation_id);
  if (data.conversation) {
    const summary = summarizeConversationFast({ messages: data.messages, customer: data.conversation });
    await updateConversationSummary(data.conversation.id, data.conversation.customer_id, summary);
  }
  res.json({ ok: true, deleted: true, data: await getConversation(result.conversation_id) });
});

router.delete('/conversations/:id', async (req, res) => {
  const result = await hardDeleteConversation(req.params.id);
  if (!result) return res.status(404).json({ error: 'conversation_not_found' });
  res.json({ ok: true, deleted: true, hardDeleted: true, conversationId: req.params.id, deletedCounts: result.deletedCounts });
});

router.patch('/conversations/:id', async (req, res) => {
  const { status, auto_reply, summary } = req.body;
  if (status !== undefined) await db.query('UPDATE conversations SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [status, req.params.id]);
  if (auto_reply !== undefined) await db.query('UPDATE conversations SET auto_reply=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [auto_reply ? 1 : 0, req.params.id]);
  if (summary !== undefined) await db.query('UPDATE conversations SET summary=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [summary, req.params.id]);
  res.json(await getConversation(req.params.id));
});

router.post('/conversations/:id/toggle-auto-reply', async (req, res) => {
  const row = (await db.query('SELECT auto_reply FROM conversations WHERE id=$1', [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ error: 'conversation_not_found' });
  const next = row.auto_reply ? 0 : 1;
  await db.query('UPDATE conversations SET auto_reply=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [next, req.params.id]);
  res.json(await getConversation(req.params.id));
});

router.post('/conversations/:id/handoff', async (req, res) => {
  const data = await getConversation(req.params.id);
  if (!data.conversation) return res.status(404).json({ error: 'conversation_not_found' });
  const reason = req.body.reason || 'Nhân viên được yêu cầu xử lý thủ công';
  const message = req.body.message || data.messages?.slice(-1)[0]?.text || '';
  const alertId = await flagHandoff({
    conversationId: data.conversation.id,
    customerId: data.conversation.customer_id,
    channel: data.conversation.channel,
    reason,
    message,
    sourceGroup: data.conversation.source_group,
    sourceKey: data.conversation.source_key,
    sourceName: data.conversation.source_name
  });
  await notifyStaff(alertId, {
    channel: data.conversation.channel,
    externalUserId: data.conversation.external_id,
    intent: data.conversation.last_intent,
    reason,
    text: message,
    conversationId: data.conversation.id,
    sourceGroup: data.conversation.source_group,
    sourceKey: data.conversation.source_key,
    sourceName: data.conversation.source_name
  });
  res.json({ ok: true, alertId, data: await getConversation(req.params.id) });
});

router.post('/conversations/:id/resolve-handoff', async (req, res) => {
  const data = await getConversation(req.params.id);
  if (!data.conversation) return res.status(404).json({ error: 'conversation_not_found' });
  await resolveHandoff(req.params.id, req.body.note || '');
  res.json({ ok: true, data: await getConversation(req.params.id) });
});

router.post(
  '/conversations/:id/staff-media',
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: maxImageBytes() }),
  async (req, res) => {
    try {
      const data = await getConversation(req.params.id);
      if (!data.conversation) return res.status(404).json({ error: 'conversation_not_found' });
      if (data.conversation.channel !== 'haravan_website') {
        return res.status(400).json({ error: 'staff_reply_only_supports_website_chat' });
      }
      const media = saveWebsiteImage(req.body, data.conversation.external_id);
      res.json({ ok: true, media });
    } catch (e) {
      const status = e.message === 'image_too_large' ? 413
        : ['visitor_id_required', 'image_required', 'unsupported_image_type'].includes(e.message) ? 400
          : 500;
      res.status(status).json({ error: e.message });
    }
  }
);

router.post('/conversations/:id/staff-reply', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const data = await getConversation(req.params.id);
    if (!data.conversation) return res.status(404).json({ error: 'conversation_not_found' });
    const attachments = resolveWebsiteAttachments(
      req.body?.attachments,
      data.conversation.external_id
    ).map(({ id, token, mime, bytes, url }) => ({ id, token, mime, bytes, url }));
    if (!text && !attachments.length) return res.status(400).json({ error: 'reply_text_or_image_required' });
    const message = await addStaffReply(req.params.id, text, attachments);
    if (!message) return res.status(404).json({ error: 'conversation_not_found' });
    res.json({ ok: true, message, data: await getConversation(req.params.id) });
  } catch (e) {
    if (e.code === 'unsupported_channel') return res.status(400).json({ error: e.message });
    console.error('Staff reply error:', e);
    res.status(500).json({ error: 'staff_reply_failed' });
  }
});

router.post('/conversations/:id/summarize', async (req, res) => {
  const data = await getConversation(req.params.id);
  if (!data.conversation) return res.status(404).json({ error: 'conversation_not_found' });
  const customer = { profile_summary: data.conversation.profile_summary, interested_products: data.conversation.interested_products };
  const language = req.body.language || req.query.language || 'vi';
  const summary = await summarizeConversation({ messages: data.messages, customer, language });
  await updateConversationSummary(data.conversation.id, data.conversation.customer_id, summary);
  res.json({ ok: true, summary, data: await getConversation(req.params.id) });
});

router.post('/conversations/:id/reviews', async (req, res) => {
  try {
    const data = await getConversation(req.params.id);
    if (!data.conversation) return res.status(404).json({ error: 'conversation_not_found' });
    const message = (data.messages || []).find(item => item.id === req.body.messageId);
    const previousCustomer = [...(data.messages || [])]
      .slice(0, Math.max(0, (data.messages || []).findIndex(item => item.id === req.body.messageId)))
      .reverse()
      .find(item => item.direction === 'in');
    const review = await addAiReplyReview({
      sourceGroup: data.conversation.source_group || data.conversation.channel || '',
      sourceKey: data.conversation.source_key || '',
      sourceName: data.conversation.source_name || '',
      conversationId: data.conversation.id,
      messageId: req.body.messageId || '',
      issueType: req.body.issueType || 'wrong_reply',
      customerText: req.body.customerText || previousCustomer?.text || '',
      aiReply: req.body.aiReply || message?.text || '',
      notes: req.body.notes || ''
    });
    res.json({ ok: true, review, data: await getConversation(req.params.id) });
  } catch (e) {
    console.error('AI reply review error:', e);
    res.status(500).json({ error: 'ai_reply_review_failed' });
  }
});

router.get('/stats', async (req, res) => {
  const stats = { ...(await getStats()), products: loadProducts().length };
  res.json(stats);
});

router.get('/alerts', async (req, res) => res.json(await listStaffAlerts(req.query.status || 'open')));
router.get('/reply-reviews', async (req, res) => {
  res.json(await listAiReplyReviews({
    sourceKey: req.query.sourceKey || '',
    status: req.query.status || 'active',
    limit: req.query.limit || 100
  }));
});
router.get('/logs', (req, res) => {
  res.json({
    type: LOG_FILES[req.query.type] ? req.query.type : 'ai',
    entries: readLogEntries(req.query.type || 'ai', req.query.limit || 120)
  });
});
router.get('/search-products', (req, res) => res.json(searchProducts(req.query.q || '', 20, { sourceKey: req.query.sourceKey || '' })));

router.get('/knowledge-sources', (req, res) => {
  res.json(listKnowledgeSources());
});

router.get('/knowledge', (req, res) => {
  const result = readKnowledge(req.query.sourceKey || 'common');
  if (!result) return res.status(400).json({ error: 'invalid_source_key' });
  res.json(result);
});

router.get('/knowledge-files', (req, res) => {
  const sourceKey = normalizeKnowledgeSourceKey(req.query.sourceKey || 'common');
  if (!sourceKey) return res.status(400).json({ error: 'invalid_source_key' });
  res.json({
    sourceKey,
    files: Object.keys(TRAINING_FILES).map(type => trainingFileInfo(type, sourceKey))
  });
});

router.get('/knowledge/:type', (req, res) => {
  const sourceKey = normalizeKnowledgeSourceKey(req.query.sourceKey || 'common');
  const p = knowledgePath(req.params.type, sourceKey);
  if (!p) return res.status(400).json({ error: 'invalid_knowledge_type' });
  res.json({ sourceKey, type: req.params.type, content: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '' });
});

router.get('/knowledge-file/:type', (req, res) => {
  const sourceKey = normalizeKnowledgeSourceKey(req.query.sourceKey || 'common');
  const p = trainingFilePath(req.params.type, sourceKey);
  if (!sourceKey) return res.status(400).json({ error: 'invalid_source_key' });
  if (!p) return res.status(400).json({ error: 'invalid_training_file_type' });
  const info = trainingFileInfo(req.params.type, sourceKey);
  res.json({
    ok: true,
    sourceKey,
    type: req.params.type,
    content: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '',
    ...info
  });
});

router.put('/knowledge/:type', (req, res) => {
  const sourceKey = normalizeKnowledgeSourceKey(req.body.sourceKey || req.query.sourceKey || 'common');
  const p = knowledgePath(req.params.type, sourceKey);
  if (!p) return res.status(400).json({ error: 'invalid_knowledge_type' });
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, String(req.body.content || ''), 'utf8');
  res.json({ ok: true, sourceKey, type: req.params.type, bytes: Buffer.byteLength(String(req.body.content || ''), 'utf8') });
});

router.put('/knowledge-file/:type', express.text({ type: '*/*', limit: process.env.KNOWLEDGE_UPLOAD_LIMIT || '10mb' }), (req, res) => {
  const sourceKey = normalizeKnowledgeSourceKey(req.query.sourceKey || 'common');
  const p = trainingFilePath(req.params.type, sourceKey);
  if (!sourceKey) return res.status(400).json({ error: 'invalid_source_key' });
  if (!p) return res.status(400).json({ error: 'invalid_training_file_type' });
  const content = String(req.body || '').replace(/^\uFEFF/, '');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  res.json({ ok: true, sourceKey, type: req.params.type, bytes: Buffer.byteLength(content, 'utf8'), file: path.basename(p) });
});

module.exports = router;
