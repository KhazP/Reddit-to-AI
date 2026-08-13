// Covers paste-target selection: the composer is chosen by scoring every visible
// match rather than taking the first querySelector hit, and login detection only
// runs after the composer search has actually failed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const VIEWPORT_HEIGHT = 900;

// A minimal element good enough for the scorer: attributes, a class name, and a box.
function makeEl({
  tagName = 'div',
  attributes = {},
  className = '',
  rect = { width: 600, height: 120, bottom: 860 },
  offsetParent = {},
  hidden = false
} = {}) {
  return {
    tagName,
    className,
    hidden,
    offsetParent,
    attributes,
    getAttribute(name) {
      return attributes[name] !== undefined ? String(attributes[name]) : null;
    },
    getBoundingClientRect() {
      return rect;
    }
  };
}

function createContext({ candidates = [], bodyText = 'Ready', href = 'https://claude.ai/new' } = {}) {
  const context = {
    console: { log() {}, warn() {}, error() {}, debug() {} },
    Array,
    Math,
    Infinity,
    String,
    Promise,
    Date,
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
    clearInterval: (id) => globalThis.clearInterval(id),
    location: { href, hostname: new URL(href).hostname },
    document: {
      documentElement: null,
      body: { innerText: bodyText },
      querySelectorAll: () => candidates,
      querySelector: () => candidates[0] || null
    },
    chrome: {
      storage: {
        local: { get(_k, cb) { cb({}); } },
        sync: { get(_k, cb) { cb({}); } }
      }
    },
    R2AIAiPasterTest: {}
  };
  context.window = { location: context.location, innerHeight: VIEWPORT_HEIGHT };
  return context;
}

async function loadAiPaster(context) {
  const source = await readFile(new URL('../src/aiPaster.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context, { filename: 'aiPaster.js' });
  return context.R2AIAiPasterTest;
}

// 1. A hidden editable that appears first in document order loses to the visible,
//    properly-labelled composer that follows it. This is the Claude/Gemini bug:
//    the bare [contenteditable="true"] fallback used to grab the wrong element.
{
  const hiddenFirst = makeEl({
    attributes: { contenteditable: 'true' },
    rect: { width: 0, height: 0, bottom: 0 },
    offsetParent: null
  });
  const realComposer = makeEl({
    attributes: { contenteditable: 'true', role: 'textbox', 'aria-label': 'Write your prompt to Claude' },
    className: 'ProseMirror',
    rect: { width: 620, height: 140, bottom: 870 }
  });

  const context = createContext({ candidates: [hiddenFirst, realComposer] });
  const api = await loadAiPaster(context);

  assert.equal(api.pickBestCandidate('[contenteditable="true"]'), realComposer,
    'the visible, labelled composer wins over the earlier hidden editable');
}

// 2. Among two visible editables, the labelled one near the viewport bottom wins
//    over a small unlabelled box near the top.
{
  const strayEditable = makeEl({
    attributes: { contenteditable: 'true' },
    rect: { width: 120, height: 24, bottom: 60 }
  });
  const composer = makeEl({
    tagName: 'textarea',
    attributes: { contenteditable: 'true', 'aria-label': 'Message ChatGPT' },
    rect: { width: 640, height: 130, bottom: 880 }
  });

  const context = createContext({ candidates: [strayEditable, composer] });
  const api = await loadAiPaster(context);

  assert.ok(api.scoreCandidate(composer) > api.scoreCandidate(strayEditable),
    'the labelled bottom-anchored composer scores higher');
  assert.equal(api.pickBestCandidate('textarea, [contenteditable="true"]'), composer);
}

// 3. waitForInput resolves immediately when a viable candidate is already present,
//    without waiting out any polling schedule.
{
  const composer = makeEl({ tagName: 'textarea', attributes: { 'aria-label': 'Send a message' } });
  const context = createContext({ candidates: [composer] });
  const api = await loadAiPaster(context);

  const started = Date.now();
  const found = await api.waitForInput('textarea', 5000);
  assert.equal(found, composer);
  assert.ok(Date.now() - started < 250, 'resolves synchronously rather than sleeping');
}

// 4. With no candidate at all, waitForInput gives up after its timeout budget and
//    returns null instead of a wrong element.
{
  const context = createContext({ candidates: [] });
  const api = await loadAiPaster(context);
  const found = await api.waitForInput('textarea', 60);
  assert.equal(found, null);
}

// 5. Login detection still works, but it is only reachable from the failure path.
{
  const context = createContext({ candidates: [], bodyText: 'Please sign in to continue' });
  const api = await loadAiPaster(context);
  assert.match(api.detectLoginRequired(), /sign-in/i);

  const source = await readFile(new URL('../src/aiPaster.js', import.meta.url), 'utf8');
  const attemptBody = source.slice(source.indexOf('async function attemptPaste'), source.indexOf('function detectLoginRequired'));
  assert.ok(
    attemptBody.indexOf('await waitForInput') < attemptBody.indexOf('detectLoginRequired()'),
    'the composer search runs before login detection'
  );
}

// 6. The fixed retry loop is gone in favour of an observer + overall timeout.
{
  const source = await readFile(new URL('../src/aiPaster.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /INPUT_RETRY_LIMIT/, 'the fixed poll count is removed');
  assert.match(source, /MutationObserver/, 'a MutationObserver drives the wait');
  assert.match(source, /INPUT_WAIT_TIMEOUT = 20000/, 'an overall timeout bounds the wait');
}

console.log('AI Paster target selection tests passed!');
