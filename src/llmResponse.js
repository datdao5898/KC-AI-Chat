function textFromContentPart(part) {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return '';
  if (typeof part.text === 'string') return part.text;
  if (typeof part.text?.value === 'string') return part.text.value;
  if (typeof part.content === 'string') return part.content;
  if (typeof part.output_text === 'string') return part.output_text;
  return '';
}

function textFromContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.map(textFromContentPart).filter(Boolean).join('\n').trim();
}

function extractAssistantText(data) {
  const choice = data?.choices?.[0];
  const messageText = textFromContent(choice?.message?.content);
  if (messageText) return messageText;

  const choiceText = textFromContent(choice?.text);
  if (choiceText) return choiceText;

  const outputText = textFromContent(data?.output_text);
  if (outputText) return outputText;

  if (Array.isArray(data?.output)) {
    const responseText = data.output
      .flatMap(item => Array.isArray(item?.content) ? item.content : [item])
      .map(textFromContentPart)
      .filter(Boolean)
      .join('\n')
      .trim();
    if (responseText) return responseText;
  }

  return '';
}

function emptyResponseDetails(data) {
  const choice = data?.choices?.[0] || {};
  const usage = data?.usage || {};
  const completionDetails = usage.completion_tokens_details || {};
  const choiceError = choice?.error?.message || choice?.error || '';
  const details = [
    `finish_reason=${choice.finish_reason || 'unknown'}`,
    `native_finish_reason=${choice.native_finish_reason || 'unknown'}`,
    `completion_tokens=${usage.completion_tokens ?? 'unknown'}`,
    `reasoning_tokens=${completionDetails.reasoning_tokens ?? 'unknown'}`
  ];
  if (choiceError) details.push(`choice_error=${String(choiceError).slice(0, 160)}`);
  return details.join(', ');
}

function createEmptyResponseError(data, providerName = 'OpenAI') {
  const error = new Error(`${providerName} returned empty response (${emptyResponseDetails(data)})`);
  error.code = 'EMPTY_LLM_RESPONSE';
  error.responseDetails = emptyResponseDetails(data);
  return error;
}

module.exports = {
  createEmptyResponseError,
  emptyResponseDetails,
  extractAssistantText,
  textFromContent
};
