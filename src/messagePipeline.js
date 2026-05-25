const { getOrCreateCustomer, getOrCreateConversation, saveMessage, getRecentMessages, updateCustomerLearning, updateConversationSummary, flagHandoff } = require('./db');
const { classifyIntent } = require('./intent');
const { generateReply, summarizeConversationFast } = require('./ai');
const { notifyStaff } = require('./staffAlert');
const { logAiResponse } = require('./aiTrace');

function detectHandoff({ text, intent, aiError, ragProducts }) {
  const t = String(text || '').toLowerCase();
  if (intent === 'human') return { needed: true, reason: 'Khách yêu cầu gặp nhân viên', disableAutoReply: true };
  if (/(không phản hồi|khong phan hoi|chưa phản hồi|chua phan hoi|không ai trả lời|khong ai tra loi|gọi lại|goi lai|liên hệ lại|lien he lai|khiếu nại|khieu nai|bảo hành lỗi|bao hanh loi)/i.test(t)) {
    return { needed: true, reason: 'Khách cần follow-up/khiếu nại', disableAutoReply: true };
  }
  if (aiError) return { needed: true, reason: 'AI lỗi hoặc hết quota, cần nhân viên kiểm tra', disableAutoReply: false };
  if (['buy', 'price', 'product_search', 'order'].includes(intent) && (!ragProducts || ragProducts.length === 0)) {
    return { needed: true, reason: 'Không có dữ liệu sản phẩm phù hợp trong RAG', disableAutoReply: true };
  }
  return { needed: false };
}

function improveNoDataReply(reply, handoff) {
  if (!handoff?.needed) return reply;
  if (!/chuyển|nhân viên|tư vấn viên/i.test(reply || '')) {
    return `${reply}\n\nDạ em đã chuyển thông tin này cho nhân viên KingCom kiểm tra để tránh tư vấn sai. Anh/chị cho em xin thêm số điện thoại hoặc model cụ thể để tư vấn viên hỗ trợ nhanh hơn ạ.`;
  }
  return reply;
}

function normalizeCustomerReply(reply) {
  return String(reply || '')
    .replace(/\*\*/g, '')
    .replace(/[\u200D\uFE0E\uFE0F]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function processIncoming({ channel, externalUserId, text, externalMessageId, raw, customerAttrs = {}, sendFn }) {
  const customer = getOrCreateCustomer(channel, externalUserId, customerAttrs);
  const conversation = getOrCreateConversation(customer.id, channel);
  const { intent, confidence } = classifyIntent(text);
  const inbound = saveMessage({ conversationId: conversation.id, customerId: customer.id, channel, externalMessageId, direction: 'in', senderType: 'customer', text, rawJson: raw, intent });
  updateCustomerLearning(customer.id, conversation.id, intent, text);

  const history = getRecentMessages(conversation.id, 12);
  const autoReply = process.env.AUTO_REPLY !== 'false' && conversation.auto_reply !== 0;
  if (!autoReply) {
    logAiResponse({
      channel,
      externalUserId,
      conversationId: conversation.id,
      inboundMessageId: inbound.id,
      intent,
      confidence,
      customerText: text,
      skipped: 'auto_reply_off'
    });
    return { ok: true, skipped: 'auto_reply_off', conversationId: conversation.id };
  }

  const freshCustomer = getOrCreateCustomer(channel, externalUserId, customerAttrs);
  const { reply: rawReply, aiUsed, aiError, aiErrorMessage, aiSource, searchQuery, ragProducts } = await generateReply({ channel, userText: text, history, customer: freshCustomer, intent });
  const handoff = detectHandoff({ text, intent, aiError, ragProducts });
  const reply = normalizeCustomerReply(improveNoDataReply(rawReply, handoff));

  if (handoff.needed) {
    const alertId = flagHandoff({
      conversationId: conversation.id,
      customerId: customer.id,
      channel,
      reason: handoff.reason,
      message: text,
      disableAutoReply: handoff.disableAutoReply
    });
    notifyStaff(alertId, { channel, externalUserId, intent, reason: handoff.reason, text, conversationId: conversation.id }).catch(e => console.error('notifyStaff error:', e.message));
  }

  let deliveryStatus = sendFn ? 'pending' : 'returned_via_http';
  let deliveryError = '';
  let sendResult = null;
  if (sendFn) {
    try {
      sendResult = await sendFn(externalUserId, reply);
      deliveryStatus = sendResult?.dryRun ? 'dry_run' : 'sent';
    } catch (e) {
      deliveryStatus = 'failed';
      deliveryError = e.message || String(e);
      console.error('send message error:', deliveryError);
      const alertId = flagHandoff({
        conversationId: conversation.id,
        customerId: customer.id,
        channel,
        reason: 'Không gửi được tin nhắn trả lời tự động',
        message: deliveryError,
        disableAutoReply: false
      });
      notifyStaff(alertId, { channel, externalUserId, intent, reason: 'Không gửi được tin nhắn trả lời tự động', text: `${text}\n\nLỗi gửi: ${deliveryError}`, conversationId: conversation.id }).catch(err => console.error('notifyStaff error:', err.message));
    }
  }

  saveMessage({
    conversationId: conversation.id,
    customerId: customer.id,
    channel,
    direction: 'out',
    senderType: 'ai',
    text: reply,
    rawJson: { reply_to: inbound.id, handoff, sendResult, aiError: !!aiError },
    intent,
    aiUsed,
    deliveryStatus,
    deliveryError
  });

  logAiResponse({
    channel,
    externalUserId,
    conversationId: conversation.id,
    inboundMessageId: inbound.id,
    intent,
    confidence,
    customerText: text,
    aiSource: aiSource || (aiUsed ? 'provider' : 'rule_or_fallback'),
    aiUsed: !!aiUsed,
    aiError: !!aiError,
    aiErrorMessage,
    searchQuery,
    ragProductCount: Array.isArray(ragProducts) ? ragProducts.length : 0,
    ragProducts: (ragProducts || []).slice(0, 5).map(p => ({
      name: p.name || p.title || '',
      sku: p.sku || '',
      price: p.price || p.gia || '',
      url: p.url || p.link || p.product_url || ''
    })),
    reply,
    handoffNeeded: handoff.needed,
    handoffReason: handoff.reason || '',
    deliveryStatus,
    deliveryError
  });

  if (process.env.AUTO_SUMMARY !== 'false') {
    const summaryCustomer = getOrCreateCustomer(channel, externalUserId, customerAttrs);
    const summaryMessages = getRecentMessages(conversation.id, 20);
    const summary = summarizeConversationFast({ messages: summaryMessages, customer: summaryCustomer });
    if (summary) updateConversationSummary(conversation.id, customer.id, summary);
  }

  return { ok: deliveryStatus !== 'failed', conversationId: conversation.id, customerId: customer.id, intent, confidence, reply, aiUsed, aiError: !!aiError, aiErrorMessage, needsHuman: handoff.needed, handoffReason: handoff.reason || '', deliveryStatus, deliveryError };
}

module.exports = { processIncoming, detectHandoff, normalizeCustomerReply };
