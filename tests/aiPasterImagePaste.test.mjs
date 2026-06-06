import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class FakeTextArea {
  constructor() {
    this.value = '';
    this.events = [];
  }

  focus() {
    this.focused = true;
  }

  dispatchEvent(event) {
    this.events.push(event);
    return true;
  }
}

function createElement(tagName = 'div') {
  return {
    tagName,
    style: {},
    children: [],
    append(...children) {
      this.children.push(...children);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener() {},
    remove() {},
    select() {},
    set textContent(value) {
      this._textContent = value;
    },
    get textContent() {
      return this._textContent || '';
    }
  };
}

function createContext({ imageResponses }) {
  const input = new FakeTextArea();
  const runtimeMessages = [];
  const body = createElement('body');
  body.innerText = 'Ready';

  const context = {
    console,
    Uint8Array,
    Blob,
    File: globalThis.File || class File extends Blob {
      constructor(parts, name, options) {
        super(parts, options);
        this.name = name;
        this.type = options?.type || '';
      }
    },
    HTMLTextAreaElement: FakeTextArea,
    HTMLInputElement: class FakeInput {},
    Event: class Event {
      constructor(type, init = {}) {
        this.type = type;
        Object.assign(this, init);
      }
    },
    InputEvent: class InputEvent {
      constructor(type, init = {}) {
        this.type = type;
        Object.assign(this, init);
      }
    },
    ClipboardEvent: class ClipboardEvent {
      constructor(type, init = {}) {
        this.type = type;
        Object.assign(this, init);
      }
    },
    DataTransfer: class DataTransfer {
      constructor() {
        this.items = {
          files: [],
          add(file) {
            this.files.push(file);
          }
        };
      }
    },
    atob(value) {
      return Buffer.from(value, 'base64').toString('binary');
    },
    setTimeout(callback) {
      callback();
      return 0;
    },
    sessionStorage: {
      values: new Map(),
      getItem(key) {
        return this.values.get(key) || null;
      },
      setItem(key, value) {
        this.values.set(key, value);
      }
    },
    navigator: { clipboard: { writeText: async () => {} } },
    location: { href: 'https://aistudio.google.com/prompts/new_chat', hostname: 'aistudio.google.com' },
    window: null,
    document: {
      body,
      querySelector() {
        return input;
      },
      execCommand() {
        return true;
      },
      createElement,
      getElementById() {
        return null;
      }
    },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          runtimeMessages.push(message);
          if (message.action === 'fetchImage') {
            callback(imageResponses[message.url] || { error: 'missing image mock' });
            return;
          }
          callback({ ok: true });
        }
      },
      storage: {
        local: { get(keys, callback) { callback({}); } },
        sync: { get(keys, callback) { callback({}); } }
      }
    },
    R2AIAiPasterTest: {}
  };
  context.window = {
    location: context.location,
    R2AIPrompt: null
  };
  return { context, input, runtimeMessages };
}

async function loadAiPaster(testContext) {
  const source = await readFile(new URL('../src/aiPaster.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, testContext, { filename: 'aiPaster.js' });
  return testContext.R2AIAiPasterTest;
}

const okImage = { base64: Buffer.from('image-bytes').toString('base64'), mimeType: 'image/png' };

{
  const { context, input } = createContext({
    imageResponses: {
      'https://example.test/one.png': okImage,
      'https://example.test/two.png': okImage
    }
  });
  const api = await loadAiPaster(context);
  const result = await api.pasteImages(input, ['https://example.test/one.png', 'https://example.test/two.png']);

  assert.deepEqual(
    { attempted: result.attempted, fetched: result.fetched, pasted: result.pasted },
    { attempted: 2, fetched: 2, pasted: 2 }
  );
  assert.equal(result.failures.length, 0);
}

{
  const { context, input, runtimeMessages } = createContext({
    imageResponses: {
      'https://example.test/ok.png': okImage,
      'https://example.test/fail.png': { error: 'network blocked' }
    }
  });
  const api = await loadAiPaster(context);
  await api.attemptPaste({
    promptText: 'Prompt text that should be inserted for verification.',
    mediaMode: 'attach',
    pasteId: 'paste-partial-images',
    aiProvider: 'chatgpt',
    data: {
      post: {
        images: ['https://example.test/ok.png', 'https://example.test/fail.png']
      }
    }
  });

  assert.equal(input.value, 'Prompt text that should be inserted for verification.');
  assert.ok(runtimeMessages.some(message => message.action === 'recordPasteFailure'));
  assert.ok(!runtimeMessages.some(message => message.action === 'markPendingPasteConsumed'));
  assert.equal(context.sessionStorage.getItem('redditToAiPastedId'), null);
}
