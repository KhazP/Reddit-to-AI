// Covers the MV3 lifetime handling for single-thread scrapes: the request/ack +
// scrapeComplete protocol, scraping-state persistence into storage.session, and
// the ready-gate that keeps the activeBatch auto-resume from racing messages.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const REDDIT_URL = 'https://www.reddit.com/r/test/comments/1/a';

function createContext({ seed = {}, ackResponse = { started: true } } = {}) {
  const storage = {
    local: { ...(seed.local || {}) },
    session: { ...(seed.session || {}) },
    sync: { ...(seed.sync || {}) }
  };

  const createStorageArea = (areaName) => ({
    get(keys, callback) {
      const res = {};
      if (typeof keys === 'string') {
        res[keys] = storage[areaName][keys];
      } else if (Array.isArray(keys)) {
        keys.forEach(k => { res[k] = storage[areaName][k]; });
      } else if (keys && typeof keys === 'object') {
        Object.keys(keys).forEach(k => {
          res[k] = storage[areaName][k] !== undefined ? storage[areaName][k] : keys[k];
        });
      } else {
        Object.assign(res, storage[areaName]);
      }
      callback(res);
    },
    set(items, callback) {
      Object.assign(storage[areaName], items);
      callback?.();
    },
    remove(keys, callback) {
      (Array.isArray(keys) ? keys : [keys]).forEach(k => { delete storage[areaName][k]; });
      callback?.();
    }
  });

  const tabMessages = [];
  const createdTabs = [];
  const injectedFiles = [];

  return {
    console: { log() {}, debug() {}, warn() {}, error() {} },
    URL,
    URLSearchParams,
    Date,
    crypto: { randomUUID: () => 'scrape-1' },
    importScripts() {},
    fetch: async () => { throw new Error('no network in test'); },
    setTimeout(callback) { return globalThis.setTimeout(callback, 0); },
    tabMessages,
    createdTabs,
    injectedFiles,
    rawStorage: storage,
    chrome: {
      i18n: { getMessage: () => '' },
      runtime: {
        lastError: null,
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener() {} },
        sendMessage(_message, callback) { callback?.({}); },
        getURL(path) { return `chrome-extension://test/${path}`; }
      },
      tabs: {
        create: async (options) => { createdTabs.push(options); return {}; },
        query: async () => [{ id: 1, url: REDDIT_URL }],
        sendMessage(_tabId, message, callback) {
          tabMessages.push(message);
          callback?.(message.action === 'scrapeReddit' ? ackResponse : {});
        },
        get(_tabId, callback) { callback({ id: 1, url: REDDIT_URL }); },
        update: async () => ({})
      },
      windows: { update: async () => ({}) },
      scripting: {
        executeScript: async ({ files }) => { injectedFiles.push(...files); }
      },
      notifications: { create(_id, _options, callback) { callback?.(); } },
      storage: {
        local: createStorageArea('local'),
        session: createStorageArea('session'),
        sync: createStorageArea('sync')
      }
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

const scrapedData = {
  post: { title: 'Hello', author: 'op', subreddit: 'test' },
  comments: [{ id: 't1_a', parentId: 't3_1', author: 'user', text: 'hi', score: 1, replies: [] }]
};

// 1. The scrape request resolves as soon as the tab acknowledges, and the handoff
//    context is persisted so a restarted worker can finish the job.
{
  const context = createContext();
  const api = await loadServiceWorker(context);

  const result = await api.handleScrapeRequest({ tabId: 1, filters: {} }, {});
  assert.equal(result.started, true, 'request resolves on the start acknowledgement');
  assert.ok(result.scrapeId, 'a scrape id is handed back');

  const stored = context.rawStorage.session[api.SCRAPE_CONTEXT_KEY];
  assert.ok(stored, 'scrape context is persisted to storage.session');
  assert.equal(stored.scrapeId, result.scrapeId);
  assert.equal(stored.tabId, 1);
  assert.ok(stored.settings, 'settings snapshot travels with the context');

  const request = context.tabMessages.find(message => message.action === 'scrapeReddit');
  assert.equal(request.scrapeId, result.scrapeId, 'the scrape id is sent to the content script');

  // State is still active: no result has arrived yet.
  assert.equal(api.getScrapingState().isActive, true);
  assert.ok(context.rawStorage.session[api.SCRAPING_STATE_KEY], 'scraping state is mirrored to storage.session');

  // The pipeline resumes when the content script reports back.
  await api.finishTabScrape(result.scrapeId, { data: scrapedData });

  assert.equal(api.getScrapingState().isActive, false);
  assert.equal(api.getScrapingState().percentage, 100);
  assert.ok(context.rawStorage.local.redditPreviewData, 'preview data was saved');
  assert.equal(context.rawStorage.local.scrapeHistory.length, 1, 'history entry was written');
  assert.equal(context.createdTabs.length, 1);
  assert.equal(context.createdTabs[0].url, 'chrome-extension://test/preview.html', 'the preview tab was opened');
  assert.equal(context.rawStorage.session[api.SCRAPE_CONTEXT_KEY], undefined, 'context is cleared when done');
}

// 2. A completion for an unknown or superseded scrape is ignored rather than
//    clobbering whatever is running now.
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  await api.handleScrapeRequest({ tabId: 1, filters: {} }, {});

  const outcome = await api.finishTabScrape('some-other-scrape', { data: scrapedData });
  assert.equal(outcome.ignored, true);
  assert.equal(api.getScrapingState().isActive, true, 'the live scrape is untouched');
  assert.ok(context.rawStorage.session[api.SCRAPE_CONTEXT_KEY], 'context survives the stray message');
}

// 3. Cold start: a worker that never saw the request still restores the state and
//    finishes the scrape from the persisted context.
{
  const priming = createContext();
  const primingApi = await loadServiceWorker(priming);
  await primingApi.handleScrapeRequest({ tabId: 1, filters: {} }, {});
  const persistedSession = { ...priming.rawStorage.session };
  const scrapeId = persistedSession[primingApi.SCRAPE_CONTEXT_KEY].scrapeId;

  // A brand new worker generation, seeded only with what survived in session storage.
  const context = createContext({ seed: { session: persistedSession } });
  const api = await loadServiceWorker(context);
  await api.ready;

  assert.equal(api.getScrapingState().isActive, true, 'restored state reports the scrape as running');

  await api.finishTabScrape(scrapeId, { data: scrapedData });
  assert.ok(context.rawStorage.local.redditPreviewData, 'the restarted worker completed the handoff');
  assert.equal(api.getScrapingState().isActive, false);
  assert.equal(context.rawStorage.session[api.SCRAPE_CONTEXT_KEY], undefined);
}

// 4. A persisted state whose handoff context is gone must not wedge isActive, or the
//    batch auto-resume below it would never run again.
{
  const context = createContext({
    seed: { session: { redditScrapingState: { isActive: true, message: 'Collecting...', percentage: 20 } } }
  });
  const api = await loadServiceWorker(context);
  await api.ready;

  assert.equal(api.getScrapingState().isActive, false, 'a contextless active flag is dropped');
  assert.equal(api.getScrapingState().message, 'Collecting...', 'the rest of the state is still restored');
}

// 5. A scrape reported as failed surfaces the error and releases the context.
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  const { scrapeId } = await api.handleScrapeRequest({ tabId: 1, filters: {} }, {});

  await assert.rejects(() => api.finishTabScrape(scrapeId, { error: 'Reddit blocked the request' }), /Reddit blocked the request/);
  assert.equal(api.getScrapingState().isActive, false);
  assert.match(api.getScrapingState().error, /Reddit blocked the request/);
  assert.equal(context.rawStorage.session[api.SCRAPE_CONTEXT_KEY], undefined);
}

// 6. Stopping awaits the activeBatch removal instead of firing and forgetting, and
//    also drops the single-scrape context.
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  await api.handleScrapeRequest({ tabId: 1, filters: {} }, {});
  context.rawStorage.local.activeBatch = { urls: [REDDIT_URL], currentIndex: 0 };

  await api.stopActiveScrape();

  assert.equal(context.rawStorage.local.activeBatch, undefined, 'activeBatch is gone once stop resolves');
  assert.equal(context.rawStorage.session[api.SCRAPE_CONTEXT_KEY], undefined, 'scrape context is gone too');
}

// 7. Messages are answered only after init has settled, so no handler can observe a
//    half-restored worker.
{
  const context = createContext();
  const api = await loadServiceWorker(context);

  const state = await new Promise(resolve => {
    api.handleRuntimeMessage({ action: 'getScrapingState' }, {}, resolve);
  });
  assert.equal(state.isActive, false);
  assert.equal(typeof api.ready.then, 'function', 'init exposes a promise for the message gate');
}

// 8. A stale content script that still replies with the payload instead of an
//    acknowledgement is handled rather than reported as a protocol error.
{
  const context = createContext({ ackResponse: { data: scrapedData } });
  const api = await loadServiceWorker(context);

  const result = await api.handleScrapeRequest({ tabId: 1, filters: {} }, {});
  assert.equal(result.started, true);
  await new Promise(resolve => globalThis.setTimeout(resolve, 10));
  assert.ok(context.rawStorage.local.redditPreviewData, 'legacy inline payload still completes the pipeline');
}

console.log('Background scrape handoff unit tests passed!');
