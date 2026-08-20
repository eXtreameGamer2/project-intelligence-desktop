/**
 * OpenAI-compatible helpers for self-hosted servers:
 * LM Studio, Ollama, llama.cpp, vLLM, LocalAI, Open WebUI, LiteLLM, and similar.
 */

export function normalizeOpenAiCompatibleBase(baseUrl) {
  let value = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!value) return value;
  if (/\/chat\/completions$/i.test(value)) {
    value = value.replace(/\/chat\/completions$/i, '');
  }
  if (/\/api$/i.test(value)) {
    value = `${value.replace(/\/api$/i, '')}/v1`;
  }
  if (!/\/v\d+(\/|$)/i.test(value)) {
    value = `${value}/v1`;
  }
  return value;
}

export function nextThinkingCompat(mode) {
  if (mode === 'core') return 'ollama';
  if (mode === 'ollama' || mode === 'none') return 'none';
  return 'core';
}

export function applyThinkingOff(body, mode = 'broad') {
  if (!body || mode === 'none') return;
  body.think = false;
  if (mode === 'ollama') return;

  body.enable_thinking = false;
  body.chat_template_kwargs = { ...(body.chat_template_kwargs || {}), enable_thinking: false };
  if (mode === 'core') return;

  body.reasoning_effort = 'none';
  body.reasoning = { ...(body.reasoning || {}), effort: 'none', enabled: false };
  body.enable_reasoning = false;
  body.reasoning_budget = 0;
}

export function applyThinkingOn(body) {
  if (!body) return;
  body.think = true;
  body.enable_thinking = true;
  body.chat_template_kwargs = { ...(body.chat_template_kwargs || {}), enable_thinking: true };
  body.reasoning_effort = 'medium';
  body.reasoning = { ...(body.reasoning || {}), effort: 'medium' };
}

export function isThinkingParamError(message) {
  return /reasoning_effort|enable_thinking|chat_template_kwargs|enable_reasoning|reasoning_budget|unknown (field|parameter)|unrecognized|extra_forbidden|unexpected keyword|not a valid|additional properties|(?:unknown|invalid|unrecognized|extra).{0,40}\bthink\b/i.test(
    String(message || '')
  );
}

export function usesNoThinkPrompt(model) {
  return /\b(qwen|deepseek|gemma|gpt-oss|magistral|hunyuan|seed)\b/i.test(String(model || ''));
}

export function withNoThink(text) {
  const value = String(text || '');
  if (/(^|\s)\/no_think\b/i.test(value)) return value;
  return value.trim() ? `${value}\n/no_think` : '/no_think';
}

export function collectProviderReasoning(message = {}, choice = {}, payload = {}) {
  return (
    message.reasoning_content ||
    message.reasoning ||
    message.thinking ||
    choice.reasoning ||
    choice.thinking ||
    payload.thinking ||
    ''
  );
}
