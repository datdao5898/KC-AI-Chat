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
  const base = String(
    process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8660}`
  ).replace(/\/+$/, '');
  return `${base}/admin/conversations.html?conversation=${encodeURIComponent(conversationId)}`;
}

const CHANNEL_LABELS = { facebook: 'Facebook', zalo: 'Zalo', haravan_website: 'Website', haravan: 'Website' };

// One Lark message per customer message that did not already raise a staff alert,
// so staff see every conversation, including the ones the AI answered.
function formatNewMessageAlert({ channel, externalUserId, customer, text, status, reply, conversationId, sourceName, sourceKey }) {
  const name = String(customer?.name || '').trim();
  const phone = String(customer?.phone || '').trim();
  const email = String(customer?.email || '').trim();
  const contactLine = [
    name ? `Name: ${name}` : '',
    phone ? `Phone: ${phone}` : '',
    email ? `Email: ${email}` : ''
  ].filter(Boolean).join('\n');
  const replyText = String(reply || '').trim();

  return `KingCom new message (${CHANNEL_LABELS[channel] || channel})

Source: ${sourceName || sourceKey || CHANNEL_LABELS[channel] || channel}
Customer: ${externalUserId}
${contactLine ? `${contactLine}\n` : ''}
Customer message:
"${text}"

Status: ${status}${replyText ? `\n\nAI reply:\n"${replyText}"` : ''}

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

async function notifyNewMessage(payload) {
  if (process.env.LARK_ALERT_ENABLED === 'false') return { ok: true, skipped: 'lark_disabled' };
  if (process.env.NEW_MESSAGE_LARK_ALERT_ENABLED === 'false') return { ok: true, skipped: 'new_message_lark_disabled' };

  const message = formatNewMessageAlert(payload);
  fs.mkdirSync(path.dirname(ALERT_LOG), { recursive: true });
  fs.appendFileSync(ALERT_LOG, `[${new Date().toISOString()}] new_message=${payload.conversationId || ''}\n${message}\n\n`, 'utf8');

  try {
    const result = await sendLarkMessage(message);
    return { ok: true, mode: 'lark', result };
  } catch (e) {
    console.error('Lark new message alert failed:', e.message);
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
      await updateAlertDelivery(alertId, 'sent_lark', JSON.stringify(result).slice(0, 500));
      return { ok: true, mode: 'lark', result };
    } catch (e) {
      console.error('Lark staff alert failed:', e.message);
    }
  }

  const token = process.env.STAFF_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.STAFF_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';
  if (!token || !chatId) {
    await updateAlertDelivery(alertId, 'logged', 'Lark send failed/disabled and Telegram token/chat_id not configured');
    console.warn('Staff alert logged only. Configure STAFF_TELEGRAM_BOT_TOKEN and STAFF_TELEGRAM_CHAT_ID, or enable LARK alerting.');
    return { ok: true, mode: 'logged' };
  }

  try {
    await requestJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    });
    await updateAlertDelivery(alertId, 'sent', '');
    return { ok: true, mode: 'telegram' };
  } catch (e) {
    await updateAlertDelivery(alertId, 'failed', e.message);
    console.error('Staff Telegram alert failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  notifyStaff,
  notifyNewMessage,
  formatAlert,
  formatNewMessageAlert,
  sendLarkMessage,
  buildDashboardUrl
};
