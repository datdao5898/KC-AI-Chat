const test = require('node:test');
const assert = require('node:assert/strict');
const {
  understandCustomerMessage,
  translateReply,
  parseUnderstanding,
  keepsFacts,
  runInLanguageScope,
  setCurrentMessageLanguage
} = require('../src/messageLanguage');
const { detectMessageLanguage } = require('../src/ai');

function quietly(fn) {
  const originalWarn = console.warn;
  console.warn = () => {};
  return Promise.resolve(fn()).finally(() => { console.warn = originalWarn; });
}

test('the model answer is parsed for any language', () => {
  assert.deepEqual(parseUnderstanding('{"language":"en","vietnamese":"mấy giờ mở cửa"}'), { language: 'en', vietnamese: 'mấy giờ mở cửa' });
  assert.deepEqual(parseUnderstanding('```json\n{"language":"KO","vietnamese":"giá bao nhiêu"}\n```'), { language: 'ko', vietnamese: 'giá bao nhiêu' });
  assert.deepEqual(parseUnderstanding('{"language":"vi","vietnamese":""}'), { language: 'vi', vietnamese: '' });
  assert.deepEqual(parseUnderstanding('{"language":"en","vietnamese":""}', false), { language: 'en', vietnamese: '' });
  assert.equal(parseUnderstanding('{"language":"en","vietnamese":""}'), null);
  assert.equal(parseUnderstanding('I think this is English'), null);
});

test('the model sees the message and earlier customer messages, not image analysis', async () => {
  let request;
  const understood = await understandCustomerMessage({
    text: 'ok\n\n[Internal image analysis: 银行 receipt]',
    history: [
      { sender_type: 'customer', text: 'Please show me the price' },
      { sender_type: 'ai', text: 'Dạ giá 100.000đ' },
      { sender_type: 'customer', text: 'ok' }
    ]
  }, async args => {
    request = args;
    return '{"language":"en","vietnamese":"được"}';
  });

  const prompt = request.messages[1].content;
  assert.equal(understood.language, 'en');
  assert.match(prompt, /Please show me the price/);
  assert.match(prompt, /Latest customer message:\nok$/);
  assert.doesNotMatch(prompt, /银行|Dạ giá/);
});

test('a model failure or unusable answer returns null so the fallback is used', () => quietly(async () => {
  assert.equal(await understandCustomerMessage({ text: 'hello' }, async () => {
    throw new Error('timeout');
  }), null);
  assert.equal(await understandCustomerMessage({ text: 'hello' }, async () => 'not sure'), null);
}));

test('a translation must keep links, phones, prices and times', () => {
  const source = 'Hotline: 0903 898 478. Giờ làm việc 08:30 – 17:30. Giá 699.000đ\nhttps://kingcom.vn/products/a';
  const good = 'Hotline: 0903 898 478. Opening hours 08:30 – 17:30. Price 699.000đ\nhttps://kingcom.vn/products/a';
  assert.equal(keepsFacts(source, good), true);
  assert.equal(keepsFacts(source, good.replace('0903 898 478', '0903 898 479')), false);
  assert.equal(keepsFacts(source, good.replace('699.000', '690.000')), false);
  assert.equal(keepsFacts(source, good.replace('17:30', '5:30 PM')), false);
  assert.equal(keepsFacts(source, good.replace('/products/a', '/products/b')), false);
  assert.equal(keepsFacts(source, `${good}\nZalo: 0912 345 678`), false);
});

test('the Vietnamese reply is kept when a translation fails or changes facts', async () => {
  const reply = 'Dạ hotline bên em là 0903 898 478 ạ.';
  const good = await translateReply({ reply, customerText: 'hotline?' }, async () => 'Our hotline is 0903 898 478.');
  assert.deepEqual(good, { reply: 'Our hotline is 0903 898 478.', translated: true, error: '' });

  const changed = await translateReply({ reply, customerText: 'hotline?' }, async () => 'Our hotline is 1900 1234.');
  assert.equal(changed.reply, reply);
  assert.equal(changed.translated, false);

  const failed = await translateReply({ reply, customerText: 'hotline?' }, async () => {
    throw new Error('timeout');
  });
  assert.equal(failed.reply, reply);
  assert.equal(failed.error, 'timeout');
});

test('the working language applies to one message only', async () => {
  const fallback = detectMessageLanguage('are you open on sundays?');

  await Promise.all([
    runInLanguageScope(async () => {
      setCurrentMessageLanguage('vi');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(detectMessageLanguage('are you open on sundays?'), 'vi');
    }),
    runInLanguageScope(async () => {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(detectMessageLanguage('are you open on sundays?'), fallback);
    })
  ]);

  assert.equal(detectMessageLanguage('are you open on sundays?'), fallback);
});
