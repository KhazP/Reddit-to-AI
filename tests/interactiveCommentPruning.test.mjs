import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class MockElement {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.children = [];
    this.eventListeners = {};
    this.className = attributes.class || '';
    this.disabled = false;
    this.checked = attributes.checked || false;
    this.innerHTML = '';
    this.textContent = '';
    this.style = {};
  }

  get classList() {
    const self = this;
    return {
      contains(cls) {
        return self.className.split(/\s+/).includes(cls);
      },
      add(cls) {
        if (!this.contains(cls)) {
          self.className = (self.className + ' ' + cls).trim();
        }
      },
      remove(cls) {
        self.className = self.className.split(/\s+/).filter(c => c !== cls).join(' ');
      }
    };
  }

  getAttribute(name) {
    if (name === 'class') return this.className;
    return this.attributes[name] !== undefined ? String(this.attributes[name]) : null;
  }

  setAttribute(name, val) {
    this.attributes[name] = val;
  }

  appendChild(child) {
    this.children.push(child);
    child.parent = this;
  }

  addEventListener(event, listener) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(listener);
  }

  dispatchEvent(eventObj) {
    const listeners = this.eventListeners[eventObj.type] || [];
    for (const listener of listeners) {
      listener(eventObj);
    }
  }

  querySelector(selector) {
    if (selector === ':scope > .comment-checkbox') {
      return this.children.find(child => child.classList.contains('comment-checkbox')) || null;
    }
    if (selector === ':scope > .comment-summary > .comment-checkbox') {
      const summary = this.children.find(child => child.tagName === 'SUMMARY');
      if (!summary) return null;
      return summary.children.find(child => child.classList.contains('comment-checkbox')) || null;
    }
    if (selector.startsWith(':scope >')) {
      const sub = selector.replace(':scope >', '').trim();
      return this.querySelector(sub);
    }
    if (selector.startsWith('#')) {
      const id = selector.substring(1);
      return this._find(node => node.getAttribute('id') === id);
    }
    if (selector.startsWith('.')) {
      const cls = selector.substring(1);
      return this._find(node => node.classList.contains(cls));
    }
    return this._find(node => node.tagName === selector.toUpperCase());
  }

  querySelectorAll(selector) {
    if (selector === ':scope > .comment-node, :scope > .comment-leaf') {
      return this.children.filter(child => 
        child.classList.contains('comment-node') || child.classList.contains('comment-leaf')
      );
    }
    if (selector === '.comment-checkbox') {
      const results = [];
      this._findAll(node => node.classList.contains('comment-checkbox'), results);
      return results;
    }
    const results = [];
    this._findAll(node => {
      if (selector.startsWith('.')) {
        const cls = selector.substring(1);
        return node.classList.contains(cls);
      }
      return node.tagName === selector.toUpperCase();
    }, results);
    return results;
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

// Simple parser to build MockElement hierarchy from HTML
function parseHtmlToMock(htmlStr) {
  const root = new MockElement('div');
  // We will parse commentsTreeContainer html structure
  // Since it's generated recursively, let's parse basic details/summary and input tags.
  // Extremely basic regex-based parser for our specific template:
  const regex = /<(details|summary|div|input|span|button|h2|p)([^>]*)>|([^<]+)|<\/([^>]+)>/g;
  let match;
  let current = root;
  const stack = [root];

  while ((match = regex.exec(htmlStr)) !== null) {
    const [full, tagOpen, attrsStr, text, tagClose] = match;
    if (tagOpen) {
      const attrs = {};
      if (attrsStr) {
        const attrMatches = attrsStr.matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g);
        for (const m of attrMatches) {
          attrs[m[1]] = m[2];
        }
        if (attrsStr.includes('checked')) {
          attrs.checked = true;
        }
      }
      const el = new MockElement(tagOpen, attrs);
      current.children.push(el);
      el.parent = current;
      if (tagOpen !== 'input') {
        stack.push(el);
        current = el;
      }
    } else if (text) {
      const trimmed = text.trim();
      if (trimmed) {
        current.textContent = (current.textContent + ' ' + trimmed).trim();
      }
    } else if (tagClose) {
      stack.pop();
      current = stack[stack.length - 1];
    }
  }
  return root;
}

const containerMock = new MockElement('div', { id: 'commentsTreeContainer' });

// Set innerHTML setter mock for commentsTreeContainer
Object.defineProperty(containerMock, 'innerHTML', {
  set(val) {
    this.children = parseHtmlToMock(val).children;
    for (const child of this.children) {
      child.parent = this;
    }
  },
  get() {
    return '';
  }
});

// Mock document to bind elements
const elementsRegistry = {
  'commentsTreeContainer': containerMock,
  'selectAllCommentsBtn': new MockElement('button', { id: 'selectAllCommentsBtn' }),
  'clearAllCommentsBtn': new MockElement('button', { id: 'clearAllCommentsBtn' }),
  'threadMeta': new MockElement('div', { id: 'threadMeta' }),
  'warningLabel': new MockElement('strong', { id: 'warningLabel' }),
  'warningMessage': new MockElement('p', { id: 'warningMessage' }),
  'charCount': new MockElement('strong', { id: 'charCount' }),
  'tokenCount': new MockElement('strong', { id: 'tokenCount' }),
  'commentCount': new MockElement('strong', { id: 'commentCount' }),
  'imageCount': new MockElement('strong', { id: 'imageCount' }),
  'meterFill': new MockElement('div', { id: 'meterFill' }),
  'budgetCard': new MockElement('section', { id: 'budgetCard' }),
  'contextPresetSelect': new MockElement('select', { id: 'contextPresetSelect' }),
  'trimStrategySelect': new MockElement('select', { id: 'trimStrategySelect' }),
  'mediaModeSelect': new MockElement('select', { id: 'mediaModeSelect' }),
  'providerSelect': new MockElement('select', { id: 'providerSelect' }),
  'outputFormatSelect': new MockElement('select', { id: 'outputFormatSelect' }),
  'promptTextarea': new MockElement('textarea', { id: 'promptTextarea' }),
  'settingsSummary': new MockElement('div', { id: 'settingsSummary' })
};

const documentMock = {
  domContentLoadedListener: null,
  getElementById(id) {
    if (elementsRegistry[id]) return elementsRegistry[id];
    return new MockElement('div', { id });
  },
  createElement(tagName) {
    return new MockElement(tagName);
  },
  addEventListener(event, listener) {
    if (event === 'DOMContentLoaded') {
      this.domContentLoadedListener = listener;
    }
  }
};

// Mock chrome APIs
const chromeMock = {
  runtime: {
    sendMessage(message, callback) {
      if (message.action === 'getPreviewData') {
        callback({
          data: {
            post: { title: 'Test Thread', subreddit: 'test', author: 'op', content: 'Test post body' },
            comments: [
              {
                id: 'c1',
                author: 'user1',
                score: 10,
                text: 'Top level 1',
                replies: [
                  { id: 'c1_1', author: 'user2', score: 5, text: 'Reply 1.1', replies: [] }
                ]
              },
              { id: 'c2', author: 'user3', score: 3, text: 'Top level 2', replies: [] }
            ],
            metadata: { commentCount: 3 }
          },
          settings: {
            contextPreset: 'balanced',
            trimStrategy: 'top',
            selectedLlmProvider: 'gemini'
          }
        });
      }
    }
  },
  storage: {
    sync: {
      get(keys, callback) { callback({}); },
      set(items, callback) { callback?.(); }
    }
  }
};

// Context setup
const context = {
  console,
  URL,
  Set,
  Math,
  Date,
  Intl,
  parseInt,
  Array,
  String,
  Boolean,
  Error,
  document: documentMock,
  chrome: chromeMock,
  setTimeout: (cb, ms) => cb(),
  globalThis: {}
};
context.window = context;

// Load scripts
const promptBuilderSrc = await readFile(new URL('../promptBuilder.js', import.meta.url), 'utf8');
vm.runInNewContext(promptBuilderSrc, context, { filename: 'promptBuilder.js' });

// Expose R2AIPrompt to VM context
context.R2AIPrompt = context.globalThis.R2AIPrompt;

const previewSrc = await readFile(new URL('../preview.js', import.meta.url), 'utf8');
vm.runInNewContext(previewSrc, context, { filename: 'preview.js' });

// Test comment HTML rendering and propagation
console.log('Running comment tree pruning unit tests...');

// Trigger DOMContentLoaded manually to initialize elements, events and data load
await documentMock.domContentLoadedListener();


// Assert that comments are rendered
const checkboxes = containerMock.querySelectorAll('.comment-checkbox');
assert.equal(checkboxes.length, 3, 'Should render 3 checkboxes for the comments');

// Verify elements are checked initially
for (const cb of checkboxes) {
  assert.equal(cb.checked, true, 'All comments should be checked initially');
  assert.equal(cb.disabled, false, 'All comments should be enabled initially');
}

// Get individual checkboxes
const cb1 = checkboxes.find(c => c.getAttribute('data-id') === 'c1');
const cb1_1 = checkboxes.find(c => c.getAttribute('data-id') === 'c1_1');
const cb2 = checkboxes.find(c => c.getAttribute('data-id') === 'c2');

assert.ok(cb1 && cb1_1 && cb2, 'All checkboxes must exist');

// Simulate unchecking top level c1
cb1.checked = false;
// Trigger change handler
containerMock.dispatchEvent({ type: 'change', target: cb1 });

// Verify that parent c1 is unchecked and child c1_1 is disabled
assert.equal(cb1.checked, false, 'c1 is unchecked');
assert.equal(cb1_1.disabled, true, 'c1_1 should be disabled because c1 is unchecked');

// Verify token calculation and prompt rebuild
const currentPrompt = elementsRegistry.promptTextarea.value;
assert.ok(!currentPrompt.includes('Top level 1'), 'Prompt should not contain c1 because it is unchecked');
assert.ok(!currentPrompt.includes('Reply 1.1'), 'Prompt should not contain c1_1 because its parent c1 is unchecked');
assert.ok(currentPrompt.includes('Top level 2'), 'Prompt should still contain c2 because it is checked and enabled');

// Verify Select All button
const selectAllBtn = elementsRegistry.selectAllCommentsBtn;
selectAllBtn.dispatchEvent({ type: 'click' });
// Verify all checked and enabled
for (const cb of checkboxes) {
  assert.equal(cb.checked, true, 'All checkboxes should be checked after Select All');
  assert.equal(cb.disabled, false, 'All checkboxes should be enabled/not disabled');
}

// Verify Clear All button
const clearAllBtn = elementsRegistry.clearAllCommentsBtn;
clearAllBtn.dispatchEvent({ type: 'click' });
// Verify c1 and c2 unchecked, child c1_1 disabled
assert.equal(cb1.checked, false, 'c1 is unchecked');
assert.equal(cb2.checked, false, 'c2 is unchecked');
assert.equal(cb1_1.disabled, true, 'c1_1 is disabled');

console.log('Interactive Comment Tree Pruning tests passed successfully.');
