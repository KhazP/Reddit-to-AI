/* global importScripts */
// Chrome runs this file as an MV3 service worker, where `importScripts` pulls in the
// shared libraries. Firefox runs it as an MV3 background event page, where
// `importScripts` does not exist - there the same four files are listed ahead of this
// one in `background.scripts`, so the globals are already present and the call is
// skipped. Keep both lists in the same order (see scripts/firefox-manifest.mjs).
if (typeof importScripts === 'function') {
  importScripts('cl100k_base.js', 'redditParser.js', 'promptBuilder.js', 'apiProviders.js');
}

const DEFAULT_PROMPT_TEMPLATE = 'Summarize the following Reddit thread:\n\n{content}';
const DEFAULT_HISTORY_LIMIT = 10;
const PREVIEW_STORAGE_KEY = 'redditPreviewData';
const PASTE_STORAGE_KEY = 'redditPendingPaste';
const LEGACY_THREAD_KEY = 'redditThreadData';
const SCRAPING_STATE_KEY = 'redditScrapingState';
const SCRAPE_CONTEXT_KEY = 'redditActiveScrape';
// API keys live in chrome.storage.local only - never in storage.sync, which would
// replicate them through Google's servers.
const DIRECT_API_CONFIG_KEY = 'directApiConfig';

// `phase`, `status` and `batch` are the machine-readable half of the state. The UI
// keys off them so it never has to pattern-match the localized `message` text.
// phase: 'idle' | 'prepare' | 'fetch' | 'parse' | 'load' | 'expand' | 'media'
//        | 'filter' | 'build' | 'complete' | 'error'
// status: 'idle' | 'running' | 'complete' | 'error'
// batch: null | { current, total }
const DEFAULT_STATE = {
  isActive: false,
  message: chrome.i18n.getMessage('panel_status_ready') || 'Ready to scrape.',
  percentage: 0,
  phase: 'idle',
  status: 'idle',
  batch: null,
  summary: null,
  error: null,
  lastScrapedTabId: null
};

let scrapingState = { ...DEFAULT_STATE };
let currentScrape = null;
const activePasteHandoffs = new Set();

console.debug('Service worker initialised.');

// An MV3 service worker is torn down between events, so a scrape that outlives the
// worker has to be reconstructed from storage.session on the next wake-up. Every
// message is gated on `ready` so no handler can observe half-restored state, and so
// the activeBatch auto-resume decision is made exactly once, before any message
// (in particular a fresh `scrapeReddit`) can race it.
//
// Deliberately callback-chained rather than promise-chained: when the storage
// callbacks are synchronous the whole restore completes in this same tick, which is
// what keeps a woken worker from briefly looking idle.
const ready = new Promise(resolve => {
  restoreScrapingState(() => {
    autoResumeBatch(resolve);
  });
});

function restoreScrapingState(done) {
  if (!chrome.storage.session) {
    done();
    return;
  }
  chrome.storage.session.get([SCRAPING_STATE_KEY, SCRAPE_CONTEXT_KEY], (result) => {
    if (chrome.runtime.lastError) {
      console.debug('Scraping state restore skipped:', chrome.runtime.lastError.message);
      done();
      return;
    }
    const stored = result?.[SCRAPING_STATE_KEY];
    if (stored) {
      // A scrape only counts as still running if its handoff context survived too;
      // otherwise the previous worker died past the point of no return and the flag
      // would wedge the UI (and block the batch auto-resume below) forever.
      scrapingState = { ...DEFAULT_STATE, ...stored, isActive: Boolean(result?.[SCRAPE_CONTEXT_KEY]) };
    }
    done();
  });
}

function autoResumeBatch(done) {
  chrome.storage.local.get('activeBatch', (result) => {
    if (result && result.activeBatch && !scrapingState.isActive) {
      console.debug('Auto-resuming active batch scrape from storage...', result.activeBatch);
      resumeBatchScrape(result.activeBatch).catch(err => {
        console.error('Failed to auto-resume batch scrape:', err);
      });
    }
    done();
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.debug('Reddit to AI installed.');
  syncSelectors().catch(err => console.error('Selector sync on installed failed:', err));
  registerAllCustomOrigins().catch(err => console.error('Failed to register custom origins on installed:', err));
  registerContextMenus();
});

// =====================
// Context menu / keyboard shortcut entry points
// =====================

const CONTEXT_MENU_PAGE_ID = 'r2ai-scrape-page';
const CONTEXT_MENU_LINK_ID = 'r2ai-scrape-link';
// Thread pages only: the scraper needs a /comments/ permalink, so subreddit
// listings and profiles are deliberately excluded.
const THREAD_URL_PATTERNS = [
  '*://*.reddit.com/r/*/comments/*',
  '*://*.reddit.com/comments/*',
  '*://*.reddit.com/user/*/comments/*',
  'https://*.redd.it/*'
];

function contextMenuTitle() {
  return chrome.i18n.getMessage('context_menu_scrape_thread') || 'Scrape this thread with Reddit to AI';
}

function registerContextMenus() {
  if (!chrome.contextMenus?.create) return;
  // onInstalled also fires on update, so clear first to avoid duplicate-id errors.
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) console.debug('Context menu reset skipped:', chrome.runtime.lastError.message);
    chrome.contextMenus.create({
      id: CONTEXT_MENU_PAGE_ID,
      title: contextMenuTitle(),
      contexts: ['page', 'selection'],
      documentUrlPatterns: THREAD_URL_PATTERNS
    }, () => chrome.runtime.lastError && console.debug('Page context menu skipped:', chrome.runtime.lastError.message));
    chrome.contextMenus.create({
      id: CONTEXT_MENU_LINK_ID,
      title: contextMenuTitle(),
      contexts: ['link'],
      // targetUrlPatterns matches the link href, so a thread link works from any page.
      targetUrlPatterns: THREAD_URL_PATTERNS
    }, () => chrome.runtime.lastError && console.debug('Link context menu skipped:', chrome.runtime.lastError.message));
  });
}

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    ready
      .then(() => {
        if (info.menuItemId === CONTEXT_MENU_LINK_ID && info.linkUrl) {
          return scrapeThreadInNewTab(info.linkUrl);
        }
        if (info.menuItemId === CONTEXT_MENU_PAGE_ID) {
          return handleScrapeRequest({ tabId: tab?.id }, null);
        }
        return undefined;
      })
      .catch(error => notifyEntryPointFailure(error));
  });
}

if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command !== 'scrape-current-thread') return;
    // No tabId: handleScrapeRequest falls back to the active tab, exactly like the
    // popup's scrape with stored settings and no per-scrape filter overrides.
    ready
      .then(() => handleScrapeRequest({}, null))
      .catch(error => notifyEntryPointFailure(error));
  });
}

function notifyEntryPointFailure(error) {
  console.error('Reddit to AI: scrape entry point failed:', error);
  showNotificationIfEnabled(
    chrome.i18n.getMessage('extName') || 'Reddit to AI',
    error?.message || (chrome.i18n.getMessage('sw_error_not_reddit') || 'Active tab is not a Reddit thread.')
  );
}

// Opens a thread link in a background tab, waits for it to finish loading, then runs
// the normal tab scrape against it. Batch mode cannot be reused here: it fetches the
// Reddit JSON API instead of scraping a rendered page.
async function scrapeThreadInNewTab(url) {
  if (!isRedditUrl(url)) throw new Error('Active tab is not a Reddit thread.');
  // Checked before opening the tab so a busy worker does not leave a stray tab behind.
  if (scrapingState.isActive) throw new Error('Scraping already in progress.');
  const tab = await chrome.tabs.create({ url, active: false });
  await waitForTabLoad(tab.id);
  return handleScrapeRequest({ tabId: tab.id }, null);
}

function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    const timer = setTimeout(() => finish(new Error('Timed out waiting for the Reddit tab to load.')), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    // The tab may already have finished loading before the listener was attached.
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError) {
        finish(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (tab?.status === 'complete') finish();
    });
  });
}

// =====================
// Message Handlers
// =====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Every branch answers after `ready`, so the listener always claims the async
  // response channel.
  ready.then(() => handleRuntimeMessage(request, sender, sendResponse))
    .catch(error => {
      console.error('Message handling failed:', error);
      sendResponse({ status: 'error', error: error.message });
    });
  return true;
});

function handleRuntimeMessage(request, sender, sendResponse) {
  switch (request.action) {
    case 'scrapeReddit': {
      const handler = Array.isArray(request.batchUrls) && request.batchUrls.length > 0
        ? handleBatchScrapeRequest(request, sender)
        : handleScrapeRequest(request, sender);
      handler
        .then(result => sendResponse({ status: 'success', ...result, currentState: scrapingState }))
        .catch(error => {
          console.error('Scrape failed:', error);
          setScrapingState({
            isActive: false,
            error: error.message,
            message: `Error: ${error.message}`,
            percentage: -1,
            phase: 'error',
            status: 'error',
            batch: null
          });
          sendResponse({ status: 'error', error: error.message, currentState: scrapingState });
        });
      return;
    }
    case 'scrapeComplete': {
      // Final payload from the content script, delivered as its own message so the
      // original request/response pair does not have to stay open for the whole
      // scrape. May arrive at a worker that was restarted mid-scrape.
      finishTabScrape(request.scrapeId, { data: request.data, error: request.error })
        .then(() => sendResponse({ ok: true }))
        .catch(error => {
          console.error('Failed to finish scrape:', error);
          sendResponse({ ok: false, error: error.message });
        });
      return;
    }
    case 'stopScraping':
      stopActiveScrape()
        .catch(error => console.warn('Reddit to AI: Stop cleanup failed:', error))
        .then(() => sendResponse({ status: 'stopping', currentState: scrapingState }));
      return;
    case 'progressUpdate': {
      const patch = {};
      if (request.message) patch.message = request.message;
      if (typeof request.percentage === 'number') patch.percentage = request.percentage;
      if (request.phase) {
        patch.phase = request.phase;
        patch.status = 'running';
        // `batch` is re-derived on every phase-carrying update so a stale batch
        // counter cannot survive past the phase that produced it.
        patch.batch = request.batch || null;
      }
      if (Object.keys(patch).length > 0) setScrapingState(patch);
      sendResponse({ ok: true });
      return;
    }
    case 'getScrapingState':
      sendResponse(scrapingState);
      return;
    case 'notifyUser':
      if (request.title && request.message) {
        showNotificationIfEnabled(request.title, request.message, request.notificationIdBase);
      }
      sendResponse({ ok: true });
      return;
    case 'fetchImage': {
      fetchImageAsBase64(request.url)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'getPreviewData': {
      getPreviewData()
        .then(payload => {
          if (!payload?.data) throw new Error('No pending Reddit preview data found.');
          return loadSettings().then(settings => {
            const merged = { ...settings, ...payload.settings };
            const resolved = resolveSubredditSettings(payload.data.post?.subreddit, merged);
            return sendResponse({ data: payload.data, settings: resolved, historyId: payload.historyId || null });
          });
        })
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'sendPromptToAi': {
      sendPromptToAi(request)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'sendPromptViaApi': {
      sendPromptViaApi(request)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({
          error: error.message,
          retryable: error.retryable === true
        }));
      return;
    }
    case 'getDirectApiStatus': {
      getDirectApiStatus()
        .then(status => sendResponse(status))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'testDirectApiKey': {
      testDirectApiKey(request)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({
          error: error.message,
          retryable: error.retryable === true
        }));
      return;
    }
    case 'getPendingPasteData': {
      getPendingPasteData()
        .then(payload => sendResponse({ payload }))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'markPendingPasteConsumed': {
      markPendingPasteConsumed(request.pasteId)
        .then(() => sendResponse({ ok: true }))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'recordPasteFailure': {
      recordPasteFailure(request)
        .then(() => sendResponse({ ok: true }))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'resumeMissingComments': {
      resumeMissingComments()
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'getQuickTokenEstimate': {
      getQuickTokenEstimate(request.tabId, request.url)
        .then(estimatedData => sendResponse({ estimatedData }))
        .catch(error => {
          console.warn('Quick estimate failed:', error);
          sendResponse({ error: error.message });
        });
      return;
    }
    case 'getLocaleData': {
      getLocaleData(request.lang)
        .then(data => sendResponse({ success: true, data }))
        .catch(error => {
          console.error('Failed to read locale data:', error);
          sendResponse({ success: false, error: error.message });
        });
      return;
    }
    case 'focusLastRedditTab': {
      focusLastRedditTab()
        .then(() => sendResponse({ ok: true }))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'getHistory': {
      getHistory()
        .then(history => sendResponse({ history }))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'deleteHistoryItem': {
      deleteFromHistory(request.historyId)
        .then(history => sendResponse({ history }))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'clearHistory': {
      clearHistory()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'resendHistoryItem': {
      resendHistoryItem(request.historyId, request.aiProvider)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'getHistoryItem': {
      getHistoryItem(request.historyId)
        .then(item => sendResponse({ item }))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'updateHistoryItem': {
      updateHistoryItem(request.historyId, request.patch || {})
        .then(history => sendResponse({ history }))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'compareHistoryItems': {
      compareHistoryItems(request.historyIds || [])
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return;
    }
    case 'registerCustomOrigin': {
      registerCustomOriginScript(request.origin)
        .then(() => sendResponse({ status: 'success' }))
        .catch(error => sendResponse({ status: 'error', error: error.message }));
      return;
    }
    case 'unregisterCustomOrigin': {
      unregisterCustomOriginScript(request.origin)
        .then(() => sendResponse({ status: 'success' }))
        .catch(error => sendResponse({ status: 'error', error: error.message }));
      return;
    }
    default:
      console.warn('Unhandled runtime message:', request);
      sendResponse({ status: 'ignored' });
  }
}

// Port connection handler for streaming Local AI summaries
if (chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'keep-alive') {
      const intervalId = setInterval(() => {
        try {
          port.postMessage({ ping: true });
        } catch {
          clearInterval(intervalId);
        }
      }, 10000);
      port.onDisconnect.addListener(() => {
        clearInterval(intervalId);
      });
    }
  });
}

// =====================
// Main Scrape Flows
// =====================

async function handleScrapeRequest(request, sender) {
  if (scrapingState.isActive) throw new Error('Scraping already in progress.');

  setScrapingState({
    isActive: true,
    message: chrome.i18n.getMessage('sw_status_preparing') || 'Preparing to scrape.',
    percentage: 5,
    phase: 'prepare',
    status: 'running',
    batch: null,
    summary: null,
    error: null
  });

  const activeTab = await getScrapeTargetTab(request, sender);
  const tabUrl = await resolveTabUrl(activeTab);
  if (!isRedditUrl(tabUrl)) {
    setScrapingState({
      isActive: false,
      message: chrome.i18n.getMessage('popup_status_navigate') || 'Open a Reddit thread before scraping.',
      percentage: -1,
      phase: 'error',
      status: 'error',
      batch: null,
      error: chrome.i18n.getMessage('sw_error_not_reddit') || 'Active tab is not a Reddit thread.'
    });
    throw new Error('Active tab is not a Reddit thread.');
  }

  const scrapeId = createId();
  currentScrape = {
    scrapeId,
    tabId: activeTab.id,
    stopRequested: false,
    storageOption: 'persistent',
    abortController: null
  };

  setScrapingState({ lastScrapedTabId: activeTab.id });

  try {
    // Settings are resolved up front rather than after the scrape so the whole
    // handoff context can be persisted before the tab starts working. A worker that
    // is restarted mid-scrape then has everything it needs to finish the pipeline.
    const settings = await loadSettings();
    const effectiveSettings = mergeRequestFiltersIntoSettings(settings, request.filters || {}, request);
    currentScrape.storageOption = effectiveSettings.dataStorageOption;

    const context = {
      scrapeId,
      tabId: activeTab.id,
      settings: effectiveSettings,
      startedAt: Date.now()
    };
    await setStorage(chrome.storage.session, { [SCRAPE_CONTEXT_KEY]: context });

    await injectContentScripts(activeTab.id);
    setScrapingState({ message: chrome.i18n.getMessage('sw_status_collecting') || 'Collecting data from page.', percentage: 20, phase: 'fetch', status: 'running' });

    const ack = await requestScrapeFromTab(activeTab.id, request.includeHidden, request.filters || {}, scrapeId);
    if (ack?.error) throw new Error(`Content script error: ${ack.error}`);

    // A content script left over from a previous extension version still replies
    // with the finished payload instead of acknowledging the start.
    if (ack?.data) {
      finishTabScrape(scrapeId, { data: ack.data }).catch(error => {
        console.error('Legacy scrape handoff failed:', error);
      });
    } else if (!ack?.started) {
      throw new Error('Content script did not acknowledge the scrape request.');
    }

    // Resolves as soon as the tab has started. The result arrives later as its own
    // `scrapeComplete` message, so the popup follows progress through scraping
    // state updates rather than through this response.
    return { started: true, scrapeId, preview: effectiveSettings.showPromptPreview !== false, direct: effectiveSettings.showPromptPreview === false };
  } catch (error) {
    await clearScrapeContext();
    currentScrape = null;
    throw error;
  }
}

async function getActiveScrapeContext(scrapeId) {
  const stored = await getStorage(chrome.storage.session, SCRAPE_CONTEXT_KEY);
  const context = stored?.[SCRAPE_CONTEXT_KEY] || null;
  if (!context) return null;
  if (scrapeId && context.scrapeId && context.scrapeId !== scrapeId) return null;
  return context;
}

async function clearScrapeContext() {
  await removeStorage(chrome.storage.session, [SCRAPE_CONTEXT_KEY])
    .catch(error => console.warn('Reddit to AI: Failed to clear scrape context:', error));
}

// Second half of a single-thread scrape: everything that used to run inline once
// `chrome.tabs.sendMessage` finally called back. Driven by the `scrapeComplete`
// message so it also runs correctly on a worker that started after the scrape did.
async function finishTabScrape(scrapeId, { data, error } = {}) {
  const context = await getActiveScrapeContext(scrapeId);
  if (!context) {
    console.debug('Ignoring scrapeComplete for an unknown or superseded scrape:', scrapeId);
    return { ignored: true };
  }

  const stopRequested = Boolean(currentScrape?.stopRequested);
  try {
    if (error) throw new Error(`Content script error: ${error}`);
    if (!data) throw new Error('Content script returned no data.');
    if (stopRequested) throw new Error('Scraping stopped by user.');

    setScrapingState({ message: chrome.i18n.getMessage('sw_status_processing') || 'Preparing scraped data.', percentage: 65, phase: 'build', status: 'running', batch: null });

    const effectiveSettings = context.settings || await loadSettings();
    const refreshedTab = await getTabById(context.tabId).catch(() => null);
    const processedData = enrichScrapedData(data, getTabUrl(refreshedTab), {
      redditTabId: context.tabId,
      settings: effectiveSettings
    });
    processedData.timestamp = Date.now();

    let historyEntry = null;
    if (effectiveSettings.dataStorageOption === 'persistent') {
      historyEntry = await addToHistory(processedData, effectiveSettings);
    }
    await savePreviewData(processedData, effectiveSettings, { historyId: historyEntry?.id || null });

    if (effectiveSettings.showPromptPreview === false) {
      setScrapingState({ message: 'Opening AI tab...', percentage: 86, phase: 'build', status: 'running' });
      await sendDataDirectlyToAi(processedData, effectiveSettings);
    } else {
      setScrapingState({ message: 'Opening prompt preview...', percentage: 86, phase: 'build', status: 'running' });
      await openPreviewTab();
    }

    setScrapingState({
      isActive: false,
      percentage: 100,
      phase: 'complete',
      status: 'complete',
      batch: null,
      summary: null,
      message: effectiveSettings.showPromptPreview === false ? 'Content sent directly to AI.' : 'Content ready for prompt preview.',
      error: null
    });

    showNotificationIfEnabled(
      chrome.i18n.getMessage('extName') || 'Reddit to AI',
      effectiveSettings.showPromptPreview === false ? 'Content sent directly to AI.' : 'Content ready for prompt preview.'
    );

    return { success: true };
  } catch (finishError) {
    console.error('Scrape failed:', finishError);
    setScrapingState({
      isActive: false,
      error: finishError.message,
      message: `Error: ${finishError.message}`,
      percentage: -1,
      phase: 'error',
      status: 'error',
      batch: null
    });
    throw finishError;
  } finally {
    await clearScrapeContext();
    if (currentScrape?.scrapeId === context.scrapeId) currentScrape = null;
  }
}

async function resumeBatchScrape(batch) {
  if (scrapingState.isActive) {
    throw new Error('Scraping already in progress.');
  }

  currentScrape = {
    tabId: null,
    stopRequested: false,
    storageOption: 'persistent',
    abortController: null
  };

  const urls = batch.urls;
  const initialIndex = typeof batch.currentIndex === 'number' ? batch.currentIndex : 0;

  setScrapingState({
    isActive: true,
    message: initialIndex > 0
      ? `Resuming scraping of ${urls.length} threads (${initialIndex}/${urls.length}).`
      : `Preparing to scrape ${urls.length} threads.`,
    percentage: 5 + Math.floor((initialIndex / urls.length) * 85),
    phase: 'prepare',
    status: 'running',
    batch: { current: initialIndex, total: urls.length },
    summary: null,
    error: null
  });

  const settings = await loadSettings();
  const effectiveSettings = mergeRequestFiltersIntoSettings(settings, batch.request?.filters || {}, batch.request || {});
  currentScrape.storageOption = effectiveSettings.dataStorageOption;

  try {
    const batchFilters = { ...(batch.request?.filters || {}), includeHidden: batch.request?.includeHidden };
    const threads = batch.threads || [];
    for (let i = initialIndex; i < urls.length; i++) {
      if (currentScrape.stopRequested) {
        await removeStorage(chrome.storage.local, ['activeBatch']);
        throw new Error('Batch scraping stopped by user.');
      }
      const percentage = 10 + Math.floor((i / urls.length) * 70);
      setScrapingState({
        message: `Scraping thread ${i + 1}/${urls.length}...`,
        percentage,
        phase: 'load',
        status: 'running',
        batch: { current: i + 1, total: urls.length }
      });
      const thread = await scrapeThreadFromUrl(urls[i], effectiveSettings, batchFilters);
      threads.push(thread);

      batch.currentIndex = i + 1;
      batch.threads = threads;
      await setStorage(chrome.storage.local, { activeBatch: batch });

      await delay(900);
    }

    await removeStorage(chrome.storage.local, ['activeBatch']);

    const batchData = {
      isBatch: true,
      threads,
      post: {
        title: `Batch: ${threads.length} Reddit threads`,
        author: 'multiple',
        subreddit: 'multiple',
        url: urls[0],
        content: ''
      },
      comments: [],
      metadata: {
        scrapedAt: new Date().toISOString(),
        commentCount: threads.reduce((sum, thread) => sum + (thread.metadata?.commentCount || 0), 0),
        threadCount: threads.length,
        sourceUrls: urls,
        storageOption: effectiveSettings.dataStorageOption,
        aiProvider: effectiveSettings.selectedLlmProvider,
        preset: effectiveSettings.selectedPreset,
        contextPreset: effectiveSettings.contextPreset,
        trimStrategy: effectiveSettings.trimStrategy,
        mediaMode: effectiveSettings.mediaMode,
        outputFormat: effectiveSettings.outputFormat,
        deliveryMode: effectiveSettings.showPromptPreview === false ? 'direct' : 'preview',
        pasteStatus: effectiveSettings.showPromptPreview === false ? 'pending' : 'not_started'
      },
      timestamp: Date.now()
    };

    let batchHistoryEntry = null;
    if (effectiveSettings.dataStorageOption === 'persistent') {
      batchHistoryEntry = await addToHistory(batchData, effectiveSettings);
    }
    await savePreviewData(batchData, effectiveSettings, { historyId: batchHistoryEntry?.id || null });

    if (effectiveSettings.showPromptPreview === false) {
      setScrapingState({ message: 'Opening AI tab...', percentage: 90, phase: 'build', status: 'running', batch: null });
      await sendDataDirectlyToAi(batchData, effectiveSettings);
    } else {
      setScrapingState({ message: 'Opening prompt preview...', percentage: 90, phase: 'build', status: 'running', batch: null });
      await openPreviewTab();
    }
    setScrapingState({
      isActive: false,
      percentage: 100,
      phase: 'complete',
      status: 'complete',
      batch: null,
      message: effectiveSettings.showPromptPreview === false ? 'Batch sent directly to AI.' : 'Batch ready for prompt preview.',
      error: null
    });
    return { summary: null, preview: effectiveSettings.showPromptPreview !== false, direct: effectiveSettings.showPromptPreview === false, batch: true };
  } catch (error) {
    console.error('Batch scrape failed:', error);
    setScrapingState({
      isActive: false,
      error: error.message,
      message: `Error: ${error.message}`,
      percentage: -1,
      phase: 'error',
      status: 'error',
      batch: null
    });
    throw error;
  } finally {
    currentScrape = null;
  }
}

async function handleBatchScrapeRequest(request, _sender) {
  if (scrapingState.isActive) throw new Error('Scraping already in progress.');
  const urls = normalizeBatchUrls(request.batchUrls);
  if (urls.length === 0) throw new Error('No valid Reddit URLs were provided.');

  const activeBatch = {
    urls,
    currentIndex: 0,
    threads: [],
    filters: request.filters || {},
    includeHidden: request.includeHidden,
    request: request
  };

  await setStorage(chrome.storage.local, { activeBatch });

  return resumeBatchScrape(activeBatch);
}

// =====================
// Preview / Paste Handoff
// =====================

async function savePreviewData(data, settings, extra = {}) {
  const payload = {
    data,
    settings,
    // `historyId` lets the preview page's direct-API response be written back onto
    // the matching history entry; it is null whenever history saving is off.
    historyId: extra.historyId || null,
    timestamp: Date.now(),
    handoffId: createId(),
    storageOption: settings.dataStorageOption,
    oneTime: settings.dataStorageOption === 'dontSave'
  };
  const area = getStorageArea(settings.dataStorageOption);
  const otherArea = getOtherStorageArea(settings.dataStorageOption);
  let effectiveArea = area;
  try {
    await setStorage(area, { [PREVIEW_STORAGE_KEY]: payload });
  } catch (error) {
    // Session storage has a small quota; fall back to local rather than losing the handoff.
    if (area === chrome.storage.local) throw error;
    console.warn('Reddit to AI: Preview payload write failed, falling back to local storage:', error);
    effectiveArea = chrome.storage.local;
    await setStorage(chrome.storage.local, { [PREVIEW_STORAGE_KEY]: payload });
  }
  if (otherArea && otherArea !== effectiveArea) {
    await removeStorage(otherArea, [PREVIEW_STORAGE_KEY, PASTE_STORAGE_KEY, LEGACY_THREAD_KEY])
      .catch(error => console.warn('Reddit to AI: Failed to clear stale storage area:', error));
  }
  if (settings.dataStorageOption === 'persistent') {
    await setStorage(chrome.storage.local, { [LEGACY_THREAD_KEY]: data })
      .catch(error => console.warn('Reddit to AI: Failed to persist legacy thread copy:', error));
  }
  return payload;
}

async function getPreviewData() {
  const sessionPayload = await getStorage(chrome.storage.session, PREVIEW_STORAGE_KEY);
  if (sessionPayload?.[PREVIEW_STORAGE_KEY]) return sessionPayload[PREVIEW_STORAGE_KEY];
  const localPayload = await getStorage(chrome.storage.local, PREVIEW_STORAGE_KEY);
  return localPayload?.[PREVIEW_STORAGE_KEY] || null;
}

async function sendPromptToAi(request) {
  const previewPayload = await getPreviewData();
  if (!previewPayload?.data && !request.renderedData) throw new Error('No preview data available to send.');

  const handoffKey = previewPayload?.handoffId ||
    `${request.aiProvider || 'unknown'}:${String(request.promptText || '').slice(0, 240)}`;
  if (activePasteHandoffs.has(handoffKey)) {
    throw new Error('Already opening AI tab.');
  }
  activePasteHandoffs.add(handoffKey);

  try {
    const settings = await loadSettings();
    const storageOption = previewPayload?.storageOption || settings.dataStorageOption;
    const pastePayload = {
      promptText: request.promptText,
      data: request.renderedData || previewPayload.data,
      mediaMode: request.mediaMode || settings.mediaMode || 'attach',
      aiProvider: request.aiProvider || settings.selectedLlmProvider,
      timestamp: Date.now(),
      pasteId: createId(),
      storageOption,
      oneTime: previewPayload?.oneTime || storageOption === 'dontSave'
    };

    const pasteArea = getStorageArea(storageOption);
    const otherPasteArea = getOtherStorageArea(storageOption);
    await setStorage(pasteArea, { [PASTE_STORAGE_KEY]: pastePayload });
    if (otherPasteArea !== pasteArea) {
      await removeStorage(otherPasteArea, [PASTE_STORAGE_KEY]);
    }
    if (storageOption === 'persistent') {
      await setStorage(chrome.storage.local, { [LEGACY_THREAD_KEY]: pastePayload.data });
    }

    const aiUrl = await getAiUrl(pastePayload.aiProvider);
    await chrome.tabs.create({ url: aiUrl });
    return { success: true, pasteId: pastePayload.pasteId };
  } finally {
    activePasteHandoffs.delete(handoffKey);
  }
}

async function sendDataDirectlyToAi(data, settings) {
  const resolvedSettings = resolveSubredditSettings(data.post?.subreddit, settings);
  const renderedData = R2AIPrompt.applyContextPreset(data, resolvedSettings.contextPreset || 'balanced', resolvedSettings);
  const promptText = R2AIPrompt.buildPromptText(renderedData, resolvedSettings.defaultPromptTemplate, {
    ...resolvedSettings,
    contextPreset: null
  });
  return sendPromptToAi({
    promptText,
    aiProvider: resolvedSettings.selectedLlmProvider,
    mediaMode: resolvedSettings.mediaMode,
    renderedData,
    directSend: true
  });
}

async function getPendingPasteData() {
  const sessionPayload = await getStorage(chrome.storage.session, PASTE_STORAGE_KEY);
  if (sessionPayload?.[PASTE_STORAGE_KEY]) return sessionPayload[PASTE_STORAGE_KEY];
  const localPayload = await getStorage(chrome.storage.local, PASTE_STORAGE_KEY);
  return localPayload?.[PASTE_STORAGE_KEY] || null;
}

async function markPendingPasteConsumed(pasteId) {
  const payload = await getPendingPasteData();
  if (pasteId && payload?.pasteId && pasteId !== payload.pasteId) return;

  await removeStorage(chrome.storage.session, [PASTE_STORAGE_KEY]);
  await removeStorage(chrome.storage.local, [PASTE_STORAGE_KEY]);

  if (payload?.oneTime || payload?.storageOption === 'dontSave') {
    await removeStorage(chrome.storage.session, [PREVIEW_STORAGE_KEY, LEGACY_THREAD_KEY]);
    await removeStorage(chrome.storage.local, [PREVIEW_STORAGE_KEY, LEGACY_THREAD_KEY]);
  }
}

async function recordPasteFailure(request) {
  const payload = await getPendingPasteData();
  const failure = {
    pasteId: request.pasteId || payload?.pasteId || null,
    aiProvider: request.aiProvider || payload?.aiProvider || 'unknown',
    reason: request.reason || 'Unknown paste failure',
    timestamp: Date.now()
  };
  const result = await getStorage(chrome.storage.local, 'pasteFailures');
  const failures = Array.isArray(result.pasteFailures) ? result.pasteFailures : [];
  await setStorage(chrome.storage.local, { pasteFailures: [failure, ...failures].slice(0, 25) });
}

async function openPreviewTab() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('preview.html') });
}

async function resumeMissingComments() {
  const payload = await getPreviewData();
  const data = payload?.data;
  if (!data || Array.isArray(data.threads)) throw new Error('Resume is only available for a single active Reddit thread.');

  const failedIds = data.metadata?.failedMoreIds || data.morechildren?.failedIds || [];
  if (failedIds.length === 0) return { data, addedCount: 0 };

  const tabId = data.metadata?.redditTabId || scrapingState.lastScrapedTabId;
  if (typeof tabId !== 'number') throw new Error('Could not find the original Reddit tab for resume.');

  await injectContentScripts(tabId);
  const response = await sendMessageToTab(tabId, {
    action: 'resumeMoreChildren',
    moreIds: failedIds,
    includeHidden: Boolean(data.includeHidden),
    threadId: data.metadata?.threadId,
    subreddit: data.post?.subreddit,
    redditSortMode: data.filtersApplied?.redditSortMode || data.metadata?.redditSortMode || 'confidence',
    maxDepth: data.maxDepth || 10
  });

  if (response?.error) throw new Error(response.error);
  const integration = mergeCommentsIntoData(data, response.comments || []);
  data.metadata.commentCount = countComments(data.comments);
  data.metadata.failedMoreIds = response.failedIds || [];
  data.morechildren = {
    ...(data.morechildren || {}),
    failedIds: response.failedIds || []
  };
  data.timestamp = Date.now();

  await setStorage(getStorageArea(payload.storageOption), { [PREVIEW_STORAGE_KEY]: { ...payload, data, timestamp: Date.now() } });
  return { data, addedCount: integration.addedCount, failedIds: response.failedIds || [] };
}

function mergeCommentsIntoData(data, comments) {
  const integration = mergeAdditionalComments(data.comments || [], comments, data.metadata?.threadId);
  data.comments = integration.roots;
  return integration;
}

function mergeAdditionalComments(roots, additionalComments, threadId) {
  return R2AIRedditParser.mergeAdditionalComments(roots, additionalComments, threadId);
}

// =====================
// History Management
// =====================

async function getHistoryLimit() {
  const result = await getStorage(chrome.storage.sync, 'historyLimit');
  return result.historyLimit || DEFAULT_HISTORY_LIMIT;
}

async function getHistory() {
  const result = await getStorage(chrome.storage.local, 'scrapeHistory');
  return result.scrapeHistory || [];
}

async function addToHistory(scrapeData, settings = {}) {
  const history = await getHistory();
  const limit = await getHistoryLimit();
  const entryId = createId();
  const historyEntry = {
    id: entryId,
    timestamp: Date.now(),
    post: scrapeData.post,
    metadata: {
      ...scrapeData.metadata,
      aiProvider: settings.selectedLlmProvider || scrapeData.metadata?.aiProvider || 'gemini',
      preset: settings.selectedPreset || scrapeData.metadata?.preset || 'summarize',
      contextPreset: settings.contextPreset || scrapeData.metadata?.contextPreset || 'balanced'
    },
    comments: scrapeData.comments,
    includeHidden: scrapeData.includeHidden,
    maxDepth: scrapeData.maxDepth,
    filtersApplied: scrapeData.filtersApplied,
    morechildren: scrapeData.morechildren,
    threadUrl: scrapeData.threadUrl,
    favorite: false,
    pinned: false
  };

  if (scrapeData.threads !== undefined) {
    historyEntry.threads = scrapeData.threads;
  }
  if (scrapeData.isBatch !== undefined) {
    historyEntry.isBatch = scrapeData.isBatch;
  }

  history.unshift(historyEntry);
  const sorted = sortHistory(history).slice(0, limit);
  await setStorage(chrome.storage.local, { scrapeHistory: sorted });
  return historyEntry;
}

async function deleteFromHistory(historyId) {
  const history = await getHistory();
  const filtered = history.filter(item => item.id !== historyId);
  await setStorage(chrome.storage.local, { scrapeHistory: filtered });
  return filtered;
}

async function clearHistory() {
  await setStorage(chrome.storage.local, { scrapeHistory: [] });
}

async function getHistoryItem(historyId) {
  const history = await getHistory();
  return history.find(item => item.id === historyId) || null;
}

async function updateHistoryItem(historyId, patch) {
  const history = await getHistory();
  const updated = history.map(item => item.id === historyId ? { ...item, ...patch } : item);
  const sorted = sortHistory(updated);
  await setStorage(chrome.storage.local, { scrapeHistory: sorted });
  return sorted;
}

async function resendHistoryItem(historyId, aiProvider) {
  const item = await getHistoryItem(historyId);
  if (!item) throw new Error('History item not found');
  const settings = await loadSettings();
  // The provider ride-alongs in the preview payload only. Persisting it here used to
  // silently rewrite the user's default provider every time they resent a history
  // item; preview.js reads `settings.selectedLlmProvider` off this payload and sends
  // its own `aiProvider` back, so the override applies without touching storage.sync.
  const mergedSettings = { ...settings, selectedLlmProvider: aiProvider || settings.selectedLlmProvider };
  const scrapeData = {
    post: item.post,
    comments: item.comments,
    threads: item.threads, // Add this
    isBatch: item.isBatch, // Add this
    metadata: item.metadata,
    includeHidden: item.includeHidden,
    maxDepth: item.maxDepth,
    filtersApplied: item.filtersApplied,
    morechildren: item.morechildren,
    threadUrl: item.threadUrl,
    timestamp: Date.now()
  };
  await savePreviewData(scrapeData, { ...mergedSettings, dataStorageOption: 'sessionOnly' }, { historyId: item.id });
  await openPreviewTab();
  return { success: true };
}

async function compareHistoryItems(historyIds) {
  const ids = [...new Set((historyIds || []).map(id => String(id || '').trim()).filter(Boolean))].slice(0, 10);
  if (ids.length < 2) throw new Error('Select at least two history items to compare.');

  const history = await getHistory();
  const selected = ids
    .map(id => history.find(item => item.id === id))
    .filter(Boolean);

  if (selected.length < 2) throw new Error('Could not find enough selected history items.');

  const settings = await loadSettings();
  const threads = selected.map(item => ({
    ...(item.rawData || item),
    timestamp: item.timestamp || Date.now()
  }));
  const titles = selected.map(item => item.post?.title || 'Untitled thread');
  const sourceUrls = selected.map(item => item.post?.url || item.rawData?.post?.url).filter(Boolean);

  const batchData = {
    isBatch: true,
    compareMode: true,
    threads,
    post: {
      title: `Compare: ${titles.slice(0, 3).join(' vs ')}${titles.length > 3 ? '...' : ''}`,
      author: 'history',
      subreddit: 'multiple',
      url: sourceUrls[0] || '',
      content: ''
    },
    comments: [],
    metadata: {
      scrapedAt: new Date().toISOString(),
      commentCount: threads.reduce((sum, thread) => sum + (thread.metadata?.commentCount || 0), 0),
      threadCount: threads.length,
      sourceUrls,
      storageOption: 'sessionOnly',
      aiProvider: settings.selectedLlmProvider,
      preset: settings.selectedPreset,
      contextPreset: settings.contextPreset,
      trimStrategy: settings.trimStrategy,
      mediaMode: settings.mediaMode,
      compareMode: true
    },
    timestamp: Date.now()
  };

  await savePreviewData(batchData, { ...settings, dataStorageOption: 'sessionOnly' });
  await openPreviewTab();
  return { success: true, count: selected.length };
}

function sortHistory(history) {
  return [...history].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
    return Number(b.timestamp || 0) - Number(a.timestamp || 0);
  });
}

const PRESET_TEMPLATES = {
  summarize: `Provide a concise TL;DR summary of this Reddit thread.
Focus on: the main topic, key points made, and overall conclusion.
Keep it brief but comprehensive.

{content}`,
  debate: `Analyze this Reddit thread as a debate.
Map out:
1. The different sides/perspectives presented
2. Key arguments for each position
3. Points of agreement and disagreement
4. Which arguments are strongest and why

{content}`,
  sentiment: `Perform a sentiment analysis on this Reddit thread.
Analyze:
1. Overall sentiment (positive/negative/neutral)
2. Breakdown by comment - what % are positive, negative, neutral
3. Most emotionally charged comments
4. Tone shifts throughout the discussion

{content}`,
  takeaways: `Extract the key takeaways from this Reddit thread.
Provide:
- Main insights as bullet points
- Actionable advice mentioned
- Important facts or statistics shared
- Common recommendations from multiple users

{content}`,
  eli5: `Explain this Reddit thread like I'm 5 years old.
Use simple language, analogies, and examples.
Avoid jargon and technical terms.
Make it easy to understand for someone new to this topic.

{content}`
};

function matchSubredditPattern(subreddit, pattern) {
  if (!subreddit || !pattern) return false;
  const sub = subreddit.trim().toLowerCase();
  const pat = pattern.trim().toLowerCase();
  if (pat === sub) return true;
  if (pat.includes('*')) {
    const escaped = pat.replace(/[-\/\\^$+.()|[\]{}?]/g, '\\$&');
    const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
    try {
      const regex = new RegExp(regexStr);
      return regex.test(sub);
    } catch (e) {
      console.error('Invalid wildcard pattern:', pat, e);
      return false;
    }
  }
  return false;
}

function resolveSubredditSettings(subreddit, settings) {
  const resolved = { ...settings };
  if (!subreddit || !Array.isArray(settings?.subredditPromptMappings)) {
    return resolved;
  }
  for (const rule of settings.subredditPromptMappings) {
    if (matchSubredditPattern(subreddit, rule.pattern)) {
      const i18nTemplate = typeof chrome !== 'undefined' && chrome.i18n ? chrome.i18n.getMessage(`template_${rule.preset}`) : '';
      const presetTemplate = i18nTemplate || PRESET_TEMPLATES[rule.preset];
      if (presetTemplate) {
        resolved.defaultPromptTemplate = presetTemplate;
        resolved.selectedPreset = rule.preset;
        break;
      }
    }
  }
  return resolved;
}

// =====================
// Direct API mode
// =====================
//
// Keys are read from chrome.storage.local and never from chrome.storage.sync: sync
// replicates through Google's servers and has a small per-item quota. They are held
// only for the lifetime of a single request, are placed exclusively in request
// headers, and are never logged, never written into the preview/paste payloads and
// never included in the settings export (which only walks a sync-key allowlist).

async function getDirectApiConfig() {
  const result = await getStorage(chrome.storage.local, DIRECT_API_CONFIG_KEY);
  const stored = result?.[DIRECT_API_CONFIG_KEY];
  return stored && typeof stored === 'object' ? stored : {};
}

async function getDirectApiProviderConfig(provider) {
  const config = await getDirectApiConfig();
  const entry = config[provider];
  return {
    apiKey: typeof entry?.apiKey === 'string' ? entry.apiKey : '',
    model: typeof entry?.model === 'string' ? entry.model : ''
  };
}

// Reports which providers are usable without ever handing a key back to a page.
async function getDirectApiStatus() {
  const config = await getDirectApiConfig();
  const providers = {};
  for (const provider of R2AIApiProviders.PROVIDER_IDS) {
    const entry = config[provider];
    const definition = R2AIApiProviders.PROVIDERS[provider];
    providers[provider] = {
      id: provider,
      label: definition.label,
      configured: Boolean(typeof entry?.apiKey === 'string' && entry.apiKey.trim()),
      model: R2AIApiProviders.resolveModel(provider, entry?.model),
      defaultModel: definition.defaultModel,
      suggestedModels: definition.suggestedModels
    };
  }
  return { providers };
}

/**
 * Performs one provider call. Returns `{ ok: true, payload }` on HTTP 2xx or
 * `{ ok: false, status, payload }` otherwise, so the caller decides how to map it.
 * Network faults and the abort timeout are surfaced as thrown errors.
 */
async function performApiFetch(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || R2AIApiProviders.REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('The AI provider did not respond in time. Try again or use a smaller prompt.');
    }
    // Deliberately does not echo the request: the headers hold the API key.
    throw new Error(`Could not reach the AI provider: ${error?.message || 'network error'}`);
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { ok: response.ok, status: response.status, payload };
}

/**
 * Sends `promptText` to the configured provider and returns the assistant's reply.
 * Runs entirely inside the originating message's promise chain so the pending fetch
 * keeps the service worker alive for the full timeout window.
 */
async function callDirectApi(provider, promptText, options = {}) {
  if (!R2AIApiProviders.isSupportedProvider(provider)) {
    throw new Error(`Unknown direct API provider: ${provider}`);
  }
  const stored = await getDirectApiProviderConfig(provider);
  const apiKey = options.apiKey || stored.apiKey;
  if (!apiKey) {
    throw new Error(`No API key is configured for ${R2AIApiProviders.PROVIDERS[provider].label}. Add one in the extension options.`);
  }
  const model = options.model || stored.model;
  const maxTokens = options.maxTokens;

  const startedAt = Date.now();
  let request = R2AIApiProviders.buildRequest(provider, { apiKey, model, promptText, maxTokens });
  let result = await performApiFetch(request, options.timeoutMs);

  // Older OpenAI models reject `max_completion_tokens`; retry once with `max_tokens`.
  if (!result.ok && R2AIApiProviders.isMaxTokensParamError(provider, result.status, result.payload)) {
    request = R2AIApiProviders.buildRequest(provider, {
      apiKey,
      model,
      promptText,
      maxTokens,
      legacyMaxTokens: true
    });
    result = await performApiFetch(request, options.timeoutMs);
  }

  if (!result.ok) {
    const mapped = R2AIApiProviders.mapError(provider, result.status, result.payload);
    const error = new Error(mapped.message);
    error.retryable = mapped.retryable;
    error.status = mapped.status;
    error.providerErrorType = mapped.type;
    throw error;
  }

  const parsed = R2AIApiProviders.parseResponse(provider, result.payload);
  return {
    provider,
    model: R2AIApiProviders.resolveModel(provider, model),
    text: parsed.text,
    refused: parsed.refused,
    truncated: parsed.truncated,
    stopReason: parsed.stopReason,
    durationMs: Date.now() - startedAt,
    receivedAt: Date.now()
  };
}

async function sendPromptViaApi(request) {
  const provider = request.apiProvider;
  const promptText = String(request.promptText || '');
  const result = await callDirectApi(provider, promptText);

  // Persist alongside the history entry when history saving is on. A failure here
  // must not lose the response the user is waiting on, so it is logged and ignored.
  const historyId = request.historyId || (await getPreviewData())?.historyId || null;
  if (historyId) {
    try {
      await updateHistoryItem(historyId, {
        apiResponse: {
          provider: result.provider,
          model: result.model,
          text: result.text,
          refused: result.refused,
          truncated: result.truncated,
          receivedAt: result.receivedAt
        }
      });
    } catch (error) {
      console.warn('Reddit to AI: Could not attach the API response to history:', error.message);
    }
  }

  return { success: true, response: result };
}

// Minimal round-trip used by the options page "Test key" buttons. The key comes from
// the options form so a user can verify it before saving.
async function testDirectApiKey(request) {
  const provider = request.apiProvider;
  const result = await callDirectApi(provider, 'Say OK', {
    apiKey: request.apiKey,
    model: request.model,
    maxTokens: 16,
    timeoutMs: 30000
  });
  return { success: true, model: result.model, text: result.text };
}

// =====================
// Storage / Settings
// =====================

async function loadSettings() {
  const defaults = {
    defaultPromptTemplate: DEFAULT_PROMPT_TEMPLATE,
    dataStorageOption: 'persistent',
    selectedLlmProvider: 'gemini',
    selectedPreset: 'summarize',
    contextPreset: 'balanced',
    trimStrategy: 'top',
    mediaMode: 'attach',
    redditSortMode: 'confidence',
    outputFormat: 'auto',
    showPromptPreview: true,
    subredditPromptMappings: []
  };

  const items = await getStorage(chrome.storage.sync, [
    'defaultPromptTemplate',
    'dataStorageOption',
    'selectedLlmProvider',
    'selectedPreset',
    'contextPreset',
    'trimStrategy',
    'mediaMode',
    'redditSortMode',
    'outputFormat',
    'showPromptPreview',
    'subredditPromptMappings'
  ]);
  return { ...defaults, ...items };
}

function mergeRequestFiltersIntoSettings(settings, filters = {}, request = {}) {
  return {
    ...settings,
    selectedLlmProvider: request.selectedLlmProvider || settings.selectedLlmProvider || 'gemini',
    dataStorageOption: request.dataStorageOptionOverride || settings.dataStorageOption || 'persistent',
    contextPreset: filters.contextPreset || settings.contextPreset || 'balanced',
    trimStrategy: filters.trimStrategy || settings.trimStrategy || 'top',
    mediaMode: filters.mediaMode || settings.mediaMode || 'attach',
    redditSortMode: filters.redditSortMode || settings.redditSortMode || 'confidence',
    outputFormat: filters.outputFormat || settings.outputFormat || 'auto',
    showPromptPreview: request.directSendOnce === true
      ? false
      : (typeof request.showPromptPreview === 'boolean' ? request.showPromptPreview : settings.showPromptPreview !== false)
  };
}

function getStorageArea(option) {
  if (option === 'persistent') return chrome.storage.local;
  return chrome.storage.session || chrome.storage.local;
}

function getOtherStorageArea(option) {
  return option === 'persistent' ? (chrome.storage.session || null) : chrome.storage.local;
}

function getStorageError() {
  const lastError = chrome.runtime?.lastError;
  if (!lastError) return null;
  return new Error(lastError.message || 'chrome.storage operation failed.');
}

function getStorage(area, keys) {
  return new Promise((resolve, reject) => {
    if (!area) {
      resolve({});
      return;
    }
    area.get(keys, result => {
      const error = getStorageError();
      if (error) reject(error);
      else resolve(result || {});
    });
  });
}

function setStorage(area, items) {
  return new Promise((resolve, reject) => {
    if (!area) {
      resolve();
      return;
    }
    area.set(items, () => {
      const error = getStorageError();
      if (error) reject(error);
      else resolve();
    });
  });
}

function removeStorage(area, keys) {
  return new Promise((resolve, reject) => {
    if (!area) {
      resolve();
      return;
    }
    area.remove(keys, () => {
      const error = getStorageError();
      if (error) reject(error);
      else resolve();
    });
  });
}

// =====================
// Tab / State Helpers
// =====================

function setScrapingState(patch) {
  scrapingState = { ...scrapingState, ...patch };
  persistScrapingState();
  broadcastScrapingState();
}

// The state object is a handful of scalars, so mirroring it into storage.session on
// every change is cheap and lets a woken worker answer `getScrapingState` correctly.
// Fire and forget: a failed mirror must never break the scrape itself.
function persistScrapingState() {
  if (!chrome.storage.session) return;
  setStorage(chrome.storage.session, { [SCRAPING_STATE_KEY]: scrapingState })
    .catch(error => console.debug('Scraping state persist skipped:', error.message));
}

function broadcastScrapingState() {
  chrome.runtime.sendMessage({ action: 'scrapingStateUpdate', data: scrapingState }, () => {
    if (chrome.runtime.lastError) {
      // Popup not listening; ignore.
    }
  });

  if (scrapingState.lastScrapedTabId != null) {
    chrome.tabs.sendMessage(
      scrapingState.lastScrapedTabId,
      { action: 'updateFloatingPanel', data: scrapingState },
      () => chrome.runtime.lastError && console.debug('Floating panel update skipped:', chrome.runtime.lastError.message)
    );
  }
}

async function stopActiveScrape() {
  // Awaited so a stop cannot lose a race with the auto-resume on the next wake-up.
  await removeStorage(chrome.storage.local, ['activeBatch'])
    .catch(error => console.warn('Reddit to AI: Failed to clear activeBatch:', error));
  await clearScrapeContext();
  if (!currentScrape) return;
  currentScrape.stopRequested = true;
  setScrapingState({ message: chrome.i18n.getMessage('sw_status_stop_requested') || 'Stop requested.', percentage: scrapingState.percentage });
  if (currentScrape.abortController) currentScrape.abortController.abort();
  if (typeof currentScrape.tabId === 'number') {
    chrome.tabs.sendMessage(
      currentScrape.tabId,
      { action: 'stopScrapingRequested' },
      () => chrome.runtime.lastError && console.debug('Stop message warning:', chrome.runtime.lastError.message)
    );
  }
}

// Tab URLs are only readable where the extension has a permission for them: a
// Reddit tab is covered by host_permissions, and the tab that was active when the
// user clicked the action is covered by activeTab. The broad `tabs` permission is
// deliberately not requested, so when the active tab's URL comes back empty we
// retry with a Reddit-scoped match pattern instead of assuming we may read it.
const REDDIT_TAB_MATCHES = ['*://*.reddit.com/*', 'https://*.redd.it/*'];

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs && tabs[0];
  if (activeTab && getTabUrl(activeTab)) return activeTab;

  const redditTabs = await chrome.tabs
    .query({ active: true, lastFocusedWindow: true, url: REDDIT_TAB_MATCHES })
    .catch(() => []);
  if (redditTabs && redditTabs[0]) return redditTabs[0];

  if (activeTab) return activeTab;
  throw new Error('No active tab detected.');
}

async function getScrapeTargetTab(request, sender) {
  if (request?.tabId != null) {
    try {
      const tabFromRequest = await getTabById(request.tabId);
      if (tabFromRequest) return tabFromRequest;
    } catch (error) {
      console.debug('Failed to resolve tab from request.tabId:', error);
    }
  }
  if (sender?.tab && sender.tab.id != null) return sender.tab;
  return getActiveTab();
}

function getTabUrl(tab) {
  return tab?.url || tab?.pendingUrl || '';
}

async function resolveTabUrl(tab) {
  let candidate = getTabUrl(tab);
  if (isRedditUrl(candidate) || !tab?.id) return candidate;
  for (let attempt = 0; attempt < 5; attempt++) {
    await delay(150 + attempt * 100);
    try {
      const refreshedTab = await getTabById(tab.id);
      candidate = getTabUrl(refreshedTab);
      if (isRedditUrl(candidate)) return candidate;
    } catch (error) {
      console.debug('Failed to refresh tab URL:', error);
      break;
    }
  }
  return candidate;
}

function getTabById(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

async function focusLastRedditTab() {
  const payload = await getPreviewData();
  const tabId = payload?.data?.metadata?.redditTabId || scrapingState.lastScrapedTabId;
  if (typeof tabId !== 'number') throw new Error('No Reddit tab recorded.');
  const tab = await getTabById(tabId);
  await chrome.tabs.update(tabId, { active: true });
  if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
}

function isRedditUrl(url) {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === 'reddit.com' || hostname.endsWith('.reddit.com') || hostname === 'redd.it' || hostname.endsWith('.redd.it');
  } catch (error) {
    console.warn('Failed to parse tab URL:', url, error);
    return false;
  }
}

async function injectContentScripts(tabId) {

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['floatingPanel.js'] });
  } catch (error) {
    console.debug('Floating panel script injection skipped:', error.message);
  }

  // cl100k_base.js is intentionally not injected here: nothing on a Reddit tab asks
  // for exact token counts, and promptBuilder falls back to a length / 4 estimate.
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['promptBuilder.js'] });
  } catch (error) {
    console.debug('Prompt helper injection skipped:', error.message);
  }

  // redditScraper.js parses through R2AIRedditParser, so this injection is not
  // optional; let a failure surface instead of scraping with a missing dependency.
  await chrome.scripting.executeScript({ target: { tabId }, files: ['redditParser.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['redditScraper.js'] });
}

async function requestScrapeFromTab(tabId, includeHidden, filters, scrapeId) {
  const message = { action: 'scrapeReddit', includeHidden, filters, scrapeId };
  try {
    return await sendMessageToTab(tabId, message);
  } catch (error) {
    if (/Receiving end does not exist/.test(error.message)) {
      await delay(250);
      return sendMessageToTab(tabId, message);
    }
    throw error;
  }
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function showNotificationIfEnabled(title, message, notificationIdBase = 'reddit-to-ai') {
  if (!chrome.notifications?.create) return;
  chrome.storage.sync.get(['showNotifications'], result => {
    const shouldShow = typeof result.showNotifications === 'boolean' ? result.showNotifications : true;
    if (!shouldShow) return;
    chrome.notifications.create(
      `${notificationIdBase}-${Date.now()}`,
      { type: 'basic', iconUrl: 'images/icon128.png', title, message },
      () => chrome.runtime.lastError && console.debug('Notification skipped:', chrome.runtime.lastError.message)
    );
  });
}

async function getAiUrl(providerKey) {
  const map = {
    gemini: 'https://gemini.google.com/app',
    chatgpt: 'https://chatgpt.com/',
    claude: 'https://claude.ai/new',
    aistudio: 'https://aistudio.google.com/prompts/new_chat',
    deepseek: 'https://chat.deepseek.com/',
    groq: 'https://groq.com/'
  };
  if (providerKey === 'custom') {
    const res = await new Promise(resolve => {
      chrome.storage.sync.get(['customOrigins'], (r) => resolve(r.customOrigins || []));
    });
    if (res && res.length > 0) {
      const match = res[0];
      if (match.endsWith('/*')) {
        return match.slice(0, -2);
      }
      if (match.endsWith('*')) {
        return match.slice(0, -1);
      }
      return match;
    }
    // No custom origin configured: opening a hard-coded localhost URL silently sent
    // users to a page that almost never exists. Surface the misconfiguration instead.
    const message = chrome.i18n.getMessage('sw_error_custom_origin_missing')
      || 'No custom AI origin is configured. Add one in Options before using the custom provider.';
    showNotificationIfEnabled(chrome.i18n.getMessage('extName') || 'Reddit to AI', message);
    throw new Error(message);
  }
  return map[providerKey] || map.gemini;
}

function getScriptIdForOrigin(originPattern) {
  return 'ai-paster-' + originPattern.replace(/[^a-zA-Z0-9_-]/g, '-');
}

async function registerCustomOriginScript(originPattern) {
  const scriptId = getScriptIdForOrigin(originPattern);
  try {
    if (typeof chrome !== 'undefined' && chrome.scripting) {
      await chrome.scripting.unregisterContentScripts({ ids: [scriptId] }).catch(() => {});
      await chrome.scripting.registerContentScripts([
        {
          id: scriptId,
          matches: [originPattern],
          js: ['i18n.js', 'cl100k_base.js', 'promptBuilder.js', 'aiPaster.js'],
          runAt: 'document_idle'
        }
      ]);
      console.debug(`Registered content script for: ${originPattern} with ID: ${scriptId}`);
    }
  } catch (err) {
    console.error(`Failed to register content script for ${originPattern}:`, err);
    throw err;
  }
}

async function unregisterCustomOriginScript(originPattern) {
  const scriptId = getScriptIdForOrigin(originPattern);
  try {
    if (typeof chrome !== 'undefined' && chrome.scripting) {
      await chrome.scripting.unregisterContentScripts({ ids: [scriptId] }).catch(() => {});
      console.debug(`Unregistered content script for: ${originPattern} with ID: ${scriptId}`);
    }
  } catch (err) {
    console.error(`Failed to unregister content script for ${originPattern}:`, err);
    throw err;
  }
}

async function registerAllCustomOrigins() {
  return new Promise(resolve => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['customOrigins'], async (result) => {
        const origins = result.customOrigins || [];
        for (const origin of origins) {
          try {
            await registerCustomOriginScript(origin);
          } catch (e) {
            console.error(`Error registering custom origin ${origin} on startup:`, e);
          }
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// =====================
// Data Processing
// =====================

function enrichScrapedData(data, url, context = {}) {
  const timestamp = new Date().toISOString();
  const failedMoreIds = data.morechildren?.failedIds || [];
  return {
    ...data,
    post: {
      title: data.post?.title || '[Unknown title]',
      author: data.post?.author || '[Unknown author]',
      subreddit: data.post?.subreddit || inferSubredditFromUrl(url),
      url: url || data.post?.url || '',
      content: data.post?.content || '',
      images: data.post?.images || [],
      links: data.post?.links || [],
      videos: data.post?.videos || [],
      youtubeVideoUrls: data.post?.youtubeVideoUrls || [],
      sourceUrls: data.post?.sourceUrls || [],
      flair: data.post?.flair || null,
      isNsfw: Boolean(data.post?.isNsfw),
      isSpoiler: Boolean(data.post?.isSpoiler),
      awardCount: data.post?.awardCount || 0,
      poll: data.post?.poll || null,
      crosspostParentUrl: data.post?.crosspostParentUrl || null
    },
    metadata: {
      scrapedAt: timestamp,
      commentCount: countComments(data.comments),
      includeHidden: Boolean(data.includeHidden),
      loadMoreAttempts: data.loadMoreAttempts || 0,
      failedMoreIds,
      redditTabId: context.redditTabId ?? null,
      threadId: data.post?.threadId || data.threadId || data.post?.name || data.morechildren?.threadId || data.filtersApplied?.threadId || data.post?.id || inferThreadId(data),
      storageOption: context.settings?.dataStorageOption || 'persistent',
      aiProvider: context.settings?.selectedLlmProvider || 'gemini',
      preset: context.settings?.selectedPreset || 'summarize',
      contextPreset: context.settings?.contextPreset || 'balanced',
      trimStrategy: context.settings?.trimStrategy || data.filtersApplied?.trimStrategy || 'top',
      mediaMode: context.settings?.mediaMode || 'attach',
      redditSortMode: context.settings?.redditSortMode || data.filtersApplied?.redditSortMode || 'confidence',
      outputFormat: context.settings?.outputFormat || 'auto',
      deliveryMode: context.settings?.showPromptPreview === false ? 'direct' : 'preview',
      pasteStatus: context.settings?.showPromptPreview === false ? 'pending' : 'not_started',
      originalCommentCount: data.originalCount ?? data.metadata?.originalCommentCount ?? countComments(data.comments),
      finalCommentCount: countComments(data.comments),
      filteredOutCount: Math.max(0, Number(data.originalCount || 0) - countComments(data.comments)),
      scrapeDepth: data.maxDepth || context.settings?.scrapeDepth || null
    }
  };
}

function inferThreadId(data) {
  const firstComment = data.comments?.[0];
  if (firstComment?.parentId?.startsWith('t3_')) return firstComment.parentId;
  return null;
}

function countComments(comments) {
  if (globalThis.R2AIPrompt?.countComments) return R2AIPrompt.countComments(comments);
  return R2AIRedditParser.countComments(comments);
}

function inferSubredditFromUrl(url) {
  if (!url) return '[Unknown subreddit]';
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/\/r\/([^/]+)/i);
    return match ? match[1] : '[Unknown subreddit]';
  } catch {
    return '[Unknown subreddit]';
  }
}

// =====================
// Background batch scraping
// =====================

function normalizeBatchUrls(urls) {
  return [...new Set((urls || [])
    .map(url => String(url || '').trim())
    .filter(url => {
      try {
        return isRedditUrl(new URL(url).toString());
      } catch {
        return false;
      }
    }))].slice(0, 10);
}

async function scrapeThreadFromUrl(url, settings, filters) {
  const sortMode = filters.redditSortMode || settings.redditSortMode || 'confidence';
  const jsonUrl = buildRedditJsonUrl(url, sortMode, filters.scrapeDepth || settings.scrapeDepth || 10);
  const response = await fetchJsonWithRetry(jsonUrl);
  const postData = response?.[0]?.data?.children?.[0]?.data;
  const commentsData = response?.[1]?.data?.children || [];
  if (!postData) throw new Error(`Could not scrape ${url}`);

  const moreIds = [];
  const roots = parseBackgroundComments(commentsData, Boolean(filters.includeHidden), filters.scrapeDepth || settings.scrapeDepth || 10, moreIds);
  const moreResult = await fetchMoreChildrenBackground(postData.name, moreIds, Boolean(filters.includeHidden), sortMode);
  const merged = mergeAdditionalComments(roots, moreResult.comments, postData.name).roots;
  const filtered = applyBackgroundFilters(merged, filters, settings);

  const data = {
    post: extractBackgroundPost(postData, url),
    comments: filtered,
    includeHidden: Boolean(filters.includeHidden),
    maxDepth: filters.scrapeDepth || settings.scrapeDepth || 10,
    filtersApplied: {
      minScore: filters.minScore || 0,
      topN: filters.topN || 0,
      trimStrategy: filters.trimStrategy || settings.trimStrategy || 'top',
      redditSortMode: sortMode
    },
    morechildren: { failedIds: moreResult.failedIds || [] },
    threadUrl: url
  };
  return enrichScrapedData(data, url, { settings });
}

function buildRedditJsonUrl(inputUrl, sortMode, depth) {
  return R2AIRedditParser.buildRedditJsonUrl(inputUrl, sortMode, depth);
}

async function fetchJsonWithRetry(url, retries = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (response.status === 429) {
        await delay(Math.pow(2, attempt + 1) * 1000);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) await delay(Math.pow(2, attempt) * 1000);
    }
  }
  throw lastError || new Error('Fetch failed');
}

async function fetchMoreChildrenBackground(threadId, moreIds, includeHidden, sortMode) {
  const comments = [];
  const failedIds = [];
  const queue = [];
  const seen = new Set();
  enqueueMoreIds(moreIds, queue, seen);

  while (queue.length > 0) {
    const batch = queue.shift();
    try {
      const params = new URLSearchParams({
        api_type: 'json',
        link_id: threadId,
        children: batch.join(','),
        raw_json: '1',
        limit_children: 'false',
        sort: sortMode || 'confidence'
      });
      const data = await fetchJsonWithRetry(`https://www.reddit.com/api/morechildren.json?${params.toString()}`);
      const things = data?.json?.data?.things || [];
      const nestedMore = [];
      for (const thing of things) {
        if (thing.kind === 't1') {
          const parsed = parseBackgroundCommentData(thing.data, includeHidden);
          if (parsed) comments.push(parsed);
        } else if (thing.kind === 'more' && Array.isArray(thing.data?.children)) {
          nestedMore.push(...thing.data.children);
        }
      }
      enqueueMoreIds(nestedMore, queue, seen);
    } catch (error) {
      console.warn('Batch morechildren fetch failed:', error);
      failedIds.push(...batch);
    }
    if (queue.length > 0) await delay(1000);
  }

  return { comments, failedIds };
}

function enqueueMoreIds(ids, queue, seenIds) {
  const clean = [];
  for (const id of ids || []) {
    const id36 = String(id || '').replace(/^t1_/, '').trim();
    if (!id36 || seenIds.has(id36)) continue;
    seenIds.add(id36);
    clean.push(id36);
  }
  for (let i = 0; i < clean.length; i += 100) {
    queue.push(clean.slice(i, i + 100));
  }
}

function parseBackgroundComments(children, includeHidden, maxDepth, moreIds) {
  return R2AIRedditParser.parseComments(children, {
    includeHidden,
    maxDepth,
    moreIds,
    placeholderStyle: 'background'
  }).roots;
}

function parseBackgroundCommentNode(child, includeHidden, depth, maxDepth, moreIds) {
  return R2AIRedditParser.parseCommentNode(
    child,
    { includeHidden, maxDepth, moreIds, placeholderStyle: 'background' },
    depth
  );
}

function parseBackgroundCommentData(data, includeHidden, replies = []) {
  return R2AIRedditParser.parseCommentData(data, includeHidden, replies);
}

function applyBackgroundFilters(comments, filters, settings) {
  let result = R2AIRedditParser.filterComments(comments, {
    minScore: filters.minScore || 0,
    hideBots: Boolean(filters.hideBots),
    authorTypes: Array.isArray(filters.authorTypes) ? filters.authorTypes : []
  });
  const topN = filters.topN || 0;
  if (topN > 0 && globalThis.R2AIPrompt?.trimComments) {
    result = R2AIPrompt.trimComments(result, topN, filters.trimStrategy || settings.trimStrategy || 'top');
  }
  return result;
}

function extractBackgroundPost(data, url) {
  const images = [];
  if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(data.url || '')) images.push(data.url);
  if (data.preview?.images?.[0]?.source?.url) images.push(data.preview.images[0].source.url.replace(/&amp;/g, '&'));
  if (data.media_metadata) {
    Object.values(data.media_metadata).forEach(item => {
      if (item?.s?.u) images.push(item.s.u.replace(/&amp;/g, '&'));
    });
  }
  const outbound = data.url_overridden_by_dest || data.url;
  const links = data.is_self || !outbound ? [] : [outbound];
  return {
    title: data.title,
    author: data.author,
    subreddit: data.subreddit,
    url,
    content: data.selftext || '',
    flair: data.link_flair_text || null,
    isNsfw: Boolean(data.over_18),
    isSpoiler: Boolean(data.spoiler),
    awardCount: data.total_awards_received || 0,
    images: [...new Set(images)].slice(0, 20),
    links,
    videos: [],
    youtubeVideoUrls: /(?:youtube\.com|youtu\.be)/i.test(outbound || '') ? [outbound] : [],
    sourceUrls: links,
    poll: data.poll_data ? {
      totalVoteCount: data.poll_data.total_vote_count || null,
      options: (data.poll_data.options || []).map(option => ({ text: option.text, voteCount: option.vote_count ?? null }))
    } : null
  };
}

// =====================
// Misc
// =====================

async function fetchImageAsBase64(url) {
  if (!url) throw new Error('No URL provided');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();
  const mimeType = blob.type || 'image/jpeg';
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { base64: btoa(binary), mimeType, size: blob.size };
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const KNOWN_SELECTOR_PLATFORMS = ['gemini', 'chatgpt', 'claude', 'aistudio', 'deepseek', 'groq', 'custom'];
const SELECTOR_STRING_FIELDS = ['inputSelector'];
const SELECTOR_BOOLEAN_FIELDS = ['isContentEditable'];

// Accepts only known platform keys with string selectors / boolean flags.
// Anything else (unknown platforms, non-string selectors, metadata such as `version`) is skipped.
function sanitizeSyncedSelectors(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clean = {};
  for (const platform of KNOWN_SELECTOR_PLATFORMS) {
    const value = raw[platform];
    if (value === undefined || value === null) continue;

    if (typeof value === 'string') {
      if (value.trim()) clean[platform] = value;
      continue;
    }
    if (typeof value !== 'object' || Array.isArray(value)) continue;

    const entry = {};
    for (const field of SELECTOR_STRING_FIELDS) {
      if (typeof value[field] === 'string' && value[field].trim()) entry[field] = value[field];
    }
    for (const field of SELECTOR_BOOLEAN_FIELDS) {
      if (typeof value[field] === 'boolean') entry[field] = value[field];
    }
    if (Object.keys(entry).length > 0) clean[platform] = entry;
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

async function syncSelectors() {
  try {
    const url = 'https://raw.githubusercontent.com/KhazP/Reddit-to-AI/main/selectors.json';
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const raw = await response.json();
    const selectors = sanitizeSyncedSelectors(raw);
    if (!selectors) {
      console.warn('Reddit to AI: Remote selectors payload had no usable entries; skipping.');
    } else {
      await new Promise(resolve => {
        chrome.storage.local.set({
          syncedSelectors: selectors,
          lastSelectorSyncTime: Date.now()
        }, resolve);
      });
      console.debug('Reddit to AI: Selectors synced successfully.');
    }
  } catch (error) {
    console.warn('Reddit to AI: Failed to sync selectors:', error);
  }
}

async function checkAndSyncSelectors() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['lastSelectorSyncTime'], async (result) => {
      const lastSelectorSyncTime = result.lastSelectorSyncTime;
      const now = Date.now();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      if (!lastSelectorSyncTime || (now - lastSelectorSyncTime) > ONE_DAY_MS) {
        await syncSelectors();
      }
      resolve();
    });
  });
}

// Call on startup
if (!globalThis.R2AIServiceWorkerTest) {
  checkAndSyncSelectors().catch(err => console.error('Selector check failed:', err));
  registerAllCustomOrigins().catch(err => console.error('Failed to register custom origins on startup:', err));
}

// Set up listeners
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    checkAndSyncSelectors().catch(err => console.error('Selector check failed:', err));
    registerAllCustomOrigins().catch(err => console.error('Failed to register custom origins on startup listener:', err));
  });
}



// Simple cache for quick estimates. Entries are `{ data, timestamp }` and expire
// after QUICK_ESTIMATE_TTL_MS so a thread that keeps growing is not estimated from
// a stale snapshot for the whole life of the worker.
const QUICK_ESTIMATE_TTL_MS = 5 * 60 * 1000;
const quickEstimateCache = new Map();

// Helper to check if URL is a Reddit post
function isRedditPostUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    if (!/(^|\.)reddit\.com$/i.test(url.hostname) && !/(^|\.)redd\.it$/i.test(url.hostname)) {
      return false;
    }
    return url.pathname.includes('/comments/');
  } catch {
    return false;
  }
}

// Simple recursive JSON parser for comments
function parseSimpleJsonComments(children) {
  const list = [];
  if (!Array.isArray(children)) return list;
  for (const child of children) {
    if (child.kind === 't1') {
      const data = child.data;
      if (!data) continue;
      const item = {
        id: data.name,
        author: data.author,
        text: data.body || '',
        body: data.body || '',
        score: data.score || 0,
        replies: []
      };
      if (data.replies && data.replies.data && Array.isArray(data.replies.data.children)) {
        item.replies = parseSimpleJsonComments(data.replies.data.children);
      }
      list.push(item);
    }
  }
  return list;
}

// Handle quick estimate
async function getQuickTokenEstimate(tabId, urlStr) {
  if (!isRedditPostUrl(urlStr)) {
    throw new Error('Not a Reddit post URL.');
  }
  const cached = quickEstimateCache.get(urlStr);
  if (cached) {
    if (Date.now() - (cached.timestamp || 0) < QUICK_ESTIMATE_TTL_MS) {
      return cached.data;
    }
    quickEstimateCache.delete(urlStr);
  }

  // Construct JSON URL
  const cleanUrl = urlStr.split('?')[0];
  const jsonUrl = cleanUrl.endsWith('/') ? cleanUrl.slice(0, -1) + '.json' : cleanUrl + '.json';

  const res = await fetch(jsonUrl + '?raw_json=1', {
    headers: { Accept: 'application/json' }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch JSON: ${res.status}`);
  }

  const response = await res.json();
  if (!Array.isArray(response) || response.length < 2) {
    throw new Error('Invalid Reddit JSON format.');
  }

  const postData = response[0]?.data?.children?.[0]?.data;
  const commentsData = response[1]?.data?.children || [];
  if (!postData) {
    throw new Error('Reddit JSON did not include post data.');
  }

  const estimatedData = {
    post: {
      title: postData.title,
      selftext: postData.selftext || '',
      content: postData.selftext || '',
      author: postData.author,
      score: postData.score,
      subreddit: postData.subreddit,
      permalink: postData.permalink ? `https://www.reddit.com${postData.permalink}` : urlStr,
      url: postData.url || urlStr
    },
    comments: parseSimpleJsonComments(commentsData),
    metadata: {
      threadId: postData.name,
      subreddit: postData.subreddit
    }
  };

  if (quickEstimateCache.size >= 50) {
    const oldestKey = quickEstimateCache.keys().next().value;
    quickEstimateCache.delete(oldestKey);
  }
  quickEstimateCache.set(urlStr, { data: estimatedData, timestamp: Date.now() });
  return estimatedData;
}

async function getLocaleData(lang) {
  const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load locale: ${response.status}`);
  }
  return await response.json();
}


if (globalThis.R2AIServiceWorkerTest) {
  Object.assign(globalThis.R2AIServiceWorkerTest, {
    applyBackgroundFilters,
    mergeAdditionalComments,
    parseBackgroundComments,
    parseBackgroundCommentNode,
    syncSelectors,
    sanitizeSyncedSelectors,
    checkAndSyncSelectors,
    getScriptIdForOrigin,
    registerCustomOriginScript,
    unregisterCustomOriginScript,
    registerAllCustomOrigins,
    getAiUrl,
    matchSubredditPattern,
    resolveSubredditSettings,
    PRESET_TEMPLATES,
    resumeBatchScrape,
    handleBatchScrapeRequest,
    handleScrapeRequest,
    handleRuntimeMessage,
    finishTabScrape,
    getActiveScrapeContext,
    ready,
    SCRAPE_CONTEXT_KEY,
    SCRAPING_STATE_KEY,
    stopActiveScrape,
    getScrapingState: () => scrapingState,
    setScrapingState,
    getCurrentScrape: () => currentScrape,
    quickEstimateCache,
    getQuickTokenEstimate,
    addToHistory,
    resendHistoryItem,
    updateHistoryItem,
    getHistory,
    getDirectApiConfig,
    getDirectApiStatus,
    callDirectApi,
    sendPromptViaApi,
    testDirectApiKey,
    DIRECT_API_CONFIG_KEY,
    getStorage,
    setStorage,
    removeStorage,
    savePreviewData,
    chrome: typeof chrome !== 'undefined' ? chrome : null
  });
}

