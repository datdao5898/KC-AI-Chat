const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAlternativeSearchQuery,
  buildBroaderSearchQuery,
  buildSearchQuery,
  detectMessageLanguage,
  generateReply,
  sanitizeProviderReply,
  isBroadConsultationRequest,
  assessRetrievalUncertainty,
  buildCompatibilityEvidenceReply,
  buildReplacementPartReply,
  buildTechnicalSupportReply
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

test('generateReply answers KingCom store address and hotline from verified contacts', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'địa chỉ cửa hàng ở đâu vậy ạ',
    history: [],
    customer: {},
    intent: 'store_info',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule_source_store_info');
  assert.match(result.reply, /65 Nguyễn Minh Hoàng, Phường Bảy Hiền \(Phường 12, Quận Tân Bình cũ\)/);
  assert.match(result.reply, /0903 898 478/);
  assert.match(result.reply, /96-96B Nguyễn Huy Tưởng/);
  assert.match(result.reply, /070 447 1438/);
});

test('generateReply does not give KingCom contacts to NewLite before they are verified', async () => {
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
  assert.doesNotMatch(result.reply, /Nguyễn Minh Hoàng|0903 898 478/);
  assert.match(result.reply, /chuyển nhân viên/);
});

test('generateReply answers a hotline request with verified hotlines instead of a generic handoff', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'Hotline',
    history: [],
    customer: {},
    intent: 'human',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule_source_store_info');
  assert.match(result.reply, /0903 898 478/);
  assert.match(result.reply, /070 447 1438/);
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

test('short numbered product list item inherits the recent customer language', () => {
  assert.equal(detectMessageLanguage('3. Tripod adapter', [
    { sender_type: 'customer', text: 'bên mình còn các mặt hàng nào vậy em' }
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

test('availability follow-up uses the current product instead of stale category context', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'còn hàng không shop',
    history: [],
    customer: {},
    intent: 'buy',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website',
    conversationContext: {
      requested_category: 'microphone',
      current_product_name: 'Ống kính Viltrox AF 28mm F4.5 Full-Frame Lens for Sony FE-Mount',
      current_product_sku: 'FVS32',
      current_product_url: 'https://store.kingcom.com.vn/products/viltrox-af-28mm-f4-5-full-frame-lens-for-sony-e-mount',
      context_confidence: 0.92
    }
  });

  assert.equal(result.aiSource, 'direct_availability_lookup');
  assert.equal(result.ragProducts[0]?.sku, 'FVS32');
  assert.match(result.reply, /Viltrox AF 28mm F4\.5/i);
  assert.doesNotMatch(result.reply, /Alvoxcon|TG220|MAONO PD200X/i);
});

test('availability query with a new product category does not reuse stale current product', () => {
  const query = buildSearchQuery(
    'shop co ban tripid 4 chan khong',
    [],
    {},
    {
      requested_category: 'microphone',
      current_product_name: 'MAONO PD200X / Mic thu am Dynamic',
      current_product_sku: 'M221',
      current_product_url: 'https://newlite.vn/products/maono-pd200x'
    }
  );

  assert.match(query, /tripid 4 chan/i);
  assert.doesNotMatch(query, /MAONO|PD200X|M221/i);
});

test('generic availability follow-up still reuses the current product', () => {
  const query = buildSearchQuery(
    'con hang khong shop',
    [],
    {},
    {
      requested_category: 'lens',
      current_product_name: 'Viltrox AF 28mm F4.5 Full-Frame Lens',
      current_product_sku: 'FVS32'
    }
  );

  assert.match(query, /Viltrox AF 28mm/i);
  assert.match(query, /FVS32/i);
});

test('new lighting request does not carry stale gimbal context into search', () => {
  const query = buildSearchQuery(
    'ban co san pham chieu sang chu the khong',
    [],
    {},
    {
      requested_category: 'light',
      new_category_request: true,
      current_product_name: '',
      customer_intent: {
        category: 'light',
        signals: { category_source: 'message' }
      }
    }
  );

  assert.match(query, /den led light/i);
  assert.match(query, /chieu sang/i);
  assert.doesNotMatch(query, /gimbal/i);
});

test('smoke machine request ignores stale tripod or microphone context', async () => {
  const tripodContextResult = await generateReply({
    channel: 'haravan_website',
    userText: 'minh muon mua may tao khoi shop co ban khong',
    history: [],
    customer: {},
    intent: 'buy',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext: {
      requested_category: 'tripod',
      current_product_name: 'Tay Arm Ulanzi TH04 - Gia do Camera',
      current_product_sku: 'FUMH2',
      context_confidence: 0.86
    }
  });

  assert.equal(tripodContextResult.aiSource, 'rule_need_category_products');
  assert.match(tripodContextResult.searchQuery, /fog_machine|may tao khoi/i);
  assert.ok(tripodContextResult.ragProducts.length > 0);
  assert.ok(tripodContextResult.ragProducts.every(product => /tao khoi|smoke|fog|filmog/i.test(normalize(`${product.name || ''} ${product.title || ''}`))));
  assert.doesNotMatch(tripodContextResult.reply, /Tay Arm|TH04|Mic thu/i);

  const microphoneContextResult = await generateReply({
    channel: 'haravan_website',
    userText: 'shop co ban may tao khoi khong',
    history: [],
    customer: {},
    intent: 'buy',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website',
    conversationContext: {
      requested_category: 'microphone',
      current_product_name: 'Fifine T669 Mic thu am Streaming',
      current_product_sku: 'K999',
      context_confidence: 0.86
    }
  });

  assert.equal(microphoneContextResult.aiSource, 'rule_need_category_products');
  assert.ok(microphoneContextResult.ragProducts.length > 0);
  assert.ok(microphoneContextResult.ragProducts.every(product => /tao khoi|smoke|fog|filmog/i.test(normalize(`${product.name || ''} ${product.title || ''}`))));
  assert.doesNotMatch(microphoneContextResult.reply, /Fifine|BOYA|Micro Thu/i);
});

test('provider reply sanitizer blocks leaked reasoning or prompt text', () => {
  const leaked = 'thought Consultant for NewLite. Khach hoi: ban co san pham chieu sang chu the khong. Quy tac: chi tra loi theo du lieu.';
  assert.equal(
    sanitizeProviderReply(leaked, 'Dạ NewLite có các mẫu đèn phù hợp trong catalog ạ.'),
    'Dạ NewLite có các mẫu đèn phù hợp trong catalog ạ.'
  );
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
  assert.match(result.ragProducts[0].url || '', /newlite\.vn\/products\/synco-xtalk-master/i);
  assert.match(result.reply, /Synco Xtalk Master/i);
  assert.match(result.reply, /newlite\.vn\/products\/synco-xtalk-master/i);
});

test('numbered product item resolves TH04 by product identity, not description mention', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'bên mình còn các mặt hàng: 1. Tay Arm Ulanzi TH04 - Giá đỡ Camera',
    history: [],
    customer: {},
    intent: 'price',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website',
    conversationContext: {}
  });

  assert.equal(result.aiSource, 'direct_product_list_lookup');
  assert.ok(result.ragProducts.some(product => product.sku === 'FUMH2'));
  assert.match(result.reply, /Tay Arm Ulanzi TH04/i);
  assert.match(result.reply, /2\.290\.000/);
  assert.doesNotMatch(result.reply, /MA50|Uka M039/i);
});

test('numbered product list answers each requested item without drifting to unrelated products', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: [
      'bên mình còn các mặt hàng:',
      '1. Tay Arm Ulanzi TH04 - Giá đỡ Camera',
      '2. thẻ nhớ máy ảnh 128 sandisk',
      '3. Tripod adapter'
    ].join('\n'),
    history: [],
    customer: {},
    intent: 'product_search',
    sourceKey: 'website/kingcom',
    sourceName: 'KingCom',
    sourceGroup: 'website',
    conversationContext: {}
  });

  assert.equal(result.aiSource, 'direct_product_list_lookup');
  assert.ok(result.ragProducts.some(product => product.sku === 'FUMH2'));
  assert.ok(result.ragProducts.some(product => /Tripod bowl adapter/i.test(product.name || product.title || '')));
  assert.match(result.reply, /Tay Arm Ulanzi TH04/i);
  assert.match(result.reply, /Tripod bowl adapter/i);
  assert.match(result.reply, /sandisk[\s\S]*chưa tìm thấy/i);
  assert.doesNotMatch(result.reply, /MA50|Uka M039|Saramonic|Ulanzi V6/i);
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

test('multi-item quote request answers catalog items before handing off commercial details', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'Bao gia bo micro FIFINE AM8 USB XLR, boom arm tai tren 1kg va pop filter luoi doi. Dung voi laptop Dell duoc khong? Boom arm co kep ban va dau chuyen ren khong? Bao hanh bao lau, co uu dai tron bo va hinh thuc te khong?',
    history: [],
    customer: {},
    intent: 'product_specs',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule_multi_item_quote_handoff');
  assert.deepEqual(result.ragProducts.map(product => product.sku), ['FEK36', 'FETA1']);
  assert.match(result.reply, /FIFINE AmpliGame AM8/i);
  assert.match(result.reply, /BM63 Boom Arm/i);
  assert.match(result.reply, /Pop Filter lưới đôi: em chưa tìm thấy mẫu bán rời/i);
  assert.match(result.reply, /Tạm tính các món đã tìm thấy: 2\.089\.000đ/i);
  assert.match(result.reply, /Kết nối máy tính: catalog của .*AM8.* ghi có kết nối USB/i);
  assert.match(result.reply, /screw adapter 5\/8/i);
  assert.match(result.reply, /Bảo hành: dữ liệu chính sách hiện chưa có thông tin/i);
  assert.doesNotMatch(result.reply, /Dell|không cần mixer|cả hai sản phẩm|riêng cho AM8/i);
  assert.doesNotMatch(result.reply, /Default Title/i);
  assert.equal(result.handoff?.needed, true);
});

test('full Vietnamese multi-item quote is not rejected because laptop is a compatibility target', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'Chào shop, mình cần mua bộ micro để học phát âm và họp online trên laptop Dell Inspiron 15 3520. Nhờ shop báo giá giúp các sản phẩm sau: Micro FIFINE AM8 (USB/XLR). Boom Arm kim loại chịu tải từ 1kg trở lên, có quản lý dây, tương thích với AM8. Pop Filter lưới đôi (Double Layer). Nhờ shop xác nhận: Boom Arm có đầy đủ kẹp bàn và đầu chuyển ren để lắp AM8 không? Micro bảo hành bao lâu? Nếu mua trọn bộ có ưu đãi gì không? Shop vui lòng gửi giúp hình ảnh thực tế và báo giá cuối cùng.',
    history: [],
    customer: {},
    intent: 'product_specs',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule_multi_item_quote_handoff');
  assert.deepEqual(result.ragProducts.map(product => product.sku), ['FEK36', 'FETA1']);
  assert.match(result.reply, /FIFINE AmpliGame AM8/i);
  assert.match(result.reply, /BM63 Boom Arm/i);
  assert.match(result.reply, /Tạm tính các món đã tìm thấy: 2\.089\.000đ/i);
  assert.match(result.reply, /Kết nối máy tính: catalog của .*AM8.* ghi có kết nối USB/i);
  assert.doesNotMatch(result.reply, /Dell|không cần mixer|cả hai sản phẩm/i);
  assert.equal(result.handoff?.needed, true);
});


test('generateReply apologizes and escalates when staff have not contacted the customer', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'sao ko ai lien he minh v shop?',
    history: [],
    customer: { phone: '0900000000' },
    intent: 'human',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule_human_handoff');
  assert.match(result.reply, /xin l\u1ed7i/i);
  assert.match(result.reply, /ch\u01b0a li\u00ean h\u1ec7/i);
  assert.match(result.reply, /NewLite/);
  assert.doesNotMatch(result.reply, /nh\u00f3m s\u1ea3n ph\u1ea9m|s\u1ea3n ph\u1ea9m n\u00e0o/i);
});

test('technical charging issue quotes the FAQ technical section instead of price', async () => {
  const result = await buildTechnicalSupportReply({
    userText: 's\u1ea1c 1 ti\u1ebfng m\u00e0 pin v\u1eabn 68%',
    sourceKey: 'website/kingcom',
    lang: 'vi',
    customerBrand: 'KingCom',
    conversationContext: {}
  });

  assert.match(result.reply, /Kh\u00f4ng l\u00ean ngu\u1ed3n: anh\/ch\u1ecb ki\u1ec3m tra ngu\u1ed3n \u0111i\u1ec7n, d\u00e2y v\u00e0 pin/);
  assert.equal(result.handoff.needed, true);
  assert.doesNotMatch(result.reply, /Gi\u00e1:|Link:|30 ph\u00fat/i);
});

test('technical issue without FAQ technical section hands off to staff', async () => {
  const result = await buildTechnicalSupportReply({
    userText: 's\u1ea1c 1 ti\u1ebfng m\u00e0 pin v\u1eabn 68%',
    sourceKey: 'website/newlite',
    lang: 'vi',
    customerBrand: 'NewLite',
    conversationContext: {}
  });

  assert.match(result.reply, /chuy\u1ec3n v\u1ea5n \u0111\u1ec1 k\u1ef9 thu\u1eadt n\u00e0y cho nh\u00e2n vi\u00ean NewLite/);
  assert.equal(result.handoff.needed, true);
});

test('cable compatibility requires evidence for every requested connector', () => {
  const product = {
    name: 'Micro USB cho m\u00e1y t\u00ednh',
    description: 'Ph\u1ee5 ki\u1ec7n k\u00e8m theo c\u00f3 c\u00e1p USB-C to USB-A \u0111\u1ec3 k\u1ebft n\u1ed1i PC.',
    url: 'https://example.com/products/micro-usb'
  };
  const reply = buildCompatibilityEvidenceReply(
    [product],
    'C\u00f3 \u0111\u00fang c\u00e1p USB-C sang USB-A \u0111\u1ec3 c\u1eafm m\u00e1y t\u00ednh b\u00e0n kh\u00f4ng?',
    'vi'
  );

  assert.match(reply, /D\u1ea1 c\u00f3/i);
  assert.match(reply, /USB-C.*USB-A/i);
});

test('replacement receiver request never falls back to unrelated microphone systems', () => {
  const result = buildReplacementPartReply(
    'mua receiver RX r\u1eddi thay th\u1ebf cho Comica EJoy Uni Pro',
    'website/newlite',
    'vi',
    'NewLite'
  );

  assert.ok(result);
  assert.doesNotMatch(result.reply, /LARK MAX|VIMO S-UC|BOYA Mini/i);
  if (!result.products.length) {
    assert.equal(result.handoff.needed, true);
    assert.match(result.reply, /kh\u00f4ng c\u00f3 ngh\u0129a.*h\u1ebft h\u00e0ng/i);
  }
});

test('product warranty wording always routes to policy instead of product description', async () => {
  const result = await generateReply({
    channel: 'haravan_website',
    userText: 'ch\u00ednh s\u00e1ch b\u1ea3o h\u00e0nh c\u1ee7a s\u1ea3n ph\u1ea9m n\u00e0y nh\u01b0 th\u1ebf n\u00e0o?',
    history: [],
    customer: {},
    intent: 'warranty',
    sourceKey: 'website/newlite',
    sourceName: 'NewLite',
    sourceGroup: 'website'
  });

  assert.equal(result.aiSource, 'rule_policy');
  assert.match(result.reply, /b\u1ea3o h\u00e0nh/i);
  assert.equal(result.ragProducts.length, 0);
  assert.doesNotMatch(result.reply, /Link:/i);
});
