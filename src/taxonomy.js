function normalizeTaxonomyText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CATEGORY_RULES = Object.freeze([
  { id: 'gimbal', label: 'gimbal', pattern: /\b(chong rung|khong bi rung|giam rung|giu on dinh|quay on dinh|gimbal|stabilizer|zhiyun|weebill|crane)\b/i },
  { id: 'tripod', label: 'tripod', pattern: /\b(tripod|tripid|chan may|chan chup|chan den|gay selfie|phoi sang|bon chan|4 chan|ulanzi mt[- ]?\d+)\b/i },
  { id: 'headphones', label: 'tai nghe', pattern: /\b(tai nghe|headphone|headphones|headset)\b/i },
  { id: 'microphone', label: 'micro', pattern: /\b(micro|mic|microphone|thu am|ghi am|loc tap am|maono|fifine|boya|comica|synco)\b/i },
  { id: 'webcam', label: 'webcam', pattern: /\b(webcam|hop online|goi video|video call)\b/i },
  { id: 'light', label: 'den', pattern: /\b(den\s+(?:quay|chup|led|livestream|studio|san pham|chu the|ulanzi|nanlite|colbor)|(?:ulanzi|nanlite|colbor)\s+den|ring light|tube light|fill light|key light|lighting|bo sung anh sang|anh sang|chieu sang|nanlite|colbor)\b/i },
  { id: 'lens', label: 'lens', pattern: /\b(lens|ong kinh|chup phong canh|chup chan dung|xoa phong|viltrox)\b/i },
  { id: 'filter', label: 'filter', pattern: /\b(filter|kinh loc|nd filter|cpl)\b/i },
  { id: 'monitor', label: 'man hinh phu', pattern: /\b(man hinh phu|monitor|man hinh selfie)\b/i },
  { id: 'bag', label: 'balo/tui', pattern: /\b(balo|backpack|tui may anh|tui dung)\b/i },
  { id: 'fog_machine', label: 'may tao khoi', pattern: /\b(may tao khoi|tao khoi|smoke machine|fog machine|smoke b|filmog)\b/i },
  { id: 'livestream', label: 'thiet bi livestream', pattern: /\b(livestream|live stream|thiet bi live|ban hang online|phat song truc tiep|quay phat truc tiep|video switcher|switcher|capture card|console pad|livepro)\b/i }
]);

function matchingCategories(text = '') {
  const normalized = normalizeTaxonomyText(text);
  return CATEGORY_RULES.filter(rule => rule.pattern.test(normalized));
}

function inferCategory(text = '') {
  return matchingCategories(text)[0]?.id || '';
}

function categoryLabel(category = '') {
  return CATEGORY_RULES.find(rule => rule.id === category)?.label || String(category || '');
}

module.exports = {
  CATEGORY_RULES,
  normalizeTaxonomyText,
  matchingCategories,
  inferCategory,
  categoryLabel
};
