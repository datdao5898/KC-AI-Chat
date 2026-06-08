const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT, 'data', 'sources', 'website', 'newlite', 'products.csv');
const BACKUP_ROOT = path.join(ROOT, 'backups', 'training');
const BASE_URL = 'https://newlite.vn';
const PRODUCTS_ENDPOINT = `${BASE_URL}/collections/all/products.json`;
const PAGE_SIZE = 250;
const DESCRIPTION_LIMIT = 6000;
const HEADERS = ['sku', 'name', 'vendor', 'price', 'url', 'description', 'tags'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchText(url, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json,text/plain,text/html,application/xml',
        'User-Agent': 'KingComCatalogSync/1.0'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (attempt >= 3) throw new Error(`Could not fetch ${url}: ${error.message}`);
    await sleep(500 * attempt);
    return fetchText(url, attempt + 1);
  }
}

async function fetchJson(url) {
  const text = await fetchText(url);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}`);
  }
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|iframe|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<img\b[^>]*>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|h[1-6]|tr|table|ul|ol|blockquote)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/(li|td|th)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function variantSummary(variants) {
  if (!Array.isArray(variants) || variants.length <= 1) return '';
  const lines = variants.map(variant => {
    const parts = [
      normalizeText(variant.title),
      variant.sku ? `SKU ${normalizeText(variant.sku)}` : '',
      variant.price ? `giá ${normalizeText(variant.price)} VND` : ''
    ].filter(Boolean);
    return parts.length ? `- ${parts.join(' | ')}` : '';
  }).filter(Boolean);
  return lines.length ? `Biến thể:\n${lines.join('\n')}` : '';
}

function compactDescription(bodyHtml, variants) {
  const variantText = variantSummary(variants);
  const reserve = variantText ? Math.min(variantText.length + 2, DESCRIPTION_LIMIT) : 0;
  const bodyLimit = Math.max(0, DESCRIPTION_LIMIT - reserve);
  const bodyText = htmlToText(bodyHtml).slice(0, bodyLimit).trim();
  return normalizeText([bodyText, variantText].filter(Boolean).join('\n\n')).slice(0, DESCRIPTION_LIMIT);
}

function productTags(product) {
  const values = [
    product.product_type,
    ...String(product.tags || '').split(',')
  ].map(normalizeText).filter(Boolean);
  const seen = new Set();
  return values.filter(value => {
    const key = value.toLocaleLowerCase('vi');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('; ');
}

function mapProduct(product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const primaryVariant = variants.find(variant => variant.available) || variants[0] || {};
  return {
    sku: normalizeText(primaryVariant.sku),
    name: normalizeText(product.title),
    vendor: normalizeText(product.vendor),
    price: normalizeText(primaryVariant.price),
    url: `${BASE_URL}/products/${product.handle}`,
    description: compactDescription(product.body_html, variants),
    tags: productTags(product)
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(rows) {
  const lines = [HEADERS.join(',')];
  for (const row of rows) {
    lines.push(HEADERS.map(header => csvEscape(row[header])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

async function fetchAllProducts() {
  const products = [];
  for (let page = 1; ; page++) {
    const url = `${PRODUCTS_ENDPOINT}?limit=${PAGE_SIZE}&page=${page}`;
    const data = await fetchJson(url);
    const pageProducts = Array.isArray(data.products) ? data.products : [];
    if (!pageProducts.length) break;
    products.push(...pageProducts);
    console.log(`[newlite] page ${page}: ${pageProducts.length} products`);
    await sleep(100);
  }
  return products;
}

function sitemapProductUrls(xml) {
  return [...String(xml || '').matchAll(/<loc>(https:\/\/newlite\.vn\/products\/[^<]+)<\/loc>/g)]
    .map(match => decodeHtmlEntities(match[1]));
}

async function fetchSitemapUrls() {
  const indexXml = await fetchText(`${BASE_URL}/sitemap.xml`);
  const sitemapUrls = [...indexXml.matchAll(/<loc>([^<]*sitemap_products_[^<]+)<\/loc>/g)]
    .map(match => decodeHtmlEntities(match[1]));
  const productUrls = [];
  for (const sitemapUrl of sitemapUrls) {
    productUrls.push(...sitemapProductUrls(await fetchText(sitemapUrl)));
  }
  return [...new Set(productUrls)];
}

function validateRows(rows, sitemapUrls) {
  const urls = rows.map(row => row.url);
  const uniqueUrls = new Set(urls);
  if (!rows.length) throw new Error('No products were returned');
  if (uniqueUrls.size !== rows.length) throw new Error(`Duplicate product URLs: ${rows.length - uniqueUrls.size}`);
  if (rows.some(row => !row.name || !row.url)) throw new Error('A product is missing name or URL');

  const rowUrlSet = new Set(urls);
  const sitemapUrlSet = new Set(sitemapUrls);
  const missingFromApi = sitemapUrls.filter(url => !rowUrlSet.has(url));
  const missingFromSitemap = urls.filter(url => !sitemapUrlSet.has(url));
  if (missingFromApi.length || missingFromSitemap.length) {
    throw new Error(
      `API/sitemap mismatch: missingFromApi=${missingFromApi.length}, missingFromSitemap=${missingFromSitemap.length}`
    );
  }
}

function backupCurrentFile() {
  if (!fs.existsSync(OUTPUT_FILE)) return '';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(BACKUP_ROOT, `website-newlite-before-crawl-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, 'products.csv');
  fs.copyFileSync(OUTPUT_FILE, backupFile);
  return backupFile;
}

async function main() {
  const products = await fetchAllProducts();
  const rows = products.map(mapProduct);
  const sitemapUrls = await fetchSitemapUrls();
  validateRows(rows, sitemapUrls);

  const backupFile = backupCurrentFile();
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, writeCsv(rows), 'utf8');

  const stats = {
    products: rows.length,
    sitemapProducts: sitemapUrls.length,
    blankSku: rows.filter(row => !row.sku).length,
    blankVendor: rows.filter(row => !row.vendor).length,
    blankPrice: rows.filter(row => !row.price).length,
    blankDescription: rows.filter(row => !row.description).length,
    outputFile: OUTPUT_FILE,
    backupFile
  };
  console.log(JSON.stringify(stats, null, 2));
}

main().catch(error => {
  console.error(`[crawl-newlite-products] ${error.message}`);
  process.exit(1);
});
