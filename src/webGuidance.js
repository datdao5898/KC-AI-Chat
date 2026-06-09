const { compactHost } = require('./sourceRegistry');

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function normalizeAllowedDomains(values) {
  const rawValues = Array.isArray(values)
    ? values
    : String(values || '').split(',');

  return [...new Set(rawValues.map(value => {
    const host = compactHost(String(value || '').trim()).toLowerCase().replace(/^\*\./, '');
    if (!host || host.length > 253) return '';
    if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..') || !host.includes('.')) return '';
    return host.replace(/^www\./, '');
  }).filter(Boolean))];
}

function isAllowedSourceUrl(value, allowedDomains = []) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return normalizeAllowedDomains(allowedDomains).some(domain => (
      host === domain || host.endsWith(`.${domain}`)
    ));
  } catch {
    return false;
  }
}

function extractUrls(text) {
  return String(text || '').match(/https?:\/\/[^\s<>()\]]+/gi) || [];
}

function extractCitations(message, allowedDomains) {
  const annotations = Array.isArray(message?.annotations) ? message.annotations : [];
  const citations = [];

  for (const annotation of annotations) {
    const citation = annotation?.url_citation || annotation;
    const url = String(citation?.url || '').trim();
    if (!isAllowedSourceUrl(url, allowedDomains)) continue;
    citations.push({
      url,
      title: String(citation?.title || '').trim(),
      content: String(citation?.content || '').trim()
    });
  }

  return [...new Map(citations.map(citation => [citation.url, citation])).values()];
}

function sanitizeCustomerReply(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1: $2')
    .replace(/\*\*/g, '')
    .trim();
}

function appendSources(reply, citations, language = 'vi') {
  const selected = (citations || []).slice(0, 3);
  if (!selected.length) return reply;

  const missing = selected.filter(citation => !String(reply).includes(citation.url));
  if (!missing.length) return reply;

  const label = language === 'en'
    ? 'Official sources:'
    : language === 'zh'
      ? '官方资料：'
      : 'Nguồn hướng dẫn chính hãng:';
  const rows = missing.map(citation => {
    const title = citation.title || new URL(citation.url).hostname.replace(/^www\./, '');
    return `- ${title}: ${citation.url}`;
  });
  return `${reply}\n\n${label}\n${rows.join('\n')}`.trim();
}

function normalizeBrandKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function getWebGuidanceConfig(sourceConfig = {}, product = {}) {
  const configured = sourceConfig.webGuidance && typeof sourceConfig.webGuidance === 'object'
    ? sourceConfig.webGuidance
    : {};
  const explicitlyEnabled = configured.enabled ?? sourceConfig.webSearchEnabled;
  const envEnabled = process.env.PRODUCT_GUIDANCE_WEB_SEARCH_ENABLED;
  const enabled = envEnabled !== undefined
    ? asBool(envEnabled, false)
    : asBool(explicitlyEnabled, false);
  let allowedDomains = normalizeAllowedDomains(
    configured.allowedDomains
      || sourceConfig.webSearchDomains
      || process.env.PRODUCT_GUIDANCE_WEB_SEARCH_DOMAINS
      || []
  );
  const brandDomains = configured.brandDomains && typeof configured.brandDomains === 'object'
    ? configured.brandDomains
    : {};
  const brandEntries = Object.entries(brandDomains);
  if (brandEntries.length && configured.restrictByProductBrand !== false) {
    const productIdentity = normalizeBrandKey([
      product.vendor,
      product.brand,
      product.name,
      product.title
    ].filter(Boolean).join(' '));
    const matchedDomains = brandEntries.flatMap(([brand, domains]) => (
      productIdentity.includes(normalizeBrandKey(brand))
        ? normalizeAllowedDomains(domains)
        : []
    ));
    allowedDomains = normalizeAllowedDomains(matchedDomains).filter(domain => (
      !allowedDomains.length || allowedDomains.includes(domain)
    ));
  }
  const maxResults = Math.max(
    1,
    Math.min(5, Number(process.env.PRODUCT_GUIDANCE_WEB_SEARCH_MAX_RESULTS || configured.maxResults || 3))
  );
  return { enabled, allowedDomains, maxResults };
}

function productSummary(product = {}) {
  return [
    `Name: ${product.name || product.title || ''}`,
    product.sku ? `SKU: ${product.sku}` : '',
    product.vendor || product.brand ? `Brand: ${product.vendor || product.brand}` : '',
    product.price || product.gia ? `Catalog price: ${product.price || product.gia}` : '',
    product.url || product.link || product.product_url
      ? `Catalog URL: ${product.url || product.link || product.product_url}`
      : '',
    product.description ? `Catalog description: ${String(product.description).slice(0, 2500)}` : ''
  ].filter(Boolean).join('\n');
}

function languageInstruction(language) {
  if (language === 'en') return 'Reply in natural English.';
  if (language === 'zh') return 'Reply in natural Simplified Chinese.';
  return 'Reply in natural Vietnamese.';
}

async function answerProductGuidanceFromWeb({
  userText,
  history = [],
  products = [],
  sourceConfig = {},
  customerBrand = 'KingCom',
  language = 'vi',
  timeoutMs = Number(process.env.PRODUCT_GUIDANCE_WEB_SEARCH_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 45000)
}) {
  const config = getWebGuidanceConfig(sourceConfig, products[0]);
  if (!config.enabled) return { ok: false, skipped: 'disabled', webSources: [] };
  if (!config.allowedDomains.length) return { ok: false, skipped: 'no_allowed_domains', webSources: [] };
  if (!products.length) return { ok: false, skipped: 'no_catalog_product', webSources: [] };

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
  const baseUrl = (process.env.OPENAI_BASE_URL || '').replace(/\/+$/, '');
  if (!apiKey) return { ok: false, skipped: 'missing_api_key', webSources: [] };
  if (!/openrouter\.ai/i.test(baseUrl)) {
    return { ok: false, skipped: 'provider_without_openrouter_web_search', webSources: [] };
  }

  const model = process.env.PRODUCT_GUIDANCE_WEB_SEARCH_MODEL
    || process.env.OPENAI_MODEL
    || 'openai/gpt-5.4-mini';
  const maxOutputTokens = Number(process.env.PRODUCT_GUIDANCE_WEB_SEARCH_MAX_OUTPUT_TOKENS || 800);
  const recentHistory = (history || []).slice(-6).map(message => (
    `${message.sender_type || message.senderType || 'unknown'}: ${message.text || ''}`
  )).join('\n');
  const prompt = [
    `You are a customer support specialist speaking as ${customerBrand}.`,
    'The customer is asking how to use, install, pair, connect, configure, or troubleshoot an exact product found in the store catalog.',
    'You must use the web search tool and rely only on the allowed official manufacturer domains.',
    'Give concise, practical steps for the exact catalog product. If the official sources do not establish the answer, say that the exact step could not be confirmed and ask one focused clarification question.',
    'Do not infer price, stock, promotions, delivery, seller warranty, VAT, or store policy from web results. If the customer also asks for price, use only the exact catalog price shown below.',
    'Do not recommend another product. Do not invent buttons, ports, menu names, accessories, firmware behavior, or compatibility.',
    'Do not call yourself an AI, bot, or automated system. Do not use emoji or markdown bold.',
    languageInstruction(language),
    '',
    'Catalog product:',
    productSummary(products[0]),
    '',
    recentHistory ? `Recent conversation:\n${recentHistory}\n` : '',
    `Customer question: ${userText}`,
    '',
    'End with one to three plain official source URLs used for the guidance.'
  ].filter(Boolean).join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const appReferer = process.env.OPENROUTER_HTTP_REFERER || process.env.PUBLIC_BASE_URL || '';
  const appTitle = process.env.OPENROUTER_TITLE || 'KingCom AI Agent';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
  if (appReferer) headers['HTTP-Referer'] = String(appReferer);
  if (appTitle) {
    headers['X-Title'] = String(appTitle);
    headers['X-OpenRouter-Title'] = String(appTitle);
  }

  const requestBody = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxOutputTokens,
    tools: [{
      type: 'openrouter:web_search',
      parameters: {
        engine: 'exa',
        max_results: config.maxResults,
        max_total_results: config.maxResults,
        search_context_size: 'low',
        allowed_domains: config.allowedDomains
      }
    }]
  };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify(requestBody)
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`OpenRouter web search ${response.status}: ${raw.slice(0, 500)}`);

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('OpenRouter web search returned invalid JSON');
    }

    const message = data?.choices?.[0]?.message;
    const content = sanitizeCustomerReply(message?.content);
    const webSources = extractCitations(message, config.allowedDomains);
    if (!content) throw new Error('OpenRouter web search returned empty response');
    if (!webSources.length) throw new Error('OpenRouter web search returned no allowed official citations');

    const contentUrls = extractUrls(content);
    const disallowedUrl = contentUrls.find(url => !isAllowedSourceUrl(url, config.allowedDomains));
    if (disallowedUrl) throw new Error('OpenRouter web search returned a URL outside the source allowlist');

    return {
      ok: true,
      reply: appendSources(content, webSources, language),
      webSources: webSources.slice(0, 3),
      webSearchRequests: Number(data?.usage?.server_tool_use?.web_search_requests || 0)
    };
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? `OpenRouter web search timeout after ${timeoutMs}ms`
      : (error.message || String(error));
    return { ok: false, error: message, webSources: [] };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  normalizeAllowedDomains,
  isAllowedSourceUrl,
  extractCitations,
  getWebGuidanceConfig,
  answerProductGuidanceFromWeb
};
