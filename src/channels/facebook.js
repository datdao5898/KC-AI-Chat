const axios = require('axios');
const crypto = require('crypto');
const { db, getOrCreateCustomer } = require('../db');

const profileCache = new Map();

function parseEnvMap(raw) {
  const result = {};
  const text = String(raw || '').trim();
  if (!text) return result;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}

  for (const entry of text.split(',')) {
    const [left, ...rest] = entry.split(':');
    const key = left && left.trim();
    const value = rest.join(':').trim();
    if (key && value) result[key] = value;
  }
  return result;
}

function extractPageId(context = {}) {
  const raw = context.raw || {};
  const source = context.source || {};
  const fromSourceKey = String(source.sourceKey || '').startsWith('facebook/')
    ? String(source.sourceKey).split('/')[1]
    : '';
  return raw?.recipient?.id || raw?.page_id || source.sourceId || fromSourceKey || process.env.FACEBOOK_PAGE_ID || '';
}

function getFacebookPageToken(pageId = '') {
  const tokens = parseEnvMap(process.env.FACEBOOK_PAGE_TOKENS || '');
  return tokens[String(pageId)] || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '';
}

function normalizeFacebookDisplayName(profile = {}) {
  const firstName = String(profile.first_name || '').trim();
  const lastName = String(profile.last_name || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || String(profile.name || '').trim();
}

async function getFacebookUserProfile(userId, context = {}) {
  const senderId = String(userId || '').trim();
  if (!senderId) return null;

  const pageId = extractPageId(context);
  const cacheKey = `${pageId || 'default'}:${senderId}`;
  const cached = profileCache.get(cacheKey);
  if (cached) return cached;

  const token = getFacebookPageToken(pageId);
  if (!token) return null;

  try {
    const url = `https://graph.facebook.com/v18.0/${encodeURIComponent(senderId)}`;
    const { data } = await axios.get(url, {
      params: {
        fields: 'first_name,last_name,profile_pic',
        access_token: token
      },
      timeout: 15000
    });
    const name = normalizeFacebookDisplayName(data);
    const profile = {
      id: String(data?.id || senderId),
      first_name: String(data?.first_name || '').trim(),
      last_name: String(data?.last_name || '').trim(),
      name,
      profile_pic: String(data?.profile_pic || '').trim(),
      pageId
    };
    if (profile.name) profileCache.set(cacheKey, profile);
    return profile;
  } catch (e) {
    console.warn('[FB PROFILE] failed_to_fetch', JSON.stringify({
      userId: senderId,
      pageId,
      error: e?.response?.data || e.message || String(e)
    }));
    return null;
  }
}

async function backfillFacebookCustomerNames() {
  if (process.env.FACEBOOK_BACKFILL_NAMES === 'false') return { skipped: true };

  const { rows } = await db.query(`
    SELECT cu.id, cu.external_id, cu.name,
      (
        SELECT c.source_key
        FROM conversations c
        WHERE c.customer_id = cu.id AND c.channel='facebook' AND COALESCE(c.source_key,'') LIKE 'facebook/%'
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT 1
      ) AS source_key
    FROM customers cu
    WHERE cu.channel='facebook' AND COALESCE(cu.name,'')=''
    ORDER BY cu.updated_at DESC, cu.id DESC
  `);

  let updated = 0;
  for (const row of rows) {
    const sourceKey = String(row.source_key || '').trim();
    const pageId = sourceKey.startsWith('facebook/') ? sourceKey.split('/')[1] : '';
    if (!pageId) continue;
    const profile = await getFacebookUserProfile(row.external_id, { raw: { recipient: { id: pageId } } });
    if (!profile?.name) continue;
    await getOrCreateCustomer('facebook', row.external_id, { name: profile.name });
    updated += 1;
  }

  return { updated, total: rows.length };
}

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

async function sendFacebookMessage(recipientId, text, context = {}) {
  const pageId = extractPageId(context);
  const token = getFacebookPageToken(pageId);
  if (!token) {
    console.log('[FB DRY SEND]', JSON.stringify({ recipientId, pageId, text }));
    return { dryRun: true, pageId };
  }
  const url = 'https://graph.facebook.com/v18.0/me/messages';
  const body = { recipient: { id: recipientId }, message: { text: text.slice(0, 1900) }, messaging_type: 'RESPONSE' };
  const { data } = await axios.post(url, body, { params: { access_token: token }, timeout: 15000 });
  return { ...data, pageId };
}
module.exports = { sendFacebookMessage, verifySignature, verifyHmacSignature, requireSignedWebhook, getFacebookPageToken, extractPageId, getFacebookUserProfile, normalizeFacebookDisplayName, backfillFacebookCustomerNames };
