import assert from 'node:assert/strict';
import '../src/apiProviders.js';

const { R2AIApiProviders } = globalThis;

assert.ok(R2AIApiProviders, 'R2AIApiProviders should be attached to globalThis');

// =====================
// Request building
// =====================

// Anthropic: key travels in x-api-key, never in the URL or body.
{
  const request = R2AIApiProviders.buildRequest('anthropic', {
    apiKey: 'sk-ant-fake',
    promptText: 'Analyze this thread.'
  });
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['x-api-key'], 'sk-ant-fake');
  assert.equal(request.headers['anthropic-version'], '2023-06-01');
  assert.equal(request.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(request.body.model, 'claude-opus-5', 'default Anthropic model');
  assert.equal(request.body.max_tokens, 8192);
  assert.deepEqual(request.body.messages, [{ role: 'user', content: 'Analyze this thread.' }]);
  assert.ok(!request.url.includes('sk-ant-fake'), 'key must never appear in the URL');
  assert.ok(!JSON.stringify(request.body).includes('sk-ant-fake'), 'key must never appear in the body');
}

// A user-typed model overrides the default, so new model ids work without a release.
{
  const request = R2AIApiProviders.buildRequest('anthropic', {
    apiKey: 'k',
    model: 'claude-sonnet-5',
    promptText: 'hi'
  });
  assert.equal(request.body.model, 'claude-sonnet-5');
}

// OpenAI: bearer auth, max_completion_tokens by default, legacy max_tokens on retry.
{
  const request = R2AIApiProviders.buildRequest('openai', {
    apiKey: 'sk-openai-fake',
    promptText: 'hi'
  });
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(request.headers.authorization, 'Bearer sk-openai-fake');
  assert.equal(request.body.model, 'gpt-5.2', 'default OpenAI model');
  assert.equal(request.body.max_completion_tokens, 8192);
  assert.equal(request.body.max_tokens, undefined);

  const legacy = R2AIApiProviders.buildRequest('openai', {
    apiKey: 'sk-openai-fake',
    promptText: 'hi',
    legacyMaxTokens: true
  });
  assert.equal(legacy.body.max_tokens, 8192);
  assert.equal(legacy.body.max_completion_tokens, undefined);
}

// Gemini: key in x-goog-api-key header (not a query param), model in the path.
{
  const request = R2AIApiProviders.buildRequest('google', {
    apiKey: 'goog-fake',
    promptText: 'hi'
  });
  assert.equal(
    request.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
  );
  assert.equal(request.headers['x-goog-api-key'], 'goog-fake');
  assert.ok(!request.url.includes('goog-fake'), 'key must never be placed in the URL');
  assert.deepEqual(request.body, { contents: [{ parts: [{ text: 'hi' }] }] });

  const pro = R2AIApiProviders.buildRequest('google', {
    apiKey: 'goog-fake',
    model: 'gemini-2.5-pro',
    promptText: 'hi'
  });
  assert.match(pro.url, /models\/gemini-2\.5-pro:generateContent$/);
}

// Guard rails.
{
  assert.throws(() => R2AIApiProviders.buildRequest('nope', { apiKey: 'k', promptText: 'x' }), /Unknown direct API provider/);
  assert.throws(() => R2AIApiProviders.buildRequest('anthropic', { apiKey: '  ', promptText: 'x' }), /No API key/);
  assert.throws(() => R2AIApiProviders.buildRequest('anthropic', { apiKey: 'k', promptText: '   ' }), /Prompt is empty/);
}

// =====================
// Response parsing
// =====================

// Anthropic joins text blocks and skips non-text blocks.
{
  const parsed = R2AIApiProviders.parseResponse('anthropic', {
    stop_reason: 'end_turn',
    content: [
      { type: 'text', text: 'First part. ' },
      { type: 'thinking', thinking: 'ignored' },
      { type: 'text', text: 'Second part.' }
    ]
  });
  assert.equal(parsed.text, 'First part. Second part.');
  assert.equal(parsed.refused, false);
  assert.equal(parsed.truncated, false);
}

// A refusal is detected from stop_reason before content is read.
{
  const parsed = R2AIApiProviders.parseResponse('anthropic', {
    stop_reason: 'refusal',
    content: [{ type: 'text', text: 'should not be surfaced' }]
  });
  assert.equal(parsed.refused, true);
  assert.equal(parsed.text, '');
}

// max_tokens marks the answer as truncated rather than failing it.
{
  const parsed = R2AIApiProviders.parseResponse('anthropic', {
    stop_reason: 'max_tokens',
    content: [{ type: 'text', text: 'cut off here' }]
  });
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.refused, false);
  assert.equal(parsed.text, 'cut off here');
}

// OpenAI choices path.
{
  const parsed = R2AIApiProviders.parseResponse('openai', {
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'OpenAI answer' } }]
  });
  assert.equal(parsed.text, 'OpenAI answer');
  assert.equal(parsed.truncated, false);

  const truncated = R2AIApiProviders.parseResponse('openai', {
    choices: [{ finish_reason: 'length', message: { content: 'partial' } }]
  });
  assert.equal(truncated.truncated, true);
}

// Gemini candidates path, joining multiple parts.
{
  const parsed = R2AIApiProviders.parseResponse('google', {
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ text: 'Gemini ' }, { text: 'answer' }] }
    }]
  });
  assert.equal(parsed.text, 'Gemini answer');
  assert.equal(parsed.truncated, false);

  const blocked = R2AIApiProviders.parseResponse('google', {
    candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }]
  });
  assert.equal(blocked.refused, true);
}

// Malformed / empty payloads degrade to empty text rather than throwing.
{
  for (const provider of ['anthropic', 'openai', 'google']) {
    const parsed = R2AIApiProviders.parseResponse(provider, {});
    assert.equal(parsed.text, '', `${provider} empty payload yields empty text`);
  }
}

// =====================
// Error mapping
// =====================

// 429 surfaces the provider message and is marked retryable.
{
  const mapped = R2AIApiProviders.mapError('anthropic', 429, {
    type: 'error',
    error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit.' }
  });
  assert.equal(mapped.retryable, true, '429 must be retryable');
  assert.equal(mapped.status, 429);
  assert.equal(mapped.type, 'rate_limit_error');
  assert.equal(mapped.message, 'Number of requests has exceeded your rate limit.');
}

// 500 and 529 are retryable; 401 and 400 are not.
{
  assert.equal(R2AIApiProviders.mapError('anthropic', 500, {}).retryable, true);
  assert.equal(R2AIApiProviders.mapError('anthropic', 529, {}).retryable, true);
  assert.equal(R2AIApiProviders.mapError('anthropic', 401, {}).retryable, false);
  assert.equal(R2AIApiProviders.mapError('openai', 400, {}).retryable, false);
}

// An auth failure keeps the provider's own wording.
{
  const mapped = R2AIApiProviders.mapError('openai', 401, {
    error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' }
  });
  assert.equal(mapped.message, 'Incorrect API key provided.');
  assert.equal(mapped.retryable, false);
}

// Gemini nests its message the same way.
{
  const mapped = R2AIApiProviders.mapError('google', 429, {
    error: { code: 429, message: 'Resource has been exhausted.', status: 'RESOURCE_EXHAUSTED' }
  });
  assert.equal(mapped.message, 'Resource has been exhausted.');
  assert.equal(mapped.retryable, true);
}

// A body-less error still produces a usable message.
{
  const mapped = R2AIApiProviders.mapError('anthropic', 502, null);
  assert.match(mapped.message, /Anthropic Claude request failed/);
  assert.equal(mapped.retryable, true);
}

// =====================
// OpenAI max_tokens fallback detection
// =====================
{
  const detects = R2AIApiProviders.isMaxTokensParamError('openai', 400, {
    error: {
      message: "Unsupported parameter: 'max_completion_tokens' is not supported with this model.",
      param: 'max_completion_tokens'
    }
  });
  assert.equal(detects, true);

  assert.equal(R2AIApiProviders.isMaxTokensParamError('openai', 400, { error: { message: 'bad request' } }), false);
  assert.equal(R2AIApiProviders.isMaxTokensParamError('openai', 429, { error: { param: 'max_completion_tokens' } }), false);
  assert.equal(R2AIApiProviders.isMaxTokensParamError('anthropic', 400, { error: { param: 'max_completion_tokens' } }), false);
}

console.log('Direct API provider unit tests passed!');
