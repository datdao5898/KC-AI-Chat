const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');

// Real pipeline on an in-memory Postgres: what the customer is told and what lands in their profile.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test@localhost/test';
process.env.AI_TRACE_LOG = 'false';
process.env.REPLY_JUDGE_ENABLED = 'false';
const memoryDb = newDb();
memoryDb.public.registerFunction({
  name: 'nullif',
  args: [DataType.text, DataType.text],
  returns: DataType.text,
  implementation: (value, other) => (value === other ? null : value)
});
require.cache[require.resolve('pg')] = { exports: memoryDb.adapters.createPg() };
require.cache[require.resolve('../src/staffAlert')] = {
  exports: { notifyStaff: async () => {}, notifyNewMessage: async () => {} }
};

const llmClient = require('../src/llmClient');
const modelCalls = [];
const MODEL_REPLY = 'Dạ cửa hàng đang hỗ trợ anh/chị ạ.';
let modelDown = false;
llmClient.chatCompletion = async request => {
  const content = request.messages.map(message => message.content).join('\n');
  if (content.includes('prepare a shop customer')) return '{"language":"vi","vietnamese":""}';
  modelCalls.push(content);
  if (modelDown) throw new Error('model unavailable');
  return MODEL_REPLY;
};

const dbModule = require('../src/db');
const { processIncoming } = require('../src/messagePipeline');
const { changesFor } = require('../scripts/repair-misparsed-customers');

const INVOICE = `Thông tin xuất hoá đơn
Tên công ty: CÔNG TY TNHH MẪU MỘT
Mã số thuế: 0310000017
Địa chỉ công ty: Số 1 Đường Mẫu
Người đại diện: (Bà) NGUYỄN THỊ MẪU
Email nhận hóa đơn điện tử: invoice@example.vn

sản phẩm cần mua: Ulanzi MT-08`;

let nextId = 0;
async function send(externalUserId, text) {
  const sent = [];
  nextId += 1;
  const result = await processIncoming({
    channel: 'haravan_website',
    externalUserId,
    text,
    externalMessageId: `info-${nextId}`,
    raw: { siteName: 'kingcom' },
    testMode: true,
    sendFn: async (user, reply) => { sent.push(reply); return {}; }
  });
  return { result, reply: sent[0] };
}

async function profile(externalUserId) {
  const { rows } = await dbModule.db.query(
    `SELECT * FROM customers WHERE channel='haravan_website' AND external_id=$1`,
    [externalUserId]
  );
  return rows[0];
}

test('the model writes the invoice reply from the recognised details, and the details are saved', async () => {
  await dbModule.initDb();
  modelCalls.length = 0;
  const { reply, result } = await send('invoice-customer', INVOICE);

  assert.equal(reply, MODEL_REPLY);
  assert.equal(result.debug.aiSource, 'provider_customer_info');
  assert.equal(modelCalls.length, 1);
  const prompt = modelCalls[0];
  assert.match(prompt, /- Tên công ty: CÔNG TY TNHH MẪU MỘT/);
  assert.match(prompt, /- Mã số thuế: 0310000017/);
  assert.doesNotMatch(prompt, /Số điện thoại của khách/);
  assert.match(prompt, /sản phẩm cần mua: Ulanzi MT-08/, 'the product request reaches the model');
  assert.match(prompt, /Ulanzi MT-08 Chân Tripod/, 'the catalog product is in the reference data');
  const saved = await profile('invoice-customer');
  assert.equal(saved.phone, '');
  assert.equal(saved.name, '');
  assert.equal(saved.company_name, 'CÔNG TY TNHH MẪU MỘT');
  assert.equal(saved.tax_code, '0310000017');
  assert.equal(saved.invoice_email, 'invoice@example.vn');
  assert.match(saved.company_address, /Đường Mẫu/);
});

test('invoice details keep the phone and name the customer already gave', async () => {
  await dbModule.getOrCreateCustomer('haravan_website', 'known-customer', { name: 'Chị Lan', phone: '0912345678' });
  await send('known-customer', INVOICE);

  const saved = await profile('known-customer');
  assert.equal(saved.phone, '0912345678');
  assert.equal(saved.name, 'Chị Lan');
  assert.equal(saved.tax_code, '0310000017');
});

test('a real phone next to a tax code is saved as the phone', async () => {
  await send('both-customer', `${INVOICE}\nSĐT: 0912345678`);

  assert.match(modelCalls.at(-1), /- Số điện thoại của khách: 0912345678/);
  const saved = await profile('both-customer');
  assert.equal(saved.phone, '0912345678');
  assert.equal(saved.tax_code, '0310000017');
});

test('"this is not a phone number" removes the number and keeps it as the tax code', async () => {
  await dbModule.getOrCreateCustomer('haravan_website', 'corrected-customer', { phone: '0310000017' });
  const { reply, result } = await send('corrected-customer', 'số này không phải sdt');

  assert.equal(reply, MODEL_REPLY);
  assert.equal(result.debug.aiSource, 'provider_customer_info');
  assert.match(modelCalls.at(-1), /Hệ thống đã bỏ số đó khỏi thông tin liên hệ/);
  assert.match(modelCalls.at(-1), /Hồ sơ khách chưa có số điện thoại/, 'the model sees the phone is gone');
  const saved = await profile('corrected-customer');
  assert.equal(saved.phone, '');
  assert.equal(saved.tax_code, '0310000017');
  assert.equal(result.ok, true);
});

test('a correction does not turn a real mobile number into a tax code', async () => {
  await dbModule.getOrCreateCustomer('haravan_website', 'mobile-corrected', { phone: '0912345678' });
  await send('mobile-corrected', 'số đó không phải số điện thoại của mình');

  const saved = await profile('mobile-corrected');
  assert.equal(saved.phone, '');
  assert.equal(saved.tax_code, '');
});

test('a saved "phone" that the customer now gives as their tax code is removed', async () => {
  await dbModule.getOrCreateCustomer('haravan_website', 'polluted-customer', { phone: '0310000017' });
  await send('polluted-customer', 'Mã số thuế: 0310000017');

  const saved = await profile('polluted-customer');
  assert.equal(saved.phone, '');
  assert.equal(saved.tax_code, '0310000017');
});

test('the model is told what is on file and that a tax code is not a phone', async () => {
  await send('invoice-customer', 'shop ơi cuối tuần có làm việc không');

  const answer = modelCalls.at(-1);
  assert.match(answer, /mã số thuế: 0310000017/);
  assert.match(answer, /không phải số điện thoại/);
  assert.match(answer, /Tên công ty không phải tên khách/);
});

test('when the model is down the customer still gets a correct reply', async () => {
  modelDown = true;
  try {
    const invoice = await send('outage-invoice', INVOICE);
    assert.match(invoice.reply, /thông tin xuất hóa đơn của CÔNG TY TNHH MẪU MỘT \(MST 0310000017\)/);
    assert.equal(invoice.result.debug.aiSource, 'fallback');

    const correction = await send('outage-correction', 'số này không phải sdt');
    assert.match(correction.reply, /nhận nhầm số/);
  } finally {
    modelDown = false;
  }
});

test('repair script: fixes misread profiles and leaves good ones alone', () => {
  const misread = changesFor(
    { name: 'chi cong', phone: '0310000017', company_name: '', tax_code: '', company_address: '', invoice_email: '' },
    [INVOICE]
  );
  assert.equal(misread.phone, '');
  assert.equal(misread.name, '');
  assert.equal(misread.tax_code, '0310000017');
  assert.equal(misread.company_name, 'CÔNG TY TNHH MẪU MỘT');

  assert.deepEqual(changesFor({ name: 'Chị Lan', phone: '0912345678' }, ['anh muốn mua tripod']), {});
  // An odd prefix the customer explicitly called their phone stays.
  assert.deepEqual(changesFor({ name: 'Bình', phone: '0110000002' }, ['sdt: 0110000002']), {});
});
