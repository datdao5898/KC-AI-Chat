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

test('classifyIntent handles product specification questions', () => {
  assert.equal(
    classifyIntent('g\u1eedi cho m\u00ecnh th\u00f4ng s\u1ed1 c\u1ee7a Cadothy AMAZE 5Pro').intent,
    'product_specs'
  );
  assert.equal(classifyIntent('Cadothy AMAZE 5Pro c\u00f3 RAM bao nhi\u00eau').intent, 'product_specs');
  assert.equal(classifyIntent('camera n\u00e0y c\u00f3 \u0111\u1ed9 ph\u00e2n gi\u1ea3i bao nhi\u00eau').intent, 'product_specs');
  assert.equal(classifyIntent('Ulanzi MT85 cao bao nhi\u00eau m').intent, 'product_specs');
  assert.equal(classifyIntent('m\u1eabu n\u00e0y d\u00f9ng \u0111\u01b0\u1ee3c cho iPhone kh\u00f4ng').intent, 'product_specs');
  assert.equal(classifyIntent('Cadothy AMAZE 5Pro \u7684\u6280\u672f\u53c2\u6570').intent, 'product_specs');
});
