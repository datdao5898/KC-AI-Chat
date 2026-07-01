const {
  extractExactPrice,
  extractMaxPrice,
  extractProductPageUrls,
  loadProducts,
  normalize,
  parsePriceNumber,
  productSlugFromUrl,
  queryWords,
  searchProducts
} = require('./rag');
const { readSourceConfig } = require('./sourceRegistry');

const CATEGORY_RULES = [
  ['gimbal', /\b(chong rung|khong bi rung|giam rung|giu on dinh|quay on dinh|gimbal|stabilizer)\b/i],
  ['tripod', /\b(tripod|chan may|chan chup|chan den|gay selfie|phoi sang|ulanzi mt[- ]?\d+)\b/i],
  ['headphones', /\b(tai nghe|headphone|headphones|headset)\b/i],
  ['webcam', /\b(webcam|hop online|goi video|video call)\b/i],
  ['microphone', /\b(micro|mic|microphone|thu am|ghi am|loc tap am|maono|fifine|boya|comica|synco)\b/i],
  ['light', /\b(den quay|den chup|den led|den livestream|ring light|tube light|bo sung anh sang|nanlite|colbor)\b/i],
  ['lens', /\b(lens|ong kinh|chup phong canh|chup chan dung|xoa phong|viltrox)\b/i],
  ['filter', /\b(filter|kinh loc|nd filter|cpl)\b/i],
  ['monitor', /\b(man hinh phu|monitor|man hinh selfie)\b/i],
  ['bag', /\b(balo|backpack|tui may anh|tui dung)\b/i],
  ['livestream', /\b(livestream|live stream|thiet bi live|ban hang online|phat song truc tiep|quay phat truc tiep|video switcher|switcher|capture card|console pad|livepro)\b/i]
];

const USE_CASE_RULES = [
  ['livestream', /\b(livestream|live stream|phat song|ban hang online|tiktok live|facebook live)\b/i],
  ['gaming', /\b(gaming|game|stream game)\b/i],
  ['podcast', /\b(podcast|thu podcast|talk show)\b/i],
  ['recording', /\b(thu am|ghi am|voice over|voiceover|loc tap am)\b/i],
  ['video editing', /\b(edit video|dung video|lam video|quay video)\b/i],
  ['vlog', /\b(vlog|vlogger|youtube|content creator|sang tao noi dung)\b/i],
  ['landscape photography', /\b(phong canh|landscape|goc rong|wide angle|kien truc|thien van)\b/i],
  ['portrait photography', /\b(chan dung|portrait|xoa phong|bokeh)\b/i],
  ['product photography', /\b(chup san pham|product photography|studio)\b/i],
  ['meeting', /\b(hop online|zoom|google meet|teams|video call)\b/i],
  ['travel', /\b(du lich|di choi|ngoai troi|outdoor|travel)\b/i]
];

const COMPATIBILITY_RULES = [
  ['laptop', /\b(laptop|may tinh|pc|windows|win|macbook|mac)\b/i],
  ['iphone', /\b(iphone|ios|lightning|magsafe)\b/i],
  ['android', /\b(android|type c|type-c|usb c|usb-c)\b/i],
  ['phone', /\b(dien thoai|smartphone|mobile phone|phone)\b/i],
  ['camera', /\b(camera|may anh|dslr|mirrorless)\b/i],
  ['sony', /\b(sony|e mount|e-mount)\b/i],
  ['canon', /\b(canon|rf mount|ef mount|eos)\b/i],
  ['nikon', /\b(nikon|z mount|z-mount)\b/i],
  ['fujifilm', /\b(fuji|fujifilm|xf mount|x mount|x-mount)\b/i],
  ['panasonic', /\b(panasonic|lumix|l mount|l-mount)\b/i],
  ['dji', /\b(dji|osmo|ronin|rs3|rs4)\b/i]
];

const POLICY_RULES = [
  ['vat', /\b(full vat|vat|da bao gom vat|bao gom vat|xuat vat)\b/i],
  ['invoice', /\b(hoa don|xuat hoa don|invoice|bill)\b/i],
  ['warranty', /\b(bao hanh|warranty|bao loi|loi san pham)\b/i],
  ['return_exchange', /\b(doi tra|tra hang|doi hang|return policy|refund|exchange)\b/i],
  ['shipping', /\b(giao hang|van chuyen|ship|shipping|phi ship|thoi gian giao)\b/i],
  ['store_info', /\b(dia chi|cua hang o dau|chi nhanh|hotline|lien he)\b/i]
];

const PRODUCT_IDENTITY_STOPWORDS = new Set([
  'anh', 'chi', 'em', 'minh', 'toi', 'ban', 'shop', 'ben', 'co', 'khong',
  'can', 'muon', 'mua', 'tim', 'hieu', 'tu', 'van', 'giup', 'cho', 'hoi',
  'san', 'pham', 'sp', 'mau', 'model', 'loai', 'dong', 'hang',
  'gia', 'bao', 'nhieu', 'duoi', 'tren', 'toi', 'da', 'max',
  'dung', 'duoc', 'voi', 'cho', 'danh', 'ket', 'noi', 'tuong', 'thich',
  'laptop', 'may', 'tinh', 'pc', 'windows', 'mac', 'iphone', 'android',
  'dien', 'thoai', 'camera', 'may', 'anh'
]);

function compactList(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeExistingContext(value) {
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

function amountToNumber(value, unit = '') {
  const number = Number(String(value || '').replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) return null;
  const normalizedUnit = normalize(unit);
  if (['trieu', 'tr', 'm'].includes(normalizedUnit)) return Math.round(number * 1000000);
  if (['k', 'nghin', 'ngan'].includes(normalizedUnit)) return Math.round(number * 1000);
  return number > 10000 ? Math.round(number) : Math.round(number * 1000000);
}

function extractBudget(text = '') {
  const normalized = normalize(text);
  const budget = {
    min: null,
    max: extractMaxPrice(text) || null,
    exact: extractExactPrice(text) || null,
    currency: 'VND'
  };

  const range = normalized.match(/\b(?:tu|khoang)\s*(\d+(?:[\.,]\d+)?)\s*(trieu|tr|m|k|nghin|ngan)?\s*(?:den|toi|-)\s*(\d+(?:[\.,]\d+)?)\s*(trieu|tr|m|k|nghin|ngan)?\b/i);
  if (range) {
    const min = amountToNumber(range[1], range[2] || range[4]);
    const max = amountToNumber(range[3], range[4] || range[2]);
    if (min) budget.min = min;
    if (max) budget.max = max;
  }

  const minMatch = normalized.match(/\b(?:tren|hon|tu|toi thieu|it nhat)\s*(\d+(?:[\.,]\d+)?)\s*(trieu|tr|m|k|nghin|ngan)?\b/i);
  if (minMatch && !budget.min) budget.min = amountToNumber(minMatch[1], minMatch[2]);

  return (budget.min || budget.max || budget.exact) ? budget : null;
}

function inferCategory(text = '') {
  const normalized = normalize(text);
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(normalized))?.[0] || '';
}

function extractPolicyQuestion(text = '') {
  const normalized = normalize(text);
  return POLICY_RULES.find(([, pattern]) => pattern.test(normalized))?.[0] || '';
}

function extractUseCases(text = '') {
  const normalized = normalize(text);
  return compactList(USE_CASE_RULES
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([label]) => label));
}

function extractCompatibilityTargets(text = '') {
  const normalized = normalize(text);
  const targets = compactList(COMPATIBILITY_RULES
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([label]) => label));
  if (targets.includes('iphone') || targets.includes('android')) {
    targets.push('phone');
  }
  return compactList(targets);
}

function knownBrands(sourceKey = '') {
  const configBrand = readSourceConfig(sourceKey).brand || '';
  const productBrands = loadProducts({ sourceKey })
    .map(product => product.vendor || product.brand || '')
    .filter(Boolean);
  return compactList([configBrand, ...productBrands])
    .map(brand => String(brand || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function extractExplicitBrand(text = '', sourceKey = '') {
  const normalized = ` ${normalize(text)} `;
  for (const brand of knownBrands(sourceKey)) {
    const normalizedBrand = normalize(brand);
    if (!normalizedBrand) continue;
    if (normalized.includes(` ${normalizedBrand} `)) return brand;
  }
  return '';
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isBrandOnlyRequest(text = '', brand = '') {
  if (!brand) return false;
  const normalizedBrand = normalize(brand);
  if (!normalizedBrand) return false;
  const remainingWords = normalize(text)
    .replace(new RegExp(`\\b${escapeRegExp(normalizedBrand)}\\b`, 'gi'), ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => !PRODUCT_IDENTITY_STOPWORDS.has(word));
  return remainingWords.length === 0;
}

function codeLikeWords(text = '') {
  return queryWords(text)
    .filter(word => /[a-z]+\d|\d+[a-z]+/i.test(word))
    .filter(word => !/^\d+(?:k|m|tr|trieu|nghin|ngan)$/i.test(word));
}

function productIdentityWords(text = '') {
  return queryWords(text)
    .filter(word => word.length >= 2)
    .filter(word => !PRODUCT_IDENTITY_STOPWORDS.has(word));
}

function shouldLookupProduct(text = '', sourceKey = '') {
  if (extractProductPageUrls(text).length) return true;
  if (codeLikeWords(text).length) return true;
  const explicitBrand = extractExplicitBrand(text, sourceKey);
  const identity = productIdentityWords(text);
  return Boolean(explicitBrand && identity.length >= 2);
}

function productFromUrl(text = '') {
  const url = extractProductPageUrls(text)[0] || '';
  if (!url) return '';
  return productSlugFromUrl(url) || url;
}

function parseCustomerMessage(text = '', options = {}) {
  const sourceKey = options.sourceKey || '';
  const existingContext = normalizeExistingContext(options.existingContext);
  const sourceConfig = readSourceConfig(sourceKey);
  const explicitBrand = extractExplicitBrand(text, sourceKey);
  const brandOnlyRequest = isBrandOnlyRequest(text, explicitBrand);
  const currentCategory = brandOnlyRequest ? '' : inferCategory(text);
  const budget = extractBudget(text);
  const policyQuestion = extractPolicyQuestion(text);
  const useCases = extractUseCases(text);
  const compatibilityTargets = extractCompatibilityTargets(text);
  const matchedProducts = !brandOnlyRequest && shouldLookupProduct(text, sourceKey)
    ? searchProducts(text, 3, { sourceKey, requireIdentityMatch: true })
    : [];
  const product = matchedProducts[0] || null;
  const productName = product?.name || product?.title || '';
  const productBrand = product?.vendor || product?.brand || '';
  const productCategory = productName ? inferCategory(`${productName} ${product.tags || ''} ${product.description || ''}`) : '';
  const category = currentCategory
    || productCategory
    || existingContext.requested_category
    || '';
  const brand = explicitBrand
    || productBrand
    || sourceConfig.brand
    || '';

  return {
    product: productName || productFromUrl(text) || '',
    product_sku: product?.sku || '',
    product_url: product?.url || product?.link || product?.product_url || '',
    brand,
    category,
    budget,
    use_case: useCases.join(', '),
    compatibility_target: compatibilityTargets.join(', '),
    policy_question: policyQuestion,
    confidence: product ? Number(Math.min(0.95, Math.max(0.55, Number(product.score || 0) / 60)).toFixed(2)) : 0,
    signals: {
      category_source: currentCategory ? 'message' : (productCategory ? 'product' : (existingContext.requested_category ? 'context' : '')),
      brand_source: explicitBrand ? 'message' : (productBrand ? 'product' : (sourceConfig.brand ? 'source' : '')),
      has_product_url: extractProductPageUrls(text).length > 0,
      code_words: codeLikeWords(text),
      brand_only: brandOnlyRequest
    }
  };
}

function structuredMessageSearchText(parsed = {}) {
  if (!parsed || typeof parsed !== 'object') return '';
  const budgetParts = parsed.budget
    ? [
        parsed.budget.min ? `gia tu ${parsed.budget.min}` : '',
        parsed.budget.max ? `gia duoi ${parsed.budget.max}` : '',
        parsed.budget.exact ? `gia ${parsed.budget.exact}` : ''
      ]
    : [];
  return [
    parsed.product,
    parsed.product_sku,
    parsed.brand,
    parsed.category,
    parsed.use_case,
    parsed.compatibility_target,
    ...budgetParts
  ].filter(Boolean).join(' ').trim();
}

module.exports = {
  parseCustomerMessage,
  structuredMessageSearchText,
  extractBudget,
  inferCategory,
  extractPolicyQuestion,
  extractUseCases,
  extractCompatibilityTargets,
  isBrandOnlyRequest
};
