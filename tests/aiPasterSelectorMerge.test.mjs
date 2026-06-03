import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function createContext({ hostname, syncedSelectors = null, customSelectors = null }) {
  return {
    console,
    location: { hostname },
    window: { location: { hostname } },
    chrome: {
      storage: {
        local: {
          get(key, callback) {
            callback(syncedSelectors ? { syncedSelectors } : {});
          }
        },
        sync: {
          get(key, callback) {
            callback(customSelectors ? { customSelectors } : {});
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

console.log('AI Paster selector merge unit tests passed!');
