const fs = require('fs');
const path = require('path');
const { SOURCES_DIR, DATA_DIR, readSourceConfig } = require('./sourceRegistry');

// Syncs a source's catalog (products.synced.csv, read before products.csv) from its
// Haravan storefront JSON (public, no token):
// /collections/all/products.json for products/variants/stock and /collections.json for
// categories. Enable per source in source.json:
//   "catalogSync": { "enabled": true, "storeUrl": "https://store.kingcom.com.vn" }
const PAGE_SIZE = 50; // Haravan storefront caps every page at 50 items
const MAX_PAGES = 200;
const DESCRIPTION_LIMIT = 6000;
const REQUEST_DELAY_MS = Number(process.env.CATALOG_SYNC_REQUEST_DELAY_MS || 150);
const COLLECTIONS_REFRESH_MS = 24 * 60 * 60 * 1000;
const MIN_KEEP_RATIO = 0.8; // refuse to overwrite when the fetch returns far fewer products
const BACKUP_KEEP = 24;
const SKIPPED_COLLECTION = /(sale|flash|khuyen-mai|uu-dai|deal|black-friday)/i;
const HEADERS = [
  'sku', 'name', 'vendor', 'category', 'collections', 'price', 'compare_at_price',
  'inventory_quantity', 'availability', 'url', 'variants', 'description', 'tags',
  'ai_summary', 'updated_at'
];

const running = new Set();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sourceDir(sourceKey) {
  return path.join(SOURCES_DIR, ...String(sourceKey).split('/'));
}

function statePath(sourceKey) {
  return path.join(sourceDir(sourceKey), 'catalog_sync.json');
}

function readState(sourceKey) {
  try {
    return JSON.parse(fs.readFileSync(statePath(sourceKey), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(sourceKey, state) {
  fs.writeFileSync(statePath(sourceKey), JSON.stringify(state, null, 2), 'utf8');
}

function syncConfig(sourceKey) {
  const config = readSourceConfig(sourceKey).catalogSync || {};
  return {
    enabled: config.enabled === true,
    storeUrl: String(config.storeUrl || '').replace(/\/+$/, ''),
    collections: config.collections !== false
  };
}

function listSyncSources() {
  if (!fs.existsSync(SOURCES_DIR)) return [];
  const keys = [];
  for (const group of fs.readdirSync(SOURCES_DIR, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const source of fs.readdirSync(path.join(SOURCES_DIR, group.name), { withFileTypes: true })) {
      if (!source.isDirectory()) continue;
      const sourceKey = `${group.name}/${source.name}`;
      if (syncConfig(sourceKey).storeUrl) keys.push(sourceKey);
    }
  }
  return keys;
}

async function fetchJson(url, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'KingComCatalogSync/1.0' },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return JSON.parse(await response.text());
  } catch (error) {
    if (attempt >= 3) throw new Error(`Could not fetch ${url}: ${error.message}`);
    await sleep(1000 * attempt);
    return fetchJson(url, attempt + 1);
  }
}

async function fetchPaged(baseUrl, pathname, key) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = pathname.includes('?') ? '&' : '?';
    const data = await fetchJson(`${baseUrl}${pathname}${separator}limit=${PAGE_SIZE}&page=${page}`);
    const batch = Array.isArray(data?.[key]) ? data[key] : [];
    items.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return items;
}

// productId -> collection titles, refreshed at most once a day.
async function collectionMap(sourceKey, storeUrl, state, force) {
  const cached = state.collections;
  if (!force && cached?.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < COLLECTIONS_REFRESH_MS) {
    return cached.byProduct || {};
  }
  const collections = (await fetchPaged(storeUrl, '/collections.json', 'collections'))
    .filter(collection => collection.handle !== 'all' && !SKIPPED_COLLECTION.test(collection.handle || ''));
  const byProduct = {};
  for (const collection of collections) {
    const products = await fetchPaged(storeUrl, `/collections/${encodeURIComponent(collection.handle)}/products.json`, 'products');
    for (const product of products) {
      const titles = byProduct[product.id] || (byProduct[product.id] = []);
      if (!titles.includes(collection.title)) titles.push(collection.title);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  state.collections = { fetchedAt: new Date().toISOString(), count: collections.length, byProduct };
  return byProduct;
}

function decodeEntities(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function htmlToText(html = '') {
  return decodeEntities(String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/tr|\/div)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function priceText(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(Math.round(number)) : '';
}

function variantLine(variant) {
  const parts = [
    variant.title,
    variant.sku ? `SKU ${variant.sku}` : '',
    priceText(variant.price) ? `giá ${Number(variant.price).toLocaleString('vi-VN')}đ` : '',
    variant.available === false ? 'hết hàng' : 'còn hàng'
  ].filter(Boolean);
  return parts.join(' | ');
}

function mapProduct(product, storeUrl, collectionsByProduct, previousBySku, previousByUrl) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const realVariants = variants.filter(variant => !/^default title$/i.test(String(variant.title || '').trim()));
  const primary = variants.find(variant => variant.available) || variants[0] || {};
  const tracked = variants.filter(variant => variant.inventory_management && Number.isFinite(Number(variant.inventory_quantity)));
  const url = `${storeUrl}/products/${product.handle}`;
  const optionNames = (product.options || []).map(option => option.name).filter(name => name && !/^title$/i.test(name));
  const variantsText = realVariants.length
    ? `${optionNames.length ? `${optionNames.join(' / ')}: ` : ''}${realVariants.map(variantLine).join(' ; ')}`
    : '';
  const body = htmlToText(product.body_html);
  const description = [body, variantsText ? `Biến thể: ${variantsText}` : '']
    .filter(Boolean).join('\n\n').slice(0, DESCRIPTION_LIMIT);
  const previous = previousBySku.get(primary.sku) || previousByUrl.get(url) || {};
  return {
    sku: primary.sku || '',
    name: String(product.title || '').replace(/\s*\|\s*kingcom\s*$/i, '').trim(),
    vendor: product.vendor || '',
    category: product.product_type || '',
    collections: (collectionsByProduct[product.id] || []).join('; '),
    // Primary variant price: some variants are add-ons (e.g. a lens cap), so a minimum would mislead.
    price: priceText(primary.price),
    compare_at_price: priceText(primary.compare_at_price),
    inventory_quantity: tracked.length ? String(tracked.reduce((sum, variant) => sum + Math.max(0, Number(variant.inventory_quantity)), 0)) : '',
    availability: variants.some(variant => variant.available) ? 'in_stock' : 'out_of_stock',
    url,
    variants: variantsText,
    description,
    tags: [product.product_type, ...String(product.tags || '').split(',')].map(value => String(value || '').trim()).filter(Boolean).join('; '),
    ai_summary: previous.ai_summary || '',
    updated_at: product.updated_at || ''
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return [HEADERS.join(','), ...rows.map(row => HEADERS.map(header => csvEscape(row[header])).join(','))].join('\n') + '\n';
}

function backupCatalog(sourceKey, file) {
  if (!fs.existsSync(file)) return;
  const dir = path.join(DATA_DIR, '..', 'backups', 'catalog', ...sourceKey.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, `products-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`));
  const backups = fs.readdirSync(dir).filter(name => name.endsWith('.csv')).sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - BACKUP_KEEP))) fs.rmSync(path.join(dir, old));
}

async function syncSourceCatalog(sourceKey, { force = false, rag = require('./rag') } = {}) {
  const config = syncConfig(sourceKey);
  if (!config.storeUrl) return { ok: false, sourceKey, error: 'catalog_sync_not_configured' };
  if (running.has(sourceKey)) return { ok: false, sourceKey, error: 'catalog_sync_already_running' };
  running.add(sourceKey);
  const startedAt = Date.now();
  const state = readState(sourceKey);
  const file = path.join(sourceDir(sourceKey), 'products.synced.csv');
  try {
    const products = await fetchPaged(config.storeUrl, '/collections/all/products.json', 'products');
    const collectionsByProduct = config.collections ? await collectionMap(sourceKey, config.storeUrl, state, force) : {};
    // Compare with this source's own catalog only, not the group/common fallback.
    const previousRows = rag.fileRows(rag.sourceCatalogFile(sourceDir(sourceKey)));
    const previousBySku = new Map(previousRows.filter(row => row.sku).map(row => [row.sku, row]));
    const previousByUrl = new Map(previousRows.filter(row => row.url).map(row => [row.url, row]));
    const rows = products
      .filter(product => product.handle)
      .map(product => mapProduct(product, config.storeUrl, collectionsByProduct, previousBySku, previousByUrl));

    const previousCount = previousRows.length;
    if (!rows.length || (!force && previousCount && rows.length < previousCount * MIN_KEEP_RATIO)) {
      throw new Error(`Fetched ${rows.length} products vs ${previousCount} in the current catalog; not overwriting (use force to accept)`);
    }

    backupCatalog(sourceKey, file);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, toCsv(rows), 'utf8');
    fs.renameSync(tmp, file);

    Object.assign(state, {
      lastRunAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      lastError: '',
      productCount: rows.length,
      previousCount,
      durationMs: Date.now() - startedAt
    });
    writeState(sourceKey, state);
    return { ok: true, sourceKey, productCount: rows.length, previousCount, durationMs: state.durationMs };
  } catch (error) {
    Object.assign(state, { lastRunAt: new Date().toISOString(), lastError: error.message, durationMs: Date.now() - startedAt });
    writeState(sourceKey, state);
    return { ok: false, sourceKey, error: error.message };
  } finally {
    running.delete(sourceKey);
  }
}

function catalogSyncStatus() {
  return listSyncSources().map(sourceKey => {
    const config = syncConfig(sourceKey);
    const { collections, ...state } = readState(sourceKey);
    return {
      sourceKey,
      enabled: config.enabled,
      storeUrl: config.storeUrl,
      running: running.has(sourceKey),
      collectionsFetchedAt: collections?.fetchedAt || '',
      collectionCount: collections?.count || 0,
      ...state
    };
  });
}

function startCatalogSyncScheduler() {
  if (process.env.CATALOG_SYNC_ENABLED === 'false') return null;
  const intervalMs = Math.max(10, Number(process.env.CATALOG_SYNC_INTERVAL_MINUTES || 60)) * 60 * 1000;
  const runAll = async () => {
    for (const sourceKey of listSyncSources()) {
      if (!syncConfig(sourceKey).enabled) continue;
      const result = await syncSourceCatalog(sourceKey);
      if (result.ok) console.log(`[CATALOG SYNC] ${sourceKey}: ${result.productCount} products in ${result.durationMs}ms`);
      else console.error(`[CATALOG SYNC] ${sourceKey} failed: ${result.error}`);
    }
  };
  setTimeout(runAll, 60 * 1000).unref();
  return setInterval(runAll, intervalMs).unref();
}

module.exports = {
  HEADERS,
  htmlToText,
  mapProduct,
  toCsv,
  listSyncSources,
  syncSourceCatalog,
  catalogSyncStatus,
  startCatalogSyncScheduler
};
