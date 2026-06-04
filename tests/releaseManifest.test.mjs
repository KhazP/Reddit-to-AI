import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

assert.equal(manifest.manifest_version, 3, 'release manifest must use MV3');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'manifest version must be semver-like for upload naming');
assert.equal(packageJson.version, manifest.version, 'package and manifest versions must match');
assert.equal(manifest.default_locale, 'en', 'default locale must stay aligned with _locales/en');
assert.equal(manifest.action?.default_popup, 'popup.html', 'popup page must be packaged');
assert.equal(manifest.options_page, 'options.html', 'options page must be packaged');
assert.equal(manifest.background?.service_worker, 'service_worker.js', 'service worker must be packaged');

for (const permission of ['activeTab', 'scripting', 'storage', 'notifications', 'tabs']) {
  assert.ok(manifest.permissions.includes(permission), `expected permission: ${permission}`);
}

const allowedPermissions = new Set(['activeTab', 'scripting', 'storage', 'notifications', 'tabs']);
for (const permission of manifest.permissions) {
  assert.ok(allowedPermissions.has(permission), `unexpected permission: ${permission}`);
}

const allowedHosts = new Set([
  '*://*.reddit.com/*',
  'https://*.redd.it/*',
  'https://i.redd.it/*',
  'https://preview.redd.it/*',
  'https://external-preview.redd.it/*',
  'https://gemini.google.com/*',
  'https://chatgpt.com/*',
  'https://claude.ai/*',
  'https://aistudio.google.com/*',
  'https://chat.deepseek.com/*',
  'https://*.groq.com/*'
]);
for (const host of manifest.host_permissions) {
  assert.ok(allowedHosts.has(host), `unexpected host permission: ${host}`);
}

for (const icon of ['16', '48', '128']) {
  assert.ok(manifest.icons?.[icon], `manifest icon ${icon} is required`);
  assert.ok(manifest.action?.default_icon?.[icon], `action icon ${icon} is required`);
}

assert.ok(
  manifest.web_accessible_resources?.some(entry => entry.resources?.includes('_locales/**/*.json')),
  'locale files must remain available to extension pages'
);

for (const entry of manifest.web_accessible_resources || []) {
  assert.ok(!entry.matches?.includes('<all_urls>'), 'web accessible resources must not be exposed to all URLs');
  assert.ok(entry.matches?.some(match => match.includes('reddit.com')), 'resources should be available on Reddit pages');
  assert.ok(entry.matches?.some(match => match.includes('chatgpt.com')), 'resources should be available on supported AI pages');
}
