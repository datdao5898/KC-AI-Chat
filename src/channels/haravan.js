// Haravan website phase 1: hỗ trợ widget chat riêng và webhook nhận event.
// Nếu dùng Haravan API chính thức để gửi tin nhắn inbox, điền token vào .env rồi bổ sung endpoint tại đây.
async function sendHaravanMessage(visitorId, text) {
  console.log('[HARAVAN SEND/WIDGET]', visitorId, text);
  return { ok: true, note: 'Website widget returns reply directly via HTTP JSON' };
}
module.exports = { sendHaravanMessage };
