(function () {
  // Staff hours: the AI stays silent; outside them, on days without staff hours and on
  // holidays the AI replies. Stored server-side (GET/PUT /api/reply-schedule).
  const DAYS = [
    ['mon', 'Thứ 2'], ['tue', 'Thứ 3'], ['wed', 'Thứ 4'], ['thu', 'Thứ 5'],
    ['fri', 'Thứ 6'], ['sat', 'Thứ 7'], ['sun', 'Chủ Nhật']
  ];
  const NOW_TEXT = {
    schedule_disabled: ['off', 'Lịch đang tắt: AI trả lời khách mọi lúc'],
    holiday: ['ai', 'Hôm nay là ngày nghỉ: AI trả lời khách cả ngày'],
    day_off: ['ai', 'Hôm nay không có giờ trực: AI trả lời khách cả ngày'],
    outside_staff_hours: ['ai', 'Ngoài giờ trực: AI đang trả lời khách'],
    staff_hours: ['staff', 'Trong giờ trực: nhân viên trả lời, AI không trả lời']
  };
  const data = { saved: null, draft: null, now: null, saving: false };

  const clone = value => JSON.parse(JSON.stringify(value));
  const isDirty = () => JSON.stringify(data.saved) !== JSON.stringify(data.draft);
  const toMinutes = hhmm => {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };
  const pad = n => String(n).padStart(2, '0');

  async function load() {
    const result = await KC.api(KC.API + '/reply-schedule');
    data.saved = result.schedule;
    data.draft = clone(result.schedule);
    data.now = result.now;
  }

  function nowCard() {
    const now = data.now || {};
    const [kind, title] = NOW_TEXT[now.reason] || ['off', ''];
    const local = now.local;
    const dayLabel = local ? (DAYS.find(([key]) => key === local.day) || [])[1] : '';
    const when = local
      ? `Giờ Việt Nam: ${dayLabel}, ${local.date.split('-').reverse().join('/')} ${pad(Math.floor(local.minute / 60))}:${pad(local.minute % 60)}`
      : 'Bật lịch để AI im lặng trong giờ nhân viên trực.';
    return `
      <div class="card">
        <div class="card-body sch-hero">
          <div class="sch-now">
            <span class="sch-dot ${kind}"></span>
            <div>
              <div class="sch-now-title">${KC.esc(title)}</div>
              <div class="muted">${KC.esc(when)}${isDirty() ? ' · theo lịch đã lưu' : ''}</div>
            </div>
          </div>
          <label class="sch-switch">
            <input type="checkbox" id="schEnabled" ${data.draft.enabled ? 'checked' : ''}>
            <span class="track"></span>
            <span>${data.draft.enabled ? 'Lịch đang bật' : 'Lịch đang tắt'}</span>
          </label>
        </div>
      </div>
    `;
  }

  function dayBar(hours) {
    if (!hours) return '<div class="sch-bar"><span class="ai" style="width:100%"></span></div>';
    const start = toMinutes(hours.start);
    const end = toMinutes(hours.end);
    if (start === null || end === null || start >= end) return '<div class="sch-bar"><span class="ai" style="width:100%"></span></div>';
    const pct = minutes => `${(minutes / 1440) * 100}%`;
    return `
      <div class="sch-bar" title="Nhân viên ${KC.esc(hours.start)}–${KC.esc(hours.end)}">
        <span class="ai" style="width:${pct(start)}"></span>
        <span class="staff" style="width:${pct(end - start)}"></span>
        <span class="ai" style="width:${pct(1440 - end)}"></span>
      </div>
    `;
  }

  function daySummary(hours) {
    if (!hours) return 'AI trả lời cả ngày';
    if (toMinutes(hours.start) >= toMinutes(hours.end)) return 'Giờ bắt đầu phải trước giờ kết thúc';
    return `Nhân viên ${hours.start}–${hours.end} · AI các giờ còn lại`;
  }

  function weekCard() {
    const today = data.now?.local?.day;
    const rows = DAYS.map(([key, label]) => {
      const hours = data.draft.staffHours[key];
      return `
        <div class="sch-row">
          <div class="sch-day ${key === today ? 'today' : ''}">${KC.esc(label)}</div>
          <div>
            ${dayBar(hours)}
            <div class="sch-summary">${KC.esc(daySummary(hours))}</div>
          </div>
          <div class="sch-controls">
            <label class="sch-switch">
              <input type="checkbox" data-day-on="${key}" ${hours ? 'checked' : ''}>
              <span class="track"></span>
            </label>
            <input type="time" data-day-start="${key}" value="${KC.esc(hours?.start || '09:00')}" ${hours ? '' : 'disabled'} aria-label="Bắt đầu trực ${KC.esc(label)}">
            <span class="muted">→</span>
            <input type="time" data-day-end="${key}" value="${KC.esc(hours?.end || '17:00')}" ${hours ? '' : 'disabled'} aria-label="Kết thúc trực ${KC.esc(label)}">
          </div>
        </div>
      `;
    }).join('');
    return `
      <div class="card">
        <div class="card-head">
          <div>
            <h3>Ai trả lời khách trong tuần</h3>
            <div class="sch-legend"><span><i class="staff"></i>Nhân viên trực (AI im lặng)</span><span><i class="ai"></i>AI trả lời</span></div>
          </div>
          <button class="btn ghost" id="schCopyMonday" type="button">Áp dụng giờ Thứ 2 cho Thứ 3 – Thứ 7</button>
        </div>
        <div class="card-body">
          <div class="sch-week">
            <div class="sch-row head">
              <div></div>
              <div class="sch-ticks"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>
              <div>Có nhân viên trực · từ → đến</div>
            </div>
            ${rows}
          </div>
        </div>
      </div>
    `;
  }

  function holidaysCard() {
    const holidays = data.draft.holidays;
    return `
      <div class="card">
        <div class="card-head"><h3>Ngày nghỉ, lễ Tết</h3></div>
        <div class="card-body">
          <div class="list">
            <div class="sch-help">Những ngày này AI trả lời khách cả ngày, kể cả trong giờ trực.</div>
            <div class="row">
              <input type="date" id="schHolidayInput" style="width:180px">
              <button class="btn ghost" id="schHolidayAdd" type="button">Thêm ngày</button>
            </div>
            <div class="sch-chips">${holidays.length ? holidays.map(date => `
              <span class="sch-chip">${KC.esc(date.split('-').reverse().join('/'))}<button type="button" data-holiday-remove="${KC.esc(date)}" aria-label="Xóa ngày ${KC.esc(date)}">×</button></span>
            `).join('') : '<span class="muted">Chưa có ngày nghỉ nào</span>'}</div>
          </div>
        </div>
      </div>
    `;
  }

  function notifyCard() {
    return `
      <div class="card">
        <div class="card-head"><h3>Báo nhân viên</h3></div>
        <div class="card-body">
          <div class="list">
            <label class="sch-switch">
              <input type="checkbox" id="schNotify" ${data.draft.notifyStaff ? 'checked' : ''}>
              <span class="track"></span>
              <span>Gửi Lark/Telegram khi khách nhắn trong giờ trực</span>
            </label>
            <div class="sch-help">Tin đầu tiên của hội thoại báo "cần nhân viên"; các tin sau vẫn báo từng tin sang Lark. Thông báo trên trình duyệt bật riêng ở nút "Bật thông báo" cuối menu trái.</div>
          </div>
        </div>
      </div>
    `;
  }

  function saveBar() {
    const dirty = isDirty();
    return `
      <div class="sch-savebar ${dirty ? 'dirty' : ''}">
        <span class="${dirty ? '' : 'muted'}">${dirty ? 'Có thay đổi chưa lưu' : 'Mọi thay đổi đã được lưu'}</span>
        <div class="row">
          <button class="btn ghost" id="schReset" type="button" ${dirty && !data.saving ? '' : 'disabled'}>Hoàn tác</button>
          <button class="btn" id="schSave" type="button" ${dirty && !data.saving ? '' : 'disabled'}>${data.saving ? 'Đang lưu...' : 'Lưu lịch'}</button>
        </div>
      </div>
    `;
  }

  function render() {
    return `
      <div class="page sch-page">
        ${nowCard()}
        ${weekCard()}
        <div class="grid cols-2">
          ${holidaysCard()}
          ${notifyCard()}
        </div>
        ${saveBar()}
      </div>
    `;
  }

  function rerender() {
    KC.setContent(render());
    bind();
  }

  // Edits change the draft only; nothing reaches the server until "Lưu lịch".
  function readDay(key) {
    const on = KC.$(`[data-day-on="${key}"]`).checked;
    data.draft.staffHours[key] = on
      ? { start: KC.$(`[data-day-start="${key}"]`).value || '09:00', end: KC.$(`[data-day-end="${key}"]`).value || '17:00' }
      : null;
  }

  async function save() {
    data.saving = true;
    rerender();
    try {
      const result = await KC.api(KC.API + '/reply-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.draft)
      });
      data.saved = result.schedule;
      data.draft = clone(result.schedule);
      data.now = result.now;
      KC.toast('Đã lưu lịch');
    } catch (e) {
      KC.toast(`Lưu lỗi: ${e.message}`, 6000);
    } finally {
      data.saving = false;
      rerender();
    }
  }

  function bind() {
    KC.$('#schEnabled').onchange = event => { data.draft.enabled = event.target.checked; rerender(); };
    KC.$('#schNotify').onchange = event => { data.draft.notifyStaff = event.target.checked; rerender(); };
    KC.$$('[data-day-on], [data-day-start], [data-day-end]').forEach(input => {
      input.onchange = () => {
        readDay(input.dataset.dayOn || input.dataset.dayStart || input.dataset.dayEnd);
        rerender();
      };
    });
    KC.$('#schCopyMonday').onclick = () => {
      const monday = data.draft.staffHours.mon;
      for (const key of ['tue', 'wed', 'thu', 'fri', 'sat']) data.draft.staffHours[key] = monday ? { ...monday } : null;
      rerender();
    };
    KC.$('#schHolidayAdd').onclick = () => {
      const date = KC.$('#schHolidayInput').value;
      if (!date) return KC.toast('Chọn ngày trước');
      if (!data.draft.holidays.includes(date)) data.draft.holidays = [...data.draft.holidays, date].sort();
      rerender();
    };
    KC.$$('[data-holiday-remove]').forEach(btn => {
      btn.onclick = () => {
        data.draft.holidays = data.draft.holidays.filter(date => date !== btn.dataset.holidayRemove);
        rerender();
      };
    });
    KC.$('#schReset').onclick = () => { data.draft = clone(data.saved); rerender(); };
    KC.$('#schSave').onclick = save;
  }

  KC.bootPage({
    page: 'schedule',
    titleKey: 'titleSchedule',
    subtitleKey: 'subtitleSchedule',
    load,
    render,
    bind,
    refreshButton: false
  });
})();
