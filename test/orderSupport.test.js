const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SOURCES_DIR } = require('../src/sourceRegistry');
const { detectOrderSupportTopic, buildOrderSupportAnswer } = require('../src/orderSupport');
const { classifyIntent } = require('../src/intent');
const { generateReply, detectMessageLanguage } = require('../src/ai');
const { parseSections } = require('../src/knowledgeSections');

const RECEIPT_IMAGE = 'Khách gửi hình ảnh sản phẩm.\n\n[Internal image analysis: Product type: LED light (referenced in receipt; not pictured). Model: K6500. Visible text: ICBC; 备注: THANH TOAN DEN LED K6500. Visual description: An ICBC bank transfer receipt. Its payment note mentions an LED K6500.]';

function faqAnswers(sourceKey) {
  const file = path.join(SOURCES_DIR, ...sourceKey.split('/'), 'faq.md');
  return parseSections(fs.readFileSync(file, 'utf8'))
    .flatMap(section => section.lines)
    .map(line => (line.match(/Trả lời mẫu:\s*"?(.+?)"?$/) || [, line])[1]);
}

test('Zalo messages about an existing order route to order support (log 2026-10-23..27)', () => {
  assert.equal(detectOrderSupportTopic('Chủ nhật tuần rồi tôi có đặt mua đồ trên web'), 'order_tracking');
  assert.equal(detectOrderSupportTopic('Đến nay thứ 3 rồi sao chưa thấy hồi âm hay cập nhật trạng thái đơn hàng'), 'order_delay');
  assert.equal(detectOrderSupportTopic('Kiểm tra giúp tôi mã đơn hàng #101888'), 'order_given');
  assert.equal(detectOrderSupportTopic('Mình gửi UNC bên mình đã đi'), 'payment');
  assert.equal(detectOrderSupportTopic(RECEIPT_IMAGE), 'payment');
  assert.equal(detectOrderSupportTopic('Nhờ bạn kiểm tra và ship hàng giúp mình ha'), 'payment');
  assert.equal(detectOrderSupportTopic('Mình có đặt bên shopee nhưng không tìm thấy chỗ xuất hoá đơn, mình xin xuất hoá đơn bên đây được không ạ?'), 'invoice');
  assert.equal(detectOrderSupportTopic('Bạn oi kế toán bên mình không thấy chi nhánh HCM không'), 'accounting');
  assert.equal(classifyIntent('Chủ nhật tuần rồi tôi có đặt mua đồ trên web').intent, 'order');
});

test('pre-sale questions are not treated as existing orders', () => {
  for (const text of [
    'đặt hàng như thế nào',
    'tôi muốn đặt 2 cái mt44',
    'anh muốn mua 1 cái wbcam này',
    'Có lấy hoá đơn được k',
    'Bên mình có giao hoả tốc và xuất VaT ko ạ',
    'tôi muốn thanh toán khi nhận hàng',
    'shop có ship tỉnh không',
    'ulanzi mt-44m còn hàng không'
  ]) {
    assert.equal(detectOrderSupportTopic(text), null, text);
  }
});

test('order support quotes an FAQ answer of the source and always hands off to staff', () => {
  for (const sourceKey of ['website/kingcom', 'website/newlite']) {
    const answers = faqAnswers(sourceKey);
    for (const text of ['Mình gửi UNC bên mình đã đi', 'Kiểm tra giúp tôi mã đơn hàng #101888', 'shop giao thiếu hàng rồi']) {
      const result = buildOrderSupportAnswer({ userText: text, sourceKey, lang: 'vi' });
      assert.ok(answers.includes(result.reply), `${sourceKey}: ${result.reply}`);
      assert.equal(result.handoff.needed, true);
    }
  }
});

test('order support falls back to the generic after-sale entry, and to nothing without an FAQ', () => {
  const sourceId = `order-support-test-${process.pid}`;
  const dir = path.join(SOURCES_DIR, 'website', sourceId);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, 'faq.md'), '# FAQ\n\n## Sau khi mua hàng\n- Hỏi: Cần hỗ trợ sau khi mua hàng? | Trả lời mẫu: "Mẫu chung sau mua."\n', 'utf8');
    const generic = buildOrderSupportAnswer({ userText: 'Mình gửi UNC rồi', sourceKey: `website/${sourceId}` });
    assert.equal(generic.reply, 'Mẫu chung sau mua.');

    fs.writeFileSync(path.join(dir, 'faq.md'), '# FAQ\n\n## Sản phẩm\n- Không liên quan.\n', 'utf8');
    assert.equal(buildOrderSupportAnswer({ userText: 'Mình gửi UNC rồi', sourceKey: `website/${sourceId}` }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a Chinese bank receipt image does not switch the reply language', async () => {
  assert.equal(detectMessageLanguage(RECEIPT_IMAGE), 'vi');
  const result = await generateReply({
    channel: 'zalo',
    userText: RECEIPT_IMAGE,
    history: [],
    customer: {},
    intent: classifyIntent(RECEIPT_IMAGE).intent,
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website'
  });
  assert.equal(result.aiSource, 'rule_order_support');
  assert.equal(result.handoff.needed, true);
  assert.doesNotMatch(result.reply, /[\u3400-\u9FFF]/);
});
