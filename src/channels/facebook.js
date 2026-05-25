const axios = require('axios');
const crypto = require('crypto');

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifySignature(req) {
  const secret = process.env.FACEBOOK_APP_SECRET || '';
  if (!secret) return process.env.REQUIRE_WEBHOOK_SIGNATURES === 'false';
  const sig = req.headers['x-hub-signature-256'];
  if (!sig || !req.rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return safeEqual(sig, expected);
}

function verifyHmacSignature(req, secret, headerNames) {
  if (!secret) return process.env.REQUIRE_WEBHOOK_SIGNATURES === 'false';
  if (!req.rawBody) return false;
  const candidates = headerNames.flatMap(name => {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value : [value];
  }).filter(Boolean);
  if (!candidates.length) return false;
  const digest = crypto.createHmac('sha256', secret).update(req.rawBody).digest();
  const expected = [
    digest.toString('hex'),
    `sha256=${digest.toString('hex')}`,
    digest.toString('base64')
  ];
  return candidates.some(sig => expected.some(value => safeEqual(sig, value)));
}

function requireSignedWebhook(req, res, secret, headerNames, label) {
  if (verifyHmacSignature(req, secret, headerNames)) return true;
  if (!secret && process.env.REQUIRE_WEBHOOK_SIGNATURES !== 'false') {
    res.status(503).json({ error: `${label}_secret_not_configured` });
    return false;
  }
  res.status(401).json({ error: 'invalid_signature' });
  return false;
}

async function sendFacebookMessage(recipientId, text) {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) { console.log('[FB DRY SEND]', recipientId, text); return { dryRun: true }; }
  const url = 'https://graph.facebook.com/v18.0/me/messages';
  const body = { recipient: { id: recipientId }, message: { text: text.slice(0, 1900) }, messaging_type: 'RESPONSE' };
  const { data } = await axios.post(url, body, { params: { access_token: token }, timeout: 15000 });
  return data;
}
module.exports = { sendFacebookMessage, verifySignature, verifyHmacSignature, requireSignedWebhook };
