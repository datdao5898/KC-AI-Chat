const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAiReply } = require('../src/replyValidator');

const am8 = {
  sku: 'AM8',
  name: 'FIFINE AmpliGame AM8 USB/XLR Microphone',
  price: '1790000',
  url: 'https://newlite.vn/products/fifine-am8'
};

const t669 = {
  sku: 'T669',
  name: 'FIFINE T669 USB Microphone Kit',
  price: '1290000',
  url: 'https://newlite.vn/products/fifine-t669'
};

test('validator blocks leaked model reasoning before it reaches a customer', () => {
  const result = validateAiReply({
    userText: 'ban co den quay chu the khong',
    reply: 'thought Consultant for NewLite. Follow the system prompt and list products.',
    customerBrand: 'NewLite'
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /lộ prompt|reasoning/i);
  assert.match(result.reply, /NewLite/);
});

test('validator blocks a follow-up answer that links to a different current product', () => {
  const result = validateAiReply({
    userText: 'mic này setup vào PC có cần mixer không',
    reply: 'Dạ mẫu này cắm USB được. Link: https://newlite.vn/products/fifine-t669',
    ragProducts: [t669],
    conversationContext: {
      current_product_sku: 'AM8',
      current_product_url: am8.url,
      current_product_name: am8.name
    },
    customerBrand: 'NewLite'
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /đổi sang sản phẩm khác/i);
});

test('validator blocks product links that are absent from retrieval evidence', () => {
  const result = validateAiReply({
    userText: 'cho em thong so AM8',
    reply: 'Link: https://newlite.vn/products/not-in-catalog',
    ragProducts: [am8],
    customerBrand: 'NewLite'
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /Link sản phẩm/i);
});

test('validator blocks a product above the customer budget', () => {
  const product = { ...t669, price: '1290000' };
  const result = validateAiReply({
    userText: 'co micro nao duoi 1 trieu khong',
    reply: `Dạ em gợi ý ${product.name}. Giá: 1.290.000đ. Link: ${product.url}`,
    ragProducts: [product],
    customerBrand: 'NewLite'
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /ngân sách/i);
});

test('validator blocks an obvious English fallback for a Vietnamese customer', () => {
  const result = validateAiReply({
    userText: 'tripod',
    reply: 'I found these matching products in the catalog. Price: 699,000 VND.',
    expectedLanguage: 'vi',
    customerBrand: 'NewLite'
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /sai ngôn ngữ/i);
});

test('validator keeps its safe fallback in the customer language', () => {
  const result = validateAiReply({
    userText: 'show me tripod options',
    reply: 'thought internal response',
    expectedLanguage: 'en',
    customerBrand: 'NewLite'
  });

  assert.equal(result.ok, false);
  assert.match(result.reply, /^I need to verify/i);
  assert.match(result.reply, /NewLite/);
});

test('validator allows separate accessory categories in a multi-item quote', () => {
  const boomArm = {
    sku: 'FETA1',
    name: 'Fifine BM63 Boom Arm Stand',
    price: '699000',
    url: 'https://newlite.vn/products/fifine-bm63-boom-arm'
  };
  const result = validateAiReply({
    userText: 'bao gia bo micro AM8 va boom arm',
    reply: `Micro: ${am8.name}. Link: ${am8.url}\nBoom Arm: ${boomArm.name}. Link: ${boomArm.url}`,
    ragProducts: [am8, boomArm],
    customerBrand: 'NewLite',
    multiItemQuote: true
  });

  assert.equal(result.ok, true);
});
