// First-run welcome tab, Retry wiring and error classification in the service worker.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const REDDIT_URL = 'https://www.reddit.com/r/test/comments/1/a';

function createContext() {
  const storage = { local: {}, session: {}, sync: {} };
  const area = (name) => ({
    get(keys, cb) {
      const res = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(k => { res[k] = storage[name][k]; });
      cb(res);
    },
    set(items, cb) { Object.assign(storage[name], items); cb?.(); },
    remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete storage[name][k]); cb?.(); }
  });
  const installedListeners = [];
  const createdTabs = [];
  return {
    installedListeners,
    createdTabs,
    console: { log() {}, debug() {}, warn() {}, error() {} },
    URL,
    URLSearchParams,
    Date,
    crypto: { randomUUID: () => 'scrape-1' },
    importScripts() {},
    fetch: async () => { throw new Error('no network in test'); },
    setTimeout(callback) { return globalThis.setTimeout(callback, 0); },
    clearTimeout() {},
    chrome: {
      i18n: { getMessage: () => '' },
      runtime: {
        lastError: null,
        onInstalled: { addListener(fn) { installedListeners.push(fn); } },
        onStartup: { addListener() {} },
        onMessage: { addListener() {} },
        sendMessage(_message, callback) { callback?.({}); },
        getURL(path) { return `chrome-extension://test/${path}`; }
      },
      tabs: {
        create: async (options) => { createdTabs.push(options); return {}; },
        query: async () => [{ id: 1, url: REDDIT_URL }],
        sendMessage(_tabId, message, callback) {
          callback?.(message.action === 'scrapeReddit' ? { started: true } : {});
        },
        get(_tabId, callback) { callback({ id: 1, url: REDDIT_URL }); },
        update: async () => ({})
      },
      windows: { update: async () => ({}) },
      scripting: { executeScript: async () => {} },
      notifications: { create(_id, _options, callback) { callback?.(); } },
      storage: { local: area('local'), session: area('session'), sync: area('sync') }
    },
    R2AIPrompt: { countComments: () => 1 },
    R2AIServiceWorkerTest: {}
  };
}

async function loadServiceWorker(context) {
  const parserSource = await readFile(new URL('../src/redditParser.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/service_worker.js', import.meta.url), 'utf8');
  vm.runInNewContext(parserSource, context, { filename: 'redditParser.js' });
  vm.runInNewContext(source, context, { filename: 'service_worker.js' });
  return context.R2AIServiceWorkerTest;
}

// 1. The welcome page opens on a fresh install only, never on update.
{
  const context = createContext();
  await loadServiceWorker(context);
  const welcomeOpens = () => context.createdTabs.filter(t => /welcome\.html$/.test(t.url)).length;
  context.installedListeners.forEach(fn => fn({ reason: 'update', previousVersion: '1.0.0' }));
  assert.equal(welcomeOpens(), 0, 'welcome page must not open on update');
  context.installedListeners.forEach(fn => fn({ reason: 'install' }));
  assert.equal(welcomeOpens(), 1, 'welcome page opens on first install');
}

// 2. Errors carry a machine-readable errorType; a "busy" rejection does not
//    overwrite the running scrape's state.
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  api.setScrapingState({ error: 'No custom AI origin is configured. Add one in Options.' });
  assert.equal(api.getScrapingState().errorType, 'config');
  api.setScrapingState({ error: null });
  assert.equal(api.getScrapingState().errorType, null);

  api.setScrapingState({ isActive: true, status: 'running', phase: 'load' });
  const response = await new Promise(resolve => {
    api.handleRuntimeMessage({ action: 'scrapeReddit' }, { tab: { id: 1 } }, resolve);
  });
  assert.equal(response.status, 'error');
  assert.equal(response.errorType, 'busy');
  assert.equal(api.getScrapingState().isActive, true, 'running scrape is left untouched');
  assert.equal(api.getScrapingState().status, 'running');
}

// 3. retryLastScrape re-runs the last request against the panel's tab.
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  await api.ready;
  await api.handleScrapeRequest({ tabId: 1, filters: { minScore: 3 } }, {});
  await api.stopActiveScrape();
  api.setScrapingState({ isActive: false, status: 'error', error: 'Content script error: boom' });

  const response = await new Promise(resolve => {
    api.handleRuntimeMessage({ action: 'retryLastScrape' }, { tab: { id: 1 } }, resolve);
  });
  assert.equal(response.status, 'success', `retry should start a new scrape: ${response.error}`);
  assert.equal(api.getScrapingState().isActive, true);
}

console.log('Service worker onboarding / retry tests passed!');
