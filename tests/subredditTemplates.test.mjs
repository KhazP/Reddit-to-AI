import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function createContext() {
  const syncStore = new Map();
  return {
    console: {
      log() {},
      error() {},
      debug() {}
    },
    Date,
    URL,
    URLSearchParams,
    importScripts() {},
    chrome: {
      i18n: { getMessage: () => '' },
      runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener() {} }
      },
      storage: {
        sync: {
          get(keys, callback) {
            const result = {};
            if (Array.isArray(keys)) {
              keys.forEach(k => result[k] = syncStore.get(k));
            } else if (typeof keys === 'string') {
              result[keys] = syncStore.get(keys);
            } else {
              Object.keys(keys).forEach(k => result[k] = syncStore.has(k) ? syncStore.get(k) : keys[k]);
            }
            callback(result);
          },
          set(items, callback) {
            Object.entries(items).forEach(([k, v]) => syncStore.set(k, v));
            callback?.();
          }
        },
        local: {
          get(keys, callback) {
            callback({});
          },
          set(items, callback) {
            callback?.();
          }
        }
      }
    },
    getSyncStore() { return syncStore; },
    R2AIServiceWorkerTest: {}
  };
}

async function loadServiceWorker(context) {
  const source = await readFile(new URL('../src/service_worker.js', import.meta.url), 'utf8');
  const parserSource = await readFile(new URL('../src/redditParser.js', import.meta.url), 'utf8');
  vm.runInNewContext(parserSource, context, { filename: 'redditParser.js' });
  vm.runInNewContext(source, context, { filename: 'service_worker.js' });
  return context.R2AIServiceWorkerTest;
}

// 1. Test matchSubredditPattern
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  const match = api.matchSubredditPattern;
  
  // Exact match
  assert.ok(match('cscareerquestions', 'cscareerquestions'));
  assert.ok(match('cscareerquestions', 'CSCareerQuestions')); // Case insensitive
  assert.ok(match('CSCareerQuestions', 'cscareerquestions')); // Case insensitive
  
  // Wildcard match (ends with)
  assert.ok(match('cscareerquestions', 'cscareer*'));
  assert.ok(match('cscareerquestions', 'CSCAREER*'));
  assert.ok(match('cscareer', 'cscareer*'));
  assert.ok(!match('careerquestions', 'cscareer*'));
  
  // Wildcard match (starts with)
  assert.ok(match('valueinvesting', '*investing'));
  assert.ok(!match('valueinvesting101', '*investing'));
  
  // Wildcard match (contains)
  assert.ok(match('valueinvesting101', '*investing*'));
  
  // No match
  assert.ok(!match('cscareerquestions', 'investing'));
  assert.ok(!match('cscareerquestions', 'cscareerquestion'));
  assert.ok(!match(null, 'cscareerquestions'));
  assert.ok(!match('cscareerquestions', null));
}

// 2. Test resolveSubredditSettings
{
  const context = createContext();
  const api = await loadServiceWorker(context);
  const resolve = api.resolveSubredditSettings;
  const presets = api.PRESET_TEMPLATES;
  
  const settings = {
    defaultPromptTemplate: 'Default prompt template',
    selectedPreset: 'custom',
    subredditPromptMappings: [
      { pattern: 'cscareerquestions', preset: 'debate' },
      { pattern: 'investing*', preset: 'sentiment' },
      { pattern: 'eli5', preset: 'eli5' }
    ]
  };
  
  // Matches exact pattern
  const res1 = resolve('cscareerquestions', settings);
  assert.equal(res1.selectedPreset, 'debate');
  assert.equal(res1.defaultPromptTemplate, presets.debate);
  
  // Matches wildcard pattern
  const res2 = resolve('investing_club', settings);
  assert.equal(res2.selectedPreset, 'sentiment');
  assert.equal(res2.defaultPromptTemplate, presets.sentiment);
  
  // No matching pattern
  const res3 = resolve('funny', settings);
  assert.equal(res3.selectedPreset, 'custom');
  assert.equal(res3.defaultPromptTemplate, 'Default prompt template');
  
  // Empty patterns/settings
  const res4 = resolve('cscareerquestions', {});
  assert.equal(res4.selectedPreset, undefined);
  
  const res5 = resolve(null, settings);
  assert.equal(res5.selectedPreset, 'custom');
}

console.log('Background subreddit templates unit tests passed!');
