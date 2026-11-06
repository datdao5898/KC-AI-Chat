const test = require('node:test');
const assert = require('node:assert/strict');

// Policy questions: the code picks the policies.md section, the model answers the actual
// question from that section only; the verbatim quote is the fallback.
process.env.AI_TRACE_LOG = 'false';
const llmClient = require('../src/llmClient');
const prompts = [];
let modelReply = 'Dạ, anh/chị cho em biết sản phẩm cần mua để em xác nhận giá và VAT ạ.';
let modelDown = false;
llmClient.chatCompletion = async request => {
  prompts.push(request.messages.map(message => message.content).join('\n'));
  if (modelDown) throw new Error('model unavailable');
  return modelReply;
};
const { generateReply } = require('../src/ai');
const { detectPolicyTopic } = require('../src/policyAnswers');

const ASK = { history: [], channel: 'haravan_website', customer: {}, sourceKey: 'website/kingcom', sourceName: 'KingCom', sourceGroup: 'website' };

test('a VAT question is answered by the model from the VAT section only', async () => {
  prompts.length = 0;
  modelDown = false;
  const result = await generateReply({ ...ASK, userText: 'giá đã bao gồm VAT chưa', intent: 'general' });
  assert.equal(result.aiSource, 'provider_policy');
  assert.equal(result.reply, modelReply);
  const prompt = prompts.find(text => text.includes('nguồn duy nhất được dùng'));
  assert.ok(prompt, 'the policy prompt was sent');
  assert.match(prompt, /Thông tin cần: tên công ty, mã số thuế/);
  assert.doesNotMatch(prompt, /Dạ, thông tin hóa đơn VAT bên em như sau/);
  assert.match(prompt, /Câu đầu tiên trả lời thẳng điều khách hỏi/);
});

test('the verbatim section is sent when the model is down or replies with a link', async () => {
  modelDown = true;
  const down = await generateReply({ ...ASK, userText: 'xuất hóa đơn VAT được không', intent: 'general' });
  assert.equal(down.aiSource, 'rule_policy');
  assert.match(down.reply, /Thông tin cần: tên công ty/);

  modelDown = false;
  modelReply = 'Dạ xem tại https://example.com ạ.';
  const linked = await generateReply({ ...ASK, userText: 'xuất hóa đơn VAT được không', intent: 'general' });
  assert.equal(linked.aiSource, 'rule_policy');
});

test('installment keeps its approved sentence verbatim', async () => {
  modelDown = false;
  const result = await generateReply({ ...ASK, userText: 'mua hàng trả góp', intent: 'general' });
  assert.equal(result.aiSource, 'rule_policy');
  assert.match(result.reply, /đang tích hợp hình thức thanh toán trả góp/);
});

test('warranty intent without keywords maps to the warranty section, and a defective delivery to returns', () => {
  assert.equal(detectPolicyTopic('máy này sao vậy', 'warranty').id, 'warranty');
  assert.equal(detectPolicyTopic('nhận hàng bị lỗi thì đổi được không').id, 'return');
  assert.equal(detectPolicyTopic('đổi sang mẫu khác được không').id, 'return');
  assert.equal(detectPolicyTopic('tôi muốn đổi thông tin đơn').id, 'order');
});
