(function () {
  const data = { reviews: [] };

  async function load() {
    data.reviews = await KC.api(KC.API + '/reply-reviews?status=active&limit=200');
  }

  function item(review) {
    return `
      <div class="item">
        <div class="row space">
          <b>${KC.esc(review.issue_type || 'wrong_reply')}</b>
          ${KC.statusBadge(review.source_name || review.source_key || review.source_group || '', 'warn')}
        </div>
        <div><b>Tin khách</b><div class="prewrap">${KC.esc(review.customer_text || '')}</div></div>
        <div><b>AI trả lời</b><div class="prewrap">${KC.esc(review.ai_reply || '')}</div></div>
        ${review.notes ? `<div><b>Ghi chú</b><div class="prewrap">${KC.esc(review.notes)}</div></div>` : ''}
        <div class="muted">${KC.esc(KC.formatDate(review.created_at))} · ${KC.esc(review.status || '')}</div>
        ${review.conversation_id ? `<a class="mini" href="/admin/conversations.html?conversation=${encodeURIComponent(review.conversation_id)}">Mở hội thoại</a>` : ''}
      </div>
    `;
  }

  function render() {
    return `
      <div class="page">
        <div class="card">
          <div class="card-head">
            <h3>Tin cần cải thiện</h3>
            <span class="muted">${data.reviews.length} mục</span>
          </div>
          <div class="card-body">
            <div class="list">${data.reviews.length ? data.reviews.map(item).join('') : KC.empty('Chưa có tin cần cải thiện')}</div>
          </div>
        </div>
      </div>
    `;
  }

  KC.bootPage({
    page: 'improvements',
    titleKey: 'titleImprovements',
    subtitleKey: 'subtitleImprovements',
    load,
    render,
    pollMs: 20000
  });
})();
