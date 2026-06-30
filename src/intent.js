function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasPhrase(msg, phrases) {
  return phrases.some(p => msg.includes(normalize(p)));
}

function hasWord(msg, words) {
  const tokens = new Set(msg.split(/\s+/).filter(Boolean));
  return words.some(w => tokens.has(normalize(w)));
}

function classifyIntent(text) {
  const raw = String(text || '');
  if (/[\u3400-\u9FFF\uF900-\uFAFF]/.test(raw)) {
    if (/(\u53c2\u6570|\u89c4\u683c|\u6280\u672f\u53c2\u6570|\u914d\u7f6e|\u5c3a\u5bf8|\u91cd\u91cf|\u529f\u7387|\u5206\u8fa8\u7387|\u4f20\u611f\u5668|\u5149\u5708)/.test(raw)) {
      return { intent: 'product_specs', confidence: 0.9 };
    }
    if (/(人工|客服|联系|電話|电话|回电|真人|員工|员工)/.test(raw)) return { intent: 'human', confidence: 0.9 };
    if (/(地址|门店|店铺|在哪|哪里)/.test(raw)) return { intent: 'store_info', confidence: 0.9 };
    if (/(笔记本|电脑|ThinkPad|MacBook|laptop)/i.test(raw)) return { intent: 'unsupported', confidence: 0.85 };
    if (/(价格|价钱|多少钱|报价|费用)/.test(raw)) return { intent: 'price', confidence: 0.85 };
    if (/(想买|购买|下单|有货|库存|可以买|我要买)/.test(raw)) return { intent: 'buy', confidence: 0.85 };
    if (/(产品|商品|三脚架|手机|麦克风|灯|相机|稳定器|滤镜|直播|配件)/.test(raw)) return { intent: 'product_search', confidence: 0.85 };
    if (/(你好|您好|哈喽|嗨)/.test(raw)) return { intent: 'greeting', confidence: 0.9 };
  }

  const msg = normalize(text);
  const hasPhoneNumber = /(?:\+?84|0)(?:[\s.-]?\d){8,10}\b/.test(raw);
  if (hasPhrase(msg, [
    'thong so', 'thong so ky thuat', 'cau hinh', 'chi tiet ky thuat',
    'chi tiet san pham', 'kich thuoc', 'trong luong', 'cong suat',
    'do phan giai', 'cam bien', 'khau do', 'tieu cu',
    'dung luong pin', 'thoi luong pin', 'pin bao lau',
    'cao bao nhieu', 'chieu cao', 'dai bao nhieu', 'rong bao nhieu',
    'nang bao nhieu', 'luc hut', 'tai trong', 'tuong thich',
    'dung duoc voi', 'dung duoc cho', 'ho tro iphone', 'ho tro android',
    'technical specification', 'technical specifications', 'product specification',
    'product specifications', 'compatible with', 'compatibility'
  ]) || hasWord(msg, ['spec', 'specs', 'specification', 'specifications', 'ram', 'height', 'weight', 'dimensions'])) {
    return { intent: 'product_specs', confidence: 0.9 };
  }
  if (hasPhoneNumber && (
    hasPhrase(msg, ['goi toi so', 'goi vao so', 'goi so', 'goi lai so', 'lien he so', 'so dien thoai', 'sdt', 'hotline'])
    || msg.split(/\s+/).filter(Boolean).length <= 10
  )) return { intent: 'human', confidence: 0.95 };

  if (hasPhrase(msg, ['y toi la', 'toi la', 'em la', 'minh la', 'ten toi la', 'ten em la', 'ten minh la', 'ten la'])) {
    return { intent: 'customer_info', confidence: 0.9 };
  }

  if (hasPhrase(msg, [
    'mat hang gi', 'mat hang nao', 'nhung mat hang gi', 'nhung mat hang nao',
    'ban mat hang gi', 'ban mat hang nao', 'ban nhung mat hang gi', 'ban nhung mat hang nao',
    'bay ban cac san pham gi', 'bay ban san pham gi', 'bay ban nhung san pham gi',
    'dang bay ban', 'dang ban nhung mat hang', 'dang ban mat hang',
    'chi ban moi', 'chi co moi', 'moi mat hang', 'moi san pham'
  ])) return { intent: 'catalog_info', confidence: 0.9 };

  if (hasWord(msg, ['mua', 'dat', 'chot'])) return { intent: 'buy', confidence: 0.85 };
  if (
    /\b(duoi|toi da|nho hon|be hon)\s*\d/i.test(msg)
    && (hasPhrase(msg, ['loai nao', 'mau nao', 'cai nao', 'san pham nao'])
      || hasWord(msg, ['loai', 'mau']))
  ) return { intent: 'product_search', confidence: 0.85 };
  if (hasPhrase(msg, ['looking for', 'i am looking', 'im looking', 'please im looking', 'please i am looking']) || hasWord(msg, ['tripod', 'mobile', 'phone', 'smartphone'])) return { intent: 'product_search', confidence: 0.85 };
  if (hasPhrase(msg, ['i want to buy', 'want to buy', 'looking to buy']) || hasWord(msg, ['buy'])) return { intent: 'buy', confidence: 0.85 };

  if (hasPhrase(msg, ['nhân viên','người thật','gặp tư vấn','gọi lại','hotline'])) return { intent: 'human', confidence: 0.9 };
  if (hasPhrase(msg, ['địa chỉ','dia chi','ở đâu','o dau','cửa hàng','cua hang','shop ở đâu','shop o dau'])) return { intent: 'store_info', confidence: 0.9 };
  if (hasPhrase(msg, [
    'có nhiều sản phẩm', 'co nhieu san pham', 'có nhiều sp', 'co nhieu sp',
    'kingcom có nhiều', 'kingcom co nhieu', 'bên mình có nhiều', 'ben minh co nhieu',
    'bán sản phẩm gì', 'ban san pham gi', 'bán những sản phẩm gì', 'ban nhung san pham gi',
    'bán sản phẩm nào', 'ban san pham nao', 'bán những sản phẩm nào', 'ban nhung san pham nao',
    'bán mặt hàng gì', 'ban mat hang gi', 'bán mặt hàng nào', 'ban mat hang nao',
    'bán những mặt hàng gì', 'ban nhung mat hang gi', 'bán những mặt hàng nào', 'ban nhung mat hang nao',
    'bán các loại sản phẩm nào', 'ban cac loai san pham nao',
    'bày bán các sản phẩm gì', 'bay ban cac san pham gi', 'bày bán sản phẩm gì', 'bay ban san pham gi',
    'chỉ bán mỗi', 'chi ban moi', 'chỉ có mỗi', 'chi co moi',
    'có sản phẩm gì', 'co san pham gi', 'có những sản phẩm gì', 'co nhung san pham gi',
    'các sản phẩm đang được bán', 'cac san pham dang duoc ban',
    'sản phẩm đang được bán', 'san pham dang duoc ban',
    'sản phẩm đang bán', 'san pham dang ban',
    'danh mục sản phẩm', 'danh muc san pham', 'catalog'
  ])) return { intent: 'catalog_info', confidence: 0.9 };
  if (hasWord(msg, ['hello','hi','alo']) || hasPhrase(msg, ['xin chao','chao ban','chao shop','em chao'])) return { intent: 'greeting', confidence: 0.9 };

  const mentionsComputer = hasWord(msg, ['laptop','thinkpad','macbook','máy tính','may tinh', 'pc', 'windows', 'mac']);
  const asksCompatibility = hasPhrase(msg, [
    'dung cho', 'danh cho', 'dung voi', 'dung duoc voi', 'dung duoc cho',
    'cho may', 'cho laptop', 'cho may tinh', 'cam laptop', 'cam vao laptop',
    'ket noi laptop', 'ket noi may tinh', 'tuong thich laptop', 'tuong thich may tinh',
    'windows mac', 'win mac'
  ]);
  if (mentionsComputer && asksCompatibility) return { intent: 'product_specs', confidence: 0.9 };

  if (hasWord(msg, ['laptop','thinkpad','macbook','máy tính','may tinh'])) return { intent: 'unsupported', confidence: 0.85 };
  if (hasPhrase(msg, ['giá','bao nhiêu','cost','price']) || hasWord(msg, ['bn'])) return { intent: 'price', confidence: 0.85 };
  if (hasPhrase(msg, ['còn hàng','có hàng','tồn kho']) || hasWord(msg, ['mua','đặt','chốt','ban','bán'])) return { intent: 'buy', confidence: 0.85 };
  if (hasPhrase(msg, ['đơn hàng','mã đơn','giao hàng','vận chuyển']) || hasWord(msg, ['ship'])) return { intent: 'order', confidence: 0.85 };
  if (hasPhrase(msg, [
    'bảo hành', 'bao hanh', 'đổi trả', 'doi tra', 'chính sách', 'chinh sach',
    'full vat', 'vat', 'hóa đơn', 'hoa don', 'xuất hóa đơn', 'xuat hoa don'
  ]) || hasWord(msg, ['lỗi','sửa','return','vat'])) return { intent: 'warranty', confidence: 0.85 };
  if (hasPhrase(msg, ['tư vấn','san pham','sản phẩm']) || hasWord(msg, ['tìm','tim','lens','micro','đèn','den','camera','ulanzi','synco','zhiyun','viltrox','nanlite','samsung','gimbal','filter','kase','boya','fifine','maono','balo','backpack','tui','túi','bộ','bo','đàm','dam'])) return { intent: 'product_search', confidence: 0.85 };

  return { intent: 'general', confidence: 0.5 };
}
module.exports = { classifyIntent };
