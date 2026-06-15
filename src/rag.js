const fs = require('fs');
const path = require('path');
const {
  DATA_DIR,
  SOURCES_DIR,
  getSourceCandidates,
  readFirstExistingText,
  readSourceConfig
} = require('./sourceRegistry');

const STOPWORDS = new Set([
  'anh', 'chi', 'em', 'ban', 'minh', 'toi', 'cho', 'can', 'tim', 'mua', 'gia', 'bao', 'nhieu',
  'duoi', 'tren', 'san', 'pham', 'hang', 'link', 'gui', 'kem', 'xem', 'tham', 'khao', 'muon', 'tu',
  'van', 'giup', 'voi', 'co', 'khong', 'nay', 'do', 'la', 'cai', 'mot', 'cac', 'va', 'hoac', 'chiec',
  'sp', 'shop', 'kingcom', 'hien', 'tai', 'trong', 'he', 'thong', 'du', 'lieu', 'chua', 'khop',
  'chinh', 'xac', 'model', 'ma', 'thi', 'sao', 'vay',
  'please', 'pls', 'i', 'im', 'i-m', 'am', 'looking', 'look', 'for', 'need', 'want', 'to', 'buy',
  'one', 'a', 'an', 'the', 'of', 'with', 'me', 'my', 'your', 'you'
]);

const IDENTITY_STOPWORDS = new Set([
  ...STOPWORDS,
  'dang', 'ban', 'gi', 'nao', 'mau', 'loai', 'dong', 'hang', 'con', 'stock', 'thi', 'sao',
  'den', 'led', 'light', 'ring', 'rgb', 'tube', 'video', 'fill',
  'mic', 'micro', 'microphone', 'thu', 'am',
  'tripod', 'chan', 'may', 'gia', 'do',
  'lens', 'ong', 'kinh', 'camera', 'filter', 'gimbal', 'tui', 'bag'
]);

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = String(text || '');

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      if (row.some(value => String(value || '').trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  row.push(cell);
  if (row.some(value => String(value || '').trim() !== '')) rows.push(row);
  return rows;
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAccent(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}0-9\s\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryWords(query) {
  return normalize(query)
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

function accentQueryWords(query) {
  return normalizeAccent(query)
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(normalize(w)));
}

function hasAccentWord(text, word) {
  return new RegExp(`(^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i').test(text);
}

function hasAnyWord(text, words) {
  return words.some(word => hasAccentWord(text, word));
}

function isTrueLightProduct({ nameNorm, nameAccent }) {
  const accessoryName = /\b(tai nghe|headphone|headset|microphone|micro|mic|audio interface|adapter|tui|bag|case|pin|battery|cap|cable|sac|charger|chan den|light stand|stand|diffuser|softbox|op tan sang|tan sang)\b/i.test(nameNorm);
  const explicitLightName = /\b(led light|video light|fill light|ring light|tube light|panel light|den led)\b/i.test(nameNorm)
    || hasAccentWord(nameAccent, 'đèn');
  return explicitLightName && (!accessoryName || /\b(led light|video light|fill light|ring light|tube light|panel light)\b/i.test(nameNorm));
}

function isLensAccessory({ nameNorm, nameAccent }) {
  return /\b(adapter|mount adapter|cleaning|kit|cap|hood|filter|bag|case|converter|support|holder|cloth|wrap|protector|cover)\b/i.test(nameNorm)
    || /\b(khan|bao ve|nap|gia do|thanh ho tro|tui dung|lam sach|thoi khi|chuyen doi)\b/i.test(nameNorm)
    || hasAnyWord(nameAccent, ['ngàm', 'ngoàm']);
}

function isTrueLensProduct({ nameNorm, nameAccent }) {
  const looksLens = /\blens\b/i.test(nameNorm)
    || nameNorm.includes('ong kinh')
    || nameAccent.includes('ống kính');
  return looksLens && !isLensAccessory({ nameNorm, nameAccent });
}

function isMobileOrActionLensProduct({ nameNorm, descNorm = '' }) {
  const text = `${nameNorm} ${descNorm}`;
  return /\b(smartphone|dien thoai|iphone|android|osmo pocket|dji pocket|action camera)\b/i.test(text);
}

function isLandscapeLensCandidate({ nameNorm, descNorm = '' }) {
  const text = `${nameNorm} ${descNorm}`;
  return /\b(phong canh|landscape|goc rong|wide angle|ultra wide|sieu rong|kien truc|thien van|cityscape)\b/i.test(text)
    || /\b(?:9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28|30|32|35)\s*mm\b/i.test(nameNorm);
}

function parsePriceNumber(v) {
  const n = Number(String(v || '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function extractMaxPrice(query) {
  const norm = normalize(query);
  const m1 = norm.match(/(?:duoi|toi da|max|nho hon|be hon)\s*(\d+(?:[\.,]\d+)?)\s*(trieu|tr|m|k|nghin|ngan)?/);
  const m2 = norm.match(/(\d+(?:[\.,]\d+)?)\s*(trieu|tr|m|k|nghin|ngan)\s*(?:tro xuong|do lai|do ve|quay dau)/);
  const m = m1 || m2;
  if (!m) return null;
  const val = Number(m[1].replace(',', '.'));
  const unit = m[2] || '';
  if (['trieu', 'tr', 'm'].includes(unit)) return Math.round(val * 1000000);
  if (['k', 'nghin', 'ngan'].includes(unit)) return Math.round(val * 1000);
  return val > 10000 ? Math.round(val) : Math.round(val * 1000000);
}

function fileRows(file) {
  if (!fs.existsSync(file)) return [];
  const rows = parseCsvText(fs.readFileSync(file, 'utf8'));
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(vals => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
}

function dedupeProducts(products) {
  const seen = new Set();
  const out = [];
  for (const p of products) {
    const key = normalize([p.sku, p.url || p.link || p.product_url || '', p.name || p.title || ''].join('|'));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

let knownProductBrandsCache = null;

function getKnownProductBrands() {
  if (knownProductBrandsCache) return knownProductBrandsCache;
  const legacyFile = path.join(DATA_DIR, 'products.csv');
  knownProductBrandsCache = [...new Set(
    fileRows(legacyFile)
      .map(p => normalize(p.vendor || p.brand || ''))
      .filter(Boolean)
  )];
  return knownProductBrandsCache;
}

function isScopedFacebookSource(sourceKey) {
  return /^facebook\/(?!default$)[a-z0-9-]+$/i.test(String(sourceKey || '').trim());
}

function loadProducts(options = {}) {
  const sourceKey = options.sourceKey || '';
  if (isScopedFacebookSource(sourceKey)) {
    const file = path.join(SOURCES_DIR, ...String(sourceKey).split('/'), 'products.csv');
    return fs.existsSync(file) ? dedupeProducts(fileRows(file)) : [];
  }

  const candidates = getSourceCandidates(sourceKey);
  const products = [];

  for (const candidate of candidates) {
    const file = candidate === 'common'
      ? path.join(SOURCES_DIR, 'common', 'products.csv')
      : candidate
        ? path.join(SOURCES_DIR, ...candidate.split('/'), 'products.csv')
        : '';
    if (!file) continue;
    const rows = fileRows(file);
    if (rows.length) {
      products.push(...rows);
      return dedupeProducts(products);
    }
  }

  const legacyFile = path.join(DATA_DIR, 'products.csv');
  if (fs.existsSync(legacyFile)) {
    products.push(...fileRows(legacyFile));
  }
  return dedupeProducts(products);
}

function productsWithPrice(options = {}) {
  return loadProducts(options)
    .map(p => ({ ...p, _price: parsePriceNumber(p.price || p.compare_at_price || p.gia || '') }))
    .filter(p => p._price > 0);
}

function getPriceExtremes(options = {}) {
  const products = productsWithPrice(options).sort((a, b) => b._price - a._price);
  return {
    mostExpensive: products[0] || null,
    cheapest: [...products].sort((a, b) => a._price - b._price)[0] || null
  };
}

function isPriceExtremeQuery(query) {
  const norm = normalize(query);
  return /((mac|dat|cao|re|thap).{0,20}nhat|gia cao nhat|gia thap nhat)/i.test(norm);
}

function requestedPriceExtremes(query) {
  const norm = normalize(query);
  const expensive = /((mac|dat|cao).{0,20}nhat|gia cao nhat)/i.test(norm);
  const cheap = /((re|thap).{0,20}nhat|gia thap nhat)/i.test(norm);
  return { expensive, cheap };
}

function extractExactPrice(query) {
  const matches = String(query || '').match(/\d{1,3}(?:[.,]\d{3})+|\d{5,}/g) || [];
  const prices = matches.map(v => parsePriceNumber(v)).filter(v => v >= 10000);
  return prices[0] || null;
}

function canonicalProductUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return `${url.hostname.toLowerCase()}${url.pathname.toLowerCase().replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

function findProductsByExactPrice(query, limit = 5, options = {}) {
  const price = extractExactPrice(query);
  if (!price) return [];
  return productsWithPrice(options)
    .filter(p => p._price === price)
    .slice(0, limit);
}

function searchProducts(query, topK = 8, options = {}) {
  const products = loadProducts(options);
  const words = queryWords(query);
  const accentedWords = accentQueryWords(query);
  const normQuery = normalize(query);
  const accentQuery = normalizeAccent(query);
  const identityWords = options.requireIdentityMatch
    ? words.filter(w => w.length >= 3 && !IDENTITY_STOPWORDS.has(w))
    : [];
  const scopeBrand = normalize(readSourceConfig(options.sourceKey || '').brand || '');
  const mentionedBrands = getKnownProductBrands().filter(brand => ` ${normQuery} `.includes(` ${brand} `));
  const requestedProductUrls = (String(query || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [])
    .map(canonicalProductUrl)
    .filter(url => /\/products?\//i.test(url));
  if (scopeBrand && mentionedBrands.some(brand => brand !== scopeBrand)) return [];
  const maxPrice = extractMaxPrice(query);
  const codeWords = words.filter(w => {
    if (!(w.length >= 4 && /[a-z]/.test(w) && /\d/.test(w))) return false;
    return !/^\d+(?:k|m|tr|trieu|nghin|ngan)$/i.test(w);
  });
  const wantsTripod = /\b(tripod|chan may|chan den|gia do)\b/i.test(normQuery);
  const wantsMicrophone = /\b(mic|micro|microphone|thu am|maono|fifine|boya|comica|synco)\b/i.test(normQuery);
  const wantsPhone = /\b(mobile|phone|smartphone|cellphone|iphone|android|dien thoai)\b/i.test(normQuery);
  const accentLight = hasAccentWord(accentQuery, 'đèn');
  const asciiLight = /\b(den|led|light|ring light|rgb|tube light)\b/i.test(normQuery);
  const colorBlackOnly = hasAccentWord(accentQuery, 'đen') && !accentLight && !/\b(led|light|ring light|rgb|tube light)\b/i.test(normQuery);
  const wantsLight = (accentLight || asciiLight)
    && !colorBlackOnly
    && !/\b(chan den|chan may)\b/i.test(normQuery);
  const wantsAdapter = /\b(adapter|mount adapter|ngam|ngoam)\b/i.test(normQuery)
    || hasAnyWord(accentQuery, ['ngàm', 'ngoàm']);
  const wantsLens = (/\b(lens|ong kinh)\b/i.test(normQuery) || /\bống kính\b/i.test(accentQuery)) && !wantsAdapter;
  const wantsPortraitLens = wantsLens && /\b(chan dung|portrait|xoa phong|bokeh)\b/i.test(normQuery);
  const wantsLandscapeLens = wantsLens && /\b(phong canh|landscape|goc rong|wide angle|sieu rong|kien truc|thien van)\b/i.test(normQuery);
  const wantsMobileOrActionLens = wantsPhone || /\b(osmo|dji pocket|action camera)\b/i.test(normQuery);
  if (!words.length) return [];

  const scored = [];
  for (const p of products) {
    const price = parsePriceNumber(p.price || p.compare_at_price || p.gia || '');
    if (maxPrice && price && price > maxPrice) continue;

    const name = normalize(p.name || p.title || '');
    const nameAccent = normalizeAccent(p.name || p.title || '');
    const sku = normalize(p.sku || '');
    const vendor = normalize(p.vendor || p.brand || '');
    const rawProductUrl = p.url || p.link || p.product_url || '';
    const productUrl = normalize(rawProductUrl);
    const canonicalUrl = canonicalProductUrl(rawProductUrl);
    const desc = normalize(`${p.description || ''} ${p.tags || ''}`);
    const descAccent = normalizeAccent(`${p.description || ''} ${p.tags || ''}`);
    const haystack = `${name} ${desc}`;
    const identityText = `${name} ${sku} ${vendor} ${normalize(p.url || p.link || p.product_url || '')}`;
    const productShape = { nameNorm: name, nameAccent, descNorm: desc };

    if (requestedProductUrls.length && !requestedProductUrls.includes(canonicalUrl)) continue;
    if (identityWords.length && !identityWords.some(w => identityText.includes(w))) continue;
    if (wantsTripod && !/(tripod|chan may|chan den|gia do)/i.test(haystack)) continue;
    if (wantsLight && !isTrueLightProduct(productShape)) continue;
    if (wantsLens && !isTrueLensProduct(productShape)) continue;
    if (wantsLens && !wantsMobileOrActionLens && isMobileOrActionLensProduct(productShape)) continue;
    if (wantsLandscapeLens && !isLandscapeLensCandidate(productShape)) continue;
    if (wantsAdapter && !isLensAccessory(productShape)) continue;
    if (wantsMicrophone) {
      const microphoneText = `${name} ${vendor} ${desc}`;
      const nameVendorText = `${name} ${vendor}`;
      const nameLooksAccessory = /\b(hdmi|cable|cap|adapter|dau chuyen|mount adapter|usb hub|the nho|memory card)\b/i.test(nameVendorText)
        && !/\b(thu am|maono|fifine|boya|comica|synco|xlr|condenser|dynamic|lavalier|wireless)\b/i.test(nameVendorText);
      if (nameLooksAccessory) continue;
      const audioMic = /(\bmic\b|\bmicrophone\b|\bthu am\b|\bmaono\b|\bfifine\b|\bboya\b|\bcomica\b|\bsynco\b|\bxlr\b|\bcondenser\b|\bdynamic\b|\blavalier\b|\bwireless\b)/i.test(microphoneText);
      const connectorOnly = /\b(hdmi|cable|cap|adapter|dau chuyen|mount adapter|usb hub|the nho|memory card)\b/i.test(microphoneText)
        && !/\b(thu am|maono|fifine|boya|comica|synco|xlr|condenser|dynamic|lavalier|wireless)\b/i.test(microphoneText);
      if (!audioMic || connectorOnly) continue;
    }

    if (codeWords.length && !codeWords.some(w => sku.includes(w) || name.includes(w))) continue;

    let score = 0;
    let strongMatches = 0;
    if (requestedProductUrls.includes(canonicalUrl)) {
      score += 100;
      strongMatches += 1;
    }
    for (const w of words) {
      if (sku === w || sku.includes(w)) { score += 8; strongMatches++; }
      if (vendor === w) { score += 7; strongMatches++; }
      else if (vendor.includes(w)) { score += 4; strongMatches++; }
      if (name.includes(w)) { score += 5; strongMatches++; }
      if (productUrl.includes(w)) { score += 8; strongMatches++; }
      if (desc.includes(w)) score += 1;
    }
    for (const w of accentedWords) {
      if (normalize(w) === w) continue;
      if (hasAccentWord(nameAccent, w)) { score += 3; strongMatches++; }
      if (hasAccentWord(descAccent, w)) score += 1;
    }

    if (wantsTripod && /(tripod|chan may|chan den|gia do)/i.test(name)) score += 8;
    if (wantsMicrophone && /(mic|micro|microphone|thu am|maono|fifine|boya|comica|synco)/i.test(`${name} ${vendor}`)) score += 8;
    if (wantsLight && isTrueLightProduct(productShape)) score += 8;
    if (wantsLens && isTrueLensProduct(productShape)) score += 8;
    if (wantsPortraitLens && /\b(50|56|75|85)\s*mm\b/i.test(name)) score += 12;
    if (wantsPortraitLens && /\b(13|16|20|23|24)\s*mm\b/i.test(name)) score -= 6;
    if (wantsLandscapeLens && isLandscapeLensCandidate(productShape)) score += 12;
    if (wantsLandscapeLens && /\b(?:9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28)\s*mm\b/i.test(name)) score += 4;
    if (wantsAdapter && isLensAccessory(productShape)) score += 8;
    if (wantsPhone && /(mobile|phone|smartphone|cellphone|iphone|android|dien thoai)/i.test(haystack)) score += 6;
    if (wantsTripod && wantsPhone && /(tripod|chan may|chan den|gia do)/i.test(haystack) && /(mobile|phone|smartphone|cellphone|iphone|android|dien thoai)/i.test(haystack)) score += 10;

    if (score >= 4 && strongMatches > 0) scored.push({ ...p, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

function loadTextFile(name, options = {}) {
  const sourceKey = options.sourceKey || '';
  const sourceConfig = readSourceConfig(sourceKey);
  if (sourceConfig.strictProducts === true && name === 'catalog_summary.md') {
    const file = path.join(SOURCES_DIR, ...String(sourceKey).split('/'), name);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').slice(0, 4000) : '';
  }
  return readFirstExistingText(name, sourceKey, 4000);
}

function buildContext(query, options = {}) {
  const shouldSearchProducts = options.topK !== 0;
  const products = shouldSearchProducts ? searchProducts(query, options.topK || 8, options) : [];
  const includeDescriptions = options.includeDescriptions === true;
  const requestedDescriptionMaxChars = Number(options.descriptionMaxChars || 3500);
  const descriptionMaxChars = Number.isFinite(requestedDescriptionMaxChars)
    ? Math.max(200, requestedDescriptionMaxChars)
    : 3500;
  let ctx = '';

  if (!shouldSearchProducts) {
    ctx += 'Cau hoi dang can du lieu FAQ/chinh sach, khong can tra cuu san pham moi.\n';
  } else if (products.length) {
    ctx += 'San pham lien quan:\n';
    products.forEach((p, i) => {
      const price = p.price || p.compare_at_price || p.gia || '';
      const url = p.url || p.link || p.product_url || '';
      ctx += `${i + 1}. SKU: ${p.sku || 'N/A'} | Ten: ${p.name || p.title || 'N/A'} | Hang: ${p.vendor || p.brand || 'N/A'} | Gia: ${price || 'Lien he'} | Link: ${url || 'Chua co link'}\n`;
      if (includeDescriptions) {
        const description = String(p.description || p.content || p.details || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, descriptionMaxChars);
        if (description) ctx += `Mo ta va thong so tu catalog: ${description}\n`;
      }
    });
  } else {
    ctx += 'Khong tim thay san pham khop trong bo du lieu.\n';
  }

  const catalogSummary = loadTextFile('catalog_summary.md', options);
  const faq = loadTextFile('faq.md', options);
  const policies = loadTextFile('policies.md', options);
  if (catalogSummary) ctx += `\nTong quan danh muc:\n${catalogSummary}\n`;
  if (faq) ctx += `\nFAQ:\n${faq}\n`;
  if (policies) ctx += `\nChinh sach:\n${policies}\n`;

  return { context: ctx, products };
}

module.exports = {
  buildContext,
  searchProducts,
  loadProducts,
  loadTextFile,
  queryWords,
  normalize,
  extractMaxPrice,
  parsePriceNumber,
  getPriceExtremes,
  isPriceExtremeQuery,
  requestedPriceExtremes,
  extractExactPrice,
  findProductsByExactPrice,
  productsWithPrice
};
