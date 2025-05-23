// Service Worker - Step 3: Adding main onMessage structure

console.log('Service Worker (Step 3): Script loaded.');

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
    console.log("Service Worker (Step 3): Broadcasting state:", scrapingState);
    chrome.runtime.sendMessage({
        action: "scrapingStateUpdate",
        data: scrapingState
    }, (response) => {
        if (chrome.runtime.lastError) {
            // console.log('Popup status update error:', chrome.runtime.lastError.message);
        }
    });
    // Floating panel part still commented
    console.log('Service Worker (Step 3): Floating panel broadcast temporarily skipped.');
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
  console.log('Service Worker (Step 3): Extension Installed.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Service Worker (Step 3): Message received:', request);

  if (request.action === 'scrapeReddit') {
    console.log('Service Worker (Step 3): scrapeReddit action received.');
    // Original complex logic will be added back incrementally.
    // For now, just set state and respond to prevent port closed errors.
    if (scrapingState.isActive) {
      console.log('Service Worker (Step 3): Scraping already in progress.');
      sendResponse({ status: 'Error: Scraping already in progress', currentState: scrapingState });
      return false; // Indicate synchronous response
    }
    scrapingState.isActive = true;
    scrapingState.message = 'Scraping initiated (Step 3 test)...';
    scrapingState.percentage = 5;
    broadcastScrapingState();
    // Simulate some activity then stop
    setTimeout(() => {
        scrapingState.isActive = false;
        scrapingState.message = 'Scraping simulation finished (Step 3 test).';
        scrapingState.percentage = 100;
        broadcastScrapingState();
        console.log('Service Worker (Step 3): Simulated scrape finished.');
    }, 2000);
    sendResponse({ status: 'Scraping initiated (Step 3 test)', currentState: scrapingState });
    return false; // Indicate synchronous response for now, as setTimeout is faking async work

  } else if (request.action === "stopScraping") {
    console.log("Service Worker (Step 3): Received stopScraping message (minimal handler).");
    stopRequested = true;
    scrapingState.isActive = false;
    scrapingState.message = 'Scraping process halting (Step 3 test).';
    broadcastScrapingState();
    sendResponse({ status: "Stop signal received (Step 3 test).", currentState: scrapingState });
    return false; // Indicate synchronous response

  } else if (request.action === "progressUpdate") {
    console.log("Service Worker (Step 3): ProgressUpdate (minimal handler):", request.message);
    scrapingState.message = request.message;
    if (request.percentage !== undefined) {
        scrapingState.percentage = request.percentage;
    }
    broadcastScrapingState();
    sendResponse({status: "progress acknowledged by service worker (Step 3)"});
    return false; // Indicate synchronous response

  } else if (request.action === 'getScrapingState') {
    sendResponse(scrapingState);
    return false; // Indicate synchronous response

  } else if (request.action === 'notifyUser') {
    console.log('Service Worker (Step 3): notifyUser (minimal handler)');
    showNotificationIfEnabled(request.title || 'Reddit AI Tool Notification', request.message || 'You have a new notification.');
    sendResponse({ status: 'Notification request processed (Step 3)' });
    return false; // Indicate synchronous response
  }

  // Default: if no specific action matched, and we didn't respond yet.
  // This helps catch unexpected messages.
  // Consider if we need 'return true' for any other specific future async actions.
  console.warn("Service Worker (Step 3): Unhandled message action:", request.action);
  // sendResponse({status: "Unknown action"}); // Optional: respond for unknown actions
  return false; // Default to synchronous for unhandled actions
});

console.log('Service Worker (Step 3): All listeners registered.');
