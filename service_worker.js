/* global importScripts */
importScripts('promptBuilder.js');

const DEFAULT_PROMPT_TEMPLATE = 'Summarize the following Reddit thread:\n\n{content}';
const DEFAULT_HISTORY_LIMIT = 10;
const PREVIEW_STORAGE_KEY = 'redditPreviewData';
const PASTE_STORAGE_KEY = 'redditPendingPaste';
const LEGACY_THREAD_KEY = 'redditThreadData';

const DEFAULT_STATE = {
  isActive: false,
  message: chrome.i18n.getMessage('panel_status_ready') || 'Ready to scrape.',
  percentage: 0,
  summary: null,
  error: null,
  lastScrapedTabId: null
};

let scrapingState = { ...DEFAULT_STATE };
let currentScrape = null;
const activePasteHandoffs = new Set();

console.log('Service worker initialised.');

chrome.runtime.onInstalled.addListener(() => {
  console.log('Reddit to AI installed.');
  syncSelectors().catch(err => console.error('Selector sync on installed failed:', err));
  registerAllCustomOrigins().catch(err => console.error('Failed to register custom origins on installed:', err));
});

// =====================
// Message Handlers
// =====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
            percentage: -1
          });
          sendResponse({ status: 'error', error: error.message, currentState: scrapingState });
        });
      return true;
    }
    case 'stopScraping':
      stopActiveScrape();
      sendResponse({ status: 'stopping', currentState: scrapingState });
      return false;
    case 'progressUpdate':
      if (request.message) setScrapingState({ message: request.message });
      if (typeof request.percentage === 'number') setScrapingState({ percentage: request.percentage });
      sendResponse({ ok: true });
      return false;
    case 'getScrapingState':
      sendResponse(scrapingState);
      return false;
    case 'notifyUser':
      if (request.title && request.message) {
        showNotificationIfEnabled(request.title, request.message, request.notificationIdBase);
      }
      sendResponse({ ok: true });
      return false;
    case 'fetchImage': {
      fetchImageAsBase64(request.url)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'getPreviewData': {
      getPreviewData()
        .then(payload => {
          if (!payload?.data) throw new Error('No pending Reddit preview data found.');
          return loadSettings().then(settings => sendResponse({ data: payload.data, settings: { ...settings, ...payload.settings } }));
        })
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'sendPromptToAi': {
      sendPromptToAi(request)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'getPendingPasteData': {
      getPendingPasteData()
        .then(payload => sendResponse({ payload }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'markPendingPasteConsumed': {
      markPendingPasteConsumed(request.pasteId)
        .then(() => sendResponse({ ok: true }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'recordPasteFailure': {
      recordPasteFailure(request)
        .then(() => sendResponse({ ok: true }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'resumeMissingComments': {
      resumeMissingComments()
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'focusLastRedditTab': {
      focusLastRedditTab()
        .then(() => sendResponse({ ok: true }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'getHistory': {
      getHistory()
        .then(history => sendResponse({ history }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'deleteHistoryItem': {
      deleteFromHistory(request.historyId)
        .then(history => sendResponse({ history }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'clearHistory': {
      clearHistory()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'resendHistoryItem': {
      resendHistoryItem(request.historyId, request.aiProvider)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'getHistoryItem': {
      getHistoryItem(request.historyId)
        .then(item => sendResponse({ item }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'updateHistoryItem': {
      updateHistoryItem(request.historyId, request.patch || {})
        .then(history => sendResponse({ history }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'compareHistoryItems': {
      compareHistoryItems(request.historyIds || [])
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    }
    case 'checkLocalAiCapability': {
      checkLocalAiCapability()
        .then(available => sendResponse({ available }))
        .catch(error => sendResponse({ available: false, error: error.message }));
      return true;
    }
    case 'generateLocalSummary': {
      generateLocalSummary(request.promptText)
        .then(summary => sendResponse({ status: 'success', summary }))
        .catch(error => sendResponse({ status: 'error', error: error.message }));
      return true;
    }
    case 'registerCustomOrigin': {
      registerCustomOriginScript(request.origin)
        .then(() => sendResponse({ status: 'success' }))
        .catch(error => sendResponse({ status: 'error', error: error.message }));
      return true;
    }
    case 'unregisterCustomOrigin': {
      unregisterCustomOriginScript(request.origin)
        .then(() => sendResponse({ status: 'success' }))
        .catch(error => sendResponse({ status: 'error', error: error.message }));
      return true;
    }
    default:
      console.warn('Unhandled runtime message:', request);
      sendResponse({ status: 'ignored' });
      return false;
  }
});

// Port connection handler for streaming Local AI summaries
if (chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'local-ai-summary') {
      port.onMessage.addListener(async (msg) => {
        if (msg.action === 'summarize') {
          try {
            const summary = await generateLocalSummary(msg.promptText, (chunk) => {
              try {
                port.postMessage({ status: 'chunk', text: chunk });
              } catch (err) {
                console.debug('Port disconnected during streaming:', err);
              }
            });
            port.postMessage({ status: 'success', text: summary });
          } catch (error) {
            port.postMessage({ status: 'error', error: error.message });
          }
        }
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
      error: chrome.i18n.getMessage('sw_error_not_reddit') || 'Active tab is not a Reddit thread.'
    });
    throw new Error('Active tab is not a Reddit thread.');
  }

  currentScrape = {
    tabId: activeTab.id,
    stopRequested: false,
    storageOption: 'persistent',
    abortController: null
  };

  setScrapingState({ lastScrapedTabId: activeTab.id });

  try {
    await injectContentScripts(activeTab.id);
    setScrapingState({ message: chrome.i18n.getMessage('sw_status_collecting') || 'Collecting data from page.', percentage: 20 });

    const scrapeResponse = await requestScrapeFromTab(activeTab.id, request.includeHidden, request.filters || {});
    if (scrapeResponse?.error) throw new Error(`Content script error: ${scrapeResponse.error}`);
    if (!scrapeResponse?.data) throw new Error('Content script returned no data.');
    if (currentScrape.stopRequested) throw new Error('Scraping stopped by user.');

    setScrapingState({ message: chrome.i18n.getMessage('sw_status_processing') || 'Preparing scraped data.', percentage: 65 });

    const settings = await loadSettings();
    const effectiveSettings = mergeRequestFiltersIntoSettings(settings, request.filters || {}, request);
    currentScrape.storageOption = effectiveSettings.dataStorageOption;
    const refreshedTab = await getTabById(currentScrape.tabId);
    const processedData = enrichScrapedData(scrapeResponse.data, getTabUrl(refreshedTab), {
      redditTabId: activeTab.id,
      settings: effectiveSettings
    });
    processedData.timestamp = Date.now();

    await savePreviewData(processedData, effectiveSettings);
    if (effectiveSettings.dataStorageOption === 'persistent') {
      await addToHistory(processedData, effectiveSettings);
    }

    if (request.localSummarize) {
      setScrapingState({ message: 'Generating local summary...', percentage: 90, summary: '' });
      const renderedData = R2AIPrompt.applyContextPreset(processedData, effectiveSettings.contextPreset || 'balanced', effectiveSettings);
      const promptText = R2AIPrompt.buildPromptText(renderedData, effectiveSettings.defaultPromptTemplate, {
        ...effectiveSettings,
        contextPreset: null
      });

      const summaryText = await generateLocalSummary(promptText, (chunk) => {
        setScrapingState({
          isActive: true,
          percentage: 90,
          summary: chunk,
          message: 'Generating local summary...'
        });
      });

      setScrapingState({
        isActive: false,
        percentage: 100,
        summary: summaryText,
        message: 'Summary complete!',
        error: null
      });

      return { summary: summaryText, local: true };
    }

    if (effectiveSettings.showPromptPreview === false) {
      setScrapingState({ message: 'Opening AI tab...', percentage: 86 });
      await sendDataDirectlyToAi(processedData, effectiveSettings);
    } else {
      setScrapingState({ message: 'Opening prompt preview...', percentage: 86 });
      await openPreviewTab();
    }

    setScrapingState({
      isActive: false,
      percentage: 100,
      summary: null,
      message: effectiveSettings.showPromptPreview === false ? 'Content sent directly to AI.' : 'Content ready for prompt preview.',
      error: null
    });

    return { summary: null, preview: effectiveSettings.showPromptPreview !== false, direct: effectiveSettings.showPromptPreview === false };
  } finally {
    currentScrape = null;
  }
}

async function handleBatchScrapeRequest(request, _sender) {
  if (scrapingState.isActive) throw new Error('Scraping already in progress.');
  const urls = normalizeBatchUrls(request.batchUrls);
  if (urls.length === 0) throw new Error('No valid Reddit URLs were provided.');

  setScrapingState({
    isActive: true,
    message: `Preparing to scrape ${urls.length} threads.`,
    percentage: 5,
    summary: null,
    error: null
  });

  const settings = await loadSettings();
  const effectiveSettings = mergeRequestFiltersIntoSettings(settings, request.filters || {}, request);
  currentScrape = {
    tabId: null,
    stopRequested: false,
    storageOption: effectiveSettings.dataStorageOption,
    abortController: null
  };

  try {
    const batchFilters = { ...(request.filters || {}), includeHidden: request.includeHidden };
    const threads = [];
    for (let i = 0; i < urls.length; i++) {
      if (currentScrape.stopRequested) throw new Error('Batch scraping stopped by user.');
      const percentage = 10 + Math.floor((i / urls.length) * 70);
      setScrapingState({ message: `Scraping thread ${i + 1}/${urls.length}...`, percentage });
      const thread = await scrapeThreadFromUrl(urls[i], effectiveSettings, batchFilters);
      threads.push(thread);
      await delay(900);
    }

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
        mediaMode: effectiveSettings.mediaMode
        ,
        outputFormat: effectiveSettings.outputFormat,
        deliveryMode: effectiveSettings.showPromptPreview === false ? 'direct' : 'preview',
        pasteStatus: effectiveSettings.showPromptPreview === false ? 'pending' : 'not_started'
      },
      timestamp: Date.now()
    };

    await savePreviewData(batchData, effectiveSettings);
    if (effectiveSettings.dataStorageOption === 'persistent') {
      await addToHistory(batchData, effectiveSettings);
    }

    if (effectiveSettings.showPromptPreview === false) {
      setScrapingState({ message: 'Opening AI tab...', percentage: 90 });
      await sendDataDirectlyToAi(batchData, effectiveSettings);
    } else {
      setScrapingState({ message: 'Opening prompt preview...', percentage: 90 });
      await openPreviewTab();
    }
    setScrapingState({
      isActive: false,
      percentage: 100,
      message: effectiveSettings.showPromptPreview === false ? 'Batch sent directly to AI.' : 'Batch ready for prompt preview.',
      error: null
    });
    return { summary: null, preview: effectiveSettings.showPromptPreview !== false, direct: effectiveSettings.showPromptPreview === false, batch: true };
  } finally {
    currentScrape = null;
  }
}

// =====================
// Preview / Paste Handoff
// =====================

async function savePreviewData(data, settings) {
  const payload = {
    data,
    settings,
    timestamp: Date.now(),
    handoffId: createId(),
    storageOption: settings.dataStorageOption,
    oneTime: settings.dataStorageOption === 'dontSave'
  };
  const area = getStorageArea(settings.dataStorageOption);
  const otherArea = getOtherStorageArea(settings.dataStorageOption);
  await setStorage(area, { [PREVIEW_STORAGE_KEY]: payload });
  if (otherArea !== area) {
    await removeStorage(otherArea, [PREVIEW_STORAGE_KEY, PASTE_STORAGE_KEY, LEGACY_THREAD_KEY]);
  }
  if (settings.dataStorageOption === 'persistent') {
    await setStorage(chrome.storage.local, { [LEGACY_THREAD_KEY]: data });
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
  const renderedData = R2AIPrompt.applyContextPreset(data, settings.contextPreset || 'balanced', settings);
  const promptText = R2AIPrompt.buildPromptText(renderedData, settings.defaultPromptTemplate, {
    ...settings,
    contextPreset: null
  });
  return sendPromptToAi({
    promptText,
    aiProvider: settings.selectedLlmProvider,
    mediaMode: settings.mediaMode,
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
  const commentMap = buildCommentMap(roots);
  const rootIds = new Set((roots || []).map(comment => comment?.id).filter(Boolean));
  let addedCount = 0;
  for (const comment of additionalComments || []) {
    if (!comment || commentMap[comment.id]) continue;
    comment.replies = Array.isArray(comment.replies) ? comment.replies : [];
    if (commentMap[comment.parentId]) {
      commentMap[comment.parentId].replies.push(comment);
    } else if (comment.parentId === threadId) {
      roots.push(comment);
      rootIds.add(comment.id);
    } else {
      roots.push(comment);
      rootIds.add(comment.id);
    }
    commentMap[comment.id] = comment;
    indexCommentTree(comment, commentMap);
    reparentRootChildren(comment, roots, rootIds, commentMap);
    addedCount += 1;
  }
  return { roots, addedCount };
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
    rawData: scrapeData,
    favorite: false,
    pinned: false
  };

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
  const mergedSettings = { ...settings, selectedLlmProvider: aiProvider || settings.selectedLlmProvider };
  await chrome.storage.sync.set({ selectedLlmProvider: mergedSettings.selectedLlmProvider });
  await savePreviewData({ ...item.rawData, timestamp: Date.now() }, { ...mergedSettings, dataStorageOption: 'sessionOnly' });
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
    showPromptPreview: true
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
    'showPromptPreview'
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

function getStorage(area, keys) {
  return new Promise(resolve => {
    if (!area) {
      resolve({});
      return;
    }
    area.get(keys, result => resolve(result || {}));
  });
}

function setStorage(area, items) {
  return new Promise(resolve => {
    if (!area) {
      resolve();
      return;
    }
    area.set(items, () => resolve());
  });
}

function removeStorage(area, keys) {
  return new Promise(resolve => {
    if (!area) {
      resolve();
      return;
    }
    area.remove(keys, () => resolve());
  });
}

// =====================
// Tab / State Helpers
// =====================

function setScrapingState(patch) {
  scrapingState = { ...scrapingState, ...patch };
  broadcastScrapingState();
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

function stopActiveScrape() {
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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs || tabs.length === 0) throw new Error('No active tab detected.');
  return tabs[0];
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

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['promptBuilder.js'] });
  } catch (error) {
    console.debug('Prompt helper injection skipped:', error.message);
  }

  await chrome.scripting.executeScript({ target: { tabId }, files: ['redditScraper.js'] });
}

async function requestScrapeFromTab(tabId, includeHidden, filters) {
  try {
    return await sendMessageToTab(tabId, { action: 'scrapeReddit', includeHidden, filters });
  } catch (error) {
    if (/Receiving end does not exist/.test(error.message)) {
      await delay(250);
      return sendMessageToTab(tabId, { action: 'scrapeReddit', includeHidden, filters });
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
    return 'http://localhost:3000/';
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
          js: ['i18n.js', 'promptBuilder.js', 'aiPaster.js'],
          runAt: 'document_idle'
        }
      ]);
      console.log(`Registered content script for: ${originPattern} with ID: ${scriptId}`);
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
      console.log(`Unregistered content script for: ${originPattern} with ID: ${scriptId}`);
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
  if (!Array.isArray(comments)) return 0;
  let total = 0;
  const stack = [...comments];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) continue;
    total += 1;
    if (Array.isArray(next.replies)) stack.push(...next.replies);
  }
  return total;
}

function buildCommentMap(roots) {
  const map = {};
  const traverse = comments => {
    for (const comment of comments || []) {
      if (comment?.id) map[comment.id] = comment;
      traverse(comment.replies || []);
    }
  };
  traverse(roots);
  return map;
}

function indexCommentTree(comment, map) {
  if (!comment?.id) return;
  map[comment.id] = comment;
  for (const reply of comment.replies || []) {
    indexCommentTree(reply, map);
  }
}

function reparentRootChildren(parent, roots, rootIds, commentMap) {
  if (!parent?.id) return;
  for (let i = roots.length - 1; i >= 0; i--) {
    const candidate = roots[i];
    if (!candidate || candidate.id === parent.id || candidate.parentId !== parent.id) continue;
    roots.splice(i, 1);
    rootIds.delete(candidate.id);
    if (!parent.replies.some(reply => reply.id === candidate.id)) {
      parent.replies.unshift(candidate);
    }
  }
  rootIds.delete(parent.id);
  indexCommentTree(parent, commentMap);
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
  const url = new URL(inputUrl);
  url.pathname = url.pathname.replace(/\/$/, '') + '.json';
  url.searchParams.set('limit', '500');
  url.searchParams.set('depth', String(Math.min(Math.max(depth, 1), 10)));
  url.searchParams.set('raw_json', '1');
  url.searchParams.set('showmore', 'true');
  url.searchParams.set('sort', sortMode || 'confidence');
  return url.toString();
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
  const roots = [];
  for (const child of children || []) {
    const node = parseBackgroundCommentNode(child, includeHidden, 0, maxDepth, moreIds);
    if (node) roots.push(node);
  }
  return roots;
}

function parseBackgroundCommentNode(child, includeHidden, depth, maxDepth, moreIds) {
  if (child.kind === 'more' && Array.isArray(child.data?.children)) {
    moreIds.push(...child.data.children);
    return null;
  }
  if (child.kind !== 't1') return null;
  const replies = [];
  const replyChildren = child.data?.replies?.data?.children;
  if (depth < maxDepth - 1 && replyChildren) {
    for (const reply of replyChildren) {
      const parsed = parseBackgroundCommentNode(reply, includeHidden, depth + 1, maxDepth, moreIds);
      if (parsed) replies.push(parsed);
    }
  }

  const comment = parseBackgroundCommentData(child.data, includeHidden, replies);
  if (!comment) return replies.length > 0 ? createOmittedParentPlaceholder(child.data, replies) : null;
  comment.replies = replies;
  return comment;
}

function parseBackgroundCommentData(data, includeHidden, replies = []) {
  const isRemoved = data?.body === '[removed]' || data?.body === '[deleted]';
  if (!includeHidden && isRemoved) return null;
  return {
    id: data.name,
    parentId: data.parent_id,
    author: data.author,
    text: data.body || '',
    score: data.score,
    controversiality: data.controversiality || 0,
    timestamp: data.created_utc ? data.created_utc * 1000 : null,
    isSubmitter: data.is_submitter || false,
    authorFlair: data.author_flair_text || null,
    distinguished: data.distinguished || null,
    awardCount: data.total_awards_received || 0,
    permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : null,
    replies
  };
}

function createOmittedParentPlaceholder(data, replies) {
  return {
    id: data.name,
    parentId: data.parent_id,
    author: '[omitted]',
    text: '[removed/deleted parent omitted]',
    score: data.score || 0,
    controversiality: data.controversiality || 0,
    timestamp: data.created_utc ? data.created_utc * 1000 : null,
    isSubmitter: false,
    authorFlair: null,
    distinguished: null,
    awardCount: data.total_awards_received || 0,
    permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : null,
    isOmittedParent: true,
    replies
  };
}

function applyBackgroundFilters(comments, filters, settings) {
  const minScore = filters.minScore || 0;
  const hideBots = Boolean(filters.hideBots);
  const authorTypes = Array.isArray(filters.authorTypes) ? filters.authorTypes : [];
  const shouldInclude = comment => {
    if (comment.isOmittedParent) return true;
    if (minScore > 0 && (comment.score || 0) < minScore) return false;
    if (hideBots && String(comment.author || '').toLowerCase().endsWith('bot')) return false;
    if (authorTypes.length > 0) {
      const matchesOp = authorTypes.includes('op') && comment.isSubmitter;
      const matchesFlaired = authorTypes.includes('flaired') && comment.authorFlair;
      if (!matchesOp && !matchesFlaired) return false;
    }
    return true;
  };
  const filterTree = nodes => (nodes || []).flatMap(node => {
    const replies = filterTree(node.replies || []);
    if (node.isOmittedParent && replies.length === 0) return [];
    if (!shouldInclude(node)) return replies;
    return [{ ...node, replies }];
  });
  let result = filterTree(comments);
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

async function syncSelectors() {
  try {
    const url = 'https://raw.githubusercontent.com/KhazP/Reddit-to-AI/main/selectors.json';
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const selectors = await response.json();
    if (selectors && typeof selectors === 'object') {
      await new Promise(resolve => {
        chrome.storage.local.set({
          syncedSelectors: selectors,
          lastSelectorSyncTime: Date.now()
        }, resolve);
      });
      console.log('Reddit to AI: Selectors synced successfully.');
    }
  } catch (error) {
    console.error('Reddit to AI: Failed to sync selectors:', error);
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

/**
 * Checks if the browser has built-in Gemini Nano / Local AI capability enabled.
 */
async function checkLocalAiCapability() {
  try {
    const aiObj = typeof self !== 'undefined' && self.ai ? self.ai : (typeof ai !== 'undefined' ? ai : null);
    if (!aiObj) return false;
    
    if (aiObj.languageModel) {
      const caps = await aiObj.languageModel.capabilities();
      return caps && caps.available !== 'no';
    }
    if (aiObj.assistant) {
      const caps = await aiObj.assistant.capabilities();
      return caps && caps.available !== 'no';
    }
  } catch (e) {
    console.error('Error checking local AI capability:', e);
  }
  return false;
}

/**
 * Generates summary using Local AI Prompt API with streaming progress callbacks.
 */
async function generateLocalSummary(promptText, onChunk) {
  const aiObj = typeof self !== 'undefined' && self.ai ? self.ai : (typeof ai !== 'undefined' ? ai : null);
  if (!aiObj) {
    throw new Error('Chrome Local AI (ai) is not supported in this environment.');
  }

  let modelApi = aiObj.languageModel;
  if (!modelApi && aiObj.assistant) {
    modelApi = aiObj.assistant;
  }

  if (!modelApi) {
    throw new Error('Chrome Local AI languageModel/assistant API is not available.');
  }

  const caps = await modelApi.capabilities();
  if (!caps || caps.available === 'no') {
    throw new Error('Chrome Local AI is not available (capabilities returned "no").');
  }

  const session = await modelApi.create();
  try {
    if (typeof session.promptStreaming === 'function') {
      const stream = session.promptStreaming(promptText);
      let fullText = '';
      for await (const chunk of stream) {
        fullText = chunk;
        if (typeof onChunk === 'function') {
          onChunk(fullText);
        }
      }
      return fullText;
    } else {
      const result = await session.prompt(promptText);
      if (typeof onChunk === 'function') {
        onChunk(result);
      }
      return result;
    }
  } finally {
    try {
      if (typeof session.destroy === 'function') {
        session.destroy();
      } else if (typeof session.close === 'function') {
        session.close();
      }
    } catch (e) {
      console.debug('Error closing AI session:', e);
    }
  }
}

if (globalThis.R2AIServiceWorkerTest) {
  Object.assign(globalThis.R2AIServiceWorkerTest, {
    applyBackgroundFilters,
    mergeAdditionalComments,
    parseBackgroundComments,
    parseBackgroundCommentNode,
    syncSelectors,
    checkAndSyncSelectors,
    checkLocalAiCapability,
    generateLocalSummary,
    getScriptIdForOrigin,
    registerCustomOriginScript,
    unregisterCustomOriginScript,
    registerAllCustomOrigins,
    getAiUrl
  });
}

