const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardUrl, formatAlert, formatNewMessageAlert } = require('../src/staffAlert');

test('buildDashboardUrl opens the separated conversations page', () => {
  const previousBaseUrl = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://ai.kingcom.com.vn/';

  try {
    assert.equal(
      buildDashboardUrl('conversation id/123'),
      'https://ai.kingcom.com.vn/admin/conversations.html?conversation=conversation%20id%2F123'
    );
  } finally {
    if (previousBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBaseUrl;
  }
});

test('staff alert includes the current admin conversation URL', () => {
  const previousBaseUrl = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://ai.kingcom.com.vn';

  try {
    const message = formatAlert({
      channel: 'facebook',
      externalUserId: 'customer-1',
      intent: 'price',
      reason: 'Needs checking',
      text: 'Hello',
      conversationId: 'abc-123',
      sourceGroup: 'facebook',
      sourceName: 'Viltrox',
      sourceKey: 'facebook/260016447958834'
    });

    assert.match(
      message,
      /https:\/\/ai\.kingcom\.com\.vn\/admin\/conversations\.html\?conversation=abc-123/
    );
  } finally {
    if (previousBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBaseUrl;
  }
});

test('new message alert shows the customer message, AI reply and status', () => {
  const message = formatNewMessageAlert({
    channel: 'zalo',
    externalUserId: 'user-1',
    customer: { name: 'Anh Tuấn', phone: '0900000000' },
    text: 'Còn hàng không?',
    status: 'AI replied',
    reply: 'Dạ còn hàng ạ.',
    conversationId: 'conv-1',
    sourceName: 'KingCom Zalo'
  });
  assert.match(message, /KingCom new message \(Zalo\)/);
  assert.match(message, /Name: Anh Tuấn/);
  assert.match(message, /"Còn hàng không\?"/);
  assert.match(message, /Status: AI replied/);
  assert.match(message, /AI reply:\n"Dạ còn hàng ạ\."/);
  assert.match(message, /conversation=conv-1/);
});

test('new message alert omits the AI reply block when the AI stayed silent', () => {
  const message = formatNewMessageAlert({ channel: 'facebook', externalUserId: 'u', text: 'hi', status: 'Staff hours', conversationId: 'c' });
  assert.doesNotMatch(message, /AI reply/);
});
