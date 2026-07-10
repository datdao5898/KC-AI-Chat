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

test('parses a multi-item quote without treating online meetings as a webcam request', () => {
  const parsed = parseCustomerMessage(
    'Can bao gia bo micro FIFINE AM8, boom arm tai 1kg va pop filter luoi doi de hop online tren laptop Dell. Bao hanh bao lau?',
    { sourceKey: 'website/newlite' }
  );

  assert.equal(parsed.product_sku, 'FEK36');
  assert.equal(parsed.category, 'microphone');
  assert.equal(parsed.multi_item_quote, true);
  assert.equal(parsed.policy_question, 'warranty');
});

test('parses the full Vietnamese multi-item quote wording from a customer', () => {
  const parsed = parseCustomerMessage(
    'Chào shop, mình cần mua bộ micro để học phát âm và họp online trên laptop Dell Inspiron 15 3520. Nhờ shop báo giá giúp các sản phẩm sau: Micro FIFINE AM8 (USB/XLR). Boom Arm kim loại chịu tải từ 1kg trở lên, có quản lý dây, tương thích với AM8. Pop Filter lưới đôi (Double Layer). Nhờ shop xác nhận: Boom Arm có đầy đủ kẹp bàn và đầu chuyển ren để lắp AM8 không? Micro bảo hành bao lâu? Nếu mua trọn bộ có ưu đãi gì không? Shop vui lòng gửi giúp hình ảnh thực tế và báo giá cuối cùng.',
    { sourceKey: 'website/newlite' }
  );

  assert.equal(parsed.product_sku, 'FEK36');
  assert.equal(parsed.category, 'microphone');
  assert.equal(parsed.compatibility_target, 'laptop');
  assert.equal(parsed.multi_item_quote, true);
  assert.equal(parsed.policy_question, 'warranty');
});
