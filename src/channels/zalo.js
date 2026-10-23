const axios = require('axios');
const crypto = require('crypto');
const { db, getSetting, setSetting, markProcessed, getOrCreateCustomer, getOrCreateConversation, saveMessage } = require('../db');
const { buildSourceContext } = require('../sourceRegistry');
const { isAllowedZaloMediaUrl } = require('../mediaVision');

// Zalo OA Open API v3. Access tokens live ~25h and refresh tokens are single-use
// (each refresh returns a new one), so tokens are kept in app_settings per OA and
// rotated there; env tokens only seed the first run.
const OAUTH_BASE = 'https://oauth.zaloapp.com/v4/oa';
const API_BASE = 'https://openapi.zalo.me';
const TOKENS_KEY = 'zalo_oa_tokens';
const OAUTH_STATE_KEY = 'zalo_oauth_state';
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const MAX_TEXT = 2000;
const MAX_IMAGES = 3;
// processed_events channel holding message ids the AI sent, to tell them apart from staff replies.
const AI_SENT_CHANNEL = 'zalo_ai_sent';
// Zalo error codes meaning the access token is invalid or expired.
const TOKEN_ERROR_CODES = new Set([-216, -124]);

const refreshInFlight = new Map();
const profileCache = new Map();

function getAppId() {
  return String(process.env.ZALO_APP_ID || '').trim();
}

function getAppSecret() {
  return String(process.env.ZALO_APP_SECRET || '').trim();
}

function zaloError(data, fallback) {
  const error = new Error(`Zalo ${fallback}: ${data?.message || data?.error_description || data?.error_name || JSON.stringify(data)}`);
  error.zaloCode = Number(data?.error);
  return error;
}

async function readTokens() {
  const stored = await getSetting(TOKENS_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

async function writeOaTokens(oaId, tokens) {
  const all = await readTokens();
  all[oaId] = { ...all[oaId], ...tokens, updated_at: new Date().toISOString() };
  await setSetting(TOKENS_KEY, all);
  return all[oaId];
}

function seedFromEnv() {
  const accessToken = String(process.env.ZALO_OA_ACCESS_TOKEN || '').trim();
  const refreshToken = String(process.env.ZALO_OA_REFRESH_TOKEN || '').trim();
  if (!accessToken && !refreshToken) return null;
  // Env access token has unknown age: treat it as already expiring when a refresh token is available.
  return { access_token: accessToken, refresh_token: refreshToken, expires_at: refreshToken ? 0 : Number.MAX_SAFE_INTEGER };
}

async function resolveOaId(oaId = '') {
  const id = String(oaId || '').trim();
  if (id) return id;
  if (process.env.ZALO_OA_ID) return String(process.env.ZALO_OA_ID).trim();
  const ids = Object.keys(await readTokens());
  return ids.length === 1 ? ids[0] : 'default';
}

async function requestToken(params) {
  const appId = getAppId();
  const secret = getAppSecret();
  if (!appId || !secret) throw new Error('ZALO_APP_ID/ZALO_APP_SECRET not configured');
  const body = new URLSearchParams({ app_id: appId, ...params });
  const { data } = await axios.post(`${OAUTH_BASE}/access_token`, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: secret },
    timeout: 15000
  });
  if (!data?.access_token) throw zaloError(data, 'token request failed');
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + Number(data.expires_in || 90000) * 1000
  };
}

async function refreshOaToken(oaId) {
  if (refreshInFlight.has(oaId)) return refreshInFlight.get(oaId);
  const task = (async () => {
    const all = await readTokens();
    const current = all[oaId] || (all.default ? all.default : seedFromEnv());
    if (!current?.refresh_token) throw new Error(`Zalo OA ${oaId}: no refresh token, reconnect via /api/zalo/connect`);
    const tokens = await requestToken({ grant_type: 'refresh_token', refresh_token: current.refresh_token });
    console.log('[ZALO TOKEN] refreshed', JSON.stringify({ oaId, expiresAt: new Date(tokens.expires_at).toISOString() }));
    return writeOaTokens(oaId, tokens);
  })().finally(() => refreshInFlight.delete(oaId));
  refreshInFlight.set(oaId, task);
  return task;
}

async function getAccessToken(oaId, { forceRefresh = false } = {}) {
  const all = await readTokens();
  const current = all[oaId] || all.default || seedFromEnv();
  if (!current) return '';
  const fresh = current.access_token && Number(current.expires_at || 0) - Date.now() > REFRESH_MARGIN_MS;
  if (fresh && !forceRefresh) return current.access_token;
  if (!current.refresh_token || !getAppId()) return current.access_token || '';
  return (await refreshOaToken(oaId)).access_token;
}

// Calls an OA endpoint, refreshing the token once if Zalo reports it invalid.
async function callOaApi(oaId, request) {
  let token = await getAccessToken(oaId);
  if (!token) return { dryRun: true };
  for (let attempt = 0; ; attempt += 1) {
    const { data } = await axios({ ...request, headers: { ...request.headers, access_token: token }, timeout: 15000 });
    if (Number(data?.error || 0) === 0) return data;
    if (attempt === 0 && TOKEN_ERROR_CODES.has(Number(data.error))) {
      token = await getAccessToken(oaId, { forceRefresh: true });
      continue;
    }
    throw zaloError(data, request.url);
  }
}

function extractOaId(context = {}) {
  const raw = context.raw || {};
  const sourceKey = String(context.source?.sourceKey || '');
  const fromSourceKey = sourceKey.startsWith('zalo/') ? sourceKey.split('/')[1] : '';
  return raw?.recipient?.id || raw?.oa_id || context.source?.sourceId || fromSourceKey || '';
}

// Splits on paragraph/line/space boundaries so long replies arrive as whole messages.
function splitZaloText(text, max = MAX_TEXT) {
  const chunks = [];
  let rest = String(text || '').trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '));
    const at = cut > max * 0.5 ? cut : max;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function sendZaloMessage(userId, text, context = {}) {
  const oaId = await resolveOaId(extractOaId(context));
  const results = [];
  for (const chunk of splitZaloText(text)) {
    const data = await callOaApi(oaId, {
      method: 'post',
      url: `${API_BASE}/v3.0/oa/message/cs`,
      data: { recipient: { user_id: userId }, message: { text: chunk } }
    });
    if (data.dryRun) {
      console.log('[ZALO DRY SEND]', JSON.stringify({ userId, oaId, text }));
      return { dryRun: true, oaId };
    }
    const messageId = data.data?.message_id;
    if (messageId) await markProcessed(AI_SENT_CHANNEL, String(messageId)).catch(() => {});
    results.push(messageId);
  }
  return { oaId, messageIds: results };
}

async function getZaloUserProfile(userId, context = {}) {
  const id = String(userId || '').trim();
  if (!id) return null;
  const oaId = await resolveOaId(extractOaId(context));
  const cacheKey = `${oaId}:${id}`;
  if (profileCache.has(cacheKey)) return profileCache.get(cacheKey);
  try {
    const data = await callOaApi(oaId, {
      method: 'get',
      url: `${API_BASE}/v3.0/oa/user/detail`,
      params: { data: JSON.stringify({ user_id: id }) }
    });
    if (data.dryRun) return null;
    const profile = { id, name: String(data.data?.display_name || '').trim(), oaId };
    if (profile.name) profileCache.set(cacheKey, profile);
    return profile;
  } catch (e) {
    console.warn('[ZALO PROFILE] failed_to_fetch', JSON.stringify({ userId: id, oaId, error: e.message }));
    return null;
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Zalo signs webhooks as X-ZEvent-Signature: mac=sha256(appId + body + timestamp + OA secret key).
function verifyZaloSignature(req) {
  const secret = String(process.env.ZALO_OA_SECRET_KEY || '').trim();
  if (!secret) return process.env.REQUIRE_WEBHOOK_SIGNATURES === 'false';
  const header = String(req.headers['x-zevent-signature'] || '').trim();
  if (!header || !req.rawBodyText) return false;
  const body = req.body || {};
  const appId = String(body.app_id || getAppId());
  const mac = crypto.createHash('sha256').update(appId + req.rawBodyText + String(body.timestamp || '') + secret).digest('hex');
  return safeEqual(header.replace(/^mac=/i, ''), mac);
}

function extractZaloImageUrls(message = {}) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  return [...new Set(attachments
    .filter(attachment => String(attachment?.type || '').toLowerCase() === 'image')
    .map(attachment => attachment?.payload?.url)
    .filter(isAllowedZaloMediaUrl))]
    .slice(0, MAX_IMAGES);
}

// Normalizes a webhook body into an incoming customer message, or null for events
// the AI should not answer (OA/staff echoes, follows, seen receipts, stickers...).
function parseZaloEvent(body = {}) {
  const eventName = String(body.event_name || '');
  if (!['user_send_text', 'user_send_image'].includes(eventName)) return null;
  const message = body.message || {};
  const userId = String(body.sender?.id || '').trim();
  const text = String(message.text || '').trim();
  const imageUrls = eventName === 'user_send_image' ? extractZaloImageUrls(message) : [];
  if (!userId || (!text && !imageUrls.length)) return null;
  return {
    userId,
    oaId: String(body.recipient?.id || '').trim(),
    messageId: String(message.msg_id || `${userId}-${body.timestamp || Date.now()}`),
    text,
    imageUrls
  };
}

// Messages the OA sent (typed by staff in the Zalo OA inbox, or by the AI through the
// API). Zalo reports both as oa_send_*; the webhook drops the AI's own ones.
function parseZaloOaEvent(body = {}) {
  const eventName = String(body.event_name || '');
  if (!eventName.startsWith('oa_send_')) return null;
  const message = body.message || {};
  const userId = String(body.recipient?.id || '').trim();
  const messageId = String(message.msg_id || '').trim();
  if (!userId || !messageId) return null;
  const type = eventName.replace('oa_send_', '');
  return {
    userId,
    oaId: String(body.sender?.id || '').trim(),
    messageId,
    text: String(message.text || '').trim() || mediaLabel(type),
    time: Number(body.timestamp) || Date.now()
  };
}

function mediaLabel(type = '') {
  const labels = { photo: 'Hình ảnh', image: 'Hình ảnh', gif: 'GIF', sticker: 'Sticker', voice: 'Tin nhắn thoại', audio: 'Tin nhắn thoại', file: 'File', video: 'Video', location: 'Vị trí', link: 'Link', links: 'Link', list: 'Danh sách' };
  return `[${labels[String(type).toLowerCase()] || type || 'Tin nhắn'}]`;
}

function zaloConversationFor(userId, oaId, customerAttrs = {}) {
  const source = buildSourceContext({ channel: 'zalo', raw: { oa_id: oaId } });
  return getOrCreateCustomer('zalo', userId, customerAttrs).then(async customer => ({
    source,
    customer,
    conversation: await getOrCreateConversation(customer.id, 'zalo', source.sourceKey, source.sourceName, source.sourceGroup)
  }));
}

// Recent chat between the OA and a user, oldest first (Zalo pages 10 messages per call).
async function fetchZaloHistory(userId, oaId, limit = Number(process.env.ZALO_HISTORY_IMPORT_LIMIT || 20)) {
  const resolvedOaId = await resolveOaId(oaId);
  const messages = [];
  for (let offset = 0; offset < limit; offset += 10) {
    const data = await callOaApi(resolvedOaId, {
      method: 'get',
      url: `${API_BASE}/v2.0/oa/conversation`,
      params: { data: JSON.stringify({ user_id: userId, offset, count: Math.min(10, limit - offset) }) }
    });
    if (data.dryRun) return [];
    const page = Array.isArray(data.data) ? data.data : [];
    messages.push(...page);
    if (page.length < 10) break;
  }
  return messages
    .map(item => ({
      messageId: String(item.message_id || ''),
      fromCustomer: Number(item.src) === 1,
      text: item.type === 'text' ? String(item.message || '').trim() : mediaLabel(item.type),
      time: Number(item.time) || 0
    }))
    .filter(item => item.messageId && item.text && item.time)
    .sort((a, b) => a.time - b.time);
}

// The first time a Zalo user shows up after the integration, copy the recent
// customer/staff chat from Zalo so the AI and the dashboard see what was said.
async function importZaloHistory({ userId, oaId, excludeMessageId = '', before = Date.now(), customerAttrs = {} }) {
  if (process.env.ZALO_HISTORY_IMPORT_ENABLED === 'false') return { skipped: 'disabled' };
  const { source, customer, conversation } = await zaloConversationFor(userId, oaId, customerAttrs);
  const existing = await db.query('SELECT 1 FROM messages WHERE conversation_id=$1 LIMIT 1', [conversation.id]);
  if (existing.rows.length) return { skipped: 'has_messages' };
  const history = (await fetchZaloHistory(userId, oaId))
    .filter(item => item.messageId !== excludeMessageId && item.time < before);
  for (const item of history) {
    await saveMessage({
      conversationId: conversation.id,
      customerId: customer.id,
      channel: 'zalo',
      externalMessageId: item.messageId,
      direction: item.fromCustomer ? 'in' : 'out',
      senderType: item.fromCustomer ? 'customer' : 'staff',
      text: item.text,
      rawJson: { source: 'zalo_history_import' },
      deliveryStatus: item.fromCustomer ? '' : 'sent_by_staff',
      sourceGroup: source.sourceGroup,
      sourceKey: source.sourceKey,
      sourceName: source.sourceName,
      createdAt: item.time
    });
  }
  console.log('[ZALO HISTORY] imported', JSON.stringify({ userId, conversationId: conversation.id, count: history.length }));
  return { imported: history.length, conversationId: conversation.id };
}

async function isAiSentMessage(event) {
  const marked = await db.query('SELECT 1 FROM processed_events WHERE channel=$1 AND external_event_id=$2 LIMIT 1', [AI_SENT_CHANNEL, event.messageId]);
  if (marked.rows.length) return true;
  // Fallback when Zalo's message id differs: the AI just sent this exact text.
  const recentAi = await db.query(`
    SELECT m.text FROM messages m
    JOIN customers cu ON cu.id = m.customer_id
    WHERE cu.channel='zalo' AND cu.external_id=$1 AND m.sender_type='ai'
    ORDER BY m.created_at DESC LIMIT 3
  `, [event.userId]);
  return recentAi.rows.some(row => event.text.length > 0 && String(row.text || '').includes(event.text));
}

// Stores a reply staff typed in the Zalo OA inbox as a staff message of the conversation.
async function recordZaloStaffMessage(event) {
  // The AI's own sends echo back as oa_send_* within seconds; give its send/save time to land.
  const echoWaitMs = Number(process.env.ZALO_OA_ECHO_WAIT_MS ?? 4000);
  if (echoWaitMs > 0) await new Promise(resolve => setTimeout(resolve, echoWaitMs));
  if (await isAiSentMessage(event)) return { skipped: 'ai_message' };
  await importZaloHistory({ userId: event.userId, oaId: event.oaId, excludeMessageId: event.messageId, before: event.time });
  const { source, customer, conversation } = await zaloConversationFor(event.userId, event.oaId);
  const message = await saveMessage({
    conversationId: conversation.id,
    customerId: customer.id,
    channel: 'zalo',
    externalMessageId: event.messageId,
    direction: 'out',
    senderType: 'staff',
    text: event.text,
    rawJson: { source: 'zalo_oa_inbox' },
    intent: 'staff_reply',
    deliveryStatus: 'sent_by_staff',
    sourceGroup: source.sourceGroup,
    sourceKey: source.sourceKey,
    sourceName: source.sourceName,
    createdAt: event.time
  });
  return { saved: message.id, conversationId: conversation.id };
}

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getOAuthRedirectUri() {
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return process.env.ZALO_OAUTH_REDIRECT_URI || `${base}/webhooks/zalo/oauth-callback`;
}

// Starts the "connect OA" flow (PKCE). The OA admin approves in Zalo, which then
// redirects to /webhooks/zalo/oauth-callback with a code we exchange for tokens.
async function buildZaloConnectUrl() {
  const appId = getAppId();
  if (!appId || !getAppSecret()) throw new Error('ZALO_APP_ID/ZALO_APP_SECRET not configured');
  const verifier = base64Url(crypto.randomBytes(32));
  const state = base64Url(crypto.randomBytes(16));
  await setSetting(OAUTH_STATE_KEY, { state, verifier, created_at: Date.now() });
  const params = new URLSearchParams({
    app_id: appId,
    redirect_uri: getOAuthRedirectUri(),
    code_challenge: base64Url(crypto.createHash('sha256').update(verifier).digest()),
    state
  });
  return `${OAUTH_BASE}/permission?${params}`;
}

async function completeZaloConnect({ code, state, oa_id: oaIdParam }) {
  const pending = await getSetting(OAUTH_STATE_KEY);
  if (!pending || !state || !safeEqual(pending.state, state) || Date.now() - pending.created_at > 15 * 60 * 1000) {
    throw new Error('invalid_or_expired_state');
  }
  if (!code) throw new Error('missing_code');
  const tokens = await requestToken({ grant_type: 'authorization_code', code, code_verifier: pending.verifier });
  await setSetting(OAUTH_STATE_KEY, null);
  const oaId = String(oaIdParam || process.env.ZALO_OA_ID || 'default');
  await writeOaTokens(oaId, tokens);
  return { oaId, expiresAt: new Date(tokens.expires_at).toISOString() };
}

async function getZaloStatus() {
  const all = await readTokens();
  return {
    appIdConfigured: Boolean(getAppId()),
    appSecretConfigured: Boolean(getAppSecret()),
    webhookSecretConfigured: Boolean(process.env.ZALO_OA_SECRET_KEY),
    webhookUrl: `${String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')}/webhooks/zalo`,
    oauthRedirectUri: getOAuthRedirectUri(),
    envTokenSeed: Boolean(seedFromEnv()),
    oas: Object.entries(all).map(([oaId, t]) => ({
      oaId,
      hasRefreshToken: Boolean(t.refresh_token),
      accessTokenExpiresAt: t.expires_at ? new Date(t.expires_at).toISOString() : null,
      updatedAt: t.updated_at || null
    }))
  };
}

// Refresh tokens expire ~3 months after issue unless used, so refresh every OA on a
// timer even when no customer writes in.
function startZaloTokenScheduler() {
  if (!getAppId() || !getAppSecret()) return null;
  const run = async () => {
    const all = await readTokens();
    const ids = Object.keys(all).length ? Object.keys(all) : (seedFromEnv()?.refresh_token ? [await resolveOaId()] : []);
    for (const oaId of ids) {
      await getAccessToken(oaId).catch(e => console.error('[ZALO TOKEN] refresh_failed', JSON.stringify({ oaId, error: e.message })));
    }
  };
  run();
  const timer = setInterval(run, 30 * 60 * 1000);
  timer.unref?.();
  return timer;
}

module.exports = {
  sendZaloMessage,
  getZaloUserProfile,
  verifyZaloSignature,
  parseZaloEvent,
  parseZaloOaEvent,
  fetchZaloHistory,
  importZaloHistory,
  recordZaloStaffMessage,
  extractZaloImageUrls,
  splitZaloText,
  buildZaloConnectUrl,
  completeZaloConnect,
  getZaloStatus,
  startZaloTokenScheduler
};
