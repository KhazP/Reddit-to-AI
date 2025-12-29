const DEFAULT_PROMPT_TEMPLATE = 'Summarize the following Reddit thread:\n\n{content}';

const DEFAULT_STATE = {
  isActive: false,
  message: 'Ready to scrape.',
  percentage: 0,
  summary: null,
  error: null,
  lastScrapedTabId: null
};

const DEFAULT_HISTORY_LIMIT = 10;

let scrapingState = { ...DEFAULT_STATE };
let currentScrape = null;

console.log('Service worker initialised.');

chrome.runtime.onInstalled.addListener(() => {
  console.log('Reddit to AI installed.');
});

// =====================
// History Management
// =====================

async function getHistoryLimit() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['historyLimit'], result => {
      resolve(result.historyLimit || DEFAULT_HISTORY_LIMIT);
    });
  });
}

async function getHistory() {
  return new Promise(resolve => {
    chrome.storage.local.get(['scrapeHistory'], result => {
      resolve(result.scrapeHistory || []);
    });
  });
}

async function addToHistory(scrapeData) {
  const history = await getHistory();
  const limit = await getHistoryLimit();

  // Create history entry with unique ID
  const historyEntry = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    post: scrapeData.post,
    metadata: scrapeData.metadata,
    comments: scrapeData.comments,
    rawData: scrapeData
  };

  // Add to beginning (most recent first)
  history.unshift(historyEntry);

  // Trim to limit
  const trimmedHistory = history.slice(0, limit);

  await new Promise(resolve => {
    chrome.storage.local.set({ scrapeHistory: trimmedHistory }, resolve);
  });

  console.log(`History: Added entry, now ${trimmedHistory.length} items`);
  return historyEntry;
}

async function deleteFromHistory(historyId) {
  const history = await getHistory();
  const filtered = history.filter(item => item.id !== historyId);

  await new Promise(resolve => {
    chrome.storage.local.set({ scrapeHistory: filtered }, resolve);
  });

  console.log(`History: Deleted ${historyId}, now ${filtered.length} items`);
  return filtered;
}

async function clearHistory() {
  await new Promise(resolve => {
    chrome.storage.local.set({ scrapeHistory: [] }, resolve);
  });
  console.log('History: Cleared all');
}

async function getHistoryItem(historyId) {
  const history = await getHistory();
  return history.find(item => item.id === historyId) || null;
}

async function resendHistoryItem(historyId, aiProvider) {
  const item = await getHistoryItem(historyId);
  if (!item) {
    throw new Error('History item not found');
  }

  // Store the data for aiPaster to pick up
  await chrome.storage.local.set({
    redditThreadData: {
      ...item.rawData,
      timestamp: Date.now()  // Update timestamp for fresh paste
    }
  });

  // Open AI tab
  const aiUrl = getAiUrl(aiProvider);
  await chrome.tabs.create({ url: aiUrl });

  return { success: true };
}

// =====================
// Message Handlers
// =====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'scrapeReddit': {
      handleScrapeRequest(request, sender)
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
      if (request.message) {
        setScrapingState({ message: request.message });
      }
      if (typeof request.percentage === 'number') {
        setScrapingState({ percentage: request.percentage });
      }
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
      // Fetch image from URL and return as base64 (to bypass CORS for content scripts)
      fetchImageAsBase64(request.url)
        .then(result => sendResponse(result))
        .catch(error => {
          console.error('Image fetch failed:', error);
          sendResponse({ error: error.message });
        });
      return true; // async response
    }
    // History management handlers
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
    default:
      console.warn('Unhandled runtime message:', request);
      sendResponse({ status: 'ignored' });
      return false;
  }
});

async function handleScrapeRequest(request, sender) {
  if (scrapingState.isActive) {
    throw new Error('Scraping already in progress.');
  }

  setScrapingState({
    isActive: true,
    message: 'Preparing to scrape.',
    percentage: 5,
    summary: null,
    error: null
  });

  const activeTab = await getScrapeTargetTab(request, sender);
  const tabUrl = await resolveTabUrl(activeTab);
  if (!isRedditUrl(tabUrl)) {
    console.warn('Scrape aborted: tab URL not recognised as Reddit.', {
      resolvedUrl: tabUrl,
      originalTabUrl: activeTab?.url,
      requestTabId: request?.tabId ?? null,
      senderHasTab: Boolean(sender?.tab?.id)
    });
    setScrapingState({
      isActive: false,
      message: 'Open a Reddit thread before scraping.',
      percentage: -1,
      error: 'Active tab is not a Reddit thread.'
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

  await injectContentScripts(activeTab.id);

  setScrapingState({ message: 'Collecting data from page.', percentage: 20 });

  const scrapeResponse = await requestScrapeFromTab(activeTab.id, request.includeHidden);
  if (scrapeResponse && scrapeResponse.error) {
    throw new Error(`Content script error: ${scrapeResponse.error}`);
  }

  if (!scrapeResponse || !scrapeResponse.data) {
    throw new Error('Content script returned no data.');
  }

  if (currentScrape.stopRequested) {
    throw new Error('Scraping stopped by user.');
  }

  setScrapingState({ message: 'Preparing scraped data.', percentage: 60 });

  let settings = null;
  let storageOption = currentScrape.storageOption || 'persistent';

  try {
    settings = await loadSettings();
    storageOption = settings.dataStorageOption;
    currentScrape.storageOption = storageOption;

    // Get the tab URL for enrichment
    const activeTab = await getTabById(currentScrape.tabId);
    const tabUrl = getTabUrl(activeTab);

    // Process and enrich the scraped data
    const processedData = enrichScrapedData(scrapeResponse.data, tabUrl);
    processedData.timestamp = Date.now();

    // Save data to local storage for aiPaster.js to pick up.
    // We do this regardless of the user's "persistence" setting because we need to pass data to the new tab.
    // The persistence setting ("dontSave") will be respected by not keeping it long-term 
    // (though in this architecture, we overwrite it every time anyway).
    console.log('Saving scraped data to storage:', {
      postTitle: processedData.post?.title,
      commentCount: processedData.metadata?.commentCount,
      timestamp: processedData.timestamp
    });
    await chrome.storage.local.set({
      redditThreadData: processedData
    });
    console.log('Scraped data saved to chrome.storage.local successfully.');

    // Add to history if storage is not explicitly disabled
    if (storageOption !== 'dontSave') {
      await addToHistory(processedData);
    }


    // API key check removed for Direct Paste workflow


    // --- NEW FLOW: Direct Paste ---

    // We no longer require an API key validation here.
    // Instead of summarizing internally, we open the target AI tab.

    setScrapingState({ message: 'Opening AI assistant...', percentage: 80 });

    const aiUrl = getAiUrl(settings.selectedLlmProvider); // We reuse this field or use a new one "selectedAiModel"

    await openAiTabAndPaste(aiUrl);

    setScrapingState({
      isActive: false,
      percentage: 100,
      summary: null, // No summary generated internally
      message: 'Content sent to AI tab.',
      error: null
    });

    return { summary: null };

  } finally {
    // Only clear if "dontSave" was explicitly requested, otherwise we need it for the paste script!
    if (storageOption === 'dontSave') {
      await cleanupPersistedData(storageOption);
    }
    currentScrape = null;
  }
}

function getAiUrl(providerKey) {
  // Map the new simplified selection to URLs
  // Using simple defaults for now. 
  // In options.js, we will populate 'selectedLlmProvider' with these keys.
  const map = {
    'gemini': 'https://gemini.google.com/app',
    'chatgpt': 'https://chatgpt.com/',
    'claude': 'https://claude.ai/new',
    'aistudio': 'https://aistudio.google.com/prompts/new_chat'
  };
  return map[providerKey] || map['gemini'];
}


async function openAiTabAndPaste(url) {
  await chrome.tabs.create({ url });
  // aiPaster.js is now injected via manifest.json content_scripts to ensure it runs reliably
  // when the page loads, even if it takes a while to be ready.
}

function stopActiveScrape() {
  if (!currentScrape) {
    return;
  }

  currentScrape.stopRequested = true;

  setScrapingState({ message: 'Stop requested.', percentage: scrapingState.percentage });

  if (currentScrape.abortController) {
    currentScrape.abortController.abort();
  }

  if (typeof currentScrape.tabId === 'number') {
    chrome.tabs.sendMessage(
      currentScrape.tabId,
      { action: 'stopScrapingRequested' },
      () => chrome.runtime.lastError && console.debug('Stop message warning:', chrome.runtime.lastError.message)
    );
  }
}

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

function showNotificationIfEnabled(title, message, notificationIdBase = 'reddit-to-ai') {
  chrome.storage.sync.get(['showNotifications'], result => {
    const shouldShow = typeof result.showNotifications === 'boolean' ? result.showNotifications : true;
    if (!shouldShow) {
      return;
    }

    const notificationId = `${notificationIdBase}-${Date.now()}`;
    chrome.notifications.create(
      notificationId,
      {
        type: 'basic',
        iconUrl: 'images/icon128.png',
        title,
        message
      },
      () => chrome.runtime.lastError && console.debug('Notification skipped:', chrome.runtime.lastError.message)
    );
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs || tabs.length === 0) {
    throw new Error('No active tab detected.');
  }
  return tabs[0];
}

async function getScrapeTargetTab(request, sender) {
  if (request?.tabId != null) {
    try {
      const tabFromRequest = await getTabById(request.tabId);
      if (tabFromRequest) {
        return tabFromRequest;
      }
    } catch (error) {
      console.debug('Failed to resolve tab from request.tabId:', error);
    }
  }

  if (sender?.tab && sender.tab.id != null) {
    return sender.tab;
  }

  return getActiveTab();
}

function getTabUrl(tab) {
  if (!tab) {
    return '';
  }
  return tab.url || tab.pendingUrl || '';
}

async function resolveTabUrl(tab) {
  let candidate = getTabUrl(tab);
  if (isRedditUrl(candidate) || !tab?.id) {
    return candidate;
  }

  // Give Chrome a moment to finish navigation if we're still on about:blank or similar.
  for (let attempt = 0; attempt < 5; attempt++) {
    await delay(150 + attempt * 100);
    try {
      const refreshedTab = await getTabById(tab.id);
      candidate = getTabUrl(refreshedTab);
      if (isRedditUrl(candidate)) {
        return candidate;
      }
    } catch (error) {
      console.debug('Failed to refresh tab URL:', error);
      break;
    }
  }

  if (!isRedditUrl(candidate)) {
    console.debug('resolveTabUrl: returning non-Reddit URL candidate', candidate || '[empty]');
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

function isRedditUrl(url) {
  if (!url) {
    return false;
  }
  try {
    const { hostname } = new URL(url);
    // Allow reddit.com, www.reddit.com, old.reddit.com, sh.reddit.com, etc.
    // Also redd.it shortlinks
    return (
      hostname === 'reddit.com' ||
      hostname.endsWith('.reddit.com') ||
      hostname === 'redd.it' ||
      hostname.endsWith('.redd.it')
    );
  } catch (error) {
    console.warn('Failed to parse tab URL:', url, error);
    return false;
  }
}

async function injectContentScripts(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['floatingPanel.css'] });
  } catch (error) {
    console.debug('Floating panel CSS injection skipped:', error.message);
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['floatingPanel.js'] });
  } catch (error) {
    console.debug('Floating panel script injection skipped:', error.message);
  }

  await chrome.scripting.executeScript({ target: { tabId }, files: ['redditScraper.js'] });
}

async function requestScrapeFromTab(tabId, includeHidden) {
  const attempt = () =>
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        { action: 'scrapeReddit', includeHidden },
        response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        }
      );
    });

  try {
    return await attempt();
  } catch (error) {
    if (/Receiving end does not exist/.test(error.message)) {
      await delay(250);
      return attempt();
    }
    throw error;
  }
}

async function loadSettings() {
  const defaults = {
    defaultPromptTemplate: DEFAULT_PROMPT_TEMPLATE,
    dataStorageOption: 'persistent',
    selectedLlmProvider: 'openai',
    apiKey: '',
    modelName: ''
  };

  return new Promise(resolve => {
    chrome.storage.sync.get(
      ['defaultPromptTemplate', 'dataStorageOption', 'selectedLlmProvider', 'apiKey', 'modelName'],
      items => resolve({ ...defaults, ...items })
    );
  });
}

function enrichScrapedData(data, url) {
  const timestamp = new Date().toISOString();
  return {
    ...data,
    post: {
      title: data.post?.title || '[Unknown title]',
      author: data.post?.author || '[Unknown author]',
      subreddit: data.post?.subreddit || inferSubredditFromUrl(url),
      url: url || data.post?.url || '',
      content: data.post?.content || '',
      images: data.post?.images || [],
      links: data.post?.links || []
    },
    metadata: {
      scrapedAt: timestamp,
      commentCount: countComments(data.comments),
      includeHidden: Boolean(data.includeHidden),
      loadMoreAttempts: data.loadMoreAttempts || 0
    }
  };
}

async function persistScrapedData(option, payload) {
  if (option === 'dontSave') {
    return;
  }
  const setter =
    option === 'sessionOnly'
      ? chrome.storage.session.set.bind(chrome.storage.session)
      : chrome.storage.local.set.bind(chrome.storage.local);

  await new Promise(resolve => {
    setter({ redditThreadData: payload }, () => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to persist scraped data:', chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}

async function cleanupPersistedData(option) {
  if (option === 'dontSave') {
    return;
  }
  const remover =
    option === 'sessionOnly'
      ? chrome.storage.session.remove.bind(chrome.storage.session)
      : chrome.storage.local.remove.bind(chrome.storage.local);

  await new Promise(resolve => {
    remover('redditThreadData', () => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to remove stored scrape data:', chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}

function buildPromptText(data, template) {
  const promptTemplate = template && template.includes('{content}') ? template : DEFAULT_PROMPT_TEMPLATE;
  const sections = [];

  sections.push(`Thread Title: ${data.post.title}`);
  sections.push(`Subreddit: ${data.post.subreddit}`);
  sections.push(`Author: ${data.post.author}`);
  if (data.post.url) {
    sections.push(`URL: ${data.post.url}`);
  }
  sections.push('');
  sections.push('Post Content:');
  sections.push(data.post.content ? truncateText(data.post.content, 2000) : '[No body content detected]');

  if (Array.isArray(data.post.images) && data.post.images.length > 0) {
    sections.push('');
    sections.push('Images:');
    data.post.images.slice(0, 5).forEach((src, index) => {
      sections.push(`  ${index + 1}. ${src}`);
    });
  }

  if (Array.isArray(data.post.links) && data.post.links.length > 0) {
    sections.push('');
    sections.push('Links referenced in post:');
    data.post.links.slice(0, 10).forEach(link => sections.push(`  - ${link}`));
  }

  const commentBlock = formatCommentsForPrompt(data.comments);
  if (commentBlock) {
    sections.push('');
    sections.push('Representative comments:');
    sections.push(commentBlock);
  }

  sections.push('');
  sections.push(`Scraped at: ${data.metadata.scrapedAt}`);
  sections.push(`Comments analysed: ${data.metadata.commentCount}`);

  const content = sections.join('\n');
  return promptTemplate.replace('{content}', content);
}

// LLM API functions removed in favor of direct paste.

function formatCommentsForPrompt(comments) {
  if (!Array.isArray(comments) || comments.length === 0) {
    return '';
  }

  const queue = comments.map(comment => ({ comment, depth: 0 }));
  const lines = [];
  let totalChars = 0;
  let processed = 0;
  const maxItems = 50;
  const maxChars = 8000;

  while (queue.length > 0 && processed < maxItems && totalChars < maxChars) {
    const { comment, depth } = queue.shift();
    if (!comment || typeof comment.text !== 'string' || !comment.text.trim()) {
      continue;
    }

    const author = comment.author || 'unknown';
    const score = comment.score != null ? ` (${comment.score})` : '';
    const indent = '  '.repeat(Math.min(depth, 4));
    const body = truncateText(comment.text.replace(/\s+/g, ' ').trim(), 200);
    const line = `${indent}- ${author}${score}: ${body}`;
    lines.push(line);
    totalChars += line.length;
    processed += 1;

    if (Array.isArray(comment.replies) && comment.replies.length > 0) {
      comment.replies.forEach(reply => queue.push({ comment: reply, depth: depth + 1 }));
    }
  }

  return lines.join('\n');
}

function countComments(comments) {
  if (!Array.isArray(comments)) {
    return 0;
  }
  let total = 0;
  const stack = [...comments];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) {
      continue;
    }
    total += 1;
    if (Array.isArray(next.replies) && next.replies.length > 0) {
      stack.push(...next.replies);
    }
  }
  return total;
}

function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function inferSubredditFromUrl(url) {
  if (!url) {
    return '[Unknown subreddit]';
  }
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/\/r\/([^/]+)/i);
    return match ? match[1] : '[Unknown subreddit]';
  } catch {
    return '[Unknown subreddit]';
  }
}

async function safeReadErrorBody(response) {
  try {
    const text = await response.text();
    if (!text) {
      return 'no additional details';
    }
    try {
      const json = JSON.parse(text);
      if (json.error?.message) {
        return json.error.message;
      }
      return text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return 'unable to read error body';
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchImageAsBase64(url) {
  if (!url) {
    throw new Error('No URL provided');
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const blob = await response.blob();
  const mimeType = blob.type || 'image/jpeg';

  // Convert blob to base64
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  return {
    base64,
    mimeType,
    size: blob.size
  };
}
