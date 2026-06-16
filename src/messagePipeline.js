const { getOrCreateCustomer, getOrCreateConversation, saveMessage, getRecentMessages, updateCustomerLearning, updateConversationSummary, flagHandoff, updateConversationContext } = require('./db');
const { classifyIntent } = require('./intent');
const { generateReply, summarizeConversation, summarizeConversationFast, detectMessageLanguage, extractContactInfo } = require('./ai');
const { notifyStaff } = require('./staffAlert');
const { logAiResponse } = require('./aiTrace');
const {
  buildSourceContext,
  resolveCustomerBrand,
  applyCustomerBranding
} = require('./sourceRegistry');
const { judgeAiReply } = require('./replyJudge');
const { analyzeProductImages } = require('./mediaVision');
const { resolveConversationContext } = require('./conversationContext');

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPolicyFollowUpText(text, intent) {
  const normalized = normalizeForMatch(text);
  return intent === 'warranty'
    || /\b(full vat|vat|hoa don|xuat hoa don|xuat vat|bao hanh|doi tra|chinh sach|warranty|return policy|invoice)\b/i.test(normalized);
}

function isVatInvoiceFollowUpText(text) {
  const normalized = normalizeForMatch(text);
  return /\b(full vat|vat|hoa don|xuat hoa don|xuat vat|invoice)\b/i.test(normalized);
}

function isGenericConsultationRequest(text, intent) {
  const normalized = normalizeForMatch(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!['product_search', 'general'].includes(intent)) return false;
  return words.length <= 5
    && /\b(tu van|gioi thieu|goi y|san pham|sp|can tu van)\b/i.test(normalized)
    && !/\b(gia|bao nhieu|mua|ban|con hang|co hang|model|sku|den|micro|mic|lens|tripod|gimbal|filter|ulanzi|synco|viltrox|maono|boya|fifine)\b/i.test(normalized);
}

function detectHandoff({ text, intent, aiError, ragProducts }) {
  const t = String(text || '').toLowerCase();
  const normalized = normalizeForMatch(text);
  if (intent === 'human') return { needed: true, reason: 'Khách yêu cầu gặp nhân viên' };
  if (/(không phản hồi|khong phan hoi|chưa phản hồi|chua phan hoi|không ai trả lời|khong ai tra loi|gọi lại|goi lai|liên hệ lại|lien he lai|khiếu nại|khieu nai|bảo hành lỗi|bao hanh loi)/i.test(t)) {
    return { needed: true, reason: 'Khách cần follow-up/khiếu nại' };
  }
  if (/\b(hoi|hỏi).{0,30}(tu van|tư vấn|gioi thieu|giới thiệu)|\b(tu van|tư vấn).{0,30}(sai|nham|nhầm|lac de|lạc đề)|\b(dang hoi|đang hỏi).{0,50}(tu van|tư vấn)/i.test(normalized)) {
    return { needed: true, reason: 'Khách phản hồi AI tư vấn sai/lạc đề' };
  }
  if (aiError) return { needed: true, reason: 'AI lỗi hoặc hết quota, cần nhân viên kiểm tra' };
  if (isVatInvoiceFollowUpText(text)) {
    return { needed: false };
  }
  if (isPolicyFollowUpText(text, intent)) {
    return { needed: true, reason: 'Khách cần xác nhận VAT/bảo hành/chính sách' };
  }
  if (['buy', 'price', 'product_search', 'product_specs', 'order'].includes(intent) && (!ragProducts || ragProducts.length === 0) && !isGenericConsultationRequest(text, intent)) {
    return { needed: true, reason: 'Không có dữ liệu sản phẩm phù hợp trong RAG' };
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

function buildJudgeRejectedReply(customerText = '') {
  const lang = detectMessageLanguage(customerText);
  if (lang === 'en') {
    return 'I am checking again to avoid giving incorrect advice. I cannot safely confirm a matching product from the current data, so I have forwarded this to KingCom staff for a more accurate check.';
  }
  if (lang === 'zh') {
    return '我会重新核对，避免提供错误建议。目前我无法从现有资料中安全确认匹配的产品，因此已转交 KingCom 员工进一步确认。';
  }
  return 'Dạ em kiểm tra lại để tránh tư vấn sai. Hiện em chưa thể xác nhận chắc chắn sản phẩm phù hợp trong dữ liệu hiện tại, nên em đã chuyển thông tin cho nhân viên KingCom kiểm tra chính xác hơn ạ.';
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

function contactAcknowledgement(language = 'vi') {
  if (language === 'en') {
    return 'I already have the phone number you provided and will use it for staff follow-up when needed.';
  }
  if (language === 'zh') {
    return '\u6211\u5df2\u8bb0\u5f55\u60a8\u63d0\u4f9b\u7684\u7535\u8bdd\u53f7\u7801\uff0c\u5982\u9700\u4eba\u5de5\u8ddf\u8fdb\uff0c\u5de5\u4f5c\u4eba\u5458\u4f1a\u4f7f\u7528\u8be5\u53f7\u7801\u8054\u7cfb\u60a8\u3002';
  }
  return 'D\u1ea1 em \u0111\u00e3 c\u00f3 s\u1ed1 \u0111i\u1ec7n tho\u1ea1i anh/ch\u1ecb cung c\u1ea5p v\u00e0 s\u1ebd d\u00f9ng s\u1ed1 n\u00e0y \u0111\u1ec3 nh\u00e2n vi\u00ean h\u1ed7 tr\u1ee3 khi c\u1ea7n \u1ea1.';
}

function contactNumberAnswer(customer, language = 'vi') {
  const phone = String(customer?.phone || '').trim();
  if (!phone) return contactAcknowledgement(language);
  if (language === 'en') return `The phone number you provided is ${phone}.`;
  if (language === 'zh') return `\u60a8\u521a\u63d0\u4f9b\u7684\u7535\u8bdd\u53f7\u7801\u662f ${phone}\u3002`;
  return `D\u1ea1, s\u1ed1 \u0111i\u1ec7n tho\u1ea1i anh/ch\u1ecb \u0111\u00e3 cung c\u1ea5p l\u00e0 ${phone} \u1ea1.`;
}

function isPhoneNumberQuestion(text) {
  const normalized = normalizeForMatch(text);
  return /\b(sdt|so dien thoai|so dt|phone number|contact number|telephone number)\b/i.test(normalized)
    && /\b(la gi|la so may|so may|vua gui|vua cung cap|minh gui|minh vua|toi gui|toi vua|my|provided|gave|sent)\b/i.test(normalized);
}

function isContactSubmission(text) {
  const contact = extractContactInfo(text);
  return Boolean(contact.phone);
}

function stripUnneededPhoneAcknowledgement(reply, customerText = '') {
  if (isPhoneNumberQuestion(customerText) || isContactSubmission(customerText)) return String(reply || '');
  return String(reply || '')
    .replace(/(?:^|\n+)\s*D\u1ea1\s+em\s+\u0111\u00e3\s+c\u00f3\s+s\u1ed1\s+\u0111i\u1ec7n\s+tho\u1ea1i\s+anh\/ch\u1ecb\s+cung\s+c\u1ea5p\s+v\u00e0\s+s\u1ebd\s+d\u00f9ng\s+s\u1ed1\s+n\u00e0y\s+\u0111\u1ec3\s+nh\u00e2n\s+vi\u00ean\s+h\u1ed7\s+tr\u1ee3\s+khi\s+c\u1ea7n\s+\u1ea1\.?/giu, '\n')
    .replace(/(?:^|\n+)\s*I already have the phone number you provided and will use it for staff follow-up when needed\.?/giu, '\n');
}

function asksForPhoneAgain(text) {
  const raw = String(text || '');
  const normalized = normalizeForMatch(raw);
  const mentionsPhone = /\b(so dien thoai|sdt|phone number|contact number|telephone number)\b/i.test(normalized)
    || /[\u7535\u8bdd\u96fb\u8a71][\u53f7\u865f]?[\u7801\u78bc]?/u.test(raw);
  if (!mentionsPhone) return false;
  return /\b(cho .* xin|de lai|vui long|cung cap|chia se|gui .* so|may i have|please share|please leave|please provide|share your|leave your|provide your)\b/i.test(normalized)
    || /(?:\u8bf7|\u8acb)(?:\u7559\u4e0b|\u63d0\u4f9b|\u53d1\u9001|\u767c\u9001)/u.test(raw);
}

function avoidRepeatedContactRequest(reply, customer = {}, customerText = '') {
  if (!String(customer?.phone || '').trim()) return String(reply || '');

  const language = detectMessageLanguage(customerText || reply);
  const shouldAnswerPhoneQuestion = isPhoneNumberQuestion(customerText);
  const parts = String(reply || '').split(/(\n+|(?<=[.!?\u3002\uff01\uff1f])\s+)/u);
  let replaced = false;
  const cleaned = parts.map(part => {
    if (!asksForPhoneAgain(part)) return part;
    if (replaced) return '';
    replaced = true;
    return shouldAnswerPhoneQuestion ? contactNumberAnswer(customer, language) : '';
  }).join('');

  return stripUnneededPhoneAcknowledgement(cleaned, customerText)
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
      const summaryMessages = await getRecentMessages(conversationId, 20);
      let summary = '';
      if (process.env.AUTO_AI_SUMMARY !== 'false') {
        summary = await summarizeConversation({ messages: summaryMessages, customer, language });
      }
      if (!summary) summary = summarizeConversationFast({ messages: summaryMessages, customer });
      if (summary) await updateConversationSummary(conversationId, customerId, summary);
    } catch (e) {
      console.error('auto summary error:', e.message);
    }
  }, Number(process.env.AUTO_SUMMARY_DELAY_MS || 250));
}

function parseRawJson(rawJson) {
  if (!rawJson) return {};
  if (typeof rawJson === 'object') return rawJson;
  try {
    return JSON.parse(rawJson);
  } catch {
    return {};
  }
}

function enrichHistoryWithMediaContext(messages = []) {
  return (messages || []).map(message => {
    const raw = parseRawJson(message.raw_json);
    const searchText = String(raw?._media?.vision?.searchText || '').trim();
    if (!searchText) return message;
    return {
      ...message,
      text: `${message.text || '[Customer sent a product image]'}\n[Internal image analysis: ${searchText}]`
    };
  });
}

function trimHistoryToActiveSession(messages = [], maxGapMinutes = Number(process.env.CONVERSATION_CONTEXT_MAX_GAP_MINUTES || 360)) {
  const rows = [...(messages || [])];
  if (rows.length < 2) return rows;
  const maxGapMs = Math.max(1, Number(maxGapMinutes) || 360) * 60 * 1000;
  let sessionStart = 0;

  for (let index = rows.length - 1; index > 0; index--) {
    const currentTime = new Date(rows[index].created_at || rows[index].createdAt || 0).getTime();
    const previousTime = new Date(rows[index - 1].created_at || rows[index - 1].createdAt || 0).getTime();
    if (!Number.isFinite(currentTime) || !Number.isFinite(previousTime) || currentTime <= 0 || previousTime <= 0) continue;
    if (currentTime - previousTime > maxGapMs) {
      sessionStart = index;
      break;
    }
  }

  return rows.slice(sessionStart);
}

function buildImageFallbackReply(customerText = '') {
  const language = detectMessageLanguage(customerText);
  if (language === 'en') {
    return 'I received the product image, but I could not identify it reliably. Please send a clearer photo of the product label or model code. I have also forwarded the image to KingCom staff for checking.';
  }
  if (language === 'zh') {
    return '我已收到产品图片，但目前无法可靠识别。请补充一张更清晰的产品标签或型号照片；我也已将图片转交给 KingCom 员工进一步确认。';
  }
  return 'Dạ em đã nhận được hình ảnh sản phẩm nhưng chưa thể nhận dạng chắc chắn. Anh/chị gửi thêm ảnh rõ phần nhãn hoặc mã model giúp em; em cũng đã chuyển hình cho nhân viên KingCom kiểm tra thêm ạ.';
}

async function processIncoming({ channel, externalUserId, text, externalMessageId, raw, imageUrls = [], visionImageInputs = [], customerAttrs = {}, sendFn }) {
  const startedAt = Date.now();
  const originalText = String(text || '').trim();
  const mediaUrls = [...new Set((imageUrls || []).filter(Boolean))].slice(0, 3);
  const visionEnabled = channel === 'facebook'
    ? process.env.FACEBOOK_IMAGE_RECOGNITION_ENABLED !== 'false'
    : process.env.WEBSITE_IMAGE_RECOGNITION_ENABLED !== 'false';
  const source = buildSourceContext({ channel, raw, customerAttrs });
  const customerBrand = resolveCustomerBrand(source);
  const vision = mediaUrls.length
    ? await analyzeProductImages({
        imageUrls: mediaUrls,
        imageInputs: visionImageInputs,
        customerText: originalText,
        sourceName: source.sourceName,
        enabled: visionEnabled
      })
    : null;
  const storedText = originalText || (mediaUrls.length ? '[Khách gửi hình ảnh sản phẩm]' : '');
  const processingText = vision?.recognized && vision.searchText
    ? `${originalText || 'Khách gửi hình ảnh sản phẩm.'}\n\n[Internal image analysis: ${vision.searchText}]`
    : (originalText || 'Khách gửi hình ảnh sản phẩm và cần hỗ trợ nhận dạng.');
  const rawWithMedia = mediaUrls.length
    ? {
        ...(raw && typeof raw === 'object' ? raw : { original: raw }),
        _media: { imageUrls: mediaUrls, vision }
      }
    : raw;
  const contactInfo = extractContactInfo(originalText);
  const enrichedCustomerAttrs = { ...customerAttrs };
  if (contactInfo.name) enrichedCustomerAttrs.name = contactInfo.name;
  if (contactInfo.phone) enrichedCustomerAttrs.phone = contactInfo.phone;
  const customer = await getOrCreateCustomer(channel, externalUserId, enrichedCustomerAttrs);
  const conversation = await getOrCreateConversation(customer.id, channel, source.sourceKey, source.sourceName, source.sourceGroup);
  const { intent, confidence } = classifyIntent(processingText);
  const inbound = await saveMessage({
    conversationId: conversation.id,
    customerId: customer.id,
    channel,
    externalMessageId,
    direction: 'in',
    senderType: 'customer',
    text: storedText,
    rawJson: rawWithMedia,
    intent,
    sourceGroup: source.sourceGroup,
    sourceKey: source.sourceKey,
    sourceName: source.sourceName
  });
  await updateCustomerLearning(customer.id, conversation.id, intent, processingText);

  const recentMessages = await getRecentMessages(conversation.id, 12);
  const history = enrichHistoryWithMediaContext(trimHistoryToActiveSession(recentMessages));
  const conversationContext = resolveConversationContext({
    userText: processingText,
    history,
    existingContext: conversation.conversation_context,
    intent,
    sourceKey: source.sourceKey,
    sourceName: source.sourceName,
    sourceGroup: source.sourceGroup
  });
  await updateConversationContext(conversation.id, conversationContext);
  const autoReply = process.env.AUTO_REPLY !== 'false' && conversation.auto_reply !== 0;
  if (!autoReply) {
    logAiResponse({
      channel,
      externalUserId,
      conversationId: conversation.id,
      inboundMessageId: inbound.id,
      intent,
      confidence,
      customerText: processingText,
      imageCount: mediaUrls.length,
      visionRecognized: !!vision?.recognized,
      visionError: vision?.error || '',
      skipped: 'auto_reply_off'
    });
    return { ok: true, skipped: 'auto_reply_off', conversationId: conversation.id };
  }

  const freshCustomer = await getOrCreateCustomer(channel, externalUserId, enrichedCustomerAttrs);
  const mediaRecognitionFailed = mediaUrls.length > 0 && !vision?.recognized;
  const replyResult = mediaRecognitionFailed
    ? {
        reply: buildImageFallbackReply(originalText),
        aiUsed: 0,
        aiError: false,
        aiErrorMessage: vision?.error || '',
        aiSource: 'vision_fallback',
        searchQuery: '',
        ragProducts: []
      }
    : await generateReply({
        channel,
        userText: processingText,
        history,
        customer: freshCustomer,
        intent,
        sourceKey: source.sourceKey,
        sourceName: source.sourceName,
        sourceGroup: source.sourceGroup,
        conversationContext
      });
  const {
    reply: rawReply,
    aiUsed,
    aiError,
    aiErrorMessage,
    aiSource,
    searchQuery,
    ragProducts,
    webSources = [],
    webSearchRequests = 0
  } = replyResult;
  const validation = { ok: true, skipped: 'single_ai_judge_final_check' };
  const generatedReply = rawReply;
  const baseHandoff = mediaRecognitionFailed
    ? { needed: true, reason: `Không nhận dạng được hình ảnh sản phẩm ${channel === 'facebook' ? 'Facebook' : 'website'}` }
    : detectHandoff({ text: processingText, intent, aiError, ragProducts });
  let handoff = baseHandoff;
  let reply = applyCustomerBranding(
    normalizeCustomerReply(improveNoDataReply(generatedReply, handoff, originalText || processingText)),
    customerBrand,
    ragProducts
  );
  reply = avoidRepeatedContactRequest(reply, freshCustomer, originalText || processingText);
  const judge = await judgeAiReply({
    channel,
    userText: processingText,
    history,
    reply,
    ragProducts,
    validation,
    intent,
    sourceKey: source.sourceKey,
    sourceName: source.sourceName,
    sourceGroup: source.sourceGroup,
    customerBrand,
    customer: freshCustomer,
    aiSource,
    searchQuery,
    webSources,
    conversationContext
  });
  if (!judge.approve) {
    if (judge.correctedReply) {
      reply = applyCustomerBranding(
        normalizeCustomerReply(judge.correctedReply),
        customerBrand,
        ragProducts
      );
    } else {
      reply = applyCustomerBranding(
        normalizeCustomerReply(buildJudgeRejectedReply(originalText || processingText)),
        customerBrand,
        ragProducts
      );
    }
    if (judge.needsHandoff || !judge.correctedReply) {
      handoff = {
        needed: true,
        reason: judge.reason || 'AI judge chặn câu trả lời có độ liên quan thấp'
      };
    }
    reply = applyCustomerBranding(
      normalizeCustomerReply(improveNoDataReply(reply, handoff, originalText || processingText)),
      customerBrand,
      ragProducts
    );
  }
  reply = applyCustomerBranding(reply, customerBrand, ragProducts);
  reply = avoidRepeatedContactRequest(reply, freshCustomer, originalText || processingText);
  const humanDelayMs = estimateHumanReplyDelayMs(reply, Date.now() - startedAt);
  if (humanDelayMs > 0) await sleep(humanDelayMs);

  if (handoff.needed) {
    const alertId = await flagHandoff({
      conversationId: conversation.id,
      customerId: customer.id,
      channel,
      reason: handoff.reason,
      message: storedText,
      sourceGroup: source.sourceGroup,
      sourceKey: source.sourceKey,
      sourceName: source.sourceName
    });
    notifyStaff(alertId, { channel, externalUserId, intent, reason: handoff.reason, text: storedText, conversationId: conversation.id, sourceGroup: source.sourceGroup, sourceKey: source.sourceKey, sourceName: source.sourceName }).catch(e => console.error('notifyStaff error:', e.message));
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
      const alertId = await flagHandoff({
        conversationId: conversation.id,
        customerId: customer.id,
        channel,
        reason: 'Không gửi được tin nhắn trả lời tự động',
        message: deliveryError,
        sourceGroup: source.sourceGroup,
        sourceKey: source.sourceKey,
        sourceName: source.sourceName
      });
      notifyStaff(alertId, { channel, externalUserId, intent, reason: 'Không gửi được tin nhắn trả lời tự động', text: `${storedText}\n\nLỗi gửi: ${deliveryError}`, conversationId: conversation.id, sourceGroup: source.sourceGroup, sourceKey: source.sourceKey, sourceName: source.sourceName }).catch(err => console.error('notifyStaff error:', err.message));
    }
  }

  await saveMessage({
    conversationId: conversation.id,
    customerId: customer.id,
    channel,
    direction: 'out',
    senderType: 'ai',
    text: reply,
    rawJson: {
      reply_to: inbound.id,
      handoff,
      validation,
      judge,
      judgeError: judge?.error || '',
      sendResult,
      aiError: !!aiError,
      humanDelayMs,
      webSources,
      webSearchRequests,
      conversationContext
    },
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
    customerText: processingText,
    imageCount: mediaUrls.length,
    visionRecognized: !!vision?.recognized,
    visionConfidence: typeof vision?.confidence === 'number' ? vision.confidence : undefined,
    visionProductType: vision?.productType || '',
    visionBrand: vision?.brand || '',
    visionModel: vision?.model || '',
    visionError: vision?.error || '',
    aiSource: aiSource || (aiUsed ? 'provider' : 'rule_or_fallback'),
    aiUsed: !!aiUsed,
    aiError: !!aiError,
    aiErrorMessage,
    searchQuery,
    webSearchRequests,
    webSources,
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
    conversationContext,
    humanDelayMs,
    reply,
    validatorBlocked: validation.ok ? false : true,
    validatorReason: validation.reason || '',
    judgeApproved: !!judge?.approve,
    judgeReason: judge?.reason || '',
    judgeInferredNeed: judge?.inferredCustomerNeed || '',
    judgeRiskType: judge?.riskType || '',
    judgeSeverity: judge?.severity || '',
    judgeConfidence: typeof judge?.confidence === 'number' ? judge.confidence : undefined,
    judgeNeedsHandoff: !!judge?.needsHandoff,
    judgeCorrectedReply: judge?.correctedReply || '',
    judgeCorrectedSimilarity: typeof judge?.correctedSimilarity === 'number' ? judge.correctedSimilarity : undefined,
    judgeError: judge?.error || '',
    handoffNeeded: handoff.needed,
    handoffReason: handoff.reason || '',
    deliveryStatus,
    deliveryError
  });

  updateConversationSummaryInBackground(conversation.id, customer.id, freshCustomer, 'vi');

  return { ok: deliveryStatus !== 'failed', conversationId: conversation.id, customerId: customer.id, intent, confidence, reply, aiUsed, aiError: !!aiError, aiErrorMessage, needsHuman: handoff.needed, handoffReason: handoff.reason || '', deliveryStatus, deliveryError, humanDelayMs };
}

module.exports = {
  processIncoming,
  detectHandoff,
  normalizeCustomerReply,
  estimateHumanReplyDelayMs,
  improveNoDataReply,
  avoidRepeatedContactRequest,
  trimHistoryToActiveSession
};
