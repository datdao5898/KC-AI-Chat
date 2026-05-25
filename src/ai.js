const {
  buildContext,
  queryWords,
  getPriceExtremes,
  isPriceExtremeQuery,
  requestedPriceExtremes,
  extractExactPrice,
  findProductsByExactPrice
} = require('./rag');

async function callOpenAI(prompt, timeoutMs) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY/OPENROUTER_API_KEY not configured');

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const maxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 700);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isOpenRouter = /openrouter\.ai/i.test(baseUrl);
  const appReferer = process.env.OPENROUTER_HTTP_REFERER || process.env.PUBLIC_BASE_URL || '';
  const appTitle = process.env.OPENROUTER_TITLE || 'KingCom AI Agent';

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
  if (isOpenRouter && appReferer) headers['HTTP-Referer'] = String(appReferer);
  if (isOpenRouter && appTitle) {
    headers['X-Title'] = String(appTitle);
    headers['X-OpenRouter-Title'] = String(appTitle);
  }

  const formattedPrompt = `${prompt}

Yêu cầu định dạng bắt buộc:
- Trả lời bằng văn bản thuần, không dùng markdown.
- Không dùng ký tự ** để in đậm.
- Không dùng emoji hoặc icon trang trí.`;

  const requestBody = {
    model,
    messages: [{ role: 'user', content: formattedPrompt }]
  };
  requestBody[isOpenRouter ? 'max_tokens' : 'max_completion_tokens'] = maxOutputTokens;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify(requestBody)
    });

    const raw = await res.text();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 1000)}`);

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('OpenAI returned invalid JSON');
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned empty response');
    return String(content).trim();
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`OpenAI timeout after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function formatPrice(price) {
  const n = Number(String(price || '').replace(/[^0-9]/g, ''));
  return n ? n.toLocaleString('vi-VN') + 'đ' : (price || 'liên hệ');
}

function productLine(product, index = 1) {
  const name = product.name || product.title || product.sku || `Sản phẩm ${index}`;
  const sku = product.sku ? `SKU: ${product.sku}` : 'SKU: N/A';
  const price = formatPrice(product._price || product.price || product.compare_at_price || product.gia || '');
  const url = product.url || product.link || product.product_url || '';
  return `${index}. ${name}\n${sku}\nGiá: ${price}${url ? `\nLink: ${url}` : ''}`;
}

function buildDirectPriceReply(userText) {
  const exactPrice = extractExactPrice(userText);
  const looksLikeExactPriceQuestion = exactPrice && /(là|la|sản phẩm|san pham|mức giá|muc gia|giá|gia)/i.test(String(userText || ''));
  if (looksLikeExactPriceQuestion && !isPriceExtremeQuery(userText)) {
    const matches = findProductsByExactPrice(userText, 5);
    if (matches.length) {
      return {
        reply: `Dạ mức giá ${formatPrice(exactPrice)} đang khớp với sản phẩm sau trong dữ liệu KingCom:\n\n${matches.map((p, i) => productLine(p, i + 1)).join('\n\n')}`,
        products: matches,
        source: 'direct_price_lookup'
      };
    }
    return {
      reply: `Dạ em chưa tìm thấy sản phẩm nào có giá đúng ${formatPrice(exactPrice)} trong dữ liệu KingCom. Em đã chuyển thông tin này cho nhân viên KingCom kiểm tra để tránh tư vấn sai. Anh/chị cho em xin thêm model hoặc số điện thoại để tư vấn viên hỗ trợ nhanh hơn ạ.`,
      products: [],
      source: 'direct_price_lookup'
    };
  }

  if (!isPriceExtremeQuery(userText)) return null;

  const { mostExpensive, cheapest } = getPriceExtremes();
  const requested = requestedPriceExtremes(userText);
  const includeExpensive = requested.expensive || (!requested.expensive && !requested.cheap);
  const includeCheap = requested.cheap;
  const sections = [];
  const products = [];

  if (includeExpensive && mostExpensive) {
    sections.push(`Sản phẩm mắc nhất trong dữ liệu KingCom hiện tại:\n${productLine(mostExpensive, 1)}`);
    products.push(mostExpensive);
  }
  if (includeCheap && cheapest) {
    sections.push(`Sản phẩm rẻ nhất trong dữ liệu KingCom hiện tại:\n${productLine(cheapest, 1)}`);
    products.push(cheapest);
  }

  if (!sections.length) return null;
  return {
    reply: `Dạ em kiểm tra trực tiếp từ dữ liệu sản phẩm hiện tại:\n\n${sections.join('\n\n')}\n\nGiá có thể thay đổi theo tồn kho và chương trình bán hàng. Nếu anh/chị muốn chốt mua, em có thể chuyển nhân viên kiểm tra lại giá và tồn kho chính xác.`,
    products,
    source: 'direct_price_lookup'
  };
}

function productLinkBlock(products, max = 5) {
  const rows = (products || []).filter(p => p.url || p.link || p.product_url).slice(0, max);
  if (!rows.length) return '';
  return 'Link sản phẩm để anh/chị xem trực tiếp:\n' + rows.map((p, i) => {
    const url = p.url || p.link || p.product_url;
    const name = p.name || p.title || p.sku || `Sản phẩm ${i + 1}`;
    const price = formatPrice(p.price || p.compare_at_price || p.gia || '');
    return `${i + 1}. ${name} - ${price}\n${url}`;
  }).join('\n');
}

function ensureProductLinks(reply, products) {
  const block = productLinkBlock(products);
  if (!block) return reply;
  const urls = (products || []).map(p => p.url || p.link || p.product_url).filter(Boolean);
  const hasAnyUrl = urls.some(u => reply && reply.includes(u));
  return hasAnyUrl ? reply : `${reply}\n\n${block}`;
}

function fallbackReply(intent, userText, products) {
  if (intent === 'greeting') {
    return 'Dạ em chào anh/chị ạ! KingCom hỗ trợ phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung. Anh/chị cần em tư vấn sản phẩm nào ạ?';
  }
  if (intent === 'store_info') {
    return 'Dạ địa chỉ cửa hàng KingCom là 65 Nguyễn Minh Hoàng, phường Bảy Hiền, TP. Hồ Chí Minh ạ.';
  }
  if (intent === 'unsupported') {
    return 'Dạ hiện KingCom chưa kinh doanh laptop/ThinkPad ạ. Bên em chuyên phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung. Anh/chị cần em tư vấn gimbal, micro, đèn, filter, tripod hoặc phụ kiện quay chụp nào không ạ?';
  }
  if (intent === 'human') {
    return 'Dạ mình đã ghi nhận yêu cầu gặp nhân viên. Bạn vui lòng để lại số điện thoại để KingCom liên hệ tư vấn nhanh nhất nhé.';
  }
  if (products && products.length) {
    const p = products[0];
    const url = p.url || p.link || p.product_url || '';
    const base = `KingCom tìm thấy sản phẩm phù hợp: ${p.name || p.title} (SKU: ${p.sku || 'N/A'}), giá ${formatPrice(p.price || 'liên hệ')}.${url ? `\nLink xem sản phẩm: ${url}` : ''}\nBạn muốn mình tư vấn thêm mẫu nào ạ?`;
    return ensureProductLinks(base, products);
  }
  return 'Bạn vui lòng cho mình biết rõ hơn tên sản phẩm hoặc nhu cầu sử dụng để KingCom tư vấn chính xác nhé.';
}

function isFollowUpLinkRequest(text) {
  const t = String(text || '').toLowerCase();
  return /(link|gửi link|gui link|kèm link|kem link|link mua|đặt hàng|dat hang|mua ở đâu|mua o dau)/i.test(t) && queryWords(t).length <= 2;
}

function buildSearchQuery(userText, history, customer) {
  const currentWords = queryWords(userText);
  const recentCustomer = (history || [])
    .filter(m => m.sender_type === 'customer')
    .slice(-4)
    .map(m => m.text)
    .join(' ');
  const interests = customer?.interested_products || '';
  if (isFollowUpLinkRequest(userText) || currentWords.length <= 1) {
    return `${userText} ${recentCustomer} ${interests}`;
  }
  return userText;
}

async function generateReply({ channel, userText, history, customer, intent }) {
  if (intent === 'store_info') {
    return { reply: 'Dạ địa chỉ cửa hàng KingCom là 65 Nguyễn Minh Hoàng, phường Bảy Hiền, TP. Hồ Chí Minh ạ. Anh/chị cần em hỗ trợ thêm sản phẩm nào không?', aiUsed: 0, aiError: false, aiSource: 'rule', ragProducts: [] };
  }

  if (intent === 'catalog_info') {
    return { reply: 'Dạ KingCom có nhiều sản phẩm phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung như gimbal, micro, đèn, filter, tripod, màn hình phụ, thiết bị livestream... Anh/chị đang quan tâm nhóm sản phẩm nào để em tư vấn mẫu phù hợp ạ?', aiUsed: 0, aiError: false, aiSource: 'rule', ragProducts: [] };
  }

  if (intent === 'unsupported') {
    return { reply: 'Dạ hiện KingCom chưa kinh doanh laptop/ThinkPad ạ. Bên em chuyên phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung như gimbal, micro, đèn, filter, tripod... Anh/chị cần em tư vấn nhóm sản phẩm nào ạ?', aiUsed: 0, aiError: false, aiSource: 'rule', ragProducts: [] };
  }

  const directPriceReply = buildDirectPriceReply(userText);
  if (directPriceReply) {
    return {
      reply: directPriceReply.reply,
      aiUsed: 0,
      aiError: false,
      aiSource: directPriceReply.source,
      searchQuery: userText,
      ragProducts: directPriceReply.products
    };
  }

  if (intent === 'greeting' || intent === 'human') {
    const greetingPrompt = `Bạn là nhân viên tư vấn của KingCom, cửa hàng phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung. Trả lời tiếng Việt, ngắn gọn, thân thiện, tự nhiên như người thật đang chat với khách.

Địa chỉ cửa hàng KingCom: 65 Nguyễn Minh Hoàng, phường Bảy Hiền, thành phố Hồ Chí Minh, Việt Nam

Ý định: ${intent}
${intent === 'human' ? 'Khách yêu cầu gặp nhân viên.' : 'Khách đang chào hỏi.'}

Quy tắc giọng nói:
- Không tự xưng là AI, bot, trợ lý ảo, hệ thống tự động.
- Xưng “em” hoặc “KingCom”, gọi khách là “anh/chị” khi phù hợp.
- KingCom KHÔNG phải cửa hàng mỹ phẩm. Tuyệt đối không nói KingCom bán mỹ phẩm/làm đẹp.
- Khi giới thiệu KingCom, chỉ nói là cửa hàng phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung.
- Nếu không chắc thông tin, nói “em kiểm tra thêm” hoặc “em chuyển nhân viên phụ trách kiểm tra”, không nói “AI không biết”.

${intent === 'greeting' ? 'Chào lại khách ngắn gọn, hỏi khách cần hỗ trợ gì. KHÔNG liệt kê sản phẩm, KHÔNG gợi ý sản phẩm cụ thể.' : 'Ghi nhận yêu cầu. Hỏi khách để lại số điện thoại để nhân viên liên hệ. KHÔNG liệt kê sản phẩm.'}`;
    try {
      const reply = await callOpenAI(greetingPrompt, Number(process.env.AI_TIMEOUT_MS || 45000));
      return { reply, aiUsed: 1, aiError: false, aiSource: 'provider', ragProducts: [] };
    } catch (e) {
      console.error('OpenAI greeting error:', e.message);
      return {
        reply: intent === 'greeting'
          ? 'Xin chào! KingCom có thể hỗ trợ bạn tìm sản phẩm, báo giá, giao hàng hoặc bảo hành ạ.'
          : 'Dạ mình đã ghi nhận yêu cầu gặp nhân viên. Bạn vui lòng để lại số điện thoại để KingCom liên hệ tư vấn nhanh nhất nhé.',
        aiUsed: 0,
        aiError: true,
        aiErrorMessage: e.message,
        aiSource: 'fallback',
        ragProducts: []
      };
    }
  }

  const searchQuery = buildSearchQuery(userText, history, customer);
  const { context, products } = buildContext(searchQuery);
  const historyText = (history || []).slice(-8).map(m => `${m.sender_type}: ${m.text}`).join('\n');

  const prompt = `Bạn là nhân viên tư vấn của KingCom, cửa hàng phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung. Trả lời tiếng Việt, ngắn gọn, thân thiện, tự nhiên như người thật đang chat với khách, đúng dữ liệu.

Địa chỉ cửa hàng KingCom: 65 Nguyễn Minh Hoàng, phường Bảy Hiền, thành phố Hồ Chí Minh, Việt Nam

Kênh: ${channel}
Ý định dự đoán: ${intent}
Thông tin khách đã học: ${customer?.profile_summary || ''}
Sản phẩm khách từng quan tâm: ${customer?.interested_products || '[]'}

Lịch sử gần đây:
${historyText}

Truy vấn dùng để tìm sản phẩm: ${searchQuery}

Dữ liệu tham khảo:
${context}

Khách hỏi: ${userText}

Quy tắc:
- Không tự xưng là AI, bot, trợ lý ảo, chatbot, hệ thống tự động.
- Không nói kiểu “tôi là trợ lý ảo”. Hãy xưng “em” hoặc “KingCom”, gọi khách là “anh/chị” khi phù hợp.
- KingCom KHÔNG phải cửa hàng mỹ phẩm. Tuyệt đối không nói KingCom bán mỹ phẩm/làm đẹp.
- Khi giới thiệu KingCom, chỉ nói là cửa hàng phụ kiện nhiếp ảnh, quay phim và thiết bị sáng tạo nội dung.
- Nếu không chắc thông tin, nói “em kiểm tra thêm” hoặc “em chuyển nhân viên phụ trách kiểm tra”, không nói “AI không biết/không có dữ liệu”.
- Nếu khách hỏi ngắn kiểu "gửi link", "kèm link", "link mua", hãy hiểu là họ đang hỏi tiếp về sản phẩm đã nhắc gần nhất trong lịch sử, không được đổi sang sản phẩm khác.
- Chỉ dùng dữ liệu tham khảo nếu nói giá/sản phẩm.
- Khi tư vấn hoặc liệt kê sản phẩm, bắt buộc đính kèm link sản phẩm trực tiếp từ trường Link/url trong dữ liệu tham khảo để khách bấm xem.
- Nếu có nhiều sản phẩm phù hợp, liệt kê tối đa 3-5 sản phẩm, mỗi sản phẩm gồm: tên, giá, link xem sản phẩm.
- Nếu khách hỏi địa chỉ cửa hàng, cho địa chỉ: 65 Nguyễn Minh Hoàng, phường Bảy Hiền, thành phố Hồ Chí Minh, Việt Nam.
- Nếu không chắc, xin số điện thoại hoặc đề nghị nhân viên tư vấn.
- Nếu khách muốn mua/chốt/gặp người thật, hỏi số điện thoại và chuyển nhân viên.
- Không bịa link, tồn kho, bảo hành cụ thể hoặc khuyến mãi nếu dữ liệu không có.`;

  try {
    const reply = await callOpenAI(prompt, Number(process.env.AI_TIMEOUT_MS || 45000));
    return { reply: ensureProductLinks(reply, products), aiUsed: 1, aiError: false, aiSource: 'provider', searchQuery, ragProducts: products };
  } catch (e) {
    console.error('OpenAI async error:', e.message);
    return { reply: fallbackReply(intent, userText, products), aiUsed: 0, aiError: true, aiErrorMessage: e.message, aiSource: 'fallback', searchQuery, ragProducts: products };
  }
}

function fallbackSummary(messages, customer) {
  const lastCustomer = [...(messages || [])].reverse().find(m => m.sender_type === 'customer');
  const interests = customer?.interested_products || '[]';
  return `Tóm tắt tự động: khách quan tâm ${interests}. Tin nhắn gần nhất: ${lastCustomer?.text || 'chưa rõ'}.`;
}

async function summarizeConversation({ messages, customer }) {
  const compact = (messages || []).slice(-20).map(m => `${m.sender_type}: ${m.text}`).join('\n');
  if (!compact.trim()) return '';

  const prompt = `Tóm tắt hội thoại CSKH dưới đây bằng tiếng Việt, tối đa 5 gạch đầu dòng. Nêu: nhu cầu khách, sản phẩm quan tâm, ý định mua, thông tin cần follow-up. Không bịa dữ liệu.

Thông tin khách đã học: ${customer?.profile_summary || ''}
Sản phẩm quan tâm: ${customer?.interested_products || '[]'}

Hội thoại:
${compact}`;

  try {
    const summary = await callOpenAI(prompt, Number(process.env.SUMMARY_TIMEOUT_MS || 30000));
    return summary.slice(0, 2000);
  } catch (e) {
    console.error('OpenAI summary error:', e.message);
    return fallbackSummary(messages, customer);
  }
}

function summarizeConversationFast({ messages, customer }) {
  return fallbackSummary(messages, customer);
}

module.exports = { generateReply, summarizeConversation, summarizeConversationFast };
