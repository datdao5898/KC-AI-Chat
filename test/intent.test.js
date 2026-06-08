const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../src/intent');

test('classifyIntent handles common greeting', () => {
  assert.equal(classifyIntent('xin chao').intent, 'greeting');
});

test('classifyIntent handles price questions', () => {
  assert.equal(classifyIntent('gia bao nhieu vay').intent, 'price');
});

test('classifyIntent handles human requests', () => {
  assert.equal(classifyIntent('goi toi so 0909123456').intent, 'human');
});

test('classifyIntent handles warranty and policy questions', () => {
  assert.equal(classifyIntent('full vat chua').intent, 'warranty');
});

test('classifyIntent handles product search', () => {
  assert.equal(classifyIntent('looking for mobile tripod').intent, 'product_search');
});
