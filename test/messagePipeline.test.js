const test = require('node:test');
const assert = require('node:assert/strict');
const { trimHistoryToActiveSession } = require('../src/messagePipeline');

test('trimHistoryToActiveSession drops messages before a long inactivity gap', () => {
  const messages = [
    { text: 'old image: Nikon', created_at: '2026-06-06T09:00:00.000Z' },
    { text: 'old reply', created_at: '2026-06-06T09:01:00.000Z' },
    { text: 'new landscape lens question', created_at: '2026-06-09T02:46:00.000Z' }
  ];

  assert.deepEqual(trimHistoryToActiveSession(messages, 360).map(message => message.text), [
    'new landscape lens question'
  ]);
});

test('trimHistoryToActiveSession keeps messages in the same active chat session', () => {
  const messages = [
    { text: 'lens phong canh duoi 9tr', created_at: '2026-06-09T02:40:00.000Z' },
    { text: 'gia tu bao nhieu', created_at: '2026-06-09T02:46:00.000Z' }
  ];

  assert.equal(trimHistoryToActiveSession(messages, 360).length, 2);
});
