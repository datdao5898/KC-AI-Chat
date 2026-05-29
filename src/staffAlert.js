const fs = require('fs');
const path = require('path');
const https = require('https');
const { updateAlertDelivery } = require('./db');

const ALERT_LOG = path.join(__dirname, '..', 'data', 'staff_alerts.log');

function requestJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }
    }, res => {
      let body = '';
      res.on('data', d => body += d.toString());
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(`HTTP ${res.statusCode}: ${body}`));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getLarkTenantToken() {
  const appId = process.env.LARK_APP_ID || process.env.FEISHU_APP_ID || '';
  const appSecret = process.env.LARK_APP_SECRET || process.env.FEISHU_APP_SECRET || '';
  if (!appId || !appSecret) throw new Error('LARK_APP_ID/LARK_APP_SECRET not configured');
  const body = await requestJson('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: appId,
    app_secret: appSecret
  });
  const data = JSON.parse(body);
  if (data.code !== 0 || !data.tenant_access_token) throw new Error(`Lark token error: ${body}`);
  return data.tenant_access_token;
}

function parseLarkReceiveIds() {
  const raw = [
    process.env.LARK_RECEIVE_IDS || '',
    process.env.LARK_RECEIVE_ID || '',
    process.env.LARK_CHAT_ID || '',
    process.env.FEISHU_RECEIVE_IDS || '',
    process.env.FEISHU_RECEIVE_ID || '',
    process.env.FEISHU_CHAT_ID || ''
  ].filter(Boolean).join(',');
  return [...new Set(raw.split(',').map(v => v.trim()).filter(Boolean))];
}

async function sendLarkMessage(message) {
  const receiveIds = parseLarkReceiveIds();
  const receiveIdType = process.env.LARK_RECEIVE_ID_TYPE || process.env.FEISHU_RECEIVE_ID_TYPE || 'chat_id';
  if (!receiveIds.length) throw new Error('LARK_RECEIVE_ID not configured');
  const token = await getLarkTenantToken();
  const results = [];
  const errors = [];

  for (const receiveId of receiveIds) {
    try {
      const body = await requestJson(`https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`, {
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text: message })
      }, { Authorization: `Bearer ${token}` });
      const data = JSON.parse(body);
      if (data.code !== 0) throw new Error(`Lark send error: ${body}`);
      results.push({ receiveId, messageId: data.data?.message_id || 'sent' });
    } catch (e) {
      errors.push({ receiveId, error: e.message });
    }
  }

  if (!results.length) {
    throw new Error(errors.map(e => `${e.receiveId}: ${e.error}`).join(' | ') || 'Lark send error');
  }

  return results;
}

function buildDashboardUrl(conversationId) {
  const base = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8660}`;
  return `${base}/?conversation=${encodeURIComponent(conversationId)}`;
}

function formatWebsiteMessageAlert({ externalUserId, text, conversationId, sourceName, sourceKey, customer }) {
  const name = String(customer?.name || '').trim();
  const phone = String(customer?.phone || '').trim();
  const email = String(customer?.email || '').trim();
  const contactLine = [
    name ? `Name: ${name}` : '',
    phone ? `Phone: ${phone}` : '',
    email ? `Email: ${email}` : ''
  ].filter(Boolean).join('\n');

  return `KingCom website message

Source: ${sourceName || sourceKey || 'Website'}
Visitor: ${externalUserId}
${contactLine ? `${contactLine}\n` : ''}
Customer message:
"${text}"

Dashboard:
${buildDashboardUrl(conversationId)}`;
}

function formatAlert({ channel, externalUserId, intent, reason, text, conversationId, sourceGroup, sourceName, sourceKey }) {
  const sourceLine = [sourceGroup ? `Source group: ${sourceGroup}` : '', sourceName ? `Source name: ${sourceName}` : '', sourceKey ? `Source key: ${sourceKey}` : ''].filter(Boolean).join('\n');
  return `KingCom needs staff support

Channel: ${channel}
Customer: ${externalUserId}
Intent: ${intent || 'unknown'}
Reason: ${reason}
${sourceLine ? `\n${sourceLine}` : ''}

Customer message:
"${text}"

Dashboard:
${buildDashboardUrl(conversationId)}

Tip: check products/FAQ data, reply manually, or update knowledge if something is missing.`;
}

async function notifyWebsiteMessage(payload) {
  if (process.env.LARK_ALERT_ENABLED === 'false') return { ok: true, skipped: 'lark_disabled' };
  if (process.env.WEBSITE_MESSAGE_LARK_ALERT_ENABLED === 'false') return { ok: true, skipped: 'website_message_lark_disabled' };

  const message = formatWebsiteMessageAlert(payload);
  fs.mkdirSync(path.dirname(ALERT_LOG), { recursive: true });
  fs.appendFileSync(ALERT_LOG, `[${new Date().toISOString()}] website_message=${payload.conversationId || ''}\n${message}\n\n`, 'utf8');

  try {
    const result = await sendLarkMessage(message);
    return { ok: true, mode: 'lark', result };
  } catch (e) {
    console.error('Lark website message alert failed:', e.message);
    return { ok: false, error: e.message };
  }
}

async function notifyStaff(alertId, payload) {
  const message = formatAlert(payload);
  fs.mkdirSync(path.dirname(ALERT_LOG), { recursive: true });
  fs.appendFileSync(ALERT_LOG, `[${new Date().toISOString()}] alert=${alertId}\n${message}\n\n`, 'utf8');

  if (process.env.LARK_ALERT_ENABLED !== 'false') {
    try {
      const result = await sendLarkMessage(message);
      updateAlertDelivery(alertId, 'sent_lark', JSON.stringify(result).slice(0, 500));
      return { ok: true, mode: 'lark', result };
    } catch (e) {
      console.error('Lark staff alert failed:', e.message);
    }
  }

  const token = process.env.STAFF_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.STAFF_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';
  if (!token || !chatId) {
    updateAlertDelivery(alertId, 'logged', 'Lark send failed/disabled and Telegram token/chat_id not configured');
    console.warn('Staff alert logged only. Configure STAFF_TELEGRAM_BOT_TOKEN and STAFF_TELEGRAM_CHAT_ID, or enable LARK alerting.');
    return { ok: true, mode: 'logged' };
  }

  try {
    await requestJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    });
    updateAlertDelivery(alertId, 'sent', '');
    return { ok: true, mode: 'telegram' };
  } catch (e) {
    updateAlertDelivery(alertId, 'failed', e.message);
    console.error('Staff Telegram alert failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { notifyStaff, notifyWebsiteMessage, formatAlert, formatWebsiteMessageAlert, sendLarkMessage };
