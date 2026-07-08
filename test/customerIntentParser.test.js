const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCustomerMessage,
  structuredMessageSearchText,
  isBrandOnlyRequest
} = require('../src/customerIntentParser');

test('parses VAT policy question without product intent', () => {
  const parsed = parseCustomerMessage('gia da full VAT chua', {
    sourceKey: 'website/newlite'
  });

  assert.equal(parsed.policy_question, 'vat');
  assert.equal(parsed.product, '');
  assert.equal(parsed.budget, null);
});

test('parses budget follow-up with existing category context', () => {
  const parsed = parseCustomerMessage('co loai nao duoi 1 trieu ko em', {
    sourceKey: 'website/kingcom',
    existingContext: { requested_category: 'microphone' }
  });
  const searchText = structuredMessageSearchText(parsed);

  assert.equal(parsed.category, 'microphone');
  assert.equal(parsed.budget.max, 1000000);
  assert.match(searchText, /microphone/);
  assert.match(searchText, /1000000/);
});

test('parses compatibility target without treating laptop as product', () => {
  const parsed = parseCustomerMessage('Dung cho may laptop khong', {
    sourceKey: 'website/kingcom',
    existingContext: { requested_category: 'microphone' }
  });

  assert.equal(parsed.category, 'microphone');
  assert.equal(parsed.compatibility_target, 'laptop');
  assert.equal(parsed.product, '');
});

test('parses exact brand and model from catalog', () => {
  const parsed = parseCustomerMessage('chi thay co micro Fifine A6v thi sao em', {
    sourceKey: 'website/kingcom'
  });

  assert.match(parsed.product, /Fifine A6/i);
  assert.match(parsed.brand, /FiFine/i);
  assert.equal(parsed.category, 'microphone');
  assert.equal(parsed.product_sku, 'FEK61');
});

test('brand-only messages do not force a product category', () => {
  const parsed = parseCustomerMessage('mua synco', {
    sourceKey: 'website/newlite'
  });

  assert.equal(parsed.brand.toLowerCase(), 'synco');
  assert.equal(parsed.category, '');
  assert.equal(parsed.product, '');
  assert.equal(parsed.signals.brand_only, true);
  assert.equal(isBrandOnlyRequest('toi muon mua san pham Ulanzi', 'Ulanzi'), true);
});

test('parses brand light request as light even with stale microphone context', () => {
  const parsed = parseCustomerMessage('đèn ulanzi có các mẫu nào', {
    sourceKey: 'website/newlite',
    existingContext: { requested_category: 'microphone' }
  });

  assert.equal(parsed.brand.toLowerCase(), 'ulanzi');
  assert.equal(parsed.category, 'light');
  assert.equal(parsed.signals.category_source, 'message');
});

test('parses lighting use-case request as light category', () => {
  const parsed = parseCustomerMessage('ban co san pham chieu sang chu the khong', {
    sourceKey: 'website/newlite',
    existingContext: {
      requested_category: 'gimbal'
    }
  });

  assert.equal(parsed.category, 'light');
  assert.equal(parsed.signals.category_source, 'message');
});

test('parses common tripod typo as tripod category', () => {
  const parsed = parseCustomerMessage('shop co ban tripid 4 chan khong', {
    sourceKey: 'website/newlite',
    existingContext: {
      requested_category: 'microphone'
    }
  });

  assert.equal(parsed.category, 'tripod');
  assert.equal(parsed.signals.category_source, 'message');
});

test('parses smoke machine request as its own category over stale context', () => {
  const parsed = parseCustomerMessage('shop co ban may tao khoi khong', {
    sourceKey: 'website/newlite',
    existingContext: {
      requested_category: 'microphone'
    }
  });

  assert.equal(parsed.category, 'fog_machine');
  assert.equal(parsed.signals.category_source, 'message');
});
