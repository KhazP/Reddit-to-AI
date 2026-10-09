import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('manifest.json registers redditInlineButton.js and redditInlineButton.css', async () => {
  const manifest = JSON.parse(await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8'));
  
  const redditContentScript = manifest.content_scripts?.find(cs =>
    cs.matches?.some(m => m.includes('reddit.com'))
  );
  assert.ok(redditContentScript, 'Reddit content script entry must exist in manifest.json');
  assert.ok(
    redditContentScript.js?.includes('redditInlineButton.js'),
    'content_scripts for Reddit must include redditInlineButton.js'
  );

  const webAccessible = manifest.web_accessible_resources?.find(war =>
    war.resources?.includes('redditInlineButton.css')
  );
  assert.ok(webAccessible, 'web_accessible_resources must include redditInlineButton.css');
  assert.ok(
    webAccessible.matches?.some(m => m.includes('reddit.com')),
    'web_accessible_resources for redditInlineButton.css must match reddit.com'
  );
});

test('redditInlineButton.css defines required styles, spinner, and animations', async () => {
  const css = await readFile(new URL('../src/redditInlineButton.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.r2ai-inline-btn'), 'CSS must define .r2ai-inline-btn');
  assert.ok(css.includes('.reddit-to-ai-button'), 'CSS must define .reddit-to-ai-button');
  assert.ok(css.includes('.r2ai-in-post'), 'CSS must define .r2ai-in-post spacing rule');
  assert.ok(css.includes('.r2ai-in-feed'), 'CSS must define .r2ai-in-feed spacing rule');
  assert.ok(css.includes('.reddit-to-ai-button-container'), 'CSS must define .reddit-to-ai-button-container');
  assert.ok(css.includes('margin-left: 8px'), 'CSS must specify 8px margin for in-post alignment');
  assert.ok(css.includes('margin-left: 4px'), 'CSS must specify 4px margin for in-feed alignment');
  assert.ok(css.includes('gap: 4px'), 'CSS must specify 4px internal button gap');
  assert.ok(css.includes('z-index: 10'), 'CSS must specify elevated z-index for clickability');
  assert.ok(css.includes('pointer-events: auto'), 'CSS must ensure pointer-events: auto for button');
  assert.ok(css.includes('.r2ai-btn-spinner'), 'CSS must define .r2ai-btn-spinner');
  assert.ok(css.includes('.is-loading'), 'CSS must handle .is-loading state');
  assert.ok(css.includes('@keyframes r2ai-spin') || css.includes('animation:'), 'CSS must define rotation animation');
});

test('redditInlineButton.js source contains core selectors and safety guards', async () => {
  const code = await readFile(new URL('../src/redditInlineButton.js', import.meta.url), 'utf8');
  assert.ok(code.includes('__redditToAiInlineButtonInjected'), 'Must guard against duplicate script injection');
  assert.ok(code.includes('shreddit-post'), 'Must query or target shreddit-post elements');
  assert.ok(code.includes('showRedditInlineButton'), 'Must check showRedditInlineButton setting');
  assert.ok(code.includes('showRedditButtonInFeed'), 'Must check showRedditButtonInFeed setting');
  assert.ok(code.includes('showRedditButtonInPost'), 'Must check showRedditButtonInPost setting');
  assert.ok(code.includes('chrome.storage.onChanged'), 'Must listen for chrome.storage.onChanged');
  assert.ok(code.includes('r2ai-inline-btn'), 'Must create button with r2ai-inline-btn');
});

// Helper for Mock DOM environment
class MockDOMElement {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attrs };
    this.dataset = {};
    for (const key in attrs) {
      if (key.startsWith('data-')) {
        const camel = key.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
        this.dataset[camel] = attrs[key];
      }
    }
    this.children = [];
    this.parentNode = null;
    this.parentElement = null;
    this.listeners = {};
    this.className = attrs.class || '';
    this.style = {};
    this._textContent = '';
    this.title = attrs.title || '';
    this.type = attrs.type || '';
    this.id = attrs.id || '';
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map(c => c.textContent).join('');
  }

  set textContent(val) {
    this._textContent = String(val);
    this.children = [];
  }

  get classList() {
    const self = this;
    return {
      add(cls) {
        const classes = self.className.trim() ? self.className.split(/\s+/) : [];
        if (!classes.includes(cls)) {
          classes.push(cls);
          self.className = classes.join(' ');
        }
      },
      remove(cls) {
        const classes = self.className.trim() ? self.className.split(/\s+/) : [];
        const idx = classes.indexOf(cls);
        if (idx !== -1) {
          classes.splice(idx, 1);
          self.className = classes.join(' ');
        }
      },
      contains(cls) {
        const classes = self.className.trim() ? self.className.split(/\s+/) : [];
        return classes.includes(cls);
      },
      toggle(cls, force) {
        if (force === undefined) {
          if (this.contains(cls)) {
            this.remove(cls);
            return false;
          } else {
            this.add(cls);
            return true;
          }
        } else if (force) {
          this.add(cls);
          return true;
        } else {
          this.remove(cls);
          return false;
        }
      }
    };
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      return this.dataset[camel] !== undefined ? String(this.dataset[camel]) : null;
    }
    return this.attributes[name] !== undefined ? String(this.attributes[name]) : null;
  }

  setAttribute(name, val) {
    if (name === 'id') {
      this.id = String(val);
      return;
    }
    if (name === 'class') {
      this.className = String(val);
      return;
    }
    this.attributes[name] = String(val);
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      this.dataset[camel] = String(val);
    }
  }

  removeAttribute(name) {
    if (name === 'id') {
      this.id = '';
      return;
    }
    if (name === 'class') {
      this.className = '';
      return;
    }
    delete this.attributes[name];
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      delete this.dataset[camel];
    }
  }

  hasAttribute(name) {
    if (name === 'id') return Boolean(this.id);
    if (name === 'class') return Boolean(this.className);
    return this.attributes[name] !== undefined;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    child.parentElement = this;
    return child;
  }

  insertBefore(newNode, referenceNode) {
    const idx = this.children.indexOf(referenceNode);
    if (idx !== -1) {
      this.children.splice(idx, 0, newNode);
    } else {
      this.children.push(newNode);
    }
    newNode.parentNode = this;
    newNode.parentElement = this;
    return newNode;
  }

  insertAdjacentElement(position, element) {
    if (!this.parentNode) return element;
    const parent = this.parentNode;
    const idx = parent.children.indexOf(this);
    if (position === 'beforebegin') {
      parent.insertBefore(element, this);
    } else if (position === 'afterbegin') {
      this.insertBefore(element, this.children[0] || null);
    } else if (position === 'beforeend') {
      this.appendChild(element);
    } else if (position === 'afterend') {
      if (idx !== -1 && idx + 1 < parent.children.length) {
        parent.insertBefore(element, parent.children[idx + 1]);
      } else {
        parent.appendChild(element);
      }
    }
    return element;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
      child.parentElement = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  addEventListener(type, cb) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }

  removeEventListener(type, cb) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter(f => f !== cb);
    }
  }

  dispatchEvent(event) {
    if (this.listeners[event.type]) {
      for (const cb of this.listeners[event.type]) {
        cb(event);
      }
    }
    return true;
  }

  contains(node) {
    if (!node) return false;
    if (node === this) return true;
    let curr = node.parentNode || node.parentElement;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode || curr.parentElement;
    }
    return false;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (matchesSelector(curr, selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }
}

function matchesSelector(el, selector) {
  if (!el || !selector) return false;
  const parts = selector.split(',').map(s => s.trim());
  for (const part of parts) {
    if (matchSingle(el, part)) return true;
  }
  return false;
}

function matchSingle(el, sel) {
  if (sel === '*') return true;

  const attrMatch = sel.match(/^([a-zA-Z0-9_-]+)?\[([a-zA-Z0-9_-]+)(?:=(?:"|')?([^"']*)(?:"|')?)?\]$/);
  if (attrMatch) {
    const [, tag, attr, val] = attrMatch;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    if (!el.hasAttribute(attr)) return false;
    if (val !== undefined && el.getAttribute(attr) !== val) return false;
    return true;
  }

  if (sel.includes('.')) {
    const dotIdx = sel.indexOf('.');
    const tag = sel.slice(0, dotIdx);
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    const classes = sel.slice(dotIdx).split('.').filter(Boolean);
    return classes.every(c => el.classList.contains(c));
  }

  if (/^[a-zA-Z0-9_-]+$/.test(sel)) {
    return el.tagName === sel.toUpperCase();
  }

  return false;
}

function createMockEnvironment({ pathname = '/', storageData = {} } = {}) {
  const doc = new MockDOMElement('document');
  const html = new MockDOMElement('html');
  const head = new MockDOMElement('head');
  const body = new MockDOMElement('body');
  doc.appendChild(html);
  html.appendChild(head);
  html.appendChild(body);
  doc.head = head;
  doc.body = body;
  doc.documentElement = html;
  doc.readyState = 'complete';

  doc.createElement = (tag) => new MockDOMElement(tag);
  doc.createElementNS = (_ns, tag) => new MockDOMElement(tag);
  doc.getElementById = (id) => {
    const all = doc.querySelectorAll('*');
    return all.find(el => el.id === id) || null;
  };
  doc.querySelector = (sel) => {
    if (sel === 'body') return body;
    if (sel === 'head') return head;
    return MockDOMElement.prototype.querySelector.call(doc, sel);
  };

  const storage = {
    sync: {
      showRedditInlineButton: true,
      showRedditButtonInFeed: true,
      showRedditButtonInPost: true,
      ...storageData
    }
  };

  const storageListeners = [];
  const runtimeMessageListeners = [];
  const sentMessages = [];

  const timers = new Map();
  let timerCounter = 1;

  const mockContext = {
    console,
    Math,
    setTimeout(fn, ms) {
      const id = timerCounter++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    location: {
      pathname,
      href: `https://www.reddit.com${pathname}`
    },
    window: {
      location: {
        pathname,
        href: `https://www.reddit.com${pathname}`
      },
      document: doc,
      t(k) {
        if (k === 'reddit_btn_label') return 'AI';
        if (k === 'reddit_btn_tooltip') return 'Summarize thread with AI';
        return k;
      },
      initI18n: async () => {},
      addEventListener() {},
      removeEventListener() {}
    },
    document: doc,
    MutationObserver: class MockMutationObserver {
      constructor(callback) {
        this.callback = callback;
        MockMutationObserver.instances.push(this);
      }
      observe() {}
      disconnect() {}
      static instances = [];
    },
    chrome: {
      runtime: {
        getURL(path) {
          return `chrome-extension://mock-id/${path}`;
        },
        sendMessage(msg, cb) {
          sentMessages.push(msg);
          cb?.({ ok: true });
        },
        onMessage: {
          addListener(fn) {
            runtimeMessageListeners.push(fn);
          }
        }
      },
      storage: {
        sync: {
          get(keys, cb) {
            const res = {};
            if (Array.isArray(keys)) {
              for (const k of keys) {
                res[k] = storage.sync[k];
              }
            } else if (typeof keys === 'object' && keys !== null) {
              for (const k in keys) {
                res[k] = storage.sync[k] !== undefined ? storage.sync[k] : keys[k];
              }
            } else if (typeof keys === 'string') {
              res[keys] = storage.sync[keys];
            } else {
              Object.assign(res, storage.sync);
            }
            cb(res);
          },
          set(items, cb) {
            Object.assign(storage.sync, items);
            cb?.();
          }
        },
        onChanged: {
          addListener(fn) {
            storageListeners.push(fn);
          }
        }
      }
    }
  };

  mockContext.window.window = mockContext.window;

  return {
    context: mockContext,
    doc,
    body,
    head,
    storage,
    storageListeners,
    runtimeMessageListeners,
    sentMessages,
    triggerStorageChange(changes, areaName = 'sync') {
      for (const fn of storageListeners) {
        fn(changes, areaName);
      }
    },
    triggerRuntimeMessage(msg) {
      for (const fn of runtimeMessageListeners) {
        fn(msg);
      }
    }
  };
}

test('redditInlineButton.js injects button into feed post card and handles clicks when feed enabled', async () => {
  const env = createMockEnvironment({
    pathname: '/r/technology/',
    storageData: {
      showRedditInlineButton: true,
      showRedditButtonInFeed: true,
      showRedditButtonInPost: true
    }
  });
  
  // Setup post element in DOM
  const post = new MockDOMElement('shreddit-post', {
    permalink: '/r/technology/comments/abc123/tech_breakthrough/'
  });
  const actionRow = new MockDOMElement('div', { slot: 'action-row' });
  post.appendChild(actionRow);
  env.body.appendChild(post);

  const code = await readFile(new URL('../src/redditInlineButton.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, env.context, { filename: 'redditInlineButton.js' });
  await new Promise(r => setImmediate(r));

  // Verify button injected
  const button = actionRow.querySelector('.r2ai-inline-btn');
  assert.ok(button, 'Button with class .r2ai-inline-btn must be injected into action-row');
  assert.equal(actionRow.getAttribute('data-r2ai-injected'), 'true', 'Action row must be marked as injected');

  // Verify button content
  const label = button.querySelector('.r2ai-btn-text');
  assert.ok(label, 'Button must contain .r2ai-btn-text');
  assert.equal(label.textContent, 'Summarize with AI');

  const spinner = button.querySelector('.r2ai-btn-spinner');
  assert.ok(spinner, 'Button must contain .r2ai-btn-spinner');

  // Click button
  let prevented = false;
  let stopped = false;
  const clickEvent = {
    type: 'click',
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; }
  };
  button.dispatchEvent(clickEvent);

  assert.ok(prevented, 'Click event should preventDefault');
  assert.ok(stopped, 'Click event should stopPropagation');
  assert.ok(button.classList.contains('is-loading'), 'Button should have .is-loading class after click');
  assert.equal(spinner.style.display, 'inline-block', 'Spinner must be set to inline-block on click');
  const sparkle = button.querySelector('.r2ai-sparkle-icon');
  assert.ok(sparkle, 'Button must contain .r2ai-sparkle-icon');
  assert.equal(sparkle.style.display, 'none', 'Sparkle icon must be set to display: none on click');

  // Verify message sent to background with threadUrl
  assert.equal(env.sentMessages.length, 1);
  assert.equal(env.sentMessages[0].action, 'scrapeReddit');
  assert.equal(
    env.sentMessages[0].threadUrl,
    'https://www.reddit.com/r/technology/comments/abc123/tech_breakthrough/'
  );

  // Clicking again while loading should not dispatch additional messages
  button.dispatchEvent(clickEvent);
  assert.equal(env.sentMessages.length, 1);

  // Update floating panel message to complete
  env.triggerRuntimeMessage({
    action: 'updateFloatingPanel',
    data: { isActive: false, status: 'complete', message: 'Done' }
  });

  assert.equal(button.classList.contains('is-loading'), false, 'Button loading state must reset upon completion');
  assert.equal(spinner.style.display, '', 'Spinner display must be reset upon completion');
  assert.equal(sparkle.style.display, '', 'Sparkle display must be reset upon completion');
});

test('redditInlineButton.js handles post detail view clicks without threadUrl parameter', async () => {
  const env = createMockEnvironment({ pathname: '/r/science/comments/xyz789/study_published/' });

  const post = new MockDOMElement('shreddit-post', {
    permalink: '/r/science/comments/xyz789/study_published/'
  });
  const actionRow = new MockDOMElement('div', { slot: 'action-row' });
  post.appendChild(actionRow);
  env.body.appendChild(post);

  const code = await readFile(new URL('../src/redditInlineButton.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, env.context, { filename: 'redditInlineButton.js' });
  await new Promise(r => setImmediate(r));

  const button = actionRow.querySelector('.r2ai-inline-btn');
  assert.ok(button, 'Button must be injected on post detail page');

  button.dispatchEvent({
    type: 'click',
    preventDefault() {},
    stopPropagation() {}
  });

  assert.equal(env.sentMessages.length, 1);
  assert.equal(env.sentMessages[0].action, 'scrapeReddit');
  assert.ok(
    !env.sentMessages[0].threadUrl || env.sentMessages[0].threadUrl.includes('xyz789'),
    'Active post scrape message should be sent'
  );
});

test('redditInlineButton.js respects master toggle and sub-toggles', async () => {
  const env = createMockEnvironment({
    pathname: '/r/all/',
    storageData: {
      showRedditInlineButton: true,
      showRedditButtonInFeed: true,
      showRedditButtonInPost: true
    }
  });

  const post1 = new MockDOMElement('shreddit-post', { permalink: '/r/all/comments/1/' });
  const row1 = new MockDOMElement('div', { slot: 'action-row' });
  post1.appendChild(row1);
  env.body.appendChild(post1);

  const code = await readFile(new URL('../src/redditInlineButton.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, env.context, { filename: 'redditInlineButton.js' });
  await new Promise(r => setImmediate(r));

  assert.ok(row1.querySelector('.r2ai-inline-btn'), 'Button injected initially in feed');

  // Disable feed sub-toggle
  env.triggerStorageChange({
    showRedditButtonInFeed: { oldValue: true, newValue: false }
  });

  assert.equal(row1.querySelector('.r2ai-inline-btn'), null, 'Button must be removed when feed sub-toggle is disabled');

  // Re-enable feed sub-toggle
  env.triggerStorageChange({
    showRedditButtonInFeed: { oldValue: false, newValue: true }
  });

  assert.ok(row1.querySelector('.r2ai-inline-btn'), 'Button must be re-injected when feed sub-toggle is re-enabled');

  // Disable master toggle
  env.triggerStorageChange({
    showRedditInlineButton: { oldValue: true, newValue: false }
  });

  assert.equal(row1.querySelector('.r2ai-inline-btn'), null, 'All buttons must be removed when master toggle is disabled');
});

test('redditInlineButton.js places button immediately next to Share button with Summarize with AI label', async () => {
  const env = createMockEnvironment({
    pathname: '/r/chrome_extensions/comments/abc123/test_post/',
    storageData: {
      showRedditInlineButton: true,
      showRedditButtonInFeed: true,
      showRedditButtonInPost: true
    }
  });

  const post = new MockDOMElement('shreddit-post', { permalink: '/r/chrome_extensions/comments/abc123/test_post/' });
  const actionRow = new MockDOMElement('div', { slot: 'action-row' });
  const upvoteBtn = new MockDOMElement('button', { class: 'upvote-btn' });
  const commentBtn = new MockDOMElement('button', { class: 'comment-btn' });
  const shareBtn = new MockDOMElement('shreddit-post-share-button');

  actionRow.appendChild(upvoteBtn);
  actionRow.appendChild(commentBtn);
  actionRow.appendChild(shareBtn);
  post.appendChild(actionRow);
  env.body.appendChild(post);

  const code = await readFile(new URL('../src/redditInlineButton.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, env.context, { filename: 'redditInlineButton.js' });
  await new Promise(r => setImmediate(r));

  const button = actionRow.querySelector('.r2ai-inline-btn');
  assert.ok(button, 'Button must be injected');
  assert.equal(button.querySelector('.r2ai-btn-text')?.textContent, 'Summarize with AI', 'Button text must say what it does');

  // Verify position: button must be immediately after shareBtn in actionRow.children
  const shareIdx = actionRow.children.indexOf(shareBtn);
  const buttonIdx = actionRow.children.indexOf(button);
  assert.equal(buttonIdx, shareIdx + 1, 'Reddit-to-AI button must be placed immediately after the Share button');
});

test('redditInlineButton.js injects button in feed post cards using slot=credit-bar', async () => {
  const env = createMockEnvironment({
    pathname: '/r/pcmasterrace/',
    storageData: {
      showRedditInlineButton: true,
      showRedditButtonInFeed: true,
      showRedditButtonInPost: true
    }
  });

  const post = new MockDOMElement('shreddit-post', { permalink: '/r/pcmasterrace/comments/123/meme/' });
  const creditBar = new MockDOMElement('div', { slot: 'credit-bar' });
  const shareBtn = new MockDOMElement('shreddit-post-share-button');
  creditBar.appendChild(shareBtn);
  post.appendChild(creditBar);
  env.body.appendChild(post);

  const code = await readFile(new URL('../src/redditInlineButton.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, env.context, { filename: 'redditInlineButton.js' });
  await new Promise(r => setImmediate(r));

  const button = creditBar.querySelector('.r2ai-inline-btn');
  assert.ok(button, 'Button must be injected into credit-bar next to share');
  const shareIdx = creditBar.children.indexOf(shareBtn);
  const buttonIdx = creditBar.children.indexOf(button);
  assert.equal(buttonIdx, shareIdx + 1, 'Button must be placed immediately after the Share button in credit-bar');
});

test('redditInlineButton.js assigns context-aware spacing classes and margins (in-post 8px vs in-feed 4px)', async () => {
  // 1. In-Post view
  const postEnv = createMockEnvironment({ pathname: '/r/news/comments/abc1234/headline/' });
  const postElement = new MockDOMElement('shreddit-post', { permalink: '/r/news/comments/abc1234/headline/' });
  const postActionRow = new MockDOMElement('div', { slot: 'action-row' });
  const postShare = new MockDOMElement('shreddit-post-share-button');
  postActionRow.appendChild(postShare);
  postElement.appendChild(postActionRow);
  postEnv.body.appendChild(postElement);

  const code = await readFile(new URL('../src/redditInlineButton.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, postEnv.context, { filename: 'redditInlineButton.js' });
  await new Promise(r => setImmediate(r));

  const postBtn = postActionRow.querySelector('.r2ai-inline-btn');
  assert.ok(postBtn, 'In-post button must be present');
  assert.ok(postBtn.classList.contains('r2ai-in-post'), 'In-post button must have r2ai-in-post class');
  assert.equal(postBtn.style.margin, '0 0 0 8px', 'In-post button style.margin must be 8px');
  assert.equal(postBtn.style.gap, '4px', 'In-post button style.gap must be 4px');

  // 2. In-Feed view
  const feedEnv = createMockEnvironment({
    pathname: '/r/news/',
    storageData: { showRedditButtonInFeed: true }
  });
  const feedElement = new MockDOMElement('shreddit-post', { permalink: '/r/news/comments/xyz9876/feed_item/' });
  const feedCreditBar = new MockDOMElement('div', { slot: 'credit-bar' });
  const feedShare = new MockDOMElement('shreddit-post-share-button');
  feedCreditBar.appendChild(feedShare);
  feedElement.appendChild(feedCreditBar);
  feedEnv.body.appendChild(feedElement);

  vm.runInNewContext(code, feedEnv.context, { filename: 'redditInlineButton.js' });
  await new Promise(r => setImmediate(r));

  const feedBtn = feedCreditBar.querySelector('.r2ai-inline-btn');
  assert.ok(feedBtn, 'In-feed button must be present');
  assert.ok(feedBtn.classList.contains('r2ai-in-feed'), 'In-feed button must have r2ai-in-feed class');
  assert.equal(feedBtn.style.margin, '0 0 0 4px', 'In-feed button style.margin must be 4px');
  assert.equal(feedBtn.style.gap, '4px', 'In-feed button style.gap must be 4px');
  assert.equal(feedBtn.style.position, 'relative', 'Button style.position must be relative');
  assert.equal(feedBtn.style.zIndex, '10', 'Button style.zIndex must be 10');
  assert.equal(feedBtn.style.pointerEvents, 'auto', 'Button style.pointerEvents must be auto');

  // Verify pointerdown and mousedown event stopPropagation
  let pointerdownStopped = false;
  feedBtn.dispatchEvent({
    type: 'pointerdown',
    stopPropagation() { pointerdownStopped = true; }
  });
  assert.ok(pointerdownStopped, 'pointerdown should stopPropagation to prevent Reddit card navigation');

  let mousedownStopped = false;
  feedBtn.dispatchEvent({
    type: 'mousedown',
    stopPropagation() { mousedownStopped = true; }
  });
  assert.ok(mousedownStopped, 'mousedown should stopPropagation to prevent Reddit card navigation');
});
