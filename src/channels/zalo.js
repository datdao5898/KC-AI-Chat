const axios = require('axios');
async function sendZaloMessage(userId, text) {
  const token = process.env.ZALO_OA_ACCESS_TOKEN;
  if (!token) { console.log('[ZALO DRY SEND]', userId, text); return { dryRun: true }; }
  const url = 'https://openapi.zalo.me/v3.0/oa/message/cs';
  const body = { recipient: { user_id: userId }, message: { text: text.slice(0, 1900) } };
  const { data } = await axios.post(url, body, { headers: { access_token: token }, timeout: 15000 });
  return data;
}
module.exports = { sendZaloMessage };
