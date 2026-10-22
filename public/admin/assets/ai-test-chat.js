(function () {
  // Test chat runs the real AI pipeline through /api/test-chat: the conversation is
  // flagged as test, hidden from lists/stats, and no staff alert is sent.
  const STORAGE_KEY = 'kc-test-chat-source';
  const data = { sources: [], sourceKey: '', sessionId: '', messages: [], sending: false };

  function newSessionId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function readStoredSource() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
  }

  function storeSource(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch {}
  }

  function startSession() {
    data.sessionId = newSessionId();
    data.messages = [];
  }

  async function load() {
    if (data.sources.length) return;
    const sources = await KC.api(KC.API + '/knowledge-sources');
    data.sources = (sources || []).filter(source => ['website', 'facebook'].includes(source.group));
    const stored = readStoredSource();
    data.sourceKey = data.sources.some(source => source.sourceKey === stored)
      ? stored
      : (data.sources[0]?.sourceKey || '');
    startSession();
  }

  function debugBlock(debug, finalText = '') {
    if (!debug) return '';
    const judge = debug.judge || {};
    const rows = [
      ['Nguồn trả lời', debug.aiSource],
      ['Sản phẩm tìm được', (debug.ragProducts || []).join(' | ') || '(không có)'],
      ['Validator chặn', debug.validator || 'không'],
      ['Judge', judge.skipped ? `bỏ qua (${judge.skipped})` : `${judge.approved ? 'duyệt' : 'từ chối'}${judge.riskType ? ` · ${judge.riskType}` : ''}${judge.reason ? ` · ${judge.reason}` : ''}`],
      ['Kiểm tra liên hệ', debug.contactGuard || 'ok'],
      ['Sẽ báo nhân viên (thật)', debug.wouldAlertStaff ? 'CÓ' : 'không'],
      ['Web search', `${debug.webSearchRequests || 0} lượt${(debug.webSources || []).length ? ` · ${(debug.webSources || []).map(source => source.url || source).join(', ')}` : ''}`],
      debug.error ? ['Lỗi', debug.error] : null
    ].filter(Boolean);
    const draftChanged = debug.draftReply && debug.draftReply.trim() !== String(finalText).trim();
    return `
      <details>
        <summary class="show-more">Debug</summary>
        <pre>${KC.esc(rows.map(([label, value]) => `${label}: ${value}`).join('\n'))}${draftChanged ? `\n\nBản nháp ban đầu:\n${KC.esc(debug.draftReply)}` : ''}</pre>
      </details>
    `;
  }

  function messageHtml(message) {
    const isCustomer = message.role === 'customer';
    return `
      <div class="msg ${isCustomer ? '' : 'out'}">
        <div class="msg-meta">
          <span>${isCustomer ? 'Khách (test)' : 'AI'}</span>
          ${message.debug?.wouldAlertStaff ? KC.statusBadge('cần nhân viên', 'warn') : ''}
        </div>
        <div class="msg-text">${KC.esc(message.text)}</div>
        ${isCustomer ? '' : debugBlock(message.debug, message.text)}
      </div>
    `;
  }

  function render() {
    const options = data.sources.map(source => `
      <option value="${KC.esc(source.sourceKey)}" ${source.sourceKey === data.sourceKey ? 'selected' : ''}>${KC.esc(source.name)} (${KC.esc(source.sourceKey)})</option>
    `).join('');
    return `
      <div class="page">
        <div class="card">
          <div class="card-head">
            <div>
              <h3>Test AI</h3>
              <div class="muted">Không báo nhân viên, không hiện trong danh sách hội thoại. Phiên: ${KC.esc(data.sessionId.slice(0, 8))}</div>
            </div>
            <div class="row">
              <select id="testSource" style="width:260px">${options}</select>
              <button class="btn ghost" id="testNewSession" type="button">Phiên mới</button>
              <button class="btn danger" id="testClearAll" type="button">Xóa dữ liệu test</button>
            </div>
          </div>
          <div class="card-body">
            <div class="msg-list" id="testMessages">${data.messages.length ? data.messages.map(messageHtml).join('') : KC.empty('Nhập tin nhắn như khách để thử AI')}</div>
            <form id="testForm" class="test-chat">
              <textarea id="testInput" placeholder="Ví dụ: Micro Boya Mini 2 kết nối với iPhone như thế nào?" ${data.sending ? 'disabled' : ''}></textarea>
              <button class="btn" type="submit" ${data.sending ? 'disabled' : ''}>${data.sending ? 'Đang trả lời...' : 'Gửi'}</button>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  function rerender() {
    KC.setContent(render());
    bind();
    const list = KC.$('#testMessages');
    if (list) list.scrollTop = list.scrollHeight;
  }

  async function send(text) {
    data.messages.push({ role: 'customer', text });
    data.sending = true;
    rerender();
    try {
      const result = await KC.api(KC.API + '/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceKey: data.sourceKey, sessionId: data.sessionId, message: text })
      });
      data.messages.push({ role: 'ai', text: result.reply || '(không có câu trả lời)', debug: result.debug });
    } catch (e) {
      data.messages.push({ role: 'ai', text: `Lỗi: ${e.message}` });
    } finally {
      data.sending = false;
      rerender();
      KC.$('#testInput')?.focus();
    }
  }

  function bind() {
    KC.$('#testSource').onchange = event => {
      data.sourceKey = event.target.value;
      storeSource(data.sourceKey);
      startSession();
      rerender();
    };
    KC.$('#testNewSession').onclick = () => {
      startSession();
      rerender();
    };
    KC.$('#testClearAll').onclick = async () => {
      if (!window.confirm('Xóa toàn bộ hội thoại test đã lưu?')) return;
      const result = await KC.api(KC.API + '/test-chat', { method: 'DELETE' });
      startSession();
      rerender();
      KC.toast(`Đã xóa ${result.deleted || 0} hội thoại test`);
    };
    const input = KC.$('#testInput');
    input.onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        KC.$('#testForm').requestSubmit();
      }
    };
    KC.$('#testForm').onsubmit = event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || data.sending) return;
      send(text);
    };
  }

  KC.bootPage({
    page: 'testchat',
    titleKey: 'titleTestChat',
    subtitleKey: 'subtitleTestChat',
    load,
    render,
    bind,
    refreshButton: false
  });
})();
