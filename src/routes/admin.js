const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { listConversations, getConversation, updateConversationSummary, db, flagHandoff, resolveHandoff, listStaffAlerts, softDeleteMessage, softDeleteConversation, addStaffReply } = require('../db');
const { searchProducts, loadProducts } = require('../rag');
const { summarizeConversation, summarizeConversationFast } = require('../ai');
const { notifyStaff } = require('../staffAlert');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const KNOWLEDGE_FILES = { faq: 'faq.md', policies: 'policies.md', catalog_summary: 'catalog_summary.md' };

function knowledgePath(type) {
  const file = KNOWLEDGE_FILES[type];
  if (!file) return null;
  return path.join(DATA_DIR, file);
}

router.get('/conversations', (req, res) => res.json(listConversations()));
router.get('/conversations/:id', (req, res) => res.json(getConversation(req.params.id)));

router.delete('/messages/:id', (req, res) => {
  const result = softDeleteMessage(req.params.id);
  if (!result) return res.status(404).json({ error: 'message_not_found' });
  if (!result.conversation_id) return res.json({ ok: true, deleted: true });
  const data = getConversation(result.conversation_id);
  if (data.conversation) {
    const summary = summarizeConversationFast({ messages: data.messages, customer: data.conversation });
    updateConversationSummary(data.conversation.id, data.conversation.customer_id, summary);
  }
  res.json({ ok: true, deleted: true, data: getConversation(result.conversation_id) });
});

router.delete('/conversations/:id', (req, res) => {
  const result = softDeleteConversation(req.params.id);
  if (!result) return res.status(404).json({ error: 'conversation_not_found' });
  res.json({ ok: true, deleted: true, conversationId: req.params.id });
});

router.patch('/conversations/:id', (req, res) => {
  const { status, auto_reply, summary } = req.body;
  if (status !== undefined) db.prepare('UPDATE conversations SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.id);
  if (auto_reply !== undefined) db.prepare('UPDATE conversations SET auto_reply=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(auto_reply ? 1 : 0, req.params.id);
  if (summary !== undefined) db.prepare('UPDATE conversations SET summary=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(summary, req.params.id);
  res.json(getConversation(req.params.id));
});

router.post('/conversations/:id/toggle-auto-reply', (req, res) => {
  const row = db.prepare('SELECT auto_reply FROM conversations WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'conversation_not_found' });
  const next = row.auto_reply ? 0 : 1;
  db.prepare('UPDATE conversations SET auto_reply=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(next, req.params.id);
  res.json(getConversation(req.params.id));
});

router.post('/conversations/:id/handoff', async (req, res) => {
  const data = getConversation(req.params.id);
  if (!data.conversation) return res.status(404).json({ error: 'conversation_not_found' });
  const reason = req.body.reason || 'Nhân viên được yêu cầu xử lý thủ công';
  const message = req.body.message || data.messages?.slice(-1)[0]?.text || '';
  const alertId = flagHandoff({
    conversationId: data.conversation.id,
    customerId: data.conversation.customer_id,
    channel: data.conversation.channel,
    reason,
    message,
    disableAutoReply: req.body.disableAutoReply !== false,
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
  res.json({ ok: true, alertId, data: getConversation(req.params.id) });
});

router.post('/conversations/:id/resolve-handoff', (req, res) => {
  const data = getConversation(req.params.id);
  if (!data.conversation) return res.status(404).json({ error: 'conversation_not_found' });
  resolveHandoff(req.params.id, req.body.note || '');
  res.json({ ok: true, data: getConversation(req.params.id) });
});

router.post('/conversations/:id/staff-reply', (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'reply_text_required' });
    const message = addStaffReply(req.params.id, text);
    if (!message) return res.status(404).json({ error: 'conversation_not_found' });
    res.json({ ok: true, message, data: getConversation(req.params.id) });
  } catch (e) {
    if (e.code === 'unsupported_channel') return res.status(400).json({ error: e.message });
    console.error('Staff reply error:', e);
    res.status(500).json({ error: 'staff_reply_failed' });
  }
});

router.post('/conversations/:id/summarize', async (req, res) => {
  const data = getConversation(req.params.id);
  if (!data.conversation) return res.status(404).json({ error: 'conversation_not_found' });
  const customer = { profile_summary: data.conversation.profile_summary, interested_products: data.conversation.interested_products };
  const language = req.body.language || req.query.language || 'vi';
  const summary = await summarizeConversation({ messages: data.messages, customer, language });
  updateConversationSummary(data.conversation.id, data.conversation.customer_id, summary);
  res.json({ ok: true, summary, data: getConversation(req.params.id) });
});

router.get('/stats', (req, res) => {
  const stats = {
    customers: db.prepare('SELECT COUNT(*) n FROM customers').get().n,
    conversations: db.prepare("SELECT COUNT(*) n FROM conversations WHERE COALESCE(deleted_at,'')=''").get().n,
    messages: db.prepare("SELECT COUNT(*) n FROM messages WHERE COALESCE(deleted_at,'')=''").get().n,
    products: loadProducts().length,
    needs_human: db.prepare("SELECT COUNT(*) n FROM conversations WHERE needs_human=1 AND COALESCE(deleted_at,'')=''").get().n,
    open_alerts: db.prepare("SELECT COUNT(*) n FROM staff_alerts a JOIN conversations c ON c.id=a.conversation_id WHERE a.status='open' AND COALESCE(c.deleted_at,'')=''").get().n
  };
  res.json(stats);
});

router.get('/alerts', (req, res) => res.json(listStaffAlerts(req.query.status || 'open')));
router.get('/search-products', (req, res) => res.json(searchProducts(req.query.q || '', 20, { sourceKey: req.query.sourceKey || '' })));

router.get('/knowledge', (req, res) => {
  const result = {};
  for (const [type, file] of Object.entries(KNOWLEDGE_FILES)) {
    const p = path.join(DATA_DIR, file);
    result[type] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }
  res.json(result);
});

router.get('/knowledge/:type', (req, res) => {
  const p = knowledgePath(req.params.type);
  if (!p) return res.status(400).json({ error: 'invalid_knowledge_type' });
  res.json({ type: req.params.type, content: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '' });
});

router.put('/knowledge/:type', (req, res) => {
  const p = knowledgePath(req.params.type);
  if (!p) return res.status(400).json({ error: 'invalid_knowledge_type' });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(p, String(req.body.content || ''), 'utf8');
  res.json({ ok: true, type: req.params.type, bytes: Buffer.byteLength(String(req.body.content || ''), 'utf8') });
});

module.exports = router;
