import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function createContext() {
  const storage = {
    local: {},
    session: {},
    sync: {}
  };

  const createStorageArea = (areaName) => ({
    get(keys, callback) {
      const res = {};
      if (typeof keys === 'string') {
        res[keys] = storage[areaName][keys];
      } else if (Array.isArray(keys)) {
        keys.forEach(k => {
          res[k] = storage[areaName][k];
        });
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

  const fetchedUrls = [];

  return {
    console,
    URL,
    URLSearchParams,
    Set,
    Math,
    Date,
    crypto: { randomUUID: () => 'test-id' },
    importScripts() {},
    fetchedUrls,
    fetch: async (url) => {
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
                    title: 'Mock Post',
                    author: 'mockauthor',
                    subreddit: 'test',
                    selftext: 'Mock body',
                    name: 't3_post',
                    url: url
                  }
                }
              ]
            }
          },
          {
            data: {
              children: []
            }
          }
        ]
      };
    },
    setTimeout(callback, delayMs) {
      return globalThis.setTimeout(callback, 1);
    },
    setInterval(callback, delayMs) {
      return globalThis.setInterval(callback, delayMs);
    },
    clearInterval(id) {
      globalThis.clearInterval(id);
    },
    chrome: {
      i18n: { getMessage: () => '' },
      runtime: {
        lastError: null,
        onInstalled: { addListener() {} },
        onMessage: { addListener() {} },
        onConnect: { addListener() {} },
        onStartup: { addListener() {} },
        sendMessage(_message, callback) {
          callback?.({});
        },
        getURL(path) {
          return `chrome-extension://test/${path}`;
        }
      },
      tabs: {
        create: async () => ({}),
        query: async () => [],
        sendMessage(_tabId, _message, callback) {
          callback?.({});
        },
        get(_tabId, callback) {
          callback({});
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
        return 0;
      }
    },
    rawStorage: storage,
    R2AIServiceWorkerTest: {}
  };
}

async function loadServiceWorker(context) {
  const source = await readFile(new URL('../src/service_worker.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context, { filename: 'service_worker.js' });
  return context.R2AIServiceWorkerTest;
}

// ----------------- TEST SUITE -----------------

// Test 1: Triggering batch scrape saves the initial state and cleans up on completion
{
  const context = createContext();
  const api = await loadServiceWorker(context);

  const request = {
    batchUrls: [
      'https://www.reddit.com/r/test/comments/1/a',
      'https://www.reddit.com/r/test/comments/2/b'
    ],
    filters: {},
    includeHidden: false
  };

  const promise = api.handleBatchScrapeRequest(request);

  // Verify initial state is stored in storage synchronously before promise resolves
  assert.ok(context.rawStorage.local.activeBatch, 'activeBatch should be stored in local storage');
  assert.equal(context.rawStorage.local.activeBatch.currentIndex, 0, 'currentIndex should start at 0');
  assert.equal(context.rawStorage.local.activeBatch.urls.length, 2);

  // Wait for completion
  await promise;

  // Verify activeBatch is cleaned up after completion
  assert.equal(context.rawStorage.local.activeBatch, undefined, 'activeBatch should be removed from storage on completion');
  assert.equal(context.fetchedUrls.length, 2, 'Should have fetched 2 urls');
}

// Test 2: Mid-batch resumption from storage resumes from the saved currentIndex
{
  const context = createContext();
  const api = await loadServiceWorker(context);

  const initialBatch = {
    urls: [
      'https://www.reddit.com/r/test/comments/1/a',
      'https://www.reddit.com/r/test/comments/2/b',
      'https://www.reddit.com/r/test/comments/3/c'
    ],
    currentIndex: 1, // Skip the first one
    threads: [{ title: 'Scraped 1' }],
    filters: {},
    includeHidden: false,
    request: {
      batchUrls: [
        'https://www.reddit.com/r/test/comments/1/a',
        'https://www.reddit.com/r/test/comments/2/b',
        'https://www.reddit.com/r/test/comments/3/c'
      ],
      filters: {},
      includeHidden: false
    }
  };

  context.rawStorage.local.activeBatch = initialBatch;

  const promise = api.resumeBatchScrape(initialBatch);

  // Inspect storage state mid-resumption synchronously
  assert.ok(context.rawStorage.local.activeBatch, 'activeBatch should be in storage during resumption');
  assert.equal(context.rawStorage.local.activeBatch.currentIndex, 1, 'currentIndex should start at 1 before loop runs');

  await promise;

  // Verify clean up
  assert.equal(context.rawStorage.local.activeBatch, undefined, 'activeBatch should be removed from storage after completion');
  assert.equal(context.fetchedUrls.length, 2, 'Should have fetched only remaining 2 urls');
  assert.match(context.fetchedUrls[0], /comments\/2\/b/, 'First fetched url should be the second item');
  assert.match(context.fetchedUrls[1], /comments\/3\/c/, 'Second fetched url should be the third item');
}

// Test 3: User cancellation cleans up storage
{
  const context = createContext();
  const api = await loadServiceWorker(context);

  const request = {
    batchUrls: [
      'https://www.reddit.com/r/test/comments/1/a',
      'https://www.reddit.com/r/test/comments/2/b'
    ],
    filters: {},
    includeHidden: false
  };

  const promise = api.handleBatchScrapeRequest(request);

  // Let microtask queue/first yield step run so currentScrape gets initialized
  await new Promise(resolve => globalThis.setTimeout(resolve, 0));

  // Cancel
  api.stopActiveScrape();

  try {
    await promise;
    assert.fail('Scraping should have thrown error on cancellation');
  } catch (err) {
    assert.match(err.message, /stopped by user/);
  }

  // Verify storage is cleaned up
  assert.equal(context.rawStorage.local.activeBatch, undefined, 'activeBatch should be cleared on cancellation');
}

console.log('Background batch resumption unit tests passed!');
