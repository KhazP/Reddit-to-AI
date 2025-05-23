// Service Worker - Step 6: Reintroducing content script messaging and full callback chain

console.log('Service Worker (Step 6): Script loaded.');

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
    console.log("Service Worker (Step 6): Broadcasting state:", scrapingState);
    chrome.runtime.sendMessage({
        action: "scrapingStateUpdate",
        data: scrapingState
    }, (response) => {
        if (chrome.runtime.lastError) {
            // console.log('Popup status update error:', chrome.runtime.lastError.message);
        }
    });
    // Restore floating panel message sending
    if (scrapingState.lastScrapedTabId) {
        chrome.tabs.sendMessage(scrapingState.lastScrapedTabId, {
            action: "updateFloatingPanel",
            data: scrapingState
        }, (response) => {
            if (chrome.runtime.lastError) {
                // console.warn('Floating panel update error (normal if panel not ready/tab closed):', scrapingState.lastScrapedTabId, chrome.runtime.lastError.message);
            }
        }); // Note: Original erroneous .catch was here, ensure it's not reintroduced.
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
  console.log('Service Worker (Step 6): Extension Installed.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Service Worker (Step 6): Message received:', request);

  if (request.action === 'scrapeReddit') {
    console.log('Service Worker (Step 6): scrapeReddit action received.');
    
    if (scrapingState.isActive) {
      sendResponse({ status: 'Error: Scraping already in progress', currentState: scrapingState });
      return false; 
    }
    
    scrapingState.isActive = true;
    scrapingState.message = 'Querying active tab...';
    scrapingState.percentage = 5;
    scrapingState.summary = null;
    scrapingState.error = null;
    // lastScrapedTabId will be set after tab query
    broadcastScrapingState();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) { /* ... simplified error handling ... */ return; }
      if (tabs.length === 0) { /* ... simplified error handling ... */ return; }
      
      const activeTab = tabs[0];
      scrapingState.lastScrapedTabId = activeTab.id;

      if (!activeTab.url || !activeTab.url.includes('reddit.com')) { /* ... simplified error handling ... */ return; }

      scrapingState.message = 'Injecting scripts...';
      scrapingState.percentage = 15;
      broadcastScrapingState();

      (async () => {
          try {
              await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: ['floatingPanel.css'] });
              await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['floatingPanel.js'] });
              
              scrapingState.message = 'Injecting main scraper...';
              scrapingState.percentage = 20;
              broadcastScrapingState();

              await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['redditScraper.js'] });
              console.log('Service Worker (Step 6): redditScraper.js injected.');

              // ***** REINTRODUCING THIS ENTIRE BLOCK *****
              console.log('Service Worker (Step 6): Sending scrape command to content script.');
              scrapingState.message = 'Scraper injected. Collecting data from page...';
              scrapingState.percentage = 20; // Percentage might need re-evaluation from original
              broadcastScrapingState();
              
              chrome.tabs.sendMessage(activeTab.id, {
                action: 'scrapeReddit',
                includeHidden: request.includeHidden
              }, async (scrapeResponse) => { // Callback is async
                if (chrome.runtime.lastError) {
                  // ... (original error handling for scrapeResponse lastError)
                  scrapingState.isActive = false;
                  scrapingState.message = 'Error: Scraping failed on page.';
                  scrapingState.error = 'Scraping failed on page: ' + chrome.runtime.lastError.message;
                  broadcastScrapingState();
                  sendResponse({ status: 'Error: Scraping failed or stopped', currentState: scrapingState });
                  return;
                }

                if (scrapeResponse && scrapeResponse.status === 'cancelled') {
                  // ... (original handling for cancelled status) ...
                  scrapingState.isActive = false;
                  scrapingState.message = 'Scraping cancelled by user on page.';
                  broadcastScrapingState();
                  sendResponse({ status: 'Scraping cancelled', currentState: scrapingState });
                  return;
                }

                if (scrapeResponse && scrapeResponse.data) {
                  console.log('Service Worker (Step 6): Received scraped data.');
                  let processedData = scrapeResponse.data;
                  
                  // --- BEGIN IMAGE FETCHING AND CONVERSION (FOR MULTIPLE IMAGES) ---
                  // This is the full image processing logic from the original file
                  if (processedData.post && processedData.post.imageUrls && Array.isArray(processedData.post.imageUrls) && processedData.post.imageUrls.length > 0) {
                    scrapingState.message = 'Processing post image(s)...';
                    scrapingState.percentage = 72; // Original percentage
                    broadcastScrapingState();
                    const imageDataUrlsArray = [];
                    let imageCount = processedData.post.imageUrls.length;
                    let imagesProcessed = 0;
                    for (const imageUrl of processedData.post.imageUrls) {
                      try {
                        const absoluteImageUrl = new URL(imageUrl, activeTab.url).href;
                        const response = await fetch(absoluteImageUrl);
                        if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${response.statusText} for ${absoluteImageUrl}`);
                        const blob = await response.blob();
                        if (blob.type.startsWith('image/')) {
                          const reader = new FileReader();
                          const dataUrlPromise = new Promise((resolve, reject) => {
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = (error) => reject(new Error(`FileReader error for ${absoluteImageUrl}: ${error}`));
                            reader.readAsDataURL(blob);
                          });
                          imageDataUrlsArray.push(await dataUrlPromise);
                        } else { /* console.warn(...) */ }
                      } catch (error) { /* console.error(...) */ }
                      imagesProcessed++;
                      scrapingState.message = `Processing image ${imagesProcessed}/${imageCount}...`;
                      scrapingState.percentage = 72 + Math.floor((imagesProcessed / imageCount) * 3);
                      broadcastScrapingState();
                    }
                    processedData.post.imageDataUrls = imageDataUrlsArray.length > 0 ? imageDataUrlsArray : [];
                  } else {
                    processedData.post.imageDataUrls = [];
                  }
                  // --- END IMAGE FETCHING AND CONVERSION ---
                  
                  scrapingState.message = 'Data collection finished. Storing data...';
                  scrapingState.percentage = 75; // Original percentage
                  broadcastScrapingState();

                  // Retrieve ALL relevant settings (this is the full settings retrieval and API call logic)
                  chrome.storage.sync.get([
                      'defaultPromptTemplate', 'dataStorageOption', 'selectedLlmProvider', 'apiKey', 'modelName'
                  ], async (settingsResult) => {
                    if (chrome.runtime.lastError) { /* ... error handling ... */ return; }

                    const userPromptTemplate = settingsResult.defaultPromptTemplate;
                    const dataStorageOption = settingsResult.dataStorageOption || 'persistent'; 
                    const DEFAULT_PROMPT_TEMPLATE = "Scraped Content:\n\n{content}"; // Simplified for brevity
                    const provider = settingsResult.selectedLlmProvider || 'openai';
                    const apiKey = settingsResult.apiKey;
                    const modelName = settingsResult.modelName;
                    
                    let textForAI = `Title: ${processedData.post?.title || 'N/A'} ... Comments: ...`; // Simplified for brevity
                    // ... (original textForAI construction logic) ...
                    
                    let finalContentToPaste = textForAI; // Simplified for brevity
                    // ... (original template application logic) ...
                    
                    const processWithApi = async () => { // This is the function containing the suspected try/catch
                        if (!apiKey) { /* ... error handling ... */ scrapingState.isActive = false; broadcastScrapingState(); return; }
                        scrapingState.message = 'Preparing summary request...';
                        scrapingState.percentage = 80; broadcastScrapingState();
                        let apiUrl = '', headers = {}, body = {}, effectiveModelName = modelName;
                        // ... (original API URL, headers, body setup based on provider) ...
                        if (provider === 'openai') { /* ... */ } else if (provider === 'gemini') { /* ... */ } else { /* error handling */ return; }

                        try { // THIS IS THE TRY BLOCK NEAR ORIGINAL ERROR LINE 647
                            scrapingState.message = `Sending request to ${provider} API...`;
                            scrapingState.percentage = 85; broadcastScrapingState();
                            const response = await fetch(apiUrl, { method: 'POST', headers: headers, body: body });
                            if (!response.ok) { /* ... error handling ... */ throw new Error(/* ... */); }
                            const data = await response.json();
                            let summaryText = '';
                            if (provider === 'openai') { /* ... */ } else if (provider === 'gemini') { /* ... */ }
                            scrapingState.summary = summaryText;
                            scrapingState.message = 'Summarization complete!';
                            scrapingState.percentage = 100;
                            showNotificationIfEnabled( /* simplified args from Turn 7/8 for safety */
                                `${provider} Summary Ready`, "Summary details here.", "notification-id"
                            );
                        } catch (error) { // THIS IS THE CATCH BLOCK (user reported (e) here)
                            console.error(`Service Worker (Step 6): Error during API call to ${provider}:`, error);
                            scrapingState.message = `Error: ${error.message || 'API call failed.'}`;
                            if (!scrapingState.error) scrapingState.error = error.message || 'API call failed.';
                            scrapingState.percentage = -1;
                        } finally {
                            scrapingState.isActive = false;
                            broadcastScrapingState();
                            // ... (original storage removal logic) ...
                            if (dataStorageOption === 'persistent') { /* remove local */ } else if (dataStorageOption === 'sessionOnly') { /* remove session */ }
                        }
                    }; // End of processWithApi
                    
                    // Determine data storage and proceed with API call
                    if (dataStorageOption === 'dontSave') { /* ... */ processWithApi(); }
                    else if (dataStorageOption === 'sessionOnly') { /* ... set session ... */ processWithApi(); }
                    else { /* ... set local ... */ processWithApi(); }
                  }); // End of chrome.storage.sync.get callback
                  sendResponse({ status: 'Scraping and processing complete (simulated for Step 6)', currentState: scrapingState }); // Adjust as needed
                } else { 
                  // ... (original handling for no scrapeResponse.data)
                  scrapingState.isActive = false;
                  scrapingState.message = 'Error: No data received from scraper.';
                  broadcastScrapingState();
                  sendResponse({ status: 'Error: No data from scraper', currentState: scrapingState });
                }
              }); // End of chrome.tabs.sendMessage callback
              // ***** END OF REINTRODUCED BLOCK *****

          } catch (err) { // Catch for script injection errors
              console.error("Service Worker (Step 6): Error during script injection phase:", err);
              scrapingState.isActive = false;
              scrapingState.message = 'Error during script injection: ' + err.message;
              scrapingState.error = err.message;
              scrapingState.percentage = -1;
              broadcastScrapingState();
              // If sendResponse hasn't been called yet by an earlier error path.
              // This path might be tricky if the error occurs after sendResponse from scrapeReddit's main body has been implicitly sent due to `return true`.
              // For now, this catch primarily logs. The main sendResponse for scrapeReddit is handled by its callback.
          }
      })(); // End of IIFE for script injection

    }); // End of chrome.tabs.query callback

    return true; // Indicate async response for scrapeReddit

  } else if (request.action === "stopScraping") { /* ... same as Step 5 ... */ sendResponse({}); return false;
  } else if (request.action === "progressUpdate") { /* ... same as Step 5 ... */ sendResponse({}); return false;
  } else if (request.action === 'getScrapingState') { /* ... same as Step 5 ... */ sendResponse(scrapingState); return false; 
  } else if (request.action === 'notifyUser') { /* ... same as Step 5 ... */ sendResponse({}); return false; }

  console.warn("Service Worker (Step 6): Unhandled message action:", request.action);
  return false; 
});

console.log('Service Worker (Step 6): All listeners registered.');
