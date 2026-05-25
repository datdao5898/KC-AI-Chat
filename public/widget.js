(function () {
  const currentScript = document.currentScript;
  const apiBase = currentScript && currentScript.src ? new URL(currentScript.src).origin : window.location.origin;

  const box = document.createElement('div');
  box.style = 'position:fixed;right:20px;bottom:20px;width:320px;background:#0f172a;color:white;border-radius:16px;box-shadow:0 10px 30px #0008;font-family:Arial;z-index:99999;overflow:hidden';

  const head = document.createElement('div');
  head.style = 'padding:12px;background:#2563eb;font-weight:bold';
  head.textContent = 'KingCom AI Agent';

  const messages = document.createElement('div');
  messages.id = 'kcmsgs';
  messages.style = 'height:260px;overflow:auto;padding:10px';

  const form = document.createElement('div');
  form.style = 'display:flex;gap:6px;padding:10px';

  const input = document.createElement('input');
  input.id = 'kcinput';
  input.placeholder = 'Nhập câu hỏi...';
  input.style = 'flex:1;padding:9px;border-radius:8px;border:1px solid #334155';

  const button = document.createElement('button');
  button.id = 'kcbtn';
  button.type = 'button';
  button.textContent = 'Gửi';

  form.append(input, button);
  box.append(head, messages, form);
  document.body.appendChild(box);

  const vid = localStorage.kcVisitorId || (localStorage.kcVisitorId = 'web-' + Date.now());

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    add('Bạn', text);
    button.disabled = true;
    try {
      const res = await fetch(`${apiBase}/webhooks/website-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: vid, message: text })
      });
      const data = await res.json();
      add('KingCom', data.reply || 'Đã nhận tin nhắn');
    } catch (e) {
      add('KingCom', 'Xin lỗi, hiện chưa gửi được tin nhắn. Anh/chị thử lại sau ít phút giúp em nhé.');
    } finally {
      button.disabled = false;
      input.focus();
    }
  }

  function add(who, text) {
    const row = document.createElement('div');
    row.style = 'margin:8px 0;white-space:pre-wrap;word-break:break-word';

    const name = document.createElement('b');
    name.textContent = `${who}: `;

    const body = document.createElement('span');
    body.textContent = String(text || '');

    row.append(name, body);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
  }

  button.onclick = send;
  input.onkeydown = e => { if (e.key === 'Enter') send(); };
  add('KingCom', 'Xin chào! Bạn cần tư vấn sản phẩm gì ạ?');
})();
