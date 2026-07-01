const {
  buildContext,
  queryWords,
  getPriceExtremes,
  isPriceExtremeQuery,
  requestedPriceExtremes,
  extractMaxPrice,
  extractExactPrice,
  findProductsByExactPrice,
  loadProducts,
  loadTextFile,
  extractProductPageUrls,
  parsePriceNumber,
  normalize,
  matchesRequiredCategory
} = require('./rag');
const {
  readSourceConfig,
  resolveCustomerBrand,
  applyCustomerBranding
} = require('./sourceRegistry');
const { answerProductGuidanceFromWeb, answerProductSpecsFromWeb } = require('./webGuidance');
const { readProductPageContext } = require('./productPageReader');
const { chatCompletion } = require('./llmClient');
const {
  normalizeContext,
  resolveConversationContext,
  contextSearchText,
  buildClarificationReply,
  isContextualProductFollowUp,
  isAlternativeProductRequest,
  inferRequestedCategory,
  findExplicitProduct
} = require('./conversationContext');
const { structuredMessageSearchText } = require('./customerIntentParser');

async function callOpenAI(prompt, timeoutMs) {
  const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const maxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 700);
  const formattedPrompt = `${prompt}

Yêu cầu định dạng bắt buộc:
- Trả lời bằng văn bản thuần, không dùng markdown.
- Không dùng ký tự ** để in đậm.
- Không dùng emoji hoặc icon trang trí.`;

  // Reply uses a little creativity for natural customer-service wording.
  const configuredMaxAttempts = Number(process.env.OPENAI_MAX_ATTEMPTS || 0);
  const legacyRetries = Math.max(0, Number(process.env.OPENAI_EMPTY_RESPONSE_RETRIES || 1));
  const maxAttempts = configuredMaxAttempts > 0 ? configuredMaxAttempts : legacyRetries + 1;
  return chatCompletion({
    model,
    temperature: 0.3,
    timeoutMs,
    maxOutputTokens,
    maxAttempts,
    retryMaxOutputTokens: Math.max(maxOutputTokens * 2, 1200),
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT || 'minimal',
    messages: [{ role: 'user', content: formattedPrompt }]
  });
}

function formatPrice(price) {
  const raw = String(price || '').trim();
  if (/^\$/.test(raw) || /\busd\b/i.test(raw)) {
    const n = Number(raw.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0
      ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : raw;
  }
  const n = Number(raw.replace(/[^0-9]/g, ''));
  return n ? `${n.toLocaleString('vi-VN')}đ` : (price || 'liên hệ');
}

function detectMessageLanguageFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'vi';

  if (/[\u3400-\u9FFF\uF900-\uFAFF]/.test(raw)) return 'zh';

  const normalized = normalize(raw);
  const hasVietnameseMarks = /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(raw);
  const vietnameseHints = [
    'anh', 'chi', 'em', 'minh', 'toi', 'ban', 'shop', 'ben minh', 'co khong', 'khong',
    'mua', 'gia', 'bao nhieu', 'san pham', 'tu van', 'con hang', 'dia chi', 'giao hang'
  ];
  const vietnameseTokenHints = new Set(['co', 'ko', 'k', 'con', 'hang', 'bao', 'gia', 'den', 'chan', 'may']);
  const normalizedTokens = normalized.split(/\s+/).filter(Boolean);
  if (
    hasVietnameseMarks
    || vietnameseHints.some(h => normalized.includes(h))
    || normalizedTokens.some(token => vietnameseTokenHints.has(token))
  ) return 'vi';

  const englishHits = (raw.match(/\b(hello|hi|please|pls|i|im|i'm|am|looking|look|for|need|want|buy|do|does|have|carry|sell|available|stock|price|how|much|can|you|is|the|this|that|mobile|phone|smartphone|tripod|camera|microphone|light)\b/gi) || []).length;
  const asciiLetters = (raw.match(/[a-z]/gi) || []).length;
  if (asciiLetters >= 2 && englishHits >= 1) return 'en';

  return 'vi';
}

function detectMessageLanguage(text, history = []) {
  const raw = String(text || '').trim();
  const detected = detectMessageLanguageFromText(raw);
  const tokens = raw.split(/\s+/).filter(Boolean);
  const hasStrongSignal = /[\u3400-\u9FFF\uF900-\uFAFF]/.test(raw)
    || /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(raw)
    || /\b(hello|please|looking|price|how much|warranty|invoice)\b/i.test(raw);
  if (tokens.length > 2 || hasStrongSignal || !Array.isArray(history) || !history.length) return detected;

  const previousCustomerMessage = [...history].reverse().find(message => {
    if (message?.sender_type !== 'customer') return false;
    const prior = String(message.text || '').trim();
    return prior && prior !== raw;
  });
  return previousCustomerMessage
    ? detectMessageLanguageFromText(previousCustomerMessage.text)
    : detected;
}

function isEnglishMessage(text) {
  return detectMessageLanguage(text) === 'en';
}

function isAvailabilityQuestion(text) {
  const raw = String(text || '');
  const norm = normalize(raw);
  // Nếu câu hỏi có nhắc tới phụ kiện, tính năng, hoặc hỏi chi tiết, tuyệt đối không được coi là câu hỏi "còn hàng không" đơn giản
  if (/(kem|remote|phu kien|pin|day cap|tinh nang|chuc nang|mau|size|bao hanh)/i.test(norm)) return false;
  return /\b(?:do|does)\s+(?:you|u|kingcom|shop|store)?\s*(?:have|carry|sell)\b/i.test(raw)
    || /\b(?:available|in stock|stock status)\b/i.test(raw)
    || /(co hang|con hang|san pham nay co khong|ben em co ban|ben em con hang|shop co ban|shop con hang|dang ban|con khong)/i.test(norm);
}

function isStartingPriceQuery(text) {
  return /\b(gia tu bao nhieu|tu bao nhieu|gia khoang bao nhieu|starting price)\b/i.test(normalize(text));
}

function isShortSpecificFollowUp(text) {
  const normalized = normalize(text);
  const words = queryWords(text);
  return /\b(thi sao|thì sao|con|còn|vay|vậy)\b/i.test(`${normalized} ${String(text || '').toLowerCase()}`)
    && words.length <= 4
    && words.some(w => w.length >= 4 && !['den', 'light', 'micro', 'lens', 'hang'].includes(w));
}

function hasPhoneNumber(text) {
  return /(?:\+?84|0)(?:[\s.-]?\d){8,10}\b/.test(String(text || ''));
}

function cleanContactName(name) {
  return String(name || '')
    .replace(/^(?:tôi|toi|em|mình|minh)\s+(?:là|la)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[,.!?;:]+$/g, '');
}

function extractContactInfo(text) {
  const raw = String(text || '').trim();
  const phoneMatch = raw.match(/(?:\+?84|0)(?:[\s.-]?\d){8,10}\b/);
  const phone = phoneMatch ? phoneMatch[0].replace(/[^\d+]/g, '') : '';
  const withoutPhone = phoneMatch ? raw.replace(phoneMatch[0], ' ') : raw;
  const normalized = normalize(withoutPhone);

  let name = '';
  const rawNameMatch = withoutPhone.match(/(?:ý\s*tôi\s*là|y\s*toi\s*la|tôi\s*là|toi\s*la|em\s*là|em\s*la|mình\s*là|minh\s*la|tên\s*(?:tôi|em|mình)?\s*là|ten\s*(?:toi|em|minh)?\s*la|tên\s*là|ten\s*la)\s+([^,.!?;:]+)/iu);
  if (rawNameMatch) {
    name = cleanContactName(rawNameMatch[1]);
  }

  const normalizedNameMatch = normalized.match(/\b(?:y toi la|toi la|em la|minh la|ten toi la|ten em la|ten minh la|ten la)\s+([a-z\s]{2,40})/);
  if (!name && normalizedNameMatch) {
    name = normalizedNameMatch[1]
      .replace(/^(?:toi|em|minh)\s+(?:la)\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (!name) {
    const rawHonorificMatch = withoutPhone.match(/\b(?:anh|chị|chi|cô|co|chú|chu)\s+[\p{L}]{2,30}\b/iu);
    if (rawHonorificMatch && (phone || /\b(?:toi la|em la|minh la|ten la|goi|lien he|sdt|so dien thoai)\b/.test(normalized))) {
      name = cleanContactName(rawHonorificMatch[0]);
    }
  }

  if (!name) {
    const honorificMatch = normalized.match(/\b(?:anh|chi|co|chu)\s+([a-z]{2,30})\b/);
    if (honorificMatch && (phone || /\b(?:toi la|em la|minh la|ten la|goi|lien he|sdt|so dien thoai)\b/.test(normalized))) {
      name = honorificMatch[0].trim();
    }
  }

  return { phone, name };
}

function isContactInfoMessage(text) {
  const raw = String(text || '');
  const normalized = normalize(raw);
  const contact = extractContactInfo(raw);
  return Boolean(contact.phone)
    || /\b(?:y toi la|toi la|em la|minh la|ten toi la|ten em la|ten minh la|ten la)\b/.test(normalized);
}

function buildContactInfoReply(userText, lang = 'vi') {
  if (!isContactInfoMessage(userText)) return null;
  const { phone, name } = extractContactInfo(userText);
  const displayName = name || '';

  if (lang === 'en') {
    if (phone) return `Thank you, I have received your phone number ${phone}${displayName ? ` and contact name ${displayName}` : ''}. I will forward it to KingCom staff for follow-up.`;
    return `Thank you, I have noted your contact information${displayName ? ` as ${displayName}` : ''}.`;
  }

  if (lang === 'zh') {
    if (phone) return `谢谢，我已收到您的电话号码 ${phone}${displayName ? ` 和联系人 ${displayName}` : ''}，并会转交给 KingCom 员工跟进。`;
    return `谢谢，我已记录您的联系信息${displayName ? `：${displayName}` : ''}。`;
  }

  if (phone) {
    return `Dạ em đã nhận được số điện thoại ${phone}${displayName ? ` và thông tin liên hệ ${displayName}` : ''}. Em sẽ chuyển thông tin cho nhân viên KingCom liên hệ tư vấn sớm ạ.`;
  }
  return `Dạ em đã ghi nhận thông tin của anh/chị${displayName ? ` là ${displayName}` : ''}. KingCom sẽ dùng thông tin này để hỗ trợ anh/chị tốt hơn ạ.`;
}

function productDisplayName(product, fallback = 'product') {
  return product.name || product.title || product.sku || fallback;
}

function isConversationStopRequest(text = '') {
  const normalized = normalize(text);
  return /\b(khong can ho tro|ko can ho tro|khong can nua|ko can nua|khong nhan nua|ko nhan nua|dung nhan|dung gui|thoi khong can|thoi ko can|khong lam phien|ko lam phien|stop|no need|no more|do not message)\b/i.test(normalized);
}

function buildConversationStopReply(lang = 'vi', customerBrand = 'KingCom') {
  if (lang === 'en') return `Understood. I will stop here. If you need support later, please message ${customerBrand} anytime.`;
  if (lang === 'zh') return `好的，我先不打扰您了。之后如需协助，可以随时联系 ${customerBrand}。`;
  return `Dạ vâng ạ. Em sẽ dừng tại đây. Khi nào cần hỗ trợ thêm, anh/chị cứ nhắn ${customerBrand} nhé.`;
}

function buildAvailabilityReply(userText, products) {
  if (!isAvailabilityQuestion(userText) || !products?.length) return null;

  const product = products[0];
  const name = productDisplayName(product);
  const rawPrice = product._price || product.price || product.compare_at_price || product.gia || '';
  const url = product.url || product.link || product.product_url || '';
  const lang = detectMessageLanguage(userText);
  const chinese = lang === 'zh';
  const english = lang === 'en';
  const price = formatPrice(rawPrice);
  const userNorm = normalize(userText);
  const nameNorm = normalize(name);
  const exactEnough = nameNorm && (userNorm.includes(nameNorm) || queryWords(userText).filter(w => nameNorm.includes(w)).length >= 2);
  const intro = exactEnough
    ? (english ? `Yes, ${name} is listed in our catalog.` : `Dạ ${name} đang có trong danh mục sản phẩm của KingCom.`)
    : (english ? `Did you mean ${name}? This product is listed in our catalog.` : `Dạ có phải anh/chị đang hỏi ${name} không ạ? Sản phẩm này đang có trong danh mục của KingCom.`);

  if (chinese) {
    const cnIntro = exactEnough
      ? `${name} 已在 KingCom 产品目录中。`
      : `您是想咨询 ${name} 吗？该产品已在 KingCom 产品目录中。`;
    return [
      cnIntro,
      '',
      name,
      `价格: ${price}`,
      url ? `链接: ${url}` : '',
      '',
      '我可以请 KingCom 员工为您确认当前库存。请留下电话号码，或告诉我您想确认哪一个型号。'
    ].filter(Boolean).join('\n');
  }

  if (english) {
    return [
      intro,
      '',
      name,
      `Price: ${price}`,
      url ? `Link: ${url}` : '',
      '',
      'I can help check current stock before you order. May I have your phone number, or would you like our staff to confirm availability?'
    ].filter(Boolean).join('\n');
  }

  return [
    intro,
    '',
    name,
    `Giá: ${price}`,
    url ? `Link: ${url}` : '',
    '',
    'Em có thể chuyển nhân viên kiểm tra tồn kho hiện tại trước khi mình đặt hàng. Anh/chị cho em xin số điện thoại để hỗ trợ nhanh hơn ạ.'
  ].filter(Boolean).join('\n');
}

function productLine(product, index = 1) {
  const name = product.name || product.title || product.sku || `Sản phẩm ${index}`;
  const price = formatPrice(product._price || product.price || product.compare_at_price || product.gia || '');
  const url = product.url || product.link || product.product_url || '';
  return `${index}. ${name}\nGiá: ${price}${url ? `\nLink: ${url}` : ''}`;
}

function isPreviousAdviceComplaint(userText) {
  const normalized = normalize(userText);
  return (
    /\b(tai sao|sao|vi sao)\b/i.test(normalized)
    && /\b(nay|luc nay|hoi|tu van|tra loi|khong co|khong thay)\b/i.test(normalized)
  ) || /\b(hoi|dang hoi).{0,50}(sai|nham|lac de|tra loi|tu van)\b/i.test(normalized);
}

function buildBudgetProductReply(userText, products, scopeBrand = '', customerPhone = '') {
  const maxPrice = extractMaxPrice(userText);
  if (!maxPrice || !products?.length) return null;
  const lang = detectMessageLanguage(userText);
  const budgetProducts = productsWithinBudget(userText, products);
  if (!budgetProducts.length) return null;
  const rows = budgetProducts.slice(0, 3).map((p, i) => productLine(p, i + 1)).join('\n\n');
  const scope = scopeBrand ? ` trong catalog ${scopeBrand}` : '';
  const hasPhone = Boolean(String(customerPhone || '').trim());
  if (lang === 'en') {
    const closing = hasPhone
      ? 'Please tell me which model you prefer so I can help you compare further.'
      : 'Please tell me which model you prefer, or share your phone number so KingCom staff can check current stock.';
    return `I found matching products${scope} within ${formatPrice(maxPrice)}:\n\n${rows}\n\n${closing}`;
  }
  if (lang === 'zh') {
    const closing = hasPhone
      ? '请告诉我您想进一步了解哪一款。'
      : '请告诉我您想了解哪一款，或留下电话号码，方便 KingCom 员工确认库存。';
    return `我找到以下${scope}中符合 ${formatPrice(maxPrice)} 以内的产品：\n\n${rows}\n\n${closing}`;
  }
  const closing = hasPhone
    ? 'Anh/chị muốn xem kỹ mẫu nào để em tư vấn tiếp ạ?'
    : 'Anh/chị muốn xem kỹ mẫu nào, hoặc để lại số điện thoại để nhân viên KingCom kiểm tra tồn kho hỗ trợ thêm ạ?';
  return `Dạ em tìm thấy sản phẩm phù hợp${scope} trong tầm giá dưới ${formatPrice(maxPrice)}:\n\n${rows}\n\n${closing}`;
}

function productsWithinBudget(userText, products = []) {
  const maxPrice = extractMaxPrice(userText);
  if (!maxPrice) return [];
  return (products || [])
    .map(product => ({
      product,
      price: parsePriceNumber(product.price || product.compare_at_price || product.gia || '')
    }))
    .filter(item => item.price > 0 && item.price <= maxPrice)
    .sort((a, b) => {
      const scoreDiff = Number(b.product.score || 0) - Number(a.product.score || 0);
      return scoreDiff || a.price - b.price;
    })
    .map(item => item.product);
}

function buildStartingPriceReply(userText, products, scopeBrand = '') {
  if (!isStartingPriceQuery(userText)) return null;
  const priced = (products || [])
    .map(product => ({
      product,
      price: parsePriceNumber(product.price || product.compare_at_price || product.gia || '')
    }))
    .filter(item => item.price > 0)
    .sort((a, b) => a.price - b.price);
  if (!priced.length) return null;

  const { product, price } = priced[0];
  const name = product.name || product.title || 'sản phẩm phù hợp';
  const url = product.url || product.link || product.product_url || '';
  const scope = scopeBrand ? ` trong catalog ${scopeBrand}` : '';
  return `Dạ, sản phẩm phù hợp${scope} hiện có giá tham khảo từ ${formatPrice(price)}.\n\n${name}\nGiá: ${formatPrice(price)}${url ? `\nLink: ${url}` : ''}\n\nAnh/chị cho em biết dòng máy hoặc ngàm đang sử dụng để em chọn đúng mẫu tương thích ạ.`;
}

function buildPreviousAdviceCorrectionReply(userText, products, scopeBrand = '') {
  const lang = detectMessageLanguage(userText);
  const rows = (products || []).slice(0, 3).map((p, i) => productLine(p, i + 1)).join('\n\n');
  const scope = scopeBrand ? ` trong catalog ${scopeBrand}` : '';
  if (lang === 'en') {
    if (rows) {
      return `Sorry, the previous reply did not match the catalog correctly.\n\nI checked again and found matching products${scope}:\n\n${rows}\n\nThank you for pointing that out. KingCom staff can also check current stock if you share your phone number.`;
    }
    return 'Sorry, the previous reply may not have matched the catalog correctly. I have forwarded this to KingCom staff so they can check again and support you accurately.';
  }
  if (lang === 'zh') {
    if (rows) {
      return `不好意思，刚才的回复没有正确匹配目录。\n\n我重新检查后，找到以下符合的产品${scope}：\n\n${rows}\n\n感谢您指出，如需确认库存，可以留下电话号码。`;
    }
    return '不好意思，刚才的回复可能没有正确匹配目录。我已转交 KingCom 员工重新检查，以便更准确地支持您。';
  }
  if (rows) {
    return `Dạ em xin lỗi anh/chị, lúc nãy em kiểm tra chưa khớp đúng catalog nên trả lời chưa chính xác.\n\nEm xác nhận lại có sản phẩm phù hợp${scope}:\n\n${rows}\n\nCảm ơn anh/chị đã nhắc lại. Nếu anh/chị muốn chốt mẫu nào, em có thể chuyển nhân viên KingCom kiểm tra tồn kho thêm ạ.`;
  }
  return 'Dạ em xin lỗi anh/chị, lúc nãy em có thể đã kiểm tra chưa khớp đúng catalog. Em đã chuyển thông tin cho nhân viên KingCom kiểm tra lại để hỗ trợ chính xác hơn ạ.';
}

function buildDirectPriceReply(userText, options = {}) {
  const exactPrice = extractExactPrice(userText);
  const looksLikeExactPriceQuestion = exactPrice && /(là|la|sản phẩm|san pham|mức giá|muc gia|giá|gia)/i.test(String(userText || ''));
  if (looksLikeExactPriceQuestion && !isPriceExtremeQuery(userText)) {
    const matches = findProductsByExactPrice(userText, 5, options);
    if (matches.length) {
      return {
        reply: `Dạ mức giá ${formatPrice(exactPrice)} đang khớp với các sản phẩm sau trong dữ liệu hiện tại:\n\n${matches.map((p, i) => productLine(p, i + 1)).join('\n\n')}`,
        products: matches,
        source: 'direct_price_lookup'
      };
    }
    return {
      reply: `Dạ em chưa tìm thấy sản phẩm nào có giá đúng ${formatPrice(exactPrice)} trong dữ liệu hiện tại. Em đã chuyển thông tin này cho nhân viên kiểm tra để tránh tư vấn sai. Anh/chị cho em xin thêm model hoặc số điện thoại để tư vấn viên hỗ trợ nhanh hơn ạ.`,
      products: [],
      source: 'direct_price_lookup'
    };
  }

  const normalizedPriceQuestion = normalize(userText);
  const hasDirectPriceProductAnchor = extractModelTokens(userText).length > 0
    || extractProductPageUrls(userText).length > 0
    || Boolean(options.conversationContext?.current_product_name || options.conversationContext?.current_product_sku);
  const looksLikeProductPriceQuestion = /\b(gia|price|cost)\b/i.test(normalizedPriceQuestion)
    && !extractMaxPrice(userText)
    && !isPriceExtremeQuery(userText)
    && hasDirectPriceProductAnchor;
  if (looksLikeProductPriceQuestion) {
    const matchedProducts = resolveOpinionProducts({
      userText,
      products: [],
      conversationContext: options.conversationContext || {},
      sourceKey: options.sourceKey || ''
    }).slice(0, 1);
    if (matchedProducts.length) {
      const product = matchedProducts[0];
      return {
        reply: `Dạ em kiểm tra trong catalog hiện tại:\n\n${productLine(product, 1)}\n\nGiá có thể thay đổi theo tồn kho và chương trình bán hàng. Nếu anh/chị muốn chốt mua, em có thể chuyển nhân viên kiểm tra lại giá và tồn kho chính xác.`,
        products: matchedProducts,
        source: 'direct_price_lookup'
      };
    }
  }

  if (!isPriceExtremeQuery(userText)) return null;

  const requestedCategory = options.requestedCategory
    || options.conversationContext?.requested_category
    || inferRequestedCategory(userText)
    || '';
  let mostExpensive = null;
  let cheapest = null;
  if (requestedCategory) {
    const scopedProducts = loadProducts(options)
      .filter(product => matchesRequiredCategory(product, requestedCategory))
      .map(product => ({
        ...product,
        _price: parsePriceNumber(product.price || product.compare_at_price || product.gia || '')
      }))
      .filter(product => product._price > 0)
      .sort((a, b) => b._price - a._price);
    mostExpensive = scopedProducts[0] || null;
    cheapest = [...scopedProducts].sort((a, b) => a._price - b._price)[0] || null;
  } else {
    ({ mostExpensive, cheapest } = getPriceExtremes(options));
  }
  const requested = requestedPriceExtremes(userText);
  const includeExpensive = requested.expensive || (!requested.expensive && !requested.cheap);
  const includeCheap = requested.cheap;
  const sections = [];
  const products = [];

  if (includeExpensive && mostExpensive) {
    sections.push(`Sản phẩm mắc nhất trong dữ liệu hiện tại:\n${productLine(mostExpensive, 1)}`);
    products.push(mostExpensive);
  }
  if (includeCheap && cheapest) {
    sections.push(`Sản phẩm rẻ nhất trong dữ liệu hiện tại:\n${productLine(cheapest, 1)}`);
    products.push(cheapest);
  }

  if (!sections.length) return null;
  return {
    reply: `Dạ em kiểm tra trực tiếp từ dữ liệu sản phẩm hiện tại:\n\n${sections.join('\n\n')}\n\nGiá có thể thay đổi theo tồn kho và chương trình bán hàng. Nếu anh/chị muốn chốt mua, em có thể chuyển nhân viên kiểm tra lại giá và tồn kho chính xác.`,
    products,
    source: 'direct_price_lookup'
  };
}

function productLinkBlock(products, max = 5) {
  const rows = (products || []).filter(p => p.url || p.link || p.product_url).slice(0, max);
  if (!rows.length) return '';
  return 'Link sản phẩm để anh/chị xem trực tiếp:\n' + rows.map((p, i) => {
    const url = p.url || p.link || p.product_url;
    const name = p.name || p.title || p.sku || `Sản phẩm ${i + 1}`;
    const price = formatPrice(p.price || p.compare_at_price || p.gia || '');
    return `${i + 1}. ${name} - ${price}\n${url}`;
  }).join('\n');
}

function ensureProductLinks(reply, products) {
  const block = productLinkBlock(products);
  if (!block) return reply;
  if (/(chưa có|không có|không kinh doanh|không phải|nhầm|not have|do not have|don't have|not listed|not available|does not carry|do not carry)/i.test(String(reply || ''))) {
    return reply;
  }
  const urls = (products || []).map(p => p.url || p.link || p.product_url).filter(Boolean);
  const hasAnyUrl = urls.some(u => reply && reply.includes(u));
  return hasAnyUrl ? reply : `${reply}\n\n${block}`;
}

function normalizeProductUrl(url) {
  return String(url || '').trim().replace(/[.,;:!?]+$/g, '').replace(/\/+$/g, '');
}

function hasUnapprovedProductUrl(reply, products) {
  const allowedUrls = new Set(
    (products || [])
      .map(p => normalizeProductUrl(p.url || p.link || p.product_url))
      .filter(Boolean)
  );
  const replyUrls = String(reply || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return replyUrls.some(url => !allowedUrls.has(normalizeProductUrl(url)));
}

function hasProductCatalogUrl(reply) {
  const replyUrls = String(reply || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return replyUrls.some(url => /\/products?\//i.test(url));
}

function buildScopedProductsReply(products, userText, scopeBrand) {
  const lang = detectMessageLanguage(userText);
  const rows = (products || []).slice(0, 3).map((p, i) => {
    const name = p.name || p.title || p.sku || (lang === 'en' ? `Product ${i + 1}` : `Sản phẩm ${i + 1}`);
    const rawPrice = p._price || p.price || p.compare_at_price || p.gia || '';
    const price = formatPrice(rawPrice);
    const url = p.url || p.link || p.product_url || '';

    if (lang === 'zh') return `${i + 1}. ${name}\n价格: ${price}${url ? `\n链接: ${url}` : ''}`;
    if (lang === 'en') return `${i + 1}. ${name}\nPrice: ${price}${url ? `\nLink: ${url}` : ''}`;
    return `${i + 1}. ${name}\nGiá: ${price}${url ? `\nLink: ${url}` : ''}`;
  }).join('\n\n');

  if (lang === 'zh') {
    return `我在 ${scopeBrand} 产品目录中找到以下相关产品：\n\n${rows}\n\n请告诉我您想了解哪一个型号，或留下电话号码，方便 KingCom 员工进一步协助。`;
  }
  if (lang === 'en') {
    return `I found these matching products in the ${scopeBrand} catalog:\n\n${rows}\n\nPlease tell me which model you prefer, or share your phone number so KingCom staff can assist you further.`;
  }
  return `Dạ em tìm thấy các sản phẩm phù hợp trong catalog ${scopeBrand}:\n\n${rows}\n\nAnh/chị đang quan tâm mẫu nào, hoặc để lại số điện thoại để nhân viên KingCom hỗ trợ thêm ạ?`;
}

function isCatalogRecommendationQuery(userText) {
  const normalized = normalize(userText);
  return /\b(hot|ban chay|noi bat|pho bien|best seller|bestseller|popular|trending)\b/i.test(normalized);
}

function isProductGuidanceQuery(userText) {
  const raw = String(userText || '');
  const normalized = normalize(raw);
  return /\b(cach su dung|cach dung|huong dan|su dung nhu the nao|dung nhu the nao|ket noi|cai dat|setup|pair|pairing|configure|configuration|how to use|how do i use|instructions?|user guide|connect|install)\b/i.test(normalized)
    || /(使用|怎么用|如何使用|说明书|连接|设置|安装|配对)/.test(raw);
}

function isCompatibilityFollowUp(userText) {
  const normalized = normalize(userText);
  const asksCompatibility = /\b(tuong thich|dung cho|danh cho|dung voi|dung duoc voi|dung duoc cho|cho laptop|cho may tinh|ket noi|ho tro|compatible|compatibility)\b/i.test(normalized);
  const targetDevice = /\b(laptop|may tinh|pc|windows|mac|macbook|iphone|android|dien thoai|smartphone|camera|may anh)\b/i.test(normalized);
  return asksCompatibility && targetDevice;
}

function isDirectProductSpecsQuery(userText) {
  const raw = String(userText || '');
  const normalized = normalize(userText);
  return /\b(thong so|thong so ky thuat|cau hinh|chi tiet ky thuat|chi tiet san pham|kich thuoc|trong luong|cong suat|do phan giai|cam bien|khau do|tieu cu|dung luong pin|thoi luong pin|pin bao lau|cao bao nhieu|cao toi da|chieu cao|dai bao nhieu|rong bao nhieu|nang bao nhieu|luc hut|tai trong|tuong thich|dung cho|danh cho|dung voi|dung duoc voi|dung duoc cho|cho laptop|cho may tinh|ket noi laptop|ket noi may tinh|ho tro laptop|ho tro may tinh|ho tro iphone|ho tro android|co remote|kem remote|remote khong|phu kien kem theo|kem theo gi|ram|bo nho|technical specifications?|product specifications?|specs?|specifications?|height|weight|dimensions|compatible with|compatibility|include remote|come with remote|included accessories)\b/i.test(normalized)
    || /(\u53c2\u6570|\u89c4\u683c|\u6280\u672f\u53c2\u6570|\u914d\u7f6e|\u5c3a\u5bf8|\u91cd\u91cf|\u529f\u7387|\u5206\u8fa8\u7387|\u4f20\u611f\u5668|\u5149\u5708)/.test(raw);
}

function catalogHasClearSpecs(product = {}) {
  const text = [
    product.description,
    product.content,
    product.details,
    product.specs,
    product.specification,
    product.attributes,
    product.short_description
  ].filter(Boolean).join(' ');
  const normalized = normalize(text);
  if (!normalized) return false;

  const specSignals = [
    /\b\d+(?:[.,]\d+)?\s?(?:cm|mm|m|kg|g|mah|w|kw|hz|khz|fps|mp|inch|in|ohm|db|lux)\b/i,
    /\b(?:kich thuoc|trong luong|dung luong pin|thoi luong pin|do phan giai|sensor|aperture|focal|compatibility|wireless|bluetooth|usb-c|pin|cong suat|tan so|so kenh|so luong|battery life|dimensions|weight)\b/i,
    /\b\d+\s*x\s*\d+\b/i
  ];

  const score = specSignals.reduce((count, regex) => count + (regex.test(normalized) ? 1 : 0), 0);
  return (normalized.length >= 120 && score >= 1) || score >= 2;
}

function productSpecText(product = {}) {
  return [
    product.description,
    product.content,
    product.details,
    product.specs,
    product.specification,
    product.attributes,
    product.short_description
  ].filter(Boolean).join(' ');
}

function normalizeSpecText(text = '') {
  return normalize(text)
    .replace(/\b(\d+)\s+(\d+)(?=(?:m|cm|mm|kg|g|n|w|mah|mp|fps|hz|khz|db|lux)\b)/gi, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function captureSpecValue(text, startPattern, stopPatterns = []) {
  const stop = stopPatterns.length ? `(?=\\b(?:${stopPatterns.join('|')})\\b|$)` : '$';
  const match = text.match(new RegExp(`\\b${startPattern}\\b\\s+(.{1,140}?)\\s*${stop}`, 'i'));
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function addSpecFact(facts, label, value) {
  const clean = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\b(\d+)\s+(\d+)(?=(?:m|cm|mm|kg|g|n|w|mah|mp|fps|hz|khz|db|lux)\b)/gi, '$1.$2')
    .trim()
    .replace(/[.;,]+$/g, '');
  if (!clean) return;
  const key = `${label}:${clean}`.toLowerCase();
  if (facts.some(fact => fact.key === key)) return;
  facts.push({ key, label, value: clean });
}

function extractCatalogSpecFacts(product = {}, userText = '') {
  const specText = normalizeSpecText(productSpecText(product));
  if (!specText) return [];

  const query = normalize(userText);
  const wants = {
    height: /\b(cao bao nhieu|cao toi da|chieu cao|height)\b/i.test(query),
    dimensions: /\b(kich thuoc|dai bao nhieu|rong bao nhieu|dimensions)\b/i.test(query),
    weight: /\b(trong luong|nang bao nhieu|weight)\b/i.test(query),
    battery: /\b(pin|dung luong pin|thoi luong pin|battery)\b/i.test(query),
    magnetic: /\b(luc hut|magsafe|nam cham|magnetic)\b/i.test(query),
    payload: /\b(tai trong|load|payload)\b/i.test(query),
    remote: /\b(remote|bluetooth|ket noi|connect)\b/i.test(query),
    compatibility: /\b(tuong thich|dung duoc voi|dung duoc cho|ho tro iphone|ho tro android|iphone|android|compatibility|compatible)\b/i.test(query),
    power: /\b(cong suat|watt|power)\b/i.test(query),
    resolution: /\b(do phan giai|resolution|mp)\b/i.test(query)
  };
  const generic = /\b(thong so|cau hinh|chi tiet|specs?|specifications?)\b/i.test(query)
    || !Object.values(wants).some(Boolean);
  const facts = [];
  const all = generic;

  if (all || wants.height || wants.dimensions) {
    addSpecFact(facts, 'Chi\u1ec1u cao t\u1ed1i \u0111a', captureSpecValue(specText, 'chieu cao toi da', ['chieu cao gap gon', 'trong luong', 'luc hut', 'tai trong', 'ket noi', 'tuong thich', 'mua ngay']));
    addSpecFact(facts, 'Chi\u1ec1u cao g\u1ea5p g\u1ecdn', captureSpecValue(specText, 'chieu cao gap gon', ['trong luong', 'luc hut', 'tai trong', 'ket noi', 'tuong thich', 'mua ngay']));
  }
  if (all || wants.weight) {
    addSpecFact(facts, 'Tr\u1ecdng l\u01b0\u1ee3ng', captureSpecValue(specText, 'trong luong', ['luc hut', 'tai trong', 'ket noi', 'tuong thich', 'mua ngay']));
  }
  if (all || wants.magnetic) {
    addSpecFact(facts, 'L\u1ef1c h\u00fat MagSafe', captureSpecValue(specText, 'luc hut tu tinh', ['tai trong', 'ket noi', 'tuong thich', 'mua ngay']) || captureSpecValue(specText, 'luc hut magsafe', ['tai trong', 'ket noi', 'tuong thich', 'mua ngay']));
  }
  if (all || wants.payload) {
    addSpecFact(facts, 'T\u1ea3i tr\u1ecdng', captureSpecValue(specText, 'tai trong toi da', ['ket noi', 'tuong thich', 'mua ngay']));
  }
  if (all || wants.remote) {
    addSpecFact(facts, 'K\u1ebft n\u1ed1i', captureSpecValue(specText, 'ket noi', ['tuong thich', 'mua ngay']));
  }
  if (all || wants.compatibility) {
    addSpecFact(facts, 'T\u01b0\u01a1ng th\u00edch', captureSpecValue(specText, 'tuong thich', ['mua ngay']));
  }
  if (all || wants.battery) {
    addSpecFact(facts, 'Pin', captureSpecValue(specText, 'dung luong pin', ['thoi luong pin', 'cong suat', 'ket noi', 'tuong thich', 'mua ngay']) || captureSpecValue(specText, 'thoi luong pin', ['cong suat', 'ket noi', 'tuong thich', 'mua ngay']));
  }
  if (all || wants.power) {
    addSpecFact(facts, 'C\u00f4ng su\u1ea5t', captureSpecValue(specText, 'cong suat', ['do phan giai', 'ket noi', 'tuong thich', 'mua ngay']));
  }
  if (all || wants.resolution) {
    addSpecFact(facts, '\u0110\u1ed9 ph\u00e2n gi\u1ea3i', captureSpecValue(specText, 'do phan giai', ['cam bien', 'ket noi', 'tuong thich', 'mua ngay']));
  }

  if (!facts.length && catalogHasClearSpecs(product)) {
    addSpecFact(facts, 'M\u00f4 t\u1ea3 catalog', productSpecText(product).replace(/\s+/g, ' ').trim().slice(0, 500));
  }

  return facts.map(({ label, value }) => ({ label, value })).slice(0, all ? 8 : 4);
}

function compatibilityTargetFromText(text = '') {
  const normalized = normalize(text);
  if (/\b(laptop|may tinh|pc|windows|macbook|mac)\b/i.test(normalized)) return { key: 'laptop', label: 'laptop/máy tính' };
  if (/\b(iphone|ios|lightning|magsafe)\b/i.test(normalized)) return { key: 'iphone', label: 'iPhone' };
  if (/\b(android|type c|type-c|usb c|usb-c)\b/i.test(normalized)) return { key: 'android', label: 'Android/USB-C' };
  if (/\b(dien thoai|smartphone|phone)\b/i.test(normalized)) return { key: 'phone', label: 'điện thoại' };
  if (/\b(camera|may anh|dslr|mirrorless)\b/i.test(normalized)) return { key: 'camera', label: 'máy ảnh/camera' };
  return null;
}

function compatibilityMentionedInProduct(product = {}, target = null) {
  if (!target) return false;
  const text = normalize(`${product.name || product.title || ''} ${product.description || ''} ${product.tags || ''} ${product.category || ''}`);
  const patterns = {
    laptop: /\b(laptop|may tinh|pc|windows|macbook|mac|usb-a|usb a)\b/i,
    iphone: /\b(iphone|ios|lightning|magsafe)\b/i,
    android: /\b(android|type c|type-c|usb c|usb-c)\b/i,
    phone: /\b(dien thoai|smartphone|phone|iphone|android)\b/i,
    camera: /\b(camera|may anh|dslr|mirrorless|gopro|action camera)\b/i
  };
  return patterns[target.key]?.test(text) || false;
}

function productCompatibilityHints(product = {}) {
  const text = normalize(`${product.name || product.title || ''} ${product.description || ''} ${product.tags || ''} ${product.category || ''}`);
  const hints = [];
  if (/\b(laptop|may tinh|pc|windows|macbook|mac|usb-a|usb a)\b/i.test(text)) hints.push('laptop/máy tính');
  if (/\b(iphone|ios|lightning|magsafe)\b/i.test(text)) hints.push('iPhone');
  if (/\b(android|type c|type-c|usb c|usb-c)\b/i.test(text)) hints.push('Android/USB-C');
  if (/\b(dien thoai|smartphone|phone)\b/i.test(text)) hints.push('điện thoại');
  if (/\b(camera|may anh|dslr|mirrorless|gopro|action camera)\b/i.test(text)) hints.push('máy ảnh/camera');
  return [...new Set(hints)].slice(0, 4);
}

function buildCompatibilityEvidenceReply(products, userText, lang = 'vi') {
  if (!isCompatibilityFollowUp(userText)) return null;
  const product = products?.[0];
  const name = productDisplayName(product, '');
  const target = compatibilityTargetFromText(userText);
  if (!product || !name || !target) return null;
  const url = product.url || product.link || product.product_url || '';
  const supported = compatibilityMentionedInProduct(product, target);
  const hints = productCompatibilityHints(product).filter(hint => hint !== target.label);
  const hintText = hints.length ? ` Catalog đang ghi/nhắc tới: ${hints.join(', ')}.` : '';

  if (lang === 'en') {
    return supported
      ? `Yes, the catalog indicates ${name} supports ${target.label}.${url ? `\nProduct link: ${url}` : ''}`
      : `I have not found confirmed ${target.label} compatibility for ${name} in the catalog.${hintText}${url ? `\nProduct link: ${url}` : ''}`;
  }
  if (lang === 'zh') {
    return supported
      ? `可以，目录信息显示 ${name} 支持 ${target.label}。${url ? `\n产品链接: ${url}` : ''}`
      : `我在目录中还没有找到 ${name} 支持 ${target.label} 的确认信息。${hintText}${url ? `\n产品链接: ${url}` : ''}`;
  }
  return supported
    ? `Dạ có ạ, catalog đang ghi ${name} hỗ trợ ${target.label}.${url ? `\nLink sản phẩm: ${url}` : ''}`
    : `Dạ, với ${name}, em chưa thấy catalog xác nhận hỗ trợ ${target.label}.${hintText}${url ? `\nLink sản phẩm: ${url}` : ''}`;
}

function buildProductSpecsEvidenceReply(products, userText, lang = 'vi') {
  const product = products?.[0];
  const name = productDisplayName(product, '');
  if (!product || !name) return null;
  const facts = extractCatalogSpecFacts(product, userText);
  if (!facts.length) return null;

  const url = product.url || product.link || product.product_url || '';
  if (lang === 'en') {
    const rows = facts.map(fact => `- ${fact.label}: ${fact.value}`).join('\n');
    return `I found these details in the catalog for ${name}:\n\n${rows}${url ? `\n\nProduct link: ${url}` : ''}`;
  }
  if (lang === 'zh') {
    const rows = facts.map(fact => `- ${fact.label}: ${fact.value}`).join('\n');
    return `${name} \u7684\u76ee\u5f55\u4fe1\u606f\uff1a\n\n${rows}${url ? `\n\n\u4ea7\u54c1\u94fe\u63a5: ${url}` : ''}`;
  }

  const rows = facts.map(fact => `- ${fact.label}: ${fact.value}`).join('\n');
  return `D\u1ea1, trong catalog c\u1ee7a ${name} c\u00f3 c\u00e1c th\u00f4ng tin sau:\n\n${rows}${url ? `\n\nLink s\u1ea3n ph\u1ea9m: ${url}` : ''}`;
}

function isComparisonQuestion(userText = '') {
  const raw = String(userText || '');
  const normalized = normalize(raw);
  return /\b(so sanh|compare|comparison|different|khac nhau|khac giua|nen chon|nen lay|nen dung|nen mua|nen chon mau nao|mau nao tot hon|loai nao tot hon|con so voi|vs|better|which one|which is better|a hay b|b hay a|hon mau nao|tot hon)\b/i.test(normalized)
    || /\b(so\s*sanh|compare\s+with)\b/i.test(raw);
}

function isSubjectiveAssessmentQuestion(userText = '') {
  const raw = String(userText || '');
  const normalized = normalize(raw);
  return /\b(on khong|nghe on|co on khong|co tot khong|tot khong|co ben khong|co dang mua khong|dang mua khong|co dang tien khong|dang tien khong|co hop khong|hop khong|phu hop khong|chat luong|review|danh gia|cam tinh|cam nhan|xai on|dung on|co nen mua|nen mua khong|nen chon khong|dung duoc khong|co ok khong|co on khong|co hay khong)\b/i.test(normalized)
    || /\b(nghe ổn|đáng mua|đáng tiền|bền không|tốt không|ổn không|phù hợp không|nên mua|nên chọn|review|đánh giá|cảm tính|chất lượng|có bền|có tốt)\b/i.test(raw);
}

function productIdentityKey(product = {}) {
  return normalize([
    product.sku || '',
    product.url || product.link || product.product_url || '',
    product.name || product.title || ''
  ].join(' '));
}

function productUrlHost(product = {}) {
  const rawUrl = product.url || product.link || product.product_url || '';
  try {
    return new URL(String(rawUrl || '').trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function allowedWebsiteHostsForSource(sourceKey = '') {
  const normalized = String(sourceKey || '').trim().toLowerCase();
  if (normalized === 'website/newlite') return ['newlite.vn'];
  if (normalized === 'website/kingcom') return ['store.kingcom.com.vn', 'kingcom.com.vn'];
  return [];
}

function productMatchesSourceScope(product = {}, sourceKey = '') {
  const allowedHosts = allowedWebsiteHostsForSource(sourceKey);
  if (!allowedHosts.length) return true;
  const host = productUrlHost(product);
  if (!host) return true;
  return allowedHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

function addUniqueProduct(target, product, seen = new Set()) {
  if (!product || typeof product !== 'object') return;
  const key = productIdentityKey(product);
  if (!key || seen.has(key)) return;
  seen.add(key);
  target.push(product);
}

function catalogMatchProducts(query = '', sourceKey = '') {
  const catalog = loadProducts({ sourceKey });
  if (!Array.isArray(catalog) || !catalog.length) return [];
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const tokens = queryWords(query)
    .filter(token => token.length >= 3 || /[a-z]+\d|\d+[a-z]+/i.test(token));
  const identityTokens = tokens.filter(token => /[a-z]+\d|\d+[a-z]+/i.test(token) || token.length >= 4);
  const scored = catalog.map(product => {
    const haystack = normalize([
      product.sku || '',
      product.name || '',
      product.title || '',
      product.description || '',
      product.content || '',
      product.details || '',
      product.tags || ''
    ].join(' '));
    let score = 0;
    const sku = normalize(product.sku || '');
    const name = normalize(product.name || product.title || '');
    if (sku && (normalizedQuery === sku || normalizedQuery.split(/\s+/).includes(sku))) score += 120;
    if (name && normalizedQuery.includes(name)) score += 100;
    if (name && name.includes(normalizedQuery) && normalizedQuery.length >= 4) score += 70;
    for (const token of identityTokens) {
      if (haystack.includes(token)) score += token.length >= 5 ? 24 : 12;
    }
    if (identityTokens.length >= 2) {
      const matched = identityTokens.filter(token => haystack.includes(token)).length;
      score += matched * 8;
    }
    return score > 0 ? { product, score } : null;
  }).filter(Boolean);
  return scored.sort((a, b) => b.score - a.score).slice(0, 4).map(item => item.product);
}

function extractModelTokens(text = '') {
  return [...new Set(
    queryWords(text)
      .filter(token => /[a-z]+\d|\d+[a-z]+/i.test(token))
      .map(token => token.toLowerCase())
  )];
}

function modelTokenVariants(token = '') {
  const normalized = String(token || '').toLowerCase().trim();
  if (!normalized) return [];
  const variants = [normalized];
  const hyphenated = normalized.replace(/^([a-z]+)(\d+[a-z0-9]*)$/i, '$1-$2');
  const spaced = normalized.replace(/^([a-z]+)-?(\d+[a-z0-9]*)$/i, '$1 $2');
  if (hyphenated && !variants.includes(hyphenated)) variants.push(hyphenated);
  if (spaced && !variants.includes(spaced)) variants.push(spaced);
  return variants;
}

function findExactProductMatch(token = '', sourceKey = '') {
  const catalog = loadProducts({ sourceKey });
  if (!Array.isArray(catalog) || !catalog.length) return null;
  const variants = modelTokenVariants(token);
  if (!variants.length) return null;
  return catalog.find(product => {
    const identity = normalize([
      product.sku || '',
      product.name || '',
      product.title || '',
      product.description || '',
      product.content || '',
      product.details || '',
      product.tags || ''
    ].join(' '));
    return variants.some(variant => identity.includes(variant));
  }) || null;
}

function productMatchesModelToken(product = {}, token = '') {
  const identity = productIdentityKey(product);
  if (!identity) return false;
  return modelTokenVariants(token).some(variant => identity.includes(variant));
}

function resolveOpinionProducts({
  userText = '',
  products = [],
  conversationContext = {},
  sourceKey = ''
} = {}) {
  const resolved = [];
  const seen = new Set();
  const sourceScoped = Boolean(String(sourceKey || '').trim());
  const add = product => {
    if (!productMatchesSourceScope(product, sourceKey)) return;
    addUniqueProduct(resolved, product, seen);
  };
  const refs = [
    userText,
    conversationContext?.current_product_name,
    conversationContext?.current_product_sku,
    conversationContext?.current_product_url,
    conversationContext?.last_explicit_product?.current_product_name,
    conversationContext?.previous_product_name,
    conversationContext?.previous_product_sku,
    conversationContext?.previous_product_url,
    conversationContext?.customer_intent?.product,
    conversationContext?.customer_intent?.product_sku,
    conversationContext?.customer_intent?.product_url
  ].filter(Boolean);

  const modelTokens = [];
  for (const ref of refs) {
    for (const token of extractModelTokens(ref)) {
      if (!modelTokens.includes(token)) modelTokens.push(token);
    }
  }
  for (const token of modelTokens) {
    const candidates = [];
    const exactSourceMatch = findExactProductMatch(token, sourceKey);
    if (exactSourceMatch) {
      add(exactSourceMatch);
      if (resolved.length >= 2) break;
      continue;
    }
    for (const variant of modelTokenVariants(token)) {
      for (const product of catalogMatchProducts(variant, sourceKey)) {
        if (!candidates.some(existing => productIdentityKey(existing) === productIdentityKey(product))) {
          candidates.push(product);
        }
      }
      if (!sourceScoped) {
        for (const product of catalogMatchProducts(variant, '')) {
          if (!candidates.some(existing => productIdentityKey(existing) === productIdentityKey(product))) {
            candidates.push(product);
          }
        }
      }
    }
    const exact = candidates.find(product => {
      const identity = productIdentityKey(product);
      return modelTokenVariants(token).some(variant => identity.includes(variant));
    });
    if (exact) {
      add(exact);
    }
    if (resolved.length >= 2) break;
  }

  const userModelTokens = extractModelTokens(userText);
  if (userModelTokens.length) {
    const matchedUserTokens = userModelTokens.filter(token =>
      resolved.some(product => productMatchesModelToken(product, token))
    );
    const expectedMatches = isComparisonQuestion(userText)
      ? Math.min(userModelTokens.length, 2)
      : 1;
    if (matchedUserTokens.length < expectedMatches) {
      return resolved;
    }
  }

  for (const ref of refs) {
    const explicit = findExplicitProduct(ref, sourceKey);
    if (explicit?.product && explicit.confidence >= 0.35) add(explicit.product);
    for (const product of explicit?.products || []) add(product);
    if (resolved.length < 2) {
      for (const product of catalogMatchProducts(ref, sourceKey)) add(product);
    }
    if (resolved.length >= 2) break;
  }

  for (const product of products || []) {
    add(product);
    if (resolved.length >= 3) break;
  }

  return resolved;
}

function productComparisonHighlights(product = {}, userText = '') {
  const facts = extractCatalogSpecFacts(product, userText);
  if (facts.length) {
    return facts.slice(0, 3).map(fact => `${fact.label}: ${fact.value}`).join('; ');
  }
  const description = productSpecText(product).replace(/\s+/g, ' ').trim();
  return description ? description.slice(0, 220) : '';
}

function subjectiveNeedHint(userText = '') {
  const normalized = normalize(userText);
  if (/\b(livestream|stream|podcast|ghi am|thu am|gaming|game|video call)\b/i.test(normalized)) return 'livestream / thu âm / gaming';
  if (/\b(quay|chup|vlog|content|camera|may anh|dien thoai)\b/i.test(normalized)) return 'quay chụp / sáng tạo nội dung';
  if (/\b(iphone|android|magsafe|smartphone|phone|dien thoai)\b/i.test(normalized)) return 'điện thoại';
  if (/\b(laptop|may tinh|pc)\b/i.test(normalized)) return 'laptop / máy tính';
  return '';
}

function buildComparisonReply(products, userText, lang = 'vi', customerBrand = 'KingCom') {
  const items = (products || []).slice(0, 2).filter(Boolean);
  if (items.length < 2) return null;
  const rows = items.map((product, index) => {
    const name = productDisplayName(product, `Sản phẩm ${index + 1}`);
    const price = formatPrice(product._price || product.price || product.compare_at_price || product.gia || '');
    const url = product.url || product.link || product.product_url || '';
    const highlights = productComparisonHighlights(product, userText);
    return {
      name,
      price,
      url,
      highlights
    };
  });

  const formatRow = (row, index) => {
    const lines = [
      `${index + 1}. ${row.name}`,
      `Giá: ${row.price}`
    ];
    if (row.highlights) lines.push(`Thông số nổi bật: ${row.highlights}`);
    if (row.url) lines.push(`Link: ${row.url}`);
    return lines.join('\n');
  };

  if (lang === 'en') {
    const enRows = rows.map((row, index) => {
      const lines = [
        `${index + 1}. ${row.name}`,
        `Price: ${row.price}`
      ];
      if (row.highlights) lines.push(`Key details: ${row.highlights}`);
      if (row.url) lines.push(`Link: ${row.url}`);
      return lines.join('\n');
    }).join('\n\n');
    return `Here is a quick comparison based on the catalog information:\n\n${enRows}\n\nIf you want, I can compare them again by the criteria you care about most, such as price, compatibility, size, or battery life.`;
  }

  if (lang === 'zh') {
    const zhRows = rows.map((row, index) => {
      const lines = [
        `${index + 1}. ${row.name}`,
        `价格: ${row.price}`
      ];
      if (row.highlights) lines.push(`重点信息: ${row.highlights}`);
      if (row.url) lines.push(`链接: ${row.url}`);
      return lines.join('\n');
    }).join('\n\n');
    return `我先根据目录信息帮您简单对比：\n\n${zhRows}\n\n如果您愿意，我也可以按您最在意的标准继续对比，比如价格、兼容性、尺寸或续航。`;
  }

  return `Dạ, em so sánh nhanh theo thông số catalog của 2 mẫu này:\n\n${rows.map(formatRow).join('\n\n')}\n\nNếu anh/chị muốn, em có thể so thêm theo tiêu chí ưu tiên như giá, tương thích, kích thước hoặc pin để chốt nhanh hơn ạ.`;
}

function buildSubjectiveAssessmentReply(product, userText, lang = 'vi', customerBrand = 'KingCom') {
  const name = productDisplayName(product, '');
  if (!name) return null;
  const price = formatPrice(product._price || product.price || product.compare_at_price || product.gia || '');
  const highlights = productComparisonHighlights(product, userText);
  const hint = subjectiveNeedHint(userText);

  if (lang === 'en') {
    const intro = hint
      ? `Based on the catalog, ${name} looks suitable for ${hint}.`
      : `Based on the catalog, ${name} looks like a reasonable choice.`;
    const detail = highlights ? ` Key details: ${highlights}.` : '';
    return `${intro}${detail} Price: ${price}.${hint ? '' : ' If you want, send me your use case and I will judge it more closely.'}`;
  }

  if (lang === 'zh') {
    const intro = hint
      ? `根据目录信息，${name} 适合 ${hint}。`
      : `根据目录信息，${name} 是一个比较稳妥的选择。`;
    const detail = highlights ? ` 重点信息：${highlights}。` : '';
    return `${intro}${detail} 价格：${price}。${hint ? '' : ' 如果您愿意，也可以告诉我使用场景，我再帮您判断得更准一些。'}`;
  }

  const intro = hint
    ? `Dạ, theo thông số catalog thì ${name} khá phù hợp cho nhu cầu ${hint} ạ.`
    : `Dạ, theo thông số catalog thì ${name} là một lựa chọn khá ổn ạ.`;
  const detail = highlights ? ` Điểm em dựa vào là: ${highlights}.` : '';
  const caution = ' Phần cảm nhận thực tế như độ bền lâu dài hoặc trải nghiệm dùng thực tế thì em chỉ dám kết luận trong phạm vi dữ liệu catalog.';
  const followUp = hint
    ? ''
    : ' Nếu anh/chị muốn, em có thể so thêm với một mẫu khác theo tiêu chí mình quan tâm nhất ạ.';
  return `${intro}${detail} Giá hiện tại: ${price}.${caution}${followUp}`;
}

function unmatchedUserModelTokens(userText = '', products = []) {
  const tokens = extractModelTokens(userText);
  if (!tokens.length) return [];
  return tokens.filter(token => !(products || []).some(product => productMatchesModelToken(product, token)));
}

function modelTokenLabel(token = '') {
  return String(token || '').trim().toUpperCase();
}

function buildOpinionReply({
  userText = '',
  products = [],
  conversationContext = {},
  sourceKey = '',
  lang = 'vi',
  customerBrand = 'KingCom'
} = {}) {
  const explicit = findExplicitProduct(userText, sourceKey);
  const hasProductAnchor = Boolean(
    conversationContext?.current_product_name
    || conversationContext?.current_product_sku
    || conversationContext?.requested_category
    || conversationContext?.customer_intent?.product
    || conversationContext?.customer_intent?.product_sku
    || conversationContext?.customer_intent?.brand
    || explicit?.product
  );
  if (!hasProductAnchor) {
    return {
      reply: lang === 'en'
        ? 'Could you please share the exact product name, model, or product group? Then I can compare or assess it based on the catalog.'
        : lang === 'zh'
          ? '请您提供具体的产品名称、型号或产品类别，我就可以根据目录帮您对比或判断。'
          : 'Dạ anh/chị cho em xin đúng tên sản phẩm, model hoặc nhóm sản phẩm, rồi em sẽ so sánh / đánh giá dựa trên catalog cho sát hơn ạ.',
      aiSource: 'rule_subjective_clarification',
      ragProducts: []
    };
  }

  const opinionProducts = resolveOpinionProducts({
    userText,
    products,
    conversationContext,
    sourceKey
  });
  const comparisonQuestion = isComparisonQuestion(userText);
  const subjectiveQuestion = isSubjectiveAssessmentQuestion(userText);

  if (comparisonQuestion) {
    const comparisonProducts = opinionProducts.slice(0, 2);
    if (comparisonProducts.length >= 2) {
      return {
        reply: buildComparisonReply(comparisonProducts, userText, lang, customerBrand),
        aiSource: 'direct_catalog_comparison',
        ragProducts: comparisonProducts
      };
    }
    const fallbackProduct = comparisonProducts[0] || products?.[0] || null;
    const productName = productDisplayName(fallbackProduct || {}, '');
    const missingModels = unmatchedUserModelTokens(userText, comparisonProducts);
    const missingLabel = missingModels.map(modelTokenLabel).join(', ');
    if (missingLabel && lang !== 'zh') {
      return {
        reply: lang === 'en'
          ? `I can compare based on the current catalog, but I do not have enough data for ${missingLabel} in this source yet. Please send another model available on ${customerBrand}, or update the catalog for that product.`
          : `Dạ em có thể so sánh theo catalog ${customerBrand}, nhưng hiện em chưa có đủ dữ liệu cho ${missingLabel} trong nguồn đang chat. ${productName ? `Em mới tìm thấy ${productName}. ` : ''}Anh/chị gửi giúp em model khác đang có trên ${customerBrand}, hoặc cập nhật catalog sản phẩm đó để em so sánh chuẩn hơn ạ.`,
        aiSource: 'rule_comparison_clarification',
        ragProducts: comparisonProducts.length ? comparisonProducts : []
      };
    }
    const clarification = lang === 'en'
      ? `I can compare them, but I still need the exact second model. Please send the other product name or model so I can compare based on the catalog.`
      : lang === 'zh'
        ? `我可以帮您对比，但还需要第二个具体型号。请您再发一个产品名称或型号，我就能按目录信息对比给您。`
        : productName
          ? `Dạ em có thể so sánh, nhưng em vẫn cần thêm model còn lại để đối chiếu cho đúng catalog. Anh/chị gửi giúp em sản phẩm thứ hai hoặc tiêu chí mình muốn so sánh ạ.`
          : 'Dạ em có thể so sánh, nhưng anh/chị gửi giúp em đúng 2 model cần đối chiếu để em trả lời theo catalog cho chuẩn ạ.';
    return {
      reply: clarification,
      aiSource: 'rule_comparison_clarification',
      ragProducts: comparisonProducts.length ? comparisonProducts : []
    };
  }

  if (subjectiveQuestion) {
    const product = opinionProducts[0] || products?.[0] || null;
    if (product) {
      return {
        reply: buildSubjectiveAssessmentReply(product, userText, lang, customerBrand),
        aiSource: 'direct_catalog_subjective_assessment',
        ragProducts: [product]
      };
    }
    const missingModels = unmatchedUserModelTokens(userText, []);
    const missingLabel = missingModels.map(modelTokenLabel).join(', ');
    if (missingLabel && lang !== 'zh') {
      return {
        reply: lang === 'en'
          ? `I can assess products based on the current catalog, but I cannot find ${missingLabel} in ${customerBrand}'s active catalog yet. Please send another available model or update the product data first.`
          : `Dạ em có thể đánh giá theo catalog, nhưng hiện em chưa tìm thấy ${missingLabel} trong catalog ${customerBrand} của nguồn đang chat. Anh/chị gửi giúp em model khác đang có trên ${customerBrand}, hoặc cập nhật dữ liệu sản phẩm đó để em tư vấn chính xác hơn ạ.`,
        aiSource: 'rule_subjective_clarification',
        ragProducts: []
      };
    }
    return {
      reply: lang === 'en'
        ? 'I can help assess it based on the catalog, but I still need the exact product name or model.'
        : lang === 'zh'
          ? '我可以根据目录帮您判断，不过我还需要您提供具体的产品名称或型号。'
          : 'Dạ em có thể đánh giá theo catalog, nhưng anh/chị cho em xin đúng tên sản phẩm hoặc model cụ thể để em trả lời sát hơn ạ.',
      aiSource: 'rule_subjective_clarification',
      ragProducts: []
    };
  }

  return null;
}

function historyBeforeCurrentMessage(history = [], userText = '') {
  const rows = [...(history || [])];
  const last = rows[rows.length - 1];
  if (
    last?.sender_type === 'customer'
    && normalize(last.text) === normalize(userText)
  ) {
    rows.pop();
  }
  return rows;
}

const PRODUCT_CONTEXT_WORDS = new Set([
  'thong', 'so', 'ky', 'thuat', 'cau', 'hinh', 'chi', 'tiet',
  'cao', 'toi', 'da', 'bao', 'nhieu', 'chieu', 'dai', 'rong', 'nang',
  'kich', 'thuoc', 'trong', 'luong', 'pin', 'luc', 'hut', 'tai',
  'cach', 'su', 'dung', 'huong', 'dan', 'ket', 'noi', 'cai', 'dat',
  'gui', 'truc', 'tiep', 'qua', 'day', 'cho', 'xem', 'nhe', 'nha', 'giup',
  'san', 'pham', 'mau', 'may', 'nay', 'do', 'vua', 'noi', 'cua', 'gi',
  'anh', 'chi', 'em', 'minh', 'toi', 'ban', 'ben', 'shop', 'co', 'khong',
  'can', 'muon', 'mua', 'tim', 'hieu', 'hoi', 've', 'do', 'you', 'sell',
  'technical', 'specification', 'specifications', 'spec', 'specs',
  'how', 'use', 'using', 'guide', 'instructions', 'setup', 'install',
  'this', 'that', 'it', 'product', 'model', 'remote', 'kem', 'theo', 'phu', 'kien'
]);

function productIdentityWords(text) {
  return queryWords(text).filter(word => !PRODUCT_CONTEXT_WORDS.has(word));
}

function hasExplicitProductReference(text) {
  const raw = String(text || '');
  if (/https?:\/\/\S+\/products?\//i.test(raw)) return true;
  return productIdentityWords(raw).length > 0;
}

function latestExplicitProductMessage(history = [], userText = '') {
  return [...historyBeforeCurrentMessage(history, userText)]
    .reverse()
    .find(message => (
      message.sender_type === 'customer'
      && hasExplicitProductReference(message.text)
    ));
}

function isProductSpecsFollowUp(userText, history = []) {
  const normalized = normalize(userText);
  const asksToShowHere = /\b(gui qua day|gui truc tiep|truc tiep qua day|cho xem|cho minh xem|noi chi tiet|gui chi tiet)\b/i.test(normalized);
  if (!asksToShowHere) return false;
  return historyBeforeCurrentMessage(history, userText)
    .slice(-6)
    .some(message => isDirectProductSpecsQuery(message.text));
}

function isProductSpecsRequest(userText, history = []) {
  return isDirectProductSpecsQuery(userText) || isProductSpecsFollowUp(userText, history);
}

function isCommercialPolicyQuestion(userText, intent) {
  const raw = String(userText || '');
  const normalized = normalize(raw);
  return intent === 'warranty'
    || /\b(full vat|vat|hoa don|xuat hoa don|xuat vat|bao hanh|doi tra|chinh sach|bao loi|loi san pham|warranty|return policy|invoice)\b/i.test(normalized)
    || /(保修|退换|发票|發票|增值税|政策)/.test(raw);
}

function isVatInvoiceQuestion(userText) {
  const raw = String(userText || '');
  const normalized = normalize(raw);
  return /\b(full vat|vat|hoa don|xuat hoa don|xuat vat|invoice)\b/i.test(normalized)
    || /(å‘ç¥¨|ç™¼ç¥¨|å¢žå€¼ç¨Ž)/.test(raw);
}

function sourceHasFullVatPolicy(sourceKey = '') {
  const policyText = [
    loadTextFile('faq.md', { sourceKey }),
    loadTextFile('policies.md', { sourceKey })
  ].join('\n');
  const normalized = normalize(policyText);
  return /\b(full vat|bao gom vat|da bao gom vat|gom vat|vat included|included vat)\b/i.test(normalized);
}

function pickRandomProducts(products, limit = 3) {
  const pool = [...(products || [])];
  for (let index = pool.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, limit);
}

function buildCatalogRecommendationReply(products, lang, scopeBrand = '') {
  const scope = String(scopeBrand || 'KingCom').trim();
  const rows = (products || []).map((product, index) => {
    const name = productDisplayName(product, `Sản phẩm ${index + 1}`);
    const rawPrice = product._price || product.price || product.compare_at_price || product.gia || '';
    const price = formatPrice(rawPrice);
    const url = product.url || product.link || product.product_url || '';
    if (lang === 'en') return `${index + 1}. ${name}\nPrice: ${price}${url ? `\nLink: ${url}` : ''}`;
    if (lang === 'zh') return `${index + 1}. ${name}\n价格: ${price}${url ? `\n链接: ${url}` : ''}`;
    return `${index + 1}. ${name}\nGiá: ${price}${url ? `\nLink: ${url}` : ''}`;
  }).join('\n\n');

  if (lang === 'en') {
    return `You can take a look at these ${scope} products that customers may be interested in:\n\n${rows}\n\nPlease tell me your intended use so I can suggest a more suitable model.`;
  }
  if (lang === 'zh') {
    return `您可以参考以下几款 ${scope} 产品：\n\n${rows}\n\n请告诉我您的使用需求，我可以为您推荐更合适的型号。`;
  }
  return `Dạ anh/chị có thể tham khảo một số mẫu ${scope} đang được khách quan tâm:\n\n${rows}\n\nAnh/chị đang cần sản phẩm cho nhu cầu nào để em gợi ý sát hơn ạ?`;
}

function categoryLabelFromProduct(product) {
  const name = normalize(product?.name || product?.title || '');
  if (/\b(intercom|xtalk|headset|talkback)\b/i.test(name)) return 'intercom/headset không dây';
  if (/\b(mic|micro|microphone|thu am|lavalier|wireless)\b/i.test(name)) return 'micro không dây/thu âm';
  if (/\b(xview|monitor|man hinh)\b/i.test(name)) return 'màn hình/monitor hỗ trợ quay';
  if (/\b(light|den|tally)\b/i.test(name)) return 'đèn/tally light';
  if (/\b(charging|battery|hub|box|case|carrying)\b/i.test(name)) return 'phụ kiện theo hệ sản phẩm';
  if (/\b(lens|ong kinh)\b/i.test(name)) return 'ống kính';
  if (/\b(adapter|mount|ngam|filter)\b/i.test(name)) return 'ngàm/filter/phụ kiện ống kính';
  return 'phụ kiện quay chụp';
}

function buildCatalogOverviewReply({ lang = 'vi', scopeBrand = '', products = [] }) {
  const scope = String(scopeBrand || '').trim();
  const count = Array.isArray(products) ? products.length : 0;
  const categories = [...new Set((products || []).map(categoryLabelFromProduct))].slice(0, 6);
  const categoryText = categories.length ? categories.join(', ') : 'phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung';

  if (lang === 'en') {
    if (scope) {
      return `This page supports ${scope} products. The current catalog has ${count || 'several'} ${scope} items, including ${categoryText}. Please tell me your use case or the product type you need so I can suggest suitable models.`;
    }
    return 'KingCom carries photography, filming, and content creation accessories such as gimbals, microphones, lights, filters, tripods, monitors, livestream gear, and related accessories. Which product group are you interested in?';
  }

  if (lang === 'zh') {
    if (scope) {
      return `此页面主要咨询 ${scope} 产品。目前目录中有 ${count || '多款'} 款 ${scope} 产品，包括 ${categoryText}。请告诉我您的使用需求或想了解的产品类型，我会为您推荐合适的型号。`;
    }
    return 'KingCom 销售摄影、拍摄和内容创作相关配件，例如稳定器、麦克风、灯具、滤镜、三脚架、外接屏幕和直播设备。您想了解哪一类产品？';
  }

  if (scope) {
    return `Dạ không phải chỉ có một mẫu đâu ạ. Fanpage này hiện tư vấn sản phẩm ${scope}; trong catalog hiện có ${count || 'nhiều'} sản phẩm ${scope}, gồm các nhóm như ${categoryText}. Anh/chị đang cần dùng cho nhu cầu nào để em gợi ý đúng mẫu hơn ạ?`;
  }

  return 'Dạ KingCom đang kinh doanh phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung như gimbal, micro, đèn, filter, tripod, màn hình phụ, thiết bị livestream và các phụ kiện quay chụp khác. Anh/chị đang quan tâm nhóm sản phẩm nào để em tư vấn mẫu phù hợp ạ?';
}

function isCatalogScopeQuestion(userText) {
  const normalized = normalize(userText);
  return /\b(chi ban moi|chi co moi|moi mat hang|moi san pham|ban nhung mat hang gi|ban nhung mat hang nao|ban mat hang gi|ban mat hang nao|dang ban nhung mat hang|dang ban mat hang|bay ban)\b/i.test(normalized);
}

function buildPolicyRuleReply(userText, lang, scopeBrand = '', sourceKey = '', customerBrand = 'KingCom') {
  const normalized = normalize(userText);
  const scope = normalize(scopeBrand);
  const brand = String(customerBrand || 'KingCom').trim() || 'KingCom';

  if (isVatInvoiceQuestion(userText)) {
    if (sourceHasFullVatPolicy(sourceKey)) {
      if (lang === 'en') {
        return `Yes, listed product prices at ${brand} already include VAT. If you need a VAT invoice for your order, ${brand} can support it using the order/invoice information.`;
      }
      if (lang === 'zh') {
        return `${brand} \u6807\u793a\u7684\u4ea7\u54c1\u4ef7\u683c\u5df2\u5305\u542b VAT\u3002\u5982\u679c\u60a8\u9700\u8981 VAT \u53d1\u7968\uff0c${brand} \u53ef\u4ee5\u6839\u636e\u8ba2\u5355\u4fe1\u606f\u534f\u52a9\u5f00\u5177\u3002`;
      }
      return `D\u1ea1, gi\u00e1 s\u1ea3n ph\u1ea9m ni\u00eam y\u1ebft t\u1ea1i ${brand} \u0111\u00e3 bao g\u1ed3m VAT r\u1ed3i \u1ea1. Anh/ch\u1ecb kh\u00f4ng c\u1ea7n tr\u1ea3 th\u00eam VAT khi mua h\u00e0ng.\n\nN\u1ebfu anh/ch\u1ecb c\u1ea7n xu\u1ea5t h\u00f3a \u0111\u01a1n VAT, ${brand} c\u00f3 h\u1ed7 tr\u1ee3 theo th\u00f4ng tin \u0111\u01a1n h\u00e0ng \u1ea1.`;
    }

    if (lang === 'en') {
      return `I do not see a clear VAT confirmation in the current ${brand} policy data, so I will avoid guessing. ${brand} staff can verify the invoice/VAT details for the exact order.`;
    }
    if (lang === 'zh') {
      return `\u76ee\u524d ${brand} \u7684\u653f\u7b56\u8d44\u6599\u91cc\u6ca1\u6709\u660e\u786e\u7684 VAT \u786e\u8ba4\uff0c\u6211\u4e0d\u4f1a\u81ea\u884c\u731c\u6d4b\u3002\u5de5\u4f5c\u4eba\u5458\u53ef\u4ee5\u6839\u636e\u5177\u4f53\u8ba2\u5355\u786e\u8ba4\u53d1\u7968/VAT \u4fe1\u606f\u3002`;
    }
    return `D\u1ea1, hi\u1ec7n em ch\u01b0a th\u1ea5y th\u00f4ng tin VAT \u0111\u01b0\u1ee3c ghi r\u00f5 trong d\u1eef li\u1ec7u ch\u00ednh s\u00e1ch c\u1ee7a ${brand}, n\u00ean em kh\u00f4ng t\u1ef1 x\u00e1c nh\u1eadn \u0111\u1ec3 tr\u00e1nh t\u01b0 v\u1ea5n sai. Nh\u00e2n vi\u00ean ${brand} c\u00f3 th\u1ec3 ki\u1ec3m tra th\u00f4ng tin h\u00f3a \u0111\u01a1n/VAT theo \u0111\u01a1n h\u00e0ng c\u1ee5 th\u1ec3 \u1ea1.`;
  }

  if (/\b(doi tra|tra hang|doi hang|return policy|refund|exchange)\b/i.test(normalized)) {
    if (lang === 'en') {
      return `${brand} supports return/exchange checks when the received item is wrong, missing quantity/accessories, or damaged on arrival. Please keep order details and photos/videos of the package/product so staff can verify the case.`;
    }
    if (lang === 'zh') {
      return `${brand} 可协助处理收到商品不符、缺件/少件或到货损坏等退换货情况。请保留订单信息以及包裹/产品照片或视频，方便工作人员核实。`;
    }
    return `Dạ, ${brand} hỗ trợ kiểm tra đổi trả khi hàng nhận không đúng mẫu/loại, thiếu số lượng/phụ kiện hoặc bị ảnh hưởng bên ngoài khi nhận hàng. Anh/chị giữ giúp em thông tin đơn hàng và hình ảnh/video sản phẩm, bao bì để nhân viên kiểm tra chính xác ạ.`;
  }

  if (/\b(giao hang|van chuyen|ship|shipping|phi ship|thoi gian giao)\b/i.test(normalized)) {
    if (lang === 'en') {
      return `${brand} supports nationwide delivery. Exact shipping fee and delivery time depend on the address and order details, so staff can confirm after receiving the destination/product information.`;
    }
    if (lang === 'zh') {
      return `${brand} 支持全国配送。具体运费和时效取决于收货地址和订单信息，工作人员可在收到地址/产品信息后确认。`;
    }
    return `Dạ, ${brand} có hỗ trợ giao hàng toàn quốc ạ. Phí vận chuyển và thời gian giao chính xác sẽ phụ thuộc vào địa chỉ nhận hàng và đơn hàng cụ thể, nên nhân viên sẽ kiểm tra lại khi có thông tin địa chỉ/sản phẩm ạ.`;
  }

  if (!/\b(bao hanh|warranty)\b/i.test(normalized)) return null;

  if (scope === 'viltrox') {
    if (lang === 'en') {
      return 'Viltrox products are covered by a limited 1-year warranty from the purchase date. The warranty applies to defects under normal use and does not cover misuse, physical impact, unauthorized repair, power issues, or incorrect installation/use. Please share the exact model or order information so KingCom staff can check the case more accurately.';
    }
    if (lang === 'zh') {
      return 'Viltrox 产品通常享有自购买日起 1 年有限保修。保修适用于正常使用下产生的故障，不包括误用、外力损坏、擅自维修、电源问题或错误安装/使用等情况。请提供具体型号或订单信息，方便 KingCom 员工进一步确认。';
    }
    return 'Dạ sản phẩm Viltrox áp dụng bảo hành giới hạn 1 năm tính từ ngày mua hàng ạ. Bảo hành áp dụng cho lỗi phát sinh trong quá trình sử dụng bình thường, không gồm các trường hợp dùng sai cách, va đập, tự ý sửa chữa, lỗi nguồn điện hoặc lắp đặt/sử dụng không đúng hướng dẫn. Anh/chị gửi giúp em model hoặc thông tin đơn hàng để nhân viên KingCom kiểm tra chính xác hơn ạ.';
  }

  if (lang === 'en') {
    return `${brand} warranty policy generally applies to valid products/orders with clear warranty seal/documents and defects caused by product quality. Coverage can vary by product type, so please share the model or order information for staff to check the exact warranty term.`;
  }
  if (lang === 'zh') {
    return `${brand} 的保修通常适用于保修标识/凭证清楚、订单信息有效且属于产品质量问题的情况。不同产品类型的保修期可能不同，请提供型号或订单信息，方便工作人员确认。`;
  }
  return `Dạ, chính sách bảo hành của ${brand} áp dụng cho sản phẩm/đơn hàng hợp lệ, tem hoặc chứng từ bảo hành rõ ràng và lỗi phát sinh từ chất lượng sản phẩm. Thời hạn bảo hành có thể khác nhau theo từng loại sản phẩm, nên anh/chị gửi giúp em model hoặc thông tin đơn hàng để nhân viên kiểm tra chính xác hơn ạ.`;
}

function sourceContactLines(sourceKey = '') {
  const faq = loadTextFile('faq.md', { sourceKey });
  const lines = String(faq || '').split(/\r?\n/).map(line => line.trim());
  return lines
    .filter(line => /^-\s*(?:HCM|Ha Noi|Hà Nội)\s*:/i.test(line))
    .map(line => line.replace(/^-\s*/, ''))
    .slice(0, 3);
}

function buildStoreInfoReply({ sourceKey = '', customerBrand = 'KingCom', lang = 'vi' } = {}) {
  const locations = sourceContactLines(sourceKey);
  if (!locations.length) {
    if (lang === 'en') return `I do not have a verified store address for ${customerBrand} in the current source data. I have forwarded this to staff for checking.`;
    if (lang === 'zh') return `当前资料中没有可核实的 ${customerBrand} 门店地址，我已转交工作人员进一步确认。`;
    return `Dạ hiện dữ liệu của ${customerBrand} chưa có địa chỉ cửa hàng đã được xác thực. Em đã chuyển nhân viên kiểm tra thêm ạ.`;
  }

  if (lang === 'en') {
    return `You can contact or visit the following locations:\n${locations.map(line => `- ${line}`).join('\n')}`;
  }
  if (lang === 'zh') {
    return `您可以联系或前往以下地点：\n${locations.map(line => `- ${line}`).join('\n')}`;
  }
  return `Dạ anh/chị có thể liên hệ hoặc đến các địa chỉ sau:\n${locations.map(line => `- ${line}`).join('\n')}`;
}

function buildProductGuidanceFallbackReply(products, lang = 'vi') {
  const name = productDisplayName(products?.[0], '');
  if (lang === 'en') {
    return name
      ? `I found the product ${name}, but I need KingCom staff to confirm the detailed usage instructions to avoid advising you incorrectly.`
      : 'Please share the exact product name or model so I can guide you more accurately.';
  }
  if (lang === 'zh') {
    return name
      ? `我已找到产品 ${name}，但为了避免提供错误的操作说明，需要由 KingCom 工作人员进一步确认。`
      : '请提供准确的产品名称或型号，以便我为您提供更合适的使用说明。';
  }
  return name
    ? `Dạ em đã xác định sản phẩm ${name}. Để tránh hướng dẫn sai chi tiết, em cần chuyển nhân viên KingCom kiểm tra thêm và hỗ trợ anh/chị chính xác hơn ạ.`
    : 'Dạ anh/chị cho em xin tên sản phẩm hoặc model cụ thể để em hướng dẫn chính xác hơn ạ.';
}

function buildProductSpecsFallbackReply(products, lang = 'vi') {
  const product = products?.[0];
  const name = productDisplayName(product, '');
  const description = String(product?.description || product?.content || product?.details || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1600);
  const url = product?.url || product?.link || product?.product_url || '';

  if (!name || !description) {
    if (lang === 'en') return 'I could not find detailed specifications for this product in the current catalog. Please share the exact model so our staff can check it.';
    if (lang === 'zh') return 'å½“å‰äº§å“ç›®å½•ä¸­æœªæ‰¾åˆ°è¯¥äº§å“çš„è¯¦ç»†è§„æ ¼ã€‚è¯·æä¾›å‡†ç¡®åž‹å·ï¼Œä»¥ä¾¿å·¥ä½œäººå‘˜è¿›ä¸€æ­¥ç¡®è®¤ã€‚';
    return 'D\u1ea1 em ch\u01b0a t\u00ecm th\u1ea5y th\u00f4ng s\u1ed1 chi ti\u1ebft c\u1ee7a s\u1ea3n ph\u1ea9m n\u00e0y trong catalog. Anh/ch\u1ecb cho em xin \u0111\u00fang model \u0111\u1ec3 nh\u00e2n vi\u00ean ki\u1ec3m tra th\u00eam \u1ea1.';
  }

  if (lang === 'en') return `Catalog information for ${name}:\n\n${description}${url ? `\n\nProduct link: ${url}` : ''}`;
  if (lang === 'zh') return `${name} çš„äº§å“ç›®å½•ä¿¡æ¯ï¼š\n\n${description}${url ? `\n\näº§å“é“¾æŽ¥ï¼š${url}` : ''}`;
  return `D\u1ea1, th\u00f4ng tin trong catalog c\u1ee7a ${name}:\n\n${description}${url ? `\n\nLink s\u1ea3n ph\u1ea9m: ${url}` : ''}`;
}

function fallbackReply(intent, userText, products) {
  const lang = detectMessageLanguage(userText);
  const english = lang === 'en';
  if (lang === 'zh') {
    if (intent === 'greeting') {
      return '您好！KingCom 可以协助您查询产品、报价、配送或保修信息。';
    }
    if (intent === 'store_info') {
      return 'KingCom 门店地址是越南胡志明市 Bảy Hiền 坊 Nguyễn Minh Hoàng 65 号。';
    }
    if (intent === 'unsupported') {
      return '目前 KingCom 暂未销售笔记本电脑或 ThinkPad。我们主要销售摄影、拍摄和内容创作相关配件。';
    }
    if (intent === 'human') {
      if (hasPhoneNumber(userText)) return '谢谢，我已收到您的电话号码，并会转交给 KingCom 员工跟进。';
      return '我已记录您需要人工协助。请留下电话号码，KingCom 员工会尽快联系您。';
    }
    if (products && products.length) {
      const rows = products.slice(0, 3).map((p, i) => {
        const name = p.name || p.title || `产品 ${i + 1}`;
        const price = formatPrice(p.price || p.compare_at_price || p.gia || '');
        const url = p.url || p.link || p.product_url || '';
        return `${i + 1}. ${name}\n价格: ${price}${url ? `\n链接: ${url}` : ''}`;
      }).join('\n\n');
      return `我在 KingCom 产品目录中找到以下相关产品：\n\n${rows}\n\n请告诉我您想了解哪一个型号，或留下电话号码，方便员工为您确认库存并协助下单。`;
    }
    return '请您提供更具体的产品名称、型号或使用需求，KingCom 会为您更准确地推荐。';
  }

  if (english) {
    if (intent === 'greeting') {
      return 'Hi! How can KingCom help you today?';
    }
    if (intent === 'store_info') {
      return 'KingCom store address is 65 Nguyen Minh Hoang, Bay Hien Ward, Ho Chi Minh City.';
    }
    if (intent === 'unsupported') {
      return 'KingCom currently does not sell laptops or ThinkPads. We focus on photography, filming, and content creation accessories.';
    }
    if (intent === 'human') {
      if (hasPhoneNumber(userText)) return 'Thank you, I have received your phone number. I will forward it to KingCom staff for follow-up.';
      return 'I have noted your request to speak with staff. Please share your phone number so KingCom staff can contact you soon.';
    }
    if (products && products.length) {
      const rows = products.slice(0, 3).map((p, i) => {
        const name = p.name || p.title || `Product ${i + 1}`;
        const priceNumber = Number(String(p.price || p.compare_at_price || p.gia || '').replace(/[^0-9]/g, ''));
        const price = priceNumber ? `${priceNumber.toLocaleString('en-US')} VND` : 'contact us';
        const url = p.url || p.link || p.product_url || '';
        return `${i + 1}. ${name}\nPrice: ${price}${url ? `\nLink: ${url}` : ''}`;
      }).join('\n\n');
      return `I found these matching products in KingCom catalog:\n\n${rows}\n\nPlease tell me which model you prefer, or share your phone number so our staff can check current stock and support your order.`;
    }
    return 'Could you please share the exact product name, model, or intended use so KingCom can advise more accurately?';
  }

  if (intent === 'greeting') {
    return 'Dạ em chào anh/chị ạ! KingCom hỗ trợ phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung. Anh/chị cần em tư vấn sản phẩm nào ạ?';
  }
  if (intent === 'store_info') {
    return 'Dạ địa chỉ cửa hàng KingCom là 65 Nguyễn Minh Hoàng, phường Bảy Hiền, TP. Hồ Chí Minh ạ.';
  }
  if (intent === 'unsupported') {
    return 'Dạ hiện KingCom chưa kinh doanh laptop/ThinkPad ạ. Bên em chuyên phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung. Anh/chị cần em tư vấn gimbal, micro, đèn, filter, tripod hoặc phụ kiện quay chụp nào không ạ?';
  }
  if (intent === 'human') {
    return 'Dạ mình đã ghi nhận yêu cầu gặp nhân viên. Anh/chị vui lòng để lại số điện thoại để KingCom liên hệ tư vấn nhanh nhất nhé.';
  }
  if (products && products.length) {
    const p = products[0];
    const url = p.url || p.link || p.product_url || '';
    const base = `KingCom tìm thấy sản phẩm phù hợp: ${p.name || p.title}, giá ${formatPrice(p.price || 'liên hệ')}.${url ? `\nLink xem sản phẩm: ${url}` : ''}\nAnh/chị muốn mình tư vấn thêm mẫu nào ạ?`;
    return ensureProductLinks(base, products);
  }
  return 'Anh/chị vui lòng cho mình biết rõ hơn tên sản phẩm hoặc nhu cầu sử dụng để KingCom tư vấn chính xác nhé.';
}

function isFollowUpLinkRequest(text) {
  const t = String(text || '').toLowerCase();
  return /(link|gửi link|gui link|kèm link|kem link|link mua|đặt hàng|dat hang|mua ở đâu|mua o dau)/i.test(t) && queryWords(t).length <= 2;
}

function expandMultilingualSearchTerms(text) {
  const raw = String(text || '');
  const terms = [];
  if (/三脚架|脚架|支架/.test(raw)) terms.push('tripod chan tripod chan may gia do');
  if (/手机|電話|电话/.test(raw)) terms.push('mobile phone smartphone dien thoai');
  if (/相机|攝影|摄影/.test(raw)) terms.push('camera may anh');
  if (/麦克风|麥克風|话筒/.test(raw)) terms.push('micro microphone');
  if (/灯|燈|补光/.test(raw)) terms.push('light led den');
  if (/稳定器|穩定器|云台|雲台/.test(raw)) terms.push('gimbal');
  if (/滤镜|濾鏡/.test(raw)) terms.push('filter');
  return terms.join(' ');
}

function buildSearchQuery(userText, history, customer, conversationContext = {}) {
  const currentWords = queryWords(userText);
  const expandedTerms = expandMultilingualSearchTerms(userText);
  const priorHistory = historyBeforeCurrentMessage(history, userText);
  const recentCustomer = priorHistory
    .filter(m => m.sender_type === 'customer')
    .slice(-4)
    .map(m => m.text)
    .join(' ');
  const interests = customer?.interested_products || '';
  const asksSpecs = isProductSpecsRequest(userText, history);
  const asksGuidance = isProductGuidanceQuery(userText);
  const contextText = contextSearchText(conversationContext);
  const structuredText = structuredMessageSearchText(conversationContext?.customer_intent || {});
  const parsedBudgetMax = conversationContext?.customer_intent?.budget?.max || 0;
  const asksContextFollowUp = isContextualProductFollowUp(userText);
  const asksBudgetFollowUp = Boolean(parsedBudgetMax || extractMaxPrice(userText))
    && /\b(duoi|toi da|max|nho hon|be hon|ngan sach|tai chinh|re hon|gia re|loai nao|mau nao|cai nao|san pham nao)\b/i.test(normalize(userText));
  if (isAlternativeProductRequest(userText)) {
    return buildAlternativeSearchQuery(userText, conversationContext);
  }
  if (asksBudgetFollowUp && (contextText || conversationContext?.requested_category || recentCustomer || interests)) {
    const categoryTerms = conversationContext?.requested_category
      ? categorySearchTerms(conversationContext.requested_category)
      : '';
    return `${categoryTerms} ${contextText} ${structuredText} ${userText} ${recentCustomer} ${interests} ${expandedTerms}`.trim();
  }
  if (conversationContext?.new_category_request && conversationContext?.requested_category) {
    return `${categorySearchTerms(conversationContext.requested_category)} ${structuredText} ${userText} ${expandedTerms}`.trim();
  }
  if (asksSpecs || asksGuidance || isFollowUpLinkRequest(userText) || (asksContextFollowUp && contextText)) {
    const explicitReferenceIsCompatibilityTarget = conversationContext?.requested_category
      && isCompatibilityFollowUp(userText);
    if (hasExplicitProductReference(userText) && !explicitReferenceIsCompatibilityTarget) {
      return `${userText} ${structuredText} ${expandedTerms}`.trim();
    }
    if (!contextText && conversationContext?.requested_category) {
      return `${categorySearchTerms(conversationContext.requested_category)} ${structuredText} ${userText} ${recentCustomer} ${expandedTerms}`.trim();
    }
    if (contextText) {
      const needsRecentCategoryContext = conversationContext?.requested_category
        && !conversationContext?.current_product_name;
      return `${contextText} ${structuredText} ${userText} ${needsRecentCategoryContext ? recentCustomer : ''} ${expandedTerms}`.trim();
    }
    const referencedProduct = latestExplicitProductMessage(history, userText);
    return `${referencedProduct?.text || ''} ${structuredText} ${userText} ${expandedTerms}`.trim();
  }
  if (currentWords.length === 0) {
    return `${userText} ${structuredText} ${expandedTerms} ${recentCustomer} ${interests}`.trim();
  }
  return `${userText} ${structuredText} ${expandedTerms}`.trim();
}

const ALTERNATIVE_SEARCH_STOPWORDS = new Set([
  'anh', 'chi', 'em', 'minh', 'toi', 'shop', 'ben', 'co', 'khong', 'a',
  'khoong', 'ko', 'hong',
  'can', 'muon', 'tim', 'hieu', 'tu', 'van', 'giup', 'cho', 'hoi', 've',
  'san', 'pham', 'sp', 'mau', 'model', 'loai', 'lua', 'chon', 'phuong', 'an',
  'con', 'nao', 'khac', 'nua', 'cai', 'tuong', 'another', 'other', 'option',
  'something', 'anything', 'else', 'similar'
]);

function productCategorySearchTerms(productName = '') {
  const normalized = normalize(productName);
  const categories = [
    ['livestream', /\b(live stream|livestream|quay phat truc tiep|phat song truc tiep|switcher|capture card|console pad|livepro)\b/i],
    ['tai nghe', /\b(tai nghe|headphone|headset)\b/i],
    ['webcam', /\bwebcam\b/i],
    ['micro', /\b(micro|mic|microphone|thu am)\b/i],
    ['tripod', /\b(tripod|chan may|chan den)\b/i],
    ['gimbal', /\b(gimbal|stabilizer)\b/i],
    ['den', /\b(den|light|led)\b/i],
    ['lens', /\b(lens|ong kinh)\b/i],
    ['filter', /\b(filter|kinh loc)\b/i],
    ['man hinh', /\b(man hinh|monitor)\b/i],
    ['balo tui', /\b(balo|backpack|tui)\b/i]
  ];
  return categories.find(([, pattern]) => pattern.test(normalized))?.[0] || '';
}

function categorySearchTerms(category = '') {
  const terms = {
    livestream: 'livestream live stream quay phat truc tiep switcher capture card',
    gimbal: 'gimbal chong rung stabilizer',
    tripod: 'tripod chan may',
    headphones: 'tai nghe headphone headset',
    webcam: 'webcam',
    microphone: 'micro microphone thu am',
    light: 'den led light',
    lens: 'lens ong kinh',
    filter: 'filter kinh loc',
    monitor: 'man hinh monitor',
    bag: 'balo tui may anh'
  };
  return terms[normalize(category)] || '';
}

function buildAlternativeSearchQuery(userText, conversationContext = {}) {
  const usefulWords = queryWords(userText)
    .filter(word => !ALTERNATIVE_SEARCH_STOPWORDS.has(word))
    .slice(0, 6);
  const previousName = conversationContext?.previous_product_name || conversationContext?.current_product_name || '';
  const category = categorySearchTerms(conversationContext?.requested_category)
    || productCategorySearchTerms(previousName);
  return [usefulWords.join(' '), category].filter(Boolean).join(' ').trim() || category;
}

function isSameProduct(product = {}, context = {}) {
  const previousSku = normalize(context.previous_product_sku || context.current_product_sku || '');
  const previousUrl = String(context.previous_product_url || context.current_product_url || '').trim().replace(/\/+$/, '');
  const previousName = normalize(context.previous_product_name || context.current_product_name || '');
  const productSku = normalize(product.sku || '');
  const productUrl = String(product.url || product.link || product.product_url || '').trim().replace(/\/+$/, '');
  const productName = normalize(product.name || product.title || '');
  const previouslyRecommended = Array.isArray(context.last_recommended_products)
    ? context.last_recommended_products
    : [];
  const wasRecommended = previouslyRecommended.some(previous => {
    const sku = normalize(previous.current_product_sku || previous.sku || '');
    const url = String(previous.current_product_url || previous.url || '').trim().replace(/\/+$/, '');
    const name = normalize(previous.current_product_name || previous.name || '');
    return (sku && sku === productSku)
      || (url && url === productUrl)
      || (name && name === productName);
  });
  return Boolean(
    wasRecommended
    ||
    (previousSku && productSku === previousSku)
    || (previousUrl && productUrl === previousUrl)
    || (previousName && productName === previousName)
  );
}

function buildAlternativeProductsReply(products, lang, customerBrand = 'KingCom') {
  const rows = (products || []).slice(0, 3).map((product, index) => {
    const name = productDisplayName(product, `Sản phẩm ${index + 1}`);
    const price = formatPrice(product._price || product.price || product.compare_at_price || product.gia || '');
    const url = product.url || product.link || product.product_url || '';
    if (lang === 'en') return `${index + 1}. ${name}\nPrice: ${price}${url ? `\nLink: ${url}` : ''}`;
    if (lang === 'zh') return `${index + 1}. ${name}\n价格: ${price}${url ? `\n链接: ${url}` : ''}`;
    return `${index + 1}. ${name}\nGiá: ${price}${url ? `\nLink: ${url}` : ''}`;
  }).join('\n\n');
  if (lang === 'en') return `Here are some other matching options from ${customerBrand}:\n\n${rows}\n\nWhich model would you like to compare in more detail?`;
  if (lang === 'zh') return `${customerBrand} 还有以下相符的选择：\n\n${rows}\n\n您想进一步比较哪一款？`;
  return `Dạ, ${customerBrand} còn các lựa chọn phù hợp khác như sau:\n\n${rows}\n\nAnh/chị muốn em so sánh kỹ mẫu nào ạ?`;
}

function categoryLabel(category) {
  return ({
    livestream: 'thiết bị livestream',
    gimbal: 'thiết bị chống rung',
    tripod: 'chân máy',
    headphones: 'tai nghe',
    webcam: 'webcam',
    microphone: 'micro',
    light: 'đèn quay chụp',
    lens: 'ống kính',
    filter: 'kính lọc',
    monitor: 'màn hình',
    bag: 'balo hoặc túi máy ảnh'
  })[category] || 'sản phẩm';
}

function buildCategoryProductsReply(products, category, lang, customerBrand = 'KingCom') {
  const label = categoryLabel(category);
  const rows = (products || []).slice(0, 3).map((product, index) => {
    const name = productDisplayName(product, `Sản phẩm ${index + 1}`);
    const price = formatPrice(product._price || product.price || product.compare_at_price || product.gia || '');
    const url = product.url || product.link || product.product_url || '';
    if (lang === 'en') return `${index + 1}. ${name}\nPrice: ${price}${url ? `\nLink: ${url}` : ''}`;
    if (lang === 'zh') return `${index + 1}. ${name}\n价格: ${price}${url ? `\n链接: ${url}` : ''}`;
    return `${index + 1}. ${name}\nGiá: ${price}${url ? `\nLink: ${url}` : ''}`;
  }).join('\n\n');
  if (lang === 'en') return `${customerBrand} found these suitable options:\n\n${rows}\n\nWhich model would you like to explore further?`;
  if (lang === 'zh') return `${customerBrand} 找到以下合适的产品：\n\n${rows}\n\n您想进一步了解哪一款？`;
  return `Dạ, với nhu cầu về ${label}, ${customerBrand} có các mẫu phù hợp sau:\n\n${rows}\n\nAnh/chị muốn em tư vấn kỹ mẫu nào ạ?`;
}

function buildCategoryNoMatchReply(category, userText, lang, customerBrand = 'KingCom') {
  const label = categoryLabel(category);
  const maxPrice = extractMaxPrice(userText);
  const budget = maxPrice ? formatPrice(maxPrice) : '';
  if (lang === 'en') {
    return budget
      ? `${customerBrand} currently has no ${label} in the catalog within a budget of ${budget}. Would you like to increase the budget or consider another product group?`
      : `${customerBrand} currently has no matching ${label} in the catalog. Would you like to adjust the requirements?`;
  }
  if (lang === 'zh') {
    return budget
      ? `${customerBrand} 当前产品目录中没有价格在 ${budget} 以内的${label}。您想提高预算还是考虑其他产品类别？`
      : `${customerBrand} 当前产品目录中没有符合条件的${label}。您想调整需求吗？`;
  }
  return budget
    ? `Dạ, hiện trong catalog ${customerBrand} chưa có ${label} nào trong ngân sách ${budget}. Anh/chị muốn tăng ngân sách hoặc xem nhóm sản phẩm khác không ạ?`
    : `Dạ, hiện trong catalog ${customerBrand} chưa có ${label} phù hợp với yêu cầu này. Anh/chị muốn điều chỉnh nhu cầu không ạ?`;
}

function assessRetrievalUncertainty({
  userText = '',
  intent = '',
  conversationContext = {},
  products = []
} = {}) {
  if (!['general', 'product_search', 'buy', 'price', 'product_specs', 'order'].includes(intent)) return null;
  if (conversationContext.requested_category || conversationContext.current_product_name) return null;
  const hasStrongExplicitReference = /https?:\/\/\S+\/products?\//i.test(String(userText || ''))
    || queryWords(userText).some(word => /[a-z]+\d|\d+[a-z]+/i.test(word));
  if (conversationContext.alternative_product_request || hasStrongExplicitReference) return null;
  if (!Array.isArray(products) || products.length < 2) return null;

  const categorized = products.slice(0, 6).map(product => ({
    product,
    category: inferRequestedCategory(
      `${product.name || product.title || ''} ${product.tags || product.category || ''}`
    )
  }));
  const categories = [...new Set(categorized.map(item => item.category).filter(Boolean))];
  const parsed = conversationContext.customer_intent && typeof conversationContext.customer_intent === 'object'
    ? conversationContext.customer_intent
    : {};
  const brandOnlyRequest = parsed.brand
    && !parsed.product
    && !parsed.category
    && !parsed.budget
    && !parsed.policy_question
    && !parsed.use_case
    && !parsed.compatibility_target;
  if (brandOnlyRequest) {
    return {
      reason: 'ambiguous_category',
      categories: categories.slice(0, 4),
      products: products.slice(0, 3)
    };
  }
  if (categories.length >= 2) {
    return {
      reason: 'ambiguous_category',
      categories: categories.slice(0, 4),
      products: products.slice(0, 3)
    };
  }

  const topScore = Number(products[0]?.score || 0);
  const secondScore = Number(products[1]?.score || 0);
  const closeScores = topScore > 0 && secondScore > 0 && Math.abs(topScore - secondScore) <= 2;
  const queryHasIdentityHint = queryWords(userText).some(word => /[a-z]+\d|\d+[a-z]+/i.test(word));
  if (queryHasIdentityHint && closeScores) {
    return {
      reason: 'ambiguous_product',
      categories,
      products: products.slice(0, 3)
    };
  }
  return null;
}

function buildRetrievalClarificationReply(uncertainty, lang, customerBrand = 'KingCom') {
  const categoryNames = (uncertainty?.categories || []).map(categoryLabel);
  const productNames = (uncertainty?.products || [])
    .map(product => productDisplayName(product, ''))
    .filter(Boolean);
  if (uncertainty?.reason === 'ambiguous_category') {
    const options = categoryNames.join(', ');
    if (!options) {
      if (lang === 'en') return `I am not yet certain which product category you mean. Could you share the product group, use case, or exact model you need?`;
      if (lang === 'zh') return `我还不能确定您想咨询的产品类别。请告诉我产品类别、使用需求或具体型号。`;
      return `Dạ, em chưa xác định chắc anh/chị đang cần nhóm sản phẩm nào. Anh/chị cho em biết nhóm sản phẩm, nhu cầu sử dụng hoặc model cụ thể để em tư vấn đúng hơn ạ.`;
    }
    if (lang === 'en') return `I am not yet certain which product category you mean. Are you looking for ${options}, or another category?`;
    if (lang === 'zh') return `我还不能确定您想咨询的产品类别。您需要的是${options}，还是其他类别？`;
    return `Dạ, em chưa xác định chắc anh/chị đang cần nhóm sản phẩm nào. Anh/chị đang tìm ${options}, hay nhóm khác ạ?`;
  }
  const options = productNames.join(', ');
  if (lang === 'en') return `I found several similar products and do not want to advise the wrong one. Could you confirm the exact model${options ? `: ${options}` : ''}?`;
  if (lang === 'zh') return `我找到几款相似产品，为避免提供错误信息，请确认具体型号${options ? `：${options}` : ''}。`;
  return `Dạ, ${customerBrand} tìm thấy vài sản phẩm gần giống nhau nên em chưa muốn chọn nhầm. Anh/chị xác nhận giúp em đúng model${options ? ` trong các mẫu: ${options}` : ''} ạ?`;
}

const BROAD_SEARCH_STOPWORDS = new Set([
  'anh', 'chi', 'em', 'minh', 'toi', 'shop', 'ben', 'ban', 'co', 'khong',
  'can', 'muon', 'tim', 'hieu', 've', 'tu', 'van', 'giup', 'cho', 'hoi',
  'san', 'pham', 'mua', 'gia', 'bao', 'nhieu', 'nao', 'nay', 'do', 'a'
]);

function buildBroaderSearchQuery(userText, conversationContext = {}, scopeBrand = '') {
  const contextText = contextSearchText(conversationContext);
  const usefulWords = queryWords(userText)
    .filter(word => !BROAD_SEARCH_STOPWORDS.has(word))
    .slice(0, 8);
  return [contextText, scopeBrand, usefulWords.join(' ')]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function isBroadConsultationRequest(userText, intent) {
  if (!['general', 'product_search'].includes(intent)) return false;
  const normalized = normalize(userText);
  const words = queryWords(userText);
  const asksForHelp = /\b(tu van|goi y|gioi thieu|cho hoi|can mua|muon mua|tim hieu|san pham|do quay phim|do quay chup|phu kien)\b/i.test(normalized);
  const genericConsultationWords = new Set([
    'tu', 'van', 'goi', 'y', 'gioi', 'thieu', 'hoi', 've', 'can', 'mua', 'muon',
    'tim', 'hieu', 'san', 'pham', 'do', 'quay', 'phim', 'chup', 'phu', 'kien',
    'lens', 'micro', 'mic', 'den', 'tripod', 'gimbal', 'filter', 'camera'
  ]);
  const hasSpecificIdentity = words.some(word => (
    /[a-z]+\d|\d+[a-z]+/i.test(word)
    || ['ulanzi', 'synco', 'viltrox', 'maono', 'boya', 'fifine', 'nanlite', 'zhiyun'].includes(word)
    || !genericConsultationWords.has(word)
  ));
  return asksForHelp && !hasSpecificIdentity && words.length <= 10;
}

function buildBroadConsultationReply(lang, customerBrand = 'KingCom') {
  if (lang === 'en') {
    return `Certainly. What will you use the product for, which product type are you considering, and what is your approximate budget? ${customerBrand} will then suggest suitable options.`;
  }
  if (lang === 'zh') {
    return `可以的。请告诉我您的使用需求、想了解的产品类型和大致预算，${customerBrand} 会为您推荐更合适的产品。`;
  }
  return `Dạ được ạ. Anh/chị cho em biết nhu cầu sử dụng, nhóm sản phẩm đang quan tâm và khoảng ngân sách dự kiến; ${customerBrand} sẽ gợi ý mẫu phù hợp hơn ạ.`;
}

function hasSpecificProductQuery(userText, intent) {
  if (!['buy', 'price', 'product_search', 'product_specs', 'order'].includes(intent)) return false;
  if (isFollowUpLinkRequest(userText)) return false;
  const words = queryWords(userText);
  if (!words.length) return false;
  return words.some(w => w.length >= 3 || /[a-z]+\d|\d+[a-z]+/i.test(w));
}

function productQueryLabel(userText) {
  const normalized = normalize(userText);
  const phraseLabels = [
    [/bop da bo/i, 'bóp da bò'],
    [/ca phe/i, 'cà phê'],
    [/nuoc uong/i, 'nước uống'],
    [/laptop|thinkpad/i, 'laptop/ThinkPad'],
    [/my pham|lam dep/i, 'mỹ phẩm']
  ];
  const phrase = phraseLabels.find(([pattern]) => pattern.test(normalized));
  if (phrase) return phrase[1];

  const words = queryWords(userText)
    .filter(w => !PRODUCT_CONTEXT_WORDS.has(w))
    .filter(w => w.length >= 2)
    .slice(0, 4);
  return words.join(' ')
    .replace(/\bden\b/g, 'đèn')
    .replace(/\bca phe\b/g, 'cà phê')
    .replace(/\bnuoc uong\b/g, 'nước uống')
    .replace(/\bmic\b/g, 'micro')
    .trim();
}

function isClearlyOutOfScopeProductRequest(userText, intent = '') {
  if (!['buy', 'price', 'product_search', 'product_specs', 'order', 'unsupported'].includes(intent)) return false;
  const normalized = normalize(userText);
  if (isCompatibilityFollowUp(userText)) return false;
  return /\b(bop da bo|ca phe|nuoc uong|laptop|thinkpad|my pham|son moi|kem duong|thuc pham|do an|quan ao|giay dep)\b/i.test(normalized);
}

function buildNoCatalogMatchReply(userText, lang, scopeBrand = '') {
  const label = productQueryLabel(userText);
  const scope = String(scopeBrand || '').trim();
  if (lang === 'en') {
    if (scope) return `This page currently supports ${scope} products only. I could not find ${label || 'that product'} in the ${scope} catalog. I have forwarded your request to KingCom staff for further checking.`;
    return label
      ? `KingCom currently does not have ${label} in the catalog. I have forwarded this to KingCom staff to check further if needed.`
      : 'KingCom currently does not have this product in the catalog. I have forwarded this to KingCom staff to check further if needed.';
  }
  if (lang === 'zh') {
    if (scope) return `此页面目前仅咨询 ${scope} 产品。${scope} 目录中没有找到 ${label || '该产品'}。我已转交给 KingCom 员工进一步确认。`;
    return label
      ? `KingCom 目前目录中没有 ${label} 这款产品。我已转交给 KingCom 员工进一步确认。`
      : 'KingCom 目前目录中没有这款产品。我已转交给 KingCom 员工进一步确认。';
  }
  if (scope) return `Dạ fanpage này hiện tư vấn sản phẩm ${scope}. Em chưa tìm thấy ${label || 'sản phẩm anh/chị hỏi'} trong catalog ${scope}. Em đã chuyển thông tin cho nhân viên KingCom kiểm tra thêm ạ.`;
  return label
    ? `Dạ hiện KingCom chưa có sản phẩm ${label} trong catalog ạ. Em đã chuyển thông tin cho nhân viên KingCom kiểm tra thêm nếu anh/chị cần.`
    : 'Dạ hiện KingCom chưa có sản phẩm này trong catalog ạ. Em đã chuyển thông tin cho nhân viên KingCom kiểm tra thêm nếu anh/chị cần.';
}

function buildLocalizedRuleReply(intent, userText, lang, scopeBrand = '', customerBrand = 'KingCom') {
  const scope = String(scopeBrand || '').trim();
  const brand = String(customerBrand || 'KingCom').trim() || 'KingCom';
  const unsupportedLabel = productQueryLabel(userText);
  if (lang === 'en') {
    if (intent === 'store_info') {
      return 'KingCom store address is 65 Nguyen Minh Hoang, Bay Hien Ward, Ho Chi Minh City. What product can I help you with?';
    }
    if (intent === 'catalog_info') {
      if (scope) return `This page supports ${scope} products. Please tell me the product type or model you are looking for so I can suggest matching ${scope} products.`;
      return 'KingCom carries photography, filming, and content creation accessories such as gimbals, microphones, lights, filters, tripods, monitors, and livestream equipment. Which product group are you interested in?';
    }
    if (intent === 'unsupported') {
      return `${brand} currently does not sell ${unsupportedLabel || 'that product'}. We focus on photography, filming, and content creation accessories such as gimbals, microphones, lights, filters, and tripods. Which product group would you like help with?`;
    }
    if (intent === 'human') {
      if (hasPhoneNumber(userText)) return 'Thank you, I have received your phone number. I will forward it to KingCom staff for follow-up.';
      return 'I have noted your request to speak with staff. Please share your phone number so KingCom staff can contact you soon.';
    }
    if (intent === 'greeting') {
      return 'Hi! KingCom can help you find products, check prices, delivery, or warranty information. What can I help you with today?';
    }
  }

  if (lang === 'zh') {
    if (intent === 'store_info') {
      return 'KingCom 门店地址是越南胡志明市 Bảy Hiền 坊 Nguyễn Minh Hoàng 65 号。您需要我继续协助查询哪一款产品吗？';
    }
    if (intent === 'catalog_info') {
      if (scope) return `此页面提供 ${scope} 产品咨询。请告诉我您需要的产品类型或具体型号，我会为您推荐合适的 ${scope} 产品。`;
      return 'KingCom 销售摄影、拍摄和内容创作相关配件，例如稳定器、麦克风、灯具、滤镜、三脚架、外接屏幕和直播设备。您想了解哪一类产品？';
    }
    if (intent === 'unsupported') {
      return `目前 ${brand} 暂未销售${unsupportedLabel || '该产品'}。我们主要销售摄影、拍摄和内容创作相关配件，例如稳定器、麦克风、灯具、滤镜和三脚架。您想咨询哪一类产品？`;
    }
    if (intent === 'human') {
      if (hasPhoneNumber(userText)) return '谢谢，我已收到您的电话号码，并会转交给 KingCom 员工跟进。';
      return '我已记录您需要人工协助。请留下电话号码，KingCom 员工会尽快联系您。';
    }
    if (intent === 'greeting') {
      return '您好！KingCom 可以协助您查询产品、报价、配送或保修信息。请问您需要了解什么产品？';
    }
  }

  if (intent === 'catalog_info' && scope) {
    return `Dạ fanpage này tư vấn sản phẩm ${scope}. Anh/chị đang cần loại sản phẩm hoặc model nào để em gợi ý đúng sản phẩm ${scope} phù hợp ạ?`;
  }

  return null;
}

function buildHumanRequestReply(userText, lang, channel) {
  const contact = extractContactInfo(userText);
  const isWebsiteChat = ['haravan_website', 'website'].includes(channel);
  if (lang === 'en') {
    if (contact.phone) {
      return `Thank you, I have received your phone number ${contact.phone}. I have forwarded your request to KingCom staff for follow-up.`;
    }
    return isWebsiteChat
      ? 'I have forwarded your request to KingCom staff. You can continue messaging in this chat box, and our staff will reply here when available. If convenient, please also leave your phone number so we can support you faster.'
      : 'I have forwarded your request to KingCom staff. Please share your phone number so our staff can contact and support you faster.';
  }
  if (lang === 'zh') {
    if (contact.phone) {
      return `谢谢，我已收到您的电话号码 ${contact.phone}，并已转交给 KingCom 员工跟进。`;
    }
    return isWebsiteChat
      ? '我已将您的请求转交给 KingCom 员工。您可以继续在此聊天窗口留言，工作人员在线时会在这里回复您。如方便，也请留下电话号码，方便更快支持。'
      : '我已将您的请求转交给 KingCom 员工。请留下电话号码，方便工作人员尽快联系并协助您。';
  }
  if (contact.phone) {
    return `Dạ em đã nhận được số điện thoại ${contact.phone}. Em đã chuyển yêu cầu của anh/chị cho nhân viên KingCom theo dõi và hỗ trợ ạ.`;
  }
  return isWebsiteChat
    ? 'Dạ em đã ghi nhận yêu cầu gặp nhân viên của anh/chị. Em đã chuyển thông tin cho nhân viên KingCom; anh/chị có thể tiếp tục nhắn tại khung chat này, nhân viên sẽ phản hồi tại đây khi có mặt. Nếu tiện, anh/chị để lại thêm số điện thoại để KingCom hỗ trợ nhanh hơn ạ.'
    : 'Dạ em đã ghi nhận yêu cầu gặp nhân viên của anh/chị. Em sẽ chuyển thông tin cho nhân viên KingCom hỗ trợ. Nếu tiện, anh/chị để lại số điện thoại để KingCom liên hệ nhanh hơn ạ.';
}

async function generateReplyRaw({
  channel,
  userText,
  history,
  customer,
  intent,
  sourceKey = '',
  sourceName = '',
  sourceGroup = '',
  conversationContext = {}
}) {
  const messageLanguage = detectMessageLanguage(userText, history);
  const guidanceQuestion = isProductGuidanceQuery(userText);
  const specsQuestion = intent === 'product_specs' || isProductSpecsRequest(userText, history);
  const opinionQuestion = isComparisonQuestion(userText) || isSubjectiveAssessmentQuestion(userText);
  const policyQuestion = isCommercialPolicyQuestion(userText, intent);
  const productUrlQuestion = extractProductPageUrls(userText).length > 0;
  const sourceConfig = readSourceConfig(sourceKey);
  const scopeBrand = String(sourceConfig.brand || '').trim();
  const customerBrand = resolveCustomerBrand({ sourceKey, sourceName, sourceGroup });
  const resolvedConversationContext = Object.keys(normalizeContext(conversationContext)).length
    ? normalizeContext(conversationContext)
    : resolveConversationContext({ userText, history, existingContext: {}, intent, sourceKey, sourceName, sourceGroup });
  const scopedProducts = loadProducts({ sourceKey });
  const customerPhone = String(customer?.phone || '').trim();
  const existingContactInstruction = customerPhone
    ? `H\u1ed3 s\u01a1 kh\u00e1ch \u0111\u00e3 c\u00f3 s\u1ed1 \u0111i\u1ec7n tho\u1ea1i ${customerPhone}. Tuy\u1ec7t \u0111\u1ed1i kh\u00f4ng h\u1ecfi ho\u1eb7c xin l\u1ea1i s\u1ed1 \u0111i\u1ec7n tho\u1ea1i. Khi c\u1ea7n nh\u00e2n vi\u00ean theo d\u00f5i, h\u00e3y n\u00f3i s\u1ebd d\u00f9ng th\u00f4ng tin li\u00ean h\u1ec7 kh\u00e1ch \u0111\u00e3 cung c\u1ea5p.`
    : 'H\u1ed3 s\u01a1 kh\u00e1ch ch\u01b0a c\u00f3 s\u1ed1 \u0111i\u1ec7n tho\u1ea1i. Ch\u1ec9 xin th\u00f4ng tin li\u00ean h\u1ec7 khi th\u1ef1c s\u1ef1 c\u1ea7n nh\u00e2n vi\u00ean theo d\u00f5i.';
  const structuredIntentForPrompt = JSON.stringify(resolvedConversationContext.customer_intent || {});
  const contactInfoReply = buildContactInfoReply(userText, messageLanguage);
  if (contactInfoReply) {
    return {
      reply: contactInfoReply,
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_contact_info',
      ragProducts: []
    };
  }

  if (isConversationStopRequest(userText)) {
    return {
      reply: buildConversationStopReply(messageLanguage, customerBrand),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_conversation_stop',
      searchQuery: '',
      ragProducts: [],
      conversationContext: resolvedConversationContext
    };
  }

  if (intent === 'human') {
    return {
      reply: buildHumanRequestReply(userText, messageLanguage, channel),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_human_handoff',
      ragProducts: []
    };
  }

  if (intent === 'catalog_info' || isCatalogScopeQuestion(userText)) {
    return {
      reply: buildCatalogOverviewReply({ lang: messageLanguage, scopeBrand, products: scopedProducts }),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_catalog_overview',
      ragProducts: []
    };
  }

  const policyRuleReply = buildPolicyRuleReply(userText, messageLanguage, scopeBrand, sourceKey, customerBrand);
  if (policyRuleReply) {
    return {
      reply: policyRuleReply,
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_policy',
      ragProducts: []
    };
  }

  if (intent === 'store_info') {
    return {
      reply: buildStoreInfoReply({ sourceKey, customerBrand, lang: messageLanguage }),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_source_store_info',
      ragProducts: []
    };
  }

  const localizedRuleReply = buildLocalizedRuleReply(intent, userText, messageLanguage, scopeBrand, customerBrand);
  if (localizedRuleReply) {
    return {
      reply: localizedRuleReply,
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule',
      ragProducts: []
    };
  }

  if (intent === 'unsupported') {
    const unsupportedLabel = productQueryLabel(userText) || 'sản phẩm đó';
    return {
      reply: `Dạ hiện ${customerBrand} chưa kinh doanh ${unsupportedLabel} ạ. Bên em chuyên phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung như gimbal, micro, đèn, filter, tripod... Anh/chị cần em tư vấn nhóm sản phẩm nào ạ?`,
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule',
      ragProducts: []
    };
  }

  if (isClearlyOutOfScopeProductRequest(userText, intent)) {
    const unsupportedLabel = productQueryLabel(userText) || 'sản phẩm đó';
    return {
      reply: `Dạ hiện ${customerBrand} chưa kinh doanh ${unsupportedLabel} ạ. Bên em chuyên phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung như gimbal, micro, đèn, filter, tripod... Anh/chị cần em tư vấn nhóm sản phẩm nào ạ?`,
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_out_of_scope_product',
      searchQuery: userText,
      ragProducts: [],
      conversationContext: resolvedConversationContext
    };
  }

  if (
    resolvedConversationContext.needs_clarification
    && (guidanceQuestion || specsQuestion || isFollowUpLinkRequest(userText) || ['product_specs', 'price'].includes(intent))
  ) {
    return {
      reply: buildClarificationReply(resolvedConversationContext, messageLanguage),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_context_clarification',
      searchQuery: userText,
      ragProducts: [],
      conversationContext: resolvedConversationContext
    };
  }
  const directPriceReply = buildDirectPriceReply(userText, {
    sourceKey,
    conversationContext: resolvedConversationContext,
    requestedCategory: resolvedConversationContext.requested_category || inferRequestedCategory(userText)
  });
  if (directPriceReply) {
    return {
      reply: directPriceReply.reply,
      aiUsed: 0,
      aiError: false,
      aiSource: directPriceReply.source,
      searchQuery: userText,
      ragProducts: directPriceReply.products
    };
  }

  if (isCatalogRecommendationQuery(userText)) {
    const products = pickRandomProducts(loadProducts({ sourceKey }), 3);
    if (products.length) {
      return {
        reply: buildCatalogRecommendationReply(products, messageLanguage, scopeBrand),
        aiUsed: 0,
        aiError: false,
        aiSource: 'rule_random_catalog_recommendations',
        searchQuery: userText,
        ragProducts: products
      };
    }
  }

  if (intent === 'human' && hasPhoneNumber(userText)) {
    return {
      reply: 'Dạ em đã nhận được số điện thoại của anh/chị. Em sẽ chuyển thông tin cho nhân viên KingCom liên hệ tư vấn sớm ạ.',
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_phone_handoff',
      ragProducts: []
    };
  }

  if (intent === 'greeting' || intent === 'human') {
    const sourceContext = [
      sourceGroup ? `Nguồn: ${sourceGroup}` : '',
      sourceName ? `Tên nguồn: ${sourceName}` : '',
      `Tên thương hiệu giao tiếp bắt buộc: ${customerBrand}`,
      sourceKey ? `Source key: ${sourceKey}` : ''
    ].filter(Boolean).join('\n');

    const greetingPrompt = `Bạn là nhân viên tư vấn của ${customerBrand}, cửa hàng phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung. Trả lời tiếng Việt, ngắn gọn, thân thiện, tự nhiên như người thật đang chat với khách.

Địa chỉ cửa hàng KingCom: 65 Nguyễn Minh Hoàng, phường Bảy Hiền, thành phố Hồ Chí Minh, Việt Nam

${sourceContext ? `Nguồn dữ liệu hiện tại:\n${sourceContext}\n` : ''}
${existingContactInstruction}

Ý định: ${intent}
${intent === 'human' ? 'Khách yêu cầu gặp nhân viên.' : 'Khách đang chào hỏi.'}

Quy tắc giọng nói:
- Không tự xưng là AI, bot, trợ lý ảo, hệ thống tự động.
- Xưng "em" hoặc "${customerBrand}", gọi khách là "anh/chị" khi phù hợp.
- Chỉ dùng tên thương hiệu "${customerBrand}" khi nói với khách. Không tự nhận là thương hiệu khác.
- KingCom KHÔNG phải cửa hàng mỹ phẩm. Tuyệt đối không nói KingCom bán mỹ phẩm/làm đẹp.
- Khi giới thiệu KingCom, chỉ nói là cửa hàng phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung.
- Nếu không chắc thông tin, nói "em kiểm tra thêm" hoặc "em chuyển nhân viên phụ trách kiểm tra", không nói "AI không biết".
- Không cười, trêu, chê hoặc nói khách "nhầm lẫn gì đây"; nếu câu hỏi ngoài phạm vi, hãy giải thích lịch sự và gợi ý nhóm sản phẩm phù hợp.
- Không nói mình là "giao diện tự động" hoặc "không thể trao đổi trực tiếp".
- Không tự thêm mẫu trống như "Số điện thoại: ____".
- Chỉ nhắc lại số điện thoại khi khách vừa cung cấp hoặc hỏi lại số đã cung cấp; không chèn xác nhận số điện thoại vào câu trả lời không liên quan.

${intent === 'greeting'
          ? 'Chào lại khách ngắn gọn, hỏi khách cần hỗ trợ gì. KHÔNG liệt kê sản phẩm, KHÔNG gợi ý sản phẩm cụ thể.'
          : 'Ghi nhận yêu cầu. Hỏi khách để lại số điện thoại để nhân viên liên hệ. KHÔNG liệt kê sản phẩm.'}`;

    try {
      const reply = await callOpenAI(
        applyCustomerBranding(greetingPrompt, customerBrand),
        Number(process.env.AI_TIMEOUT_MS || 45000)
      );
      return { reply, aiUsed: 1, aiError: false, aiSource: 'provider', ragProducts: [] };
    } catch (e) {
      console.error('OpenAI greeting error:', e.message);
      return {
        reply: intent === 'greeting'
          ? 'Xin chào! KingCom có thể hỗ trợ bạn tìm sản phẩm, báo giá, giao hàng hoặc bảo hành ạ.'
          : 'Dạ mình đã ghi nhận yêu cầu gặp nhân viên. Anh/chị vui lòng để lại số điện thoại để KingCom liên hệ tư vấn nhanh nhất nhé.',
        aiUsed: 0,
        aiError: true,
        aiErrorMessage: e.message,
        aiSource: 'fallback',
        ragProducts: []
      };
    }
  }

  if (isBroadConsultationRequest(userText, intent) && !guidanceQuestion && !policyQuestion) {
    return {
      reply: buildBroadConsultationReply(messageLanguage, customerBrand),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_context_clarification',
      searchQuery: userText,
      ragProducts: [],
      conversationContext: resolvedConversationContext
    };
  }

  let searchQuery = buildSearchQuery(userText, history, customer, resolvedConversationContext);
  const retrievalOptions = {
    sourceKey,
    topK: policyQuestion ? 0 : ((guidanceQuestion || specsQuestion) ? 1 : 12),
    includeDescriptions: true,
    descriptionMaxChars: specsQuestion ? 3500 : 800,
    requiredCategory: resolvedConversationContext.requested_category || '',
    requireIdentityMatch: !isStartingPriceQuery(userText)
      && (isAvailabilityQuestion(userText) || isShortSpecificFollowUp(userText) || specsQuestion)
  };
  let retrieval = buildContext(searchQuery, retrievalOptions);
  let { context, products } = retrieval;
  if (retrievalOptions.requiredCategory) {
    products = products.filter(product => matchesRequiredCategory(product, retrievalOptions.requiredCategory));
  }
  if (resolvedConversationContext.alternative_product_request) {
    products = products.filter(product => !isSameProduct(product, resolvedConversationContext));
  }
  if (
    !policyQuestion
    && !products.length
    && ['buy', 'price', 'product_search', 'product_specs', 'order'].includes(intent)
  ) {
    const broaderQuery = resolvedConversationContext.alternative_product_request
      ? buildAlternativeSearchQuery(userText, resolvedConversationContext)
      : buildBroaderSearchQuery(userText, resolvedConversationContext, scopeBrand);
    if (broaderQuery && normalize(broaderQuery) !== normalize(searchQuery)) {
      retrieval = buildContext(broaderQuery, {
        ...retrievalOptions,
        requireIdentityMatch: false
      });
      if (retrieval.products.length) {
        searchQuery = broaderQuery;
        ({ context, products } = retrieval);
        if (retrievalOptions.requiredCategory) {
          products = products.filter(product => matchesRequiredCategory(product, retrievalOptions.requiredCategory));
        }
        if (resolvedConversationContext.alternative_product_request) {
          products = products.filter(product => !isSameProduct(product, resolvedConversationContext));
        }
      }
    }
  }
  if (
    !policyQuestion
    && !products.length
    && (
      resolvedConversationContext.current_product_url
      || resolvedConversationContext.current_product_sku
      || resolvedConversationContext.customer_intent?.product_url
      || resolvedConversationContext.customer_intent?.product_sku
    )
  ) {
    const explicitProducts = resolveOpinionProducts({
      userText,
      products: [],
      conversationContext: resolvedConversationContext,
      sourceKey
    }).slice(0, 1);
    if (explicitProducts.length) {
      products = explicitProducts;
      context = explicitProducts.map((product, index) => productLine(product, index + 1)).join('\n\n');
    }
  }
  const retrievalUncertainty = assessRetrievalUncertainty({
    userText,
    intent,
    conversationContext: resolvedConversationContext,
    products
  });
  if (retrievalUncertainty && !guidanceQuestion && !policyQuestion && !opinionQuestion) {
    const clarificationContext = {
      ...resolvedConversationContext,
      needs_clarification: true,
      clarification_reason: retrievalUncertainty.reason,
      clarification_options: retrievalUncertainty.products.map(product => ({
        current_product_id: product.sku || product.url || product.name || '',
        current_product_name: product.name || product.title || '',
        current_product_sku: product.sku || '',
        current_product_url: product.url || product.link || product.product_url || '',
        current_brand: product.vendor || product.brand || ''
      }))
    };
    return {
      reply: buildRetrievalClarificationReply(retrievalUncertainty, messageLanguage, customerBrand),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_retrieval_clarification',
      searchQuery,
      ragProducts: [],
      conversationContext: clarificationContext
    };
  }
  const productPageContext = productUrlQuestion
    ? await readProductPageContext(userText, { products })
    : { ok: false, skipped: 'no_product_url' };
  if (productPageContext.error) {
    console.warn('Product page fetch skipped after error:', productPageContext.error);
  }
  if (guidanceQuestion && products.length) {
    const webGuidance = await answerProductGuidanceFromWeb({
      userText,
      history,
      products,
      sourceConfig,
      customerBrand,
      language: messageLanguage
    });
    if (webGuidance.ok) {
      return {
        reply: webGuidance.reply,
        aiUsed: 1,
        aiError: false,
        aiSource: 'provider_web_guidance',
        searchQuery,
        ragProducts: products.slice(0, 1),
        webSources: webGuidance.webSources,
        webSearchRequests: webGuidance.webSearchRequests,
        conversationContext: resolvedConversationContext
      };
    }
    if (webGuidance.error) {
      console.warn('Product guidance web search skipped after error:', webGuidance.error);
    }
  }
  const compatibilityReply = specsQuestion && products.length
    ? buildCompatibilityEvidenceReply(products, userText, messageLanguage)
    : null;
  if (compatibilityReply) {
    return {
      reply: compatibilityReply,
      aiUsed: 0,
      aiError: false,
      aiSource: 'direct_catalog_compatibility',
      searchQuery,
      ragProducts: products.slice(0, 1),
      conversationContext: resolvedConversationContext
    };
  }
  const catalogSpecsReply = specsQuestion && products.length
    ? buildProductSpecsEvidenceReply(products, userText, messageLanguage)
    : null;
  if (catalogSpecsReply) {
    return {
      reply: catalogSpecsReply,
      aiUsed: 0,
      aiError: false,
      aiSource: 'direct_catalog_product_specs',
      searchQuery,
      ragProducts: products.slice(0, 1),
      conversationContext: resolvedConversationContext
    };
  }
  if (specsQuestion && products.length && !catalogHasClearSpecs(products[0])) {
    const webSpecs = await answerProductSpecsFromWeb({
      userText,
      history,
      products,
      sourceConfig,
      customerBrand,
      language: messageLanguage
    });
    if (webSpecs.ok) {
      return {
        reply: webSpecs.reply,
        aiUsed: 1,
        aiError: false,
        aiSource: 'provider_web_product_specs',
        searchQuery,
        ragProducts: products.slice(0, 1),
        webSources: webSpecs.webSources,
        webSearchRequests: webSpecs.webSearchRequests,
        conversationContext: resolvedConversationContext
      };
    }
    if (webSpecs.error) {
      console.warn('Product specs web search skipped after error:', webSpecs.error);
    }
  }
  if (opinionQuestion) {
    const opinionReply = buildOpinionReply({
      userText,
      products,
      conversationContext: resolvedConversationContext,
      sourceKey,
      lang: messageLanguage,
      customerBrand
    });
    if (opinionReply?.reply) {
      return {
        reply: opinionReply.reply,
        aiUsed: 0,
        aiError: false,
        aiSource: opinionReply.aiSource || 'rule_opinion',
        searchQuery,
        ragProducts: opinionReply.ragProducts || products.slice(0, 2),
        conversationContext: resolvedConversationContext
      };
    }
  }
  if (isPreviousAdviceComplaint(userText) && !guidanceQuestion && !policyQuestion) {
    return {
      reply: buildPreviousAdviceCorrectionReply(userText, products, scopeBrand),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_previous_advice_correction',
      searchQuery,
      ragProducts: products,
      conversationContext: resolvedConversationContext
    };
  }
  if (
    resolvedConversationContext.alternative_product_request
    && products.length
    && products.every(product => matchesRequiredCategory(product, resolvedConversationContext.requested_category))
    && !guidanceQuestion
    && !policyQuestion
  ) {
    return {
      reply: buildAlternativeProductsReply(products, messageLanguage, customerBrand),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_alternative_products',
      searchQuery,
      ragProducts: products.slice(0, 3),
      conversationContext: resolvedConversationContext
    };
  }
  const budgetProductReply = (!guidanceQuestion && !policyQuestion && ['buy', 'price', 'product_search', 'order'].includes(intent))
    ? buildBudgetProductReply(userText, products, scopeBrand, customerPhone)
    : null;
  if (budgetProductReply) {
    const budgetProducts = productsWithinBudget(userText, products);
    return {
      reply: budgetProductReply,
      aiUsed: 0,
      aiError: false,
      aiSource: 'direct_budget_lookup',
      searchQuery,
      ragProducts: budgetProducts.slice(0, 3),
      conversationContext: resolvedConversationContext
    };
  }
  if (
    !guidanceQuestion
    && !policyQuestion
    && ['buy', 'price', 'product_search', 'order'].includes(intent)
    && extractMaxPrice(userText)
    && resolvedConversationContext.requested_category
    && products.length
    && !productsWithinBudget(userText, products).length
  ) {
    return {
      reply: buildCategoryNoMatchReply(
        resolvedConversationContext.requested_category,
        userText,
        messageLanguage,
        customerBrand
      ),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_category_no_match',
      searchQuery,
      ragProducts: [],
      conversationContext: resolvedConversationContext
    };
  }
  const startingPriceReply = (!guidanceQuestion && !policyQuestion && ['buy', 'price', 'product_search', 'order'].includes(intent))
    ? buildStartingPriceReply(userText, products, scopeBrand)
    : null;
  if (startingPriceReply) {
    return {
      reply: startingPriceReply,
      aiUsed: 0,
      aiError: false,
      aiSource: 'direct_starting_price_lookup',
      searchQuery,
      ragProducts: products.slice(0, 3),
      conversationContext: resolvedConversationContext
    };
  }
  if (
    resolvedConversationContext.new_category_request
    && resolvedConversationContext.requested_category
    && products.length
    && !guidanceQuestion
    && !policyQuestion
  ) {
    return {
      reply: buildCategoryProductsReply(
        products,
        resolvedConversationContext.requested_category,
        messageLanguage,
        customerBrand
      ),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_need_category_products',
      searchQuery,
      ragProducts: products.slice(0, 3),
      conversationContext: resolvedConversationContext
    };
  }
  if (
    resolvedConversationContext.requested_category
    && !products.length
    && extractMaxPrice(userText)
    && !guidanceQuestion
    && !policyQuestion
  ) {
    return {
      reply: buildCategoryNoMatchReply(
        resolvedConversationContext.requested_category,
        userText,
        messageLanguage,
        customerBrand
      ),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_category_no_match',
      searchQuery,
      ragProducts: [],
      conversationContext: resolvedConversationContext
    };
  }
  if (!products.length && hasSpecificProductQuery(userText, intent) && !guidanceQuestion && !policyQuestion) {
    return {
      reply: buildNoCatalogMatchReply(userText, messageLanguage, scopeBrand),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_no_catalog_match',
      searchQuery,
      ragProducts: [],
      conversationContext: resolvedConversationContext
    };
  }
  const availabilityReply = policyQuestion ? null : buildAvailabilityReply(userText, products);
  if (availabilityReply) {
    return {
      reply: availabilityReply,
      aiUsed: 0,
      aiError: false,
      aiSource: 'direct_availability_lookup',
      searchQuery,
      ragProducts: products.slice(0, 1),
      conversationContext: resolvedConversationContext
    };
  }
  if (scopeBrand && products.length && ['buy', 'price', 'product_search', 'order'].includes(intent) && !guidanceQuestion && !policyQuestion) {
    return {
      reply: buildScopedProductsReply(products, userText, scopeBrand),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_scoped_products',
      searchQuery,
      ragProducts: products.slice(0, 3),
      conversationContext: resolvedConversationContext
    };
  }
  const historyText = (history || []).slice(-8).map(m => `[${m.sender_type === 'customer' ? 'Khách hàng' : 'KingCom'}]: ${m.text}`).join('\n');
  const languageInstruction = messageLanguage === 'en'
    ? 'Khach dang dung tieng Anh. Tra loi bang tieng Anh tu nhien, ngan gon. Khong chuyen sang tieng Viet tru khi khach doi ngon ngu.'
    : messageLanguage === 'zh'
      ? 'Khach dang dung tieng Trung Quoc. Tra loi bang tieng Trung Quoc gian the, ngan gon, tu nhien. Khong chuyen sang tieng Viet tru khi khach doi ngon ngu.'
      : 'Khach dang dung tieng Viet. Tra loi tieng Viet ngan gon, than thien, tu nhien.';
  const productPageReference = productPageContext.ok
    ? `Noi dung doc tu link san pham khach gui (${productPageContext.url}):\n${productPageContext.text}`
    : '';
  const guardrailContext = [
    context,
    productPageReference,
    '',
    'Bat buoc tuan thu:',
    languageInstruction,
    structuredIntentForPrompt ? `Phan tich tin nhan dang JSON: ${structuredIntentForPrompt}` : '',
    '- Tra loi cung ngon ngu voi tin nhan moi nhat cua khach.',
    '- Chi nhac den san pham co trong muc "San pham lien quan"; khong tu them san pham khac.',
    '- Neu khach chi hoi mot model/san pham cu the, tra loi tap trung dung model do.',
    '- Khong khang dinh con hang/co san/in stock neu du lieu khong co ton kho; chi noi san pham co trong catalog va de nghi nhan vien kiem tra ton kho.',
    policyQuestion
      ? '- Khach dang hoi VAT/hoa don/bao hanh/doi tra/chinh sach. Chi tra loi theo FAQ va Chinh sach trong du lieu tham khao. Khong liet ke san pham moi, khong dinh link san pham, khong doi sang mau san pham khac. Neu can xac nhan theo model/don hang, noi da chuyen nhan vien KingCom kiem tra.'
      : '',
    guidanceQuestion
      ? '- Khach dang hoi cach su dung san pham. Hay huong dan tung buoc ngan gon, chi tap trung vao model khop nhat. Co the dung kien thuc san pham pho thong de huong dan, nhung khong bia chi tiet ky thuat, nut bam, cong ket noi, phu kien kem theo hoac tinh nang neu khong chac chan. Neu can, hoi them thiet bi khach dang dung hoac de nghi nhan vien KingCom xac nhan.'
      : specsQuestion
        ? '- Khach dang hoi thong so ky thuat cua san pham. Hay uu tien tra loi theo catalog, nhung neu catalog khong ghi ro thi co the dua tren thong tin web/nguon chinh hang duoc cho phep de bo sung thong so. Khong bia, khong doi sang mau khac, va neu khong xac minh duoc thi noi chua xac nhan duoc.'
        : productUrlQuestion
          ? '- Khach gui link san pham. Phai doc va tu van theo san pham trong link/catalog vua khop; khong noi khong co du lieu neu da co san pham khop. Khong chuyen sang san pham khac.'
          : ''
  ].filter(Boolean).join('\n');
  const sourceContext = [
    sourceGroup ? `Nguồn: ${sourceGroup}` : '',
    sourceName ? `Tên nguồn: ${sourceName}` : '',
    `Tên thương hiệu giao tiếp bắt buộc: ${customerBrand}`,
    sourceKey ? `Source key: ${sourceKey}` : ''
  ].filter(Boolean).join('\n');

  const prompt = `Bạn là nhân viên tư vấn của ${customerBrand}, cửa hàng phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung. Trả lời tiếng Việt, ngắn gọn, thân thiện, tự nhiên như người thật đang chat với khách, đúng dữ liệu.

Địa chỉ cửa hàng KingCom: 65 Nguyễn Minh Hoàng, phường Bảy Hiền, thành phố Hồ Chí Minh, Việt Nam

${sourceContext ? `Nguồn dữ liệu hiện tại:\n${sourceContext}\n` : ''}
${scopeBrand ? `Phạm vi fanpage: chỉ tư vấn sản phẩm ${scopeBrand}.\n` : ''}

Kênh: ${channel}
Ý định dự đoán: ${intent}
Thông tin khách đã học: ${customer?.profile_summary || ''}
Sản phẩm khách từng quan tâm: ${customer?.interested_products || '[]'}
Thông tin liên hệ: ${existingContactInstruction}

Lịch sử gần đây:
${historyText}

Truy vấn dùng để tìm sản phẩm: ${searchQuery}

Dữ liệu tham khảo:
${guardrailContext}

Khách hỏi: ${userText}

Quy tắc:
- Bạn là nhân viên thật, hãy xưng "em" hoặc tên thương hiệu "${customerBrand}", gọi khách là "anh/chị". Tuyệt đối không xưng là AI, bot hay trợ lý ảo.
- Nếu khách yêu cầu gặp nhân viên thật trên website, hãy trả lời là bạn đã chuyển thông tin cho bộ phận chuyên trách và họ sẽ hỗ trợ trực tiếp tại đây.
- KingCom chuyên bán phụ kiện nhiếp ảnh, quay phim và sáng tạo nội dung. Hãy từ chối lịch sự nếu khách hỏi về mỹ phẩm hoặc ngành hàng không liên quan.
- Luôn giữ thái độ chuyên nghiệp, tôn trọng và lịch sự với khách hàng trong mọi tình huống.
- Không cười, trêu, chê hoặc nói khách "nhầm lẫn gì đây"; nếu câu hỏi ngoài phạm vi, hãy giải thích lịch sự và gợi ý hướng phù hợp.
- Không nói mình là "giao diện tự động", "hệ thống tự động" hoặc "không thể trao đổi trực tiếp".
- Không tự thêm mẫu trống như "Số điện thoại: ____".
- Chỉ nhắc lại số điện thoại khi khách vừa cung cấp hoặc hỏi lại số đã cung cấp; không chèn câu xác nhận đã có số điện thoại vào câu trả lời không liên quan.
- BẮT BUỘC chỉ tư vấn dựa trên "Dữ liệu tham khảo". Nếu dữ liệu không có thông tin (giá, tồn kho, bảo hành, model), hãy chủ động xin lỗi, báo "chưa có thông tin" và đề nghị chuyển nhân viên KingCom kiểm tra.
- TUYỆT ĐỐI KHÔNG tự tạo ra (bịa) tên sản phẩm, giá bán, link mua hàng hay chương trình khuyến mãi. Mọi link sản phẩm phải lấy chính xác từ trường Link/url trong "Dữ liệu tham khảo".
- Khi được hỏi ngắn gọn "gửi link", hãy ngầm hiểu là khách muốn link của sản phẩm vừa nhắc đến gần nhất trong lịch sử hội thoại.
- Với các câu hỏi về VAT, hóa đơn, bảo hành, chính sách: Chỉ dựa vào phần FAQ/Policies trong dữ liệu tham khảo để trả lời, không đính kèm sản phẩm mới.
- Nếu danh sách sản phẩm có nhiều lựa chọn phù hợp, hãy liệt kê tối đa 3-5 mẫu, bao gồm: tên sản phẩm, giá và link trực tiếp.
- Nếu có phạm vi fanpage, chỉ giới thiệu các sản phẩm thuộc phạm vi đó.
- Nếu khách muốn mua, chốt đơn hoặc gặp người thật, hãy ghi nhận thông tin và chuyển ngay cho nhân viên hỗ trợ.
- Địa chỉ cửa hàng luôn là: 65 Nguyễn Minh Hoàng, phường Bảy Hiền, thành phố Hồ Chí Minh, Việt Nam.
- Quy tắc liên hệ: ${existingContactInstruction}`;

  try {
    const finalLanguageRule = messageLanguage === 'en'
      ? '\n\nFINAL LANGUAGE RULE: Reply in English only. Do not use Vietnamese except product names copied from catalog.'
      : messageLanguage === 'zh'
        ? '\n\nFINAL LANGUAGE RULE: Reply in Simplified Chinese only. Do not use Vietnamese except product names copied from catalog.'
        : '\n\nFINAL LANGUAGE RULE: Reply in Vietnamese only unless the customer switches language.';
    const brandedPrompt = applyCustomerBranding(`${prompt}${finalLanguageRule}`, customerBrand, products);
    const reply = await callOpenAI(brandedPrompt, Number(process.env.AI_TIMEOUT_MS || 45000));
    const hasDisallowedUrl = policyQuestion ? hasProductCatalogUrl(reply) : hasUnapprovedProductUrl(reply, products);
    if (hasDisallowedUrl) {
      console.warn('OpenAI response rejected: unapproved product URL');
      return {
        reply: guidanceQuestion
          ? buildProductGuidanceFallbackReply(products, messageLanguage)
          : specsQuestion
            ? buildProductSpecsFallbackReply(products, messageLanguage)
            : fallbackReply(intent, userText, products),
        aiUsed: 1,
        aiError: false,
        aiSource: specsQuestion ? 'guardrail_fallback_product_specs' : 'guardrail_fallback',
        searchQuery,
        ragProducts: products,
        conversationContext: resolvedConversationContext
      };
    }
    return {
      reply: policyQuestion ? reply : ensureProductLinks(reply, products),
      aiUsed: 1,
      aiError: false,
      aiSource: specsQuestion ? 'provider_product_specs' : 'provider',
      searchQuery,
      ragProducts: policyQuestion ? [] : products,
      conversationContext: resolvedConversationContext
    };
  } catch (e) {
    console.error('OpenAI async error:', e.message);
    return {
      reply: guidanceQuestion
        ? buildProductGuidanceFallbackReply(products, messageLanguage)
        : specsQuestion
          ? buildProductSpecsFallbackReply(products, messageLanguage)
          : fallbackReply(intent, userText, products),
      aiUsed: 0,
      aiError: true,
      aiErrorMessage: e.message,
      aiSource: specsQuestion ? 'fallback_product_specs' : 'fallback',
      searchQuery,
      ragProducts: policyQuestion ? [] : products,
      conversationContext: resolvedConversationContext
    };
  }
}

function fallbackSummary(messages, customer) {
  const lastCustomer = [...(messages || [])].reverse().find(m => m.sender_type === 'customer');
  const interests = customer?.interested_products || '[]';
  return `Tóm tắt tự động: khách quan tâm ${interests}. Tin nhắn gần nhất: ${lastCustomer?.text || 'chưa rõ'}.`;
}

function normalizeSummaryLanguage(language = 'vi') {
  const lang = String(language || 'vi').toLowerCase();
  if (['en', 'english'].includes(lang)) return 'en';
  if (['zh', 'zh-cn', 'cn', 'chinese'].includes(lang)) return 'zh';
  return 'vi';
}

function summaryLanguageInstruction(language = 'vi') {
  const lang = normalizeSummaryLanguage(language);
  if (lang === 'en') {
    return 'Summarize the customer support conversation below in English, maximum 5 bullet points. Mention: customer need, interested products, buying intent, and follow-up items. Do not invent facts.';
  }
  if (lang === 'zh') {
    return '请用简体中文总结以下客服对话，最多 5 个要点。请说明：客户需求、感兴趣的产品、购买意向、需要跟进的信息。不要编造信息。';
  }
  return 'Tóm tắt hội thoại CSKH dưới đây bằng tiếng Việt, tối đa 5 gạch đầu dòng. Nêu: nhu cầu khách, sản phẩm quan tâm, ý định mua, thông tin cần follow-up. Không bịa dữ liệu.';
}

async function generateReply(payload) {
  const result = await generateReplyRaw(payload);
  const customerBrand = resolveCustomerBrand(payload);
  return {
    ...result,
    customerBrand,
    reply: applyCustomerBranding(result.reply, customerBrand, result.ragProducts)
  };
}

async function summarizeConversation({ messages, customer, language = 'vi', fallbackOnError = true }) {
  const compact = (messages || []).slice(-20).map(m => `${m.sender_type}: ${m.text}`).join('\n');
  if (!compact.trim()) return '';

  const prompt = `Tóm tắt hội thoại CSKH dưới đây bằng tiếng Việt, tối đa 5 gạch đầu dòng. Nêu: nhu cầu khách, sản phẩm quan tâm, ý định mua, thông tin cần follow-up. Không bịa dữ liệu.

Thông tin khách đã học: ${customer?.profile_summary || ''}
Sản phẩm quan tâm: ${customer?.interested_products || '[]'}

Hội thoại:
${compact}`;

  try {
    const localizedPrompt = prompt.replace(/^.*?\r?\n\r?\n/s, `${summaryLanguageInstruction(language)}\n\n`);
    const summary = await callOpenAI(localizedPrompt, Number(process.env.SUMMARY_TIMEOUT_MS || 30000));
    return summary.slice(0, 2000);
  } catch (e) {
    console.error('OpenAI summary error:', e.message);
    if (!fallbackOnError) throw e;
    return fallbackSummary(messages, customer);
  }
}

function summarizeConversationFast({ messages, customer }) {
  return fallbackSummary(messages, customer);
}

module.exports = {
  generateReply,
  summarizeConversation,
  summarizeConversationFast,
  detectMessageLanguage,
  extractContactInfo,
  isProductSpecsRequest,
  catalogHasClearSpecs,
  extractCatalogSpecFacts,
  buildProductSpecsEvidenceReply,
  buildSearchQuery,
  buildAlternativeSearchQuery,
  buildBroaderSearchQuery,
  isBroadConsultationRequest,
  buildAlternativeProductsReply,
  assessRetrievalUncertainty,
  buildRetrievalClarificationReply,
  buildProductSpecsFallbackReply
};
