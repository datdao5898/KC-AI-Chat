const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAllowedDomains,
  isAllowedSourceUrl,
  getWebGuidanceConfig,
  answerProductGuidanceFromWeb,
  answerProductSpecsFromWeb
} = require('../src/webGuidance');

test('normalizeAllowedDomains keeps valid unique manufacturer domains', () => {
  assert.deepEqual(
    normalizeAllowedDomains(['https://www.viltrox.com/support', '*.viltrox.com', 'bad domain']),
    ['viltrox.com']
  );
});

test('isAllowedSourceUrl accepts HTTPS subdomains and rejects other hosts', () => {
  assert.equal(isAllowedSourceUrl('https://support.viltrox.com/manual', ['viltrox.com']), true);
  assert.equal(isAllowedSourceUrl('http://viltrox.com/manual', ['viltrox.com']), false);
  assert.equal(isAllowedSourceUrl('https://example.com/manual', ['viltrox.com']), false);
});

test('getWebGuidanceConfig narrows a multi-brand source to the catalog vendor', () => {
  const config = getWebGuidanceConfig({
    webGuidance: {
      enabled: true,
      allowedDomains: ['ulanzi.com', 'viltrox.com'],
      restrictByProductBrand: true,
      brandDomains: {
        Ulanzi: ['ulanzi.com'],
        Viltrox: ['viltrox.com']
      }
    }
  }, {
    vendor: 'Ulanzi',
    name: 'Ulanzi MT85'
  });

  assert.deepEqual(config.allowedDomains, ['ulanzi.com']);
});

test('answerProductGuidanceFromWeb uses OpenRouter domain filtering and citations', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED: process.env.PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED
  };
  let requestBody;

  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENAI_API_KEY;
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
  process.env.OPENAI_MODEL = 'openai/gpt-5.4-mini';
  process.env.PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED = 'true';
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{
          message: {
            content: 'Bật nguồn, sau đó chọn chế độ cần dùng.',
            annotations: [{
              type: 'url_citation',
              url_citation: {
                url: 'https://www.viltrox.com/pages/manual',
                title: 'Viltrox manual',
                content: 'Official setup steps'
              }
            }]
          }
        }],
        usage: { server_tool_use: { web_search_requests: 1 } }
      })
    };
  };

  try {
    const result = await answerProductGuidanceFromWeb({
      userText: 'cách sử dụng sản phẩm này',
      products: [{ name: 'Viltrox Test Lens', vendor: 'Viltrox' }],
      sourceConfig: {
        webGuidance: {
          enabled: true,
          allowedDomains: ['viltrox.com'],
          maxResults: 3
        }
      },
      customerBrand: 'Viltrox',
      language: 'vi',
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.equal(result.webSearchRequests, 1);
    assert.match(result.reply, /https:\/\/www\.viltrox\.com\/pages\/manual/);
    assert.equal(requestBody.tools[0].type, 'openrouter:web_search');
    assert.deepEqual(requestBody.tools[0].parameters.allowed_domains, ['viltrox.com']);
    assert.equal(requestBody.tools[0].parameters.engine, 'exa');
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('answerProductGuidanceFromWeb rejects citations outside the allowlist', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED: process.env.PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED
  };

  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
  process.env.PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED = 'true';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      choices: [{
        message: {
          content: 'Use these steps.',
          annotations: [{
            type: 'url_citation',
            url_citation: { url: 'https://example.com/untrusted', title: 'Untrusted' }
          }]
        }
      }]
    })
  });

  try {
    const result = await answerProductGuidanceFromWeb({
      userText: 'how to use it',
      products: [{ name: 'Viltrox Test Lens' }],
      sourceConfig: {
        webGuidance: { enabled: true, allowedDomains: ['viltrox.com'] }
      },
      language: 'en',
      timeoutMs: 1000
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /no allowed official citations/i);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('answerProductSpecsFromWeb uses the web search tool for technical specifications', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED: process.env.PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED
  };
  let requestBody;

  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
  process.env.PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED = 'true';
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{
          message: {
            content: 'Thong so co ban la 24MP, USB-C va pin 1200mAh.',
            annotations: [{
              type: 'url_citation',
              url_citation: {
                url: 'https://www.viltrox.com/pages/specs',
                title: 'Viltrox specs',
                content: 'Official specifications'
              }
            }]
          }
        }],
        usage: { server_tool_use: { web_search_requests: 1 } }
      })
    };
  };

  try {
    const result = await answerProductSpecsFromWeb({
      userText: 'thong so cua san pham nay la gi',
      products: [{ name: 'Viltrox Test Lens', vendor: 'Viltrox' }],
      sourceConfig: {
        webGuidance: {
          enabled: true,
          allowedDomains: ['viltrox.com'],
          maxResults: 3
        }
      },
      customerBrand: 'Viltrox',
      language: 'vi',
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.equal(result.webSearchRequests, 1);
    assert.match(result.reply, /24MP/);
    assert.match(requestBody.messages[0].content, /technical specifications/i);
    assert.equal(requestBody.tools[0].type, 'openrouter:web_search');
    assert.deepEqual(requestBody.tools[0].parameters.allowed_domains, ['viltrox.com']);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('answerProductSpecsFromWeb can fall back to broad web search when no allowlist is configured', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED: process.env.PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED
  };

  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
  process.env.PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED = 'true';
  global.fetch = async (_url, options) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      choices: [{
        message: {
          content: 'Thong so co ban la 24MP va USB-C.',
          annotations: [{
            type: 'url_citation',
            url_citation: {
              url: 'https://example.org/specs',
              title: 'Example specs',
              content: 'Public web source'
            }
          }]
        }
      }],
      usage: { server_tool_use: { web_search_requests: 1 } }
    })
  });

  try {
    const result = await answerProductSpecsFromWeb({
      userText: 'thong so cua san pham nay la gi',
      products: [{ name: 'Generic Test Product' }],
      sourceConfig: {
        webGuidance: {
          enabled: true
        }
      },
      customerBrand: 'KingCom',
      language: 'vi',
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.match(result.reply, /example\.org\/specs/);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
