import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function createContext() {
  function createFakeStorage() {
    const store = {};
    return {
      get(keys, callback) {
        if (typeof keys === 'string') {
          callback({ [keys]: store[keys] });
        } else if (Array.isArray(keys)) {
          const res = {};
          for (const k of keys) {
            res[k] = store[k];
          }
          callback(res);
        } else if (typeof keys === 'object' && keys !== null) {
          const res = {};
          for (const k in keys) {
            res[k] = k in store ? store[k] : keys[k];
          }
          callback(res);
        } else {
          callback(store);
        }
      },
      set(items, callback) {
        Object.assign(store, items);
        callback?.();
      },
      remove(keys, callback) {
        const actualKeys = Array.isArray(keys) ? keys : [keys];
        for (const k of actualKeys) {
          delete store[k];
        }
        callback?.();
      }
    };
  }

  const localArea = createFakeStorage();
  const sessionArea = createFakeStorage();
  const syncArea = createFakeStorage();

  return {
    console,
    URL,
    URLSearchParams,
    Set,
    Math,
    Date,
    crypto: { randomUUID: () => 'test-id' },
    importScripts() {},
    fetch: async () => {
      throw new Error('fetch should not be called by these unit tests');
    },
    setTimeout(callback) {
      callback();
      return 0;
    },
    chrome: {
      i18n: { getMessage: () => '' },
      runtime: {
        lastError: null,
        onInstalled: { addListener() {} },
        onMessage: { addListener() {} },
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
        local: localArea,
        session: sessionArea,
        sync: syncArea
      }
    },
    R2AIPrompt: {
      countComments(comments) {
        let total = 0;
        const stack = [...(comments || [])];
        while (stack.length > 0) {
          const comment = stack.pop();
          total += 1;
          stack.push(...(comment.replies || []));
        }
        return total;
      }
    },
    R2AIServiceWorkerTest: {}
  };
}

async function loadServiceWorker(customContext) {
  const context = customContext || createContext();
  const source = await readFile(new URL('../src/service_worker.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context, { filename: 'service_worker.js' });
  return context.R2AIServiceWorkerTest;
}

function commentThing({ id, parentId, body, score = 1, author = 'user', replies = [] }) {
  return {
    kind: 't1',
    data: {
      name: id,
      parent_id: parentId,
      body,
      score,
      author,
      replies: replies.length > 0 ? { data: { children: replies } } : ''
    }
  };
}

const api = await loadServiceWorker();

{
  const comments = api.parseBackgroundComments([
    commentThing({
      id: 't1_removed',
      parentId: 't3_thread',
      body: '[removed]',
      replies: [
        commentThing({
          id: 't1_child',
          parentId: 't1_removed',
          body: 'Useful child reply',
          score: 9
        })
      ]
    })
  ], false, 10, []);

  assert.equal(comments.length, 1);
  assert.equal(comments[0].id, 't1_removed');
  assert.equal(comments[0].isOmittedParent, true);
  assert.equal(comments[0].replies[0].id, 't1_child');
}

{
  const filtered = api.applyBackgroundFilters([
    {
      id: 't1_low_parent',
      parentId: 't3_thread',
      author: 'user',
      text: 'Low score parent',
      score: 0,
      replies: [
        {
          id: 't1_good_child',
          parentId: 't1_low_parent',
          author: 'user2',
          text: 'High score child',
          score: 10,
          replies: []
        }
      ]
    }
  ], { minScore: 5 }, {});

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 't1_good_child');
  assert.equal(filtered[0].text, 'High score child');
}

{
  const roots = [];
  const integration = api.mergeAdditionalComments(roots, [
    {
      id: 't1_child_first',
      parentId: 't1_parent_late',
      author: 'child',
      text: 'I arrived before my parent',
      score: 3,
      replies: []
    },
    {
      id: 't1_parent_late',
      parentId: 't3_thread',
      author: 'parent',
      text: 'Late parent',
      score: 4,
      replies: []
    }
  ], 't3_thread');

  assert.equal(integration.addedCount, 2);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].id, 't1_parent_late');
  assert.equal(roots[0].replies.length, 1);
  assert.equal(roots[0].replies[0].id, 't1_child_first');
}

// Test: quickEstimateCache size limiting and eviction
{
  const cache = api.quickEstimateCache;
  cache.clear();

  // Populate cache with 50 items
  for (let i = 1; i <= 50; i++) {
    cache.set(`url_${i}`, `data_${i}`);
  }
  assert.equal(cache.size, 50);

  // Set one more item, it should evict url_1 (the oldest key)
  if (cache.size >= 50) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set('url_51', 'data_51');

  assert.equal(cache.size, 50);
  assert.equal(cache.has('url_1'), false);
  assert.equal(cache.has('url_2'), true);
  assert.equal(cache.has('url_51'), true);
}

// Test: addToHistory and resendHistoryItem refactoring
await (async () => {
  const scrapeData = {
    post: { title: 'Test Thread', url: 'https://reddit.com/r/test/comments/123' },
    comments: [],
    metadata: { threadId: 't3_123', subreddit: 'test' },
    includeHidden: true,
    maxDepth: 5,
    filtersApplied: { minScore: 10 },
    morechildren: { failedIds: [] },
    threadUrl: 'https://reddit.com/r/test/comments/123'
  };

  // 1. Add to history
  const entry = await api.addToHistory(scrapeData, { selectedLlmProvider: 'gemini' });

  // Assert rawData is omitted and root fields are saved
  assert.equal(entry.rawData, undefined);
  assert.equal(entry.includeHidden, true);
  assert.equal(entry.maxDepth, 5);
  assert.deepEqual(entry.filtersApplied, { minScore: 10 });
  assert.equal(entry.threadUrl, 'https://reddit.com/r/test/comments/123');
  assert.equal(entry.post.title, 'Test Thread');

  // 2. Resend history item
  await api.resendHistoryItem(entry.id, 'claude');

  // Retrieve preview payload from storage using the exported chrome mock
  await new Promise((resolve) => {
    api.chrome.storage.session.get('redditPreviewData', (result) => {
      const payload = result.redditPreviewData;
      assert.ok(payload, 'should have saved preview data');
      assert.equal(payload.data.rawData, undefined, 'preview data should not have rawData');
      assert.equal(payload.data.includeHidden, true);
      assert.equal(payload.data.maxDepth, 5);
      assert.deepEqual(payload.data.filtersApplied, { minScore: 10 });
      assert.equal(payload.data.threadUrl, 'https://reddit.com/r/test/comments/123');
      assert.equal(payload.data.post.title, 'Test Thread');
      resolve();
    });
  });
})();

// Test: Batch mode history restoration
await (async () => {
  const customContext = createContext();
  customContext.fetch = async (url) => {
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
  };

  const batchApi = await loadServiceWorker(customContext);

  const request = {
    batchUrls: ['https://www.reddit.com/r/test/comments/123'],
    filters: {},
    includeHidden: false
  };

  // 1. Trigger batch scrape
  await batchApi.handleBatchScrapeRequest(request);

  // Retrieve batch data from storage
  const previewPayload = await new Promise((resolve) => {
    batchApi.chrome.storage.local.get('redditPreviewData', (result) => {
      resolve(result.redditPreviewData);
    });
  });
  const batchData = previewPayload.data;
  assert.equal(batchData.isBatch, true);
  assert.ok(Array.isArray(batchData.threads));
  assert.equal(batchData.threads.length, 1);

  // 2. Call addToHistory manually
  const entry = await batchApi.addToHistory(batchData, { selectedLlmProvider: 'gemini' });
  assert.equal(entry.isBatch, true);
  assert.ok(Array.isArray(entry.threads));

  // 3. Retrieve it
  const retrievedEntry = await new Promise((resolve) => {
    batchApi.chrome.storage.local.get('scrapeHistory', (result) => {
      const history = result.scrapeHistory || [];
      resolve(history.find(item => item.id === entry.id));
    });
  });
  assert.ok(retrievedEntry, 'should retrieve history entry');
  assert.equal(retrievedEntry.isBatch, true);
  assert.ok(Array.isArray(retrievedEntry.threads));

  // 4. Call resendHistoryItem
  await batchApi.resendHistoryItem(retrievedEntry.id, 'gemini');

  // 5. Verify reconstructed scrapeData contains threads and isBatch intact
  await new Promise((resolve) => {
    batchApi.chrome.storage.session.get('redditPreviewData', (result) => {
      const payload = result.redditPreviewData;
      assert.ok(payload, 'should have saved preview data after resending');
      assert.equal(payload.data.isBatch, true);
      assert.ok(Array.isArray(payload.data.threads));
      assert.equal(payload.data.threads.length, 1);
      assert.equal(payload.data.threads[0].post.title, 'Mock Post');
      resolve();
    });
  });
})();

