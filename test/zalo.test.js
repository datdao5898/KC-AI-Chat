const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyZaloSignature, parseZaloEvent, splitZaloText, extractZaloImageUrls } = require('../src/channels/zalo');

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function signedRequest(body, secret, { tamper = false } = {}) {
  const rawBodyText = JSON.stringify(body);
  const mac = crypto.createHash('sha256').update(body.app_id + rawBodyText + body.timestamp + secret).digest('hex');
  return {
    headers: { 'x-zevent-signature': `mac=${mac}` },
    body: tamper ? { ...body, timestamp: '1' } : body,
    rawBodyText: tamper ? rawBodyText.replace('Xin', 'Xyn') : rawBodyText
  };
}

const textEvent = {
  app_id: '123',
  user_id_by_app: '999',
  event_name: 'user_send_text',
  timestamp: '1761200000000',
  sender: { id: 'user-1' },
  recipient: { id: 'oa-1' },
  message: { msg_id: 'msg-1', text: 'Xin chào' }
};

test('verifyZaloSignature accepts a Zalo mac signature and rejects tampered bodies', () => {
  withEnv({ ZALO_OA_SECRET_KEY: 'oa-secret', REQUIRE_WEBHOOK_SIGNATURES: undefined }, () => {
    assert.equal(verifyZaloSignature(signedRequest(textEvent, 'oa-secret')), true);
    assert.equal(verifyZaloSignature(signedRequest(textEvent, 'wrong-secret')), false);
    assert.equal(verifyZaloSignature(signedRequest(textEvent, 'oa-secret', { tamper: true })), false);
    assert.equal(verifyZaloSignature({ headers: {}, body: textEvent, rawBodyText: JSON.stringify(textEvent) }), false);
  });
});

test('verifyZaloSignature requires a secret unless signatures are disabled', () => {
  const req = { headers: {}, body: textEvent, rawBodyText: JSON.stringify(textEvent) };
  withEnv({ ZALO_OA_SECRET_KEY: undefined, REQUIRE_WEBHOOK_SIGNATURES: undefined }, () => {
    assert.equal(verifyZaloSignature(req), false);
  });
  withEnv({ ZALO_OA_SECRET_KEY: undefined, REQUIRE_WEBHOOK_SIGNATURES: 'false' }, () => {
    assert.equal(verifyZaloSignature(req), true);
  });
});

test('parseZaloEvent reads customer text messages', () => {
  assert.deepEqual(parseZaloEvent(textEvent), {
    userId: 'user-1',
    oaId: 'oa-1',
    messageId: 'msg-1',
    text: 'Xin chào',
    imageUrls: []
  });
});

test('parseZaloEvent reads customer images and ignores OA echoes and non-message events', () => {
  const imageEvent = {
    ...textEvent,
    event_name: 'user_send_image',
    message: {
      msg_id: 'msg-2',
      text: 'Cái này còn hàng không?',
      attachments: [
        { type: 'image', payload: { url: 'https://photo-stal-1.zdn.vn/abc.jpg', thumbnail: 'https://photo-stal-1.zdn.vn/t.jpg' } },
        { type: 'image', payload: { url: 'https://evil.example.com/x.jpg' } }
      ]
    }
  };
  const parsed = parseZaloEvent(imageEvent);
  assert.equal(parsed.text, 'Cái này còn hàng không?');
  assert.deepEqual(parsed.imageUrls, ['https://photo-stal-1.zdn.vn/abc.jpg']);

  assert.equal(parseZaloEvent({ ...textEvent, event_name: 'oa_send_text' }), null);
  assert.equal(parseZaloEvent({ ...textEvent, event_name: 'follow' }), null);
  assert.equal(parseZaloEvent({ ...textEvent, event_name: 'user_send_sticker' }), null);
  assert.equal(parseZaloEvent({ ...textEvent, message: { msg_id: 'x', text: '  ' } }), null);
});

test('extractZaloImageUrls only keeps https Zalo CDN images', () => {
  assert.deepEqual(extractZaloImageUrls({
    attachments: [
      { type: 'image', payload: { url: 'http://photo.zdn.vn/a.jpg' } },
      { type: 'sticker', payload: { url: 'https://zalo.me/s.png' } },
      { type: 'image', payload: { url: 'https://s240-ava-talk.zadn.vn/b.jpg' } }
    ]
  }), ['https://s240-ava-talk.zadn.vn/b.jpg']);
});

test('splitZaloText keeps short replies whole and splits long ones under the 2000-char limit', () => {
  assert.deepEqual(splitZaloText('Dạ chào anh'), ['Dạ chào anh']);
  const paragraph = 'a'.repeat(1200);
  const chunks = splitZaloText(`${paragraph}\n\n${paragraph}\n\n${paragraph}`);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every(chunk => chunk.length <= 2000));
  assert.equal(chunks.join(''), paragraph.repeat(3));
});
