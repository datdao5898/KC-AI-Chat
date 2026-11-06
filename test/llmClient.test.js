const test = require('node:test');
const assert = require('node:assert/strict');
const { chatCompletion } = require('../src/llmClient');

test('chatCompletion retries an empty response and preserves JSON response format', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalBaseUrl = process.env.OPENAI_BASE_URL;
  const calls = [];
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    const body = calls.length === 1
      ? { choices: [{ message: { content: '' }, finish_reason: 'stop' }] }
      : { choices: [{ message: { content: '{"approve":true}' }, finish_reason: 'stop' }] };
    return {
      ok: true,
      text: async () => JSON.stringify(body)
    };
  };

  try {
    const result = await chatCompletion({
      messages: [{ role: 'user', content: 'judge this' }],
      maxAttempts: 2,
      maxOutputTokens: 100,
      retryMaxOutputTokens: 200,
      responseFormat: { type: 'json_object' }
    });

    assert.equal(result, '{"approve":true}');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].response_format, { type: 'json_object' });
    assert.equal(calls[0].max_completion_tokens, 100);
    assert.equal(calls[1].max_completion_tokens, 200);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalBaseUrl;
  }
});

test('a reply cut off by the token limit is retried with more tokens, then rejected', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
  const cut = { choices: [{ message: { content: 'Dạ, anh/chị cung cấp email nhận' }, finish_reason: 'length' }] };
  const full = { choices: [{ message: { content: 'Dạ, anh/chị cung cấp email nhận hóa đơn ạ.' }, finish_reason: 'stop' }] };
  let bodies = [cut, full];
  const calls = [];
  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    const body = bodies[Math.min(calls.length - 1, bodies.length - 1)];
    return { ok: true, text: async () => JSON.stringify(body) };
  };

  try {
    const ask = () => chatCompletion({ messages: [{ role: 'user', content: 'hi' }], maxAttempts: 2, maxOutputTokens: 100, retryMaxOutputTokens: 200 });
    assert.equal(await ask(), 'Dạ, anh/chị cung cấp email nhận hóa đơn ạ.');
    assert.equal(calls[1].max_completion_tokens, 200);

    calls.length = 0;
    bodies = [cut];
    await assert.rejects(ask, error => error.code === 'EMPTY_LLM_RESPONSE' && /finish_reason=length/.test(error.message));
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalBaseUrl;
  }
});
