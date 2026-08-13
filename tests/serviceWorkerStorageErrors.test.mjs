import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function makeArea(store, { failOnSet = null } = {}) {
  return {
    store,
    get(keys, callback) {
      const result = {};
      const list = Array.isArray(keys) ? keys : [keys];
      list.forEach(k => { if (store.has(k)) result[k] = store.get(k); });
      callback(result);
    },
    set(items, callback) {
      if (failOnSet) {
        context.chrome.runtime.lastError = { message: failOnSet };
        callback();
        context.chrome.runtime.lastError = null;
        return;
      }
      Object.entries(items).forEach(([k, v]) => store.set(k, v));
      callback();
    },
    remove(keys, callback) {
      (Array.isArray(keys) ? keys : [keys]).forEach(k => store.delete(k));
      callback();
    }
  };
}

let context;

function createContext() {
  const localStore = new Map();
  const sessionStore = new Map();
  context = {
    console: { log() {}, debug() {}, warn() {}, error() {} },
    Date,
    URL,
    URLSearchParams,
    crypto: globalThis.crypto,
    importScripts() {},
    fetch: async () => { throw new Error('no network in test'); },
    chrome: {
      i18n: { getMessage: () => '' },
      runtime: {
        lastError: null,
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener() {} }
      },
      storage: {}
    },
    R2AIServiceWorkerTest: {}
  };
  context.chrome.storage.local = makeArea(localStore);
  context.chrome.storage.session = makeArea(sessionStore, { failOnSet: 'QUOTA_BYTES quota exceeded' });
  context.localStore = localStore;
  context.sessionStore = sessionStore;
  return context;
}

async function loadServiceWorker(ctx) {
  const source = await readFile(new URL('../src/service_worker.js', import.meta.url), 'utf8');
  const parserSource = await readFile(new URL('../src/redditParser.js', import.meta.url), 'utf8');
  vm.runInNewContext(parserSource, ctx, { filename: 'redditParser.js' });
  vm.runInNewContext(source, ctx, { filename: 'service_worker.js' });
  return ctx.R2AIServiceWorkerTest;
}

// setStorage rejects when chrome.runtime.lastError is set.
{
  const ctx = createContext();
  const api = await loadServiceWorker(ctx);
  await assert.rejects(
    () => api.setStorage(ctx.chrome.storage.session, { foo: 'bar' }),
    /QUOTA_BYTES quota exceeded/
  );
}

// setStorage resolves normally when there is no lastError.
{
  const ctx = createContext();
  const api = await loadServiceWorker(ctx);
  await api.setStorage(ctx.chrome.storage.local, { foo: 'bar' });
  assert.equal(ctx.localStore.get('foo'), 'bar');
  const read = await api.getStorage(ctx.chrome.storage.local, 'foo');
  assert.equal(read.foo, 'bar');
}

// savePreviewData falls back to chrome.storage.local when the session write fails.
{
  const ctx = createContext();
  const api = await loadServiceWorker(ctx);
  const data = { post: { title: 'hello' }, comments: [] };
  const payload = await api.savePreviewData(data, { dataStorageOption: 'session' });
  assert.ok(payload.handoffId);
  assert.equal(ctx.sessionStore.size, 0, 'session write should have failed');
  const stored = [...ctx.localStore.values()].find(v => v && v.data);
  assert.ok(stored, 'preview payload should be present in local storage');
  assert.deepEqual(stored.data, data);
}

console.log('Service worker storage error tests passed!');
