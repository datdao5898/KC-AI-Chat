const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalize,
  queryWords,
  parsePriceNumber,
  searchProducts,
  buildContext,
  matchesRequiredCategory,
  normalizeProductRow
} = require('../src/rag');

test('normalize strips accents and punctuation', () => {
  assert.equal(normalize('Đèn LED Ulanzi!'), 'den led ulanzi');
});

test('queryWords removes stopwords', () => {
  const words = queryWords('anh can tim tripod ulanzi cho dien thoai');
  assert.ok(words.includes('tripod'));
  assert.ok(words.includes('ulanzi'));
  assert.ok(!words.includes('anh'));
});

test('parsePriceNumber reads numeric price text', () => {
  assert.equal(parsePriceNumber('1.390.000đ'), 1390000);
});

test('parsePriceNumber reads Haravan decimal price without adding trailing zero', () => {
  assert.equal(parsePriceNumber('7250000.0'), 7250000);
  assert.equal(parsePriceNumber('220000.00'), 220000);
  assert.equal(parsePriceNumber('1.390.000,00'), 1390000);
});

test('normalizeProductRow maps Vietnamese CSV headers to product fields', () => {
  const product = normalizeProductRow({
    'Tên sản phẩm': 'Đèn LED Video ULANZI VL120 Full Color RGB',
    'Mô tả sản phẩm': 'Đèn LED RGB dùng quay chụp.',
    'Giá': '759000',
    'Kho': '5'
  });

  assert.equal(product.name, 'Đèn LED Video ULANZI VL120 Full Color RGB');
  assert.equal(product.title, product.name);
  assert.equal(product.description, 'Đèn LED RGB dùng quay chụp.');
  assert.equal(product.price, '759000');
  assert.equal(product.gia, '759000');
  assert.equal(product.stock, '5');
});

test('normalizeProductRow maps Haravan training fields to RAG context fields', () => {
  const product = normalizeProductRow({
    sku: 'FN134',
    name: 'NANLITE FS-300B 350W Bi-Color LED Video Light',
    vendor: 'Nanlite',
    price: '7250000.0',
    inventory_quantity: '54',
    stock_hcm: '4',
    stock_hn: '50',
    availability: 'in_stock',
    url: 'https://newlite.vn/products/nanlite-fs-300b',
    description: 'Cong suat 350W, CCT 2700K-6500K.',
    ai_summary: 'gia 7.250.000d. con hang. ton HCM 4, HN 50.'
  });

  assert.equal(product.sku, 'FN134');
  assert.equal(product.brand, 'Nanlite');
  assert.equal(product.inventory_quantity, '54');
  assert.equal(product.stock_hcm, '4');
  assert.equal(product.stock_hn, '50');
  assert.equal(product.stock, '54');
  assert.equal(product.availability, 'in_stock');
  assert.match(product.description, /Cong suat 350W/);
  assert.match(product.description, /ton HCM 4/);
});

test('landscape lens search excludes phone lenses and lens accessories', () => {
  const products = searchProducts(
    'can tu van lens chup phong canh gia duoi 9tr',
    5,
    { sourceKey: 'website/kingcom' }
  );

  assert.ok(products.length > 0);
  assert.ok(products.every(product => parsePriceNumber(product.price) < 9000000));
  assert.ok(products.every(product => !/\b(smartphone|dien thoai|khan|adapter|gia do|support)\b/i.test(normalize(product.name))));
  assert.ok(products.some(product => /\b(viltrox|ong kinh)\b/i.test(normalize(product.name))));
});

test('headphone search excludes microphones and voice amplifiers', () => {
  const products = searchProducts('tai nghe', 8, { sourceKey: 'website/newlite' });

  assert.ok(products.length > 0);
  assert.ok(products.every(product => /\b(tai nghe|headphone|headset)\b/i.test(normalize(product.name || ''))));
  assert.ok(products.every(product => !/\b(may tro giang|micro thu am)\b/i.test(normalize(product.name || ''))));
});

test('short exact model code boosts the matching microphone product', () => {
  const products = searchProducts('chi thay co micro fifine A6v thi sao em', 5, {
    sourceKey: 'website/kingcom'
  });

  assert.ok(products.length > 0);
  assert.equal(products[0].sku, 'FEK61');
  assert.match(products[0].name, /Fifine A6 \/ A6V/i);
});

test('RGB microphone query is not misclassified as a lighting product', () => {
  const products = searchProducts(
    'mua Fifine Ampligame AM8 RGB mic thu am',
    5,
    { sourceKey: 'website/newlite', requireIdentityMatch: true }
  );

  assert.ok(products.length > 0);
  assert.equal(products[0].sku, 'FEK36');
  assert.match(products[0].name, /FIFINE AmpliGame AM8/i);
});

test('explicit RGB lighting query still returns only true light products', () => {
  const products = searchProducts(
    'den LED RGB quay phim',
    5,
    { sourceKey: 'website/newlite', requireIdentityMatch: true }
  );

  assert.ok(products.length > 0);
  assert.ok(products.every(product => /\b(den|led|light)\b/i.test(normalize(product.name || ''))));
  assert.ok(products.every(product => !/\b(mic|micro|microphone|thu am)\b/i.test(normalize(product.name || ''))));
});

test('product specification context includes the matched catalog description', () => {
  const result = buildContext(
    'thong so Cadothy AMAZE 5Pro',
    {
      sourceKey: 'website/newlite',
      topK: 1,
      includeDescriptions: true,
      requireIdentityMatch: true
    }
  );

  assert.equal(result.products.length, 1);
  assert.match(result.products[0].name, /Cadothy AMAZE 5Pro/i);
  assert.match(result.context, /Mo ta va thong so tu catalog:/);
  assert.match(result.context, /\bRAM\b|\bRam\b/);
});

test('product URL retrieves the exact catalog product', () => {
  const products = searchProducts(
    'https://newlite.vn/products/may-tao-khoi-cam-tay-lensgo-smoke-b',
    1,
    { sourceKey: 'website/newlite', requireIdentityMatch: true }
  );

  assert.equal(products[0]?.sku, 'XLS1');
});

test('product URL matches by slug across KingCom and NewLite domains', () => {
  const products = searchProducts(
    'https://newlite.vn/products/boya-by-m100ua-mic-thu-am-danh-cho-may-tinh-win-mac',
    1,
    { sourceKey: 'website/kingcom', requireIdentityMatch: true }
  );

  assert.equal(products[0]?.sku, 'FB334');
  assert.match(products[0]?.url || '', /store\.kingcom\.com\.vn/);
});

test('full product name outranks accessory products with overlapping words', () => {
  const products = searchProducts(
    'May Tao Khoi Cam Tay Lensgo Smoke B thong so',
    3,
    { sourceKey: 'website/newlite', requireIdentityMatch: true }
  );

  assert.equal(products[0]?.sku, 'XLS1');
  assert.match(products[0]?.name || '', /Lensgo Smoke B/i);
  assert.doesNotMatch(normalize(products[0]?.name || ''), /\b(dung dich|binh chua)\b/i);
});

test('same query stays isolated by website source products', () => {
  const kingcomProducts = searchProducts(
    'boya mini',
    1,
    { sourceKey: 'website/kingcom', requireIdentityMatch: true }
  );
  const newliteProducts = searchProducts(
    'boya mini',
    1,
    { sourceKey: 'website/newlite', requireIdentityMatch: true }
  );

  assert.match(kingcomProducts[0]?.url || '', /store\.kingcom\.com\.vn/);
  assert.match(newliteProducts[0]?.url || '', /newlite\.vn/);
  assert.notEqual(kingcomProducts[0]?.url, newliteProducts[0]?.url);
});

test('strict brand fanpages do not return products from another brand', () => {
  const syncoPageProducts = searchProducts(
    'ulanzi tripod',
    3,
    { sourceKey: 'facebook/1184640711390003', requireIdentityMatch: true }
  );
  const viltroxPageProducts = searchProducts(
    'synco mic',
    3,
    { sourceKey: 'facebook/260016447958834', requireIdentityMatch: true }
  );

  assert.deepEqual(syncoPageProducts, []);
  assert.deepEqual(viltroxPageProducts, []);
});

test('required gimbal category excludes frames and gimbal accessories', () => {
  assert.equal(matchesRequiredCategory({ name: 'Ulanzi MA05 Khung chong rung cho dien thoai' }, 'gimbal'), false);
  assert.equal(matchesRequiredCategory({ name: 'Ulanzi R083 Tay cam danh cho DJI Ronin SC2 Gimbal' }, 'gimbal'), false);
  assert.equal(matchesRequiredCategory({ name: 'Zhiyun Weebill 3E Gimbal chong rung' }, 'gimbal'), true);

  const products = searchProducts(
    'gimbal chong rung stabilizer',
    8,
    { sourceKey: 'website/newlite', requiredCategory: 'gimbal' }
  );

  assert.ok(products.length > 0);
  assert.ok(products.every(product => matchesRequiredCategory(product, 'gimbal')));
  assert.ok(products.some(product => /weebill 3e/i.test(product.name || '')));
  assert.ok(products.every(product => !/\b(khung|danh cho .* gimbal)\b/i.test(normalize(product.name || ''))));
});

test('required livestream category keeps core devices and excludes livestream accessories', () => {
  assert.equal(matchesRequiredCategory({ name: 'Cadothy iBig 5S - Thiet bi live stream chuyen nghiep' }, 'livestream'), true);
  assert.equal(matchesRequiredCategory({ name: 'Ulanzi DD02 HD Video Switcher for Live Streaming' }, 'livestream'), true);
  assert.equal(matchesRequiredCategory({ name: 'VIJIM LS08 - Chan de kep canh ban tien loi Livestream' }, 'livestream'), false);
  assert.equal(matchesRequiredCategory({ name: 'Micro livestream USB' }, 'livestream'), false);

  const products = searchProducts(
    'livestream live stream quay phat truc tiep switcher capture card',
    8,
    { sourceKey: 'website/newlite', requiredCategory: 'livestream' }
  );
  assert.ok(products.length > 0);
  assert.ok(products.every(product => matchesRequiredCategory(product, 'livestream')));
  assert.ok(products.some(product => product.sku === 'FG121'));
  assert.ok(products.every(product => !/\b(chan de|micro|den livestream)\b/i.test(normalize(product.name || ''))));
});
