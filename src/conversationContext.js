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

function isAlternativeProductRequest(text) {
  const normalized = normalize(text);
  const directAlternative = /\b(mau khac|model khac|san pham khac|sp khac|thiet bi khac|loai khac|lua chon khac|phuong an khac|con mau nao|con model nao|con san pham nao|con thiet bi nao|con loai nao|cai khac|khac khong|khac nua|san pham tuong tu|mau tuong tu|model tuong tu|loai tuong tu|tuong tu khong|another|other option|other product|something else|anything else|similar product|similar option)\b/i.test(normalized);
  const categoryAlternative = /\bkhac\b/i.test(normalized)
    && /\b(san pham|thiet bi|mau|model|loai|livestream|live stream|tai nghe|webcam|micro|mic|tripod|gimbal|den|lens|filter|man hinh|balo|tui)\b/i.test(normalized);
  return directAlternative || categoryAlternative;
}

function inferRequestedCategory(text) {
  const normalized = normalize(text);
  const rules = [
    ['gimbal', /\b(chong rung|khong bi rung|giam rung|giu on dinh|quay on dinh|gimbal|stabilizer)\b/i],
    ['tripod', /\b(tripod|chan may|chan chup|phoi sang|ulanzi mt[- ]?\d+)\b/i],
    ['headphones', /\b(tai nghe|headphone|headphones|headset)\b/i],
    ['webcam', /\b(webcam|hop online|goi video|video call)\b/i],
    ['microphone', /\b(micro|mic|microphone|thu am|ghi am|loc tap am)\b/i],
    ['light', /\b(den quay|den chup|den led|den livestream|ring light|tube light|bo sung anh sang)\b/i],
    ['lens', /\b(lens|ong kinh|chup phong canh|chup chan dung|xoa phong)\b/i],
    ['filter', /\b(filter|kinh loc|nd filter|cpl)\b/i],
    ['monitor', /\b(man hinh phu|monitor|man hinh selfie)\b/i],
    ['bag', /\b(balo|backpack|tui may anh|tui dung)\b/i],
    ['livestream', /\b(livestream|live stream|thiet bi live|ban hang online|phat song truc tiep|quay phat truc tiep|video switcher|switcher|capture card|console pad|livepro)\b/i]
  ];
  return rules.find(([, pattern]) => pattern.test(normalized))?.[0] || '';
}

function isNewCategoryRequest(text, intent, requestedCategory) {
  if (!requestedCategory || isAlternativeProductRequest(text)) return false;
  const normalized = normalize(text);
  const startsNewNeed = /\b(can tim|muon tim|can mua|muon mua|tu van|giup toi|giup minh|co .* nao|san pham|dung cu|thiet bi|shop)\b/i.test(normalized);
  if (isContextualProductFollowUp(text) && !startsNewNeed) return false;
  return ['general', 'product_search', 'buy', 'price'].includes(intent)
    && startsNewNeed;
}

function clearProductState(context = {}) {
  const cleaned = { ...context };
  for (const key of [
    'id',
    'current_product_id',
    'current_product_name',
    'current_product_url',
    'current_product_sku',
    'last_explicit_product',
    'clarification_options',
    'alternative_product_request',
    'previous_product_id',
    'previous_product_name',
    'previous_product_brand',
    'previous_product_sku',
    'previous_product_url',
    'last_recommended_products'
  ]) {
    delete cleaned[key];
  }
  cleaned.current_brand = '';
  cleaned.context_confidence = 0;
  return cleaned;
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
  const alternativeRequest = isAlternativeProductRequest(userText);
  const inferredCategory = inferRequestedCategory(userText);
  const requestedCategory = inferredCategory || previous.requested_category || '';
  const newCategoryRequest = isNewCategoryRequest(userText, intent, inferredCategory);
  const productSpecific = looksLikeProductSpecificQuestion(userText, intent);
  const base = {
    ...(newCategoryRequest ? clearProductState(previous) : previous),
    current_source_key: sourceKey || previous.current_source_key || '',
    source_name: sourceName || previous.source_name || '',
    source_group: sourceGroup || previous.source_group || '',
    current_brand: newCategoryRequest ? '' : (previous.current_brand || sourceConfig.brand || ''),
    current_customer_goal: intent || previous.current_customer_goal || '',
    requested_category: requestedCategory,
    new_category_request: newCategoryRequest,
    alternative_product_request: false,
    context_confidence: newCategoryRequest ? 0 : Number(previous.context_confidence || 0),
    needs_clarification: false,
    clarification_reason: ''
  };

  if (alternativeRequest) {
    return {
      ...base,
      alternative_product_request: true,
      previous_product_id: previous.current_product_id || previous.id || '',
      previous_product_name: previous.current_product_name || '',
      previous_product_brand: previous.current_brand || '',
      previous_product_sku: previous.current_product_sku || '',
      previous_product_url: previous.current_product_url || '',
      requested_category: inferredCategory || previous.requested_category || inferRequestedCategory(previous.current_product_name || ''),
      new_category_request: false,
      context_confidence: Math.max(Number(previous.context_confidence || 0), previous.current_product_name ? 0.8 : 0.6),
      needs_clarification: false,
      clarification_reason: ''
    };
  }

  const hasExplicitIdentity = /https?:\/\/\S+\/products?\//i.test(String(userText || ''))
    || identityWords(userText).some(word => /[a-z]+\d|\d+[a-z]+/i.test(word));
  if (newCategoryRequest && !hasExplicitIdentity) {
    return base;
  }

  if (explicit.product && explicit.confidence >= 0.75) {
    const snapshot = productSnapshot(explicit.product, sourceKey);
    return {
      ...base,
      ...snapshot,
      current_brand: snapshot.current_brand || sourceConfig.brand || base.current_brand || '',
      current_customer_goal: intent || base.current_customer_goal || '',
      requested_category: inferredCategory || inferRequestedCategory(snapshot.current_product_name) || '',
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
        requested_category: inferRequestedCategory(snapshot.current_product_name) || base.requested_category || '',
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
    ctx.requested_category,
    ctx.current_product_name,
    ctx.current_product_sku,
    ctx.current_product_url
  ].filter(Boolean).join(' ');
}

function updateContextFromReply({
  context = {},
  ragProducts = [],
  reply = '',
  sourceKey = ''
} = {}) {
  const current = normalizeContext(context);
  const products = Array.isArray(ragProducts) ? ragProducts.filter(Boolean) : [];
  if (!products.length) {
    return {
      ...current,
      new_category_request: false,
      alternative_product_request: false
    };
  }

  const replyText = normalize(reply);
  const mentioned = products.filter(product => {
    const name = normalize(product.name || product.title || '');
    return name && replyText.includes(name);
  });
  const selected = mentioned.length === 1
    ? mentioned[0]
    : (products.length === 1 ? products[0] : null);
  const productCategory = inferRequestedCategory(
    `${selected?.name || selected?.title || ''} ${selected?.tags || selected?.category || ''}`
  );
  const requestedCategory = current.requested_category
    || productCategory
    || inferRequestedCategory(`${products[0]?.name || products[0]?.title || ''} ${products[0]?.tags || products[0]?.category || ''}`);
  const base = {
    ...current,
    last_recommended_products: products.slice(0, 5).map(product => productSnapshot(product, sourceKey || current.current_source_key || '')).filter(Boolean),
    requested_category: requestedCategory || '',
    new_category_request: false,
    alternative_product_request: false,
    needs_clarification: false,
    clarification_reason: ''
  };

  if (!selected) return base;
  const snapshot = productSnapshot(selected, sourceKey || current.current_source_key || '');
  if (!snapshot) return base;
  return {
    ...base,
    ...snapshot,
    requested_category: productCategory || requestedCategory || '',
    last_explicit_product: snapshot,
    context_confidence: Math.max(Number(current.context_confidence || 0), 0.86)
  };
}

module.exports = {
  normalizeContext,
  identityWords,
  isContextualProductFollowUp,
  isAlternativeProductRequest,
  inferRequestedCategory,
  isNewCategoryRequest,
  isCommercialPolicyText,
  looksLikeProductSpecificQuestion,
  findExplicitProduct,
  resolveConversationContext,
  updateContextFromReply,
  contextSearchText,
  buildClarificationReply
};
