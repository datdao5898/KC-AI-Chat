(function () {
  const PAGE_SIZE = 30;
  const channelIcons = {
    all: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 8h10M7 12h6M7 16h8"></path>',
    facebook: '<path d="M14 8h3V4h-3c-3 0-5 2-5 5v3H6v4h3v5h4v-5h3l1-4h-4V9c0-.7.3-1 1-1z"></path>',
    zalo: '<path d="M4 5h16v11H9l-5 4z"></path><path d="M8 9h8M8 13h5"></path>',
    website: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c2.4 2.5 3.7 5.5 3.7 9S14.4 18.5 12 21M12 3c-2.4 2.5-3.7 5.5-3.7 9S9.6 18.5 12 21"></path>',
    common: '<path d="M4 5h16v14H4z"></path><path d="M8 9h8M8 13h5"></path>'
  };

  const data = {
    convs: [],
    selected: null,
    initialConversationLoaded: false,
    activeGroup: localStorage.getItem('kc-conversation-group') || 'all',
    activeSource: localStorage.getItem('kc-conversation-source') || 'all',
    filter: localStorage.getItem('kc-conversation-filter') || 'all',
    search: '',
    visibleCount: PAGE_SIZE,
    detailsOpen: false,
    summaryDraft: null,
    staffDraft: '',
    messageScrollTop: 0,
    messageStickBottom: true,
    listScrollTop: 0
  };

  document.body.classList.add('conversation-page');

  async function load(capture = true) {
    if (capture) captureUiState();
    data.convs = await KC.api(KC.API + '/conversations');
    validateSourceSelection();
    const id = !data.initialConversationLoaded ? new URLSearchParams(location.search).get('conversation') : '';
    data.initialConversationLoaded = true;
    if (id && (!data.selected || data.selected.conversation?.id !== id)) {
      await openConversation(id, false);
    } else if (data.selected?.conversation?.id) {
      data.selected = await KC.api(KC.API + '/conversations/' + encodeURIComponent(data.selected.conversation.id));
    }
  }

  function convName(conv) {
    return conv.customer_name || conv.profile_name || conv.name || conv.external_id || conv.customer_id || KC.t('dashboardCustomers');
  }

  function groupKey(convOrGroup) {
    const value = typeof convOrGroup === 'string'
      ? convOrGroup
      : (convOrGroup?.source_group || convOrGroup?.channel || 'common');
    if (value === 'haravan_website' || value === 'haravan' || value === 'website') return 'website';
    return value || 'common';
  }

  function sourceGroupLabel(group) {
    return {
      facebook: 'Facebook',
      zalo: 'Zalo',
      website: 'Website',
      common: KC.t('commonSource')
    }[groupKey(group)] || group || KC.t('commonSource');
  }

  function parseMessageRaw(message) {
    if (message?.raw_json && typeof message.raw_json === 'object') return message.raw_json;
    try {
      return JSON.parse(message?.raw_json || '{}');
    } catch {
      return {};
    }
  }

  function safeCustomerPageUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function latestCustomerPage(messages = []) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.direction !== 'in') continue;
      const raw = parseMessageRaw(message);
      const url = safeCustomerPageUrl(raw.siteUrl || raw.pageUrl || raw.url);
      if (url) return url;
    }
    return '';
  }

  function customerPageLabel(value) {
    try {
      const url = new URL(value);
      return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
    } catch {
      return value;
    }
  }

  function getConvSourceKey(conv) {
    return conv.source_key || `${groupKey(conv)}/${conv.source_name || conv.channel || 'unknown'}`;
  }

  function icon(inner) {
    return `<span class="inbox-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg></span>`;
  }

  function buildChannelGroups() {
    const map = new Map();
    for (const conv of data.convs || []) {
      const group = groupKey(conv);
      const key = getConvSourceKey(conv);
      const name = conv.source_name || sourceGroupLabel(group);
      if (!map.has(group)) map.set(group, { group, count: 0, need: 0, sources: new Map() });
      const node = map.get(group);
      if (!node.sources.has(key)) node.sources.set(key, { key, name, count: 0, need: 0 });
      const source = node.sources.get(key);
      node.count += 1;
      source.count += 1;
      if (conv.needs_human) {
        node.need += 1;
        source.need += 1;
      }
    }
    const order = { facebook: 1, zalo: 2, website: 3, common: 4 };
    return [...map.values()].sort((a, b) =>
      (order[a.group] || 9) - (order[b.group] || 9)
      || sourceGroupLabel(a.group).localeCompare(sourceGroupLabel(b.group), 'vi')
    );
  }

  function validateSourceSelection() {
    const groups = buildChannelGroups();
    if (data.activeGroup !== 'all' && !groups.some(group => group.group === data.activeGroup)) {
      data.activeGroup = 'all';
      data.activeSource = 'all';
    }
    if (data.activeSource.startsWith('source:')) {
      const sourceKey = data.activeSource.slice(7);
      const exists = groups.some(group => [...group.sources.values()].some(source => source.key === sourceKey));
      if (!exists) data.activeSource = data.activeGroup === 'all' ? 'all' : `group:${data.activeGroup}`;
    }
  }

  function sourceMatches(conv) {
    if (data.activeSource === 'all') return true;
    if (data.activeSource.startsWith('group:')) return groupKey(conv) === data.activeSource.slice(6);
    if (data.activeSource.startsWith('source:')) return getConvSourceKey(conv) === data.activeSource.slice(7);
    return true;
  }

  function filtered() {
    const q = data.search.trim().toLowerCase();
    return (data.convs || []).filter(conv => {
      if (!sourceMatches(conv)) return false;
      if (data.filter === 'needs' && !conv.needs_human) return false;
      if (data.filter === 'auto_on' && !conv.auto_reply) return false;
      if (data.filter === 'auto_off' && conv.auto_reply) return false;
      if (!q) return true;
      return [
        convName(conv),
        conv.source_name,
        conv.channel,
        conv.external_id,
        conv.phone,
        conv.email
      ].some(value => String(value || '').toLowerCase().includes(q));
    }).sort((a, b) => {
      const needDiff = Number(Boolean(b.needs_human)) - Number(Boolean(a.needs_human));
      if (needDiff) return needDiff;
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });
  }

  function renderChannelPanel() {
    const groups = buildChannelGroups();
    const totalNeed = data.convs.filter(conv => conv.needs_human).length;
    const activeNode = groups.find(group => group.group === data.activeGroup);
    return `
      <aside class="inbox-channels">
        <div class="inbox-section-head">
          <h3>${KC.esc(KC.t('channelTitle'))}</h3>
        </div>
        <nav class="channel-list">
          <button class="channel-item ${data.activeGroup === 'all' ? 'active' : ''}" data-channel="all" type="button">
            ${icon(channelIcons.all)}
            <span class="channel-label">${KC.esc(KC.t('allChannels'))}</span>
            <span class="channel-count">${KC.esc(data.convs.length)}</span>
            ${totalNeed ? `<span class="attention-count">${KC.esc(totalNeed)}</span>` : ''}
          </button>
          ${groups.map(group => `
            <button class="channel-item ${data.activeGroup === group.group ? 'active' : ''}" data-channel="${KC.esc(group.group)}" type="button">
              ${icon(channelIcons[group.group] || channelIcons.common)}
              <span class="channel-label">${KC.esc(sourceGroupLabel(group.group))}</span>
              <span class="channel-count">${KC.esc(group.count)}</span>
              ${group.need ? `<span class="attention-count">${KC.esc(group.need)}</span>` : ''}
            </button>
          `).join('')}
        </nav>
        ${activeNode ? `
          <div class="source-subhead">${KC.esc(KC.t('sourceTitle'))}</div>
          <div class="source-list">
            <button class="source-row ${data.activeSource === `group:${activeNode.group}` ? 'active' : ''}" data-source="${KC.esc(`group:${activeNode.group}`)}" type="button">
              <span>${KC.esc(KC.t('all'))} ${KC.esc(sourceGroupLabel(activeNode.group))}</span>
              <span class="source-count">${KC.esc(activeNode.count)}</span>
            </button>
            ${[...activeNode.sources.values()].sort((a, b) => b.need - a.need || b.count - a.count || a.name.localeCompare(b.name, 'vi')).map(source => `
              <button class="source-row ${data.activeSource === `source:${source.key}` ? 'active' : ''}" data-source="${KC.esc(`source:${source.key}`)}" type="button">
                <span class="source-name" title="${KC.esc(source.name)}">${KC.esc(source.name)}</span>
                <span class="source-count">${KC.esc(source.count)}</span>
                ${source.need ? `<span class="attention-count">${KC.esc(source.need)}</span>` : ''}
              </button>
            `).join('')}
          </div>
        ` : ''}
      </aside>
    `;
  }

  function compactStatus(text, cls = '') {
    return `<span class="compact-status ${cls}">${KC.esc(text)}</span>`;
  }

  function ratingStars(rating) {
    const value = Math.max(0, Math.min(5, Number(rating) || 0));
    if (!value) return '';
    return `<span class="customer-rating" title="${KC.esc(`${value}/5`)}">${'&#9733;'.repeat(value)}${'&#9734;'.repeat(5 - value)}</span>`;
  }

  function convItem(conv) {
    const active = data.selected?.conversation?.id === conv.id;
    const showSource = !data.activeSource.startsWith('source:');
    return `
      <button class="conversation-row ${conv.needs_human ? 'need' : ''} ${active ? 'active' : ''}" data-open-conv="${KC.esc(conv.id)}" type="button">
        <div class="conversation-row-main">
          <span class="conversation-name">${KC.esc(convName(conv))}</span>
          <time>${KC.esc(KC.shortDate(conv.updated_at))}</time>
        </div>
        ${showSource ? `<div class="conversation-source">${KC.esc(conv.source_name || sourceGroupLabel(groupKey(conv)))}</div>` : ''}
        <div class="conversation-statuses">
          ${compactStatus(conv.auto_reply ? 'Auto ON' : 'Auto OFF', conv.auto_reply ? 'on' : 'off')}
          ${conv.needs_human ? compactStatus(KC.t('needsStaff'), 'need') : ''}
          ${Number(conv.reply_review_count || 0) > 0 ? compactStatus(`${KC.t('needsImprovement')} ${conv.reply_review_count}`, 'warn') : ''}
          ${ratingStars(conv.customer_rating)}
        </div>
      </button>
    `;
  }

  function renderConversationPanel() {
    const rows = filtered();
    const visible = rows.slice(0, data.visibleCount);
    return `
      <section class="inbox-list-panel">
        <div class="conversation-list-head">
          <div class="row space">
            <h3>${KC.esc(KC.t('navConversations'))}</h3>
            <span class="count">${KC.esc(rows.length)}</span>
          </div>
          <input id="conversationSearch" class="conversation-search" placeholder="${KC.esc(KC.t('searchConversations'))}" value="${KC.esc(data.search)}">
          <div class="filter-tabs" role="tablist">
            ${[
              ['all', KC.t('all')],
              ['needs', KC.t('needsStaff')],
              ['auto_on', 'Auto ON'],
              ['auto_off', 'Auto OFF']
            ].map(([key, label]) => `
              <button class="${data.filter === key ? 'active' : ''}" data-filter="${key}" type="button">${KC.esc(label)}</button>
            `).join('')}
          </div>
        </div>
        <div class="conversation-scroll">
          ${visible.length ? visible.map(convItem).join('') : KC.empty(KC.t('noConversationData'))}
        </div>
        <div class="conversation-list-footer">
          <span>${KC.esc(KC.t('showingConversations'))} ${KC.esc(visible.length)} / ${KC.esc(rows.length)}</span>
          ${visible.length < rows.length ? `<button class="btn ghost" id="loadMoreBtn" type="button">${KC.esc(KC.t('loadMore'))}</button>` : ''}
        </div>
      </section>
    `;
  }

  function messageItem(message) {
    const raw = parseMessageRaw(message);
    const media = raw?._media || {};
    const attachmentUrls = Array.isArray(media.imageUrls)
      ? media.imageUrls
      : (raw?.message?.attachments || [])
          .filter(attachment => attachment?.type === 'image')
          .map(attachment => attachment?.payload?.url);
    const imageUrls = [...new Set(attachmentUrls)]
      .filter(url =>
        /^https:\/\//i.test(String(url || ''))
        || /^\/webhooks\/website-chat\/media\//i.test(String(url || ''))
      )
      .slice(0, 3);
    const vision = media.vision || {};
    const imageHtml = imageUrls.length ? `
      <div class="message-images">
        ${imageUrls.map(url => `<a href="${KC.esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${KC.esc(url)}" alt="HÃ¬nh áº£nh trong há»™i thoáº¡i" loading="lazy"></a>`).join('')}
      </div>
      ${vision.recognized && vision.searchText ? `<div class="message-image-caption">${KC.esc(vision.searchText)}</div>` : ''}
    ` : '';
    return `
      <div class="msg ${message.direction === 'out' ? 'out' : 'in'}">
        <div class="msg-meta">
          <span>${KC.esc(message.sender_type || '')} &middot; ${KC.esc(KC.shortDate(message.created_at))}</span>
          <span class="row">
            ${message.direction === 'out' && String(message.sender_type || '').toLowerCase() === 'ai' ? `<button class="mini" data-review-msg="${KC.esc(message.id)}" type="button">${KC.esc(KC.t('markWrong'))}</button>` : ''}
            <button class="mini" data-delete-msg="${KC.esc(message.id)}" type="button">${KC.esc(KC.t('delete'))}</button>
          </span>
        </div>
        <div class="msg-text">${KC.esc(message.text || '')}</div>
        ${imageHtml}
      </div>
    `;
  }

  function contactRows(conv, customerPageUrl = '') {
    const rows = [
      [KC.t('phone'), conv.phone],
      [KC.t('email'), conv.email],
      ['ID', conv.external_id],
      [KC.t('source'), conv.source_name || conv.source_key],
      [KC.t('customerPage'), customerPageUrl],
      [KC.t('status'), conv.status || 'open'],
      [KC.t('customerRating'), conv.customer_rating ? `${'&#9733;'.repeat(Number(conv.customer_rating))}${'&#9734;'.repeat(5 - Number(conv.customer_rating))} ${conv.customer_rating}/5` : ''],
      [KC.t('ratingFeedback'), conv.customer_rating_feedback]
    ].filter(([, value]) => String(value || '').trim());
    return rows.length
      ? rows.map(([label, value]) => `<div class="detail-row"><span>${KC.esc(label)}</span>${
          label === KC.t('customerPage')
            ? `<a class="detail-link" href="${KC.esc(value)}" target="_blank" rel="noopener noreferrer">${KC.esc(value)}</a>`
            : `<b>${KC.esc(value)}</b>`
        }</div>`).join('')
      : `<div class="muted">${KC.esc(KC.t('noData'))}</div>`;
  }

  function alertDeliveryLabel(status) {
    const value = String(status || '').toLowerCase();
    if (value === 'sent_lark') return KC.t('sentLark');
    if (value === 'sent') return KC.t('sent');
    if (value === 'pending') return KC.t('pending');
    if (value === 'failed' || value === 'error') return KC.t('failed');
    return status || '';
  }

  function renderAlerts(alerts = []) {
    if (!alerts.length) return `<div class="muted">${KC.esc(KC.t('noData'))}</div>`;
    return alerts.map(alert => `
      <div class="alert-box">
        <div class="row space">
          <span class="alert-title">${KC.esc(alert.reason || KC.t('needsStaff'))}</span>
          ${compactStatus(alertDeliveryLabel(alert.delivery_status || alert.status), String(alert.delivery_status || '').startsWith('sent') ? 'on' : 'warn')}
        </div>
        <div class="alert-message">${KC.esc(alert.message || '')}</div>
        <div class="muted">${alert.created_at ? KC.esc(KC.formatDate(alert.created_at)) : ''}</div>
      </div>
    `).join('');
  }

  function renderDetailsDrawer(conv, alerts, customerPageUrl = '') {
    if (!data.detailsOpen) return '';
    return `
      <aside class="customer-drawer">
        <div class="drawer-head">
          <h3>${KC.esc(KC.t('customerDetails'))}</h3>
          <button class="icon-button" id="closeDetailsBtn" type="button" title="${KC.esc(KC.t('close'))}" aria-label="${KC.esc(KC.t('close'))}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>
          </button>
        </div>
        <div class="drawer-scroll">
          <section class="drawer-section">
            <h4>${KC.esc(KC.t('customerInfo'))}</h4>
            <div class="detail-stack">${contactRows(conv, customerPageUrl)}</div>
            <p class="muted">${KC.esc(conv.profile_summary || KC.t('noCustomerSummary'))}</p>
          </section>
          <section class="drawer-section">
            <h4>${KC.esc(KC.t('aiSummary'))}</h4>
            <textarea id="summaryText">${KC.esc(data.summaryDraft ?? conv.summary ?? '')}</textarea>
            <div class="row">
              <button class="btn" id="summarizeBtn" type="button">${KC.esc(KC.t('summarize'))}</button>
              <button class="btn gray" id="saveSummaryBtn" type="button">${KC.esc(KC.t('saveSummary'))}</button>
            </div>
          </section>
          <section class="drawer-section">
            <h4>${KC.esc(KC.t('interested'))}</h4>
            <div class="summary-box">${KC.esc(conv.interested_products || '[]')}</div>
          </section>
          <section class="drawer-section">
            <h4>${KC.esc(KC.t('alerts'))}</h4>
            <div class="drawer-alerts">${renderAlerts(alerts)}</div>
          </section>
          <section class="drawer-section">
            <button class="btn danger full" id="deleteConvBtn" type="button">${KC.esc(KC.t('deleteConversation'))}</button>
          </section>
        </div>
      </aside>
    `;
  }

  function selectedPanel() {
    const selected = data.selected;
    if (!selected?.conversation) {
      return `
        <section class="inbox-detail empty-detail">
          ${icon(channelIcons.all)}
          <h3>${KC.esc(KC.t('chooseConversation'))}</h3>
        </section>
      `;
    }
    const conv = selected.conversation;
    const alerts = selected.alerts || [];
    const customerPageUrl = latestCustomerPage(selected.messages || []);
    return `
      <section class="inbox-detail">
        <header class="conversation-header">
          <div class="conversation-identity">
            <h3>${KC.esc(convName(conv))}</h3>
            <div>${KC.esc(conv.source_name || sourceGroupLabel(groupKey(conv)))} &middot; ${KC.esc(conv.phone || conv.external_id || '')}</div>
            ${customerPageUrl ? `
              <a class="customer-page-link" href="${KC.esc(customerPageUrl)}" target="_blank" rel="noopener noreferrer" title="${KC.esc(KC.t('openCustomerPage'))}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7"></path><path d="M10 14 21 3"></path><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path></svg>
                <span>${KC.esc(customerPageLabel(customerPageUrl))}</span>
              </a>
            ` : ''}
          </div>
          <div class="conversation-actions">
            <button class="btn ${conv.auto_reply ? 'danger' : ''}" id="toggleAutoBtn" type="button">${conv.auto_reply ? KC.esc(KC.t('toggleAutoOff')) : KC.esc(KC.t('toggleAutoOn'))}</button>
            <button class="btn ghost" id="handoffBtn" type="button">${KC.esc(KC.t('handoff'))}</button>
            ${conv.needs_human ? `<button class="btn" id="resolveBtn" type="button">${KC.esc(KC.t('resolved'))}</button>` : ''}
            <button class="icon-button ${data.detailsOpen ? 'active' : ''}" id="detailsBtn" type="button" title="${KC.esc(KC.t('customerDetails'))}" aria-label="${KC.esc(KC.t('customerDetails'))}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>
            </button>
            <details class="action-menu">
              <summary title="${KC.esc(KC.t('moreActions'))}" aria-label="${KC.esc(KC.t('moreActions'))}">&hellip;</summary>
              <div>
                <button data-open-details type="button">${KC.esc(KC.t('summarize'))}</button>
                <button class="danger-text" data-delete-conversation type="button">${KC.esc(KC.t('deleteConversation'))}</button>
              </div>
            </details>
          </div>
        </header>
        <div class="conversation-messages" id="messageScroll">
          ${(selected.messages || []).map(messageItem).join('')}
        </div>
        ${renderDetailsDrawer(conv, alerts, customerPageUrl)}
      </section>
    `;
  }

  function render() {
    return `
      <div class="inbox-workspace">
        ${renderChannelPanel()}
        ${renderConversationPanel()}
        ${selectedPanel()}
      </div>
    `;
  }

  function rerender(capture = true) {
    if (capture) captureUiState();
    KC.setContent(render());
    bind();
  }

  function captureUiState() {
    const messages = KC.$('#messageScroll');
    if (messages) {
      data.messageScrollTop = messages.scrollTop;
      data.messageStickBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 64;
    }
    const list = KC.$('.conversation-scroll');
    if (list) data.listScrollTop = list.scrollTop;
    const summary = KC.$('#summaryText');
    if (summary) data.summaryDraft = summary.value;
    const staff = KC.$('#staffReplyText');
    if (staff) data.staffDraft = staff.value;
  }

  function restoreUiState() {
    const messages = KC.$('#messageScroll');
    if (messages) {
      messages.scrollTop = data.messageStickBottom ? messages.scrollHeight : data.messageScrollTop;
    }
    const list = KC.$('.conversation-scroll');
    if (list) list.scrollTop = data.listScrollTop;
  }

  function resetVisible() {
    data.visibleCount = PAGE_SIZE;
  }

  async function openConversation(id, rerenderPage = true) {
    data.selected = await KC.api(KC.API + '/conversations/' + encodeURIComponent(id));
    data.detailsOpen = false;
    data.summaryDraft = null;
    data.staffDraft = '';
    data.messageScrollTop = 0;
    data.messageStickBottom = true;
    const url = new URL(location.href);
    url.searchParams.set('conversation', id);
    history.replaceState(null, '', url);
    if (rerenderPage) rerender(false);
  }

  async function refreshSelected() {
    if (data.selected?.conversation?.id) {
      data.selected = await KC.api(KC.API + '/conversations/' + encodeURIComponent(data.selected.conversation.id));
    }
  }

  async function toggleAuto() {
    await KC.api(KC.API + '/conversations/' + encodeURIComponent(data.selected.conversation.id) + '/toggle-auto-reply', { method: 'POST' });
    await refreshSelected();
    rerender();
    KC.toast(KC.t('updatedAuto'));
  }

  async function saveSummary() {
    const summary = KC.$('#summaryText')?.value ?? data.summaryDraft ?? '';
    await KC.api(KC.API + '/conversations/' + encodeURIComponent(data.selected.conversation.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary })
    });
    await refreshSelected();
    data.summaryDraft = null;
    KC.toast(KC.t('savedSummary'));
  }

  async function summarize() {
    KC.toast(KC.t('summarizing'));
    const result = await KC.api(KC.API + '/conversations/' + encodeURIComponent(data.selected.conversation.id) + '/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: KC.state.lang })
    });
    data.selected = result.data;
    data.detailsOpen = true;
    data.summaryDraft = null;
    rerender(false);
    KC.toast(KC.t('summarized'));
  }

  async function handoff() {
    const reason = prompt(KC.t('handoffPrompt'), data.selected?.conversation?.handoff_reason || KC.t('handoffDefault'));
    if (!reason) return;
    const result = await KC.api(KC.API + '/conversations/' + encodeURIComponent(data.selected.conversation.id) + '/handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    data.selected = result.data || data.selected;
    rerender();
    KC.toast(KC.t('alertCreated'));
  }

  async function resolveHandoff() {
    const note = prompt(KC.t('resolvePrompt'), KC.t('resolveDefault'));
    const result = await KC.api(KC.API + '/conversations/' + encodeURIComponent(data.selected.conversation.id) + '/resolve-handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note || '' })
    });
    data.selected = result.data || data.selected;
    rerender();
    KC.toast(KC.t('resolvedToast'));
  }

  async function sendStaffReply() {
    const text = KC.$('#staffReplyText')?.value.trim();
    if (!text) return;
    const sendButton = KC.$('#staffReplyBtn');
    if (sendButton) sendButton.disabled = true;
    try {
      await KC.api(KC.API + '/conversations/' + encodeURIComponent(data.selected.conversation.id) + '/staff-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      await refreshSelected();
      data.staffDraft = '';
      rerender(false);
      KC.toast(KC.t('sentReply'));
    } catch (error) {
      KC.toast(`${KC.t('loadError')}: ${error.message}`);
    } finally {
      const currentButton = KC.$('#staffReplyBtn');
      if (currentButton) currentButton.disabled = false;
    }
  }

  async function deleteConversation() {
    if (!confirm(KC.t('deleteConvConfirm'))) return;
    await KC.api(KC.API + '/conversations/' + encodeURIComponent(data.selected.conversation.id), { method: 'DELETE' });
    data.selected = null;
    data.detailsOpen = false;
    history.replaceState(null, '', location.pathname);
    await load(false);
    rerender(false);
    KC.toast(KC.t('deletedConversation'));
  }

  async function deleteMessage(id) {
    if (!confirm(KC.t('deleteMsgConfirm'))) return;
    const result = await KC.api(KC.API + '/messages/' + encodeURIComponent(id), { method: 'DELETE' });
    if (result.data) data.selected = result.data;
    rerender();
    KC.toast(KC.t('deletedMessage'));
  }

  async function markWrong(id) {
    const message = (data.selected.messages || []).find(item => item.id === id);
    const notes = prompt(KC.t('reviewIssuePrompt'), '');
    await KC.api(KC.API + '/conversations/' + encodeURIComponent(data.selected.conversation.id) + '/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: id, aiReply: message?.text || '', notes: notes || '' })
    });
    KC.toast(KC.t('reviewedAi'));
  }

  function bind() {
    KC.$$('[data-channel]').forEach(button => {
      button.onclick = () => {
        data.activeGroup = button.dataset.channel;
        data.activeSource = data.activeGroup === 'all' ? 'all' : `group:${data.activeGroup}`;
        localStorage.setItem('kc-conversation-group', data.activeGroup);
        localStorage.setItem('kc-conversation-source', data.activeSource);
        resetVisible();
        rerender();
      };
    });
    KC.$$('[data-source]').forEach(button => {
      button.onclick = () => {
        data.activeSource = button.dataset.source;
        localStorage.setItem('kc-conversation-source', data.activeSource);
        resetVisible();
        rerender();
      };
    });
    const search = KC.$('#conversationSearch');
    if (search) {
      search.oninput = event => {
        data.search = event.target.value;
        resetVisible();
        rerender();
        const next = KC.$('#conversationSearch');
        next?.focus();
        next?.setSelectionRange(data.search.length, data.search.length);
      };
    }
    KC.$$('[data-filter]').forEach(button => {
      button.onclick = () => {
        data.filter = button.dataset.filter;
        localStorage.setItem('kc-conversation-filter', data.filter);
        resetVisible();
        rerender();
      };
    });
    KC.$$('[data-open-conv]').forEach(button => {
      button.onclick = () => openConversation(button.dataset.openConv);
    });
    KC.$$('[data-delete-msg]').forEach(button => {
      button.onclick = () => deleteMessage(button.dataset.deleteMsg);
    });
    KC.$$('[data-review-msg]').forEach(button => {
      button.onclick = () => markWrong(button.dataset.reviewMsg);
    });
    if (KC.$('#loadMoreBtn')) KC.$('#loadMoreBtn').onclick = () => {
      data.visibleCount += PAGE_SIZE;
      rerender();
    };
    if (KC.$('#detailsBtn')) KC.$('#detailsBtn').onclick = () => {
      data.detailsOpen = !data.detailsOpen;
      rerender();
    };
    if (KC.$('#closeDetailsBtn')) KC.$('#closeDetailsBtn').onclick = () => {
      data.detailsOpen = false;
      rerender();
    };
    KC.$$('[data-open-details]').forEach(button => {
      button.onclick = () => {
        data.detailsOpen = true;
        rerender();
      };
    });
    KC.$$('[data-delete-conversation]').forEach(button => {
      button.onclick = deleteConversation;
    });
    if (KC.$('#toggleAutoBtn')) KC.$('#toggleAutoBtn').onclick = toggleAuto;
    if (KC.$('#handoffBtn')) KC.$('#handoffBtn').onclick = handoff;
    if (KC.$('#resolveBtn')) KC.$('#resolveBtn').onclick = resolveHandoff;
    if (KC.$('#saveSummaryBtn')) KC.$('#saveSummaryBtn').onclick = saveSummary;
    if (KC.$('#summarizeBtn')) KC.$('#summarizeBtn').onclick = summarize;
    if (KC.$('#staffReplyBtn')) KC.$('#staffReplyBtn').onclick = sendStaffReply;
    if (KC.$('#deleteConvBtn')) KC.$('#deleteConvBtn').onclick = deleteConversation;
    if (KC.$('#summaryText')) KC.$('#summaryText').oninput = event => { data.summaryDraft = event.target.value; };
    if (KC.$('#staffReplyText')) {
      KC.$('#staffReplyText').oninput = event => { data.staffDraft = event.target.value; };
    }
    requestAnimationFrame(restoreUiState);
  }

  KC.bootPage({
    page: 'conversations',
    titleKey: 'titleConversations',
    subtitleKey: 'subtitleConversations',
    load,
    render,
    bind,
    pollMs: 15000
  });
})();
