const test = require('node:test');
const assert = require('node:assert/strict');
const { modelCodes, searchProducts } = require('../src/rag');

const KC = { sourceKey: 'website/kingcom' };
const NL = { sourceKey: 'website/newlite' };

function topName(query, options) {
  return String(searchProducts(query, 3, options)[0]?.name || '(none)');
}

test('model codes ignore separators and join a short word with its number', () => {
  assert.deepEqual(modelCodes('Ulanzi MT-44B').hard, ['mt44b']);
  assert.deepEqual(modelCodes('ulanzi mt44b còn hàng không').hard, ['mt44b']);
  assert.deepEqual(modelCodes('Boya Mini 2 kết nối iPhone').soft, ['mini2']);
  assert.deepEqual(modelCodes('tay cầm ulanzi BG 2').soft, ['bg2']);
  assert.deepEqual(modelCodes('pin 4800mAh tải 2kg giá 1tr').hard, []);
});

test('a model typed without hyphen still finds the catalog product (log: mt44b)', () => {
  assert.match(topName('ulanzi mt44b còn hàng không', KC), /MT-44B/);
  assert.match(topName('ulanzi mt-44b còn hàng không', KC), /MT-44B/);
});

test('model name outranks device words in the question (log: Boya Mini 2 + iPhone)', () => {
  assert.match(topName('Boya Mini 2 kết nối iPhone như thế nào?', KC), /BOYA Mini 2/i);
  assert.match(topName('hướng dẫn cách kết nối Boya Mini 2', KC), /BOYA Mini 2/i);
  assert.match(topName('mic cho iphone', KC), /iPhone/i);
});

test('separated model numbers and monolights are found (log: BG 2, COLBOR W60/W100)', () => {
  assert.match(topName('Mình muốn mua tay cầm ulanzi BG 2', NL), /BG-2/);
  assert.match(topName('shop cho mình hỏi đền COLBOR Wonder W60 có thể sử dụng npf battery để chiếu sáng không shop', NL), /W60/);
  assert.match(topName('Còn đèn colbor w100 ko ạ', NL), /W100/);
});

test('a pasted product link is not dropped by category heuristics (log: VL200)', () => {
  const url = 'https://store.kingcom.com.vn/products/ulanzi-vl200-bi-color-2500-9000k-den-led-2-mau-tich-hop-pin-5000mah-co-the-sac-lai';
  assert.match(topName(url, KC), /VL200/);
});
