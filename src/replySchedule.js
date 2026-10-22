// AI auto-reply schedule: during staff hours the AI stays silent and staff answer;
// outside them (and on days off/holidays) the AI replies. Edited in admin, stored
// in app_settings so a deploy never overwrites it.
const SETTING_KEY = 'reply_schedule';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const CACHE_MS = 30 * 1000;

const DEFAULT_SCHEDULE = Object.freeze({
  enabled: false,
  timezone: 'Asia/Ho_Chi_Minh',
  notifyStaff: true,
  staffHours: {
    mon: { start: '09:00', end: '17:00' },
    tue: { start: '09:00', end: '17:00' },
    wed: { start: '09:00', end: '17:00' },
    thu: { start: '09:00', end: '17:00' },
    fri: { start: '09:00', end: '17:00' },
    sat: { start: '09:00', end: '17:00' },
    sun: null
  },
  holidays: []
});

let cache = null;

function minutes(hhmm = '') {
  const match = String(hhmm).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function normalizeSchedule(input = {}) {
  const staffHours = {};
  for (const day of DAYS) {
    const value = input.staffHours?.[day];
    const start = minutes(value?.start);
    const end = minutes(value?.end);
    staffHours[day] = value && start !== null && end !== null && start < end
      ? { start: value.start, end: value.end }
      : null;
  }
  const holidays = [...new Set((Array.isArray(input.holidays) ? input.holidays : [])
    .map(date => String(date || '').trim())
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
  return {
    enabled: input.enabled === true,
    timezone: DEFAULT_SCHEDULE.timezone,
    notifyStaff: input.notifyStaff !== false,
    staffHours,
    holidays
  };
}

function validateSchedule(input = {}) {
  for (const day of DAYS) {
    const value = input.staffHours?.[day];
    if (!value) continue;
    const start = minutes(value.start);
    const end = minutes(value.end);
    if (start === null || end === null) return `invalid_time_${day}`;
    if (start >= end) return `start_must_be_before_end_${day}`;
  }
  return '';
}

function localParts(now, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return {
    day: parts.weekday.toLowerCase().slice(0, 3),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

// Returns whether the AI may reply at `now`, and why.
function aiReplyDecision(schedule, now = new Date()) {
  const config = normalizeSchedule(schedule || {});
  if (!config.enabled) return { aiReplies: true, reason: 'schedule_disabled' };
  const local = localParts(now, config.timezone);
  if (config.holidays.includes(local.date)) return { aiReplies: true, reason: 'holiday', local };
  const hours = config.staffHours[local.day];
  if (!hours) return { aiReplies: true, reason: 'day_off', local };
  const inStaffHours = local.minute >= minutes(hours.start) && local.minute < minutes(hours.end);
  return inStaffHours
    ? { aiReplies: false, reason: 'staff_hours', local, hours }
    : { aiReplies: true, reason: 'outside_staff_hours', local, hours };
}

async function getReplySchedule({ fresh = false, db = require('./db') } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const stored = await db.getSetting(SETTING_KEY);
  const value = normalizeSchedule(stored || DEFAULT_SCHEDULE);
  cache = { at: Date.now(), value };
  return value;
}

async function saveReplySchedule(input, { db = require('./db') } = {}) {
  const error = validateSchedule(input);
  if (error) {
    const err = new Error(error);
    err.code = 'invalid_schedule';
    throw err;
  }
  const value = normalizeSchedule(input);
  await db.setSetting(SETTING_KEY, value);
  cache = { at: Date.now(), value };
  return value;
}

module.exports = {
  DAYS,
  DEFAULT_SCHEDULE,
  normalizeSchedule,
  validateSchedule,
  aiReplyDecision,
  getReplySchedule,
  saveReplySchedule
};
