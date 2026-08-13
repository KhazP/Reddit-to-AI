import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class MockElement {
  constructor(tagName, attributes = {}, text = '', children = []) {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.text = text;
    this.children = children;
    
    // Set parent pointers
    for (const child of children) {
      child.parent = this;
    }
  }

  getAttribute(name) {
    return this.attributes[name] !== undefined ? String(this.attributes[name]) : null;
  }

  hasAttribute(name) {
    return this.attributes[name] !== undefined;
  }

  get textContent() {
    return this.text || this.children.map(c => c.textContent).join(' ');
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      const id = selector.substring(1);
      return this._find(node => node.getAttribute('id') === id);
    }
    if (selector.startsWith('.')) {
      const cls = selector.substring(1);
      return this._find(node => {
        const classAttr = node.getAttribute('class') || '';
        return classAttr.split(/\s+/).includes(cls);
      });
    }
    if (selector.startsWith('[slot=')) {
      const match = selector.match(/\[slot="?([^"\]]+)"?\]/);
      if (match) {
        const slotName = match[1];
        return this._find(node => node.getAttribute('slot') === slotName);
      }
    }
    return this._find(node => node.tagName === selector.toUpperCase());
  }

  querySelectorAll(selector) {
    const results = [];
    this._findAll(node => {
      if (selector.startsWith('#')) {
        const id = selector.substring(1);
        return node.getAttribute('id') === id;
      }
      if (selector.startsWith('.')) {
        const cls = selector.substring(1);
        const classAttr = node.getAttribute('class') || '';
        return classAttr.split(/\s+/).includes(cls);
      }
      if (selector.startsWith('[slot=')) {
        const match = selector.match(/\[slot="?([^"\]]+)"?\]/);
        if (match) {
          const slotName = match[1];
          return node.getAttribute('slot') === slotName;
        }
      }
      return node.tagName === selector.toUpperCase();
    }, results);
    return results;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.tagName === selector.toUpperCase()) {
        return curr;
      }
      curr = curr.parent;
    }
    return null;
  }

  _find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child._find(predicate);
      if (found) return found;
    }
    return null;
  }

  _findAll(predicate, results) {
    for (const child of this.children) {
      if (predicate(child)) {
        results.push(child);
      }
      child._findAll(predicate, results);
    }
  }
}

class MockDocument {
  constructor(rootElement) {
    this.rootElement = rootElement;
  }

  querySelector(selector) {
    if (this.rootElement.tagName === selector.toUpperCase()) {
      return this.rootElement;
    }
    return this.rootElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    const results = [];
    if (this.rootElement.tagName === selector.toUpperCase()) {
      results.push(this.rootElement);
    }
    this.rootElement._findAll(node => {
      if (selector.startsWith('#')) {
        const id = selector.substring(1);
        return node.getAttribute('id') === id;
      }
      if (selector.startsWith('.')) {
        const cls = selector.substring(1);
        const classAttr = node.getAttribute('class') || '';
        return classAttr.split(/\s+/).includes(cls);
      }
      return node.tagName === selector.toUpperCase();
    }, results);
    return results;
  }
}

function createContext(document, fetchMock) {
  const windowMock = {
    location: {
      href: 'https://www.reddit.com/r/test_sub/comments/123/hello_world/'
    },
    __redditToAiScraperInitialized: false
  };

  const noopArea = {
    get(_keys, callback) {
      callback({});
    },
    set(_items, callback) {
      callback?.();
    }
  };

  const context = {
    console,
    URL,
    URLSearchParams,
    Set,
    Math,
    Date,
    parseInt,
    Array,
    String,
    Boolean,
    Error,
    setTimeout: (callback) => {
      callback();
      return 0;
    },
    window: windowMock,
    globalThis: windowMock,
    document,
    fetch: fetchMock,
    chrome: {
      i18n: { getMessage: () => '' },
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        sendMessage() {}
      },
      storage: {
        sync: noopArea
      }
    }
  };

  // Bind window mock properties to make them available in the vm
  windowMock.window = windowMock;
  windowMock.document = document;

  return context;
}

// 1. Direct test of scrapeFromDOM
{
  const postEl = new MockElement('shreddit-post', {
    'post-title': 'Hello World Post',
    'author': 'OP_User',
    'subreddit-prefixed-name': 'r/test_sub',
    'score': '42',
    'comment-count': '2',
    'over-18': 'false',
    'permalink': '/r/test_sub/comments/123/hello_world/'
  }, '', [
    new MockElement('div', { id: '-post-rtjson-content' }, 'This is the main post body content.')
  ]);

  const comment1 = new MockElement('shreddit-comment', {
    'thingid': 't1_comment1',
    'parentid': 't3_post123',
    'author': 'User_A',
    'score': '10',
    'depth': '0',
    'permalink': '/r/test_sub/comments/123/hello_world/c1'
  }, '', [
    new MockElement('div', { slot: 'comment' }, 'First top level comment')
  ]);

  const comment2 = new MockElement('shreddit-comment', {
    'thingid': 't1_comment2',
    'parentid': 't1_comment1',
    'author': 'User_B',
    'score': '5',
    'depth': '1',
    'permalink': '/r/test_sub/comments/123/hello_world/c2'
  }, '', [
    new MockElement('div', { slot: 'comment' }, 'Reply to the first comment')
  ]);

  const pageRoot = new MockElement('div', {}, '', [postEl, comment1, comment2]);
  const docMock = new MockDocument(pageRoot);
  const context = createContext(docMock, async () => {
    throw new Error('fetch should not be called');
  });

  const source = await readFile(new URL('../src/redditScraper.js', import.meta.url), 'utf8');
  const parserSource = await readFile(new URL('../src/redditParser.js', import.meta.url), 'utf8');
  vm.runInNewContext(parserSource, context, { filename: 'redditParser.js' });
  vm.runInNewContext(source, context, { filename: 'redditScraper.js' });

  const result = context.window.scrapeFromDOM(false);
  assert.equal(result.post.title, 'Hello World Post');
  assert.equal(result.post.author, 'OP_User');
  assert.equal(result.post.subreddit, 'test_sub');
  assert.equal(result.post.content, 'This is the main post body content.');

  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].id, 't1_comment1');
  assert.equal(result.comments[0].text, 'First top level comment');
  assert.equal(result.comments[0].replies.length, 1);
  assert.equal(result.comments[0].replies[0].id, 't1_comment2');
  assert.equal(result.comments[0].replies[0].text, 'Reply to the first comment');
}

// 2. Integration test of fallback logic inside startScrape
{
  const postEl = new MockElement('shreddit-post', {
    'post-title': 'Hello World Post',
    'author': 'OP_User',
    'subreddit-prefixed-name': 'r/test_sub',
    'score': '42',
    'comment-count': '2',
    'over-18': 'false',
    'permalink': '/r/test_sub/comments/123/hello_world/'
  }, '', [
    new MockElement('div', { id: '-post-rtjson-content' }, 'This is the main post body content.')
  ]);

  const comment1 = new MockElement('shreddit-comment', {
    'thingid': 't1_comment1',
    'parentid': 't3_post123',
    'author': 'User_A',
    'score': '10',
    'depth': '0',
    'permalink': '/r/test_sub/comments/123/hello_world/c1'
  }, '', [
    new MockElement('div', { slot: 'comment' }, 'First top level comment')
  ]);

  const comment2 = new MockElement('shreddit-comment', {
    'thingid': 't1_comment2',
    'parentid': 't1_comment1',
    'author': 'User_B',
    'score': '5',
    'depth': '1',
    'permalink': '/r/test_sub/comments/123/hello_world/c2'
  }, '', [
    new MockElement('div', { slot: 'comment' }, 'Reply to the first comment')
  ]);

  const pageRoot = new MockElement('div', {}, '', [postEl, comment1, comment2]);
  const docMock = new MockDocument(pageRoot);
  
  // fetch fails, which triggers DOM scraping fallback
  const context = createContext(docMock, async () => {
    throw new Error('API Rate Limited or Offline');
  });

  const source = await readFile(new URL('../src/redditScraper.js', import.meta.url), 'utf8');
  const parserSource = await readFile(new URL('../src/redditParser.js', import.meta.url), 'utf8');
  vm.runInNewContext(parserSource, context, { filename: 'redditParser.js' });
  vm.runInNewContext(source, context, { filename: 'redditScraper.js' });

  // Simulate applying settings (e.g. setting maxDepth)
  context.window.applySettings({});

  const result = await context.window.startScrape(false);
  assert.equal(result.post.title, 'Hello World Post');
  assert.equal(result.post.author, 'OP_User');
  assert.equal(result.post.subreddit, 'test_sub');
  assert.equal(result.post.content, 'This is the main post body content.');

  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].id, 't1_comment1');
  assert.equal(result.comments[0].replies.length, 1);
  assert.equal(result.comments[0].replies[0].id, 't1_comment2');
  
  // Verify it handles filters correctly via applyFilters/countNestedReplies
  assert.equal(result.commentCount, 2);
  assert.equal(result.originalCount, 2);
}

console.log('DOM Fallback tests passed successfully.');
