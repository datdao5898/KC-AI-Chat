require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db');
const { backfillFacebookCustomerNames } = require('./channels/facebook');
const webhooks = require('./routes/webhooks');
const admin = require('./routes/admin');
const {
  getAdminUsername,
  verifyAdminPassword,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  isPasswordLoginConfigured
} = require('./adminAuth');

initDb();
const app = express();
const PORT = Number(process.env.PORT || 8660);
app.set('trust proxy', 1);

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

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/webhooks', webhooks);
// Alias tương thích với prototype cũ: /webhook/facebook
app.use('/webhook', webhooks);

app.get('/auth/me', (req, res) => {
  if (process.env.ADMIN_AUTH_DISABLED === 'true') return res.json({ ok: true, username: 'disabled' });
  const session = getSessionFromRequest(req);
  if (session) return res.json({ ok: true, username: session.username });
  return res.status(401).json({ error: 'unauthorized' });
});

app.post('/auth/login', (req, res) => {
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
app.get('/health', (req, res) => res.json({ ok: true, service: 'KingCom AI Agent', channels: ['facebook','zalo','haravan_website'] }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  if (err.message === 'cors_not_allowed') return res.status(403).json({ error: 'cors_not_allowed' });
  console.error('Unhandled request error:', err);
  return res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, '0.0.0.0', () => {
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
