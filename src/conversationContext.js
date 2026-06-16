const { searchProducts, normalize, queryWords } = require('./rag');
const { readSourceConfig } = require('./sourceRegistry');

const CONTEXT_STOPWORDS = new Set([
  'anh', 'chi', 'ban', 'minh', 'toi', 'em', 'shop', 'can', 'muon',
  'tim', 'xem', 'cho', 'hoi', 'nhe', 'nha', 'giup', 'voi', 'co',
  'khong', 'khong a', 'san', 'pham', 'mau', 'model', 'may',
  'thong', 'so', 'ky', 'thuat', 'cau', 'hinh', 'chi', 'tiet',
  'cach', 'su', 'dung', 'huong', 'dan', 'ket', 'noi', 'cai', 'dat',
  'gui', 'truc', 'tiep', 'qua', 'day', 'link', 'gia', 'bao', 'nhieu',
  'nay', 'do', 'no', 'vua', 'noi', 'previous', 'this', 'that', 'it',
  'product', 'spec', 'specs', 'guide', 'manual', 'connect', 'setup',
  'smallest', 'best', 'world', 'nho', 'nhat', 'the', 'gioi'
]);

function normalizeContext(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? value : {};
}

function isCustomerMessage(message) {
  return message?.sender_type === 'customer' || message?.role === 'customer';
}

function historyBeforeCurrentMessage(history = [], userText = '') {
  const rows = [...(history || [])];
  const last = rows[rows.length - 1];
  if (isCustomerMessage(last) && normalize(last.text) === normalize(userText)) rows.pop();
  return rows;
}

function identityWords(text) {
  return queryWords(text)
    .filter(word => word.length >= 2)
    .filter(word => !CONTEXT_STOPWORDS.has(word));
}

function isContextualProductFollowUp(text) {
  const normalized = normalize(text);
  return /\b(no|nay|do|san pham nay|san pham do|mau nay|mau do|model nay|model do|sp nay|sp do|gui qua day|gui truc tiep|truc tiep qua day|cho xem|cho minh xem|gui link|link mua|thong so cua no|thong so san pham nay)\b/i.test(normalized);
}

function isCommercialPolicyText(text) {
  const raw = String(text || '');
  const normalized = normalize(raw);
  return /\b(full vat|vat|hoa don|xuat hoa don|xuat vat|bao hanh|doi tra|chinh sach|warranty|return policy|invoice)\b/i.test(normalized)
    || /(ä¿ä¿®|é€€æ¢|å‘ç¥¨|ç™¼ç¥¨|å¢žå€¼ç¨Ž|æ”¿ç­–)/.test(raw);
}

function looksLikeProductSpecificQuestion(text, intent = '') {
  const normalized = normalize(text);
  if (isCommercialPolicyText(text)) return false;
  if (['product_specs', 'price', 'order'].includes(intent)) return true;
  return /\b(thong so|cau hinh|chi tiet|huong dan|cach su dung|ket noi|setup|manual|guide|specs?|link mua|gia bao nhieu)\b/i.test(normalized);
}

function productSnapshot(product = {}, sourceKey = '') {
  if (!product || typeof product !== 'object') return null;
  const name = product.name || product.title || '';
  if (!name) return null;
  const url = product.url || product.link || product.product_url || '';
  return {
    id: product.sku || url || name,
    current_product_id: product.sku || url || name,
    current_product_name: name,
    current_brand: product.vendor || product.brand || '',
    current_product_url: url,
    current_product_sku: product.sku || '',
    current_source_key: sourceKey || '',
    score: typeof product.score === 'number' ? product.score : 0
  };
}

function scoreCandidateConfidence(products = [], queryText = '') {
  if (!products.length) return 0;
  const top = products[0];
  const second = products[1];
  const topScore = Number(top.score || 0);
  const gap = topScore - Number(second?.score || 0);
  const normQuery = normalize(queryText);
  const normName = normalize(top.name || top.title || '');
  const codeLikeWords = identityWords(queryText).filter(word => /[a-z]+\d|\d+[a-z]+/i.test(word));
  const exactUrl = /https?:\/\/\S+\/products?\//i.test(String(queryText || ''));
  const nameInsideQuery = normName && (normQuery.includes(normName) || normName.includes(normQuery));

  if (exactUrl) return 0.98;
  if (nameInsideQuery && gap >= 1) return 0.92;
  if (codeLikeWords.length && topScore >= 20 && gap >= 4) return 0.88;
  if (topScore >= 45 && gap >= 20) return 0.82;
  if (topScore >= 25 && gap >= 5) return 0.7;
  if (topScore >= 10) return 0.55;
  return 0.35;
}

function findExplicitProduct(text, sourceKey = '') {
  const words = identityWords(text);
  const hasProductUrl = /https?:\/\/\S+\/products?\//i.test(String(text || ''));
  if (!hasProductUrl && words.length < 2) {
    return { product: null, confidence: 0, products: [] };
  }
  const products = searchProducts(text, 3, { sourceKey, requireIdentityMatch: true });
  const confidence = scoreCandidateConfidence(products, text);
  return { product: products[0] || null, confidence, products };
}

function latestExplicitProductFromHistory(history = [], sourceKey = '') {
  for (const message of [...(history || [])].reverse()) {
    if (!isCustomerMessage(message)) continue;
    const result = findExplicitProduct(message.text || '', sourceKey);
    if (result.product && result.confidence >= 0.75) return result;
  }
  return { product: null, confidence: 0, products: [] };
}

function clarifyOptions(products = []) {
  const names = [];
  for (const product of products || []) {
    const name = product?.name || product?.title || product?.current_product_name || '';
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= 3) break;
  }
  return names;
}

function buildClarificationReply(context = {}, lang = 'vi') {
  const options = clarifyOptions(context.clarification_options || []);
  const optionText = options.length ? options.join(', ') : '';
  if (lang === 'en') {
    return optionText
      ? `Could you please confirm the exact model you mean: ${optionText}? I will then send the correct information.`
      : 'Could you please share the exact product name or model so I can send the correct information?';
  }
  if (lang === 'zh') {
    return optionText
      ? `\u8bf7\u60a8\u786e\u8ba4\u5177\u4f53\u578b\u53f7\u662f\uff1a${optionText}\uff1f\u6211\u4f1a\u518d\u53d1\u9001\u51c6\u786e\u7684\u4fe1\u606f\u3002`
      : '\u8bf7\u60a8\u63d0\u4f9b\u51c6\u786e\u7684\u4ea7\u54c1\u540d\u79f0\u6216\u578b\u53f7\uff0c\u6211\u4f1a\u518d\u53d1\u9001\u6b63\u786e\u7684\u4fe1\u606f\u3002';
  }
  return optionText
    ? `D\u1ea1 anh/ch\u1ecb x\u00e1c nh\u1eadn gi\u00fap em \u0111\u00fang model m\u00ecnh \u0111ang h\u1ecfi l\u00e0: ${optionText} \u1ea1? Em s\u1ebd g\u1eedi \u0111\u00fang th\u00f4ng tin theo model \u0111\u00f3.`
    : 'D\u1ea1 anh/ch\u1ecb cho em xin t\u00ean s\u1ea3n ph\u1ea9m ho\u1eb7c model c\u1ee5 th\u1ec3 \u0111\u1ec3 em g\u1eedi \u0111\u00fang th\u00f4ng tin \u1ea1.';
}

function resolveConversationContext({
  userText = '',
  history = [],
  existingContext = {},
  intent = '',
  sourceKey = '',
  sourceName = '',
  sourceGroup = ''
} = {}) {
  const previous = normalizeContext(existingContext);
  const sourceConfig = readSourceConfig(sourceKey);
  const explicit = findExplicitProduct(userText, sourceKey);
  const contextualFollowUp = isContextualProductFollowUp(userText);
  const productSpecific = looksLikeProductSpecificQuestion(userText, intent);
  const base = {
    ...previous,
    current_source_key: sourceKey || previous.current_source_key || '',
    source_name: sourceName || previous.source_name || '',
    source_group: sourceGroup || previous.source_group || '',
    current_brand: previous.current_brand || sourceConfig.brand || '',
    current_customer_goal: intent || previous.current_customer_goal || '',
    context_confidence: Number(previous.context_confidence || 0),
    needs_clarification: false,
    clarification_reason: ''
  };

  if (explicit.product && explicit.confidence >= 0.75) {
    const snapshot = productSnapshot(explicit.product, sourceKey);
    return {
      ...base,
      ...snapshot,
      current_brand: snapshot.current_brand || sourceConfig.brand || base.current_brand || '',
      current_customer_goal: intent || base.current_customer_goal || '',
      last_explicit_product: snapshot,
      context_confidence: explicit.confidence,
      needs_clarification: false,
      clarification_reason: ''
    };
  }

  if (contextualFollowUp && previous.current_product_name) {
    return {
      ...base,
      context_confidence: Math.max(Number(previous.context_confidence || 0), 0.76),
      needs_clarification: false,
      clarification_reason: ''
    };
  }

  if (contextualFollowUp) {
    const historyMatch = latestExplicitProductFromHistory(historyBeforeCurrentMessage(history, userText), sourceKey);
    if (historyMatch.product) {
      const snapshot = productSnapshot(historyMatch.product, sourceKey);
      return {
        ...base,
        ...snapshot,
        current_brand: snapshot.current_brand || sourceConfig.brand || base.current_brand || '',
        last_explicit_product: snapshot,
        context_confidence: Math.max(historyMatch.confidence, 0.76),
        needs_clarification: false,
        clarification_reason: ''
      };
    }
  }

  if (productSpecific && explicit.product && explicit.confidence < 0.75) {
    return {
      ...base,
      context_confidence: explicit.confidence,
      needs_clarification: true,
      clarification_reason: 'ambiguous_product',
      clarification_options: explicit.products.map(product => productSnapshot(product, sourceKey)).filter(Boolean)
    };
  }

  if (productSpecific && contextualFollowUp && !base.current_product_name) {
    return {
      ...base,
      context_confidence: 0.35,
      needs_clarification: true,
      clarification_reason: 'missing_current_product'
    };
  }

  return base;
}

function contextSearchText(context = '') {
  const ctx = normalizeContext(context);
  return [
    ctx.current_product_name,
    ctx.current_product_sku,
    ctx.current_product_url
  ].filter(Boolean).join(' ');
}

module.exports = {
  normalizeContext,
  identityWords,
  isContextualProductFollowUp,
  isCommercialPolicyText,
  looksLikeProductSpecificQuestion,
  findExplicitProduct,
  resolveConversationContext,
  contextSearchText,
  buildClarificationReply
};
