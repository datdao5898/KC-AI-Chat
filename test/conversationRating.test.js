const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_FEEDBACK_LENGTH,
  normalizeRating,
  normalizeRatingFeedback
} = require('../src/conversationRating');

test('normalizeRating accepts whole stars from 1 to 5', () => {
  assert.equal(normalizeRating(1), 1);
  assert.equal(normalizeRating('5'), 5);
});

test('normalizeRating rejects invalid star values', () => {
  assert.equal(normalizeRating(0), null);
  assert.equal(normalizeRating(6), null);
  assert.equal(normalizeRating(3.5), null);
  assert.equal(normalizeRating('bad'), null);
});

test('normalizeRatingFeedback trims and limits feedback', () => {
  assert.equal(normalizeRatingFeedback('  Rat tot  '), 'Rat tot');
  assert.equal(normalizeRatingFeedback('x'.repeat(MAX_FEEDBACK_LENGTH + 20)).length, MAX_FEEDBACK_LENGTH);
});
