// Service Worker - Step 4: Adding tab query and initial checks to scrapeReddit

console.log('Service Worker (Step 4): Script loaded.');

// --- Global State Variables (from original file) ---
let scrapingState = {
    isActive: false,
    message: 'Ready to scrape.',
    percentage: 0,
    summary: null,
    error: null,
    lastScrapedTabId: null
};
let isScraping = false; // Old flag
let scrapingTabId = null; // Old flag
let stopRequested = false;

// --- Helper Functions (from original file) ---
function broadcastScrapingState() {
    console.log("Service Worker (Step 4): Broadcasting state:", scrapingState);
    chrome.runtime.sendMessage({
        action: "scrapingStateUpdate",
        data: scrapingState
    }, (response) => {
        if (chrome.runtime.lastError) {
            // console.log('Popup status update error:', chrome.runtime.lastError.message);
        }
    });
    // Floating panel part still commented
    console.log('Service Worker (Step 4): Floating panel broadcast temporarily skipped.');
}

function showNotificationIfEnabled(title, message, notificationIdBase = 'redditAI') {
  chrome.storage.sync.get(['showNotifications'], (result) => {
    const shouldShow = typeof result.showNotifications === 'boolean' ? result.showNotifications : true;
    if (shouldShow) {
      const notificationId = `${notificationIdBase}-${Date.now()}`;
      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'images/icon128.png',
        title: title,
        message: message
      }, (createdId) => {
        if (chrome.runtime.lastError) {
          console.warn('Error creating notification:', chrome.runtime.lastError.message, 'ID:', notificationId);
        }
      });
    }
  });
}

// --- Event Listeners ---
chrome.runtime.onInstalled.addListener(() => {
  console.log('Service Worker (Step 4): Extension Installed.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Service Worker (Step 4): Message received:', request);

  if (request.action === 'scrapeReddit') {
    console.log('Service Worker (Step 4): scrapeReddit action received.');
    
    if (scrapingState.isActive) {
      console.log('Service Worker (Step 4): Scraping already in progress.');
      sendResponse({ status: 'Error: Scraping already in progress', currentState: scrapingState });
      return false; 
    }
    
    scrapingState.isActive = true;
    scrapingState.message = 'Querying active tab...';
    scrapingState.percentage = 5;
    scrapingState.summary = null;
    scrapingState.error = null;
    broadcastScrapingState();

    // 1. Get current active tab (reintroducing this part)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.error('Service Worker (Step 4): Error querying tabs:', chrome.runtime.lastError.message);
        scrapingState.isActive = false;
        scrapingState.message = 'Error: Could not query tabs.';
        scrapingState.error = 'Error querying tabs: ' + chrome.runtime.lastError.message;
        broadcastScrapingState();
        // No sendResponse here as it's async and might have already been sent or port closed
        // For robust error handling here, we might need to change how sendResponse is called.
        // For now, let's assume this error is less likely for a syntax check.
        return; 
      }

      if (stopRequested) {
        console.log("Service Worker (Step 4): Stop requested before tab query completed.");
        scrapingState.isActive = false;
        scrapingState.message = 'Scraping stopped by user.';
        broadcastScrapingState();
        // sendResponse({ status: 'Scraping stopped', currentState: scrapingState }); // Problematic here
        return;
      }

      if (tabs.length === 0) {
        console.error('Service Worker (Step 4): No active tab found.');
        scrapingState.isActive = false;
        scrapingState.message = 'Error: No active tab found.';
        scrapingState.error = 'No active tab found.';
        broadcastScrapingState();
        // sendResponse({ status: 'Error: No active tab', currentState: scrapingState }); // Problematic here
        return;
      }
      
      const activeTab = tabs[0];
      scrapingState.lastScrapedTabId = activeTab.id;

      scrapingState.message = 'Checking if active tab is Reddit...';
      scrapingState.percentage = 10;
      broadcastScrapingState();

      if (!activeTab.url || !activeTab.url.includes('reddit.com')) {
        console.error('Service Worker (Step 4): Active tab is not a Reddit page.');
        scrapingState.isActive = false;
        scrapingState.message = 'Error: Active tab is not a Reddit page.';
        scrapingState.error = 'Active tab is not a Reddit page.';
        broadcastScrapingState();
        // sendResponse({ status: 'Error: Not a Reddit page', currentState: scrapingState }); // Problematic here
        return;
      }

      // If all checks pass so far:
      console.log('Service Worker (Step 4): Tab is a Reddit page. Path for script injection would follow here.');
      scrapingState.message = 'Tab identified. Ready for next step (not implemented in Step 4).';
      scrapingState.percentage = 15;
      // For now, simulate completion as we're not injecting scripts yet
      scrapingState.isActive = false; 
      broadcastScrapingState();
      // sendResponse({ status: 'Tab identified (Step 4 test)', currentState: scrapingState }); // Problematic here
    });

    // IMPORTANT: Because chrome.tabs.query is asynchronous, sendResponse needs to be handled carefully.
    // If we call it outside the callback, it might be too early.
    // If we call it inside, we need to ensure it's called on all paths or return true from the main listener.
    // For this incremental step, we will rely on returning true from the main listener and
    // ensure sendResponse is called within the async callback or not at all if error occurs early.
    // However, the original code returned true from the main listener ONLY if action was scrapeReddit.
    // Let's simplify: we will send an initial response and then let updates flow.
    // The `return true` from the main listener is now crucial.
    
    // The original `sendResponse` was inside the final callback of the entire chain.
    // For this step, we are not going that far.
    // Let's send an early "processing" response.
    // sendResponse({ status: 'Processing scrape request (Step 4)...', currentState: scrapingState });
    // No, this is also tricky. The original code only sent response at the very end OR on early errors.

    // For testing syntax, the most important part is whether this structure *parses*.
    // The runtime behavior of sendResponse is secondary for *this specific diagnostic step*.
    // The original code returned `true` from the main listener for `scrapeReddit`.
    // Let's stick to that.
    return true; 

  } else if (request.action === "stopScraping") {
    // ... (same as Step 3) ...
    console.log("Service Worker (Step 4): Received stopScraping message (minimal handler).");
    stopRequested = true;
    scrapingState.isActive = false;
    scrapingState.message = 'Scraping process halting (Step 4 test).';
    broadcastScrapingState();
    sendResponse({ status: "Stop signal received (Step 4 test).", currentState: scrapingState });
    return false;

  } else if (request.action === "progressUpdate") {
    // ... (same as Step 3) ...
    console.log("Service Worker (Step 4): ProgressUpdate (minimal handler):", request.message);
    scrapingState.message = request.message;
    if (request.percentage !== undefined) {
        scrapingState.percentage = request.percentage;
    }
    broadcastScrapingState();
    sendResponse({status: "progress acknowledged by service worker (Step 4)"});
    return false;

  } else if (request.action === 'getScrapingState') {
    // ... (same as Step 3) ...
    sendResponse(scrapingState);
    return false; 

  } else if (request.action === 'notifyUser') {
    // ... (same as Step 3) ...
    console.log('Service Worker (Step 4): notifyUser (minimal handler)');
    showNotificationIfEnabled(request.title || 'Reddit AI Tool Notification', request.message || 'You have a new notification.');
    sendResponse({ status: 'Notification request processed (Step 4)' });
    return false;
  }

  console.warn("Service Worker (Step 4): Unhandled message action:", request.action);
  return false; 
});

console.log('Service Worker (Step 4): All listeners registered.');
