(function () {
  const data = { type: 'ai', entries: [], open: new Set() };

  async function load() {
    const result = await KC.api(KC.API + '/logs?type=' + encodeURIComponent(data.type) + '&limit=120');
    data.entries = result.entries || [];
  }

  function key(entry, index) {
    return [entry.ts || '', entry.type || '', entry.status || '', entry.source || '', entry.title || '', index].join('|');
  }

  function item(entry, index) {
    const raw = entry.raw ? JSON.stringify(entry.raw, null, 2) : (entry.detail || '');
    const k = key(entry, index);
    return `
      <div class="item">
        <div class="row space">
          <b>${KC.esc(entry.title || 'Log')}</b>
          ${KC.statusBadge(entry.status || entry.type || '', entry.level === 'error' ? 'off' : 'sent')}
        </div>
        <div class="prewrap">${KC.esc(entry.detail || raw || '')}</div>
        <div class="muted">${KC.esc(entry.source || '')} ${entry.ts ? `· ${KC.esc(KC.formatDate(entry.ts))}` : ''}</div>
        <details data-log-key="${KC.esc(k)}" ${data.open.has(k) ? 'open' : ''}>
          <summary class="show-more">Xem thêm</summary>
          <pre>${KC.esc(raw)}</pre>
        </details>
      </div>
    `;
  }

  function render() {
    return `
      <div class="page">
        <div class="card">
          <div class="card-head">
            <div>
              <h3>Nhật ký</h3>
              <div class="muted">${data.entries.length} entries</div>
            </div>
            <select id="logType" style="width:180px">
              <option value="ai" ${data.type === 'ai' ? 'selected' : ''}>AI responses</option>
              <option value="alerts" ${data.type === 'alerts' ? 'selected' : ''}>Staff alerts</option>
            </select>
          </div>
          <div class="card-body">
            <div class="list">${data.entries.length ? data.entries.map(item).join('') : KC.empty('Không có nhật ký')}</div>
          </div>
        </div>
      </div>
    `;
  }

  function bind() {
    KC.$('#logType').onchange = async event => {
      data.type = event.target.value;
      data.open.clear();
      await load();
      KC.setContent(render());
      bind();
    };
    KC.$$('details[data-log-key]').forEach(details => {
      details.ontoggle = () => {
        const k = details.dataset.logKey;
        if (!k) return;
        if (details.open) data.open.add(k);
        else data.open.delete(k);
      };
    });
  }

  KC.bootPage({
    page: 'logs',
    titleKey: 'titleLogs',
    subtitleKey: 'subtitleLogs',
    load,
    render,
    bind,
    pollMs: 20000
  });
})();
