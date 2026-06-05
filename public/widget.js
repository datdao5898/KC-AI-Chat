(function () {
  const currentScript = document.currentScript;
  const apiBase = currentScript && currentScript.src ? new URL(currentScript.src).origin : window.location.origin;
  const widgetId = 'kc-chat-widget';
  const styleId = 'kc-chat-widget-style';

  if (document.getElementById(widgetId)) return;

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap');

    #kc-chat-widget, #kc-chat-launcher {
      box-sizing: border-box;
      font-family: "Quicksand", Arial, Helvetica, sans-serif;
      letter-spacing: 0;
    }
    #kc-chat-widget * {
      box-sizing: border-box;
      letter-spacing: 0;
    }
    #kc-chat-widget {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: min(420px, calc(100vw - 32px));
      height: min(620px, calc(100vh - 40px));
      background: #f8fafc;
      color: #0f172a;
      border: 1px solid #dbe7f0;
      border-radius: 18px;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.26);
      z-index: 99999;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    #kc-chat-widget.kc-closed {
      display: none;
    }
    .kc-head {
      min-height: 56px;
      padding: 0 14px 0 16px;
      background: #2563eb;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-weight: 700;
      font-size: 16px;
    }
    .kc-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kc-minimize {
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.16);
      color: #fff;
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
    }
    .kc-minimize:hover {
      background: rgba(255, 255, 255, 0.24);
    }
    .kc-messages {
      flex: 1;
      overflow: auto;
      padding: 16px;
      background: #eef6f8;
      scrollbar-width: thin;
      scrollbar-color: #94a3b8 transparent;
    }
    .kc-lead {
      padding: 12px 14px;
      background: #ffffff;
      border-bottom: 1px solid #dbe7f0;
    }
    .kc-lead-title {
      margin: 0 0 8px;
      color: #0f172a;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.35;
    }
    .kc-lead-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .kc-lead-input {
      min-width: 0;
      height: 38px;
      padding: 0 10px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      color: #0f172a;
      font-size: 13px;
      outline: none;
    }
    .kc-lead-input:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
    }
    .kc-row {
      display: flex;
      flex-direction: column;
      margin: 0 0 12px;
      max-width: 100%;
    }
    .kc-row-user {
      align-items: flex-end;
    }
    .kc-row-bot {
      align-items: flex-start;
    }
    .kc-name {
      margin: 0 0 4px;
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
    }
    .kc-bubble {
      max-width: 86%;
      padding: 10px 12px;
      border-radius: 14px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      line-height: 1.42;
      font-size: 14px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
    }
    .kc-row-user .kc-bubble {
      background: #2563eb;
      color: #fff;
      border-bottom-right-radius: 5px;
    }
    .kc-row-bot .kc-bubble {
      background: #fff;
      color: #0f172a;
      border: 1px solid #e2e8f0;
      border-bottom-left-radius: 5px;
    }
    .kc-bubble a {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      margin: 2px 0;
      padding: 4px 8px;
      border-radius: 999px;
      background: #eaf2ff;
      color: #075985;
      font-weight: 700;
      text-decoration: none;
      vertical-align: baseline;
    }
    .kc-bubble a:hover {
      text-decoration: underline;
    }
    .kc-form {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #dbe7f0;
      background: #fff;
    }
    .kc-input {
      min-width: 0;
      flex: 1;
      height: 42px;
      padding: 0 12px;
      border-radius: 12px;
      border: 1px solid #cbd5e1;
      color: #0f172a;
      font-size: 14px;
      outline: none;
    }
    .kc-input:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
    }
    .kc-send {
      width: 58px;
      height: 42px;
      border: 0;
      border-radius: 12px;
      background: #0f172a;
      color: #fff;
      cursor: pointer;
      font-weight: 700;
      font-size: 14px;
    }
    .kc-send:disabled {
      cursor: wait;
      opacity: 0.64;
    }
    #kc-chat-launcher {
      position: fixed;
      right: 20px;
      bottom: 20px;
      min-width: 96px;
      height: 46px;
      border: 0;
      border-radius: 999px;
      background: #2563eb;
      color: #fff;
      box-shadow: 0 18px 45px rgba(37, 99, 235, 0.32);
      cursor: pointer;
      font-weight: 700;
      z-index: 99999;
      display: none;
    }
    @media (max-width: 520px) {
      #kc-chat-widget {
        left: 12px;
        right: 12px;
        bottom: 12px;
        width: auto;
        height: min(620px, calc(100vh - 24px));
        border-radius: 16px;
      }
      .kc-bubble {
        max-width: 92%;
        font-size: 14px;
      }
      #kc-chat-launcher {
        right: 12px;
        bottom: 12px;
      }
      .kc-lead-grid {
        grid-template-columns: 1fr;
      }
    }
  `;

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }

  const box = document.createElement('section');
  box.id = widgetId;
  box.setAttribute('aria-label', 'KingCom');

  const head = document.createElement('div');
  head.className = 'kc-head';

  const title = document.createElement('div');
  title.className = 'kc-title';
  title.textContent = 'KingCom';

  const minimize = document.createElement('button');
  minimize.className = 'kc-minimize';
  minimize.type = 'button';
  minimize.setAttribute('aria-label', 'Thu gon widget');
  minimize.textContent = '-';

  head.append(title, minimize);

  const messages = document.createElement('div');
  messages.className = 'kc-messages';

  const lead = document.createElement('div');
  lead.className = 'kc-lead';

  const leadTitle = document.createElement('p');
  leadTitle.className = 'kc-lead-title';
  leadTitle.textContent = 'Anh/chị có thể để lại tên và số điện thoại để KingCom hỗ trợ nhanh hơn.';

  const leadGrid = document.createElement('div');
  leadGrid.className = 'kc-lead-grid';

  const nameInput = document.createElement('input');
  nameInput.className = 'kc-lead-input';
  nameInput.placeholder = 'Tên của anh/chị';
  nameInput.autocomplete = 'name';

  const phoneInput = document.createElement('input');
  phoneInput.className = 'kc-lead-input';
  phoneInput.placeholder = 'Số điện thoại';
  phoneInput.autocomplete = 'tel';
  phoneInput.inputMode = 'tel';

  leadGrid.append(nameInput, phoneInput);
  lead.append(leadTitle, leadGrid);

  const form = document.createElement('div');
  form.className = 'kc-form';

  const input = document.createElement('input');
  input.className = 'kc-input';
  input.placeholder = 'Nhập câu hỏi...';
  input.autocomplete = 'off';

  const button = document.createElement('button');
  button.className = 'kc-send';
  button.type = 'button';
  button.textContent = 'Gửi';

  const launcher = document.createElement('button');
  launcher.id = 'kc-chat-launcher';
  launcher.type = 'button';
  launcher.textContent = 'Chat';

  form.append(input, button);
  box.append(head, lead, messages, form);
  document.body.append(box, launcher);

  const vid = localStorage.kcVisitorId || (localStorage.kcVisitorId = 'web-' + Date.now());
  const renderedMessageIds = new Set();
  let lastPollAt = '';
  let isPolling = false;
  let historyLoaded = false;
  nameInput.value = localStorage.kcCustomerName || '';
  phoneInput.value = localStorage.kcCustomerPhone || '';

  nameInput.oninput = () => saveOptionalContact();
  phoneInput.oninput = () => saveOptionalContact();
  nameInput.onkeydown = e => { if (e.key === 'Enter') input.focus(); };
  phoneInput.onkeydown = e => { if (e.key === 'Enter') input.focus(); };

  box.classList.add('kc-closed');
  launcher.style.display = 'block';

  minimize.onclick = () => {
    box.classList.add('kc-closed');
    launcher.style.display = 'block';
  };

  launcher.onclick = () => {
    launcher.style.display = 'none';
    box.classList.remove('kc-closed');
    pollWebsiteMessages();
    input.focus();
  };

  async function send() {
    const text = input.value.trim();
    if (!text || button.disabled) return;
    input.value = '';
    add('Bạn', text, 'user');
    const typing = add('KingCom', 'Đang soạn...', 'bot');
    button.disabled = true;

    try {
      const { customerName, customerPhone } = saveOptionalContact();

      const res = await fetch(`${apiBase}/webhooks/website-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: vid,
          message: text,
          name: customerName,
          phone: customerPhone,
          siteName: currentScript?.dataset?.siteName || '',
          siteHost: window.location.hostname,
          siteUrl: window.location.href,
          origin: window.location.origin,
          referrer: document.referrer || ''
        })
      });

      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok) throw new Error(data.error || `http_${res.status}`);

      typing.remove();
      add('KingCom', data.reply || 'Đã nhận tin nhắn', 'bot');
    } catch (e) {
      typing.remove();
      add('KingCom', 'Xin lỗi, hiện chưa gửi được tin nhắn. Anh/chị thử lại sau ít phút giúp em nhé.', 'bot');
    } finally {
      button.disabled = false;
      input.focus();
    }
  }

  function saveOptionalContact() {
    const customerName = nameInput.value.trim();
    const customerPhone = phoneInput.value.trim();
    if (customerName) localStorage.kcCustomerName = customerName;
    else localStorage.removeItem('kcCustomerName');
    if (customerPhone) localStorage.kcCustomerPhone = customerPhone;
    else localStorage.removeItem('kcCustomerPhone');
    return { customerName, customerPhone };
  }

  async function pollWebsiteMessages() {
    if (isPolling) return;
    isPolling = true;
    try {
      const params = new URLSearchParams({ visitorId: vid, limit: '20' });
      if (lastPollAt) params.set('since', lastPollAt);
      const res = await fetch(`${apiBase}/webhooks/website-chat/messages?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      const isInitialHistory = !historyLoaded && !lastPollAt;
      if (isInitialHistory && Array.isArray(data.messages) && data.messages.length) {
        messages.innerHTML = '';
      }
      for (const msg of data.messages || []) {
        if (msg.created_at) lastPollAt = msg.created_at;
        if (renderedMessageIds.has(msg.id)) continue;
        renderedMessageIds.add(msg.id);
        if (isInitialHistory) {
          add(messageName(msg), msg.text, messageRole(msg));
        } else if (msg.sender_type === 'staff') {
          add('KingCom', msg.text, 'bot');
        }
      }
      historyLoaded = true;
    } catch (e) {
      // Polling is best-effort; sending still reports its own errors.
    } finally {
      isPolling = false;
    }
  }

  function messageRole(msg) {
    return msg.direction === 'in' ? 'user' : 'bot';
  }

  function messageName(msg) {
    return msg.direction === 'in' ? 'Bạn' : 'KingCom';
  }

  function add(who, text, role) {
    const row = document.createElement('div');
    row.className = `kc-row kc-row-${role || 'bot'}`;

    const name = document.createElement('div');
    name.className = 'kc-name';
    name.textContent = who;

    const bubble = document.createElement('div');
    bubble.className = 'kc-bubble';
    appendMessageContent(bubble, String(text || ''));

    row.append(name, bubble);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
    return row;
  }

  function appendMessageContent(target, text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match;
    let count = 0;

    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) target.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      count += 1;
      const anchor = document.createElement('a');
      anchor.href = match[0];
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = count === 1 ? 'Xem sản phẩm' : `Xem sản phẩm ${count}`;
      target.appendChild(anchor);
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) target.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  button.onclick = send;
  input.onkeydown = e => { if (e.key === 'Enter') send(); };
  add('KingCom', 'Xin chào! Bạn cần tư vấn sản phẩm gì ạ?', 'bot');
  pollWebsiteMessages();
  setInterval(pollWebsiteMessages, 3000);
})();
