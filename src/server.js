const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { initDb } = require('./db');
const { backfillFacebookCustomerNames } = require('./channels/facebook');
const webhooks = require('./routes/webhooks');
const admin = require('./routes/admin');
const packageJson = require('../package.json');
const {
  getAdminUsername,
  verifyAdminPassword,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  isPasswordLoginConfigured
} = require('./adminAuth');

const app = express();
const PORT = Number(process.env.PORT || 8660);
app.set('trust proxy', 1);
let httpServer = null;

function parseLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function jsonRateLimitHandler(error) {
  return (req, res) => {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error, retry_after_seconds: 60 });
  };
}

function createMinuteLimiter(envName, fallback, error) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: parseLimit(process.env[envName], fallback),
    standardHeaders: false,
    legacyHeaders: false,
    handler: jsonRateLimitHandler(error)
  });
}

const loginLimiter = createMinuteLimiter('ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE', 5, 'too_many_login_attempts');
const dataDeletionLimiter = createMinuteLimiter('DATA_DELETION_RATE_LIMIT_PER_MINUTE', 5, 'too_many_requests');

function cleanText(value, maxLength = 1000) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, maxLength);
}

async function saveDataDeletionRequest(body) {
  const record = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    name: cleanText(body.name, 160),
    contact: cleanText(body.contact, 240),
    channel: cleanText(body.channel, 80),
    source: cleanText(body.source, 240),
    identifier: cleanText(body.identifier, 240),
    approximateTime: cleanText(body.approximateTime, 240),
    details: cleanText(body.details, 2000),
    status: 'open'
  };
  const dataDir = path.join(__dirname, '..', 'data');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.appendFile(
    path.join(dataDir, 'data_deletion_requests.log'),
    JSON.stringify(record) + '\n',
    'utf8'
  );
  return record;
}

if (process.env.REQUEST_LOG !== 'false') {
  app.use((req, res, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
      const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];
      const durationMs = Date.now() - startedAt;
      console.info(`[REQ] ${req.method} ${pathOnly} ${res.statusCode} ${durationMs}ms ${requestId}`);
    });
    next();
  });
}

function configuredOrigins() {
  const values = [
    ...(process.env.CORS_ORIGINS || '').split(','),
    process.env.PUBLIC_BASE_URL
  ].filter(Boolean);
  return new Set(values.map(v => {
    try { return new URL(v.trim()).origin; } catch { return v.trim(); }
  }).filter(Boolean));
}

const allowedOrigins = configuredOrigins();
app.use(cors({
  credentials: true,
  origin(origin, cb) {
    if (!origin || process.env.CORS_ALLOW_ALL === 'true' || allowedOrigins.has(origin)) return cb(null, true);
    return cb(new Error('cors_not_allowed'));
  }
}));

app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || '1mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
    req.rawBodyText = buf.toString('utf8');
  }
}));

app.get('/', (req, res) => res.redirect('/admin/'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/privacy-policy', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'privacy-policy.html')));
app.get('/data-deletion', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'data-deletion.html')));
app.post('/data-deletion/request', dataDeletionLimiter, async (req, res) => {
  try {
    const contact = cleanText(req.body?.contact, 240);
    const identifier = cleanText(req.body?.identifier, 240);
    const details = cleanText(req.body?.details, 2000);
    if (!contact) return res.status(400).json({ error: 'contact_required' });
    if (!identifier && details.length < 10) return res.status(400).json({ error: 'request_details_required' });
    const record = await saveDataDeletionRequest(req.body || {});
    return res.json({ ok: true, requestId: record.id });
  } catch (error) {
    console.error('Data deletion request error:', error.message);
    return res.status(500).json({ error: 'request_failed' });
  }
});
app.use('/webhooks', webhooks);
// Alias tương thích với prototype cũ: /webhook/facebook
app.use('/webhook', webhooks);

app.get('/auth/me', (req, res) => {
  if (process.env.ADMIN_AUTH_DISABLED === 'true') return res.json({ ok: true, username: 'disabled' });
  const session = getSessionFromRequest(req);
  if (session) return res.json({ ok: true, username: session.username });
  return res.status(401).json({ error: 'unauthorized' });
});

app.post('/auth/login', loginLimiter, (req, res) => {
  if (process.env.ADMIN_AUTH_DISABLED === 'true') return res.json({ ok: true, username: 'disabled' });
  if (!isPasswordLoginConfigured()) return res.status(503).json({ error: 'admin_login_not_configured' });

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (username !== getAdminUsername() || !verifyAdminPassword(password)) {
    return res.status(401).json({ error: 'invalid_login' });
  }

  setSessionCookie(res, username);
  return res.json({ ok: true, username });
});

app.post('/auth/logout', (req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
});

function requireAdminAuth(req, res, next) {
  if (process.env.ADMIN_AUTH_DISABLED === 'true') return next();
  const session = getSessionFromRequest(req);
  if (session) {
    req.adminUser = session.username;
    return next();
  }

  const token = process.env.ADMIN_TOKEN || process.env.DASHBOARD_TOKEN || '';
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-admin-token'] || '');
  if (supplied && supplied === token) return next();
  if (!isPasswordLoginConfigured() && !token) return res.status(503).json({ error: 'admin_login_not_configured' });
  return res.status(401).json({ error: 'unauthorized' });
}

app.use('/api', requireAdminAuth, admin);
app.get('/health', (req, res) => res.json({
  ok: true,
  service: 'KingCom AI Agent',
  version: packageJson.version,
  uptime_seconds: Math.round(process.uptime()),
  channels: ['facebook', 'zalo', 'haravan_website']
}));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  if (err.message === 'cors_not_allowed') return res.status(403).json({ error: 'cors_not_allowed' });
  console.error('Unhandled request error:', err);
  return res.status(500).json({ error: 'internal_error' });
});

async function startServer() {
  await initDb();
  httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 KingCom AI Agent running: http://localhost:${PORT}`);
    console.log(`📌 Facebook webhook: /webhooks/facebook`);
    console.log(`📌 Zalo webhook: /webhooks/zalo`);
    console.log(`📌 Haravan webhook: /webhooks/haravan`);
    console.log(`📌 Website chat API: /webhooks/website-chat`);
    setTimeout(() => {
      backfillFacebookCustomerNames()
        .then(result => console.log('[FB PROFILE] backfill_done', JSON.stringify(result)))
        .catch(err => console.warn('[FB PROFILE] backfill_failed', err.message));
    }, 2000);
  });
}

function shutdown(signal) {
  console.log(`[SHUTDOWN] Received ${signal}, closing HTTP server...`);
  const forceExitTimer = setTimeout(() => {
    console.error('[SHUTDOWN] Graceful shutdown timed out, forcing exit.');
    process.exit(1);
  }, 15000);
  forceExitTimer.unref?.();

  if (!httpServer) {
    clearTimeout(forceExitTimer);
    process.exit(0);
    return;
  }

  httpServer.close(err => {
    clearTimeout(forceExitTimer);
    if (err) {
      console.error('[SHUTDOWN] HTTP server close failed:', err.message);
      process.exit(1);
      return;
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer().catch(err => {
  console.error('Failed to start KingCom AI Agent:', err.message);
  process.exitCode = 1;
});
