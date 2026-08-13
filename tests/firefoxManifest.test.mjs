import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BACKGROUND_LIBS, GECKO_ID, GECKO_MIN_VERSION, toFirefoxManifest } from '../scripts/firefox-manifest.mjs';

const chromeManifest = JSON.parse(await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8'));
const firefox = toFirefoxManifest(chromeManifest);

// --- background: event page, not a service worker -------------------------------
assert.ok(!('service_worker' in (firefox.background || {})), 'Firefox background must not declare a service worker');
assert.deepEqual(
  firefox.background.scripts,
  [...BACKGROUND_LIBS, 'service_worker.js'],
  'shared libraries must load before service_worker.js, in importScripts order'
);
assert.ok(!firefox.background.type, 'background scripts are classic scripts sharing one global scope, not modules');

// The Firefox script list stands in for the importScripts call, so the two must not
// drift apart. Parse the argument list straight out of the source.
const workerSource = await readFile(new URL('../src/service_worker.js', import.meta.url), 'utf8');
const importCall = workerSource.match(/importScripts\(([^)]*)\)/);
assert.ok(importCall, 'service_worker.js must still call importScripts for Chrome');
const importedFiles = [...importCall[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
assert.deepEqual(importedFiles, BACKGROUND_LIBS, 'BACKGROUND_LIBS must match the importScripts argument order');

// Firefox background pages have no importScripts, so the call must be guarded.
assert.match(
  workerSource,
  /typeof importScripts === 'function'/,
  'the importScripts call must be guarded so Firefox event pages can load the file'
);

// --- gecko settings --------------------------------------------------------------
assert.equal(firefox.browser_specific_settings.gecko.id, GECKO_ID, 'gecko id is required for installing/signing');
assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, GECKO_MIN_VERSION);
assert.match(GECKO_MIN_VERSION, /^\d+\.\d+$/, 'strict_min_version must be a Gecko version string');

// --- options page ----------------------------------------------------------------
// options_page is Chrome-only; without options_ui, runtime.openOptionsPage() is a no-op.
assert.ok(!('options_page' in firefox), 'options_page must be converted for Firefox');
assert.equal(firefox.options_ui.page, chromeManifest.options_page);
assert.equal(firefox.options_ui.open_in_tab, true);

// --- web accessible resources ----------------------------------------------------
assert.ok(chromeManifest.web_accessible_resources.some(entry => entry.use_dynamic_url), 'Chrome manifest still sets use_dynamic_url');
for (const [index, entry] of firefox.web_accessible_resources.entries()) {
  assert.ok(!('use_dynamic_url' in entry), 'use_dynamic_url is Chrome-only and must be stripped');
  assert.deepEqual(entry.resources, chromeManifest.web_accessible_resources[index].resources, 'resources must be unchanged');
  assert.deepEqual(entry.matches, chromeManifest.web_accessible_resources[index].matches, 'matches must be unchanged');
}

// --- everything else is carried over verbatim ------------------------------------
for (const key of ['manifest_version', 'version', 'default_locale', 'permissions', 'host_permissions', 'content_scripts', 'action', 'commands', 'icons']) {
  assert.deepEqual(firefox[key], chromeManifest[key], `${key} must be identical across browsers`);
}

// The transform must not mutate its input.
const untouched = JSON.parse(await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8'));
assert.deepEqual(chromeManifest, untouched, 'toFirefoxManifest must not mutate the Chrome manifest');

assert.throws(() => toFirefoxManifest({ ...chromeManifest, background: {} }), /service_worker/, 'a missing service worker must fail loudly');
