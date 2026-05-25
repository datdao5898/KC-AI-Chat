const fs = require('fs');
const path = require('path');

const AI_TRACE_LOG = path.join(__dirname, '..', 'data', 'ai_responses.log');

function truncate(value, max = 4000) {
  if (value === undefined || value === null) return value;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}... [truncated]` : text;
}

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return truncate(value);

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|api[_-]?key|authorization|password/i.test(key)) {
      out[key] = '[redacted]';
    } else if (typeof item === 'object') {
      out[key] = clean(item);
    } else {
      out[key] = truncate(item);
    }
  }
  return out;
}

function logAiResponse(event) {
  if (process.env.AI_TRACE_LOG === 'false') return;
  const row = clean({
    ts: new Date().toISOString(),
    ...event
  });

  fs.mkdirSync(path.dirname(AI_TRACE_LOG), { recursive: true });
  fs.appendFileSync(AI_TRACE_LOG, `${JSON.stringify(row)}\n`, 'utf8');
}

module.exports = { logAiResponse, AI_TRACE_LOG };
