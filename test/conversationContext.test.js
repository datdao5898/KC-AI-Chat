const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveConversationContext,
  contextSearchText,
  buildClarificationReply
} = require('../src/conversationContext');
const { buildSearchQuery } = require('../src/ai');

test('new explicit product replaces the previous product context', () => {
  const context = resolveConversationContext({
    userText: 'M\u00e1y T\u1ea1o Kh\u00f3i C\u1ea7m Tay Lensgo Smoke B th\u00f4ng s\u1ed1 v\u00e0 h\u01b0\u1edbng d\u1eabn s\u1eed d\u1ee5ng',
    history: [
      { sender_type: 'customer', text: 'g\u1eedi cho m\u00ecnh th\u00f4ng s\u1ed1 c\u1ee7a Cadothy AMAZE 5Pro' },
      { sender_type: 'ai', text: 'D\u1ea1 em g\u1eedi th\u00f4ng s\u1ed1 Cadothy AMAZE 5Pro.' }
    ],
    existingContext: {
      current_product_name: 'Cadothy AMAZE 5Pro',
      current_product_sku: 'FG121',
      context_confidence: 0.9
    },
    intent: 'product_specs',
    sourceKey: 'website/newlite'
  });

  assert.match(context.current_product_name, /Lensgo Smoke B/i);
  assert.doesNotMatch(context.current_product_name, /Cadothy/i);
  assert.equal(context.needs_clarification, false);
});

test('contextual follow-up keeps the current product', () => {
  const context = resolveConversationContext({
    userText: 'g\u1eedi tr\u1ef1c ti\u1ebfp qua \u0111\u00e2y nh\u00e9',
    history: [
      { sender_type: 'customer', text: 'th\u00f4ng s\u1ed1 Lensgo Smoke B' },
      { sender_type: 'ai', text: 'Anh/ch\u1ecb mu\u1ed1n em g\u1eedi chi ti\u1ebft qua \u0111\u00e2y kh\u00f4ng?' }
    ],
    existingContext: {
      current_product_name: 'M\u00e1y T\u1ea1o Kh\u00f3i C\u1ea7m Tay Lensgo Smoke B',
      current_product_sku: 'XLS1',
      current_product_url: 'https://newlite.vn/products/may-tao-khoi-cam-tay-lensgo-smoke-b',
      context_confidence: 0.9
    },
    intent: 'product_specs',
    sourceKey: 'website/newlite'
  });
  const query = buildSearchQuery('g\u1eedi tr\u1ef1c ti\u1ebfp qua \u0111\u00e2y nh\u00e9', [], {}, context);

  assert.match(contextSearchText(context), /Lensgo Smoke B/i);
  assert.match(query, /Lensgo Smoke B/i);
  assert.doesNotMatch(query, /Cadothy/i);
});

test('ambiguous product-specific question asks for a model instead of guessing', () => {
  const context = resolveConversationContext({
    userText: 'c\u1ea7n h\u01b0\u1edbng d\u1eabn k\u1ebft n\u1ed1i boya mic nh\u1ecf nh\u1ea5t th\u1ebf gi\u1edbi',
    history: [],
    existingContext: {},
    intent: 'product_search',
    sourceKey: 'website/kingcom'
  });
  const reply = buildClarificationReply(context, 'vi');

  assert.equal(context.needs_clarification, true);
  assert.equal(context.clarification_reason, 'ambiguous_product');
  assert.match(reply, /model/i);
});

test('VAT policy question is not treated as product-specific clarification', () => {
  const context = resolveConversationContext({
    userText: 'gi\u00e1 s\u1ea3n ph\u1ea9m tr\u00ean web bao g\u1ed3m vat ch\u01b0a \u1ea1',
    history: [],
    existingContext: {
      current_product_name: 'M705BSWH Carbon fiber - Miliboo Monopod',
      context_confidence: 0.9
    },
    intent: 'price',
    sourceKey: 'website/kingcom'
  });

  assert.equal(context.needs_clarification, false);
  assert.equal(context.clarification_reason, '');
});

test('missing current product in a follow-up asks for clarification', () => {
  const context = resolveConversationContext({
    userText: 'th\u00f4ng s\u1ed1 c\u1ee7a n\u00f3',
    history: [],
    existingContext: {},
    intent: 'product_specs',
    sourceKey: 'website/newlite'
  });

  assert.equal(context.needs_clarification, true);
  assert.equal(context.clarification_reason, 'missing_current_product');
});
