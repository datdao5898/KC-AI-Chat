const { createEmptyResponseError, extractAssistantText } = require('./llmResponse');

function resolveProviderConfig(options = {}) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY/OPENROUTER_API_KEY not configured');

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const isOpenRouter = /openrouter\.ai/i.test(baseUrl);
  return {
    apiKey,
    baseUrl,
    isOpenRouter,
    model: options.model || process.env.OPENAI_MODEL || 'gpt-5.4-mini'
  };
}

function providerHeaders({ apiKey, isOpenRouter }) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
  const appReferer = process.env.OPENROUTER_HTTP_REFERER || process.env.PUBLIC_BASE_URL || '';
  const appTitle = process.env.OPENROUTER_TITLE || 'KingCom AI Agent';
  if (isOpenRouter && appReferer) headers['HTTP-Referer'] = String(appReferer);
  if (isOpenRouter && appTitle) {
    headers['X-Title'] = String(appTitle);
    headers['X-OpenRouter-Title'] = String(appTitle);
  }
  return headers;
}

async function chatCompletion({
  messages,
  model,
  temperature = 0.3,
  timeoutMs = 45000,
  maxOutputTokens = 700,
  maxAttempts = 1,
  retryMaxOutputTokens,
  reasoningEffort = 'minimal',
  responseFormat
}) {
  const provider = resolveProviderConfig({ model });
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  let lastEmptyError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const outputTokens = attempt === 1
      ? maxOutputTokens
      : Math.max(Number(retryMaxOutputTokens || 0), maxOutputTokens);
    const requestBody = {
      model: provider.model,
      temperature,
      messages
    };
    requestBody[provider.isOpenRouter ? 'max_tokens' : 'max_completion_tokens'] = outputTokens;
    if (responseFormat) requestBody.response_format = responseFormat;
    if (provider.isOpenRouter) {
      requestBody.reasoning = {
        effort: reasoningEffort,
        exclude: true
      };
    }

    try {
      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: providerHeaders(provider),
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
      if (content) return content;

      lastEmptyError = createEmptyResponseError(data);
      if (attempt < attempts) {
        console.warn(`OpenAI empty response; retrying (${attempt}/${attempts}) (${lastEmptyError.responseDetails})`);
        continue;
      }
      throw lastEmptyError;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`OpenAI timeout after ${timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastEmptyError || new Error('OpenAI returned empty response');
}

module.exports = {
  chatCompletion,
  resolveProviderConfig
};
