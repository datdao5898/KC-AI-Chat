(function () {
  // Staff hours: the AI stays silent; outside them, on days without staff hours and on
  // holidays the AI replies. Stored server-side (GET/PUT /api/reply-schedule).
  const DAYS = [
    ['mon', 'Thứ 2'], ['tue', 'Thứ 3'], ['wed', 'Thứ 4'], ['thu', 'Thứ 5'],
    ['fri', 'Thứ 6'], ['sat', 'Thứ 7'], ['sun', 'Chủ Nhật']
  ];
  const REASONS = {
    schedule_disabled: 'Lịch đang tắt: AI trả lời mọi lúc',
    holiday: 'Hôm nay là ngày nghỉ: AI trả lời cả ngày',
    day_off: 'Hôm nay không có giờ trực: AI trả lời cả ngày',
    outside_staff_hours: 'Ngoài giờ nhân viên trực: AI đang trả lời',
    staff_hours: 'Trong giờ nhân viên trực: AI không trả lời'
  };
  const data = { schedule: null, now: null, saving: false };

  async function load() {
    const result = await KC.api(KC.API + '/reply-schedule');
    data.schedule = result.schedule;
    data.now = result.now;
  }

  function dayRow([key, label]) {
    const hours = data.schedule.staffHours[key];
    return `
      <div class="item">
        <div class="row space">
          <label class="row"><input type="checkbox" data-day-on="${key}" ${hours ? 'checked' : ''}> <b>${KC.esc(label)}</b></label>
          <span class="muted">${hours ? 'Nhân viên trực, ngoài giờ AI trả lời' : 'AI trả lời cả ngày'}</span>
        </div>
        <div class="row">
          <span class="muted">Nhân viên trực từ</span>
          <input type="time" data-day-start="${key}" value="${KC.esc(hours?.start || '09:00')}" ${hours ? '' : 'disabled'} style="width:130px">
          <span class="muted">đến</span>
          <input type="time" data-day-end="${key}" value="${KC.esc(hours?.end || '17:00')}" ${hours ? '' : 'disabled'} style="width:130px">
        </div>
      </div>
    `;
  }

  function statusText() {
    const now = data.now || {};
    const local = now.local ? ` (giờ Việt Nam: ${KC.esc(now.local.date)} ${String(Math.floor(now.local.minute / 60)).padStart(2, '0')}:${String(now.local.minute % 60).padStart(2, '0')})` : '';
    return `${KC.esc(REASONS[now.reason] || '')}${local}`;
  }

  function render() {
    const s = data.schedule;
    return `
      <div class="page">
        <div class="card">
          <div class="card-head">
            <div>
              <h3>Lịch trả lời tự động</h3>
              <div class="muted">${statusText()}</div>
            </div>
            ${s.enabled ? KC.statusBadge('Đang bật', 'on') : KC.statusBadge('Đang tắt', 'off')}
          </div>
          <div class="card-body">
            <div class="list">
              <label class="row"><input type="checkbox" id="scheduleEnabled" ${s.enabled ? 'checked' : ''}> <b>Bật lịch</b> <span class="muted">(tắt: AI trả lời mọi lúc như trước)</span></label>
              <label class="row"><input type="checkbox" id="scheduleNotify" ${s.notifyStaff ? 'checked' : ''}> <b>Báo nhân viên (Lark/Telegram)</b> <span class="muted">khi có khách nhắn trong giờ trực, mỗi hội thoại 1 lần</span></label>
              ${DAYS.map(dayRow).join('')}
              <div class="item">
                <b>Ngày nghỉ, lễ Tết (AI trả lời cả ngày)</b>
                <div class="row">
                  <input type="date" id="holidayInput" style="width:180px">
                  <button class="btn ghost" id="holidayAdd" type="button">Thêm ngày</button>
                </div>
                <div class="row">${s.holidays.length ? s.holidays.map(date => `
                  <span class="badge">${KC.esc(date)} <button class="btn ghost" data-holiday-remove="${KC.esc(date)}" type="button" style="padding:0 6px">×</button></span>
                `).join('') : '<span class="muted">Chưa có ngày nghỉ</span>'}</div>
              </div>
              <div class="row">
                <button class="btn" id="scheduleSave" type="button" ${data.saving ? 'disabled' : ''}>${data.saving ? 'Đang lưu...' : 'Lưu lịch'}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Keep unsaved edits when re-rendering (toggling a day, adding a holiday).
  function readForm() {
    const s = data.schedule;
    s.enabled = KC.$('#scheduleEnabled').checked;
    s.notifyStaff = KC.$('#scheduleNotify').checked;
    for (const [key] of DAYS) {
      const on = KC.$(`[data-day-on="${key}"]`).checked;
      s.staffHours[key] = on
        ? { start: KC.$(`[data-day-start="${key}"]`).value, end: KC.$(`[data-day-end="${key}"]`).value }
        : null;
    }
  }

  function rerender() {
    KC.setContent(render());
    bind();
  }

  async function save() {
    readForm();
    data.saving = true;
    rerender();
    try {
      const result = await KC.api(KC.API + '/reply-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.schedule)
      });
      data.schedule = result.schedule;
      data.now = result.now;
      KC.toast('Đã lưu lịch');
    } catch (e) {
      KC.toast(`Lưu lỗi: ${e.message}`);
    } finally {
      data.saving = false;
      rerender();
    }
  }

  function bind() {
    KC.$$('[data-day-on]').forEach(box => {
      box.onchange = () => { readForm(); rerender(); };
    });
    KC.$('#holidayAdd').onclick = () => {
      const date = KC.$('#holidayInput').value;
      if (!date) return KC.toast('Chọn ngày trước');
      readForm();
      if (!data.schedule.holidays.includes(date)) data.schedule.holidays = [...data.schedule.holidays, date].sort();
      rerender();
    };
    KC.$$('[data-holiday-remove]').forEach(btn => {
      btn.onclick = () => {
        readForm();
        data.schedule.holidays = data.schedule.holidays.filter(date => date !== btn.dataset.holidayRemove);
        rerender();
      };
    });
    KC.$('#scheduleSave').onclick = save;
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
