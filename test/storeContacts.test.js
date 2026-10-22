const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SOURCES_DIR } = require('../src/sourceRegistry');
const {
  getVerifiedContact,
  buildStoreContactReply,
  isStoreContactRequest,
  extractPhones,
  findContactViolations,
  enforceVerifiedContactInfo
} = require('../src/storeContacts');

const KINGCOM = 'website/kingcom';
const NEWLITE = 'website/newlite';

function withTempSourceFaq(faq, fn) {
  const sourceId = `contact-test-${process.pid}`;
  const dir = path.join(SOURCES_DIR, 'website', sourceId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'faq.md'), faq, 'utf8');
  try {
    return fn(`website/${sourceId}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('store contact reply quotes the FAQ contact section of the source', () => {
  const reply = buildStoreContactReply({ sourceKey: KINGCOM, lang: 'vi' });

  assert.match(reply, /65 Nguyễn Minh Hoàng, Phường Bảy Hiền \(Phường 12, Quận Tân Bình cũ\), TP\.HCM/);
  assert.match(reply, /0903 898 478/);
  assert.match(reply, /96-96B Nguyễn Huy Tưởng/);
  assert.match(reply, /070 447 1438/);
  assert.doesNotMatch(reply, /0358|028-38-440-798/);
});

test('editing the FAQ markdown changes the contact reply without code changes', () => {
  withTempSourceFaq([
    '# FAQ',
    '## Đặt hàng',
    '- Gọi 0999 000 111 không phải hotline cửa hàng.',
    '## Thông tin cửa hàng',
    '- Chi nhánh Đà Nẵng: 12 Lê Duẩn, Phường Hải Châu, Đà Nẵng. Hotline: 0911 222 333.',
    '- Giờ làm việc: 08:30 – 17:30, Thứ 2 – Thứ 7',
    '## Khác',
    '- Hotline cũ 0988 777 666'
  ].join('\n'), sourceKey => {
    const contact = getVerifiedContact(sourceKey);
    assert.deepEqual([...contact.phones], ['0911222333']);
    assert.equal(contact.addresses.length, 1);

    const reply = buildStoreContactReply({ sourceKey, lang: 'vi' });
    assert.match(reply, /12 Lê Duẩn/);
    assert.match(reply, /Giờ làm việc: 08:30/);
    assert.doesNotMatch(reply, /0999 000 111|0988 777 666/);

    assert.equal(enforceVerifiedContactInfo('Hotline: 0911 222 333', { sourceKey }).ok, true);
    assert.equal(enforceVerifiedContactInfo('Hotline: 0988 777 666', { sourceKey }).ok, false);
  });
});

test('source FAQ without contact bullets never gets an address or hotline', () => {
  const reply = buildStoreContactReply({ sourceKey: NEWLITE, lang: 'vi' });

  assert.equal(getVerifiedContact(NEWLITE), null);
  assert.equal(extractPhones(reply).length, 0);
  assert.doesNotMatch(reply, /Nguyễn Minh Hoàng|Nguyễn Huy Tưởng/);
  assert.match(reply, /chuyển nhân viên/);
});

test('invented hotline from judge correction is removed and replaced with FAQ contacts', () => {
  const result = enforceVerifiedContactInfo(
    'Dạ, KingCom hỗ trợ khách hàng sau khi mua với chính sách đổi trả. Hỗ trợ kỹ thuật qua hotline 1900 1234. Anh/chị cần tư vấn thêm về sản phẩm hay dịch vụ ạ?',
    { sourceKey: KINGCOM, userText: 'Dịch vụ hỗ trợ khách hàng sau khi mua có tốt không', lang: 'vi' }
  );

  assert.equal(result.ok, false);
  assert.match(result.reason, /19001234/);
  assert.doesNotMatch(result.reply, /1900 1234/);
  assert.match(result.reply, /0903 898 478/);
  assert.match(result.reply, /Anh\/chị cần tư vấn thêm/);
});

test('outdated hotline, misquoted address and another brand address are rejected', () => {
  const oldHotline = findContactViolations('Hotline HCM: 028-38-440-798', { sourceKey: KINGCOM });
  assert.deepEqual(oldHotline.badPhones, ['02838440798']);

  const oldAddress = findContactViolations('Địa chỉ: 65 Nguyễn Minh Hoàng, phường Bảy Hiền, TP.HCM', { sourceKey: KINGCOM });
  assert.equal(oldAddress.badAddress, true);

  const otherBrand = findContactViolations(buildStoreContactReply({ sourceKey: KINGCOM }), { sourceKey: NEWLITE });
  assert.equal(otherBrand.badAddress, true);
  assert.equal(otherBrand.badPhones.length, 2);
});

test('FAQ contacts, customer phones and prices pass the contact gate', () => {
  const verified = enforceVerifiedContactInfo(buildStoreContactReply({ sourceKey: KINGCOM, lang: 'en' }), { sourceKey: KINGCOM });
  assert.equal(verified.ok, true);

  const echoed = enforceVerifiedContactInfo('Dạ em đã nhận được số điện thoại 0938821133.', {
    sourceKey: NEWLITE,
    userText: '0938821133'
  });
  assert.equal(echoed.ok, true);

  const fromHistory = enforceVerifiedContactInfo('Bên em sẽ gọi lại anh qua số 0938 821 133 ạ.', {
    sourceKey: KINGCOM,
    userText: 'liên hệ mình sớm nhé',
    history: [{ direction: 'in', text: '0938821133' }]
  });
  assert.equal(fromHistory.ok, true);

  const price = enforceVerifiedContactInfo('Giá 1.290.000đ, link: https://store.kingcom.com.vn/products/fifine-bm88-0903123456', { sourceKey: KINGCOM });
  assert.equal(price.ok, true);
});

test('phone previously written by the bot is not trusted', () => {
  const result = enforceVerifiedContactInfo('Anh gọi hotline 0911 222 333 nhé.', {
    sourceKey: KINGCOM,
    history: [{ direction: 'out', text: 'hotline 0911 222 333' }]
  });
  assert.equal(result.ok, false);
});

test('store contact request detection', () => {
  assert.equal(isStoreContactRequest('Hotline'), true);
  assert.equal(isStoreContactRequest('cho mình xin số điện thoại shop'), true);
  assert.equal(isStoreContactRequest('tôi muốn số zalo của các bạn để nhắn cho dễ'), true);
  assert.equal(isStoreContactRequest('bên bạn có zalo không'), true);
  assert.equal(isStoreContactRequest('sdt của mình là 0938821133'), false);
  assert.equal(isStoreContactRequest('mic này giá bao nhiêu'), false);
});
