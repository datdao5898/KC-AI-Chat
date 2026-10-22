(function () {
  const data = {
    sources: [],
    sourceKey: 'common',
    knowledge: {},
    files: { files: [] },
    catalogSync: [],
    syncing: false,
    viewer: null
  };

  const types = [
    ['products', 'Catalog sản phẩm CSV'],
    ['faq', 'FAQ'],
    ['policies', 'Chính sách']
  ];

  async function load() {
    data.sources = await KC.api(KC.API + '/knowledge-sources');
    if (!data.sources.some(source => source.sourceKey === data.sourceKey)) data.sourceKey = data.sources[0]?.sourceKey || 'common';
    const [knowledge, files, catalogSync] = await Promise.all([
      KC.api(KC.API + '/knowledge?sourceKey=' + encodeURIComponent(data.sourceKey)),
      KC.api(KC.API + '/knowledge-files?sourceKey=' + encodeURIComponent(data.sourceKey)),
      KC.api(KC.API + '/catalog-sync')
    ]);
    data.knowledge = knowledge || {};
    data.files = files || { files: [] };
    data.catalogSync = catalogSync?.sources || [];
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!n) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function sourceOptions() {
    return data.sources.map(source => `
      <option value="${KC.esc(source.sourceKey)}" ${source.sourceKey === data.sourceKey ? 'selected' : ''}>
        ${KC.esc(source.name || source.sourceKey)} · ${KC.esc(source.sourceKey)}
      </option>
    `).join('');
  }

  function fileCard([type, label]) {
    const info = (data.files.files || []).find(file => file.type === type) || {};
    return `
      <div class="item">
        <div class="row space">
          <b>${KC.esc(label)}</b>
          <span class="muted">${KC.esc(formatBytes(info.bytes))}</span>
        </div>
        <div class="muted">${info.updatedAt ? `Cập nhật: ${KC.esc(KC.formatDate(info.updatedAt))}` : 'Chưa có file'}</div>
        <input type="file" data-file-input="${KC.esc(type)}" ${type === 'products' ? 'accept=".csv,text/csv"' : ''} multiple>
        <div class="row">
          <button class="btn" data-upload="${KC.esc(type)}" type="button">Upload</button>
          <button class="btn ghost" data-view-file="${KC.esc(type)}" type="button">Xem file</button>
        </div>
      </div>
    `;
  }

  function catalogSyncCard() {
    const sync = data.catalogSync.find(item => item.sourceKey === data.sourceKey);
    if (!sync) return '';
    const status = sync.enabled ? KC.statusBadge('Tự động mỗi giờ', 'on') : KC.statusBadge('Đang tắt', 'off');
    return `
      <div class="card">
        <div class="card-head">
          <div>
            <h3>Đồng bộ catalog từ website</h3>
            <div class="muted">${KC.esc(sync.storeUrl)}</div>
          </div>
          ${status}
        </div>
        <div class="card-body">
          <div class="list">
            <div class="muted">Lần đồng bộ thành công: ${sync.lastSuccessAt ? KC.esc(KC.formatDate(sync.lastSuccessAt)) : 'chưa có'}${sync.productCount ? ` · ${KC.esc(sync.productCount)} sản phẩm` : ''}</div>
            <div class="muted">Danh mục: ${sync.collectionCount ? `${KC.esc(sync.collectionCount)} danh mục, cập nhật ${KC.esc(KC.formatDate(sync.collectionsFetchedAt))}` : 'chưa tải'}</div>
            ${sync.lastError ? `<div class="login-error">Lỗi lần chạy gần nhất: ${KC.esc(sync.lastError)}</div>` : ''}
            <div class="muted">Khi đã đồng bộ, bot dùng catalog lấy từ website (products.synced.csv) thay cho file products.csv upload tay của nguồn này.</div>
            <div class="row">
              <button class="btn" id="catalogSyncBtn" type="button" ${!sync.enabled || data.syncing || sync.running ? 'disabled' : ''}>${data.syncing || sync.running ? 'Đang đồng bộ...' : 'Đồng bộ ngay'}</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async function runCatalogSync() {
    data.syncing = true;
    KC.setContent(render());
    bind();
    try {
      const result = await KC.api(KC.API + '/catalog-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceKey: data.sourceKey })
      });
      KC.toast(`Đã đồng bộ ${result.productCount} sản phẩm`);
    } catch (e) {
      KC.toast(`Đồng bộ lỗi: ${e.message}`);
    } finally {
      data.syncing = false;
      await load();
      KC.setContent(render());
      bind();
    }
  }

  function textEditor(type, label) {
    return `
      <div class="item">
        <label for="k-${KC.esc(type)}"><b>${KC.esc(label)}</b></label>
        <textarea id="k-${KC.esc(type)}">${KC.esc(data.knowledge[type] || '')}</textarea>
        <button class="btn" data-save="${KC.esc(type)}" type="button">Lưu nội dung</button>
      </div>
    `;
  }

  function viewer() {
    if (!data.viewer) return '';
    return `
      <div class="card">
        <div class="card-head">
          <div>
            <h3>File hiện tại: ${KC.esc(data.viewer.type)}</h3>
            <div class="muted">${KC.esc(formatBytes(data.viewer.bytes))}</div>
          </div>
          <button class="btn ghost" id="closeViewerBtn" type="button">Đóng</button>
        </div>
        <div class="card-body">
          <pre>${KC.esc(data.viewer.content || '')}</pre>
        </div>
      </div>
    `;
  }

  function render() {
    return `
      <div class="page">
        <div class="card">
          <div class="card-head">
            <h3>Nguồn training</h3>
            <select id="sourceKey" style="max-width:420px">${sourceOptions()}</select>
          </div>
        </div>
        ${catalogSyncCard()}
        <div class="card">
          <div class="card-head"><h3>Upload file training</h3></div>
          <div class="card-body">
            <div class="grid cols-3">${types.map(fileCard).join('')}</div>
          </div>
        </div>
        ${viewer()}
        <div class="grid cols-2">
          ${textEditor('faq', 'FAQ')}
          ${textEditor('policies', 'Chính sách')}
          ${textEditor('catalog_summary', 'Tổng quan catalog')}
        </div>
      </div>
    `;
  }

  async function save(type) {
    const content = KC.$('#k-' + CSS.escape(type)).value;
    await KC.api(KC.API + '/knowledge/' + encodeURIComponent(type), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceKey: data.sourceKey, content })
    });
    KC.toast('Đã lưu');
  }

  async function upload(type) {
    const input = KC.$(`[data-file-input="${CSS.escape(type)}"]`);
    const files = [...(input?.files || [])];
    if (!files.length) return KC.toast('Chưa chọn file');
    const content = (await Promise.all(files.map(file => file.text()))).join('\n');
    await KC.api(KC.API + '/knowledge-file/' + encodeURIComponent(type) + '?sourceKey=' + encodeURIComponent(data.sourceKey), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: content
    });
    await load();
    KC.setContent(render());
    bind();
    KC.toast('Đã upload');
  }

  async function viewFile(type) {
    data.viewer = await KC.api(KC.API + '/knowledge-file/' + encodeURIComponent(type) + '?sourceKey=' + encodeURIComponent(data.sourceKey));
    KC.setContent(render());
    bind();
  }

  function bind() {
    KC.$('#sourceKey').onchange = async event => {
      data.sourceKey = event.target.value;
      data.viewer = null;
      await load();
      KC.setContent(render());
      bind();
    };
    if (KC.$('#catalogSyncBtn')) KC.$('#catalogSyncBtn').onclick = runCatalogSync;
    KC.$$('[data-save]').forEach(btn => {
      btn.onclick = () => save(btn.dataset.save);
    });
    KC.$$('[data-upload]').forEach(btn => {
      btn.onclick = () => upload(btn.dataset.upload);
    });
    KC.$$('[data-view-file]').forEach(btn => {
      btn.onclick = () => viewFile(btn.dataset.viewFile);
    });
    if (KC.$('#closeViewerBtn')) KC.$('#closeViewerBtn').onclick = () => {
      data.viewer = null;
      KC.setContent(render());
      bind();
    };
  }

  KC.bootPage({
    page: 'knowledge',
    titleKey: 'titleKnowledge',
    subtitleKey: 'subtitleKnowledge',
    load,
    render,
    bind
  });
})();
