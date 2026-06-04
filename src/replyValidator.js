const { normalize } = require('./rag');

const CATEGORY_RULES = [
  {
    id: 'microphone',
    label: 'micro',
    ask: /\b(mic|micro|microphone|thu am|micro thu am|maono|fifine|boya|comica|synco)\b/i,
    product: /\b(mic|micro|microphone|thu am|maono|fifine|boya|comica|synco|xlr|condenser|dynamic|lav|wireless microphone)\b/i
  },
  {
    id: 'light',
    label: 'den',
    ask: /\b(den|led|light|ring light|tube|rgb|vijim|vl\d+)\b/i,
    product: /\b(den|led|light|ring light|tube|rgb|vijim|vl\d+|bang led)\b/i
  },
  {
    id: 'tripod',
    label: 'tripod',
    ask: /\b(tripod|chan may|chan den|gia do|kep dien thoai)\b/i,
    product: /\b(tripod|chan may|chan den|gia do|kep dien thoai)\b/i
  },
  {
    id: 'bag',
    label: 'balo/tui',
    ask: /\b(balo|tui|backpack|bag)\b/i,
    product: /\b(balo|tui|backpack|bag)\b/i
  },
  {
    id: 'gimbal',
    label: 'gimbal',
    ask: /\b(gimbal|chong rung|stabilizer|zhiyun|weebill|crane)\b/i,
    product: /\b(gimbal|chong rung|stabilizer|zhiyun|weebill|crane)\b/i
  }
];

function norm(text) {
  return normalize(text || '').replace(/\s+/g, ' ').trim();
}

function parsePriceNumber(value) {
  const n = Number(String(value || '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function extractMaxPrice(text) {
  const normalized = norm(text);
  const m1 = normalized.match(/(?:duoi|toi da|max|nho hon|be hon)\s*(\d+(?:[\.,]\d+)?)\s*(trieu|tr|m|k|nghin|ngan)?/);
  const m2 = normalized.match(/(\d+(?:[\.,]\d+)?)\s*(trieu|tr|m|k|nghin|ngan)\s*(?:tro xuong|do lai|do ve|quay dau)/);
  const m = m1 || m2;
  if (!m) return null;
  const val = Number(m[1].replace(',', '.'));
  const unit = m[2] || '';
  if (['trieu', 'tr', 'm'].includes(unit)) return Math.round(val * 1000000);
  if (['k', 'nghin', 'ngan'].includes(unit)) return Math.round(val * 1000);
  return val > 10000 ? Math.round(val) : Math.round(val * 1000000);
}

function categoriesInText(text) {
  const normalized = norm(text);
  return CATEGORY_RULES.filter(rule => rule.ask.test(normalized));
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
  return category.product.test(productText(product));
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

function buildSafeReply({ categories, maxPrice, reason }) {
  const categoryLabel = categories.map(item => item.label).join(', ') || 'sản phẩm phù hợp';
  const priceText = maxPrice ? ` dưới ${maxPrice.toLocaleString('vi-VN')}đ` : '';
  const reasonText = reason ? ` (${reason})` : '';
  return `Dạ em kiểm tra lại để tránh tư vấn sai${reasonText}. Hiện KingCom chưa tìm thấy mẫu ${categoryLabel}${priceText} phù hợp trong catalog hiện tại.\n\nEm đã chuyển thông tin này cho nhân viên KingCom kiểm tra thêm để hỗ trợ anh/chị chính xác hơn ạ.`;
}

function validateAiReply({ userText, history = [], reply, ragProducts = [] }) {
  const categories = inferRequestedCategories(userText, history);
  const maxPrice = extractMaxPrice(userText) || extractMaxPrice((history || []).map(m => m.text).slice(-4).join(' '));
  if (!categories.length && !maxPrice) return { ok: true };
  if (!replyMentionsProduct(reply)) return { ok: true };

  const productsInReply = (ragProducts || []).filter(product => productAppearsInReply(reply, product));
  const candidateProducts = productsInReply.length ? productsInReply : (ragProducts || []);

  if (categories.length && candidateProducts.length) {
    const matching = candidateProducts.filter(product => categories.some(category => productMatchesCategory(product, category)));
    if (!matching.length) {
      return {
        ok: false,
        reason: 'Câu trả lời lệch nhóm sản phẩm khách hỏi',
        reply: buildSafeReply({ categories, maxPrice, reason: 'sản phẩm tìm được đang lệch nhóm khách hỏi' })
      };
    }
    if (productsInReply.length && productsInReply.some(product => !categories.some(category => productMatchesCategory(product, category)))) {
      return {
        ok: false,
        reason: 'Câu trả lời có sản phẩm lệch nhóm',
        reply: buildSafeReply({ categories, maxPrice, reason: 'câu trả lời có sản phẩm không đúng nhóm khách hỏi' })
      };
    }
  }

  if (maxPrice && candidateProducts.length) {
    const overBudgetProducts = candidateProducts.filter(product => {
      const price = parsePriceNumber(product.price || product.compare_at_price || product.gia || '');
      return price > 0 && price > maxPrice && productAppearsInReply(reply, product);
    });
    if (overBudgetProducts.length) {
      return {
        ok: false,
        reason: 'Câu trả lời vượt ngân sách khách hỏi',
        reply: buildSafeReply({ categories, maxPrice, reason: 'sản phẩm tìm được đang vượt ngân sách khách hỏi' })
      };
    }
  }

  return { ok: true };
}

module.exports = {
  validateAiReply,
  inferRequestedCategories,
  extractMaxPrice
};
