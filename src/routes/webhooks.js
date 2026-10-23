const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const { markProcessed, listWebsiteConversationMessages, rateWebsiteConversation } = require('../db');
const { processIncoming } = require('../messagePipeline');
const { sendFacebookMessage, getFacebookUserProfile, verifySignature, requireSignedWebhook } = require('../channels/facebook');
const { sendZaloMessage, getZaloUserProfile, verifyZaloSignature, parseZaloEvent, parseZaloOaEvent, importZaloHistory, recordZaloStaffMessage, completeZaloConnect } = require('../channels/zalo');
const { sendHaravanMessage } = require('../channels/haravan');
const { extractFacebookImageUrls } = require('../mediaVision');

function parseLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function createWebsiteChatLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: parseLimit(process.env.WEBSITE_CHAT_RATE_LIMIT_PER_MINUTE, 20),
    standardHeaders: false,
    legacyHeaders: false,
    handler(req, res) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'too_many_requests', retry_after_seconds: 60 });
    }
  });
}

const websiteChatLimiter = createWebsiteChatLimiter();

router.get('/facebook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN;
  if (!verifyToken) return res.status(503).json({ error: 'facebook_verify_token_not_configured' });
  if (mode === 'subscribe' && token === verifyToken) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

router.post('/facebook', async (req, res) => {
  try {
    if (!verifySignature(req)) return res.status(process.env.FACEBOOK_APP_SECRET ? 401 : 503).json({ error: process.env.FACEBOOK_APP_SECRET ? 'invalid_signature' : 'facebook_secret_not_configured' });
    const body = req.body;
    const entryCount = Array.isArray(body?.entry) ? body.entry.length : 0;
    console.log('[FB WEBHOOK]', JSON.stringify({
      object: body?.object,
      keys: body && typeof body === 'object' ? Object.keys(body) : [],
      entryCount,
      hasSignature: Boolean(req.headers['x-hub-signature-256'])
    }));
    if (body.object !== 'page') {
      console.warn('[FB WEBHOOK] rejected_non_page_object', body?.object);
      return res.sendStatus(404);
    }
    res.status(200).send('EVENT_RECEIVED');
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const msg = event.message;
        const imageUrls = extractFacebookImageUrls(msg);
        if (!msg || msg.is_echo || (!msg.text && !imageUrls.length)) continue;
        const mid = msg.mid || `${event.sender?.id}-${event.timestamp}`;
        if (!await markProcessed('facebook', mid)) continue;
        const profile = await getFacebookUserProfile(event.sender.id, { raw: event });
        await processIncoming({
          channel: 'facebook',
          externalUserId: event.sender.id,
          text: msg.text,
          externalMessageId: mid,
          raw: event,
          imageUrls,
          customerAttrs: profile?.name ? { name: profile.name } : {},
          sendFn: sendFacebookMessage
        });
      }
    }
  } catch (e) { console.error('Facebook webhook error:', e); }
});

router.post('/zalo', async (req, res) => {
  try {
    // Zalo only saves the webhook URL if its test POST gets a 200, and retries any
    // non-200, so always acknowledge and simply drop events that fail verification.
    res.status(200).json({ ok: true });
    if (!verifyZaloSignature(req)) {
      const configured = Boolean(process.env.ZALO_OA_SECRET_KEY);
      console.warn('[ZALO WEBHOOK] ignored', JSON.stringify({ reason: configured ? 'invalid_signature' : 'secret_not_configured', event: req.body?.event_name }));
      return;
    }
    const staffEvent = parseZaloOaEvent(req.body);
    if (staffEvent) {
      if (!await markProcessed('zalo', staffEvent.messageId)) return;
      const result = await recordZaloStaffMessage(staffEvent);
      if (result.saved) console.log('[ZALO STAFF] recorded', JSON.stringify({ userId: staffEvent.userId, conversationId: result.conversationId }));
      return;
    }
    const event = parseZaloEvent(req.body);
    if (!event) return;
    if (!await markProcessed('zalo', event.messageId)) return;
    const profile = await getZaloUserProfile(event.userId, { raw: req.body });
    await importZaloHistory({
      userId: event.userId,
      oaId: event.oaId,
      excludeMessageId: event.messageId,
      before: Number(req.body.timestamp) || Date.now(),
      customerAttrs: profile?.name ? { name: profile.name } : {}
    }).catch(e => console.warn('[ZALO HISTORY] import_failed', JSON.stringify({ userId: event.userId, error: e.message })));
    await processIncoming({
      channel: 'zalo',
      externalUserId: event.userId,
      text: event.text,
      externalMessageId: event.messageId,
      raw: req.body,
      imageUrls: event.imageUrls,
      customerAttrs: profile?.name ? { name: profile.name } : {},
      sendFn: sendZaloMessage
    });
  } catch (e) { console.error('Zalo webhook error:', e); }
});

router.get('/zalo/oauth-callback', async (req, res) => {
  try {
    const result = await completeZaloConnect(req.query);
    console.log('[ZALO OAUTH] connected', JSON.stringify(result));
    res.type('html').send(`<meta charset="utf-8"><p>Đã kết nối Zalo OA ${result.oaId}. Có thể đóng trang này.</p>`);
  } catch (e) {
    console.error('[ZALO OAUTH] failed', e.message);
    res.status(400).type('html').send('<meta charset="utf-8"><p>Kết nối Zalo OA thất bại. Mở lại /api/zalo/connect để thử lại.</p>');
  }
});

router.post('/haravan', async (req, res) => {
  try {
    if (!requireSignedWebhook(req, res, process.env.HARAVAN_WEBHOOK_SECRET || '', ['x-haravan-hmac-sha256', 'x-haravan-signature', 'x-shopify-hmac-sha256'], 'haravan')) return;
    res.json({ ok: true });
    const body = req.body;
    const eventId = body.id || body.webhook_id || `${body.customer?.id || body.visitor_id || 'unknown'}-${Date.now()}`;
    if (!await markProcessed('haravan', eventId)) return;
    const userId = String(body.customer?.id || body.visitor_id || body.phone || 'haravan_unknown');
    const text = body.message || body.text || body.note || JSON.stringify(body).slice(0, 500);
    await processIncoming({ channel: 'haravan', externalUserId: userId, text, externalMessageId: eventId, raw: body, sendFn: sendHaravanMessage });
  } catch (e) { console.error('Haravan webhook error:', e); }
});

router.post('/website-chat', websiteChatLimiter, async (req, res) => {
  try {
    const { visitorId, message, name, phone, email, siteName, siteHost, siteUrl, origin, referrer } = req.body;
    if (Array.isArray(req.body?.attachments) && req.body.attachments.length) {
      return res.status(400).json({ error: 'website_images_not_supported' });
    }
    if (!String(message || '').trim()) return res.status(400).json({ error: 'message_required' });
    const result = await processIncoming({
      channel: 'haravan_website',
      externalUserId: visitorId || phone || 'web-' + Date.now(),
      text: message,
      externalMessageId: 'web-' + Date.now(),
      raw: {
        ...req.body,
        attachments: undefined,
        siteName,
        siteHost,
        siteUrl,
        origin,
        referrer
      },
      customerAttrs: { name, phone, email },
      sendFn: null
    });
    res.json(result);
  } catch (e) { console.error('Website chat error:', e); res.status(500).json({ error: e.message }); }
});

router.get('/website-chat/messages', async (req, res) => {
  const visitorId = String(req.query.visitorId || '').trim();
  if (!visitorId) return res.status(400).json({ error: 'visitor_id_required' });
  const result = await listWebsiteConversationMessages(visitorId, req.query.since || '', req.query.limit || 20);
  res.json({ ok: true, ...result });
});

router.post('/website-chat/rating', websiteChatLimiter, async (req, res) => {
  try {
    const conversation = await rateWebsiteConversation(
      req.body?.visitorId,
      req.body?.conversationId,
      req.body?.rating,
      req.body?.feedback
    );
    if (!conversation) return res.status(404).json({ error: 'conversation_not_found' });
    return res.json({
      ok: true,
      conversationId: conversation.id,
      rating: conversation.customer_rating,
      feedback: conversation.customer_rating_feedback || '',
      ratedAt: conversation.customer_rated_at
    });
  } catch (error) {
    if (['visitor_id_required', 'invalid_rating'].includes(error.code)) {
      return res.status(400).json({ error: error.code });
    }
    console.error('Website chat rating error:', error);
    return res.status(500).json({ error: 'rating_failed' });
  }
});

module.exports = router;
