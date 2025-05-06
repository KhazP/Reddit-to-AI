// Placeholder for service_worker.js
// This script will manage the extension's background tasks.

let isScraping = false; // Flag to prevent concurrent scraping

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeReddit') {
    if (isScraping) {
      console.log('Service Worker: Scraping already in progress. Ignoring new request.');
      sendResponse({ status: 'Error: Scraping already in progress' });
      return false; // No asynchronous response needed
    }
    isScraping = true;
    console.log('Service Worker: Received scrapeReddit message from popup. Starting scrape.');
    console.log('Service Worker: Include hidden comments:', request.includeHidden);

    // Wrap the core logic in a try...finally to ensure isScraping is reset
    try {
      // 1. Get current active tab (should be a Reddit tab)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          console.error('Service Worker: No active tab found.');
          sendResponse({ status: 'Error: No active tab' });
          isScraping = false;
          return;
        }
        const activeTab = tabs[0];

        if (!activeTab.url || !activeTab.url.includes('reddit.com')) {
          console.error('Service Worker: Active tab is not a Reddit page.');
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'images/icon48.png',
            title: 'Reddit AI Tool Error',
            message: 'Please navigate to a Reddit thread page to use this extension.'
          });
          sendResponse({ status: 'Error: Not a Reddit page' });
          isScraping = false;
          return;
        }

        console.log('Service Worker: Active tab is:', activeTab.url);

        // 2. Inject redditScraper.js into the active Reddit tab
        chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['redditScraper.js']
        }, (injectionResults) => {
          if (chrome.runtime.lastError || !injectionResults || injectionResults.length === 0) {
            console.error('Service Worker: Failed to inject redditScraper.js', chrome.runtime.lastError?.message);
            sendResponse({ status: 'Error: Failed to inject scraper' });
            isScraping = false;
            return;
          }
          console.log('Service Worker: redditScraper.js injected. Now sending scrape command.');
          // 3. Send a message to the injected script to start scraping, passing options
          chrome.tabs.sendMessage(activeTab.id, {
            action: 'scrapeReddit', // Ensured action is 'scrapeReddit'
            includeHidden: request.includeHidden
          }, (scrapeResponse) => {
            if (chrome.runtime.lastError) {
              console.error('Service Worker: Error receiving data from redditScraper:', chrome.runtime.lastError.message);
              sendResponse({ status: 'Error: Scraping failed' });
              isScraping = false;
              return;
            }
            if (scrapeResponse && scrapeResponse.data) {
              console.log('Service Worker: Received scraped data from redditScraper.js');
              // 4. Store data in chrome.storage.local
              chrome.storage.local.set({ redditThreadData: scrapeResponse.data }, () => {
                if (chrome.runtime.lastError) {
                  console.error('Service Worker: Error saving data to storage:', chrome.runtime.lastError.message);
                  sendResponse({ status: 'Error: Failed to save data' });
                  isScraping = false;
                  return;
                }
                console.log('Service Worker: Scraped data stored in chrome.storage.local.');
                // 5. Open Gemini in a new tab
                chrome.tabs.create({ url: 'https://gemini.google.com/app', active: true }, (geminiTab) => {
                  if (chrome.runtime.lastError || !geminiTab) {
                    console.error('Service Worker: Failed to open Gemini tab.', chrome.runtime.lastError?.message);
                    sendResponse({ status: 'Error: Failed to open Gemini tab' });
                    isScraping = false;
                    return;
                  }
                  console.log('Service Worker: Gemini tab opened with ID:', geminiTab.id);
                  // 6. Listen for Gemini tab to complete loading then inject geminiPaster.js
                  const listener = (tabId, changeInfo, tab) => {
                    if (tabId === geminiTab.id && changeInfo.status === 'complete') {
                      console.log('Service Worker: Gemini tab loaded. Injecting geminiPaster.js.');
                      chrome.scripting.executeScript({
                        target: { tabId: geminiTab.id },
                        files: ['geminiPaster.js']
                      }, (pasteInjectionResults) => {
                        try { // Inner try for paste logic
                          if (chrome.runtime.lastError || !pasteInjectionResults || pasteInjectionResults.length === 0) {
                            console.error('Service Worker: Failed to inject geminiPaster.js', chrome.runtime.lastError?.message);
                            chrome.notifications.create({
                              type: 'basic',
                              iconUrl: 'images/icon48.png',
                              title: 'Reddit AI Tool',
                              message: 'Could not paste into Gemini. The site might have updated. Data is in storage.'
                            });
                          } else {
                            console.log('Service Worker: geminiPaster.js injected. It should now attempt to paste.');
                            chrome.tabs.sendMessage(geminiTab.id, { action: 'executePaste' }, (pasteResponse) => {
                              try { // Inner try for paste response
                                if (chrome.runtime.lastError) {
                                  console.error('Service Worker: Error during paste execution or no response:', chrome.runtime.lastError.message);
                                } else if (pasteResponse && pasteResponse.status) {
                                  console.log('Service Worker: Paste script responded:', pasteResponse.status);
                                }
                              } finally { // Ensure storage cleanup and scraping flag reset after paste attempt
                                chrome.storage.local.remove('redditThreadData', () => {
                                  console.log('Service Worker: redditThreadData removed from storage.');
                                });
                                isScraping = false; 
                                console.log('Service Worker: Scraping process complete. isScraping set to false.');
                              }
                            });
                          }
                        } finally { // Ensure listener cleanup and potentially reset scraping flag if paste sendMessage not reached
                          chrome.tabs.onUpdated.removeListener(listener);
                          // If the sendMessage to geminiPaster was not called (e.g. injection failed), reset isScraping here
                          if (!(pasteInjectionResults && pasteInjectionResults.length > 0)) {
                             isScraping = false;
                             console.log('Service Worker: Scraping process ended (geminiPaster injection failed). isScraping set to false.');
                          }
                        }
                      });
                    }
                  };
                  chrome.tabs.onUpdated.addListener(listener);
                  sendResponse({ status: 'Scraping initiated, Gemini tab opened.' });
                  // Note: isScraping is reset inside the paste logic or its error handlers
                });
              });
            } else {
              console.error('Service Worker: No data received from redditScraper.js or scrapeResponse was falsy', scrapeResponse);
              sendResponse({ status: 'Error: No data from scraper' });
              isScraping = false;
            }
          });
        });
      });
    } catch (e) {
        console.error("Service Worker: Uncaught error in scrapeReddit handler", e);
        isScraping = false; // Fallback reset
        // Attempt to send a response if the port is still open
        try {
            sendResponse({ status: 'Error: Internal Server Worker Error' });
        } catch (sendErr) {
            console.error("Service Worker: Failed to send error response after uncaught exception", sendErr);
        }
    }
    return true; // Indicates that the response will be sent asynchronously
  }
  // Listener for notifications from content scripts (e.g., geminiPaster)
  if (request.action === 'notifyUser') {
    console.log('Service Worker: Received notifyUser request:', request.title, request.message);
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon48.png',
        title: request.title || 'Reddit AI Tool Notification',
        message: request.message || 'An update from the extension.'
    });
    sendResponse({status: 'Notification shown'});
    return false; // No further async work for this message type
  }
});

console.log('Service Worker: Loaded and listening for messages. isScraping initially:', isScraping);
