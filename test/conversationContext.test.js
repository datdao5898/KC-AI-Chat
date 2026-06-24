const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveConversationContext,
  contextSearchText,
  buildClarificationReply,
  isAlternativeProductRequest,
  inferRequestedCategory
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

test('alternative product request preserves the previous product as an exclusion', () => {
  assert.equal(isAlternativeProductRequest('mình muốn tư vấn sản phẩm tai nghe khác'), true);
  assert.equal(isAlternativeProductRequest('còn mẫu nào khác không'), true);
  assert.equal(isAlternativeProductRequest('còn sản phẩm nào khác khoong'), true);

  const context = resolveConversationContext({
    userText: 'mình muốn tư vấn sản phẩm tai nghe khác',
    history: [],
    existingContext: {
      current_product_name: 'BOYA BY-HP2 Tai nghe giám sát',
      current_product_sku: 'FB501',
      current_product_url: 'https://newlite.vn/products/boya-by-hp2',
      current_brand: 'Boya',
      context_confidence: 0.88
    },
    intent: 'product_search',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.equal(context.alternative_product_request, true);
  assert.equal(context.previous_product_sku, 'FB501');
  assert.equal(context.previous_product_name, 'BOYA BY-HP2 Tai nghe giám sát');
  assert.equal(context.needs_clarification, false);
});

test('a new category need clears stale product context', () => {
  assert.equal(
    inferRequestedCategory('toi can tim dung cu giup chup hinh khong bi rung'),
    'gimbal'
  );

  const context = resolveConversationContext({
    userText: 'toi can tim dung cu nao do giup chup hinh khong bi rung',
    history: [],
    existingContext: {
      current_product_name: 'SYNCO XView M4',
      current_product_sku: 'XVIEWM4',
      current_brand: 'Synco',
      context_confidence: 0.9
    },
    intent: 'product_search',
    sourceKey: 'website/newlite'
  });

  assert.equal(context.requested_category, 'gimbal');
  assert.equal(context.new_category_request, true);
  assert.equal(context.current_product_name, undefined);
  assert.equal(context.current_product_sku, undefined);
  assert.equal(context.context_confidence, 0);
});

test('similar product follow-up inherits a category even when the old model is absent', () => {
  const firstContext = resolveConversationContext({
    userText: 'ulanzi mt44 co hang khong',
    history: [],
    existingContext: {},
    intent: 'product_search',
    sourceKey: 'website/newlite'
  });
  const context = resolveConversationContext({
    userText: 'co san pham nao tuong tu khong',
    history: [],
    existingContext: firstContext,
    intent: 'product_search',
    sourceKey: 'website/newlite'
  });

  assert.equal(isAlternativeProductRequest('co san pham nao tuong tu khong'), true);
  assert.equal(context.alternative_product_request, true);
  assert.equal(context.requested_category, 'tripod');
});
