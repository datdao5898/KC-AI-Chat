const { extractProductPageUrls, productSlugFromUrl } = require('./rag');
const { compactHost } = require('./sourceRegistry');

function asBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function hostFromUrl(value) {
  try {
    return compactHost(String(value || '')).toLowerCase();
  } catch {
    return '';
  }
}

function productHosts(products = []) {
  return [...new Set((products || []).map(product => (
    hostFromUrl(product.url || product.link || product.product_url || '')
  )).filter(Boolean))];
}

function isAllowedProductPageUrl(url, products = []) {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'https:') return false;
    if (!/\/products?\//i.test(parsed.pathname)) return false;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const slug = productSlugFromUrl(url);
    const hosts = productHosts(products);
    const productSlugs = new Set((products || [])
      .map(product => productSlugFromUrl(product.url || product.link || product.product_url || ''))
      .filter(Boolean));
    return hosts.includes(host) || (slug && productSlugs.has(slug));
  } catch {
    return false;
  }
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractHtmlText(html, maxChars = 3500) {
  const input = String(html || '');
  const title = input.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const description = input.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]
    || input.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i)?.[1]
    || '';
  const body = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeHtmlEntities([title, description, body].filter(Boolean).join('\n'))
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxChars);
}

async function fetchProductPage(url, {
  timeoutMs = Number(process.env.PRODUCT_PAGE_FETCH_TIMEOUT_MS || 5000),
  maxBytes = Number(process.env.PRODUCT_PAGE_FETCH_MAX_BYTES || 350000),
  maxChars = Number(process.env.PRODUCT_PAGE_CONTEXT_MAX_CHARS || 3500)
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'KingCom-AI-Agent/1.0 (+product-page-context)',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
    const raw = await response.text();
    const html = raw.slice(0, Math.max(1000, maxBytes));
    const text = extractHtmlText(html, maxChars);
    if (!text) throw new Error('No readable product page text');
    return { ok: true, url, text };
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? `Product page fetch timeout after ${timeoutMs}ms`
      : (error.message || String(error));
    return { ok: false, url, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function readProductPageContext(customerText, { products = [] } = {}) {
  if (!asBool(process.env.PRODUCT_PAGE_FETCH_ENABLED, true)) return { ok: false, skipped: 'disabled' };
  const urls = extractProductPageUrls(customerText);
  if (!urls.length) return { ok: false, skipped: 'no_product_url' };
  const url = urls.find(candidate => isAllowedProductPageUrl(candidate, products));
  if (!url) return { ok: false, skipped: 'url_not_allowed' };
  return fetchProductPage(url);
}

module.exports = {
  extractHtmlText,
  isAllowedProductPageUrl,
  readProductPageContext
};
