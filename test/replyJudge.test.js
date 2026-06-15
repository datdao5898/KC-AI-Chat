const test = require('node:test');
const assert = require('node:assert/strict');
const { judgeAiReply, approveTrustedSourceStoreInfo } = require('../src/replyJudge');

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
