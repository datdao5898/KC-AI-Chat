const express = require('express');
const router = express.Router();
const { markProcessed, listWebsiteConversationMessages } = require('../db');
const { processIncoming } = require('../messagePipeline');
const { sendFacebookMessage, getFacebookUserProfile, verifySignature, requireSignedWebhook } = require('../channels/facebook');
const { sendZaloMessage } = require('../channels/zalo');
const { sendHaravanMessage } = require('../channels/haravan');

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
        if (!msg || !msg.text || msg.is_echo) continue;
        const mid = msg.mid || `${event.sender?.id}-${event.timestamp}`;
        if (!markProcessed('facebook', mid)) continue;
        const profile = await getFacebookUserProfile(event.sender.id, { raw: event });
        await processIncoming({
          channel: 'facebook',
          externalUserId: event.sender.id,
          text: msg.text,
          externalMessageId: mid,
          raw: event,
          customerAttrs: profile?.name ? { name: profile.name } : {},
          sendFn: sendFacebookMessage
        });
      }
    }
  } catch (e) { console.error('Facebook webhook error:', e); }
});

router.post('/zalo', async (req, res) => {
  try {
    if (!requireSignedWebhook(req, res, process.env.ZALO_APP_SECRET || '', ['x-zalo-signature', 'x-zalo-hmac-sha256', 'x-hub-signature-256'], 'zalo')) return;
    res.json({ ok: true });
    const body = req.body;
    const eventId = body.event_id || body.message?.msg_id || `${body.sender?.id || body.user_id}-${Date.now()}`;
    if (!markProcessed('zalo', eventId)) return;
    const userId = body.sender?.id || body.user_id || body.from_id;
    const text = body.message?.text || body.text || body.message || '';
    if (!userId || !text) return;
    await processIncoming({ channel: 'zalo', externalUserId: userId, text, externalMessageId: eventId, raw: body, sendFn: sendZaloMessage });
  } catch (e) { console.error('Zalo webhook error:', e); }
});

router.post('/haravan', async (req, res) => {
  try {
    if (!requireSignedWebhook(req, res, process.env.HARAVAN_WEBHOOK_SECRET || '', ['x-haravan-hmac-sha256', 'x-haravan-signature', 'x-shopify-hmac-sha256'], 'haravan')) return;
    res.json({ ok: true });
    const body = req.body;
    const eventId = body.id || body.webhook_id || `${body.customer?.id || body.visitor_id || 'unknown'}-${Date.now()}`;
    if (!markProcessed('haravan', eventId)) return;
    const userId = String(body.customer?.id || body.visitor_id || body.phone || 'haravan_unknown');
    const text = body.message || body.text || body.note || JSON.stringify(body).slice(0, 500);
    await processIncoming({ channel: 'haravan', externalUserId: userId, text, externalMessageId: eventId, raw: body, sendFn: sendHaravanMessage });
  } catch (e) { console.error('Haravan webhook error:', e); }
});

router.post('/website-chat', async (req, res) => {
  try {
    const { visitorId, message, name, phone, email, siteName, siteHost, siteUrl, origin, referrer } = req.body;
    const result = await processIncoming({
      channel: 'haravan_website',
      externalUserId: visitorId || phone || 'web-' + Date.now(),
      text: message,
      externalMessageId: 'web-' + Date.now(),
      raw: { ...req.body, siteName, siteHost, siteUrl, origin, referrer },
      customerAttrs: { name, phone, email },
      sendFn: null
    });
    res.json(result);
  } catch (e) { console.error('Website chat error:', e); res.status(500).json({ error: e.message }); }
});

router.get('/website-chat/messages', (req, res) => {
  const visitorId = String(req.query.visitorId || '').trim();
  if (!visitorId) return res.status(400).json({ error: 'visitor_id_required' });
  const result = listWebsiteConversationMessages(visitorId, req.query.since || '', req.query.limit || 20);
  res.json({ ok: true, ...result });
});

module.exports = router;
