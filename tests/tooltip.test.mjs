import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class MockClassList {
  constructor(element) {
    this.element = element;
  }

  add(className) {
    const classes = this.element.className.trim() ? this.element.className.split(/\s+/) : [];
    if (!classes.includes(className)) {
      classes.push(className);
      this.element.className = classes.join(' ');
    }
  }

  remove(className) {
    const classes = this.element.className.trim() ? this.element.className.split(/\s+/) : [];
    const idx = classes.indexOf(className);
    if (idx !== -1) {
      classes.splice(idx, 1);
      this.element.className = classes.join(' ');
    }
  }

  contains(className) {
    const classes = this.element.className.trim() ? this.element.className.split(/\s+/) : [];
    return classes.includes(className);
  }
}

class MockElement {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.dataset = {};
    for (const key in attributes) {
      if (key.startsWith('data-')) {
        const dataKey = key.slice(5).replace(/-([a-z])/g, g => g[1].toUpperCase());
        this.dataset[dataKey] = attributes[key];
      }
    }
    this.listeners = {};
    this.children = [];
    this.style = {};
    this.offsetWidth = 100;
    this.offsetHeight = 30;
    this.id = '';
    this.className = '';
    this.innerText = '';
    this.classList = new MockClassList(this);
  }

  getAttribute(name) {
    if (name.startsWith('data-')) {
      const dataKey = name.slice(5).replace(/-([a-z])/g, g => g[1].toUpperCase());
      return this.dataset[dataKey] !== undefined ? String(this.dataset[dataKey]) : null;
    }
    return this.attributes[name] !== undefined ? String(this.attributes[name]) : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) {
      const dataKey = name.slice(5).replace(/-([a-z])/g, g => g[1].toUpperCase());
      this.dataset[dataKey] = String(value);
    }
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name.startsWith('data-')) {
      const dataKey = name.slice(5).replace(/-([a-z])/g, g => g[1].toUpperCase());
      delete this.dataset[dataKey];
    }
  }

  hasAttribute(name) {
    return this.attributes[name] !== undefined;
  }

  addEventListener(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  trigger(event) {
    if (this.listeners[event]) {
      const eventObj = { type: event };
      for (const cb of this.listeners[event]) {
        cb(eventObj);
      }
    }
  }

  appendChild(child) {
    this.children.push(child);
    child.parent = this;
  }

  remove() {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx !== -1) {
        this.parent.children.splice(idx, 1);
      }
    }
  }

  getBoundingClientRect() {
    return {
      left: 100,
      top: 200,
      width: 50,
      height: 20
    };
  }
}

class MockDocument {
  constructor() {
    this.body = new MockElement('body');
    this.targets = [];
    this.readyState = 'complete';
  }

  querySelectorAll(selector) {
    if (selector === '[data-tooltip]') {
      return this.targets;
    }
    return [];
  }

  createElement(tagName) {
    return new MockElement(tagName);
  }
}

function createContext() {
  const doc = new MockDocument();
  const context = {
    console,
    Math,
    setTimeout: (callback) => {
      callback();
      return 0;
    },
    clearTimeout: () => {},
    window: {
      scrollY: 10,
      scrollX: 20,
      innerWidth: 1024,
      addEventListener() {},
      document: doc
    },
    document: doc,
    chrome: {
      i18n: {
        getMessage: (key) => `Trans-${key}`
      }
    }
  };
  context.window.window = context.window;
  return { context, doc };
}

// Run test
const source = await readFile(new URL('../tooltip.js', import.meta.url), 'utf8');

// 1. Basic Tooltip initialization and interaction
{
  const { context, doc } = createContext();
  const button = new MockElement('button', { 'data-tooltip': 'test_key' });
  doc.targets.push(button);

  vm.runInNewContext(source, context, { filename: 'tooltip.js' });

  // Verify initialization
  assert.equal(button.dataset.tooltipInitialized, 'true');

  // Trigger hover
  button.trigger('mouseenter');

  // Check tooltip bubble created in body
  assert.equal(doc.body.children.length, 1);
  const bubble = doc.body.children[0];
  assert.equal(bubble.tagName, 'DIV');
  assert.ok(bubble.classList.contains('tooltip-bubble'));
  assert.ok(bubble.classList.contains('visible'));
  assert.equal(bubble.innerText, 'Trans-test_key');
  assert.match(bubble.id, /^r2a-tooltip-\d+$/);

  // Check aria-describedby wired
  assert.equal(button.getAttribute('aria-describedby'), bubble.id);

  // Trigger blur/mouseleave
  button.trigger('mouseleave');

  // Verify tooltip is removed (since mock setTimeout executes synchronously)
  assert.equal(doc.body.children.length, 0);
  assert.equal(button.hasAttribute('aria-describedby'), false);
}

// 2. Keyboard Accessibility setting tabindex on non-focusable elements
{
  const { context, doc } = createContext();
  const div = new MockElement('div', { 'data-tooltip': 'div_tooltip' });
  const button = new MockElement('button', { 'data-tooltip': 'btn_tooltip' });
  doc.targets.push(div, button);

  vm.runInNewContext(source, context, { filename: 'tooltip.js' });

  // div is non-focusable, so it should get tabindex="0"
  assert.equal(div.getAttribute('tabindex'), '0');

  // button is natively focusable, so it should NOT get tabindex
  assert.equal(button.hasAttribute('tabindex'), false);
}

// 3. Viewport clamping and arrow centering positioning math
{
  const { context, doc } = createContext();
  const button = new MockElement('button', { 'data-tooltip': 'test' });
  doc.targets.push(button);

  // Place button close to the left edge of viewport (e.g. rect.left = 10, target width = 20)
  button.getBoundingClientRect = () => ({
    left: 10,
    top: 50,
    width: 20,
    height: 20
  });

  vm.runInNewContext(source, context, { filename: 'tooltip.js' });
  button.trigger('mouseenter');

  const bubble = doc.body.children[0];
  const arrow = bubble.children[0];

  // Target center = 10 (left) + 20 (scrollX) + 20/2 (half width) = 40
  // Tooltip width is 100. Center would be 40 - 50 = -10.
  // Clamped minLeft = scrollX + margin = 20 + 8 = 28.
  // Tooltip left should be clamped to 28.
  assert.equal(bubble.style.left, '28px');

  // Arrow center relative to tooltip = targetCenter - tooltipLeft = 40 - 28 = 12.
  // Arrow left = 12 - 3 = 9.
  assert.equal(arrow.style.left, '9px');
}

// 4. Visual Flicker & fast re-entry test
{
  const { context, doc } = createContext();
  const button = new MockElement('button', { 'data-tooltip': 'test' });
  doc.targets.push(button);

  // We want to control setTimeout ourselves for this test
  let timerCallback = null;
  context.setTimeout = (callback) => {
    timerCallback = callback;
    return 123; // timer ID
  };
  let clearedTimerId = null;
  context.clearTimeout = (id) => {
    clearedTimerId = id;
  };

  vm.runInNewContext(source, context, { filename: 'tooltip.js' });

  // First hover
  button.trigger('mouseenter');
  assert.equal(doc.body.children.length, 1);
  const bubble = doc.body.children[0];

  // Mouse leaves
  button.trigger('mouseleave');
  // Bubble should still be in DOM (not removed yet since setTimeout hasn't fired)
  assert.equal(doc.body.children.length, 1);
  assert.ok(timerCallback !== null);

  // Mouse enters again quickly
  button.trigger('mouseenter');
  // Timer should have been cleared
  assert.equal(clearedTimerId, 123);
  // Bubble is still there, and didn't duplicate
  assert.equal(doc.body.children.length, 1);
  assert.equal(doc.body.children[0], bubble);
}

// 5. Vertical scroll clamping test
{
  const { context, doc } = createContext();
  const button = new MockElement('button', { 'data-tooltip': 'test' });
  doc.targets.push(button);

  // Set window scrolled state
  context.window.scrollY = 500;

  // Position button close to the top of scroll viewport
  // rect.top is relative to viewport, so top relative to viewport = 10
  button.getBoundingClientRect = () => ({
    left: 200,
    top: 10,
    width: 50,
    height: 20
  });

  vm.runInNewContext(source, context, { filename: 'tooltip.js' });
  button.trigger('mouseenter');

  const bubble = doc.body.children[0];

  // top relative to document before clamping = rect.top + scrollY - height - 8
  // = 10 + 500 - 30 - 8 = 472.
  // Clamped top should be scrollY + 4 = 504.
  assert.equal(bubble.style.top, '504px');
}

// 6. Focus and hover de-synchronization test
{
  const { context, doc } = createContext();
  const button = new MockElement('button', { 'data-tooltip': 'test' });
  doc.targets.push(button);

  // We want to control setTimeout ourselves for this test
  let timerCallback = null;
  context.setTimeout = (callback) => {
    timerCallback = callback;
    return 456;
  };

  vm.runInNewContext(source, context, { filename: 'tooltip.js' });

  // 6a. Focus first, then hover, then mouseleave, then blur
  button.trigger('focus');
  assert.equal(doc.body.children.length, 1);

  button.trigger('mouseenter');
  assert.equal(doc.body.children.length, 1);

  // Mouse leaves - tooltip must remain visible because it is still focused!
  button.trigger('mouseleave');
  assert.equal(doc.body.children.length, 1);
  assert.equal(timerCallback, null); // no hide scheduled

  // Blur - now it should schedule hide and close
  button.trigger('blur');
  assert.ok(timerCallback !== null);
  timerCallback(); // execute hide
  assert.equal(doc.body.children.length, 0);

  // Reset timerCallback
  timerCallback = null;

  // 6b. Hover first, then focus, then blur, then mouseleave
  button.trigger('mouseenter');
  assert.equal(doc.body.children.length, 1);

  button.trigger('focus');
  assert.equal(doc.body.children.length, 1);

  // Blur - tooltip must remain visible because it is still hovered!
  button.trigger('blur');
  assert.equal(doc.body.children.length, 1);
  assert.equal(timerCallback, null); // no hide scheduled

  // Mouse leaves - now it should hide
  button.trigger('mouseleave');
  assert.ok(timerCallback !== null);
  timerCallback();
  assert.equal(doc.body.children.length, 0);
}

console.log('Tooltip unit tests passed successfully.');
