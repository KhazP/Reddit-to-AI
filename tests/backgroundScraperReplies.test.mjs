import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function createContext() {
  const noopArea = {
    get(_keys, callback) {
      callback({});
    },
    set(_items, callback) {
      callback?.();
    },
    remove(_keys, callback) {
      callback?.();
    }
  };

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
        local: noopArea,
        session: noopArea,
        sync: noopArea
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

async function loadServiceWorker() {
  const context = createContext();
  const source = await readFile(new URL('../service_worker.js', import.meta.url), 'utf8');
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
