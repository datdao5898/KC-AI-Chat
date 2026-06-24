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

function asLoggedBoolean(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function summarizeJudgeMetrics(lines = []) {
  const metrics = {
    sampled: 0,
    judged: 0,
    approved: 0,
    rejected: 0,
    skipped: 0,
    unavailable: 0,
    reject_rate: 0
  };
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    metrics.sampled += 1;
    if (row.judgeSkipped) {
      metrics.skipped += 1;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(row, 'judgeApproved')) continue;
    if (/judge unavailable|judge error|timeout|empty response|invalid json/i.test(String(row.judgeReason || row.judgeError || ''))) {
      metrics.unavailable += 1;
      continue;
    }
    metrics.judged += 1;
    if (asLoggedBoolean(row.judgeApproved)) metrics.approved += 1;
    else metrics.rejected += 1;
  }
  metrics.reject_rate = metrics.judged
    ? Number(((metrics.rejected / metrics.judged) * 100).toFixed(1))
    : 0;
  return metrics;
}

function getJudgeMetrics(limit = 1000) {
  if (!fs.existsSync(AI_TRACE_LOG)) return summarizeJudgeMetrics([]);
  const lines = fs.readFileSync(AI_TRACE_LOG, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-Math.max(1, Math.min(Number(limit) || 1000, 5000)));
  return summarizeJudgeMetrics(lines);
}

module.exports = { logAiResponse, getJudgeMetrics, summarizeJudgeMetrics, AI_TRACE_LOG };
