const { normalizeText, findSection } = require('./knowledgeSections');

// Messages about an order the customer already placed or paid for (order status, transfer
// proof, invoice for a past order, complaints) go to staff. The reply is quoted from the
// source's faq.md: a "Hỏi: ... | Trả lời mẫu: ..." entry or a plain bullet whose text
// matches the topic. Nothing customer-facing is written here.
const INTERNAL_ANALYSIS = /\n*\[Internal image analysis:[\s\S]*$/i;

const AFTER_SALE_HEADING = /^sau khi mua/;
const ORDER_HEADING = /^(huong dan )?dat hang/;
const GENERIC_ENTRY = { heading: AFTER_SALE_HEADING, match: /sau khi mua/ };

const TOPICS = {
  payment: {
    label: 'thanh toán/chuyển khoản cho đơn hàng',
    entries: [{ heading: AFTER_SALE_HEADING, match: /chuyen khoan|\bunc\b|thanh toan/ }]
  },
  invoice: {
    label: 'xuất hóa đơn cho đơn đã mua',
    entries: [{ heading: AFTER_SALE_HEADING, match: /hoa don/ }]
  },
  complaint: {
    label: 'khiếu nại đơn hàng',
    entries: [{ heading: AFTER_SALE_HEADING, match: /khieu nai/ }]
  },
  order_given: {
    label: 'kiểm tra đơn hàng (khách đã gửi mã đơn/SĐT)',
    entries: [{ heading: AFTER_SALE_HEADING, match: /da gui ma don/ }]
  },
  order_delay: {
    label: 'đơn hàng chưa được xác nhận/cập nhật',
    entries: [{ heading: AFTER_SALE_HEADING, match: /chua thay|cap nhat/ }]
  },
  order_tracking: {
    label: 'kiểm tra tình trạng đơn hàng',
    entries: [
      { heading: AFTER_SALE_HEADING, match: /tinh trang don/ },
      { heading: ORDER_HEADING, match: /kiem tra don hang/ }
    ]
  },
  accounting: {
    label: 'kế toán/thanh toán cần nhân viên kiểm tra',
    entries: [{ heading: /^chat cskh/, match: /gap nhan vien/ }]
  }
};

const RECEIPT_IMAGE = /\b(bank transfer|transfer (receipt|slip|confirmation)|payment (receipt|slip|proof|confirmation)|remittance|chuyen khoan|uy nhiem chi|bien lai)\b/;
const PAYMENT_TEXT = /\b(unc|uy nhiem chi|bien lai|bill chuyen khoan|(da|vua|moi) (chuyen khoan|ck|chuyen tien|thanh toan)|chuyen khoan (roi|xong)|ck (roi|xong)|thanh toan (roi|xong))\b/;
const PAST_ORDER = /\b(da|co|vua|moi) (dat|mua|order)\b|\bdat (mua |hang |don )?(ben|tren|o|qua) (shopee|lazada|tiki|tiktok|web|website)\b|\b(dat|mua|order)\b.{0,40}\b(roi|tuan truoc|tuan roi|hom qua|hom truoc|hom kia|chu nhat|thu (hai|ba|tu|nam|sau|bay|[2-7]))\b/;
const ORDER_CODE = /#\s?\d{3,}|\bma (don|van don)\b.{0,20}\d{3,}|\bdon (hang )?(so )?\d{4,}/;
const ORDER_REFERENCE = /\b(ma don|ma van don|trang thai don|cap nhat don|don hang cua (toi|minh|em|anh|chi)|don cua (toi|minh|em|anh|chi)|theo doi don|tra cuu don)\b/;
const DELAY = /\b(chua thay|chua (nhan|co|duoc) (hoi am|phan hoi|cap nhat|xac nhan|hang|tin)|sao chua|van chua|lau (qua|vay)|cham (qua|vay))\b/;
const COMPLAINT = /\b(khieu nai|giao sai|giao thieu|giao nham|thieu hang|khong nhan duoc hang|chua nhan duoc hang)\b/;
const INVOICE = /\b(xuat hoa don|lay hoa don|hoa don vat|xin hoa don)\b/;
const SHIP_REQUEST = /\b(kiem tra (va|roi) (ship|giao|gui)|(ship|giao|gui) hang (giup|cho minh|cho em|cho toi|nhe|nha|ha))\b/;
const ACCOUNTING = /\bke toan\b/;

function stripInternalAnalysis(text = '') {
  return String(text || '').replace(INTERNAL_ANALYSIS, '').trim();
}

function internalAnalysis(text = '') {
  const match = String(text || '').match(INTERNAL_ANALYSIS);
  return match ? match[0] : '';
}

function detectOrderSupportTopic(userText = '') {
  const message = normalizeText(stripInternalAnalysis(userText));
  const analysis = normalizeText(internalAnalysis(userText));
  if (PAYMENT_TEXT.test(message) || (analysis && RECEIPT_IMAGE.test(analysis))) return 'payment';
  const pastOrder = PAST_ORDER.test(message);
  if (INVOICE.test(message) && pastOrder) return 'invoice';
  if (COMPLAINT.test(message)) return 'complaint';
  if (ORDER_CODE.test(message)) return 'order_given';
  const orderReference = ORDER_REFERENCE.test(message);
  if ((orderReference || pastOrder) && DELAY.test(message)) return 'order_delay';
  if (orderReference || pastOrder) return 'order_tracking';
  if (SHIP_REQUEST.test(message)) return 'payment';
  if (ACCOUNTING.test(message)) return 'accounting';
  return null;
}

function parseEntry(line = '') {
  const qa = String(line).match(/^Hỏi:\s*(.+?)\s*\|\s*Trả lời mẫu:\s*(.+)$/i);
  if (!qa) return { question: line, answer: line };
  return { question: qa[1], answer: qa[2].trim().replace(/^"(.*)"$/s, '$1') };
}

function findEntryAnswer(sourceKey, { heading, match }) {
  const section = findSection(sourceKey, heading, ['faq.md']);
  for (const line of section?.lines || []) {
    const entry = parseEntry(line);
    if (match.test(normalizeText(entry.question))) return entry.answer;
  }
  return '';
}

// Staff always see these messages, including when the reply falls through to the model
// (non-Vietnamese message, or no matching FAQ entry).
function orderSupportHandoff(userText = '') {
  const topicId = detectOrderSupportTopic(userText);
  return topicId ? { needed: true, reason: `Khách cần hỗ trợ ${TOPICS[topicId].label}` } : null;
}

// Returns null when the message is not about an existing order, is not Vietnamese, or
// the FAQ has no entry to quote.
function buildOrderSupportAnswer({ userText = '', sourceKey = '', lang = 'vi' } = {}) {
  const topicId = detectOrderSupportTopic(userText);
  if (!topicId || lang !== 'vi') return null;
  const answer = [...TOPICS[topicId].entries, GENERIC_ENTRY]
    .map(entry => findEntryAnswer(sourceKey, entry))
    .find(Boolean);
  if (!answer) return null;
  return { topic: topicId, reply: answer, handoff: orderSupportHandoff(userText) };
}

module.exports = {
  detectOrderSupportTopic,
  orderSupportHandoff,
  buildOrderSupportAnswer,
  stripInternalAnalysis
};
