const test = require('node:test');
const assert = require('node:assert/strict');
const { detectImage } = require('../src/websiteMedia');

test('detectImage recognizes PNG', () => {
  const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.deepEqual(detectImage(buffer), { mime: 'image/png', extension: 'png' });
});

test('detectImage recognizes JPEG', () => {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  assert.deepEqual(detectImage(buffer), { mime: 'image/jpeg', extension: 'jpg' });
});

test('detectImage recognizes WebP', () => {
  const buffer = Buffer.from('RIFFzzzzWEBP', 'ascii');
  assert.deepEqual(detectImage(buffer), { mime: 'image/webp', extension: 'webp' });
});
