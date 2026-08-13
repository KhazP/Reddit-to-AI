// Covers the structured scraping-state contract: the service worker publishes
// machine-readable `phase` / `status` / `batch` fields, and the UI layers key off
// those rather than pattern-matching localized message text.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const REDDIT_URL = 'https://www.reddit.com/r/test/comments/1/a';

function createContext() {
  const storage = { local: {}, session: {}, sync: {} };

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

  return {
    console: { log() {}, debug() {}, warn() {}, error() {} },
    URL,
    URLSearchParams,
    Date,
    crypto: { randomUUID: () => 'scrape-1' },
    importScripts() {},
    fetch: async () => { throw new Error('no network in test'); },
    setTimeout(callback) { return globalThis.setTimeout(callback, 0); },
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
        create: async () => ({}),
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

// 1. A fresh worker starts idle with the structured fields present.
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  const state = api.getScrapingState();
  assert.equal(state.phase, 'idle');
  assert.equal(state.status, 'idle');
  assert.equal(state.batch, null);
}

// 2. A single-thread scrape walks prepare → fetch → build → complete, and the
//    terminal state is marked complete without any English message sniffing.
{
  const context = createContext();
  const api = await loadServiceWorker(context);

  const result = await api.handleScrapeRequest({ tabId: 1, filters: {} }, {});
  const running = api.getScrapingState();
  assert.equal(running.status, 'running');
  assert.ok(['prepare', 'fetch'].includes(running.phase), `unexpected running phase: ${running.phase}`);

  await api.finishTabScrape(result.scrapeId, { data: scrapedData });

  const done = api.getScrapingState();
  assert.equal(done.isActive, false);
  assert.equal(done.phase, 'complete');
  assert.equal(done.status, 'complete');
  assert.equal(done.batch, null);
}

// 3. Errors are reported structurally, not only as an "Error: ..." message string.
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  const result = await api.handleScrapeRequest({ tabId: 1, filters: {} }, {});

  await assert.rejects(() => api.finishTabScrape(result.scrapeId, { error: 'boom' }));

  const state = api.getScrapingState();
  assert.equal(state.phase, 'error');
  assert.equal(state.status, 'error');
  assert.equal(state.batch, null);
  assert.ok(state.error);
}

// 4. A progressUpdate carrying a phase publishes its batch counter, and a later
//    phase without one clears it so the panel badge cannot go stale.
{
  const context = createContext();
  const api = await loadServiceWorker(context);

  api.setScrapingState({ phase: 'load', status: 'running', batch: { current: 2, total: 7 } });
  assert.deepEqual(api.getScrapingState().batch, { current: 2, total: 7 });

  api.setScrapingState({ phase: 'filter', status: 'running', batch: null });
  assert.equal(api.getScrapingState().batch, null, 'batch is cleared once the counting phase ends');
}

// 5. The content script tags its progress updates with a phase.
{
  const scraper = await readFile(new URL('../src/redditScraper.js', import.meta.url), 'utf8');
  assert.match(scraper, /function sendProgress\(message, percentage, phase, batch\)/, 'sendProgress takes a phase');
  assert.match(scraper, /action: 'progressUpdate', message, percentage, phase, batch/, 'the phase is transmitted');
  for (const phase of ['fetch', 'parse', 'expand', 'load', 'filter']) {
    assert.ok(scraper.includes(`'${phase}'`), `content script emits the ${phase} phase`);
  }
  assert.match(scraper, /'load', \{ current: processedBatches/, 'the batch loader reports a batch counter');
  // The comment count the panel badge used to scrape out of the message text now
  // has its own structured channel.
  assert.match(scraper, /'expand', \{ count \}/, 'the expand phase reports its comment count');
}

// 5b. The panel renders both counter shapes off the structured field.
{
  const panel = await readFile(new URL('../src/floatingPanel.js', import.meta.url), 'utf8');
  assert.match(panel, /Number\.isFinite\(batch\.current\) && Number\.isFinite\(batch\.total\)/, 'x-of-y counters render');
  assert.match(panel, /Number\.isFinite\(batch\.count\)/, 'bare comment counts render');
}

// 6. The UI layers read the structured fields, keeping string matching as a
//    clearly-labelled fallback only.
{
  const panel = await readFile(new URL('../src/floatingPanel.js', import.meta.url), 'utf8');
  assert.match(panel, /PHASE_TO_TRACK/, 'panel maps backend phases onto its track');
  assert.match(panel, /function resolvePhase\(data\)/, 'panel resolves the phase from state');
  assert.match(panel, /function resolveBatchInfo\(data\)/, 'panel resolves batch info from state');
  assert.match(panel, /data\.status === 'complete'/, 'auto-hide keys off status');
  // The legacy helpers survive only as renamed fallbacks.
  assert.match(panel, /function detectPhaseFromMessage\(message\)/);
  assert.match(panel, /function extractBatchInfoFromMessage\(message\)/);
  assert.doesNotMatch(panel, /updatePhaseUI\(detectPhase\(/, 'panel no longer drives the track from message text');

  const popup = await readFile(new URL('../src/popup.js', import.meta.url), 'utf8');
  assert.match(popup, /state\.status === 'complete'/, 'popup success toast keys off status');
  assert.match(popup, /state\.phase === 'complete'/, 'popup falls back to phase before message text');
}

console.log('Scraping state phase tests passed successfully!');
