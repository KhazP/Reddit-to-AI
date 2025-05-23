// Minimal service_worker.js for testing - Step 2: Adding globals and helpers

console.log('Service Worker (Step 2): Script loaded.');

// --- Global State Variables (from original file) ---
let scrapingState = {
    isActive: false,
    message: 'Ready to scrape.',
    percentage: 0,
    summary: null,
    error: null,
    lastScrapedTabId: null
};
let isScraping = false; // Old flag - to be phased out or synced
let scrapingTabId = null; // Old flag
let stopRequested = false;

// --- Helper Functions (from original file) ---

function broadcastScrapingState() {
    console.log("Service Worker (Step 2): Broadcasting state:", scrapingState);

    // Update Popup
    chrome.runtime.sendMessage({
        action: "scrapingStateUpdate",
        data: scrapingState
    }, (response) => {
        if (chrome.runtime.lastError) {
            // console.log('Popup status update error (normal if popup is closed):', chrome.runtime.lastError.message);
        }
    });

    // Update Floating Panel (Temporarily simplified/commented to avoid errors)
    // if (scrapingState.lastScrapedTabId) {
    //     chrome.tabs.sendMessage(scrapingState.lastScrapedTabId, {
    //         action: "updateFloatingPanel",
    //         data: scrapingState
    //     }, (response) => {
    //         if (chrome.runtime.lastError) {
    //             // console.warn('Floating panel update error:', chrome.runtime.lastError.message);
    //         }
    //     });
    // }
    console.log('Service Worker (Step 2): Floating panel broadcast temporarily skipped.');
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

// --- Minimal Event Listeners (from previous step) ---
chrome.runtime.onInstalled.addListener(() => {
  console.log('Service Worker (Step 2): Extension Installed.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Service Worker (Step 2): Message received:', request);
  if (request.action === 'ping') {
    sendResponse({ status: 'pong' });
  } else if (request.action === 'getScrapingState') { // Add basic handler for this common request
    sendResponse(scrapingState); // Send back the current state
  }
  // Return true if you intend to send a response asynchronously.
  // Only return true if action === 'ping' or action === 'getScrapingState' for now.
  return request.action === 'ping' || request.action === 'getScrapingState';
});

console.log('Service Worker (Step 2): Globals, helpers, and listeners registered.');
