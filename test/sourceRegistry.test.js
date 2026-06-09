const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSourceContext,
  resolveCustomerBrand,
  applyCustomerBranding
} = require('../src/sourceRegistry');

test('NewLite hostname overrides an outdated KingCom widget site name', () => {
  const source = buildSourceContext({
    channel: 'haravan_website',
    raw: {
      siteName: 'kingcom',
      siteHost: 'newlite.vn'
    }
  });

  assert.equal(source.sourceKey, 'website/newlite');
  assert.equal(source.sourceName, 'NewLite');
  assert.equal(resolveCustomerBrand(source), 'NewLite');
});

test('KingCom hostname resolves to KingCom', () => {
  const source = buildSourceContext({
    channel: 'haravan_website',
    raw: {
      siteName: 'newlite',
      siteHost: 'store.kingcom.com.vn'
    }
  });

  assert.equal(source.sourceKey, 'website/kingcom');
  assert.equal(resolveCustomerBrand(source), 'KingCom');
});

test('Facebook source uses its configured customer-facing brand', () => {
  assert.equal(resolveCustomerBrand({
    sourceKey: 'facebook/1184640711390003',
    sourceName: 'Hermes Agent VN',
    sourceGroup: 'facebook'
  }), 'Synco');

  assert.equal(resolveCustomerBrand({
    sourceKey: 'facebook/260016447958834',
    sourceName: 'AI Agent Seting Up',
    sourceGroup: 'facebook'
  }), 'Viltrox');
});

test('branding replacement keeps product names and URLs unchanged', () => {
  const product = {
    name: 'Ống kính Viltrox Chính Hãng KingCom',
    url: 'https://store.kingcom.com.vn/products/lens'
  };
  const reply = `KingCom có sản phẩm ${product.name}.\nLink: ${product.url}`;
  const branded = applyCustomerBranding(reply, 'NewLite', [product]);

  assert.match(branded, /^NewLite có sản phẩm/);
  assert.match(branded, /Chính Hãng KingCom/);
  assert.match(branded, /https:\/\/store\.kingcom\.com\.vn\/products\/lens/);
});
