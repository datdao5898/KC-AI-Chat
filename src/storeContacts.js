const { findSection } = require('./knowledgeSections');

// Store addresses and hotlines come only from the "## Thông tin cửa hàng" (or
// "## Thông tin liên hệ") section of the source's faq.md, editable in admin.
// Each bullet is one branch/contact line, e.g.
//   - Chi nhánh TP.HCM: 65 Nguyễn Minh Hoàng, Phường Bảy Hiền, TP.HCM. Hotline: 0903 898 478
// The first faq.md found for the source is used as-is (no merge with common), so a
// source whose FAQ has no contact bullets never borrows another brand's contacts.
const CONTACT_HEADING = /^(thong tin cua hang|thong tin lien he)/;
const PHONE_LABEL = /[.,;]?\s*\b(hotline|zalo|tong dai|sdt|so dien thoai|dien thoai|phone|tel)\b[^:]{0,20}:/i;
const ADMIN_AREA_PREFIX = /^(phuong|quan|huyen|thi xa|thi tran|xa|tp|thanh pho|tinh|ha noi|ho chi minh|hcm|viet nam)\b/;
const PHONE_PATTERN = /(?:\+?84|0)(?:[\s.-]?\d){8,10}(?!\d)|1[89]00(?:[\s.-]?\d){4,6}(?!\d)/g;

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.startsWith('84') && digits.length >= 11 ? `0${digits.slice(2)}` : digits;
}

function extractPhones(text = '') {
  const withoutUrls = String(text || '').replace(/https?:\/\/\S+/gi, ' ');
  return (withoutUrls.match(PHONE_PATTERN) || []).map(normalizePhone);
}

// Street names in an address ("65 Nguyễn Minh Hoàng" -> "nguyen minh hoang"), used to
// spot a reply that mentions the store but quotes its address differently.
function streetKeywords(address = '') {
  return String(address || '')
    .split(/[,()]/)
    .map(part => normalizeText(part)
      .split(' ')
      .filter(token => token && !/\d/.test(token))
      .join(' ')
      .replace(/^(lk|so|khu nha o|khu do thi|toa nha)\s+/, '')
      .trim())
    .filter(part => part.split(' ').length >= 2 && !ADMIN_AREA_PREFIX.test(part));
}

function parseContactLine(line = '') {
  const colon = line.indexOf(':');
  const label = colon > 0 ? line.slice(0, colon).trim() : '';
  const rest = colon > 0 ? line.slice(colon + 1).trim() : line.trim();
  const phones = extractPhones(rest);
  const addressPart = rest.split(PHONE_LABEL)[0].replace(PHONE_PATTERN, '').replace(/[\s.,;]+$/, '').trim();
  const looksLikeAddress = /\d/.test(addressPart) && !/\d{1,2}[:h]\d{2}/i.test(addressPart) && addressPart.length >= 10;
  const address = looksLikeAddress ? addressPart : '';
  return { label, text: line, address, phones, streetKeywords: streetKeywords(address) };
}

function getVerifiedContact(sourceKey = '') {
  const section = findSection(sourceKey, CONTACT_HEADING, ['faq.md']);
  const entries = (section?.lines || []).map(parseContactLine);
  if (!entries.some(entry => entry.address || entry.phones.length)) return null;
  return {
    entries,
    phones: new Set(entries.flatMap(entry => entry.phones)),
    addresses: entries.filter(entry => entry.address)
  };
}

function buildMissingContactReply(lang = 'vi') {
  if (lang === 'en') return 'I do not have verified store contact details in the current data. I have forwarded your request to staff so they can send you the correct address and hotline.';
  if (lang === 'zh') return '当前资料中没有已核实的门店联系方式，我已转交工作人员为您提供准确的地址和热线。';
  return 'Dạ hiện em chưa có thông tin địa chỉ/hotline đã xác thực của cửa hàng. Em đã chuyển nhân viên gửi lại anh/chị thông tin liên hệ chính xác ạ.';
}

function buildStoreContactReply({ sourceKey = '', lang = 'vi' } = {}) {
  const contact = getVerifiedContact(sourceKey);
  if (!contact) return buildMissingContactReply(lang);
  const lines = contact.entries.map(entry => `- ${entry.text}`).join('\n');
  if (lang === 'en') return `You can contact or visit our stores:\n${lines}`;
  if (lang === 'zh') return `您可以联系或前往以下门店：\n${lines}`;
  return `Dạ anh/chị có thể liên hệ hoặc đến cửa hàng bên em:\n${lines}`;
}

function buildContactPromptBlock(sourceKey = '') {
  const contact = getVerifiedContact(sourceKey);
  if (!contact) {
    return [
      'Thông tin liên hệ cửa hàng: CHƯA CÓ dữ liệu xác thực.',
      '- Tuyệt đối không đưa địa chỉ, hotline, số điện thoại, Zalo hay email của cửa hàng. Nếu khách hỏi, nói em chuyển nhân viên gửi thông tin chính xác.'
    ].join('\n');
  }
  return [
    'Thông tin liên hệ cửa hàng đã xác thực (chỉ dùng đúng nguyên văn, không thêm số khác):',
    ...contact.entries.map(entry => `- ${entry.text}`),
    '- Tuyệt đối không tự tạo hotline, tổng đài, số điện thoại, Zalo, email hay địa chỉ khác ngoài danh sách trên.'
  ].join('\n');
}

function isStoreContactRequest(text = '') {
  const msg = normalizeText(text);
  if (!msg || extractPhones(text).length) return false;
  return /\b(hotline|tong dai|so tong dai)\b/.test(msg)
    || (/\b(so dien thoai|so dt|sdt|so lien he|so zalo|zalo)\b/.test(msg)
      && /\b(shop|cua hang|ben ban|ben em|ben minh|cac ban|kingcom|newlite|cong ty)\b/.test(msg))
    || /\b(xin|cho xin|cho minh xin|cho em xin|gui)\b.*\b(so dien thoai|sdt|so lien he|so zalo|hotline)\b/.test(msg);
}

function customerProvidedPhones({ userText = '', history = [], customerPhone = '' } = {}) {
  const customerTexts = [
    userText,
    customerPhone,
    ...(history || [])
      .filter(message => message?.direction === 'in' || message?.sender_type === 'customer' || message?.senderType === 'customer')
      .map(message => message?.text || '')
  ];
  return new Set(customerTexts.flatMap(extractPhones));
}

function findContactViolations(reply = '', { sourceKey = '', userText = '', history = [], customerPhone = '' } = {}) {
  const contact = getVerifiedContact(sourceKey);
  const allowedPhones = customerProvidedPhones({ userText, history, customerPhone });
  for (const phone of contact?.phones || []) allowedPhones.add(phone);
  const badPhones = extractPhones(reply).filter(phone => !allowedPhones.has(phone));

  // Addresses known anywhere (this source + common FAQ) so another brand's address is caught too.
  const knownAddresses = [
    ...(contact?.addresses || []),
    ...(getVerifiedContact('common')?.addresses || [])
  ];
  const normalizedReply = normalizeText(reply);
  const badAddress = knownAddresses.some(entry => {
    if (!entry.streetKeywords.some(keyword => normalizedReply.includes(keyword))) return false;
    const quotedOwnAddress = (contact?.addresses || []).some(own =>
      own.streetKeywords.some(keyword => entry.streetKeywords.includes(keyword))
      && normalizedReply.includes(normalizeText(own.address))
    );
    return !quotedOwnAddress;
  });
  return { badPhones, badAddress };
}

function sentenceHasViolation(sentence, context) {
  const { badPhones, badAddress } = findContactViolations(sentence, context);
  return badPhones.length > 0 || badAddress;
}

// Final gate before a reply leaves the system: drops sentences with phone numbers or
// store addresses not found in the FAQ contact section and appends that section.
function enforceVerifiedContactInfo(reply = '', context = {}) {
  const { badPhones, badAddress } = findContactViolations(reply, context);
  if (!badPhones.length && !badAddress) return { ok: true, reply };

  const lang = context.lang || 'vi';
  const contact = getVerifiedContact(context.sourceKey);
  const kept = String(reply || '')
    .split(/(?<=[.!?。])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence && !sentenceHasViolation(sentence, context));
  const remaining = kept.join(' ').trim();
  const contactText = buildStoreContactReply({ sourceKey: context.sourceKey, lang });
  const fixed = remaining.length >= 20 ? `${remaining}\n\n${contactText}` : contactText;
  const reason = [
    badPhones.length ? `số điện thoại không có trong FAQ: ${badPhones.join(', ')}` : '',
    badAddress ? 'địa chỉ cửa hàng không khớp FAQ' : ''
  ].filter(Boolean).join('; ');
  return {
    ok: false,
    reply: fixed,
    reason: `Câu trả lời có ${reason}`,
    needsHandoff: !contact
  };
}

module.exports = {
  getVerifiedContact,
  buildStoreContactReply,
  buildContactPromptBlock,
  isStoreContactRequest,
  extractPhones,
  findContactViolations,
  enforceVerifiedContactInfo
};
