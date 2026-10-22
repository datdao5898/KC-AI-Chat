const test = require('node:test');
const assert = require('node:assert/strict');
const { aiReplyDecision, normalizeSchedule, validateSchedule, DEFAULT_SCHEDULE } = require('../src/replySchedule');

// Vietnam is UTC+7; 2026-10-19 is a Monday and 2026-10-25 a Sunday.
const vn = (date, time) => new Date(`${date}T${time}:00+07:00`);
const enabled = { ...DEFAULT_SCHEDULE, enabled: true };

test('default schedule: staff Mon–Sat 09:00–17:00, AI otherwise', () => {
  assert.equal(aiReplyDecision(enabled, vn('2026-10-19', '10:00')).aiReplies, false);
  assert.equal(aiReplyDecision(enabled, vn('2026-10-24', '16:59')).aiReplies, false);
  assert.equal(aiReplyDecision(enabled, vn('2026-10-19', '17:00')).aiReplies, true);
  assert.equal(aiReplyDecision(enabled, vn('2026-10-19', '08:59')).aiReplies, true);
  assert.equal(aiReplyDecision(enabled, vn('2026-10-19', '23:30')).reason, 'outside_staff_hours');
  assert.equal(aiReplyDecision(enabled, vn('2026-10-25', '11:00')).reason, 'day_off');
});

test('holidays and a disabled schedule let the AI reply', () => {
  const withHoliday = { ...enabled, holidays: ['2026-10-20'] };
  assert.equal(aiReplyDecision(withHoliday, vn('2026-10-20', '10:00')).reason, 'holiday');
  assert.equal(aiReplyDecision(DEFAULT_SCHEDULE, vn('2026-10-19', '10:00')).reason, 'schedule_disabled');
});

test('schedule input is validated and normalized', () => {
  assert.equal(validateSchedule({ staffHours: { mon: { start: '17:00', end: '09:00' } } }), 'start_must_be_before_end_mon');
  assert.equal(validateSchedule({ staffHours: { mon: { start: '9h', end: '17:00' } } }), 'invalid_time_mon');
  const normalized = normalizeSchedule({ enabled: true, holidays: ['2026-02-17', 'bad', '2026-02-17'], staffHours: { sun: null } });
  assert.deepEqual(normalized.holidays, ['2026-02-17']);
  assert.equal(normalized.timezone, 'Asia/Ho_Chi_Minh');
  assert.equal(normalized.staffHours.mon, null);
});
