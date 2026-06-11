const { createEmptyResponseError, extractAssistantText } = require('./llmResponse');

const MAX_IMAGES = 3;

function isAllowedFacebookMediaUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'facebook.com'
      || host.endsWith('.facebook.com')
      || host === 'fbcdn.net'
      || host.endsWith('.fbcdn.net')
      || host === 'fbsbx.com'
      || host.endsWith('.fbsbx.com');
  } catch {
    return false;
  }
}

function extractFacebookImageUrls(message = {}) {
  if (message.sticker_id) return [];
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  return [...new Set(attachments
    .filter(attachment => (
      String(attachment?.type || '').toLowerCase() === 'image'
      && !attachment?.payload?.sticker_id
    ))
    .map(attachment => attachment?.payload?.url)
    .filter(isAllowedFacebookMediaUrl))]
    .slice(0, MAX_IMAGES);
}

function isSupportedVisionInput(value) {
  const input = String(value || '');
  if (isAllowedFacebookMediaUrl(input)) return true;
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(input)
    && input.length <= 8 * 1024 * 1024;
}

function getApiConfig() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY/OPENROUTER_API_KEY not configured');

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const maxOutputTokens = Number(process.env.OPENAI_VISION_MAX_OUTPUT_TOKENS || 360);
  const timeoutMs = Number(process.env.OPENAI_VISION_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 45000);
  return { apiKey, baseUrl, model, maxOutputTokens, timeoutMs };
}

function safeJsonParse(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(raw.slice(first, last + 1));
      } catch {}
    }
  }
  return null;
}

function compactText(value, max = 700) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeVisionResult(parsed, model, imageCount) {
  const data = parsed && typeof parsed === 'object' ? parsed : {};
  const confidence = Math.max(0, Math.min(1, Number(data.confidence || 0)));
  const productType = compactText(data.productType || data.product_type, 120);
  const brand = compactText(data.brand, 80);
  const modelName = compactText(data.model || data.modelName, 120);
  const visibleText = compactText(data.visibleText || data.visible_text, 300);
  const description = compactText(data.description, 500);
  const hasExplicitRecognition = Object.prototype.hasOwnProperty.call(data, 'recognized');
  const recognized = hasExplicitRecognition
    ? data.recognized === true || String(data.recognized || '').toLowerCase() === 'true'
    : Boolean(productType || brand || modelName || visibleText || description);
  const searchText = [
    productType && `Product type: ${productType}`,
    brand && `Brand: ${brand}`,
    modelName && `Model: ${modelName}`,
    visibleText && `Visible text: ${visibleText}`,
    description && `Visual description: ${description}`
  ].filter(Boolean).join('. ');

  return {
    recognized,
    confidence,
    productType,
    brand,
    model: modelName,
    visibleText,
    description,
    searchText,
    providerModel: model,
    imageCount
  };
}

async function analyzeProductImages({ imageUrls = [], imageInputs = [], customerText = '', sourceName = '', enabled = true } = {}) {
  const urls = [...new Set([
    ...(imageUrls || []).filter(isAllowedFacebookMediaUrl),
    ...(imageInputs || []).filter(isSupportedVisionInput)
  ])].slice(0, MAX_IMAGES);
  if (!urls.length) return { recognized: false, skipped: 'no_supported_images', imageCount: 0 };
  if (!enabled || process.env.IMAGE_RECOGNITION_ENABLED === 'false') {
    return { recognized: false, skipped: 'disabled', imageCount: urls.length };
  }

  let config;
  try {
    config = getApiConfig();
  } catch (error) {
    return {
      recognized: false,
      error: error.message || String(error),
      imageCount: urls.length
    };
  }
  const { apiKey, baseUrl, model, maxOutputTokens, timeoutMs } = config;
  const isOpenRouter = /openrouter\.ai/i.test(baseUrl);
  const appReferer = process.env.OPENROUTER_HTTP_REFERER || process.env.PUBLIC_BASE_URL || '';
  const appTitle = process.env.OPENROUTER_TITLE || 'KingCom AI Agent';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
  if (isOpenRouter && appReferer) headers['HTTP-Referer'] = String(appReferer);
  if (isOpenRouter && appTitle) {
    headers['X-Title'] = String(appTitle);
    headers['X-OpenRouter-Title'] = String(appTitle);
  }

  const prompt = [
    'Analyze the attached customer product image for an internal retail search system.',
    'Identify only what is visibly supported. Do not guess hidden specifications, price, stock, warranty, or exact model.',
    'Pay special attention to product category, brand logo, model code, packaging text, labels, and visible accessories.',
    customerText ? `Customer caption: ${customerText}` : 'The customer sent no text caption.',
    sourceName ? `Current sales source: ${sourceName}` : '',
    'Return JSON only with this shape:',
    '{"recognized":true,"productType":"","brand":"","model":"","visibleText":"","description":"","confidence":0.0}',
    'Use concise English for productType and description. Preserve brand names, model codes, and visible text exactly.'
  ].filter(Boolean).join('\n');

  const requestBody = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...urls.map(url => ({ type: 'image_url', image_url: { url } }))
      ]
    }]
  };
  requestBody[isOpenRouter ? 'max_tokens' : 'max_completion_tokens'] = maxOutputTokens;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify(requestBody)
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Vision provider ${response.status}: ${raw.slice(0, 800)}`);
    const result = JSON.parse(raw);
    const contentText = extractAssistantText(result);
    if (!contentText) throw createEmptyResponseError(result, 'Vision provider');
    const parsed = safeJsonParse(contentText);
    if (!parsed) throw new Error('Vision provider returned invalid JSON');
    return normalizeVisionResult(parsed, model, urls.length);
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? `Vision timeout after ${timeoutMs}ms`
      : (error.message || String(error));
    return {
      recognized: false,
      error: message,
      providerModel: model,
      imageCount: urls.length
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  analyzeProductImages,
  extractFacebookImageUrls,
  isAllowedFacebookMediaUrl,
  isSupportedVisionInput,
  normalizeVisionResult
};
