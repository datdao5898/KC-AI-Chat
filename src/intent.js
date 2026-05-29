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
  if (hasPhoneNumber && (
    hasPhrase(msg, ['goi toi so', 'goi vao so', 'goi so', 'goi lai so', 'lien he so', 'so dien thoai', 'sdt', 'hotline'])
    || msg.split(/\s+/).filter(Boolean).length <= 10
  )) return { intent: 'human', confidence: 0.95 };

  if (hasPhrase(msg, ['y toi la', 'toi la', 'em la', 'minh la', 'ten toi la', 'ten em la', 'ten minh la', 'ten la'])) {
    return { intent: 'customer_info', confidence: 0.9 };
  }

  if (hasPhrase(msg, ['looking for', 'i am looking', 'im looking', 'please im looking', 'please i am looking']) || hasWord(msg, ['tripod', 'mobile', 'phone', 'smartphone'])) return { intent: 'product_search', confidence: 0.85 };
  if (hasPhrase(msg, ['i want to buy', 'want to buy', 'looking to buy']) || hasWord(msg, ['buy'])) return { intent: 'buy', confidence: 0.85 };

  if (hasPhrase(msg, ['nhân viên','người thật','gặp tư vấn','gọi lại','hotline'])) return { intent: 'human', confidence: 0.9 };
  if (hasPhrase(msg, ['địa chỉ','dia chi','ở đâu','o dau','cửa hàng','cua hang','shop ở đâu','shop o dau'])) return { intent: 'store_info', confidence: 0.9 };
  if (hasPhrase(msg, ['có nhiều sản phẩm','co nhieu san pham','có nhiều sp','co nhieu sp','kingcom có nhiều','kingcom co nhieu','bên mình có nhiều','ben minh co nhieu'])) return { intent: 'catalog_info', confidence: 0.85 };
  if (hasWord(msg, ['hello','hi','alo']) || hasPhrase(msg, ['xin chao','chao ban','chao shop','em chao'])) return { intent: 'greeting', confidence: 0.9 };

  if (hasWord(msg, ['laptop','thinkpad','macbook','máy tính','may tinh'])) return { intent: 'unsupported', confidence: 0.85 };
  if (hasPhrase(msg, ['giá','bao nhiêu','cost','price']) || hasWord(msg, ['bn'])) return { intent: 'price', confidence: 0.85 };
  if (hasPhrase(msg, ['còn hàng','có hàng','tồn kho']) || hasWord(msg, ['mua','đặt','chốt','ban','bán'])) return { intent: 'buy', confidence: 0.85 };
  if (hasPhrase(msg, ['đơn hàng','mã đơn','giao hàng','vận chuyển']) || hasWord(msg, ['ship'])) return { intent: 'order', confidence: 0.85 };
  if (hasPhrase(msg, ['bảo hành','đổi trả']) || hasWord(msg, ['lỗi','sửa','return'])) return { intent: 'warranty', confidence: 0.85 };
  if (hasPhrase(msg, ['tư vấn','san pham','sản phẩm']) || hasWord(msg, ['tìm','tim','lens','micro','đèn','den','camera','ulanzi','synco','zhiyun','viltrox','nanlite','samsung','gimbal','filter','kase','boya','fifine','maono','balo','backpack','tui','túi','bộ','bo','đàm','dam'])) return { intent: 'product_search', confidence: 0.85 };

  return { intent: 'general', confidence: 0.5 };
}
module.exports = { classifyIntent };
