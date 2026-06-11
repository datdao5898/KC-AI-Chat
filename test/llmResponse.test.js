const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEmptyResponseError,
  extractAssistantText
} = require('../src/llmResponse');

test('extractAssistantText reads standard chat completion content', () => {
  const text = extractAssistantText({
    choices: [{ message: { content: '  Xin chao  ' } }]
  });
  assert.equal(text, 'Xin chao');
});

test('extractAssistantText reads provider content arrays', () => {
  const text = extractAssistantText({
    choices: [{
      message: {
        content: [
          { type: 'text', text: 'Dong mot' },
          { type: 'text', text: { value: 'Dong hai' } }
        ]
      }
    }]
  });
  assert.equal(text, 'Dong mot\nDong hai');
});

test('extractAssistantText falls back to choice text', () => {
  const text = extractAssistantText({
    choices: [{ text: 'Fallback text' }]
  });
  assert.equal(text, 'Fallback text');
});

test('empty response error includes safe provider diagnostics', () => {
  const error = createEmptyResponseError({
    choices: [{ finish_reason: 'length', native_finish_reason: 'max_tokens' }],
    usage: {
      completion_tokens: 520,
      completion_tokens_details: { reasoning_tokens: 520 }
    }
  });

  assert.equal(error.code, 'EMPTY_LLM_RESPONSE');
  assert.match(error.message, /finish_reason=length/);
  assert.match(error.message, /reasoning_tokens=520/);
});
