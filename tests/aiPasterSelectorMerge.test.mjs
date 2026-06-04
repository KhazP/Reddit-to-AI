import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function createContext({ hostname, href = '', syncedSelectors = null, customSelectors = null, customOrigins = null }) {
  const finalHref = href || `https://${hostname}/`;
  return {
    console,
    location: { hostname, href: finalHref },
    window: { location: { hostname, href: finalHref } },
    chrome: {
      storage: {
        local: {
          get(key, callback) {
            callback(syncedSelectors ? { syncedSelectors } : {});
          }
        },
        sync: {
          get(key, callback) {
            const res = {};
            if (customSelectors) res.customSelectors = customSelectors;
            if (customOrigins) res.customOrigins = customOrigins;
            callback(res);
          }
        }
      }
    },
    R2AIAiPasterTest: {}
  };
}

async function loadAiPaster(context) {
  const source = await readFile(new URL('../aiPaster.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context, { filename: 'aiPaster.js' });
  return context.R2AIAiPasterTest;
}

// Test Fallback to default
{
  const context = createContext({ hostname: 'chatgpt.com' });
  const api = await loadAiPaster(context);
  const target = await api.getPlatformInputTarget();
  assert.equal(target.inputSelector, '#prompt-textarea, div[contenteditable="true"]#prompt-textarea, textarea');
  assert.equal(target.isContentEditable, true);
}

// Test Synced override
{
  const context = createContext({
    hostname: 'gemini.google.com',
    syncedSelectors: {
      gemini: { inputSelector: '.synced-gemini', isContentEditable: false }
    }
  });
  const api = await loadAiPaster(context);
  const target = await api.getPlatformInputTarget();
  assert.equal(target.inputSelector, '.synced-gemini');
  assert.equal(target.isContentEditable, false);
}

// Test Custom Override (Custom > Synced > Default)
{
  const context = createContext({
    hostname: 'gemini.google.com',
    syncedSelectors: {
      gemini: { inputSelector: '.synced-gemini', isContentEditable: false }
    },
    customSelectors: {
      gemini: { inputSelector: '.custom-gemini' }
    }
  });
  const api = await loadAiPaster(context);
  const target = await api.getPlatformInputTarget();
  assert.equal(target.inputSelector, '.custom-gemini');
  // Should inherit isContentEditable from Synced override since custom didn't specify it
  assert.equal(target.isContentEditable, false);
}

// Test DeepSeek default
{
  const context = createContext({ hostname: 'chat.deepseek.com' });
  const api = await loadAiPaster(context);
  const target = await api.getPlatformInputTarget();
  assert.equal(target.inputSelector, 'textarea, #chat-input, div[contenteditable="true"]');
  assert.equal(target.isContentEditable, false);
}

// Test Groq default
{
  const context = createContext({ hostname: 'groq.com' });
  const api = await loadAiPaster(context);
  const target = await api.getPlatformInputTarget();
  assert.equal(target.inputSelector, 'textarea, #chat-input, div[contenteditable="true"]');
  assert.equal(target.isContentEditable, false);
}

// Test Custom platform with dynamic origin matching
{
  const context = createContext({
    hostname: 'localhost',
    href: 'http://localhost:3000/chat',
    customOrigins: ['http://localhost:3000/*']
  });
  const api = await loadAiPaster(context);
  const target = await api.getPlatformInputTarget();
  assert.equal(target.inputSelector, 'textarea, div[contenteditable="true"]');
  assert.equal(target.isContentEditable, false);
}

// Test Custom platform custom selector override
{
  const context = createContext({
    hostname: 'localhost',
    href: 'http://localhost:3000/chat',
    customOrigins: ['http://localhost:3000/*'],
    customSelectors: {
      custom: { inputSelector: '#custom-editor', isContentEditable: true }
    }
  });
  const api = await loadAiPaster(context);
  const target = await api.getPlatformInputTarget();
  assert.equal(target.inputSelector, '#custom-editor');
  assert.equal(target.isContentEditable, true);
}

console.log('AI Paster selector merge unit tests passed!');
