(function () {
  const data = { alerts: [] };

  async function load() {
    data.alerts = await KC.api(KC.API + '/alerts?status=open');
  }

  function item(alert) {
    return `
      <div class="item">
        <div class="row space">
          <b>${KC.esc(alert.reason || 'Cảnh báo')}</b>
          ${KC.statusBadge(alert.status || 'open', 'need')}
        </div>
        <div>${KC.esc(alert.message || '')}</div>
        <div class="muted">${KC.esc(KC.humanSource(alert))} · ${KC.esc(KC.formatDate(alert.created_at))}</div>
        <div class="row">
          ${alert.conversation_id ? `<a class="mini" href="/admin/conversations.html?conversation=${encodeURIComponent(alert.conversation_id)}">Mở hội thoại</a>` : ''}
        </div>
      </div>
    `;
  }

  function render() {
    return `
      <div class="page">
        <div class="card">
          <div class="card-head">
            <h3>Cảnh báo mở</h3>
            <span class="muted">${data.alerts.length} cảnh báo</span>
          </div>
          <div class="card-body">
            <div class="list">${data.alerts.length ? data.alerts.map(item).join('') : KC.empty('Không có cảnh báo mở')}</div>
          </div>
        </div>
      </div>
    `;
  }

  KC.bootPage({
    page: 'alerts',
    titleKey: 'titleAlerts',
    subtitleKey: 'subtitleAlerts',
    load,
    render,
    pollMs: 15000
  });
})();
