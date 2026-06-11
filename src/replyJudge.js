const { detectMessageLanguage } = require('./ai');
const { resolveCustomerBrand } = require('./sourceRegistry');
const { createEmptyResponseError, extractAssistantText } = require('./llmResponse');

function getApiConfig() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY/OPENROUTER_API_KEY not configured');

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.OPENAI_JUDGE_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const maxOutputTokens = Number(process.env.OPENAI_JUDGE_MAX_OUTPUT_TOKENS || 520);
  const timeoutMs = Number(process.env.OPENAI_JUDGE_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 45000);
  return { apiKey, baseUrl, model, maxOutputTokens, timeoutMs };
}

async function callOpenAI(prompt, timeoutMs, attempt = 1) {
  const { apiKey, baseUrl, model, maxOutputTokens } = getApiConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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

  const requestBody = {
    model,
    messages: [
      {
        role: 'system',
        content: 'You are Conversation Auditor, a strict final quality gate for customer support replies. Return only valid JSON.'
      },
      { role: 'user', content: prompt }
    ]
  };
  requestBody[isOpenRouter ? 'max_tokens' : 'max_completion_tokens'] = attempt === 1
    ? maxOutputTokens
    : Math.max(maxOutputTokens * 2, 1000);
  if (isOpenRouter) {
    requestBody.reasoning = {
      effort: process.env.OPENAI_JUDGE_REASONING_EFFORT || 'minimal',
      exclude: true
    };
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify(requestBody)
    });

    const raw = await res.text();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 1000)}`);

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('OpenAI returned invalid JSON');
    }

    const content = extractAssistantText(data);
    if (!content) throw createEmptyResponseError(data);
    return content;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`OpenAI timeout after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
      } catch {
        return null;
      }
    }
    return null;
  }
}

function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'ok', 'approve', 'approved'].includes(lower)) return true;
    if (['false', '0', 'no', 'n', 'reject', 'rejected'].includes(lower)) return false;
  }
  return fallback;
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSeverity(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['low', 'medium', 'high'].includes(raw)) return raw;
  return 'medium';
}

function normalizeTextForCompare(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/https?:\/\/\S+/g, ' url ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(a, b) {
  const left = normalizeTextForCompare(a).split(/\s+/).filter(Boolean);
  const right = normalizeTextForCompare(b).split(/\s+/).filter(Boolean);
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const overlap = left.filter(token => rightSet.has(token)).length;
  return overlap / Math.max(left.length, right.length);
}

function summarizeProducts(ragProducts = []) {
  return (ragProducts || []).slice(0, 5).map((product, index) => {
    const name = product.name || product.title || product.sku || `Product ${index + 1}`;
    const price = product.price || product.gia || product.compare_at_price || '';
    const url = product.url || product.link || product.product_url || '';
    const sku = product.sku || '';
    const brand = product.brand || product.vendor || product.category || '';
    return [
      `${index + 1}. ${name}`,
      sku ? `SKU: ${sku}` : '',
      brand ? `Brand/category: ${brand}` : '',
      price ? `Price: ${price}` : '',
      url ? `Link: ${url}` : ''
    ].filter(Boolean).join(' | ');
  }).join('\n');
}

function summarizeWebSources(webSources = []) {
  return (webSources || []).slice(0, 5).map((source, index) => {
    const url = String(source?.url || '').trim();
    const title = String(source?.title || '').trim();
    const content = String(source?.content || '').trim().slice(0, 800);
    return [
      `${index + 1}. ${title || url || 'Official source'}`,
      url ? `URL: ${url}` : '',
      content ? `Excerpt: ${content}` : ''
    ].filter(Boolean).join(' | ');
  }).join('\n');
}

function summarizeHistory(history = []) {
  return (history || []).slice(-14).map(message => {
    const sender = message.sender_type || message.senderType || 'unknown';
    const text = String(message.text || '').trim();
    const createdAt = message.created_at || message.createdAt || '';
    return `${createdAt ? `[${createdAt}] ` : ''}${sender}: ${text}`;
  }).join('\n');
}

function buildJudgePrompt({
  userText,
  history = [],
  reply,
  ragProducts = [],
  validation = {},
  intent = '',
  channel = '',
  sourceKey = '',
  sourceName = '',
  sourceGroup = '',
  customerBrand = '',
  customer = {},
  aiSource = '',
  searchQuery = '',
  webSources = []
}) {
  const language = detectMessageLanguage(userText);
  const expectedBrand = customerBrand || resolveCustomerBrand({ sourceKey, sourceName, sourceGroup });
  const languageLabel = language === 'en' ? 'English' : language === 'zh' ? 'Simplified Chinese' : 'Vietnamese';
  const historyText = summarizeHistory(history);
  const productsText = summarizeProducts(ragProducts);
  const webSourcesText = summarizeWebSources(webSources);
  const validationText = validation?.ok === false
    ? `Previous rule validator rejected the draft reply: ${validation.reason || 'unknown reason'}`
    : 'Previous rule validator approved the draft reply.';

  return [
    `You are a strict quality judge for ${expectedBrand} customer support replies.`,
    'Your job is to decide whether the draft reply is contextually reasonable before it is sent to a real customer.',
    'You must infer the customer context yourself from the latest message, recent conversation, and retrieved catalog data.',
    '',
    'Return JSON only. No markdown. No code fences. No extra text.',
    'Required JSON shape:',
    '{',
    '  "approve": true or false,',
    '  "inferredCustomerNeed": "what the customer is asking now",',
    '  "riskType": "ok" | "wrong_product" | "wrong_brand" | "lost_context" | "unsupported_claim" | "policy_risk" | "tone_issue" | "language_issue" | "format_issue" | "unsafe_to_answer",',
    '  "reason": "short reason",',
    '  "severity": "low" | "medium" | "high",',
    '  "confidence": 0 to 1,',
    '  "needsHandoff": true or false,',
    '  "correctedReply": "short corrected reply or empty string"',
    '}',
    '',
    `Customer language: ${languageLabel}`,
    `Channel: ${channel || 'unknown'}`,
    `Intent: ${intent || 'unknown'}`,
    `Source group: ${sourceGroup || 'unknown'}`,
    `Source name: ${sourceName || 'unknown'}`,
    `Source key: ${sourceKey || 'unknown'}`,
    `Required customer-facing brand name: ${expectedBrand}`,
    `Reply source: ${aiSource || 'unknown'}`,
    `Search query used for retrieval: ${searchQuery || '(none)'}`,
    `Customer profile: ${JSON.stringify({
      name: customer?.name || '',
      phone: customer?.phone || '',
      external_id: customer?.external_id || customer?.externalUserId || ''
    })}`,
    '',
    'Latest customer message:',
    String(userText || '').trim(),
    '',
    'Recent conversation:',
    historyText || '(empty)',
    '',
    'Catalog products returned by retrieval:',
    productsText || '(none)',
    '',
    'Official web sources used for product guidance:',
    webSourcesText || '(none)',
    '',
    'Draft reply to judge:',
    String(reply || '').trim(),
    '',
    'Validator status:',
    validationText,
    '',
    'Audit checklist:',
    '1. The latest customer message has priority. Use recent conversation only to resolve a genuine follow-up such as "that product", "the previous model", "link for it", "con mau do", or "san pham do".',
    '1a. If the latest message is self-contained, do not add a camera brand, mount, model, budget, or requirement that the customer did not mention. Never infer those details from an older image or an older topic.',
    '2. Check whether the draft reply answers that inferred need directly. Reject if it answers a different question or ignores the latest message.',
    '3. Check product relevance. Product name/category/brand/model in the reply must match the customer need and the retrieved catalog. Do not let a generic word match change the category, e.g. "computer mouse" must not become "microphone for computer".',
    '4. Check source scope. If a fanpage/source is scoped to one brand, the reply must not recommend another brand unless recent context clearly asks to switch.',
    '5. Check support. Product identity, price, SKU, seller link, warranty, VAT, delivery, stock, or policy claims must be supported by retrieved catalog, recent conversation, or source data shown here. Product usage guidance may also be supported by the official web sources shown here.',
    '5a. Official web sources may support only usage, setup, pairing, connection, configuration, and troubleshooting. They must not be used as evidence for store price, stock, promotions, VAT, delivery, or seller policy.',
    `6. Check broad catalog questions separately. If the customer asks what ${expectedBrand} sells in general, the reply should describe product groups, not pretend one random product answers the question.`,
    '7. Check tone and format. No laughing at customers, no markdown bold, no emoji, no "AI/bot/system" wording to customers.',
    `7a. The reply must speak as ${expectedBrand}. Reject or correct it if it presents the seller as KingCom, NewLite, or another page name that is not ${expectedBrand}. Product names and URLs may retain their original wording.`,
    '8. If the draft is correct enough and only mildly imperfect, approve it. Do not reject just because it asks staff to confirm stock.',
    '',
    'Correction rules:',
    '- If wrong but fixable using only supplied context, provide correctedReply in the customer language.',
    '- If a specific product/brand/model is asked but not supported by catalog, correctedReply must clearly say it was not found in the current catalog/source, then offer staff check.',
    '- If the customer asks for a follow-up link and the previous product is visible in recent conversation, provide that link only if it is visible here; otherwise ask staff to confirm the exact link.',
    '- If unsafe and cannot be fixed from supplied context, provide a brief safe correctedReply and set needsHandoff true.',
    '- Do not invent products, prices, stock, warranty details, links, promotions, or policies.',
    '- Keep correctedReply short, natural, polite, and ready to send.',
    '- If the customer is writing in Vietnamese, reply in Vietnamese. If English, reply in English. If Simplified Chinese, reply in Simplified Chinese.',
  ].join('\n');
}

function normalizeJudgeResult(parsed, fallbackReply = '') {
  const data = parsed && typeof parsed === 'object' ? parsed : {};
  const approve = asBool(data.approve, false);
  const needsHandoff = asBool(data.needsHandoff, !approve);
  const confidence = Math.max(0, Math.min(1, asNumber(data.confidence, approve ? 0.8 : 0.5)));
  const reason = String(data.reason || '').trim() || (approve ? 'Approved by judge' : 'Rejected by judge');
  const severity = normalizeSeverity(data.severity);
  let correctedReply = String(data.correctedReply || '').trim() || (!approve ? String(fallbackReply || '').trim() : '');
  const inferredCustomerNeed = String(data.inferredCustomerNeed || data.customerNeed || '').trim();
  const riskType = String(data.riskType || data.risk || (approve ? 'ok' : 'unsafe_to_answer')).trim() || (approve ? 'ok' : 'unsafe_to_answer');
  const correctedSimilarity = !approve && correctedReply
    ? tokenSimilarity(correctedReply, fallbackReply)
    : 0;
  let finalReason = reason;
  if (!approve && correctedReply && correctedSimilarity >= 0.9) {
    correctedReply = '';
    finalReason = `${reason} Corrected reply was too similar to rejected draft.`;
  }

  return {
    approve,
    inferredCustomerNeed,
    riskType,
    reason: finalReason,
    severity,
    confidence,
    needsHandoff,
    correctedReply,
    correctedSimilarity
  };
}

async function judgeAiReply(payload) {
  const enabled = process.env.REPLY_JUDGE_ENABLED !== 'false';
  if (!enabled) {
    return {
      approve: true,
      reason: 'Judge disabled by env',
      severity: 'low',
      confidence: 1,
      needsHandoff: false,
      correctedReply: ''
    };
  }

  const timeoutMs = Number(process.env.OPENAI_JUDGE_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 45000);
  const attempts = Math.max(1, Number(process.env.OPENAI_JUDGE_RETRIES || 2));
  const prompt = buildJudgePrompt(payload);
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const retryPrompt = attempt === 1
        ? prompt
        : `${prompt}\n\nPrevious attempt failed to return parseable JSON. Return exactly one JSON object now.`;
      const raw = await callOpenAI(retryPrompt, timeoutMs, attempt);
      const parsed = safeJsonParse(raw);
      if (!parsed) {
        lastError = 'Judge returned invalid JSON';
        continue;
      }
      return normalizeJudgeResult(parsed, payload?.reply || '');
    } catch (error) {
      lastError = error.message || String(error);
      if (attempt >= attempts) {
        return {
          approve: false,
          inferredCustomerNeed: '',
          riskType: 'unsafe_to_answer',
          reason: `Judge error: ${lastError}`,
          severity: 'medium',
          confidence: 0,
          needsHandoff: true,
          correctedReply: '',
          correctedSimilarity: 0,
          error: lastError
        };
      }
    }
  }

  return {
    approve: false,
    inferredCustomerNeed: '',
    riskType: 'unsafe_to_answer',
    reason: lastError || 'Judge returned invalid JSON',
    severity: 'medium',
    confidence: 0.1,
    needsHandoff: true,
    correctedReply: '',
    correctedSimilarity: 0,
    error: lastError || 'Judge returned invalid JSON'
  };
}

module.exports = { judgeAiReply };
