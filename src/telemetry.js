// Reddit to AI - anonymous, opt-out usage telemetry.
//
// What ever leaves the browser is exactly this, and nothing else:
//   { app, key, installId, version, events: [{ name, count }] }
// where every `name` comes from the fixed EVENT_NAMES list below. No URLs, no page
// or thread content, no subreddit names, no titles, no prompts, no API keys, no
// text the user typed, no timestamps per event. See docs/PRIVACY.md.
//
// Chrome loads this as a service-worker library through importScripts. Firefox
// loads it as the first entry in background.scripts. Telemetry stays OFF in the
// Firefox build on purpose: the AMO listing declares
// `data_collection_permissions: { required: ['none'] }`, which is only truthful
// while nothing is sent. See scripts/firefox-manifest.mjs.
//
// Every entry point swallows its own errors. Telemetry must never throw into, block
// or slow down a scrape.

(function attachTelemetry(global) {
  'use strict';

  // Replaced at build time, or edited by hand before release. Neither value is a
  // secret: the key is baked into the published bundle and only acts as a spam
  // filter for the ingest endpoint.
  const INGEST_URL = 'https://alp-dashboard-api.alpyalay.workers.dev/api/ingest/extension';
  const INGEST_KEY = 'a0dfc109926f7695976ddf116a2186206bd75928530c72adff87d9007d03ed93';

  const APP_SLUG = 'reddit-to-ai';

  // The complete set of things that can be reported. Nothing is ever interpolated
  // into an event name, and a name outside this list is dropped.
  const EVENT_NAMES = [
    'ext_installed',   // first install, once
    'ext_updated',     // extension version changed
    'ext_active',      // once per browser session
    'ext_extract',     // a Reddit thread was scraped successfully
    'ext_handoff'      // a prompt was handed off to an AI provider
  ];

  const ENABLED_KEY = 'telemetryEnabled';   // boolean; absent means on (opt-out)
  const INSTALL_ID_KEY = 'telemetryInstallId';
  const BUFFER_KEY = 'telemetryBuffer';
  const VERSION_KEY = 'telemetryLastVersion';
  const SESSION_KEY = 'telemetrySessionMarked';

  const ALARM_NAME = 'r2ai-telemetry-flush';
  const FLUSH_PERIOD_MINUTES = 30;
  const MAX_BUFFERED_EVENTS = 100;

  // The Firefox build is the one whose manifest carries browser_specific_settings.
  // Checked instead of sniffing `typeof browser`, which only reports which
  // namespaces the runtime happens to expose.
  function isFirefoxBuild() {
    try {
      return Boolean(chrome.runtime.getManifest().browser_specific_settings?.gecko);
    } catch {
      return true; // Unknown build: stay quiet rather than send.
    }
  }

  function isSupported() {
    return typeof chrome !== 'undefined' &&
      Boolean(chrome.storage?.local) &&
      Boolean(chrome.runtime?.getManifest) &&
      !isFirefoxBuild();
  }

  function getLocal(keys) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(keys, result => {
          void chrome.runtime.lastError;
          resolve(result || {});
        });
      } catch {
        resolve({});
      }
    });
  }

  function setLocal(items) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.set(items, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }

  function removeLocal(keys) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.remove(keys, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }

  // Telemetry is on by default; only an explicit `false` turns it off.
  async function isEnabled() {
    const stored = await getLocal([ENABLED_KEY]);
    return stored[ENABLED_KEY] !== false;
  }

  // Created once and never derived from anything about the user or their browser.
  async function getInstallId() {
    const stored = await getLocal([INSTALL_ID_KEY]);
    if (typeof stored[INSTALL_ID_KEY] === 'string' && stored[INSTALL_ID_KEY]) {
      return stored[INSTALL_ID_KEY];
    }
    const installId = crypto.randomUUID();
    await setLocal({ [INSTALL_ID_KEY]: installId });
    return installId;
  }

  // Buffer access is read-modify-write, so every mutation is serialized through one
  // chain. Without this, two events recorded in the same tick (a scrape finishing
  // while the session marker is still being written, say) would clobber each other.
  let writeQueue = Promise.resolve();

  function enqueue(task) {
    const next = writeQueue.then(task, task);
    writeQueue = next.catch(() => { });
    return next;
  }

  // Buffers the event *name* only. Names are aggregated into counts at flush time,
  // so the payload never reveals when any single action happened.
  function record(name) {
    return enqueue(async () => {
      try {
        if (!isSupported()) return;
        if (!EVENT_NAMES.includes(name)) return;
        if (!(await isEnabled())) return;

        const stored = await getLocal([BUFFER_KEY]);
        const buffer = Array.isArray(stored[BUFFER_KEY]) ? stored[BUFFER_KEY] : [];
        buffer.push(name);
        // Oldest first out, so a long offline stretch cannot grow storage without bound.
        await setLocal({ [BUFFER_KEY]: buffer.slice(-MAX_BUFFERED_EVENTS) });
      } catch {
        // Fail silent: telemetry never interferes with a scrape.
      }
    });
  }

  function aggregate(buffer) {
    const counts = new Map();
    for (const name of buffer) {
      if (!EVENT_NAMES.includes(name)) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count }));
  }

  async function flush() {
    // Draining the buffer runs under the same lock as record(), so an event recorded
    // while the request is in flight lands in the next batch instead of vanishing.
    const events = await enqueue(async () => {
      try {
        if (!isSupported()) return [];
        if (!(await isEnabled())) return [];

        const stored = await getLocal([BUFFER_KEY]);
        const buffer = Array.isArray(stored[BUFFER_KEY]) ? stored[BUFFER_KEY] : [];
        const drained = aggregate(buffer);
        if (drained.length === 0) return [];

        // Cleared before the request, not after: a failed send drops the batch rather
        // than retrying forever and double-counting on the server.
        await removeLocal([BUFFER_KEY]);
        return drained;
      } catch {
        return [];
      }
    });

    try {
      if (events.length === 0) return;

      const response = await fetch(INGEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app: APP_SLUG,
          key: INGEST_KEY,
          installId: await getInstallId(),
          version: chrome.runtime.getManifest().version,
          events
        })
      });
      if (!response.ok) return; // Any non-2xx is a no-op.
    } catch {
      // Offline, blocked, or endpoint down: treat as a no-op.
    }
  }

  // A single alarm, recreated idempotently on every worker wake-up. setInterval
  // would die with the MV3 service worker.
  function scheduleFlush() {
    try {
      chrome.alarms?.create(ALARM_NAME, { periodInMinutes: FLUSH_PERIOD_MINUTES });
    } catch {
      // Alarms unavailable: events simply stay buffered until the next startup.
    }
  }

  function handleAlarm(alarm) {
    if (alarm?.name === ALARM_NAME) flush();
  }

  // Reported once per browser session. Uses storage.session so the marker dies with
  // the browser, unlike the worker itself which is torn down constantly.
  async function markSession() {
    try {
      if (!chrome.storage?.session) {
        await record('ext_active');
        return;
      }
      const marked = await new Promise(resolve => {
        chrome.storage.session.get([SESSION_KEY], result => {
          void chrome.runtime.lastError;
          resolve(Boolean(result?.[SESSION_KEY]));
        });
      });
      if (marked) return;
      chrome.storage.session.set({ [SESSION_KEY]: true }, () => void chrome.runtime.lastError);
      await record('ext_active');
    } catch {
      // Fail silent.
    }
  }

  // Distinguishes a first install from an upgrade without reading
  // onInstalled.previousVersion, so a worker that wakes mid-upgrade still gets it right.
  async function recordLifecycle() {
    try {
      if (!isSupported()) return;
      const version = chrome.runtime.getManifest().version;
      const stored = await getLocal([VERSION_KEY]);
      const previous = stored[VERSION_KEY];
      if (!previous) {
        await record('ext_installed');
      } else if (previous !== version) {
        await record('ext_updated');
      }
      if (previous !== version) await setLocal({ [VERSION_KEY]: version });
    } catch {
      // Fail silent.
    }
  }

  let listenerAttached = false;

  // Safe to call on every worker wake-up.
  function init() {
    try {
      if (!isSupported()) return;
      if (!listenerAttached && chrome.alarms?.onAlarm) {
        chrome.alarms.onAlarm.addListener(handleAlarm);
        listenerAttached = true;
      }
      scheduleFlush();
      recordLifecycle().then(markSession);
    } catch {
      // Fail silent.
    }
  }

  // Called by the options page when the user flips the toggle. Turning telemetry
  // off deletes the install id and every buffered event immediately; turning it back
  // on mints a brand new id, so the two runs cannot be linked.
  async function setEnabled(enabled) {
    try {
      await setLocal({ [ENABLED_KEY]: Boolean(enabled) });
      if (!enabled) {
        await removeLocal([INSTALL_ID_KEY, BUFFER_KEY]);
        try {
          chrome.alarms?.clear(ALARM_NAME);
        } catch {
          // Nothing to clear.
        }
        return;
      }
      await getInstallId();
      scheduleFlush();
    } catch {
      // Fail silent.
    }
  }

  global.R2AITelemetry = {
    EVENT_NAMES,
    ENABLED_KEY,
    init,
    record,
    flush,
    isEnabled,
    setEnabled,
    isSupported
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
