// Guards the security boundary around Direct API keys:
//  - the settings export allowlist stays free of anything key-shaped,
//  - exportSettings reads chrome.storage.sync, while keys live only in local,
//  - importSettings cannot write a key back in from a crafted file,
//  - no source file logs a key.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const optionsSource = await readFile(new URL('../src/options.js', import.meta.url), 'utf8');

// 1. The portable settings allowlist must not contain any key-like field. Only keys
//    named here can ever be exported, so this is the load-bearing assertion.
const allowlistMatch = optionsSource.match(/const PORTABLE_SETTING_TYPES = \{([\s\S]*?)\};/);
assert.ok(allowlistMatch, 'PORTABLE_SETTING_TYPES must exist in options.js');
const allowlistKeys = [...allowlistMatch[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*:/gm)].map(m => m[1]);
assert.ok(allowlistKeys.length > 0, 'the allowlist should not be empty');

const forbiddenPattern = /(apikey|api_key|secret|token|credential|password|bearer|directapi)/i;
for (const key of allowlistKeys) {
  assert.ok(
    !forbiddenPattern.test(key),
    `settings export allowlist must not contain a credential-like key: ${key}`
  );
}
assert.ok(!allowlistKeys.includes('directApiConfig'), 'directApiConfig must never be exportable');

// 2. exportSettings must read from chrome.storage.sync only. API keys are written to
//    chrome.storage.local, so a sync-scoped export cannot reach them even by mistake.
const exportBody = optionsSource.match(/function exportSettings\(\)\s*\{([\s\S]*?)\n    \}/);
assert.ok(exportBody, 'exportSettings must exist');
assert.match(exportBody[1], /chrome\.storage\.sync\.get/, 'exportSettings must read storage.sync');
assert.ok(
  !/chrome\.storage\.local/.test(exportBody[1]),
  'exportSettings must not read chrome.storage.local, where API keys live'
);
assert.match(
  exportBody[1],
  /Object\.keys\(PORTABLE_SETTING_TYPES\)/,
  'exportSettings must restrict itself to the allowlist'
);

// 3. Reproduce importSettings' filter: an import file carrying a key is dropped,
//    because unknown keys are not in the allowlist.
{
  const portableTypes = Object.fromEntries(allowlistKeys.map(key => [key, 'string']));
  const maliciousImport = {
    selectedPreset: 'summarize',
    directApiConfig: { anthropic: { apiKey: 'sk-attacker' } },
    apiKey: 'sk-attacker',
    openaiToken: 'sk-attacker'
  };
  const accepted = {};
  for (const [key, value] of Object.entries(maliciousImport)) {
    if (!portableTypes[key]) continue;
    accepted[key] = value;
  }
  assert.deepEqual(Object.keys(accepted), ['selectedPreset'], 'only allowlisted keys survive an import');
  assert.ok(!('directApiConfig' in accepted));
  assert.ok(!('apiKey' in accepted));
  assert.ok(!JSON.stringify(accepted).includes('sk-attacker'));
}

// 4. Keys must be stored in chrome.storage.local, never in sync.
{
  // Comments are stripped first so the assertion tests code, not the prose that
  // explains why the code is the way it is.
  const stripComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const serviceWorkerSource = await readFile(new URL('../src/service_worker.js', import.meta.url), 'utf8');
  assert.match(
    serviceWorkerSource,
    /getStorage\(chrome\.storage\.local, DIRECT_API_CONFIG_KEY\)/,
    'the service worker must read the API config from storage.local'
  );

  for (const [name, source] of [
    ['service_worker.js', stripComments(serviceWorkerSource)],
    ['options.js', stripComments(optionsSource)]
  ]) {
    // Any sync-area call that names the API config, in either direction.
    assert.ok(
      !/storage\.sync\.(get|set)\([^)]*(directApiConfig|DIRECT_API_CONFIG_KEY)/.test(source),
      `${name} must not use chrome.storage.sync for the API config`
    );
    assert.ok(
      !/getStorage\(chrome\.storage\.sync,\s*(DIRECT_API_CONFIG_KEY|'directApiConfig')/.test(source),
      `${name} must not read the API config from storage.sync`
    );
    assert.ok(
      !/setStorage\(chrome\.storage\.sync,\s*\{\s*\[?(DIRECT_API_CONFIG_KEY|'directApiConfig')/.test(source),
      `${name} must not write the API config to storage.sync`
    );
  }

  // Positive control: the options page persists the config through storage.local.
  assert.match(
    stripComments(optionsSource),
    /chrome\.storage\.local\.set\(\{\s*\[DIRECT_API_CONFIG_KEY\]/,
    'the options page must save the API config to storage.local'
  );
}

// 5. No source file may log a key or interpolate one into a message.
{
  const srcDir = new URL('../src/', import.meta.url);
  const files = (await readdir(srcDir)).filter(name => name.endsWith('.js'));
  const loggingPattern = /console\.(log|debug|warn|error|info)\([^)]*\b(apiKey|api_key|x-api-key)\b/i;
  for (const file of files) {
    const source = await readFile(new URL(file, srcDir), 'utf8');
    assert.ok(!loggingPattern.test(source), `${file} must never log an API key`);
  }
}

// 6. The provider module must place keys in headers only, never in a URL or body.
{
  const { R2AIApiProviders } = await import('../src/apiProviders.js').then(() => globalThis);
  const sentinel = 'SENTINEL-KEY-VALUE';
  for (const provider of R2AIApiProviders.PROVIDER_IDS) {
    const request = R2AIApiProviders.buildRequest(provider, {
      apiKey: sentinel,
      promptText: 'hello'
    });
    assert.ok(!request.url.includes(sentinel), `${provider}: key must not appear in the URL`);
    assert.ok(
      !JSON.stringify(request.body).includes(sentinel),
      `${provider}: key must not appear in the request body`
    );
    assert.ok(
      JSON.stringify(request.headers).includes(sentinel),
      `${provider}: key must be carried in a header`
    );
  }
}

console.log('Direct API key safety tests passed!');
