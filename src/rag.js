const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

const STOPWORDS = new Set([
  'anh','chị','em','ban','bạn','minh','mình','toi','tôi','cho','can','cần','tim','tìm','mua','gia','giá','bao','nhieu','nhiêu','duoi','dưới','tren','trên','san','sản','pham','phẩm','hang','hàng','link','gui','gửi','kem','kèm','xem','tham','khao','khảo','muon','muốn','tu','tư','van','vấn','giup','giúp','voi','với','co','có','khong','không','nay','này','do','đó','la','là','cai','cái','mot','một','cac','các','va','và','hoac','hoặc','chiec','chiếc','sp','shop','kingcom','hien','hiện','tai','tại','trong','he','hệ','thong','thống','du','dữ','lieu','liệu','chua','chưa','khop','khớp','chinh','chính','xac','xác','model','ma','mã'
]);

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i=0;i<line.length;i++) {
    const ch = line[i];
    if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
    else if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur=''; }
    else cur += ch;
  }
  out.push(cur); return out;
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryWords(query) {
  return normalize(query)
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

function parsePriceNumber(v) {
  const n = Number(String(v || '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function productsWithPrice() {
  return loadProducts()
    .map(p => ({ ...p, _price: parsePriceNumber(p.price || p.compare_at_price || p.gia || '') }))
    .filter(p => p._price > 0);
}

function getPriceExtremes() {
  const products = productsWithPrice().sort((a, b) => b._price - a._price);
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
  const raw = String(query || '');
  const matches = raw.match(/\d{1,3}(?:[.,]\d{3})+|\d{5,}/g) || [];
  const prices = matches
    .map(v => parsePriceNumber(v))
    .filter(v => v >= 10000);
  return prices[0] || null;
}

function findProductsByExactPrice(query, limit = 5) {
  const price = extractExactPrice(query);
  if (!price) return [];
  return productsWithPrice()
    .filter(p => p._price === price)
    .slice(0, limit);
}

function extractMaxPrice(query) {
  const raw = String(query || '').toLowerCase();
  const norm = normalize(raw);
  const m1 = norm.match(/(?:duoi|toi da|max|nho hon|be hon)\s*(\d+(?:[\.,]\d+)?)\s*(trieu|tr|m|k|nghin|ngan)?/);
  const m2 = norm.match(/(\d+(?:[\.,]\d+)?)\s*(trieu|tr|m|k|nghin|ngan)\s*(?:tro xuong|do lai|do ve|quay dau)/);
  const m = m1 || m2;
  if (!m) return null;
  const val = Number(m[1].replace(',', '.'));
  const unit = m[2] || '';
  if (['trieu','tr','m'].includes(unit)) return Math.round(val * 1000000);
  if (['k','nghin','ngan'].includes(unit)) return Math.round(val * 1000);
  return val > 10000 ? Math.round(val) : Math.round(val * 1000000);
}

function loadProducts() {
  const file = path.join(DATA_DIR, 'products.csv');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line); const obj = {};
    headers.forEach((h,i) => obj[h] = vals[i] || '');
    return obj;
  });
}

function searchProducts(query, topK = 8) {
  const products = loadProducts();
  const words = queryWords(query);
  const maxPrice = extractMaxPrice(query);
  const codeWords = words.filter(w => w.length >= 4 && /[a-z]/.test(w) && /\d/.test(w));
  if (!words.length) return [];
  const scored = [];
  for (const p of products) {
    const price = parsePriceNumber(p.price || p.compare_at_price || p.gia || '');
    if (maxPrice && price && price > maxPrice) continue;
    const name = normalize(p.name || p.title || '');
    const sku = normalize(p.sku || '');
    const vendor = normalize(p.vendor || p.brand || '');
    const desc = normalize(`${p.description || ''} ${p.tags || ''}`);
    if (codeWords.length && !codeWords.some(w => sku.includes(w) || name.includes(w))) continue;
    let score = 0;
    let strongMatches = 0;
    for (const w of words) {
      if (sku === w || sku.includes(w)) { score += 8; strongMatches++; }
      if (vendor === w) { score += 7; strongMatches++; }
      else if (vendor.includes(w)) { score += 4; strongMatches++; }
      if (name.includes(w)) { score += 5; strongMatches++; }
      if (desc.includes(w)) score += 1;
    }
    // Chặn kết quả rác chỉ khớp mô tả/tag với từ quá chung.
    if (score >= 4 && strongMatches > 0) scored.push({ ...p, score });
  }
  return scored.sort((a,b) => b.score - a.score).slice(0, topK);
}

function loadTextFile(name) {
  const file = path.join(DATA_DIR, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').slice(0, 4000) : '';
}

function buildContext(query) {
  const products = searchProducts(query, 8);
  let ctx = '';
  if (products.length) {
    ctx += 'Sản phẩm liên quan:\n';
    products.forEach((p, i) => {
      const price = p.price || p.compare_at_price || p.gia || '';
      const url = p.url || p.link || p.product_url || '';
      ctx += `${i+1}. SKU: ${p.sku || 'N/A'} | Tên: ${p.name || p.title || 'N/A'} | Hãng: ${p.vendor || p.brand || 'N/A'} | Giá: ${price || 'Liên hệ'} | Link: ${url || 'Chưa có link'}\n`;
    });
  } else {
    ctx += 'Không tìm thấy sản phẩm khớp trong products.csv.\n';
  }
  const catalogSummary = loadTextFile('catalog_summary.md');
  const faq = loadTextFile('faq.md');
  const policies = loadTextFile('policies.md');
  if (catalogSummary) ctx += `\nTổng quan danh mục:\n${catalogSummary}\n`;
  if (faq) ctx += `\nFAQ:\n${faq}\n`;
  if (policies) ctx += `\nChính sách:\n${policies}\n`;
  return { context: ctx, products };
}
module.exports = {
  buildContext,
  searchProducts,
  loadProducts,
  queryWords,
  normalize,
  extractMaxPrice,
  parsePriceNumber,
  getPriceExtremes,
  isPriceExtremeQuery,
  requestedPriceExtremes,
  extractExactPrice,
  findProductsByExactPrice
};
