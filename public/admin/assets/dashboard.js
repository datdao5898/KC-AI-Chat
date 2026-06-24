(function () {
  const data = { stats: {}, alerts: [] };

  async function load() {
    const [stats, alerts] = await Promise.all([
      KC.api(KC.API + '/stats'),
      KC.api(KC.API + '/alerts?status=open')
    ]);
    data.stats = stats || {};
    data.alerts = alerts || [];
  }

  function stat(label, value, cls = '') {
    return `
      <div class="card stat">
        <h3>${KC.esc(label)}</h3>
        <strong class="${cls}">${KC.esc(value ?? 0)}</strong>
      </div>
    `;
  }

  function alertItem(alert) {
    return `
      <div class="item">
        <div class="row space">
          <b>${KC.esc(alert.reason || KC.t('alertFallback'))}</b>
          ${KC.statusBadge(alert.status || 'open', 'need')}
        </div>
        <div class="muted">${KC.esc(KC.humanSource(alert))} · ${KC.esc(KC.shortDate(alert.created_at))}</div>
        <div>${KC.esc(alert.message || '')}</div>
        ${alert.conversation_id ? `<a class="mini" href="/admin/conversations.html?conversation=${encodeURIComponent(alert.conversation_id)}">${KC.esc(KC.t('openConversation'))}</a>` : ''}
      </div>
    `;
  }

  function render() {
    return `
      <div class="page dashboard-page">
        <div class="dashboard-stats">
          ${stat(KC.t('dashboardCustomers'), data.stats.customers)}
          ${stat(KC.t('dashboardConversations'), data.stats.conversations)}
          ${stat(KC.t('dashboardMessages'), data.stats.messages)}
          ${stat(KC.t('dashboardNeedsStaff'), data.stats.needs_human)}
          ${stat(KC.t('dashboardOpenAlerts'), data.stats.open_alerts)}
          ${stat(KC.t('dashboardProducts'), data.stats.products)}
          ${stat(
            KC.t('dashboardJudgeRejects'),
            `${data.stats.judge?.rejected ?? 0}/${data.stats.judge?.judged ?? 0} (${data.stats.judge?.reject_rate ?? 0}%)`,
            Number(data.stats.judge?.reject_rate || 0) >= 20 ? 'danger' : ''
          )}
        </div>
        <div class="card dashboard-alerts">
          <div class="card-head">
            <h3>${KC.esc(KC.t('latestAlerts'))}</h3>
            <a class="mini" href="/admin/alerts.html">${KC.esc(KC.t('viewAll'))}</a>
          </div>
          <div class="card-body">
            <div class="list">
              ${data.alerts.length ? data.alerts.slice(0, 8).map(alertItem).join('') : KC.empty(KC.t('noOpenAlerts'))}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  KC.bootPage({
    page: 'dashboard',
    titleKey: 'titleDashboard',
    subtitleKey: 'subtitleDashboard',
    load,
    render,
    pollMs: 15000
  });
})();
