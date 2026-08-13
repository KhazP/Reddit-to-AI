// Reddit to AI - Direct API provider definitions.
//
// This file is deliberately free of any chrome.* or fetch usage: it only turns a
// (provider, key, model, prompt) tuple into a plain request description and turns a
// raw JSON response back into `{ text, truncated }`. The service worker owns the
// actual network call, the AbortController and the storage of keys. Keeping the
// pure half separate is what lets the unit tests exercise every provider without
// mocking an extension environment, and it guarantees no key ever reaches a code
// path that logs or persists it here.

(function attachApiProviders(globalObject) {
  'use strict';

  // Free-text model fields are prefilled with these. Providers ship new model IDs far
  // faster than this extension ships releases, so the options page stores whatever the
  // user types rather than constraining them to a hard-coded <select>.
  const PROVIDERS = {
    anthropic: {
      id: 'anthropic',
      label: 'Anthropic Claude',
      defaultModel: 'claude-opus-5',
      suggestedModels: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
      origin: 'https://api.anthropic.com'
    },
    openai: {
      id: 'openai',
      label: 'OpenAI',
      defaultModel: 'gpt-5.2',
      suggestedModels: ['gpt-5.2'],
      origin: 'https://api.openai.com'
    },
    google: {
      id: 'google',
      label: 'Google Gemini',
      defaultModel: 'gemini-2.5-flash',
      suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
      origin: 'https://generativelanguage.googleapis.com'
    }
  };

  const PROVIDER_IDS = Object.keys(PROVIDERS);
  const DEFAULT_MAX_TOKENS = 8192;
  // Reasoning models can think for minutes before the first byte arrives, so the
  // abort budget is deliberately far larger than a normal REST timeout.
  const REQUEST_TIMEOUT_MS = 180000;
  // Retryable statuses: 429 is rate limiting, 5xx/529 are transient upstream faults.
  const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

  function isSupportedProvider(provider) {
    return Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
  }

  function getProvider(provider) {
    if (!isSupportedProvider(provider)) {
      throw new Error(`Unknown direct API provider: ${provider}`);
    }
    return PROVIDERS[provider];
  }

  function resolveModel(provider, model) {
    const trimmed = typeof model === 'string' ? model.trim() : '';
    return trimmed || getProvider(provider).defaultModel;
  }

  /**
   * Builds the raw HTTP request for a provider. Returns a plain object so the caller
   * (and the tests) can inspect the URL, headers and body without a network stack.
   *
   * @param {string} provider one of 'anthropic' | 'openai' | 'google'
   * @param {object} options
   * @param {string} options.apiKey the user's key; only ever placed in a header
   * @param {string} [options.model] free-text model id, falls back to the default
   * @param {string} options.promptText the prompt to send
   * @param {number} [options.maxTokens]
   * @param {boolean} [options.legacyMaxTokens] OpenAI only: use the older
   *        `max_tokens` field instead of `max_completion_tokens`
   */
  function buildRequest(provider, options = {}) {
    const config = getProvider(provider);
    const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
    if (!apiKey) throw new Error(`No API key configured for ${config.label}.`);

    const promptText = typeof options.promptText === 'string' ? options.promptText : '';
    if (!promptText.trim()) throw new Error('Prompt is empty.');

    const model = resolveModel(provider, options.model);
    const maxTokens = Number.isFinite(options.maxTokens) && options.maxTokens > 0
      ? Math.floor(options.maxTokens)
      : DEFAULT_MAX_TOKENS;

    if (provider === 'anthropic') {
      return {
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // Without this header the API rejects browser/extension origins outright.
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: {
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: promptText }]
        }
      };
    }

    if (provider === 'openai') {
      const body = {
        model,
        messages: [{ role: 'user', content: promptText }]
      };
      // Newer models require `max_completion_tokens`; older ones only accept
      // `max_tokens`. The caller retries once with the legacy field when the API
      // complains about the parameter.
      if (options.legacyMaxTokens) {
        body.max_tokens = maxTokens;
      } else {
        body.max_completion_tokens = maxTokens;
      }
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`
        },
        body
      };
    }

    // Google Gemini. The model id is part of the path, so it is encoded rather than
    // interpolated raw: the field is free text typed by the user.
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: {
        contents: [{ parts: [{ text: promptText }] }]
      }
    };
  }

  function parseAnthropicResponse(payload) {
    const stopReason = payload?.stop_reason || null;
    // The refusal stop reason must be checked *before* reading content: on a refusal
    // the content array is not a usable answer.
    if (stopReason === 'refusal') {
      return {
        text: '',
        stopReason,
        refused: true,
        truncated: false
      };
    }
    const blocks = Array.isArray(payload?.content) ? payload.content : [];
    const text = blocks
      .filter(block => block && block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('');
    return {
      text,
      stopReason,
      refused: false,
      truncated: stopReason === 'max_tokens'
    };
  }

  function parseOpenAiResponse(payload) {
    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    const finishReason = choice?.finish_reason || null;
    return {
      text,
      stopReason: finishReason,
      refused: Boolean(choice?.message?.refusal),
      truncated: finishReason === 'length'
    };
  }

  function parseGoogleResponse(payload) {
    const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .filter(part => part && typeof part.text === 'string')
      .map(part => part.text)
      .join('');
    const finishReason = candidate?.finishReason || null;
    return {
      text,
      stopReason: finishReason,
      refused: finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT',
      truncated: finishReason === 'MAX_TOKENS'
    };
  }

  /**
   * Normalises a successful (HTTP 2xx) provider payload into
   * `{ text, stopReason, refused, truncated }`.
   */
  function parseResponse(provider, payload) {
    getProvider(provider);
    if (provider === 'anthropic') return parseAnthropicResponse(payload);
    if (provider === 'openai') return parseOpenAiResponse(payload);
    return parseGoogleResponse(payload);
  }

  function extractErrorMessage(provider, payload) {
    if (!payload || typeof payload !== 'object') return '';
    // All three providers nest the human-readable string under `error.message`,
    // though Anthropic also carries a machine type alongside it.
    if (payload.error && typeof payload.error === 'object') {
      if (typeof payload.error.message === 'string') return payload.error.message;
      if (typeof payload.error.status === 'string') return payload.error.status;
    }
    if (typeof payload.message === 'string') return payload.message;
    return '';
  }

  function extractErrorType(provider, payload) {
    if (!payload || typeof payload !== 'object') return '';
    if (payload.error && typeof payload.error === 'object') {
      if (typeof payload.error.type === 'string') return payload.error.type;
      if (typeof payload.error.code === 'string') return payload.error.code;
    }
    return '';
  }

  /**
   * Maps a failed HTTP response into `{ message, status, type, retryable }`.
   * `retryable` drives the "try again in a moment" wording in the preview page.
   */
  function mapError(provider, status, payload) {
    const config = getProvider(provider);
    const message = extractErrorMessage(provider, payload);
    const type = extractErrorType(provider, payload);
    const numericStatus = Number.isFinite(status) ? status : 0;
    const retryable = RETRYABLE_STATUSES.has(numericStatus);
    return {
      provider,
      status: numericStatus,
      type,
      retryable,
      message: message || `${config.label} request failed with HTTP ${numericStatus || 'error'}.`
    };
  }

  /**
   * True when an OpenAI 400 is specifically complaining about the token-limit
   * parameter name, which is the signal to retry once with the legacy `max_tokens`.
   */
  function isMaxTokensParamError(provider, status, payload) {
    if (provider !== 'openai' || status !== 400) return false;
    const message = extractErrorMessage(provider, payload).toLowerCase();
    const param = typeof payload?.error?.param === 'string' ? payload.error.param.toLowerCase() : '';
    if (param === 'max_completion_tokens') return true;
    return message.includes('max_completion_tokens');
  }

  const api = {
    PROVIDERS,
    PROVIDER_IDS,
    DEFAULT_MAX_TOKENS,
    REQUEST_TIMEOUT_MS,
    RETRYABLE_STATUSES,
    isSupportedProvider,
    getProvider,
    resolveModel,
    buildRequest,
    parseResponse,
    mapError,
    isMaxTokensParamError
  };

  globalObject.R2AIApiProviders = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
