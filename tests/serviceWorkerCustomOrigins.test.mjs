import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function createContext() {
  const syncStore = new Map();
  const registeredScripts = [];
  const unregisteredScripts = [];
  let onMessageListener = null;

  return {
    console: {
      log() {},
      error() {},
      debug() {}
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
        onMessage: {
          addListener(listener) {
            onMessageListener = listener;
          }
        }
      },
      storage: {
        sync: {
          get(keys, callback) {
            const result = {};
            if (Array.isArray(keys)) {
              keys.forEach(k => result[k] = syncStore.get(k));
            } else if (typeof keys === 'string') {
              result[keys] = syncStore.get(keys);
            } else {
              Object.keys(keys).forEach(k => result[k] = syncStore.has(k) ? syncStore.get(k) : keys[k]);
            }
            callback(result);
          },
          set(items, callback) {
            Object.entries(items).forEach(([k, v]) => syncStore.set(k, v));
            callback?.();
          }
        },
        local: {
          get(keys, callback) {
            callback({});
          },
          set(items, callback) {
            callback?.();
          }
        }
      },
      scripting: {
        async registerContentScripts(scripts) {
          registeredScripts.push(...scripts);
        },
        async unregisterContentScripts(filter) {
          unregisteredScripts.push(filter);
        }
      }
    },
    getRegisteredScripts() { return registeredScripts; },
    getUnregisteredScripts() { return unregisteredScripts; },
    getOnMessageListener() { return onMessageListener; },
    getSyncStore() { return syncStore; },
    R2AIServiceWorkerTest: {}
  };
}

async function loadServiceWorker(context) {
  const source = await readFile(new URL('../src/service_worker.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context, { filename: 'service_worker.js' });
  return context.R2AIServiceWorkerTest;
}

// 1. Test getScriptIdForOrigin
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  assert.ok(api.getScriptIdForOrigin);
  const id = api.getScriptIdForOrigin('http://localhost:3000/*');
  assert.equal(id, 'ai-paster-http---localhost-3000--');
}

// 2. Test getAiUrl
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  assert.equal(await api.getAiUrl('deepseek'), 'https://chat.deepseek.com/');
  assert.equal(await api.getAiUrl('groq'), 'https://groq.com/');

  // custom empty storage
  assert.equal(await api.getAiUrl('custom'), 'http://localhost:3000/');

  // custom with storage match ending with /*
  context.getSyncStore().set('customOrigins', ['http://localhost:8080/*']);
  assert.equal(await api.getAiUrl('custom'), 'http://localhost:8080');

  // custom with storage match ending with *
  context.getSyncStore().set('customOrigins', ['http://localhost:9000*']);
  assert.equal(await api.getAiUrl('custom'), 'http://localhost:9000');
}

// 3. Test registerCustomOriginScript / unregisterCustomOriginScript
{
  const context = createContext();
  const api = await loadServiceWorker(context);

  await api.registerCustomOriginScript('http://localhost:1234/*');
  const reg = context.getRegisteredScripts();
  assert.equal(reg.length, 1);
  assert.equal(reg[0].matches[0], 'http://localhost:1234/*');
  assert.equal(reg[0].js.length, 4);
  assert.equal(reg[0].js[0], 'i18n.js');
  assert.equal(reg[0].js[1], 'cl100k_base.js');
  assert.equal(reg[0].js[2], 'promptBuilder.js');
  assert.equal(reg[0].js[3], 'aiPaster.js');

  await api.unregisterCustomOriginScript('http://localhost:1234/*');
  const unreg = context.getUnregisteredScripts();
  assert.equal(unreg.length, 2); // 1 from within register (to ensure no duplicate), 1 from unregister call
  assert.equal(unreg[1].ids.length, 1);
  assert.equal(unreg[1].ids[0], 'ai-paster-http---localhost-1234--');
}

// 4. Test onMessage runtime listener for register/unregisterCustomOrigin
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  const listener = context.getOnMessageListener();
  assert.ok(listener, 'onMessage listener should be registered');

  // Trigger register message
  let responseVal = null;
  const sendResponse = (val) => { responseVal = val; };
  const handled = listener({ action: 'registerCustomOrigin', origin: 'http://localhost:9999/*' }, {}, sendResponse);
  assert.ok(handled, 'Message handler should return true to indicate async response');

  // Wait a microtask for the async register action to complete
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(responseVal.status, 'success');
  const reg = context.getRegisteredScripts();
  assert.equal(reg[reg.length - 1].matches[0], 'http://localhost:9999/*');

  // Trigger unregister message
  responseVal = null;
  const handled2 = listener({ action: 'unregisterCustomOrigin', origin: 'http://localhost:9999/*' }, {}, sendResponse);
  assert.ok(handled2, 'Message handler should return true');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(responseVal.status, 'success');
  const unreg = context.getUnregisteredScripts();
  assert.equal(unreg[unreg.length - 1].ids.length, 1);
  assert.equal(unreg[unreg.length - 1].ids[0], 'ai-paster-http---localhost-9999--');
}

// 5. Test registerAllCustomOrigins on startup/install
{
  const context = createContext();
  context.getSyncStore().set('customOrigins', ['http://localhost:7000/*', 'https://my-local-ui.com/*']);
  const api = await loadServiceWorker(context);
  
  await api.registerAllCustomOrigins();
  const reg = context.getRegisteredScripts();
  assert.equal(reg.length, 2);
  assert.equal(reg[0].matches[0], 'http://localhost:7000/*');
  assert.equal(reg[1].matches[0], 'https://my-local-ui.com/*');
}

console.log('Background custom origins unit tests passed!');
