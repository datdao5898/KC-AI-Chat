// Works out what the identifiers in a customer message are: a phone number, a tax code,
// a company or a person. A bare digit pattern cannot tell these apart, so labels are read
// first and an unlabelled number must also have a valid format for what it is claimed to be.

// Removes Vietnamese accents one character at a time, so an index found in the folded text
// is also valid in the original text.
function fold(text) {
  return String(text || '')
    .replace(/[^\x00-\x7f]/g, char => {
      const folded = char.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
      return folded.length === 1 ? folded : char;
    })
    .toLowerCase();
}

function digitsOf(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidVnPhone(value) {
  const digits = digitsOf(value).replace(/^84/, '0');
  return /^0(?:3[2-9]|5[2-9]|7[06-9]|8[1-9]|9\d)\d{7}$/.test(digits) || /^02\d{9}$/.test(digits);
}

// Vietnamese tax code: 10 digits with a check digit, plus an optional 3-digit branch suffix.
function isValidTaxCode(value) {
  const digits = digitsOf(value);
  if (digits.length !== 10 && digits.length !== 13) return false;
  const weights = [31, 29, 23, 19, 17, 13, 7, 5, 3];
  const sum = weights.reduce((total, weight, index) => total + weight * Number(digits[index]), 0);
  return (10 - (sum % 11)) % 11 === Number(digits[9]);
}

function formatTaxCode(value) {
  const digits = digitsOf(value);
  return digits.length === 13 ? `${digits.slice(0, 10)}-${digits.slice(10)}` : digits;
}

const TAX_LABEL = String.raw`(?:ma so thue|ma so doanh nghiep|ma doanh nghiep|ma thue|mst|msdn|tax\s*(?:code|id|number)?|vat\s*(?:code|id|number))`;
const LABEL_GAP = String.raw`(?:\s+(?:cua|cty|cong ty|ben|la)\b[^\d\n]{0,40}?)?[\s:：*=.\-–—#()]*(?:la\s+)?`;
const TAX_NUMBER = String.raw`\d{10}(?:-?\d{3})?|\d(?:[ .\-]?\d){9,12}`;
const PHONE_NUMBER = String.raw`(?:\+?84|0)(?:[\s.\-]?\d){8,10}`;
const TAX_AFTER_LABEL = new RegExp(String.raw`(?<![a-z])${TAX_LABEL}(?![a-z])${LABEL_GAP}(${TAX_NUMBER})(?!\d)`, 'g');
const TAX_BEFORE_LABEL = new RegExp(String.raw`(?<!\d)(${TAX_NUMBER})\s+la\s+${TAX_LABEL}(?![a-z])`, 'g');
const OTHER_NUMBER_AFTER_LABEL = new RegExp(String.raw`(?<![a-z])(?:stk|so tai khoan|so tk|tai khoan|account(?: number)?|ma don(?: hang)?|so don(?: hang)?|don hang|order(?: id| code| number)?|ma van don|van don|cccd|cmnd|can cuoc|so hoa don|ma khach hang|ma kh|fax|ma san pham|ma sp|sku|imei|serial)(?![a-z])${LABEL_GAP}[a-z0-9][a-z0-9 .\-]*\d`, 'g');
const COMPANY_PHONE = new RegExp(String.raw`(?<![a-z])(?:so dien thoai|dien thoai|sdt|so dt|tel|phone)\s+(?:cong ty|cty|doanh nghiep)${LABEL_GAP}${PHONE_NUMBER}(?!\d)`, 'g');
const PHONE_AFTER_LABEL = new RegExp(String.raw`(?<![a-z])(?:so dien thoai|dien thoai|sdt|so dt|dt|phone(?: number)?|mobile|telephone|tel|so lien he|lien he|so zalo|zalo)(?![a-z])${LABEL_GAP}(${PHONE_NUMBER})(?!\d)`, 'g');
const PHONE_ANYWHERE = new RegExp(String.raw`(?<![\d+])${PHONE_NUMBER}(?!\d)`, 'g');
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]*\w/;
const BUSINESS_CONTEXT = /(?<![a-z])(?:cong ty|cty|doanh nghiep|hoa don|vat|tnhh|co phan|mst|ma so thue)(?![a-z])/;
const LEGAL_COMPANY = /(?<![a-z])(?:(?:cong ty|cty)\s+(?:tnhh|co phan|cp|trach nhiem|tu nhan|hop danh|dtnn|tm|thuong mai|dich vu)|ho kinh doanh)(?![a-z])[^,;\n]*/;
const COMPANY_NAME_END = /\s+(?:mst|ma so thue|dia chi|sdt|so dien thoai|email)(?![a-z])/;

function classifyLabel(label) {
  if (/^(?:dia chi|tru so|address)/.test(label)) {
    return /giao|nhan hang|ship/.test(label) ? 'delivery' : 'address';
  }
  if (/mail/.test(label)) return /hoa don|invoice|cong ty|cty/.test(label) ? 'invoiceEmail' : 'email';
  if (/nguoi dai dien|dai dien|representative|giam doc|chuc vu/.test(label)) return 'representative';
  if (/^(?:ho (?:va )?ten|ten|ten khach(?: hang)?|ten nguoi (?:mua|nhan|lien he)|nguoi (?:lien he|mua|nhan)|contact(?: name)?|full name|name)$/.test(label)) return 'person';
  if (/^(?:ten )?(?:cong ty|cty|doanh nghiep|don vi|chu the|to chuc)(?![a-z])|^company/.test(label)) return 'company';
  return '';
}

const NAME_END_WORDS = new Set(['cần', 'can', 'muốn', 'muon', 'hỏi', 'hoi', 'mua', 'đang', 'ở', 'o', 'từ', 'bên', 'của', 'cua', 'và', 'va', 'nhé', 'nhe', 'nha', 'ạ', 'a', 'đây', 'day', 'sdt', 'số', 'so']);
const NOT_A_PERSON = /(?<![a-z])(?:cong ty|cty|tnhh|co phan|doanh nghiep|ke toan|nhan vien|giam doc|truong phong|chu shop|chu cua hang|admin|khach|nguoi|sinh vien|hoc sinh|shop|dai ly|ben|dia chi|hoa don)(?![a-z])/;
const AFTER_HONORIFIC_NOT_A_NAME = new Set([
  'cong', 'moi', 'phan', 'ty', 'tru', 'so', 'oi', 'nhe', 'nha', 'can', 'muon', 'goi', 'lien', 'sdt', 'la', 'dien',
  'em', 'minh', 'toi', 'the', 'hang', 'san', 'gia', 'khong', 'ko', 'y', 'xuat', 'nhan', 'giao', 'co', 'van', 'da', 'dang', 'se',
  'vua', 'moi', 'mua', 'hoi', 'dat', 'gui', 'ban', 'biet', 'thay', 'chua', 'roi', 'cung', 'di', 'den', 'nay', 'do', 'sao', 'ai', 'gi'
]);
const QUESTION_WORDS = /^(?:gi|ai|dau|nao|sao|the nao|bao nhieu)$/;

function cleanPersonName(candidate) {
  const kept = [];
  for (const word of String(candidate || '').trim().split(/\s+/)) {
    if (NAME_END_WORDS.has(word.toLowerCase())) break;
    kept.push(word);
  }
  const name = kept.join(' ').replace(/^\(?(?:ông|bà|mr\.?|mrs\.?|ms\.?)\)?\s+/i, '').replace(/[,.!?;:]+$/, '').trim();
  if (!name || kept.length > 5) return '';
  if (!/^[\p{L}\s.'-]+$/u.test(name) || NOT_A_PERSON.test(fold(name)) || QUESTION_WORDS.test(fold(name))) return '';
  return name;
}

function findSelfIntroducedName(text) {
  const folded = fold(text);
  const intro = /(?<![a-z])(?:ten (?:toi|em|minh) la|ten la|toi la|em la|minh la)\s+([^,.!?;:\n]+)/g;
  for (const match of folded.matchAll(intro)) {
    // "ý tôi là ..." means "what I mean is ...", not an introduction.
    if (/(?<![a-z])y\s$/.test(folded.slice(0, match.index))) continue;
    const start = match.index + match[0].length - match[1].length;
    const name = cleanPersonName(text.slice(start, start + match[1].length));
    if (name) return name;
  }
  return '';
}

function findHonorificName(text) {
  const pattern = /(?<![\p{L}])(anh|chị|cô|chú|chi|co|chu)\s+(\p{L}{2,30})/giu;
  for (const match of text.matchAll(pattern)) {
    const before = fold(text.slice(0, match.index));
    if (/(?<![a-z])dia\s$/.test(before)) continue;
    // Without accents "chi", "co" and "chu" are ordinary words, so only a capitalised name counts.
    const ambiguous = /^(?:chi|co|chu)$/i.test(match[1]);
    if (ambiguous && !/^\p{Lu}/u.test(match[2])) continue;
    if (AFTER_HONORIFIC_NOT_A_NAME.has(fold(match[2]))) continue;
    return match[0].replace(/\s+/g, ' ').trim();
  }
  return '';
}

// Cuts a matched range out of both copies so that later steps cannot read it again.
function blank(state, start, end) {
  const spaces = ' '.repeat(end - start);
  state.raw = state.raw.slice(0, start) + spaces + state.raw.slice(end);
  state.folded = state.folded.slice(0, start) + spaces + state.folded.slice(end);
}

function blankMatches(state, pattern, onMatch) {
  for (const match of [...state.folded.matchAll(pattern)]) {
    if (onMatch) onMatch(match);
    blank(state, match.index, match.index + match[0].length);
  }
}

function extractCustomerInfo(text) {
  const original = String(text || '').normalize('NFC').trim();
  const state = { raw: original, folded: fold(original) };
  const info = {
    phone: '', name: '', email: '',
    companyName: '', taxCode: '', companyAddress: '', invoiceEmail: '',
    isInvoiceInfo: false
  };
  const hasBusinessContext = BUSINESS_CONTEXT.test(state.folded);

  const takeTaxCode = match => {
    const digits = digitsOf(match[1]);
    if (!info.taxCode && (digits.length === 10 || digits.length === 13)) info.taxCode = formatTaxCode(digits);
  };
  blankMatches(state, TAX_AFTER_LABEL, takeTaxCode);
  blankMatches(state, TAX_BEFORE_LABEL, takeTaxCode);
  blankMatches(state, OTHER_NUMBER_AFTER_LABEL);
  blankMatches(state, COMPANY_PHONE);
  blankMatches(state, PHONE_AFTER_LABEL, match => {
    const start = match.index + match[0].length - match[1].length;
    if (!info.phone) info.phone = original.slice(start, start + match[1].length).replace(/[^\d+]/g, '');
  });

  let labelledPerson = '';
  let labelledCompany = false;
  let labelledEmail = '';
  let lineStart = 0;
  for (const line of state.folded.split('\n')) {
    const parts = line.match(/^[\s\-*•+.)\d]*([a-z][a-z \-]{0,48}?)\s*\*?\s*[:：=]\s*(.*)$/);
    const kind = parts ? classifyLabel(parts[1].trim()) : '';
    if (kind) {
      const valueStart = lineStart + line.length - parts[2].length;
      const value = state.raw.slice(valueStart, lineStart + line.length).trim();
      if (kind === 'company' && value && !info.companyName) {
        info.companyName = value;
        labelledCompany = true;
      }
      if (kind === 'address' && value && !info.companyAddress) info.companyAddress = value;
      if (kind === 'person' && value && !labelledPerson) labelledPerson = value;
      if (kind === 'invoiceEmail' || kind === 'email') {
        const email = value.match(EMAIL)?.[0] || '';
        if (email && kind === 'invoiceEmail') info.invoiceEmail = email;
        if (email && kind === 'email') labelledEmail = email;
      }
      blank(state, lineStart, lineStart + line.length);
    }
    lineStart += line.length + 1;
  }

  const legalCompany = state.folded.match(LEGAL_COMPANY);
  if (legalCompany) {
    const end = legalCompany[0].search(COMPANY_NAME_END);
    const length = end >= 0 ? end : legalCompany[0].length;
    if (!info.companyName) info.companyName = state.raw.slice(legalCompany.index, legalCompany.index + length).trim();
    blank(state, legalCompany.index, legalCompany.index + legalCompany[0].length);
  }

  for (const match of state.folded.matchAll(PHONE_ANYWHERE)) {
    const digits = digitsOf(match[0]);
    const taxFormat = hasBusinessContext && isValidTaxCode(digits);
    if (isValidVnPhone(digits) && !taxFormat) {
      if (!info.phone) info.phone = original.slice(match.index, match.index + match[0].length).replace(/[^\d+]/g, '');
    } else if (taxFormat && !isValidVnPhone(digits) && !info.taxCode) {
      info.taxCode = formatTaxCode(digits);
    }
  }

  info.isInvoiceInfo = Boolean(info.taxCode)
    || (labelledCompany && Boolean(info.companyAddress || info.invoiceEmail));

  const anyEmail = labelledEmail || state.raw.match(EMAIL)?.[0] || '';
  if (anyEmail && !info.invoiceEmail) {
    if (info.isInvoiceInfo) info.invoiceEmail = anyEmail;
    else info.email = anyEmail;
  }

  info.name = cleanPersonName(labelledPerson) || findSelfIntroducedName(state.raw);
  if (!info.name) {
    const canUseHonorific = info.phone || /(?<![a-z])(?:goi|lien he|sdt|so dien thoai)(?![a-z])/.test(state.folded);
    if (canUseHonorific) info.name = findHonorificName(state.raw);
  }
  return info;
}

function hasPhoneNumber(text) {
  return Boolean(extractCustomerInfo(text).phone);
}

// The customer says the number we took for their phone is not one.
function isPhoneCorrection(text) {
  const folded = fold(text);
  if (/(?<![a-z])(?:shop|cua hang|ben ban|hotline)(?![a-z])/.test(folded)) return false;
  return /(?<![a-z])(?:khong|ko|k|hong|chang) phai (?:la )?(?:sdt|so dien thoai|so dt|dien thoai|so phone|phone)(?![a-z])/.test(folded)
    || /(?<![a-z])(?:so nay|so do|day) la (?:mst|ma so thue)(?![a-z])/.test(folded)
    || /(?<![a-z])not (?:a |my )?phone(?: number)?(?![a-z])/.test(folded);
}

module.exports = {
  extractCustomerInfo,
  hasPhoneNumber,
  isPhoneCorrection,
  isValidVnPhone,
  isValidTaxCode,
  digitsOf
};
