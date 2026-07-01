const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAlternativeSearchQuery,
  buildBroaderSearchQuery,
  buildSearchQuery,
  detectMessageLanguage,
  generateReply,
  isBroadConsultationRequest,
  assessRetrievalUncertainty
} = require('../src/ai');
const { normalize, parsePriceNumber } = require('../src/rag');

test('generateReply answers landscape lens starting price from catalog', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'vay lens phong canh co gia tu bao nhieu shop',
    history: [],
    customer: {},
    intent: 'price',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'direct_starting_price_lookup');
  assert.match(result.reply, /2\.290\.000/);
  assert.ok(result.ragProducts.length > 0);
});

test('generateReply uses NewLite identity for NewLite website rules', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'shop ban nhung san pham nao',
    history: [],
    customer: {},
    intent: 'catalog_info',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.match(result.reply, /NewLite/);
  assert.doesNotMatch(result.reply, /\bKingCom\b/);
});

test('generateReply uses configured Facebook brand identity', async () => {
  const result = await generateReply({
    channel: 'facebook',
    userText: 'shop ban nhung san pham nao',
    history: [],
    customer: {},
    intent: 'catalog_info',
    sourceKey: 'facebook/260016447958834',
    sourceName: 'AI Agent Seting Up',
    sourceGroup: 'facebook'
  });

  assert.match(result.reply, /Viltrox/);
  assert.doesNotMatch(result.reply, /\bKingCom\b/);
});

test('generateReply answers NewLite store address from source FAQ', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'địa chỉ cửa hàng ở đâu vậy ạ',
    history: [],
    customer: {},
    intent: 'store_info',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule_source_store_info');
  assert.match(result.reply, /liên hệ hoặc đến các địa chỉ sau/i);
  assert.match(result.reply, /65 Nguyen Minh Hoang/);
  assert.match(result.reply, /96-96B Nguyen Huy Tuong/);
  assert.doesNotMatch(result.reply, /địa chỉ cửa hàng NewLite/i);
  assert.doesNotMatch(result.reply, /phường Bảy Hiền/i);
});

test('generateReply answers warranty policy without provider fallback', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'bảo hành như thế nào shop',
    history: [],
    customer: {},
    intent: 'warranty',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule_policy');
  assert.match(result.reply, /bảo hành/i);
  assert.equal(result.ragProducts.length, 0);
  assert.doesNotMatch(result.reply, /Link:/i);
});

test('brand-only product request asks for clarification instead of guessing a product', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'mua synco',
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext: {
      customer_intent: {
        brand: 'Synco',
        signals: { brand_only: true }
      }
    }
  });

  assert.equal(result.aiSource, 'rule_retrieval_clarification');
  assert.match(result.reply, /nhóm|nhu cầu|model|đang tìm/i);
  assert.doesNotMatch(result.reply, /Link:/i);
});

test('unsupported product reply names the requested outside-category item', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'bên mình có bán cà phê không',
    history: [],
    customer: {},
    intent: 'unsupported',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule');
  assert.match(result.reply, /cà phê/i);
  assert.doesNotMatch(result.reply, /laptop|ThinkPad/i);
});

test('out-of-scope product search does not fall through to unrelated catalog products', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'tôi muốn mua bóp da bò',
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule_out_of_scope_product');
  assert.match(result.reply, /bóp da bò/i);
  assert.equal(result.ragProducts.length, 0);
  assert.doesNotMatch(result.reply, /PHOTOCITY|BOYA|Link:/i);
});

test('English unsupported product reply does not repeat sales verbs as product names', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'do you sell coffee',
    history: [],
    customer: {},
    intent: 'unsupported',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule');
  assert.match(result.reply, /does not sell coffee/i);
  assert.doesNotMatch(result.reply, /sell sell/i);
});

test('short ambiguous message inherits the recent customer language', () => {
  assert.equal(detectMessageLanguage('yes', [
    { sender_type: 'customer', text: 'Please show me the product price' }
  ]), 'en');
  assert.equal(detectMessageLanguage('ok', [
    { sender_type: 'customer', text: 'cho mình xem giá sản phẩm này' }
  ]), 'vi');
});

test('context product leads a follow-up search query', () => {
  const query = buildSearchQuery(
    'có remote không',
    [],
    {},
    {
      current_product_name: 'Ulanzi MT85 Automatic Tripod',
      current_product_sku: 'MT85'
    }
  );

  assert.match(query, /^Ulanzi MT85 Automatic Tripod MT85/i);
});

test('compatibility follow-up reuses category context and recent need', () => {
  const history = [
    {
      sender_type: 'customer',
      text: 'Mic thu am livestream tai nha chong tap am gia re'
    },
    {
      sender_type: 'ai',
      text: 'Da anh/chi xac nhan giup em dung model micro minh dang hoi.'
    }
  ];
  const query = buildSearchQuery(
    'Dung cho may laptop',
    history,
    {},
    { requested_category: 'microphone' }
  );

  assert.match(query, /micro/i);
  assert.match(query, /laptop/i);
  assert.match(query, /livestream/i);
});

test('compatibility follow-up answers compatibility instead of unrelated specs', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'dung cho laptop khong',
    history: [
      { sender_type: 'customer', text: 'co loai micro nao duoi 1 trieu khong' },
      { sender_type: 'ai', text: 'Da em co mot so mau micro phu hop.' }
    ],
    customer: {},
    intent: 'product_specs',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website',
    conversationContext: {
      requested_category: 'microphone',
      context_confidence: 0.6
    }
  });

  assert.equal(result.aiSource, 'direct_catalog_compatibility');
  assert.doesNotMatch(result.reply, /Trọng lượng|Pin|Công suất/i);
  assert.match(result.reply, /laptop|máy tính/i);
});

test('spec follow-up keeps the current product context for height questions', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'cao tối đa bao nhiêu',
    history: [],
    customer: {},
    intent: 'product_specs',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website',
    conversationContext: {
      current_product_name: 'Gậy Selfie Tripod MagSafe Ulanzi MT85 Tự Động Bung Chân',
      current_product_sku: 'FUB87',
      current_product_url: 'https://store.kingcom.com.vn/products/ulanzi-mt85-automatic-pop-up-phone-tripod-magsafe',
      requested_category: 'tripod',
      context_confidence: 0.9
    }
  });

  assert.equal(result.aiSource, 'direct_catalog_product_specs');
  assert.match(result.reply, /MT85/i);
  assert.match(result.reply, /1\.5m|150cm/i);
  assert.doesNotMatch(result.reply, /AT-05/i);
});

test('broader search query keeps source scope and removes conversational filler', () => {
  const query = buildBroaderSearchQuery(
    'anh muốn tìm hiểu về thiết bị này giúp anh',
    { current_product_name: 'Synco Xtalk Master', current_product_sku: 'XTALK' },
    'Synco'
  );

  assert.match(query, /^Synco Xtalk Master XTALK Synco/i);
  assert.doesNotMatch(query, /\banh\b/i);
});

test('broad consultation request asks for clarification without calling provider', async () => {
  assert.equal(isBroadConsultationRequest('cho hỏi về sản phẩm quay phim', 'product_search'), true);
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'cho hỏi về sản phẩm quay phim',
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule_context_clarification');
  assert.match(result.reply, /nhu cầu sử dụng/i);
  assert.equal(result.aiUsed, 0);
});

test('conversation stop request does not call provider or search products', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'ko can ho tro nua',
    history: [],
    customer: {},
    intent: 'general',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website',
    conversationContext: {
      requested_category: 'tripod',
      current_product_name: 'Ulanzi MT85',
      context_confidence: 0.8
    }
  });

  assert.equal(result.aiSource, 'rule_conversation_stop');
  assert.equal(result.aiUsed, 0);
  assert.equal(result.ragProducts.length, 0);
  assert.match(result.reply, /dừng tại đây|dung tai day/i);
});

test('alternative product request returns other catalog products and excludes the previous model', async () => {
  const conversationContext = {
    current_product_name: 'BOYA BY-HP2 – Tai nghe giám sát chuyên nghiệp dành cho Điện thoại / Laptop/ Máy ảnh',
    current_product_sku: 'FB501',
    current_product_url: 'https://newlite.vn/products/boya-by-hp2-df-tai-nghe-giam-sat-chuyen-nghiep-danh-cho-dien-thoai-laptop-may-anh',
    current_brand: 'Boya',
    alternative_product_request: true,
    previous_product_name: 'BOYA BY-HP2 – Tai nghe giám sát chuyên nghiệp dành cho Điện thoại / Laptop/ Máy ảnh',
    previous_product_sku: 'FB501',
    previous_product_url: 'https://newlite.vn/products/boya-by-hp2-df-tai-nghe-giam-sat-chuyen-nghiep-danh-cho-dien-thoai-laptop-may-anh'
  };

  assert.equal(buildAlternativeSearchQuery('còn sản phẩm nào khác không', conversationContext), 'tai nghe');

  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'còn sản phẩm nào khác khoong',
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext
  });

  assert.equal(result.aiSource, 'rule_alternative_products');
  assert.equal(result.aiUsed, 0);
  assert.ok(result.ragProducts.length > 0);
  assert.ok(result.ragProducts.every(product => product.sku !== 'FB501'));
  assert.ok(result.ragProducts.every(product => /\b(tai nghe|headphone|headset)\b/i.test(product.name || '')));
  assert.doesNotMatch(result.reply, /BOYA BY-HP2/i);
  assert.match(result.reply, /Fifine H[369]/i);
});

test('new anti-shake need returns only gimbals and ignores stale product context', async () => {
  const userText = 'toi can tim dung cu nao do giup chup hinh khong bi rung';
  const conversationContext = require('../src/conversationContext').resolveConversationContext({
    userText,
    history: [],
    existingContext: {
      current_product_name: 'SYNCO XView M4',
      current_product_sku: 'XVIEWM4',
      current_brand: 'Synco',
      context_confidence: 0.9
    },
    intent: 'product_search',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  const result = await generateReply({
    channel: 'haravan_website',
    userText,
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext
  });

  assert.equal(result.aiSource, 'rule_need_category_products');
  assert.equal(result.aiUsed, 0);
  assert.ok(result.ragProducts.length > 0);
  assert.ok(result.ragProducts.every(product => /\b(gimbal|weebill|crane|smooth)\b/i.test(product.name || '')));
  assert.ok(result.ragProducts.every(product => !/\bXView M4\b/i.test(product.name || '')));
  assert.match(result.reply, /NewLite/);
});

test('similar request after an unavailable tripod model stays in tripod category', async () => {
  const { resolveConversationContext } = require('../src/conversationContext');
  const firstContext = resolveConversationContext({
    userText: 'ulanzi mt44 co hang khong',
    history: [],
    existingContext: {},
    intent: 'product_search',
    sourceKey: 'website/newlite'
  });
  const userText = 'co san pham nao tuong tu khong';
  const conversationContext = resolveConversationContext({
    userText,
    history: [],
    existingContext: firstContext,
    intent: 'product_search',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.equal(buildAlternativeSearchQuery(userText, conversationContext), 'tripod chan may');

  const result = await generateReply({
    channel: 'haravan_website',
    userText,
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext
  });

  assert.equal(result.aiSource, 'rule_alternative_products');
  assert.ok(result.ragProducts.length > 0);
  assert.ok(result.ragProducts.every(product => /\b(tripod|chan may|chan den|gay selfie|monopod)\b/i.test(normalize(product.name || ''))));
  assert.ok(result.ragProducts.every(product => !/\b(micro|microphone|boya)\b/i.test(product.name || '')));
});

test('livestream category transition and alternative request never return old tripod context', async () => {
  const { resolveConversationContext, updateContextFromReply } = require('../src/conversationContext');
  const firstText = 'tu van thiet bi livestream chuyen nghiep dung ban hang online';
  const firstContext = resolveConversationContext({
    userText: firstText,
    history: [],
    existingContext: {
      requested_category: 'tripod',
      current_product_name: 'ULANZI MT-33',
      current_product_sku: 'FUCAJ',
      context_confidence: 0.98
    },
    intent: 'buy',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });
  const firstReply = await generateReply({
    channel: 'haravan_website',
    userText: firstText,
    history: [],
    customer: {},
    intent: 'buy',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext: firstContext
  });
  const storedContext = updateContextFromReply({
    context: firstContext,
    ragProducts: firstReply.ragProducts,
    reply: firstReply.reply,
    sourceKey: 'website/newlite'
  });
  const secondText = 'con thiet bi nao khac khong';
  const secondContext = resolveConversationContext({
    userText: secondText,
    history: [],
    existingContext: storedContext,
    intent: 'general',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });
  const secondReply = await generateReply({
    channel: 'haravan_website',
    userText: secondText,
    history: [],
    customer: {},
    intent: 'general',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext: secondContext
  });

  const firstSkus = new Set(firstReply.ragProducts.map(product => product.sku));
  assert.equal(firstReply.aiSource, 'rule_need_category_products');
  assert.equal(secondReply.aiSource, 'rule_alternative_products');
  assert.ok(secondReply.ragProducts.length > 0);
  assert.ok(secondReply.ragProducts.every(product => !firstSkus.has(product.sku)));
  assert.ok(secondReply.ragProducts.every(product => !/\btripod|chan may\b/i.test(normalize(product.name || ''))));
});

test('budget follow-up remains constrained to the active category', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'tai chinh duoi 600k',
    history: [],
    customer: {},
    intent: 'general',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext: {
      requested_category: 'gimbal',
      context_confidence: 0.6
    }
  });

  assert.equal(result.aiSource, 'rule_category_no_match');
  assert.equal(result.ragProducts.length, 0);
  assert.match(result.reply, /thiết bị chống rung/i);
  assert.doesNotMatch(result.reply, /Vijim VL120/i);
});

test('budget follow-up reuses microphone context and finds Fifine A6V', async () => {
  const history = [
    {
      sender_type: 'customer',
      text: 'chi muon tu van ve micro thu am de ban, chu yeu cho livestream hoac edit video ma danh cho gaming'
    },
    {
      sender_type: 'ai',
      text: 'Da, voi nhu cau ve micro, KingCom co cac mau phu hop sau.'
    },
    {
      sender_type: 'customer',
      text: 'chi thay co micro fifine A6v thi sao em'
    }
  ];

  const searchQuery = buildSearchQuery(
    'co loai nao duoi 1 trieu ko em',
    history,
    {},
    { requested_category: 'microphone' }
  );
  assert.match(searchQuery, /micro/i);
  assert.match(searchQuery, /fifine/i);

  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'co loai nao duoi 1 trieu ko em',
    history,
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website',
    conversationContext: {
      requested_category: 'microphone',
      context_confidence: 0.6
    }
  });

  assert.equal(result.aiSource, 'direct_budget_lookup');
  assert.ok(result.ragProducts.some(product => product.sku === 'FEK61'));
  assert.ok(result.ragProducts.every(product => parsePriceNumber(product.price || product.gia || '') <= 1000000));
  assert.match(result.reply, /Fifine A6 \/ A6V/i);
  assert.doesNotMatch(result.reply, /SKU:/i);
  assert.doesNotMatch(result.reply, /chưa có micro|chua co micro/i);
});

test('budget product reply never lists products above the requested budget', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'co loai micro nao duoi 1 trieu khong',
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website',
    conversationContext: {
      requested_category: 'microphone',
      context_confidence: 0.6
    }
  });

  assert.equal(result.aiSource, 'direct_budget_lookup');
  assert.ok(result.ragProducts.length > 0);
  assert.ok(result.ragProducts.every(product => parsePriceNumber(product.price || product.gia || '') <= 1000000));
  assert.doesNotMatch(result.reply, /SKU:/i);
  assert.doesNotMatch(result.reply, /2\.390\.000|1\.790\.000|1\.490\.000/);
});

test('budget product reply does not ask for phone again when customer profile has phone', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'co loai micro nao duoi 1 trieu khong',
    history: [],
    customer: { phone: '0944190237' },
    intent: 'product_search',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website',
    conversationContext: {
      requested_category: 'microphone',
      context_confidence: 0.6
    }
  });

  assert.equal(result.aiSource, 'direct_budget_lookup');
  assert.doesNotMatch(result.reply, /xin số điện thoại|để lại số điện thoại|phone number/i);
});

test('exact compact model price lookup resolves MT33 to NewLite MT-33', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'Ulanzi MT33 gia bao nhieu',
    history: [],
    customer: {},
    intent: 'price',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext: {
      requested_category: 'tripod',
      context_confidence: 0.8
    }
  });

  assert.equal(result.aiSource, 'direct_price_lookup');
  assert.ok(result.ragProducts.some(product => product.sku === 'FUCAJ'));
  assert.match(result.reply, /MT-33|MT33/i);
  assert.match(result.reply, /newlite\.vn/);
  assert.doesNotMatch(result.reply, /store\.kingcom\.com\.vn/);
});

test('price extreme lookup respects requested product category', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'tripod re nhat la mau nao',
    history: [],
    customer: {},
    intent: 'price',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext: {
      requested_category: 'tripod',
      context_confidence: 0.8
    }
  });

  assert.equal(result.aiSource, 'direct_price_lookup');
  assert.ok(result.ragProducts.length > 0);
  assert.ok(result.ragProducts.every(product => /tripod|chan|gay selfie|monopod/i.test(normalize(product.name || product.title || ''))));
  assert.doesNotMatch(result.reply, /Dung Dich Tao Khoi|dung dich tao khoi|Lensgo Smoke/i);
  assert.match(result.reply, /newlite\.vn/);
});

test('product URL lookup bypasses mistaken category filter', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'https://newlite.vn/products/synco-xtalk-master',
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext: {}
  });

  assert.notEqual(result.aiSource, 'rule_no_catalog_match');
  assert.equal(result.ragProducts.length, 1);
  assert.equal(result.ragProducts[0].sku, 'C321');
  assert.match(result.reply, /Synco Xtalk Master/i);
  assert.match(result.reply, /newlite\.vn\/products\/synco-xtalk-master/i);
});

test('comparison questions are answered from catalog specs instead of handing off early', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'so sanh Ulanzi MT85 va MT33 giup em',
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website',
    conversationContext: {
      requested_category: 'tripod',
      context_confidence: 0.8
    }
  });

  const replyNorm = normalize(result.reply);
  assert.equal(result.aiSource, 'direct_catalog_comparison');
  assert.match(replyNorm, /ulanzi mt85/);
  assert.match(replyNorm, /mt-33|mt33/);
  assert.match(replyNorm, /so sanh|comparison|compare/);
  assert.doesNotMatch(replyNorm, /nhan vien|staff/);
});

test('subjective product questions answer from catalog facts before escalating', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'ulanzi mt85 nghe on khong',
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website',
    conversationContext: {
      current_product_name: 'Gay Selfie Tripod MagSafe Ulanzi MT85 Tu Dong Bung Chan',
      current_product_sku: 'FUCB8A',
      requested_category: 'tripod',
      context_confidence: 0.9
    }
  });

  const replyNorm = normalize(result.reply);
  assert.equal(result.aiSource, 'direct_catalog_subjective_assessment');
  assert.match(replyNorm, /mt85/);
  assert.match(replyNorm, /20n|25n|150cm|remote bluetooth|385g/);
  assert.doesNotMatch(replyNorm, /nhan vien|staff|phone number/);
});

test('opinion product lookup stays scoped to the active website catalog', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'ulanzi mt85 nghe on khong',
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext: {
      current_product_name: 'Gay Selfie Tripod MagSafe Ulanzi MT85 Tu Dong Bung Chan',
      current_product_sku: 'FUCB8A',
      requested_category: 'tripod',
      context_confidence: 0.9
    }
  });

  assert.notEqual(result.aiSource, 'direct_catalog_subjective_assessment');
  assert.equal(result.ragProducts.length, 0);
  assert.doesNotMatch(result.reply, /store\.kingcom\.com\.vn/i);
});

test('uncertain retrieval asks the customer to confirm category instead of guessing', async () => {
  const uncertainty = assessRetrievalUncertainty({
    userText: 'toi can san pham ho tro quay',
    intent: 'product_search',
    conversationContext: {},
    products: [
      { name: 'Zhiyun Weebill 3E Gimbal', score: 12 },
      { name: 'Ulanzi MT80 Tripod', score: 11 },
      { name: 'BOYA Microphone', score: 10 }
    ]
  });
  assert.equal(uncertainty.reason, 'ambiguous_category');
  assert.deepEqual(uncertainty.categories, ['gimbal', 'tripod', 'microphone']);

  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'toi muon mua san pham ulanzi',
    history: [],
    customer: {},
    intent: 'buy',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext: {}
  });

  assert.equal(result.aiSource, 'rule_retrieval_clarification');
  assert.equal(result.aiUsed, 0);
  assert.equal(result.ragProducts.length, 0);
  assert.equal(result.conversationContext.needs_clarification, true);
  assert.equal(result.conversationContext.clarification_reason, 'ambiguous_category');
  assert.ok(result.conversationContext.clarification_options.length > 0);
  assert.ok(result.conversationContext.clarification_options.every(option => !('description' in option)));
  assert.match(result.reply, /chưa xác định chắc/i);
});

test('clear category or exact model bypasses the uncertainty gate', () => {
  const categorized = assessRetrievalUncertainty({
    userText: 'tu van gimbal',
    intent: 'product_search',
    conversationContext: { requested_category: 'gimbal' },
    products: [
      { name: 'Zhiyun Weebill 3E Gimbal', score: 12 },
      { name: 'Ulanzi MT80 Tripod', score: 11 }
    ]
  });
  const exactModel = assessRetrievalUncertainty({
    userText: 'thong so MT85',
    intent: 'product_specs',
    conversationContext: {},
    products: [
      { name: 'Ulanzi MT85 Tripod', score: 12 },
      { name: 'Ulanzi MT80 Tripod', score: 11 }
    ]
  });

  assert.equal(categorized, null);
  assert.equal(exactModel, null);
});
