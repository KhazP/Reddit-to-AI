// Service Worker - Step 5: Adding script injection to scrapeReddit

console.log('Service Worker (Step 5): Script loaded.');

// --- Global State Variables ---
let scrapingState = {
    isActive: false,
    message: 'Ready to scrape.',
    percentage: 0,
    summary: null,
    error: null,
    lastScrapedTabId: null
};
let isScraping = false;
let scrapingTabId = null;
let stopRequested = false;

// --- Helper Functions ---
function broadcastScrapingState() {
    console.log("Service Worker (Step 5): Broadcasting state:", scrapingState);
    chrome.runtime.sendMessage({
        action: "scrapingStateUpdate",
        data: scrapingState
    }, (response) => {
        if (chrome.runtime.lastError) {
            // console.log('Popup status update error:', chrome.runtime.lastError.message);
        }
    });
    // Floating panel part still commented for now, but we're getting closer
    if (scrapingState.lastScrapedTabId) {
        // Temporarily log instead of sending
        // console.log("Service Worker (Step 5): Would attempt to update floating panel if uncommented for tab:", scrapingState.lastScrapedTabId);
    }
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
  console.log('Service Worker (Step 5): Extension Installed.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Service Worker (Step 5): Message received:', request);

  if (request.action === 'scrapeReddit') {
    console.log('Service Worker (Step 5): scrapeReddit action received.');
    
    if (scrapingState.isActive) {
      console.log('Service Worker (Step 5): Scraping already in progress.');
      sendResponse({ status: 'Error: Scraping already in progress', currentState: scrapingState });
      return false; 
    }
    
    scrapingState.isActive = true;
    scrapingState.message = 'Querying active tab...';
    scrapingState.percentage = 5;
    scrapingState.summary = null;
    scrapingState.error = null;
    broadcastScrapingState();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.error('Service Worker (Step 5): Error querying tabs:', chrome.runtime.lastError.message);
        // Simplified error handling for this step
        scrapingState.isActive = false;
        scrapingState.message = 'Error querying tabs.';
        broadcastScrapingState();
        return; 
      }
      if (tabs.length === 0) {
        scrapingState.isActive = false;
        scrapingState.message = 'Error: No active tab found.';
        broadcastScrapingState();
        return;
      }
      
      const activeTab = tabs[0];
      scrapingState.lastScrapedTabId = activeTab.id;

      if (!activeTab.url || !activeTab.url.includes('reddit.com')) {
        scrapingState.isActive = false;
        scrapingState.message = 'Error: Active tab is not a Reddit page.';
        broadcastScrapingState();
        return;
      }

      console.log('Service Worker (Step 5): Tab is a Reddit page. Proceeding with script injections.');
      scrapingState.message = 'Injecting scripts...';
      scrapingState.percentage = 15;
      broadcastScrapingState();

      // Reintroducing script injection using an IIFE async function
      (async () => {
          try {
              console.log("Service Worker (Step 5): Attempting to inject floatingPanel.css");
              await chrome.scripting.insertCSS({
                  target: { tabId: activeTab.id },
                  files: ['floatingPanel.css']
              });
              console.log("Service Worker (Step 5): floatingPanel.css injected.");

              console.log("Service Worker (Step 5): Attempting to execute floatingPanel.js");
              await chrome.scripting.executeScript({
                  target: { tabId: activeTab.id },
                  files: ['floatingPanel.js']
              });
              console.log("Service Worker (Step 5): floatingPanel.js executed.");
              
              // Now update state and proceed with scraper injection
              scrapingState.message = 'Injecting main scraper...';
              scrapingState.percentage = 20; // Adjusted percentage
              broadcastScrapingState();

              console.log("Service Worker (Step 5): Attempting to execute redditScraper.js");
              const injectionResults = await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                files: ['redditScraper.js']
              });
              console.log("Service Worker (Step 5): redditScraper.js executed.", injectionResults);

              // For this step, we stop here. We don't send a message to the content script yet.
              // Simulate completion after injection.
              scrapingState.message = 'Scripts injected (Step 5). Further interaction pending.';
              scrapingState.percentage = 25;
              scrapingState.isActive = false; // Simulate end of process for this step
              broadcastScrapingState();

          } catch (err) {
              console.error("Service Worker (Step 5): Error during script injection:", err);
              scrapingState.isActive = false;
              scrapingState.message = 'Error during script injection: ' + err.message;
              scrapingState.error = err.message;
              scrapingState.percentage = -1; // Indicate error
              broadcastScrapingState();
          }
      })(); // End of IIFE for script injection

    }); // End of chrome.tabs.query callback

    return true; // Indicate async response for scrapeReddit

  } else if (request.action === "stopScraping") {
    console.log("Service Worker (Step 5): Received stopScraping.");
    stopRequested = true;
    scrapingState.isActive = false;
    scrapingState.message = 'Scraping stopped by user.';
    broadcastScrapingState();
    sendResponse({ status: "Stop signal received.", currentState: scrapingState });
    return false; 
  } else if (request.action === "progressUpdate") {
    scrapingState.message = request.message;
    if (request.percentage !== undefined) scrapingState.percentage = request.percentage;
    broadcastScrapingState();
    sendResponse({status: "progress acknowledged"});
    return false; 
  } else if (request.action === 'getScrapingState') {
    sendResponse(scrapingState);
    return false; 
  } else if (request.action === 'notifyUser') {
    showNotificationIfEnabled(request.title, request.message);
    sendResponse({ status: 'Notification request processed' });
    return false;
  }

  console.warn("Service Worker (Step 5): Unhandled message action:", request.action);
  return false; 
});

console.log('Service Worker (Step 5): All listeners registered.');
