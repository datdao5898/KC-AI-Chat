const test = require('node:test');
const assert = require('node:assert/strict');
const { stockStatus, buildContext } = require('../src/rag');
const { generateReply } = require('../src/ai');

test('stock status is derived without exposing quantities', () => {
  assert.deepEqual(stockStatus({ availability: 'in_stock', inventory_quantity: '48' }), { status: 'in_stock', hcm: '', hn: '' });
  assert.deepEqual(stockStatus({ stock_hcm: '4', stock_hn: '0' }), { status: 'in_stock', hcm: 'in_stock', hn: 'out_of_stock' });
  assert.equal(stockStatus({ inventory_quantity: '-1' }).status, 'out_of_stock');
  assert.equal(stockStatus({}).status, '');
});

test('model context carries stock status, never quantities', () => {
  const result = buildContext('nanlite fs-300b', { sourceKey: 'website/newlite', topK: 1 });
  const context = String(result.context || result);
  assert.match(context, /Tinh trang hang: con hang \(HCM con hang, HN con hang\)/);
  assert.doesNotMatch(context, /Ton kho:|SL \d|HCM \d|HN \d|Tong \d/);
});

test('availability reply says in stock without a quantity', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'Zhiyun Smooth Q2 Bag còn hàng không',
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.match(result.reply, /Tình trạng: còn hàng/);
  assert.doesNotMatch(result.reply, /tồn \d|\(tồn|còn \d+/i);
});
