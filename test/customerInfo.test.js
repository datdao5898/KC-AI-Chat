const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCustomerInfo, hasPhoneNumber, isPhoneCorrection, isValidTaxCode, isValidVnPhone } = require('../src/customerInfo');

const INVOICE = `Thông tin xuất hoá đơn
Tên công ty: CÔNG TY TNHH MẪU MỘT
Mã số thuế: 0310000017
Địa chỉ công ty: Số 1 Đường Mẫu,  Phường Một, Thành phố Hồ Chí Minh, Việt Nam
Người đại diện: (Bà) NGUYỄN THỊ MẪU
Email nhận hóa đơn điện tử: invoice@example.vn

sản phẩm cần mua: Ulanzi MT-08`;

test('invoice message: tax code, company and email go to their own fields', () => {
  const info = extractCustomerInfo(INVOICE);
  assert.equal(info.phone, '');
  assert.equal(info.name, '');
  assert.equal(info.taxCode, '0310000017');
  assert.equal(info.companyName, 'CÔNG TY TNHH MẪU MỘT');
  assert.match(info.companyAddress, /^Số 1 Đường/);
  assert.equal(info.invoiceEmail, 'invoice@example.vn');
  assert.equal(info.email, '');
  assert.equal(info.isInvoiceInfo, true);
});

test('other invoice message layouts are not read as phone or person', () => {
  const jointStock = extractCustomerInfo('CÔNG TY CỔ PHẦN MẪU HAI\nMã số thuế: 0110000002\nĐịa chỉ trụ sở chính: Phòng 101, Tòa nhà Mẫu');
  assert.deepEqual([jointStock.phone, jointStock.name, jointStock.taxCode], ['', '', '0110000002']);
  assert.equal(jointStock.companyName, 'CÔNG TY CỔ PHẦN MẪU HAI');

  const withOrderCode = extractCustomerInfo('Mã đơn hàng: 000000MAUDONHANG\nThông tin xuất VaT:\n- Tên công ty: CÔNG TY TNHH MẪU BA\n- Mã số thuế: 0310001003\n- Địa chỉ mới: Căn Số 1 Tháp A');
  assert.deepEqual([withOrderCode.phone, withOrderCode.name, withOrderCode.taxCode], ['', '', '0310001003']);
  assert.equal(withOrderCode.companyName, 'CÔNG TY TNHH MẪU BA');

  const starredLabels = extractCustomerInfo('CÔNG TY TNHH Mẫu Bốn\nMã số thuế *:    0310002007\nTên chủ thể *:    CÔNG TY TNHH MẪU BỐN');
  assert.deepEqual([starredLabels.phone, starredLabels.name, starredLabels.taxCode], ['', '', '0310002007']);
});

test('tax code and phone in one message each go to the right field', () => {
  const info = extractCustomerInfo('Công ty TNHH ABC, MST 0310000017, sdt 0912345678, anh Nam');
  assert.equal(info.taxCode, '0310000017');
  assert.equal(info.phone, '0912345678');
  assert.equal(info.companyName, 'Công ty TNHH ABC');
  assert.equal(info.name, 'anh Nam');

  const reversed = extractCustomerInfo('0912345678\nmã số thuế là 0310000017');
  assert.equal(reversed.phone, '0912345678');
  assert.equal(reversed.taxCode, '0310000017');
});

test('tax code labels and formats', () => {
  assert.equal(extractCustomerInfo('MST: 0310000017').taxCode, '0310000017');
  assert.equal(extractCustomerInfo('ma so thue cua cong ty la 0310000017').taxCode, '0310000017');
  assert.equal(extractCustomerInfo('0310000017 là mst').taxCode, '0310000017');
  assert.equal(extractCustomerInfo('Tax code: 0310000017').taxCode, '0310000017');
  assert.equal(extractCustomerInfo('MST 0310000017-001').taxCode, '0310000017-001');
  assert.equal(extractCustomerInfo('MST 0310000017-001').phone, '');
  // Labelled tax codes do not start with 0 in every province.
  assert.equal(extractCustomerInfo('MST: 2301234567').taxCode, '2301234567');
  // A label wins even when the digits look exactly like a mobile number.
  const mobileShaped = extractCustomerInfo('Mã số thuế: 0912345678');
  assert.equal(mobileShaped.taxCode, '0912345678');
  assert.equal(mobileShaped.phone, '');
});

test('an unlabelled tax code is recognised only with business context and a valid check digit', () => {
  const info = extractCustomerInfo('Xuất hóa đơn cho công ty mình nhé 0310000017');
  assert.equal(info.taxCode, '0310000017');
  assert.equal(info.phone, '');
  assert.equal(extractCustomerInfo('0310000017').phone, '');
  assert.equal(extractCustomerInfo('0310000017').taxCode, '');
  assert.equal(extractCustomerInfo('công ty mình 0310000018').taxCode, '');
});

test('numbers that are neither a phone nor a tax code are left alone', () => {
  for (const text of ['STK 0123456789012', 'số tài khoản: 0912345678', 'Mã đơn hàng: 0912345678', 'CCCD 079123456789', 'mã sp 0912345678']) {
    assert.equal(extractCustomerInfo(text).phone, '', text);
  }
  assert.equal(extractCustomerInfo('Điện thoại công ty: 02838123456').phone, '');
});

test('real phone numbers are still recognised', () => {
  for (const [text, phone] of [
    ['0909123456', '0909123456'],
    ['goi toi so 0909123456', '0909123456'],
    ['sdt 0912.345.678', '0912345678'],
    ['số điện thoại: 0912 345 678', '0912345678'],
    ['+84912345678', '+84912345678'],
    ['028 3823 1234', '02838231234'],
    ['Tôi là Lan 0912345678', '0912345678']
  ]) {
    assert.equal(extractCustomerInfo(text).phone, phone, text);
  }
  // Explicitly called a phone number, so an odd prefix is the customer's word to give.
  assert.equal(extractCustomerInfo('sdt: 0110000002').phone, '0110000002');
  assert.equal(hasPhoneNumber('Mã số thuế: 0310000017'), false);
  assert.equal(hasPhoneNumber('sdt 0909123456'), true);
});

test('company names and address words never become the customer name', () => {
  for (const text of [
    'Địa chỉ công ty: 12 Lê Lợi, 0912345678',
    'dia chi cong ty 12 Le Loi 0912345678',
    'Địa chỉ mới: 12 Lê Lợi 0912345678',
    'CÔNG TY CỔ PHẦN ABC 0912345678',
    'Tên công ty: Minh Anh, sdt 0912345678',
    'Tôi là kế toán công ty ABC',
    'em là nhân viên công ty XYZ',
    'mình là khách cũ',
    'ý tôi là tripod',
    'Người đại diện: Phan Văn A'
  ]) {
    assert.equal(extractCustomerInfo(text).name, '', text);
  }
});

test('regressions found by replaying real logged messages', () => {
  const longMessage = 'Tôi đã gửi video qua email đến địa chỉ customer@example.com, với tiêu đề #100000. Các bạn có thể gọi cho tôi theo số 0328000111 hoặc liên hệ qua WhatsApp';
  const info = extractCustomerInfo(longMessage);
  assert.equal(info.phone, '0328000111');
  assert.equal(info.email, 'customer@example.com');

  assert.equal(extractCustomerInfo('tên cửa hàng mình là gì ạ').name, '');
  assert.equal(extractCustomerInfo('ANh vừa gọi hỏi mua cái máy quay OBSBOT Tail 2').name, '');
});

test('real customer names are still recognised', () => {
  assert.equal(extractCustomerInfo('Tôi là Nguyễn Văn Toàn').name, 'Nguyễn Văn Toàn');
  assert.equal(extractCustomerInfo('mình là Lan cần mua tripod').name, 'Lan');
  assert.equal(extractCustomerInfo('em là Hoa ở công ty ABC').name, 'Hoa');
  assert.equal(extractCustomerInfo('anh Nam 0912345678').name, 'anh Nam');
  assert.equal(extractCustomerInfo('chị Lan sdt 0912345678').name, 'chị Lan');
  assert.equal(extractCustomerInfo('chi Lan 0912345678').name, 'chi Lan');
  assert.equal(extractCustomerInfo('Họ tên: Trần Thị B\nSĐT: 0912345678').name, 'Trần Thị B');
});

test('email outside an invoice is the customer email', () => {
  assert.equal(extractCustomerInfo('email của mình là a@b.vn').email, 'a@b.vn');
  assert.equal(extractCustomerInfo('email của mình là a@b.vn').invoiceEmail, '');
});

test('mentioning a company alone is not an invoice submission', () => {
  assert.equal(extractCustomerInfo('công ty mình cần mua 10 tripod').isInvoiceInfo, false);
  assert.equal(extractCustomerInfo('shop có xuất hóa đơn không').isInvoiceInfo, false);
  assert.equal(extractCustomerInfo('MST là gì vậy shop').taxCode, '');
});

test('validators', () => {
  for (const code of ['0310000017', '0310001003', '0110000002', '0310002007', '0310000017-001']) {
    assert.equal(isValidTaxCode(code), true, code);
  }
  assert.equal(isValidTaxCode('0310000018'), false);
  assert.equal(isValidVnPhone('0310000017'), false);
  assert.equal(isValidVnPhone('0912345678'), true);
  assert.equal(isValidVnPhone('+84912345678'), true);
});

test('phone corrections', () => {
  assert.equal(isPhoneCorrection('số này không phải sdt'), true);
  assert.equal(isPhoneCorrection('so nay ko phai so dien thoai'), true);
  assert.equal(isPhoneCorrection('số đó là mã số thuế'), true);
  assert.equal(isPhoneCorrection('that is not a phone number'), true);
  assert.equal(isPhoneCorrection('số này không phải hotline của shop à'), false);
  assert.equal(isPhoneCorrection('sdt của mình là 0912345678'), false);
});
