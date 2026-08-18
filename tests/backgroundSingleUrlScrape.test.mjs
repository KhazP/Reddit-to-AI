import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const VALID_REDDIT_URL = 'https://www.reddit.com/r/test/comments/123/mock_post';
const INVALID_URL = 'https://example.com/not-reddit';

function createContext({ fetchHandler, seed = {} } = {}) {
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
      const keysArr = Array.isArray(keys) ? keys : [keys];
      keysArr.forEach(k => {
        delete storage[areaName][k];
      });
      callback?.();
    }
  });

  const tabMessages = [];
  const runtimeMessages = [];
  const createdTabs = [];
  const fetchedUrls = [];

  const defaultFetch = async (url) => {
    fetchedUrls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => [
        {
          data: {
            children: [
              {
                data: {
                  title: 'Mock Single Post',
                  author: 'mockauthor',
                  subreddit: 'test',
                  selftext: 'Mock body text for single thread',
                  name: 't3_123',
                  url: VALID_REDDIT_URL
                }
              }
            ]
          }
        },
        {
          data: {
            children: [
              {
                kind: 't1',
                data: {
                  name: 't1_comment1',
                  parent_id: 't3_123',
                  body: 'Great test post!',
                  score: 25,
                  author: 'testuser',
                  replies: ''
                }
              }
            ]
          }
        }
      ]
    };
  };

  return {
    console,
    URL,
    URLSearchParams,
    Set,
    Math,
    Date,
    crypto: { randomUUID: () => 'scrape-uuid-123' },
    importScripts() {},
    fetchedUrls,
    tabMessages,
    runtimeMessages,
    createdTabs,
    fetch: fetchHandler || defaultFetch,
    setTimeout(callback) {
      return globalThis.setTimeout(callback, 1);
    },
    setInterval(callback, delayMs) {
      return globalThis.setInterval(callback, delayMs);
    },
    clearInterval(id) {
      globalThis.clearInterval(id);
    },
    chrome: {
      i18n: { getMessage: (key) => key },
      runtime: {
        lastError: null,
        onInstalled: { addListener() {} },
        onMessage: { addListener() {} },
        onConnect: { addListener() {} },
        onStartup: { addListener() {} },
        sendMessage(message, callback) {
          runtimeMessages.push(message);
          callback?.({});
        },
        getURL(path) {
          return `chrome-extension://test/${path}`;
        }
      },
      tabs: {
        create: async (options) => {
          createdTabs.push(options);
          return { id: 99, ...options };
        },
        query: async () => [{ id: 42, url: VALID_REDDIT_URL }],
        sendMessage(tabId, message, callback) {
          tabMessages.push({ tabId, message });
          callback?.({});
        },
        get(tabId, callback) {
          callback({ id: tabId, url: VALID_REDDIT_URL });
        },
        update: async () => ({})
      },
      windows: { update: async () => ({}) },
      scripting: {
        insertCSS: async () => {},
        executeScript: async () => {}
      },
      notifications: {
        create(_id, _options, callback) {
          callback?.();
        }
      },
      storage: {
        local: createStorageArea('local'),
        session: createStorageArea('session'),
        sync: createStorageArea('sync')
      }
    },
    R2AIPrompt: {
      countComments(comments) {
        return (comments || []).length;
      },
      applyContextPreset(data) {
        return data;
      },
      buildPromptText(data) {
        return `Summarized: ${data.post?.title}`;
      }
    },
    rawStorage: storage,
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

// ----------------- TEST SUITE -----------------

// Test 1: Direct URL background scrape with preview (default showPromptPreview === true)
{
  const context = createContext();
  const api = await loadServiceWorker(context);

  const sender = { tab: { id: 7 } };
  const request = {
    threadUrl: VALID_REDDIT_URL,
    filters: { minScore: 5 }
  };

  const result = await api.handleScrapeRequest(request, sender);

  assert.equal(result.started, true, 'Result should indicate started');
  assert.equal(result.directUrl, true, 'Result should indicate directUrl scrape');
  assert.ok(result.scrapeId, 'Result should have a scrapeId');

  // Verify fetch called the JSON endpoint for this URL
  assert.ok(context.fetchedUrls.length > 0, 'Fetch should have been called');
  assert.ok(context.fetchedUrls.some(u => u.includes('comments/123')), 'Should fetch the thread JSON');

  // Verify floating panel updates were sent to sender.tab.id (7)
  const floatingPanelUpdates = context.tabMessages.filter(
    m => m.tabId === 7 && m.message?.action === 'updateFloatingPanel'
  );
  assert.ok(floatingPanelUpdates.length >= 2, 'Should send floating panel progress updates to sender tab');

  // Verify preview data was saved in storage
  const previewPayload = context.rawStorage.local.redditPreviewData;
  assert.ok(previewPayload, 'Preview data should be saved in local storage');
  assert.equal(previewPayload.data.post.title, 'Mock Single Post');
  assert.equal(previewPayload.data.threadUrl, VALID_REDDIT_URL);
  assert.equal(previewPayload.data.comments.length, 1);

  // Verify history entry saved
  const history = context.rawStorage.local.scrapeHistory;
  assert.ok(Array.isArray(history) && history.length === 1, 'History entry should be created');
  assert.equal(history[0].post.title, 'Mock Single Post');

  // Verify preview tab was opened
  const previewTab = context.createdTabs.find(t => t.url?.includes('preview.html'));
  assert.ok(previewTab, 'Should open preview.html tab');

  // Verify state is complete and idle/ready
  const state = api.getScrapingState();
  assert.equal(state.isActive, false, 'State isActive should be false when finished');
  assert.equal(state.percentage, 100, 'State percentage should be 100');
  assert.equal(state.status, 'complete', 'State status should be complete');
  assert.equal(state.phase, 'complete', 'State phase should be complete');

  // Scrape context in session storage should be cleaned up
  assert.equal(context.rawStorage.session[api.SCRAPE_CONTEXT_KEY], undefined, 'Scrape context should be cleared');
}

// Test 2: Direct URL scrape with direct AI handoff (showPromptPreview === false)
{
  const context = createContext();
  const api = await loadServiceWorker(context);

  const sender = { tab: { id: 12 } };
  const request = {
    threadUrl: VALID_REDDIT_URL,
    showPromptPreview: false
  };

  const result = await api.handleScrapeRequest(request, sender);

  assert.equal(result.started, true);
  assert.equal(result.directUrl, true);

  // Verify AI tab was opened instead of preview tab
  const previewTab = context.createdTabs.find(t => t.url?.includes('preview.html'));
  assert.equal(previewTab, undefined, 'Should NOT open preview tab when showPromptPreview is false');

  const aiTab = context.createdTabs.find(t => t.url?.includes('gemini.google.com') || t.url?.includes('chatgpt.com'));
  assert.ok(aiTab, 'Should open AI provider tab');

  // Verify pending paste payload was created
  const pastePayload = context.rawStorage.local.redditPendingPaste;
  assert.ok(pastePayload, 'Pending paste payload should be stored');
  assert.match(pastePayload.promptText, /Summarized: Mock Single Post/);

  // Verify state is complete
  const state = api.getScrapingState();
  assert.equal(state.isActive, false);
  assert.equal(state.percentage, 100);
  assert.equal(state.status, 'complete');
}

// Test 3: Runtime message dispatcher integration for scrapeReddit with threadUrl
{
  const context = createContext();
  const api = await loadServiceWorker(context);

  const request = {
    action: 'scrapeReddit',
    threadUrl: VALID_REDDIT_URL
  };
  const sender = { tab: { id: 15 } };

  const response = await new Promise(resolve => {
    api.handleRuntimeMessage(request, sender, resolve);
  });

  assert.equal(response.status, 'success', 'Runtime message should return success');
  assert.equal(response.started, true);
  assert.equal(response.directUrl, true);
  assert.ok(response.currentState, 'Response should include currentState');
  assert.equal(response.currentState.status, 'complete');
}

// Test 4: Invalid threadUrl rejection
{
  const context = createContext();
  const api = await loadServiceWorker(context);

  const request = {
    threadUrl: INVALID_URL
  };

  await assert.rejects(
    async () => {
      await api.handleScrapeRequest(request, { tab: { id: 1 } });
    },
    /Active tab is not a Reddit thread|Invalid Reddit thread URL/i
  );

  const state = api.getScrapingState();
  assert.equal(state.isActive, false, 'isActive should be false on invalid URL');
  assert.equal(state.status, 'error', 'Status should be error');
  assert.equal(state.phase, 'error', 'Phase should be error');
}

// Test 5: Network / fetch failure handling
{
  const failingFetch = async () => {
    throw new Error('Reddit network unreachable');
  };
  const context = createContext({ fetchHandler: failingFetch });
  const api = await loadServiceWorker(context);

  const request = {
    threadUrl: VALID_REDDIT_URL
  };

  await assert.rejects(
    async () => {
      await api.handleScrapeRequest(request, { tab: { id: 1 } });
    },
    /Reddit network unreachable/
  );

  const state = api.getScrapingState();
  assert.equal(state.isActive, false, 'isActive should be false on failure');
  assert.equal(state.status, 'error', 'Status should be error');
  assert.equal(state.phase, 'error', 'Phase should be error');
  assert.match(state.error, /Reddit network unreachable/);

  // Scrape context in session storage should be cleared
  assert.equal(context.rawStorage.session[api.SCRAPE_CONTEXT_KEY], undefined, 'Scrape context must be cleared on error');
}

console.log('Background single URL scrape unit tests passed!');
