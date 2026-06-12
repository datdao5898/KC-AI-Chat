const test = require('node:test');
const assert = require('node:assert/strict');
const { avoidRepeatedContactRequest, trimHistoryToActiveSession } = require('../src/messagePipeline');

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

test('avoidRepeatedContactRequest removes Vietnamese phone request when customer phone exists', () => {
  const reply = 'D\u1ea1 em \u0111\u00e3 chuy\u1ec3n nh\u00e2n vi\u00ean ki\u1ec3m tra. Anh/ch\u1ecb vui l\u00f2ng \u0111\u1ec3 l\u1ea1i s\u1ed1 \u0111i\u1ec7n tho\u1ea1i \u0111\u1ec3 h\u1ed7 tr\u1ee3 nhanh h\u01a1n \u1ea1.';
  const result = avoidRepeatedContactRequest(reply, { phone: '0944190237' }, 'ki\u1ec3m tra gi\u00fap anh');

  assert.doesNotMatch(result, /\u0111\u1ec3 l\u1ea1i s\u1ed1 \u0111i\u1ec7n tho\u1ea1i/i);
  assert.match(result, /\u0111\u00e3 c\u00f3 s\u1ed1 \u0111i\u1ec7n tho\u1ea1i/i);
});

test('avoidRepeatedContactRequest keeps phone request when profile has no phone', () => {
  const reply = 'Please share your phone number so our staff can contact you.';
  assert.equal(avoidRepeatedContactRequest(reply, {}, 'I need staff support'), reply);
});

test('avoidRepeatedContactRequest does not remove phone acknowledgement', () => {
  const reply = 'D\u1ea1 em \u0111\u00e3 nh\u1eadn \u0111\u01b0\u1ee3c s\u1ed1 \u0111i\u1ec7n tho\u1ea1i 0944190237.';
  assert.equal(avoidRepeatedContactRequest(reply, { phone: '0944190237' }, '0944190237'), reply);
});
