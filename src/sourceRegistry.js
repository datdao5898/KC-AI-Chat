const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SOURCES_DIR = path.join(DATA_DIR, 'sources');

function compactHost(value) {
  if (!value) return '';
  const raw = String(value);
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {}
  return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
}

function slugifyPart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/Ä‘/g, 'd')
    .replace(/Ä/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function lookupEnvMap(envName, key) {
  if (!key) return '';
  const raw = process.env[envName] || '';
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed[key] || parsed[String(key)] || '';
    }
  } catch {}

  for (const entry of raw.split(',')) {
    const [left, ...rest] = entry.split(':');
    if (left && left.trim() === String(key)) return rest.join(':').trim();
  }
  return '';
}

function buildSourceContext({ channel, raw = {}, customerAttrs = {} }) {
  const channelKey = channel === 'haravan_website' ? 'website' : (channel === 'haravan' ? 'website' : (channel || 'common'));
  let sourceId = '';
  let sourceName = '';

  if (channelKey === 'facebook') {
    const pageId = raw?.recipient?.id || raw?.page_id || raw?.entry?.[0]?.id || process.env.FACEBOOK_PAGE_ID || '';
    sourceId = pageId || 'default';
    sourceName = lookupEnvMap('FACEBOOK_PAGE_NAMES', pageId) || process.env.FACEBOOK_PAGE_NAME || raw?.page_name || (pageId ? `Fanpage ${pageId}` : 'Fanpage Facebook');
  } else if (channelKey === 'zalo') {
    const oaId = raw?.oa_id || raw?.recipient?.id || raw?.app_id || process.env.ZALO_OA_ID || '';
    sourceId = oaId || 'default';
    sourceName = lookupEnvMap('ZALO_OA_NAMES', oaId) || process.env.ZALO_OA_NAME || raw?.oa_name || (oaId ? `Zalo OA ${oaId}` : 'Zalo OA');
  } else if (channelKey === 'website') {
    const siteName = raw?.siteName || raw?.site_name || customerAttrs.siteName || process.env.DEFAULT_WEBSITE_NAME || '';
    const host = compactHost(raw?.siteHost || raw?.site_host || raw?.siteUrl || raw?.site_url || raw?.origin || raw?.referrer || process.env.DEFAULT_WEBSITE_HOST || '');
    sourceId = siteName || host || 'default';
    sourceName = siteName || host || 'Website chung';
  } else {
    sourceId = slugifyPart(channelKey || 'common') || 'common';
    sourceName = channelKey || 'Common';
  }

  const sourceKey = `${channelKey}/${slugifyPart(sourceId || 'default') || 'default'}`;
  return {
    sourceGroup: channelKey,
    sourceKey,
    sourceId,
    sourceName,
    sourceLabel: sourceName,
  };
}

function getSourceCandidates(sourceKey) {
  const normalized = String(sourceKey || '').trim();
  const candidates = [];
  if (normalized) candidates.push(normalized);
  const group = normalized.split('/')[0];
  if (group && group !== normalized) candidates.push(group);
  candidates.push('common');
  return [...new Set(candidates.filter(Boolean))];
}

function resolveSourcePaths(filename, sourceKey) {
  const paths = [];
  for (const candidate of getSourceCandidates(sourceKey)) {
    if (candidate === 'common') {
      paths.push(path.join(SOURCES_DIR, 'common', filename));
    } else {
      paths.push(path.join(SOURCES_DIR, ...candidate.split('/'), filename));
    }
  }
  paths.push(path.join(DATA_DIR, filename));
  return [...new Set(paths)];
}

function readFirstExistingText(filename, sourceKey, maxBytes = 4000) {
  for (const file of resolveSourcePaths(filename, sourceKey)) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8').slice(0, maxBytes);
    if (text.trim()) return text;
  }
  return '';
}

function readSourceConfig(sourceKey) {
  const normalized = String(sourceKey || '').trim();
  if (!normalized) return {};
  const file = path.join(SOURCES_DIR, ...normalized.split('/'), 'source.json');
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

module.exports = {
  SOURCES_DIR,
  DATA_DIR,
  compactHost,
  slugifyPart,
  lookupEnvMap,
  buildSourceContext,
  getSourceCandidates,
  resolveSourcePaths,
  readFirstExistingText,
  readSourceConfig,
};
