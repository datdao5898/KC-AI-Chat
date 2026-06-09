const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardUrl, formatAlert } = require('../src/staffAlert');

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
