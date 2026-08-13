import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function createContext() {
  const localStore = new Map();
  let fetchCalled = false;
  let fetchUrl = '';
  let fetchError = null;
  let fetchResponse = null;

  return {
    console: {
      log() {},
      debug() {},
      warn() {},
      error() {}
    },
    Date,
    URL,
    URLSearchParams,
    importScripts() {},
    chrome: {
      i18n: { getMessage: () => '' },
      runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener() {} }
      },
      storage: {
        local: {
          get(keys, callback) {
            const result = {};
            if (Array.isArray(keys)) {
              keys.forEach(k => result[k] = localStore.get(k));
            } else if (typeof keys === 'string') {
              result[keys] = localStore.get(keys);
            } else {
              Object.keys(keys).forEach(k => result[k] = localStore.has(k) ? localStore.get(k) : keys[k]);
            }
            callback(result);
          },
          set(items, callback) {
            Object.entries(items).forEach(([k, v]) => localStore.set(k, v));
            callback?.();
          }
        }
      }
    },
    fetch: async (url) => {
      fetchCalled = true;
      fetchUrl = url;
      if (fetchError) throw fetchError;
      return {
        ok: fetchResponse !== null,
        status: fetchResponse ? 200 : 500,
        json: async () => fetchResponse
      };
    },
    setMockFetchResponse(resp) { fetchResponse = resp; },
    setMockFetchError(err) { fetchError = err; },
    getFetchCalled() { return fetchCalled; },
    getFetchUrl() { return fetchUrl; },
    getLocalStore() { return localStore; },
    R2AIServiceWorkerTest: {}
  };
}

async function loadServiceWorker(context) {
  const source = await readFile(new URL('../src/service_worker.js', import.meta.url), 'utf8');
  const parserSource = await readFile(new URL('../src/redditParser.js', import.meta.url), 'utf8');
  vm.runInNewContext(parserSource, context, { filename: 'redditParser.js' });
  vm.runInNewContext(source, context, { filename: 'service_worker.js' });
  return context.R2AIServiceWorkerTest;
}

// Test successful sync
{
  const context = createContext();
  context.setMockFetchResponse({
    gemini: { inputSelector: '.custom-gemini-selector' }
  });
  const api = await loadServiceWorker(context);
  assert.ok(api.syncSelectors, 'syncSelectors should be exported for tests');
  
  await api.syncSelectors();
  assert.ok(context.getFetchCalled());
  assert.equal(context.getFetchUrl(), 'https://raw.githubusercontent.com/KhazP/Reddit-to-AI/main/selectors.json');
  // Sanitized objects are created inside the vm realm, so compare structurally.
  assert.equal(
    JSON.stringify(context.getLocalStore().get('syncedSelectors')),
    JSON.stringify({ gemini: { inputSelector: '.custom-gemini-selector' } })
  );
  assert.ok(context.getLocalStore().get('lastSelectorSyncTime') > 0);
}

// Validation: unknown platforms, bad types and metadata keys are rejected
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  const clean = api.sanitizeSyncedSelectors({
    version: 1,
    gemini: { inputSelector: '.g', isContentEditable: true },
    chatgpt: { inputSelector: 42, isContentEditable: 'yes' },
    claude: 'div.claude-input',
    evilPlatform: { inputSelector: '.nope' },
    groq: { inputSelector: '   ' },
    deepseek: ['not', 'an', 'object']
  });
  assert.equal(
    JSON.stringify(clean),
    JSON.stringify({
      gemini: { inputSelector: '.g', isContentEditable: true },
      claude: 'div.claude-input'
    })
  );
  assert.equal(api.sanitizeSyncedSelectors({ version: 1 }), null);
  assert.equal(api.sanitizeSyncedSelectors(['a']), null);
  assert.equal(api.sanitizeSyncedSelectors(null), null);
}

// Invalid remote payload is not stored
{
  const context = createContext();
  context.setMockFetchResponse({ notAPlatform: { inputSelector: '.x' } });
  const api = await loadServiceWorker(context);
  await api.syncSelectors();
  assert.equal(context.getLocalStore().get('syncedSelectors'), undefined);
}

// Test error path sync
{
  const context = createContext();
  context.setMockFetchError(new Error('Network Offline'));
  const api = await loadServiceWorker(context);
  
  // Should not throw
  await api.syncSelectors();
  assert.ok(context.getFetchCalled());
  assert.equal(context.getLocalStore().get('syncedSelectors'), undefined);
}

// Test checkAndSyncSelectors logic
{
  const context = createContext();
  context.setMockFetchResponse({ chatgpt: { inputSelector: 'test' } });
  const api = await loadServiceWorker(context);
  
  // Case A: missing timestamp -> triggers sync
  await api.checkAndSyncSelectors();
  assert.ok(context.getFetchCalled());
  
  // Reset
  const oldTime = Date.now() - 25 * 60 * 60 * 1000;
  context.getLocalStore().set('lastSelectorSyncTime', oldTime);
  context.getLocalStore().delete('syncedSelectors');
  
  // Case B: older than 24h -> triggers sync
  await api.checkAndSyncSelectors();
  assert.ok(context.getLocalStore().get('syncedSelectors') !== undefined);
}

console.log('Background selector sync unit tests passed!');
