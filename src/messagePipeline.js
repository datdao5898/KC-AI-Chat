const { getOrCreateCustomer, getOrCreateConversation, saveMessage, getRecentMessages, updateCustomerLearning, updateConversationSummary, flagHandoff } = require('./db');
const { classifyIntent } = require('./intent');
const { generateReply, summarizeConversation, summarizeConversationFast, detectMessageLanguage, extractContactInfo } = require('./ai');
const { notifyStaff, notifyWebsiteMessage } = require('./staffAlert');
const { logAiResponse } = require('./aiTrace');
const { buildSourceContext } = require('./sourceRegistry');

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

function replyAlreadyMentionsStaffSupport(reply) {
  return /(chuyển|nhân viên|tư vấn viên|số điện thoại|staff|phone number|contact you|confirm|support your order|员工|電話|电话|号码|联系|確認|确认)/i.test(String(reply || ''));
}

function handoffAppendText(lang) {
  if (lang === 'en') {
    return 'I have also forwarded this to KingCom staff for checking, to avoid giving incorrect advice. Please share your phone number or the exact model so our staff can support you faster.';
  }
  if (lang === 'zh') {
    return '我也已将此信息转交给 KingCom 员工确认，以避免提供错误建议。请留下电话号码或具体型号，方便员工更快协助您。';
  }
  return 'Dạ em đã chuyển thông tin này cho nhân viên KingCom kiểm tra để tránh tư vấn sai. Anh/chị cho em xin thêm số điện thoại hoặc model cụ thể để tư vấn viên hỗ trợ nhanh hơn ạ.';
}

function improveNoDataReply(reply, handoff, customerText = '') {
  if (!handoff?.needed) return reply;
  if (!replyAlreadyMentionsStaffSupport(reply)) {
    return `${reply}\n\n${handoffAppendText(detectMessageLanguage(customerText || reply))}`;
  }
  return reply;
}

function normalizeCustomerReply(reply) {
  let text = String(reply || '')
    .replace(/\*\*/g, '')
    .replace(/[\u200D\uFE0E\uFE0F]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const toneKey = text.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  text = text
    .replace(/^(ha\s*ha|haha|hihi|hehe|lol)[,!.\s-]*/i, 'Dạ anh/chị ơi, ')
    .replace(/có vẻ nhầm lẫn gì đây\s*ạ?[!,.]*/i, 'có thể anh/chị đang hỏi nhầm nhóm sản phẩm ạ.')
    .replace(/có vẻ nhầm lẫn\s*ạ?[!,.]*/i, 'có thể anh/chị đang hỏi nhầm nhóm sản phẩm ạ.')
    .replace(/\bnhầm lẫn gì đây\b/gi, 'đang hỏi nhầm nhóm sản phẩm')
    .replace(/Rất tiếc\s+em\s+hiện\s+tại\s+là\s+giao\s+diện\s+tự\s+động,\s*không\s+thể\s+trao\s+đổi\s+trực\s+tiếp\.?/gi, 'Em đã chuyển yêu cầu của anh/chị cho nhân viên KingCom. Anh/chị có thể tiếp tục nhắn tại khung chat này, nhân viên sẽ phản hồi tại đây khi có mặt.')
    .replace(/Để\s+hỗ\s+trợ\s+nhanh\s+nhất,\s*anh\/chị\s+vui\s+lòng\s+để\s+lại\s+số\s+điện\s+thoại\s+để\s+nhân\s+viên\s+KingCom\s+liên\s+hệ\s+hỗ\s+trợ\s+nhé\.?/gi, 'Nếu tiện, anh/chị có thể để lại số điện thoại để KingCom hỗ trợ nhanh hơn ạ.')
    .replace(/Số điện thoại:\s*_+/gi, '');

  if (toneKey.startsWith('ha ha co ve nham lan gi day') || toneKey.startsWith('haha co ve nham lan gi day')) {
    text = text.replace(/^Dạ anh\/chị ơi,\s*/i, '');
    text = text.replace(/^.*?(KingCom\s+là|KingCom la)/i, 'Dạ anh/chị ơi, hiện KingCom chưa kinh doanh sản phẩm này ạ. KingCom là');
  }

  if (toneKey.includes('giao dien tu dong') && toneKey.includes('khong the trao doi truc tiep')) {
    text = text.replace(/Rất tiếc[\s\S]*?(?=\n\n|$)/i, 'Em đã chuyển yêu cầu của anh/chị cho nhân viên KingCom. Anh/chị có thể tiếp tục nhắn tại khung chat này, nhân viên sẽ phản hồi tại đây khi có mặt.');
    text = text.replace(/Số điện thoại:\s*_+/i, '');
  }

  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function estimateHumanReplyDelayMs(reply, elapsedMs) {
  if (process.env.HUMAN_REPLY_DELAY_ENABLED === 'false') return 0;
  const text = String(reply || '');
  const minMs = Number(process.env.HUMAN_REPLY_DELAY_MIN_MS || 900);
  const maxMs = Number(process.env.HUMAN_REPLY_DELAY_MAX_MS || 6500);
  const perCharMs = Number(process.env.HUMAN_REPLY_DELAY_MS_PER_CHAR || 10);
  const perLineMs = Number(process.env.HUMAN_REPLY_DELAY_MS_PER_LINE || 220);
  const jitterMs = Number(process.env.HUMAN_REPLY_DELAY_JITTER_MS || 500);
  const lineCount = Math.max(1, text.split(/\r?\n/).filter(Boolean).length);
  const targetMs = Math.max(minMs, (text.length * perCharMs) + (lineCount * perLineMs));
  const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  return Math.max(0, Math.min(maxMs, targetMs + jitter) - elapsedMs);
}

function updateConversationSummaryInBackground(conversationId, customerId, customer, language = 'vi') {
  if (process.env.AUTO_SUMMARY === 'false') return;
  setTimeout(async () => {
    try {
      const summaryMessages = getRecentMessages(conversationId, 20);
      let summary = '';
      if (process.env.AUTO_AI_SUMMARY !== 'false') {
        summary = await summarizeConversation({ messages: summaryMessages, customer, language });
      }
      if (!summary) summary = summarizeConversationFast({ messages: summaryMessages, customer });
      if (summary) updateConversationSummary(conversationId, customerId, summary);
    } catch (e) {
      console.error('auto summary error:', e.message);
    }
  }, Number(process.env.AUTO_SUMMARY_DELAY_MS || 250));
}

async function processIncoming({ channel, externalUserId, text, externalMessageId, raw, customerAttrs = {}, sendFn }) {
  const startedAt = Date.now();
  const contactInfo = extractContactInfo(text);
  const enrichedCustomerAttrs = { ...customerAttrs };
  if (contactInfo.name) enrichedCustomerAttrs.name = contactInfo.name;
  if (contactInfo.phone) enrichedCustomerAttrs.phone = contactInfo.phone;
  const customer = getOrCreateCustomer(channel, externalUserId, enrichedCustomerAttrs);
  const source = buildSourceContext({ channel, raw, customerAttrs });
  const conversation = getOrCreateConversation(customer.id, channel, source.sourceKey, source.sourceName, source.sourceGroup);
  const { intent, confidence } = classifyIntent(text);
  const inbound = saveMessage({
    conversationId: conversation.id,
    customerId: customer.id,
    channel,
    externalMessageId,
    direction: 'in',
    senderType: 'customer',
    text,
    rawJson: raw,
    intent,
    sourceGroup: source.sourceGroup,
    sourceKey: source.sourceKey,
    sourceName: source.sourceName
  });
  updateCustomerLearning(customer.id, conversation.id, intent, text);

  if (channel === 'haravan_website') {
    notifyWebsiteMessage({
      externalUserId,
      text,
      conversationId: conversation.id,
      sourceName: source.sourceName,
      sourceKey: source.sourceKey,
      customer
    }).catch(e => console.error('notifyWebsiteMessage error:', e.message));
  }

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

  const freshCustomer = getOrCreateCustomer(channel, externalUserId, enrichedCustomerAttrs);
  const { reply: rawReply, aiUsed, aiError, aiErrorMessage, aiSource, searchQuery, ragProducts } = await generateReply({
    channel,
    userText: text,
    history,
    customer: freshCustomer,
    intent,
    sourceKey: source.sourceKey,
    sourceName: source.sourceName,
    sourceGroup: source.sourceGroup
  });
  const handoff = detectHandoff({ text, intent, aiError, ragProducts });
  const reply = normalizeCustomerReply(improveNoDataReply(rawReply, handoff, text));
  const humanDelayMs = estimateHumanReplyDelayMs(reply, Date.now() - startedAt);
  if (humanDelayMs > 0) await sleep(humanDelayMs);

  if (handoff.needed) {
    const alertId = flagHandoff({
      conversationId: conversation.id,
      customerId: customer.id,
      channel,
      reason: handoff.reason,
      message: text,
      disableAutoReply: handoff.disableAutoReply,
      sourceGroup: source.sourceGroup,
      sourceKey: source.sourceKey,
      sourceName: source.sourceName
    });
    notifyStaff(alertId, { channel, externalUserId, intent, reason: handoff.reason, text, conversationId: conversation.id, sourceGroup: source.sourceGroup, sourceKey: source.sourceKey, sourceName: source.sourceName }).catch(e => console.error('notifyStaff error:', e.message));
  }

  let deliveryStatus = sendFn ? 'pending' : 'returned_via_http';
  let deliveryError = '';
  let sendResult = null;
  if (sendFn) {
    try {
      sendResult = await sendFn(externalUserId, reply, { channel, raw, source, conversation, customer });
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
        disableAutoReply: false,
        sourceGroup: source.sourceGroup,
        sourceKey: source.sourceKey,
        sourceName: source.sourceName
      });
      notifyStaff(alertId, { channel, externalUserId, intent, reason: 'Không gửi được tin nhắn trả lời tự động', text: `${text}\n\nLỗi gửi: ${deliveryError}`, conversationId: conversation.id, sourceGroup: source.sourceGroup, sourceKey: source.sourceKey, sourceName: source.sourceName }).catch(err => console.error('notifyStaff error:', err.message));
    }
  }

  saveMessage({
    conversationId: conversation.id,
    customerId: customer.id,
    channel,
    direction: 'out',
    senderType: 'ai',
    text: reply,
    rawJson: { reply_to: inbound.id, handoff, sendResult, aiError: !!aiError, humanDelayMs },
    intent,
    aiUsed,
    deliveryStatus,
    deliveryError,
    sourceGroup: source.sourceGroup,
    sourceKey: source.sourceKey,
    sourceName: source.sourceName
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
    sourceGroup: source.sourceGroup,
    sourceKey: source.sourceKey,
    sourceName: source.sourceName,
    humanDelayMs,
    reply,
    handoffNeeded: handoff.needed,
    handoffReason: handoff.reason || '',
    deliveryStatus,
    deliveryError
  });

  updateConversationSummaryInBackground(conversation.id, customer.id, freshCustomer, 'vi');

  return { ok: deliveryStatus !== 'failed', conversationId: conversation.id, customerId: customer.id, intent, confidence, reply, aiUsed, aiError: !!aiError, aiErrorMessage, needsHuman: handoff.needed, handoffReason: handoff.reason || '', deliveryStatus, deliveryError, humanDelayMs };
}

module.exports = { processIncoming, detectHandoff, normalizeCustomerReply, estimateHumanReplyDelayMs, improveNoDataReply };
