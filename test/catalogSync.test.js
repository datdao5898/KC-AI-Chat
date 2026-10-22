const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SOURCES_DIR } = require('../src/sourceRegistry');
const { htmlToText, mapProduct, syncSourceCatalog } = require('../src/catalogSync');
const { loadProducts } = require('../src/rag');

const STORE = 'https://shop.example.test';

function haravanProduct(id, overrides = {}) {
  return {
    id,
    handle: `product-${id}`,
    title: `Sản phẩm ${id} | Kingcom`,
    vendor: 'Ulanzi',
    product_type: 'Tripod',
    tags: 'tripod, mobile',
    body_html: '<p>TÍNH NĂNG:</p><ul><li>Tải trọng 2kg</li><li>Nặng&nbsp;150g</li></ul>',
    options: [{ name: 'Màu' }],
    variants: [
      { title: 'BLACK', sku: `S${id}A`, price: '459000', compare_at_price: '0', available: true, inventory_management: 'haravan', inventory_quantity: 25 },
      { title: 'PURPLE', sku: `S${id}B`, price: '459000', available: false, inventory_management: 'haravan', inventory_quantity: 0 }
    ],
    ...overrides
  };
}

function withSyncSource(fn) {
  const sourceId = `catalog-sync-test-${process.pid}`;
  const dir = path.join(SOURCES_DIR, 'website', sourceId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'source.json'), JSON.stringify({
    displayName: 'Test',
    catalogSync: { enabled: true, storeUrl: STORE, collections: false }
  }), 'utf8');
  return Promise.resolve(fn(`website/${sourceId}`, dir)).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

function mockStorefront(products) {
  const original = global.fetch;
  global.fetch = async url => {
    const page = Number(new URL(url).searchParams.get('page') || 1);
    const batch = page === 1 ? products : [];
    return { ok: true, status: 200, text: async () => JSON.stringify({ products: batch }) };
  };
  return () => { global.fetch = original; };
}

test('storefront product maps to one catalog row with variants, stock and categories', () => {
  const row = mapProduct(haravanProduct(1), STORE, { 1: ['Tripod', 'Ulanzi'] }, new Map(), new Map());

  assert.equal(row.name, 'Sản phẩm 1');
  assert.equal(row.sku, 'S1A');
  assert.equal(row.url, `${STORE}/products/product-1`);
  assert.equal(row.price, '459000');
  assert.equal(row.availability, 'in_stock');
  assert.equal(row.inventory_quantity, '25');
  assert.equal(row.collections, 'Tripod; Ulanzi');
  assert.match(row.variants, /Màu: BLACK \| SKU S1A \| giá 459\.000đ \| còn hàng ; PURPLE \| SKU S1B \| giá 459\.000đ \| hết hàng/);
  assert.doesNotMatch(`${row.variants} ${row.description}`, /còn \d|25/);
  assert.match(row.description, /- Tải trọng 2kg\n- Nặng 150g/);
  assert.match(row.description, /Biến thể: Màu: BLACK/);
});

test('html description keeps list structure and decodes entities', () => {
  assert.equal(htmlToText('<p>A&amp;B</p><li>x</li><br>y&#39;s'), "A&B\n- x\ny's");
});

test('sync writes products.synced.csv that the catalog prefers over products.csv', async () => {
  await withSyncSource(async (sourceKey, dir) => {
    fs.writeFileSync(path.join(dir, 'products.csv'), 'sku,name,price,url\nOLD1,Old product,100000,https://old.test/p\n', 'utf8');
    const restore = mockStorefront([haravanProduct(1), haravanProduct(2)]);
    try {
      const result = await syncSourceCatalog(sourceKey);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.productCount, 2);
    } finally {
      restore();
    }

    assert.ok(fs.existsSync(path.join(dir, 'products.synced.csv')));
    const names = loadProducts({ sourceKey }).map(product => product.name);
    assert.deepEqual(names, ['Sản phẩm 1', 'Sản phẩm 2']);
  });
});

test('sync refuses to overwrite when the store returns far fewer products', async () => {
  await withSyncSource(async (sourceKey, dir) => {
    const restoreFull = mockStorefront(Array.from({ length: 10 }, (_, index) => haravanProduct(index + 1)));
    await syncSourceCatalog(sourceKey);
    restoreFull();

    const restorePartial = mockStorefront([haravanProduct(99)]);
    try {
      const result = await syncSourceCatalog(sourceKey);
      assert.equal(result.ok, false);
      assert.match(result.error, /not overwriting/);
    } finally {
      restorePartial();
    }
    assert.equal(loadProducts({ sourceKey }).length, 10);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'catalog_sync.json'), 'utf8'));
    assert.match(state.lastError, /not overwriting/);
  });
});
