const { normalize, parsePriceNumber, matchesRequiredCategory } = require('./rag');
const { matchingCategories } = require('./taxonomy');

function norm(text) {
  return normalize(text || '').replace(/\s+/g, ' ').trim();
}

function extractMaxPrice(text) {
  const normalized = norm(text);
  const m1 = normalized.match(/(?:duoi|toi da|max|nho hon|be hon)\s*(\d+(?:[\.,]\d+)?)\s*(trieu|tr|m|k|nghin|ngan)?/);
  const m2 = normalized.match(/(\d+(?:[\.,]\d+)?)\s*(trieu|tr|m|k|nghin|ngan)\s*(?:tro xuong|do lai|do ve|quay dau)/);
  const m = m1 || m2;
  if (!m) return null;
  const value = Number(m[1].replace(',', '.'));
  const unit = m[2] || '';
  if (['trieu', 'tr', 'm'].includes(unit)) return Math.round(value * 1000000);
  if (['k', 'nghin', 'ngan'].includes(unit)) return Math.round(value * 1000);
  return value > 10000 ? Math.round(value) : Math.round(value * 1000000);
}

function categoriesInText(text) {
  return matchingCategories(text);
}

function isFollowUp(text) {
  return /\b(khac|mau khac|gia mem|duoi|re hon|ok vay|gui cho|tham khao them|con mau nao)\b/i.test(norm(text));
}

function inferRequestedCategories(userText, history = []) {
  const direct = categoriesInText(userText);
  if (direct.length) return direct;
  if (!isFollowUp(userText)) return [];
  const previousCustomers = [...(history || [])]
    .filter(message => message.sender_type === 'customer')
    .slice(0, -1)
    .reverse();
  for (const message of previousCustomers) {
    const found = categoriesInText(message.text || '');
    if (found.length) return found;
  }
  return [];
}

function productText(product = {}) {
  return norm([
    product.name,
    product.title,
    product.vendor,
    product.brand,
    product.description,
    product.tags,
    product.url,
    product.link,
    product.product_url
  ].filter(Boolean).join(' '));
}

function productMatchesCategory(product, category) {
  return matchesRequiredCategory(product, category.id);
}

function productAppearsInReply(reply, product = {}) {
  const text = String(reply || '');
  const url = product.url || product.link || product.product_url || '';
  if (url && text.includes(url)) return true;
  const name = String(product.name || product.title || '').trim();
  return Boolean(name && text.toLowerCase().includes(name.toLowerCase().slice(0, 28)));
}

function replyMentionsProduct(reply) {
  return /https?:\/\/|link:|gia:|giá:|\d[\d.,]*\s*(d|đ|vnd)|sku/i.test(String(reply || ''));
}

function extractClaimedPrices(reply = '') {
  const claims = [];
  const text = String(reply || '');
  const patterns = [
    /(?:gi\u00e1|gia|price)\s*:?\s*(\d[\d.,]*)\s*(?:\u0111|\u20ab|vnd)?/gi,
    /(\d[\d.,]*)\s*(?:\u0111|\u20ab|vnd)\b/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = parsePriceNumber(match[1] || '');
      if (value > 0) claims.push(value);
    }
  }
  return [...new Set(claims)];
}

function productEvidencePrices(products = []) {
  const values = [];
  for (const product of products || []) {
    for (const field of ['_price', 'price', 'compare_at_price', 'gia']) {
      const value = parsePriceNumber(product?.[field] || '');
      if (value > 0) values.push(value);
    }
  }
  return new Set(values);
}

function hasUnsupportedPriceClaim(reply = '', ragProducts = []) {
  const claims = extractClaimedPrices(reply);
  if (!claims.length) return false;
  const evidence = productEvidencePrices(ragProducts);
  if (!evidence.size) return true;
  return claims.some(claim => !evidence.has(claim));
}

function stockEvidenceState(product = {}) {
  const availability = norm(product.availability || product.inventory_status || '');
  const stockRaw = String(product.stock_total ?? product.inventory_quantity ?? product.stock ?? '').trim();
  const stock = stockRaw === '' ? null : Number(stockRaw);
  if (/\b(out of stock|out_of_stock|het hang|unavailable)\b/i.test(availability) || stock === 0) return 'out';
  if (/\b(in stock|in_stock|low stock|low_stock|con hang|available)\b/i.test(availability) || (Number.isFinite(stock) && stock > 0)) return 'in';
  return 'unknown';
}

function unsupportedAvailabilityClaim(reply = '', ragProducts = []) {
  const normalized = norm(reply);
  if (/\b(khong co nghia.{0,100}het hang|khong ket luan.{0,100}het hang|does not mean.{0,100}out of stock)\b/i.test(normalized)) return false;
  const claimsInStock = /\b(con hang|co san|dang co hang|in stock)\b/i.test(normalized);
  const claimsOutOfStock = /\b(het hang|out of stock)\b/i.test(normalized);
  if (!claimsInStock && !claimsOutOfStock) return false;
  const states = (ragProducts || []).map(stockEvidenceState);
  if (!states.length) return true;
  if (claimsInStock && !states.includes('in')) return true;
  if (claimsOutOfStock && !states.includes('out')) return true;
  return false;
}

function buildSafeReply({ categories, maxPrice, customerBrand = 'KingCom', expectedLanguage = 'vi' }) {
  const categoryLabel = categories.map(item => item.label).join(', ') || 'sản phẩm anh/chị quan tâm';
  const priceText = maxPrice ? ` trong ngân sách dưới ${maxPrice.toLocaleString('vi-VN')}đ` : '';
  if (expectedLanguage === 'en') {
    return `I need to verify this again to avoid giving incorrect advice. I have forwarded the details to ${customerBrand} staff for a more accurate check.`;
  }
  if (expectedLanguage === 'zh') {
    return `为避免提供错误建议，我需要再次核实。相关信息已转交 ${customerBrand} 工作人员进一步确认。`;
  }
  return `Dạ em cần kiểm tra lại để tránh tư vấn sai về ${categoryLabel}${priceText}. Em đã chuyển thông tin cho nhân viên ${customerBrand} kiểm tra chính xác hơn ạ.`;
}

function normalizeUrl(value = '') {
  return String(value || '').trim().replace(/[.,;:!?]+$/g, '').replace(/\/+$/g, '');
}

function extractUrls(text = '') {
  return (String(text || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [])
    .map(normalizeUrl)
    .filter(Boolean);
}

function productUrl(product = {}) {
  return normalizeUrl(product.url || product.link || product.product_url || '');
}

function isAlternativeRequest(text = '', context = {}) {
  return Boolean(context?.alternative_product_request)
    || /\b(mau khac|model khac|san pham khac|sp khac|loai khac|phuong an khac|tuong tu|another|other)\b/i.test(norm(text));
}

function isContextualQuestion(text = '') {
  return /\b(no|nay|do|san pham nay|san pham do|mau nay|mau do|model nay|model do|thong so|cau hinh|chi tiet|cach su dung|huong dan|ket noi|setup|remote|kem .* khong|dung .* khong|con hang)\b/i.test(norm(text));
}

function hasPromptLeak(reply = '') {
  const raw = String(reply || '').trim();
  const normalized = norm(raw);
  return /^(?:thought|analysis|assistant|system|developer)\b/i.test(raw)
    || /\b(system prompt|developer message|final language rule|bat buoc tuan thu|du lieu tham khao|lich su gan day|truy van dung de tim san pham|consultant for)\b/i.test(normalized)
    || /<\/?(?:think|analysis)>/i.test(raw);
}

function hasObviousLanguageMismatch(reply = '', expectedLanguage = 'vi') {
  const text = String(reply || '');
  if (expectedLanguage === 'vi') {
    return /\b(i found|please tell|how can i|thank you|could you|which product|share your phone)\b/i.test(text)
      && !/\b(dạ|anh\/chị|bạn|hiện|sản phẩm|giá|để em)\b/i.test(text);
  }
  if (expectedLanguage === 'en') {
    return /\b(dạ|anh\/chị|hiện tại|sản phẩm|giá|để em|chưa có)\b/i.test(text);
  }
  return false;
}

function contextProductMismatch({ userText, reply, conversationContext = {} }) {
  if (!isContextualQuestion(userText) || isAlternativeRequest(userText, conversationContext)) return false;
  const currentUrl = normalizeUrl(conversationContext.current_product_url || '');
  const currentSku = norm(conversationContext.current_product_sku || '');
  if (!currentUrl && !currentSku) return false;

  const replyUrls = extractUrls(reply).filter(url => /\/products?\//i.test(url));
  if (currentUrl && replyUrls.length && replyUrls.some(url => url !== currentUrl)) return true;
  if (currentSku && /\bsku\s*:/i.test(String(reply || ''))) {
    const replySku = norm(String(reply || '').match(/\bsku\s*:\s*([^\s,|)]+)/i)?.[1] || '');
    return Boolean(replySku && replySku !== currentSku);
  }
  return false;
}

function invalidProductUrl(reply = '', ragProducts = [], webSources = [], conversationContext = {}) {
  const replyUrls = extractUrls(reply).filter(url => /\/products?\//i.test(url));
  if (!replyUrls.length) return false;
  const allowed = new Set([
    ...ragProducts.map(productUrl),
    ...webSources.map(source => normalizeUrl(source?.url || '')),
    normalizeUrl(conversationContext.current_product_url || '')
  ].filter(Boolean));
  return replyUrls.some(url => !allowed.has(url));
}

function validationFailure(reason, options) {
  return {
    ok: false,
    reason,
    reply: buildSafeReply(options)
  };
}

function validateAiReply({
  userText,
  history = [],
  reply,
  ragProducts = [],
  webSources = [],
  conversationContext = {},
  customerBrand = 'KingCom',
  expectedLanguage = 'vi',
  multiItemQuote = false
} = {}) {
  const maxPrice = extractMaxPrice(userText) || extractMaxPrice((history || []).map(message => message.text).slice(-4).join(' '));
  const categories = inferRequestedCategories(userText, history);
  const safeOptions = { categories, maxPrice, customerBrand, expectedLanguage };

  if (hasPromptLeak(reply)) {
    return validationFailure('Câu trả lời có dấu hiệu lộ prompt hoặc reasoning nội bộ', safeOptions);
  }
  if (hasObviousLanguageMismatch(reply, expectedLanguage)) {
    return validationFailure('Câu trả lời dùng sai ngôn ngữ so với khách', safeOptions);
  }
  if (invalidProductUrl(reply, ragProducts, webSources, conversationContext)) {
    return validationFailure('Link sản phẩm trong câu trả lời không thuộc dữ liệu đã tìm được', safeOptions);
  }
  if (contextProductMismatch({ userText, reply, conversationContext })) {
    return validationFailure('Câu trả lời đổi sang sản phẩm khác với ngữ cảnh đang hỏi', safeOptions);
  }
  if (hasUnsupportedPriceClaim(reply, ragProducts)) {
    return validationFailure('Gi\u00e1 trong c\u00e2u tr\u1ea3 l\u1eddi kh\u00f4ng c\u00f3 b\u1eb1ng ch\u1ee9ng kh\u1edbp t\u1eeb catalog/retrieval', safeOptions);
  }
  if (unsupportedAvailabilityClaim(reply, ragProducts)) {
    return validationFailure('Kh\u1eb3ng \u0111\u1ecbnh t\u1ed3n kho trong c\u00e2u tr\u1ea3 l\u1eddi ch\u01b0a c\u00f3 b\u1eb1ng ch\u1ee9ng t\u1eeb catalog/retrieval', safeOptions);
  }
  if (!categories.length && !maxPrice) return { ok: true };
  if (!replyMentionsProduct(reply)) return { ok: true };

  const productsInReply = (ragProducts || []).filter(product => productAppearsInReply(reply, product));
  const candidateProducts = productsInReply.length ? productsInReply : (ragProducts || []);

  if (!multiItemQuote && categories.length && candidateProducts.length) {
    const matching = candidateProducts.filter(product => categories.some(category => productMatchesCategory(product, category)));
    if (!matching.length || (productsInReply.length && productsInReply.some(product => !categories.some(category => productMatchesCategory(product, category))))) {
      return validationFailure('Câu trả lời có sản phẩm lệch nhóm khách hỏi', safeOptions);
    }
  }

  if (maxPrice && candidateProducts.length) {
    const overBudgetProducts = candidateProducts.filter(product => {
      const price = parsePriceNumber(product.price || product.compare_at_price || product.gia || '');
      return price > 0 && price > maxPrice && productAppearsInReply(reply, product);
    });
    if (overBudgetProducts.length) {
      return validationFailure('Câu trả lời vượt ngân sách khách hỏi', safeOptions);
    }
  }

  return { ok: true };
}

module.exports = {
  validateAiReply,
  inferRequestedCategories,
  extractMaxPrice,
  hasPromptLeak,
  hasObviousLanguageMismatch,
  contextProductMismatch,
  invalidProductUrl
};
