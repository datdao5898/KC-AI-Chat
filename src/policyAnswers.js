const { normalizeText, findSection, sectionText } = require('./knowledgeSections');

// Policy questions are answered by quoting the matching "## <heading>" section of the
// source's policies.md / faq.md. The order matters: a lost invoice is a warranty
// question, not a VAT one.
const POLICY_TOPICS = [
  {
    id: 'warranty',
    label: 'bảo hành',
    heading: /^(chinh sach )?bao hanh/,
    question: /\b(bao hanh|warranty|bao loi|(mat|that lac|khong con|lam mat) hoa don|hoa don (bi )?(mat|that lac))\b/
  },
  { id: 'refund', label: 'hoàn tiền', heading: /^(chinh sach )?(hoan tien|doi tra hoan tien)/, question: /\b(hoan tien|refund)\b/ },
  { id: 'return', label: 'đổi trả', heading: /^(chinh sach )?doi tra/, question: /\b(doi tra|(?<!kiem )tra hang|tra lai hang|doi hang|doi moi|return policy|exchange)\b/ },
  { id: 'vat', label: 'hóa đơn VAT', heading: /^(chinh sach )?(hoa don|vat)/, question: /\b(full vat|vat|hoa don|xuat hoa don|invoice)\b/ },
  { id: 'shipping', label: 'giao hàng', heading: /^(chinh sach )?(giao hang|van chuyen)/, question: /\b(giao hang|van chuyen|ship|shipping|phi ship|thoi gian giao|delivery)\b/ },
  { id: 'payment', label: 'thanh toán', heading: /^(chinh sach )?thanh toan/, question: /\b(thanh toan|cod|chuyen khoan|tra gop|vnpay|payment)\b/ }
];

const INTRO_HEADING = /^(gioi thieu|ve cua hang|ve chung toi)/;
const TECH_HEADING = /^(ky thuat|ho tro ky thuat)/;

function detectPolicyTopic(userText = '', intent = '') {
  const normalized = normalizeText(userText);
  const topic = POLICY_TOPICS.find(item => item.question.test(normalized));
  if (topic) return topic;
  return intent === 'warranty' ? POLICY_TOPICS[0] : null;
}

// Returns null when the message is not a policy question or is not Vietnamese
// (non-Vietnamese replies are written by the model from the same markdown).
function buildPolicyAnswer({ userText = '', intent = '', sourceKey = '', lang = 'vi', customerBrand = 'KingCom' } = {}) {
  const topic = detectPolicyTopic(userText, intent);
  if (!topic || lang !== 'vi') return null;

  const section = findSection(sourceKey, topic.heading);
  if (!section) {
    return {
      topic: topic.id,
      reply: `Dạ hiện dữ liệu của ${customerBrand} chưa có thông tin về ${topic.label}. Em đã chuyển nhân viên kiểm tra và phản hồi anh/chị chính xác ạ.`,
      handoff: { needed: true, reason: `FAQ/chính sách chưa có mục ${topic.label}` }
    };
  }
  return {
    topic: topic.id,
    reply: `Dạ, thông tin ${topic.label} bên em như sau ạ:\n${sectionText(section)}`,
    handoff: { needed: false }
  };
}

function storeIntroLines(sourceKey = '') {
  return findSection(sourceKey, INTRO_HEADING, ['faq.md'])?.lines || [];
}

function technicalSupportLines(sourceKey = '') {
  return findSection(sourceKey, TECH_HEADING, ['faq.md'])?.lines || [];
}

function policySectionText(sourceKey = '', topicId = '') {
  const topic = POLICY_TOPICS.find(item => item.id === topicId);
  const section = topic ? findSection(sourceKey, topic.heading) : null;
  return section ? sectionText(section) : '';
}

module.exports = {
  POLICY_TOPICS,
  detectPolicyTopic,
  buildPolicyAnswer,
  storeIntroLines,
  technicalSupportLines,
  policySectionText
};
