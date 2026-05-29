const crypto = require('crypto');

const COOKIE_NAME = 'kc_admin_session';
const SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS || 1000 * 60 * 60 * 12);

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromBase64url(input) {
  return Buffer.from(String(input || ''), 'base64url');
}

function getSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_TOKEN || process.env.DASHBOARD_TOKEN || '';
}

function getAdminUsername() {
  return process.env.ADMIN_USERNAME || process.env.ADMIN_USER || 'admin';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  const hash = crypto.scryptSync(String(password || ''), salt, 64);
  return `scrypt:v1:${salt}:${hash.toString('base64url')}`;
}

function verifyPassword(password, storedHash) {
  const value = String(storedHash || '');
  if (!value.startsWith('scrypt:v1:')) return false;
  const [, , salt, expectedRaw] = value.split(':');
  if (!salt || !expectedRaw) return false;
  const expected = fromBase64url(expectedRaw);
  const actual = crypto.scryptSync(String(password || ''), salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function verifyAdminPassword(password) {
  const storedHash = process.env.ADMIN_PASSWORD_HASH || '';
  if (storedHash) return verifyPassword(password, storedHash);

  const plain = process.env.ADMIN_PASSWORD || '';
  if (!plain) return false;
  const a = Buffer.from(String(password || ''));
  const b = Buffer.from(String(plain));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signPayload(payload) {
  const secret = getSessionSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSessionToken(username) {
  const payload = base64url(JSON.stringify({
    username,
    exp: Date.now() + SESSION_TTL_MS
  }));
  const sig = signPayload(payload);
  return sig ? `${payload}.${sig}` : '';
}

function verifySessionToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = signPayload(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(fromBase64url(payload).toString('utf8'));
    if (!data?.username || !data?.exp || Date.now() > Number(data.exp)) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map(part => {
    const [key, ...rest] = part.trim().split('=');
    return [key, decodeURIComponent(rest.join('=') || '')];
  }).filter(([key]) => key));
}

function cookieOptions() {
  const secure = process.env.ADMIN_COOKIE_SECURE === 'true';
  return [
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

function clearCookieOptions() {
  return [
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
    process.env.ADMIN_COOKIE_SECURE === 'true' ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

function setSessionCookie(res, username) {
  const token = createSessionToken(username);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieOptions()}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${clearCookieOptions()}`);
}

function isPasswordLoginConfigured() {
  return Boolean((process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD || '') && getSessionSecret());
}

module.exports = {
  COOKIE_NAME,
  getAdminUsername,
  hashPassword,
  verifyAdminPassword,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  isPasswordLoginConfigured
};
