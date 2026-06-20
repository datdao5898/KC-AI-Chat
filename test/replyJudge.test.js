const test = require('node:test');
const assert = require('node:assert/strict');
const {
  judgeAiReply,
  approveTrustedSourceStoreInfo,
  buildJudgePrompt,
  judgeUnavailableResult
} = require('../src/replyJudge');

test('trusted source store address is approved without model judgment', async () => {
  const result = await judgeAiReply({
    aiSource: 'rule_source_store_info',
    intent: 'store_info',
    sourceKey: 'website/newlite',
    reply: [
      'Dạ anh/chị có thể liên hệ hoặc đến các địa chỉ sau:',
      '- HCM: 65 Nguyen Minh Hoang, phuong 12, Quan Tan Binh, TP Ho Chi Minh.',
      '- Ha Noi: LK 23-TT1, khu nha o 96-96B Nguyen Huy Tuong, Thanh Xuan, Ha Noi.'
    ].join('\n')
  });

  assert.equal(result.approve, true);
  assert.equal(result.needsHandoff, false);
  assert.equal(result.deterministic, true);
});

test('store address outside source FAQ is not auto-approved', () => {
  const result = approveTrustedSourceStoreInfo({
    aiSource: 'rule_source_store_info',
    intent: 'store_info',
    sourceKey: 'website/newlite',
    reply: 'Dạ địa chỉ là 123 địa chỉ không có trong FAQ.'
  });

  assert.equal(result, null);
});

test('judge prompt uses compact context and active product state', () => {
  const longHistoryText = 'khach hoi rat dai '.repeat(200);
  const longDescription = 'catalog description '.repeat(500);
  const prompt = buildJudgePrompt({
    channel: 'haravan_website',
    userText: 'thong so cua no',
    history: Array.from({ length: 12 }, (_, index) => ({
      sender_type: index % 2 ? 'ai' : 'customer',
      text: `${index}: ${longHistoryText}`
    })),
    reply: 'Da em gui thong so dung san pham.',
    ragProducts: [{
      name: 'May Tao Khoi Cam Tay Lensgo Smoke B',
      sku: 'XLS1',
      vendor: 'Lensgo',
      price: '3390000',
      url: 'https://newlite.vn/products/may-tao-khoi-cam-tay-lensgo-smoke-b',
      description: longDescription
    }],
    intent: 'product_specs',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    customerBrand: 'NewLite',
    aiSource: 'provider_product_specs',
    searchQuery: 'thong so Lensgo Smoke B',
    conversationContext: {
      current_product_name: 'May Tao Khoi Cam Tay Lensgo Smoke B',
      current_product_sku: 'XLS1',
      context_confidence: 0.9
    },
    webSources: [{
      title: 'Official manual',
      url: 'https://example.com/manual',
      content: 'manual content '.repeat(300)
    }]
  });

  assert.match(prompt, /Conversation context state:/);
  assert.match(prompt, /May Tao Khoi Cam Tay Lensgo Smoke B/);
  assert.match(prompt, /\[truncated\]/);
  assert.ok(prompt.length < 12000);
});

test('judge unavailable fallback does not force handoff', () => {
  const result = judgeUnavailableResult('OpenAI returned empty response (finish_reason=length)');

  assert.equal(result.approve, true);
  assert.equal(result.needsHandoff, false);
  assert.equal(result.confidence, 0.2);
  assert.match(result.reason, /Judge unavailable/);
});

test('judge unavailable fallback blocks obvious product drift on follow-up questions', () => {
  const result = judgeUnavailableResult('OpenAI returned empty response (finish_reason=length)', {
    userText: 'có kèm remote không',
    intent: 'general',
    reply: 'NewLite tìm thấy sản phẩm phù hợp: Kingjoy LC-26+LC-15 Ngàm kẹp điện thoại + Remote (SKU: FK139), giá 49.000đ.',
    conversationContext: {
      current_product_name: 'Ulanzi MT-78 Tripod Black',
      current_brand: 'Ulanzi',
      current_source_key: 'website/newlite'
    },
    ragProducts: [{
      name: 'Kingjoy LC-26+LC-15 Ngàm kẹp điện thoại + Remote',
      brand: 'Kingjoy',
      sku: 'FK139'
    }]
  });

  assert.equal(result.approve, false);
  assert.equal(result.needsHandoff, true);
  assert.equal(result.riskType, 'wrong_product');
  assert.match(result.correctedReply, /chuyển thông tin cho nhân viên/i);
});
