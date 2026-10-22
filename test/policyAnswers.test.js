const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SOURCES_DIR } = require('../src/sourceRegistry');
const { buildPolicyAnswer, detectPolicyTopic, storeIntroLines } = require('../src/policyAnswers');
const { generateReply } = require('../src/ai');

function withTempSource(files, fn) {
  const sourceId = `policy-test-${process.pid}`;
  const dir = path.join(SOURCES_DIR, 'website', sourceId);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content, 'utf8');
  try {
    return fn(`website/${sourceId}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('warranty answer quotes the policies.md section of the source', () => {
  const result = buildPolicyAnswer({ userText: 'bảo hành bao lâu shop', sourceKey: 'website/kingcom', lang: 'vi' });

  assert.equal(result.topic, 'warranty');
  assert.match(result.reply, /thân máy 12 tháng \+ 1 tháng, phụ kiện 3 tháng \+ 1 tháng/);
  assert.equal(result.handoff.needed, false);
});

test('real log questions route to the right policy section', () => {
  assert.equal(detectPolicyTopic('Anh không còn hoá đơn, hoá đơn bị thất lạc đâu rồi').id, 'warranty');
  assert.equal(detectPolicyTopic('tôi muốn thanh toán khi nhận hàng').id, 'payment');
  assert.equal(detectPolicyTopic('giá này đã bao gồm vận chuyển đúng không').id, 'shipping');
  assert.equal(detectPolicyTopic('xuất hóa đơn VAT được không').id, 'vat');
  assert.equal(detectPolicyTopic('kiểm tra hàng tồn'), null);

  const lostInvoice = buildPolicyAnswer({ userText: 'Anh không còn hoá đơn, hoá đơn bị thất lạc đâu rồi', sourceKey: 'website/kingcom', lang: 'vi' });
  assert.match(lostInvoice.reply, /mất hóa đơn, bên em vẫn kiểm tra được qua số điện thoại, mã đơn hoặc serial/);
});

test('source without a policy section hands off instead of borrowing another brand policy', () => {
  const result = buildPolicyAnswer({ userText: 'bảo hành bao lâu', sourceKey: 'website/newlite', lang: 'vi', customerBrand: 'NewLite' });

  assert.match(result.reply, /chưa có thông tin về bảo hành/);
  assert.doesNotMatch(result.reply, /12 tháng/);
  assert.equal(result.handoff.needed, true);
});

test('"Chính sách ..." headings and paragraph text are supported', () => {
  const result = buildPolicyAnswer({ userText: 'bảo hành thế nào', sourceKey: 'facebook/260016447958834', lang: 'vi', customerBrand: 'Viltrox' });

  assert.match(result.reply, /bảo hành giới hạn 1 năm/);
});

test('editing markdown changes the answer and internal lines are never quoted', () => {
  withTempSource({
    'policies.md': [
      '# Chính sách',
      '## Giao hàng',
      '- Giao toàn quốc trong 2-4 ngày.',
      '- [nội bộ] Không tự báo phí ship.',
      '## Bảo hành',
      '- Bảo hành 6 tháng.'
    ].join('\n'),
    'faq.md': '# FAQ\n## Giới thiệu cửa hàng\n- Shop chuyên đèn studio.'
  }, sourceKey => {
    const shipping = buildPolicyAnswer({ userText: 'ship mất bao lâu', sourceKey, lang: 'vi' });
    assert.match(shipping.reply, /Giao toàn quốc trong 2-4 ngày/);
    assert.doesNotMatch(shipping.reply, /nội bộ|phí ship/);

    assert.deepEqual(storeIntroLines(sourceKey), ['Shop chuyên đèn studio.']);
  });
});

test('generateReply answers policy and unsupported product from markdown', async () => {
  const payload = { channel: 'haravan_website', history: [], customer: {}, sourceKey: 'website/kingcom', sourceName: 'KingCom', sourceGroup: 'website' };

  const payment = await generateReply({ ...payload, userText: 'tôi muốn thanh toán khi nhận hàng', intent: 'general' });
  assert.equal(payment.aiSource, 'rule_policy');
  assert.match(payment.reply, /thanh toán khi nhận hàng \(COD\), chuyển khoản và thanh toán online \(VNPay\)/);

  const unsupported = await generateReply({ ...payload, userText: 'shop có bán laptop thinkpad không', intent: 'unsupported' });
  assert.match(unsupported.reply, /chưa kinh doanh laptop\/ThinkPad/);
  assert.match(unsupported.reply, /chuyên phụ kiện nhiếp ảnh, quay phim, livestream và thiết bị sáng tạo nội dung chính hãng 100%/);
});
