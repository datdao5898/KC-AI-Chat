const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../src/adminAuth');

test('hashPassword creates verifiable scrypt hash', () => {
  const hash = hashPassword('secret-password', 'fixed-salt');
  assert.ok(hash.startsWith('scrypt:v1:fixed-salt:'));
  assert.equal(verifyPassword('secret-password', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
});
