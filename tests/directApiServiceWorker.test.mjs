// Exercises the service worker half of Direct API mode: the fetch orchestration,
// the OpenAI max_tokens fallback, error propagation and the history write-back.
// fetch is always a stub — these tests never touch a real provider endpoint.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function createContext({ fetchImpl, localSeed = {} } = {}) {
  const syncStore = new Map();
  const localStore = new Map(Object.entries(localSeed));
  const fetchCalls = [];

  const makeArea = (store) => ({
    get(keys, callback) {
      const result = {};
      if (Array.isArray(keys)) {
        keys.forEach(k => { if (store.has(k)) result[k] = store.get(k); });
      } else if (typeof keys === 'string') {
        if (store.has(keys)) result[keys] = store.get(keys);
      } else {
        Object.keys(keys).forEach(k => result[k] = store.has(k) ? store.get(k) : keys[k]);
      }
      callback(result);
    },
    set(items, callback) {
      Object.entries(items).forEach(([k, v]) => store.set(k, v));
      callback?.();
    },
    remove(keys, callback) {
      (Array.isArray(keys) ? keys : [keys]).forEach(k => store.delete(k));
      callback?.();
    }
  });

  const context = {
    console: { log() {}, error() {}, debug() {}, warn() {} },
    Date,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    JSON,
    Math,
    Number,
    Object,
    Array,
    Set,
    Map,
    Promise,
    Error,
    String,
    Boolean,
    importScripts() {},
    async fetch(url, init) {
      fetchCalls.push({ url, init });
      return fetchImpl(url, init, fetchCalls.length);
    },
    chrome: {
      i18n: { getMessage: () => '' },
      runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener() {} }
      },
      storage: {
        sync: makeArea(syncStore),
        local: makeArea(localStore),
        session: makeArea(new Map())
      },
      scripting: {
        async registerContentScripts() {},
        async unregisterContentScripts() {}
      }
    },
    getFetchCalls() { return fetchCalls; },
    getLocalStore() { return localStore; },
    R2AIServiceWorkerTest: {}
  };
  context.globalThis = context;
  return context;
}

async function loadServiceWorker(context) {
  const providersSource = await readFile(new URL('../src/apiProviders.js', import.meta.url), 'utf8');
  const parserSource = await readFile(new URL('../src/redditParser.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/service_worker.js', import.meta.url), 'utf8');
  vm.runInNewContext(providersSource, context, { filename: 'apiProviders.js' });
  vm.runInNewContext(parserSource, context, { filename: 'redditParser.js' });
  vm.runInNewContext(source, context, { filename: 'service_worker.js' });
  return context.R2AIServiceWorkerTest;
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

// 1. Anthropic happy path: key read from storage.local, text blocks joined.
{
  const context = createContext({
    localSeed: {
      directApiConfig: { anthropic: { apiKey: 'sk-ant-stored', model: 'claude-sonnet-5' } }
    },
    fetchImpl: () => jsonResponse(200, {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }]
    })
  });
  const api = await loadServiceWorker(context);

  const result = await api.callDirectApi('anthropic', 'Summarize this.');
  assert.equal(result.text, 'Hello world');
  assert.equal(result.model, 'claude-sonnet-5', 'stored model overrides the default');
  assert.equal(result.refused, false);
  assert.equal(result.truncated, false);

  const [call] = context.getFetchCalls();
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.init.headers['x-api-key'], 'sk-ant-stored');
  assert.equal(call.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(call.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.ok(call.init.signal, 'an AbortController signal must be attached');
  const body = JSON.parse(call.init.body);
  assert.equal(body.messages[0].content, 'Summarize this.');
  assert.equal(body.max_tokens, 8192);
}

// 2. A missing key fails before any network call is attempted.
{
  const context = createContext({
    fetchImpl: () => { throw new Error('fetch must not be called'); }
  });
  const api = await loadServiceWorker(context);
  await assert.rejects(() => api.callDirectApi('anthropic', 'hi'), /No API key is configured/);
  assert.equal(context.getFetchCalls().length, 0);
}

// 3. Anthropic refusal surfaces as refused rather than as text.
{
  const context = createContext({
    localSeed: { directApiConfig: { anthropic: { apiKey: 'k' } } },
    fetchImpl: () => jsonResponse(200, {
      stop_reason: 'refusal',
      content: [{ type: 'text', text: 'leaked' }]
    })
  });
  const api = await loadServiceWorker(context);
  const result = await api.callDirectApi('anthropic', 'hi');
  assert.equal(result.refused, true);
  assert.equal(result.text, '');
}

// 4. A 429 propagates the provider message and is flagged retryable.
{
  const context = createContext({
    localSeed: { directApiConfig: { anthropic: { apiKey: 'k' } } },
    fetchImpl: () => jsonResponse(429, {
      type: 'error',
      error: { type: 'rate_limit_error', message: 'Slow down.' }
    })
  });
  const api = await loadServiceWorker(context);
  await assert.rejects(
    () => api.callDirectApi('anthropic', 'hi'),
    (error) => {
      assert.equal(error.message, 'Slow down.');
      assert.equal(error.retryable, true);
      assert.equal(error.status, 429);
      return true;
    }
  );
}

// 5. A 401 is not retryable.
{
  const context = createContext({
    localSeed: { directApiConfig: { openai: { apiKey: 'k' } } },
    fetchImpl: () => jsonResponse(401, { error: { message: 'Bad key.' } })
  });
  const api = await loadServiceWorker(context);
  await assert.rejects(
    () => api.callDirectApi('openai', 'hi'),
    (error) => {
      assert.equal(error.retryable, false);
      return true;
    }
  );
}

// 6. OpenAI retries once with the legacy max_tokens field, then succeeds.
{
  const context = createContext({
    localSeed: { directApiConfig: { openai: { apiKey: 'sk-openai' } } },
    fetchImpl: (url, init, callNumber) => {
      if (callNumber === 1) {
        return jsonResponse(400, {
          error: {
            message: "Unsupported parameter: 'max_completion_tokens'.",
            param: 'max_completion_tokens'
          }
        });
      }
      return jsonResponse(200, {
        choices: [{ finish_reason: 'stop', message: { content: 'Second try worked' } }]
      });
    }
  });
  const api = await loadServiceWorker(context);
  const result = await api.callDirectApi('openai', 'hi');
  assert.equal(result.text, 'Second try worked');

  const calls = context.getFetchCalls();
  assert.equal(calls.length, 2, 'exactly one retry');
  const first = JSON.parse(calls[0].init.body);
  const second = JSON.parse(calls[1].init.body);
  assert.equal(first.max_completion_tokens, 8192);
  assert.equal(first.max_tokens, undefined);
  assert.equal(second.max_tokens, 8192);
  assert.equal(second.max_completion_tokens, undefined);
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-openai');
}

// 7. A plain 400 is NOT retried.
{
  const context = createContext({
    localSeed: { directApiConfig: { openai: { apiKey: 'k' } } },
    fetchImpl: () => jsonResponse(400, { error: { message: 'Context length exceeded.' } })
  });
  const api = await loadServiceWorker(context);
  await assert.rejects(() => api.callDirectApi('openai', 'hi'), /Context length exceeded/);
  assert.equal(context.getFetchCalls().length, 1, 'a non-parameter 400 must not be retried');
}

// 8. Gemini: key in header, model in path, candidate parts joined.
{
  const context = createContext({
    localSeed: { directApiConfig: { google: { apiKey: 'goog-key', model: 'gemini-2.5-pro' } } },
    fetchImpl: () => jsonResponse(200, {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Gem' }, { text: 'ini' }] } }]
    })
  });
  const api = await loadServiceWorker(context);
  const result = await api.callDirectApi('google', 'hi');
  assert.equal(result.text, 'Gemini');

  const [call] = context.getFetchCalls();
  assert.equal(
    call.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent'
  );
  assert.equal(call.init.headers['x-goog-api-key'], 'goog-key');
  assert.ok(!call.url.includes('goog-key'), 'the key must never reach the URL');
}

// 9. A network failure is wrapped without echoing the request (which holds the key).
{
  const context = createContext({
    localSeed: { directApiConfig: { anthropic: { apiKey: 'super-secret-key' } } },
    fetchImpl: () => { throw new Error('Failed to fetch'); }
  });
  const api = await loadServiceWorker(context);
  await assert.rejects(
    () => api.callDirectApi('anthropic', 'hi'),
    (error) => {
      assert.match(error.message, /Could not reach the AI provider/);
      assert.ok(!error.message.includes('super-secret-key'), 'errors must never leak the key');
      return true;
    }
  );
}

// 10. getDirectApiStatus reports configuration without ever returning a key.
{
  const context = createContext({
    localSeed: {
      directApiConfig: {
        anthropic: { apiKey: 'secret-anthropic-key' },
        google: { apiKey: '   ' }
      }
    },
    fetchImpl: () => jsonResponse(200, {})
  });
  const api = await loadServiceWorker(context);
  const status = await api.getDirectApiStatus();

  assert.equal(status.providers.anthropic.configured, true);
  assert.equal(status.providers.openai.configured, false);
  assert.equal(status.providers.google.configured, false, 'a whitespace-only key is not configured');
  assert.equal(status.providers.anthropic.model, 'claude-opus-5', 'falls back to the default model');

  const serialized = JSON.stringify(status);
  assert.ok(!serialized.includes('secret-anthropic-key'), 'status must never carry the key to a page');
  assert.ok(!/apiKey/i.test(serialized), 'status must not expose an apiKey field');
}

// 11. sendPromptViaApi writes the response onto the linked history entry.
{
  const context = createContext({
    localSeed: {
      directApiConfig: { anthropic: { apiKey: 'k' } },
      scrapeHistory: [{ id: 'hist-1', post: { title: 'A thread' } }]
    },
    fetchImpl: () => jsonResponse(200, {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'The summary.' }]
    })
  });
  const api = await loadServiceWorker(context);

  const result = await api.sendPromptViaApi({
    apiProvider: 'anthropic',
    promptText: 'Summarize.',
    historyId: 'hist-1'
  });
  assert.equal(result.success, true);
  assert.equal(result.response.text, 'The summary.');

  const history = context.getLocalStore().get('scrapeHistory');
  const entry = history.find(item => item.id === 'hist-1');
  assert.ok(entry.apiResponse, 'the history entry gains an apiResponse field');
  assert.equal(entry.apiResponse.text, 'The summary.');
  assert.equal(entry.apiResponse.provider, 'anthropic');
  assert.equal(entry.apiResponse.model, 'claude-opus-5');
  assert.ok(!JSON.stringify(entry).includes('"apiKey"'), 'history must never store a key');
}

// 12. With history saving off there is no historyId, and the send still succeeds.
{
  const context = createContext({
    localSeed: { directApiConfig: { anthropic: { apiKey: 'k' } } },
    fetchImpl: () => jsonResponse(200, {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }]
    })
  });
  const api = await loadServiceWorker(context);
  const result = await api.sendPromptViaApi({ apiProvider: 'anthropic', promptText: 'hi' });
  assert.equal(result.success, true);
  assert.equal(context.getLocalStore().get('scrapeHistory'), undefined);
}

// 13. testDirectApiKey uses the supplied key and a minimal token budget.
{
  const context = createContext({
    fetchImpl: () => jsonResponse(200, {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'OK' }]
    })
  });
  const api = await loadServiceWorker(context);
  const result = await api.testDirectApiKey({
    apiProvider: 'anthropic',
    apiKey: 'typed-in-options',
    model: 'claude-haiku-4-5'
  });
  assert.equal(result.success, true);
  assert.equal(result.model, 'claude-haiku-4-5');

  const [call] = context.getFetchCalls();
  const body = JSON.parse(call.init.body);
  assert.equal(body.max_tokens, 16, 'the test request stays tiny');
  assert.equal(body.messages[0].content, 'Say OK');
  assert.equal(call.init.headers['x-api-key'], 'typed-in-options');
}

// 14. An unknown provider is rejected.
{
  const context = createContext({ fetchImpl: () => jsonResponse(200, {}) });
  const api = await loadServiceWorker(context);
  await assert.rejects(() => api.callDirectApi('bogus', 'hi'), /Unknown direct API provider/);
}

console.log('Direct API service worker tests passed!');
