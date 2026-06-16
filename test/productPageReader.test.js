const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractHtmlText,
  isAllowedProductPageUrl,
  readProductPageContext
} = require('../src/productPageReader');

test('extractHtmlText reads title, meta description, and body text', () => {
  const text = extractHtmlText(`
    <html>
      <head>
        <title>BOYA BY-M100UA</title>
        <meta name="description" content="Mic thu am USB-A cho may tinh Windows va Mac">
        <style>.hidden{display:none}</style>
      </head>
      <body><script>alert(1)</script><h1>Thong so</h1><p>Tan so 50Hz den 18kHz.</p></body>
    </html>
  `);

  assert.match(text, /BOYA BY-M100UA/);
  assert.match(text, /USB-A/);
  assert.match(text, /50Hz den 18kHz/);
  assert.doesNotMatch(text, /alert/);
});

test('isAllowedProductPageUrl accepts same product slug across store domains', () => {
  const products = [{
    url: 'https://store.kingcom.com.vn/products/boya-by-m100ua-mic-thu-am-danh-cho-may-tinh-win-mac'
  }];

  assert.equal(
    isAllowedProductPageUrl('https://newlite.vn/products/boya-by-m100ua-mic-thu-am-danh-cho-may-tinh-win-mac', products),
    true
  );
  assert.equal(
    isAllowedProductPageUrl('https://example.com/products/boya-by-m100ua-mic-thu-am-danh-cho-may-tinh-win-mac', []),
    false
  );
});

test('readProductPageContext fetches allowed product URL text', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => '<title>BOYA BY-M100UA</title><p>Mic USB-A cho Windows va Mac.</p>'
  });

  try {
    const result = await readProductPageContext(
      'https://newlite.vn/products/boya-by-m100ua-mic-thu-am-danh-cho-may-tinh-win-mac',
      {
        products: [{
          url: 'https://store.kingcom.com.vn/products/boya-by-m100ua-mic-thu-am-danh-cho-may-tinh-win-mac'
        }]
      }
    );

    assert.equal(result.ok, true);
    assert.match(result.text, /BOYA BY-M100UA/);
    assert.match(result.text, /Windows va Mac/);
  } finally {
    global.fetch = originalFetch;
  }
});
