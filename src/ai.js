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
  parsePriceNumber,
  normalize
} = require('./rag');
const {
  readSourceConfig,
  resolveCustomerBrand,
  applyCustomerBranding
} = require('./sourceRegistry');
const { answerProductGuidanceFromWeb } = require('./webGuidance');
const { createEmptyResponseError, extractAssistantText } = require('./llmResponse');

async function callOpenAI(prompt, timeoutMs) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY/OPENROUTER_API_KEY not configured');

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const maxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 700);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isOpenRouter = /openrouter\.ai/i.test(baseUrl);
  const appReferer = process.env.OPENROUTER_HTTP_REFERER || process.env.PUBLIC_BASE_URL || '';
  const appTitle = process.env.OPENROUTER_TITLE || 'KingCom AI Agent';

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
  if (isOpenRouter && appReferer) headers['HTTP-Referer'] = String(appReferer);
  if (isOpenRouter && appTitle) {
    headers['X-Title'] = String(appTitle);
    headers['X-OpenRouter-Title'] = String(appTitle);
  }

  const formattedPrompt = `${prompt}

Yêu cầu định dạng bắt buộc:
- Trả lời bằng văn bản thuần, không dùng markdown.
- Không dùng ký tự ** để in đậm.
- Không dùng emoji hoặc icon trang trí.`;

  const requestBody = {
    model,
    messages: [{ role: 'user', content: formattedPrompt }]
  };
  if (isOpenRouter) {
    requestBody.reasoning = {
      effort: process.env.OPENAI_REASONING_EFFORT || 'minimal',
      exclude: true
    };
  }

  const emptyResponseRetries = Math.max(0, Number(process.env.OPENAI_EMPTY_RESPONSE_RETRIES || 1));
  try {
    for (let attempt = 0; attempt <= emptyResponseRetries; attempt += 1) {
      const attemptBody = { ...requestBody };
      attemptBody[isOpenRouter ? 'max_tokens' : 'max_completion_tokens'] = attempt === 0
        ? maxOutputTokens
        : Math.max(maxOutputTokens * 2, 1200);

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify(attemptBody)
      });

      const raw = await res.text();
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 1000)}`);

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error('OpenAI returned invalid JSON');
      }

      const content = extractAssistantText(data);
      if (content) return content;

      const emptyError = createEmptyResponseError(data);
      if (attempt >= emptyResponseRetries) throw emptyError;
      console.warn(`OpenAI empty response; retrying once (${emptyError.responseDetails})`);
    }
    throw new Error('OpenAI returned empty response after retry');
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`OpenAI timeout after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

function detectMessageLanguage(text) {
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

function isEnglishMessage(text) {
  return detectMessageLanguage(text) === 'en';
}

function isAvailabilityQuestion(text) {
  const raw = String(text || '');
  const norm = normalize(raw);
  return /\b(?:do|does)\s+(?:you|u|kingcom|shop|store)?\s*(?:have|carry|sell)\b/i.test(raw)
    || /\b(?:available|in stock|stock status)\b/i.test(raw)
    || /(co hang|con hang|san pham nay co khong|ben em co|shop co|co ban|dang ban)/i.test(norm);
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

function buildAvailabilityReply(userText, products) {
  if (!isAvailabilityQuestion(userText) || !products?.length) return null;

  const product = products[0];
  const name = productDisplayName(product);
  const sku = product.sku ? `SKU: ${product.sku}` : '';
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
      sku,
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
      sku,
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
    sku,
    `Giá: ${price}`,
    url ? `Link: ${url}` : '',
    '',
    'Em có thể chuyển nhân viên kiểm tra tồn kho hiện tại trước khi mình đặt hàng. Anh/chị cho em xin số điện thoại để hỗ trợ nhanh hơn ạ.'
  ].filter(Boolean).join('\n');
}

function productLine(product, index = 1) {
  const name = product.name || product.title || product.sku || `Sản phẩm ${index}`;
  const sku = product.sku ? `SKU: ${product.sku}` : 'SKU: N/A';
  const price = formatPrice(product._price || product.price || product.compare_at_price || product.gia || '');
  const url = product.url || product.link || product.product_url || '';
  return `${index}. ${name}\n${sku}\nGiá: ${price}${url ? `\nLink: ${url}` : ''}`;
}

function isPreviousAdviceComplaint(userText) {
  const normalized = normalize(userText);
  return (
    /\b(tai sao|sao|vi sao)\b/i.test(normalized)
    && /\b(nay|luc nay|hoi|tu van|tra loi|khong co|khong thay)\b/i.test(normalized)
  ) || /\b(hoi|dang hoi).{0,50}(sai|nham|lac de|tra loi|tu van)\b/i.test(normalized);
}

function buildBudgetProductReply(userText, products, scopeBrand = '') {
  const maxPrice = extractMaxPrice(userText);
  if (!maxPrice || !products?.length) return null;
  const lang = detectMessageLanguage(userText);
  const rows = products.slice(0, 3).map((p, i) => productLine(p, i + 1)).join('\n\n');
  const scope = scopeBrand ? ` trong catalog ${scopeBrand}` : '';
  if (lang === 'en') {
    return `I found matching products${scope} within ${formatPrice(maxPrice)}:\n\n${rows}\n\nPlease tell me which model you prefer, or share your phone number so KingCom staff can check current stock.`;
  }
  if (lang === 'zh') {
    return `我找到以下${scope}中符合 ${formatPrice(maxPrice)} 以内的产品：\n\n${rows}\n\n请告诉我您想了解哪一款，或留下电话号码，方便 KingCom 员工确认库存。`;
  }
  return `Dạ em tìm thấy sản phẩm phù hợp${scope} trong tầm giá dưới ${formatPrice(maxPrice)}:\n\n${rows}\n\nAnh/chị muốn xem kỹ mẫu nào, hoặc để lại số điện thoại để nhân viên KingCom kiểm tra tồn kho hỗ trợ thêm ạ?`;
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

  if (!isPriceExtremeQuery(userText)) return null;

  const { mostExpensive, cheapest } = getPriceExtremes(options);
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

function isCommercialPolicyQuestion(userText, intent) {
  const raw = String(userText || '');
  const normalized = normalize(raw);
  return intent === 'warranty'
    || /\b(full vat|vat|hoa don|xuat hoa don|xuat vat|bao hanh|doi tra|chinh sach|bao loi|loi san pham|warranty|return policy|invoice)\b/i.test(normalized)
    || /(保修|退换|发票|發票|增值税|政策)/.test(raw);
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

function buildPolicyRuleReply(userText, lang, scopeBrand = '') {
  const normalized = normalize(userText);
  const scope = normalize(scopeBrand);
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

  return null;
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
    const base = `KingCom tìm thấy sản phẩm phù hợp: ${p.name || p.title} (SKU: ${p.sku || 'N/A'}), giá ${formatPrice(p.price || 'liên hệ')}.${url ? `\nLink xem sản phẩm: ${url}` : ''}\nAnh/chị muốn mình tư vấn thêm mẫu nào ạ?`;
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

function buildSearchQuery(userText, history, customer) {
  const currentWords = queryWords(userText);
  const expandedTerms = expandMultilingualSearchTerms(userText);
  const recentCustomer = (history || [])
    .filter(m => m.sender_type === 'customer')
    .slice(-4)
    .map(m => m.text)
    .join(' ');
  const interests = customer?.interested_products || '';
  if (isFollowUpLinkRequest(userText) || isProductGuidanceQuery(userText) || currentWords.length === 0) {
    return `${userText} ${expandedTerms} ${recentCustomer} ${interests}`.trim();
  }
  return `${userText} ${expandedTerms}`.trim();
}

function hasSpecificProductQuery(userText, intent) {
  if (!['buy', 'price', 'product_search', 'order'].includes(intent)) return false;
  if (isFollowUpLinkRequest(userText)) return false;
  const words = queryWords(userText);
  if (!words.length) return false;
  return words.some(w => w.length >= 3 || /[a-z]+\d|\d+[a-z]+/i.test(w));
}

function productQueryLabel(userText) {
  const words = queryWords(userText)
    .filter(w => w.length >= 2)
    .slice(0, 4);
  return words.join(' ')
    .replace(/\bden\b/g, 'đèn')
    .replace(/\bmic\b/g, 'micro')
    .trim();
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

function buildLocalizedRuleReply(intent, userText, lang, scopeBrand = '') {
  const scope = String(scopeBrand || '').trim();
  if (lang === 'en') {
    if (intent === 'store_info') {
      return 'KingCom store address is 65 Nguyen Minh Hoang, Bay Hien Ward, Ho Chi Minh City. What product can I help you with?';
    }
    if (intent === 'catalog_info') {
      if (scope) return `This page supports ${scope} products. Please tell me the product type or model you are looking for so I can suggest matching ${scope} products.`;
      return 'KingCom carries photography, filming, and content creation accessories such as gimbals, microphones, lights, filters, tripods, monitors, and livestream equipment. Which product group are you interested in?';
    }
    if (intent === 'unsupported') {
      return 'KingCom currently does not sell laptops or ThinkPads. We focus on photography, filming, and content creation accessories such as gimbals, microphones, lights, filters, and tripods. Which product group would you like help with?';
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
      return '目前 KingCom 暂未销售笔记本电脑或 ThinkPad。我们主要销售摄影、拍摄和内容创作相关配件，例如稳定器、麦克风、灯具、滤镜和三脚架。您想咨询哪一类产品？';
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
  sourceGroup = ''
}) {
  const messageLanguage = detectMessageLanguage(userText);
  const guidanceQuestion = isProductGuidanceQuery(userText);
  const policyQuestion = isCommercialPolicyQuestion(userText, intent);
  const sourceConfig = readSourceConfig(sourceKey);
  const scopeBrand = String(sourceConfig.brand || '').trim();
  const customerBrand = resolveCustomerBrand({ sourceKey, sourceName, sourceGroup });
  const scopedProducts = loadProducts({ sourceKey });
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

  const policyRuleReply = buildPolicyRuleReply(userText, messageLanguage, scopeBrand);
  if (policyRuleReply) {
    return {
      reply: policyRuleReply,
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_policy',
      ragProducts: []
    };
  }

  const localizedRuleReply = buildLocalizedRuleReply(intent, userText, messageLanguage, scopeBrand);
  if (localizedRuleReply) {
    return {
      reply: localizedRuleReply,
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule',
      ragProducts: []
    };
  }

  if (intent === 'store_info') {
    return {
      reply: 'Dạ địa chỉ cửa hàng KingCom là 65 Nguyễn Minh Hoàng, phường Bảy Hiền, TP. Hồ Chí Minh ạ. Anh/chị cần em hỗ trợ thêm sản phẩm nào không?',
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule',
      ragProducts: []
    };
  }

  if (intent === 'unsupported') {
    return {
      reply: 'Dạ hiện KingCom chưa kinh doanh laptop/ThinkPad ạ. Bên em chuyên phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung như gimbal, micro, đèn, filter, tripod... Anh/chị cần em tư vấn nhóm sản phẩm nào ạ?',
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule',
      ragProducts: []
    };
  }

  const directPriceReply = buildDirectPriceReply(userText, { sourceKey });
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

Ý định: ${intent}
${intent === 'human' ? 'Khách yêu cầu gặp nhân viên.' : 'Khách đang chào hỏi.'}

Quy tắc giọng nói:
- Không tự xưng là AI, bot, trợ lý ảo, hệ thống tự động.
- Xưng "em" hoặc "${customerBrand}", gọi khách là "anh/chị" khi phù hợp.
- Chỉ dùng tên thương hiệu "${customerBrand}" khi nói với khách. Không tự nhận là thương hiệu khác.
- KingCom KHÔNG phải cửa hàng mỹ phẩm. Tuyệt đối không nói KingCom bán mỹ phẩm/làm đẹp.
- Khi giới thiệu KingCom, chỉ nói là cửa hàng phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung.
- Nếu không chắc thông tin, nói "em kiểm tra thêm" hoặc "em chuyển nhân viên phụ trách kiểm tra", không nói "AI không biết".

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

  const searchQuery = buildSearchQuery(userText, history, customer);
  const { context, products } = buildContext(searchQuery, {
    sourceKey,
    topK: policyQuestion ? 0 : (guidanceQuestion ? 1 : 8),
    requireIdentityMatch: !isStartingPriceQuery(userText)
      && (isAvailabilityQuestion(userText) || isShortSpecificFollowUp(userText))
  });
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
        webSearchRequests: webGuidance.webSearchRequests
      };
    }
    if (webGuidance.error) {
      console.warn('Product guidance web search skipped after error:', webGuidance.error);
    }
  }
  if (isPreviousAdviceComplaint(userText) && !guidanceQuestion && !policyQuestion) {
    return {
      reply: buildPreviousAdviceCorrectionReply(userText, products, scopeBrand),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_previous_advice_correction',
      searchQuery,
      ragProducts: products
    };
  }
  const budgetProductReply = (!guidanceQuestion && !policyQuestion && ['buy', 'price', 'product_search', 'order'].includes(intent))
    ? buildBudgetProductReply(userText, products, scopeBrand)
    : null;
  if (budgetProductReply) {
    return {
      reply: budgetProductReply,
      aiUsed: 0,
      aiError: false,
      aiSource: 'direct_budget_lookup',
      searchQuery,
      ragProducts: products.slice(0, 3)
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
      ragProducts: products.slice(0, 3)
    };
  }
  if (!products.length && hasSpecificProductQuery(userText, intent) && !guidanceQuestion && !policyQuestion) {
    return {
      reply: buildNoCatalogMatchReply(userText, messageLanguage, scopeBrand),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_no_catalog_match',
      searchQuery,
      ragProducts: []
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
      ragProducts: products.slice(0, 1)
    };
  }
  if (scopeBrand && products.length && ['buy', 'price', 'product_search', 'order'].includes(intent) && !guidanceQuestion && !policyQuestion) {
    return {
      reply: buildScopedProductsReply(products, userText, scopeBrand),
      aiUsed: 0,
      aiError: false,
      aiSource: 'rule_scoped_products',
      searchQuery,
      ragProducts: products.slice(0, 3)
    };
  }
  const historyText = (history || []).slice(-8).map(m => `${m.sender_type}: ${m.text}`).join('\n');
  const languageInstruction = messageLanguage === 'en'
    ? 'Khach dang dung tieng Anh. Tra loi bang tieng Anh tu nhien, ngan gon. Khong chuyen sang tieng Viet tru khi khach doi ngon ngu.'
    : messageLanguage === 'zh'
      ? 'Khach dang dung tieng Trung Quoc. Tra loi bang tieng Trung Quoc gian the, ngan gon, tu nhien. Khong chuyen sang tieng Viet tru khi khach doi ngon ngu.'
      : 'Khach dang dung tieng Viet. Tra loi tieng Viet ngan gon, than thien, tu nhien.';
  const guardrailContext = [
    context,
    '',
    'Bat buoc tuan thu:',
    languageInstruction,
    '- Tra loi cung ngon ngu voi tin nhan moi nhat cua khach.',
    '- Chi nhac den san pham co trong muc "San pham lien quan"; khong tu them san pham khac.',
    '- Neu khach chi hoi mot model/san pham cu the, tra loi tap trung dung model do.',
    '- Khong khang dinh con hang/co san/in stock neu du lieu khong co ton kho; chi noi san pham co trong catalog va de nghi nhan vien kiem tra ton kho.',
    policyQuestion
      ? '- Khach dang hoi VAT/hoa don/bao hanh/doi tra/chinh sach. Chi tra loi theo FAQ va Chinh sach trong du lieu tham khao. Khong liet ke san pham moi, khong dinh link san pham, khong doi sang mau san pham khac. Neu can xac nhan theo model/don hang, noi da chuyen nhan vien KingCom kiem tra.'
      : '',
    guidanceQuestion
      ? '- Khach dang hoi cach su dung san pham. Hay huong dan tung buoc ngan gon, chi tap trung vao model khop nhat. Co the dung kien thuc san pham pho thong de huong dan, nhung khong bia chi tiet ky thuat, nut bam, cong ket noi, phu kien kem theo hoac tinh nang neu khong chac chan. Neu can, hoi them thiet bi khach dang dung hoac de nghi nhan vien KingCom xac nhan.'
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

Lịch sử gần đây:
${historyText}

Truy vấn dùng để tìm sản phẩm: ${searchQuery}

Dữ liệu tham khảo:
${guardrailContext}

Khách hỏi: ${userText}

Quy tắc:
- Không tự xưng là AI, bot, trợ lý ảo, chatbot, hệ thống tự động.
- Không nói kiểu "tôi là trợ lý ảo". Hãy xưng "em" hoặc "${customerBrand}", gọi khách là "anh/chị" khi phù hợp.
- Chỉ dùng tên thương hiệu "${customerBrand}" khi nói với khách. Không tự nhận là thương hiệu khác.
- Với website chat, nếu khách yêu cầu gặp nhân viên, không được nói "giao diện tự động" hoặc "không thể trao đổi trực tiếp". Hãy nói đã chuyển nhân viên và khách có thể tiếp tục nhắn tại khung chat này.
- KingCom KHÔNG phải cửa hàng mỹ phẩm. Tuyệt đối không nói KingCom bán mỹ phẩm/làm đẹp.
- Khi giới thiệu KingCom, chỉ nói là cửa hàng phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung.
- Luôn tôn trọng khách. Không cười khách, không mở đầu bằng "ha ha", "haha", "hihi", "hehe", "lol", không nói kiểu trêu chọc như "nhầm lẫn gì đây".
- Nếu khách hỏi sản phẩm KingCom không bán, trả lời lịch sự: "Dạ hiện KingCom chưa kinh doanh sản phẩm này..." rồi gợi ý nhóm sản phẩm phù hợp hoặc xin thông tin để nhân viên kiểm tra.
- Nếu không chắc thông tin, nói "em kiểm tra thêm" hoặc "em chuyển nhân viên phụ trách kiểm tra", không nói "AI không biết/không có dữ liệu".
- Nếu khách hỏi ngắn kiểu "gửi link", "kèm link", "link mua", hãy hiểu là họ đang hỏi tiếp về sản phẩm đã nhắc gần nhất trong lịch sử, không được đổi sang sản phẩm khác.
- Nếu khách hỏi VAT/hóa đơn/bảo hành/đổi trả/chính sách, chỉ trả lời chính sách theo dữ liệu tham khảo; không liệt kê sản phẩm mới và không tự gắn link sản phẩm.
- Chỉ dùng dữ liệu tham khảo nếu nói giá/sản phẩm.
- Nếu có phạm vi fanpage, chỉ tư vấn sản phẩm thuộc phạm vi đó. Không giới thiệu sản phẩm từ thương hiệu khác.
- Khi tư vấn hoặc liệt kê sản phẩm, bắt buộc đính kèm link sản phẩm trực tiếp từ trường Link/url trong dữ liệu tham khảo để khách bấm xem.
- Nếu có nhiều sản phẩm phù hợp, liệt kê tối đa 3-5 sản phẩm, mỗi sản phẩm gồm: tên, giá, link xem sản phẩm.
- Nếu khách hỏi địa chỉ cửa hàng, cho địa chỉ: 65 Nguyễn Minh Hoàng, phường Bảy Hiền, thành phố Hồ Chí Minh, Việt Nam.
- Nếu không chắc, xin số điện thoại hoặc đề nghị nhân viên tư vấn.
- Nếu khách muốn mua/chốt/gặp người thật, hỏi số điện thoại và chuyển nhân viên.
- Không bịa link, tồn kho, bảo hành cụ thể hoặc khuyến mãi nếu dữ liệu không có.`;

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
        reply: guidanceQuestion ? buildProductGuidanceFallbackReply(products, messageLanguage) : fallbackReply(intent, userText, products),
        aiUsed: 1,
        aiError: false,
        aiSource: 'guardrail_fallback',
        searchQuery,
        ragProducts: products
      };
    }
    return {
      reply: policyQuestion ? reply : ensureProductLinks(reply, products),
      aiUsed: 1,
      aiError: false,
      aiSource: 'provider',
      searchQuery,
      ragProducts: policyQuestion ? [] : products
    };
  } catch (e) {
    console.error('OpenAI async error:', e.message);
    return {
      reply: guidanceQuestion ? buildProductGuidanceFallbackReply(products, messageLanguage) : fallbackReply(intent, userText, products),
      aiUsed: 0,
      aiError: true,
      aiErrorMessage: e.message,
      aiSource: 'fallback',
      searchQuery,
      ragProducts: policyQuestion ? [] : products
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

async function summarizeConversation({ messages, customer, language = 'vi' }) {
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
    return fallbackSummary(messages, customer);
  }
}

function summarizeConversationFast({ messages, customer }) {
  return fallbackSummary(messages, customer);
}

module.exports = { generateReply, summarizeConversation, summarizeConversationFast, detectMessageLanguage, extractContactInfo };
