const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeJudgeMetrics } = require('../src/aiTrace');

test('summarizeJudgeMetrics tracks reject rate and skipped deterministic replies', () => {
  const metrics = summarizeJudgeMetrics([
    JSON.stringify({ judgeApproved: 'true', judgeReason: 'Approved' }),
    JSON.stringify({ judgeApproved: 'false', judgeReason: 'Wrong product' }),
    JSON.stringify({ judgeApproved: 'true', judgeSkipped: 'deterministic_reply_source' }),
    JSON.stringify({ judgeApproved: 'true', judgeReason: 'Judge unavailable: timeout' }),
    'invalid-json'
  ]);

  assert.deepEqual(metrics, {
    sampled: 4,
    judged: 2,
    approved: 1,
    rejected: 1,
    skipped: 1,
    unavailable: 1,
    reject_rate: 50
  });
});
