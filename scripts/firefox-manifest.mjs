// Firefox ships the exact same sources as Chrome; only the manifest differs. Rather
// than maintaining two manifests by hand (and letting them drift), the Firefox
// manifest is derived from src/manifest.json at package time by this pure transform.
//
// Differences Firefox requires:
//   1. `background.service_worker` -> `background.scripts`. Firefox MV3 uses an event
//      page, not a service worker. `importScripts` is unavailable there, so the four
//      libraries the worker imports are listed ahead of service_worker.js and loaded
//      as classic scripts sharing one global scope - identical to what importScripts
//      produces in Chrome. The importScripts call in service_worker.js is guarded by
//      a `typeof importScripts === 'function'` check for exactly this reason.
//   2. `browser_specific_settings.gecko.id` is mandatory for signing/installing.
//   3. `options_page` is Chrome-only. Firefox reads `options_ui`; without it,
//      chrome.runtime.openOptionsPage() has nothing to open.
//   4. `use_dynamic_url` inside web_accessible_resources is a Chrome-only key and is
//      dropped rather than left for Firefox's manifest linter to complain about.

export const GECKO_ID = 'reddit-to-ai@alpyalay';
// 121 is comfortably past every API this extension touches: MV3 background.scripts
// event pages (109+), storage.session (115+), scripting.registerContentScripts (102+).
export const GECKO_MIN_VERSION = '121.0';

// Must match the importScripts(...) argument order at the top of service_worker.js.
export const BACKGROUND_LIBS = [
  'cl100k_base.js',
  'redditParser.js',
  'promptBuilder.js',
  'apiProviders.js'
];

export function toFirefoxManifest(chromeManifest) {
  const manifest = structuredClone(chromeManifest);

  const workerFile = chromeManifest.background?.service_worker;
  if (!workerFile) {
    throw new Error('Chrome manifest is missing background.service_worker');
  }
  manifest.background = { scripts: [...BACKGROUND_LIBS, workerFile] };

  manifest.browser_specific_settings = {
    ...(manifest.browser_specific_settings || {}),
    gecko: {
      id: GECKO_ID,
      strict_min_version: GECKO_MIN_VERSION
    }
  };

  if (manifest.options_page) {
    manifest.options_ui = {
      page: manifest.options_page,
      open_in_tab: true
    };
    delete manifest.options_page;
  }

  if (Array.isArray(manifest.web_accessible_resources)) {
    manifest.web_accessible_resources = manifest.web_accessible_resources.map(entry => {
      if (!entry || typeof entry !== 'object') return entry;
      const { use_dynamic_url: _dropped, ...rest } = entry;
      return rest;
    });
  }

  return manifest;
}
