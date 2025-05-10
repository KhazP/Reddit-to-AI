// Placeholder for service_worker.js
// This script will manage the extension's background tasks.

let isScraping = false; // Flag to prevent concurrent scraping

// Helper function to send status updates to the popup
function sendPopupStatus(message, percentage, done = false) { // Added percentage
  // Ensure percentage is a number, default to -1 if undefined or not a number
  const numericPercentage = (typeof percentage === 'number' && !isNaN(percentage)) ? percentage : -1;
  chrome.runtime.sendMessage({ action: "updateStatus", message: message, percentage: numericPercentage, done: done }, (response) => {
    if (chrome.runtime.lastError) {
      // console.log('Popup status update error:', chrome.runtime.lastError.message);
    }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeReddit') {
    if (isScraping) {
      console.log('Service Worker: Scraping already in progress. Ignoring new request.');
      sendResponse({ status: 'Error: Scraping already in progress' });
      sendPopupStatus('Error: Scraping already in progress', 0, true);
      return false; 
    }
    isScraping = true;
    sendPopupStatus('Starting scraping process...', 0, false);
    console.log('Service Worker: Received scrapeReddit message from popup. Starting scrape.');
    console.log('Service Worker: Include hidden comments:', request.includeHidden);

    // Wrap the core logic in a try...finally to ensure isScraping is reset
    try {
      sendPopupStatus('Querying active tab...', 5, false);
      // 1. Get current active tab (should be a Reddit tab)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          console.error('Service Worker: No active tab found.');
          sendResponse({ status: 'Error: No active tab' });
          sendPopupStatus('Error: No active tab found.', 5, true);
          isScraping = false;
          return;
        }
        const activeTab = tabs[0];
        sendPopupStatus('Checking if active tab is Reddit...', 10, false);

        if (!activeTab.url || !activeTab.url.includes('reddit.com')) {
          console.error('Service Worker: Active tab is not a Reddit page.');
          sendPopupStatus('Error: Active tab is not a Reddit page.', 10, true);
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
        sendPopupStatus('Injecting scraper into Reddit page...', 15, false);

        // 2. Inject redditScraper.js into the active Reddit tab
        chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['redditScraper.js']
        }, (injectionResults) => {
          if (chrome.runtime.lastError || !injectionResults || injectionResults.length === 0) {
            console.error('Service Worker: Failed to inject redditScraper.js', chrome.runtime.lastError?.message);
            sendResponse({ status: 'Error: Failed to inject scraper' });
            sendPopupStatus('Error: Failed to inject scraper.', 15, true);
            isScraping = false;
            return;
          }
          console.log('Service Worker: redditScraper.js injected. Now sending scrape command.');
          sendPopupStatus('Scraper injected. Collecting data from page...', 20, false);
          // 3. Send a message to the injected script to start scraping, passing options
          chrome.tabs.sendMessage(activeTab.id, {
            action: 'scrapeReddit', // Ensured action is 'scrapeReddit'
            includeHidden: request.includeHidden
          }, (scrapeResponse) => {
            if (chrome.runtime.lastError) {
              console.error('Service Worker: Error receiving data from redditScraper:', chrome.runtime.lastError.message);
              sendResponse({ status: 'Error: Scraping failed' });
              sendPopupStatus('Error: Scraping failed on page.', 70, true); // Assume data collection was the bulk
              isScraping = false;
              return;
            }
            if (scrapeResponse && scrapeResponse.data) {
              console.log('Service Worker: Received scraped data from redditScraper.js');
              sendPopupStatus('Data collection finished. Storing data...', 75, false);
              // 4. Store data in chrome.storage.local
              chrome.storage.local.set({ redditThreadData: scrapeResponse.data }, () => {
                if (chrome.runtime.lastError) {
                  console.error('Service Worker: Error saving data to storage:', chrome.runtime.lastError.message);
                  sendResponse({ status: 'Error: Failed to save data' });
                  sendPopupStatus('Error: Failed to save data.', 75, true);
                  isScraping = false;
                  return;
                }
                console.log('Service Worker: Scraped data stored in chrome.storage.local.');
                sendPopupStatus('Data stored. Opening AI Platform...', 80, false);

                // 5. Retrieve selected AI model and open in a new tab
                chrome.storage.sync.get(['selectedAiModelKey', 'selectedAiModelConfig'], (settingsResult) => {
                  if (chrome.runtime.lastError) {
                    console.error('Service Worker: Error retrieving AI model settings:', chrome.runtime.lastError.message);
                    sendPopupStatus('Error: Could not get AI settings.', 80, true);
                    isScraping = false;
                    return;
                  }

                  let aiConfig = settingsResult.selectedAiModelConfig;
                  let aiKey = settingsResult.selectedAiModelKey;
                  let defaulted = false;

                  const DEFAULT_MODEL_KEY = 'gemini';
                  const localAiModels = {
                      gemini: { name: "Gemini", url: "https://gemini.google.com/app", inputSelector: "rich-textarea div[contenteditable='true']" },
                      chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/", inputSelector: "#prompt-textarea" },
                      claude: { name: "Claude", url: "https://claude.ai/new", inputSelector: "div.ProseMirror[contenteditable='true']" },
                      grok: { name: "Grok", url: "https://grok.com/", inputSelector: "textarea[aria-label='Ask Grok anything']" }
                  };

                  // START OF NEWLY ADDED CODE BLOCK
                  // Ensure the most current inputSelector from localAiModels is used if different from storage
                  if (aiKey && localAiModels[aiKey] && aiConfig && aiConfig.inputSelector !== localAiModels[aiKey].inputSelector) {
                    console.warn(`Service Worker: Stored inputSelector for '${aiKey}' ("${aiConfig.inputSelector}") differs from local definition ("${localAiModels[aiKey].inputSelector}"). Updating.`);
                    aiConfig.inputSelector = localAiModels[aiKey].inputSelector; // Update in-memory config
                    // Also update the configuration in storage to persist the correction
                    chrome.storage.sync.set({ selectedAiModelConfig: aiConfig }, () => {
                        console.log(`Service Worker: Corrected inputSelector for key '${aiKey}' has been saved to storage.`);
                    });
                  }
                  // END OF NEWLY ADDED CODE BLOCK

                  if (!aiConfig || !aiConfig.url || !aiConfig.inputSelector || !aiKey || !localAiModels[aiKey]) {
                    console.warn('Service Worker: Invalid or missing AI configuration from storage. Attempting to recover or default.', 'Retrieved Key:', aiKey, 'Retrieved Config:', aiConfig);
                    
                    if (aiKey && localAiModels[aiKey] && (!aiConfig || !aiConfig.url || !aiConfig.inputSelector)) {
                        console.log(`Service Worker: Key '${aiKey}' is valid but config object is missing/invalid. Using fresh config for '${aiKey}'.`);
                        aiConfig = localAiModels[aiKey];
                        // Update storage with the corrected config for this valid key
                        chrome.storage.sync.set({ selectedAiModelConfig: aiConfig }, () => {
                            console.log(`Service Worker: Corrected AI config for key '${aiKey}' saved to storage.`);
                        });
                    } else {
                        console.log('Service Worker: Cannot recover from stored key. Defaulting to Gemini.');
                        aiKey = DEFAULT_MODEL_KEY;
                        aiConfig = localAiModels[DEFAULT_MODEL_KEY];
                        defaulted = true;
                        sendPopupStatus(`AI Config error. Defaulted to ${aiConfig.name}. Check options.`, 80, true);
                        chrome.storage.sync.set({ selectedAiModelKey: aiKey, selectedAiModelConfig: aiConfig }, () => {
                            console.log('Service Worker: Saved default AI (Gemini) config to storage.');
                        });
                    }
                  }
                  
                  console.log(`Service Worker: Using AI Model: ${aiConfig.name} (Key: ${aiKey}) ${defaulted ? '(Defaulted)' : ''}`);
                  sendPopupStatus(`Opening ${aiConfig.name}...`, 82, false);

                  chrome.tabs.create({ url: aiConfig.url, active: true }, (aiTab) => {
                    if (chrome.runtime.lastError || !aiTab) {
                      console.error(`Service Worker: Failed to open ${aiConfig.name} tab.`, chrome.runtime.lastError?.message);
                      sendResponse({ status: `Error: Failed to open ${aiConfig.name} tab` });
                      sendPopupStatus(`Error: Failed to open ${aiConfig.name}.`, 80, true);
                      isScraping = false;
                      return;
                    }
                    console.log(`Service Worker: ${aiConfig.name} tab opened with ID:`, aiTab.id);
                    sendPopupStatus(`${aiConfig.name} opened. Waiting for page to load...`, 85, false);
                    
                    const listener = (tabId, changeInfo, tab) => {
                      if (tabId === aiTab.id && changeInfo.status === 'complete') {
                        console.log(`Service Worker: ${aiConfig.name} tab loaded. Injecting aiPaster.js.`);
                        sendPopupStatus(`${aiConfig.name} loaded. Pasting content...`, 90, false);
                        chrome.scripting.executeScript({
                          target: { tabId: aiTab.id },
                          files: ['aiPaster.js'] // Corrected to aiPaster.js
                        }, (injectionResults) => {
                          try { 
                            if (chrome.runtime.lastError || !injectionResults || injectionResults.length === 0) {
                              console.error(`Service Worker: Failed to inject aiPaster.js into ${aiConfig.name}`, chrome.runtime.lastError?.message);
                              sendPopupStatus(`Error: Could not paste into ${aiConfig.name}.`, 90, true);
                              chrome.notifications.create({
                                type: 'basic',
                                iconUrl: 'images/icon48.png',
                                title: 'Reddit AI Tool',
                                message: `Could not paste into ${aiConfig.name}. The site might have updated. Data is in storage.`
                              });
                            } else {
                              console.log('Service Worker: aiPaster.js injected. Sending executePaste command.');
                              // Log the aiConfig object just before sending it
                              console.log('Service Worker: Sending aiConfig to aiPaster.js:', JSON.stringify(aiConfig, null, 2));
                              // Pass the specific AI config to the paster script
                              chrome.tabs.sendMessage(aiTab.id, { action: 'executePaste', aiConfig: aiConfig }, (pasteResponse) => {
                                try { 
                                  if (chrome.runtime.lastError) {
                                    console.error(`Service Worker: Error during paste execution in ${aiConfig.name} or no response:`, chrome.runtime.lastError.message);
                                    sendPopupStatus(`Pasting may have failed. Check ${aiConfig.name}.`, 95, true);
                                  } else if (pasteResponse && pasteResponse.status) {
                                    console.log('Service Worker: Paste script responded:', pasteResponse.status);
                                    sendPopupStatus(pasteResponse.status, 100, true); // Final status from paster
                                  } else {
                                    sendPopupStatus('Pasting complete.', 100, true);
                                  }
                                } finally { // Ensure storage cleanup and scraping flag reset after paste attempt
                                  chrome.storage.local.remove('redditThreadData', () => {
                                    console.log('Service Worker: redditThreadData removed from storage.');
                                  });
                                  isScraping = false; 
                                  console.log('Service Worker: Scraping process complete. isScraping set to false.');
                                  // sendPopupStatus('Process complete!', true); // Covered by pasteResponse status or generic above
                                }
                              });
                            }
                          } finally { // Ensure listener cleanup and potentially reset scraping flag if paste sendMessage not reached
                            chrome.tabs.onUpdated.removeListener(listener);
                            // If the sendMessage to aiPaster was not called (e.g. injection failed), reset isScraping here
                            // Corrected variable name from pasteInjectionResults to injectionResults
                            if (!(injectionResults && injectionResults.length > 0)) {
                             isScraping = false;
                             sendPopupStatus('Process ended due to paste script injection failure.', 90, true);
                             // Corrected log message to refer to aiPaster.js
                             console.log('Service Worker: Scraping process ended (aiPaster.js injection failed). isScraping set to false.');
                            }
                          }
                        });
                      }
                    };
                    chrome.tabs.onUpdated.addListener(listener);
                    sendResponse({ status: 'Scraping initiated, Gemini tab opened.' }); // Initial response to popup click
                    // sendPopupStatus('Gemini tab opening...', 85); // Already covered
                    // Note: isScraping is reset inside the paste logic or its error handlers
                  });
                });
              });
            } else {
              console.error('Service Worker: No data received from redditScraper.js or scrapeResponse was falsy', scrapeResponse);
              sendResponse({ status: 'Error: No data from scraper' });
              sendPopupStatus('Error: No data received from scraper.', 70, true); // Assume data collection failed
              isScraping = false;
            }
          });
        });
      });
    } catch (e) {
        console.error("Service Worker: Uncaught error in scrapeReddit handler", e);
        sendPopupStatus('Critical error in service worker.', -1, true); // -1 for indeterminate error progress
        isScraping = false; // Fallback reset
        // Attempt to send a response if the port is still open
        try {
            sendResponse({ status: 'Error: Internal Server Worker Error' });
        } catch (sendErr) {
            console.error("Service Worker: Failed to send error response after uncaught exception", sendErr);
        }
    }
    return true; // Indicates that the response will be sent asynchronously
  } else if (request.action === "progressUpdate") { // Handle detailed progress from content script
    let percentage = -1; // Default, popup.js will hide bar or keep current if -1
    const message = request.message.toLowerCase();
    const baseScrapingPercentage = 10; // Start lower to show more granular progress
    const scrapingRange = 50; // Scraping (post + comments) takes from 20% to 70%
    
    // Extract percentage if explicitly provided in the message
    if (request.percentage !== undefined && !isNaN(request.percentage)) {
        percentage = request.percentage;
    } 
    // Otherwise infer from message content
    else if (message.includes("scraping process initiated")) percentage = baseScrapingPercentage; // 10%
    else if (message.includes("inspecting post details")) percentage = baseScrapingPercentage + 5; // 15%
    else if (message.includes("post details extracted")) percentage = baseScrapingPercentage + 10; // 20%
    else if (message.includes("starting comment collection")) percentage = baseScrapingPercentage + 15; // 25%
    else if (message.includes("initial comments found")) percentage = baseScrapingPercentage + 20; // 30%
    else if (message.includes("actively listening for dynamic comments")) percentage = baseScrapingPercentage + 25; // 35%
    else if (message.includes("checking for more comments") || message.includes("seeking more comments")) {
        const attemptMatch = message.match(/attempt: (\d+)\/(\d+)/);
        if (attemptMatch) {
            const currentAttempt = parseInt(attemptMatch[1]);
            const maxAttempts = parseInt(attemptMatch[2]) || 500; // Updated default max to 500
            // This sub-stage (clicking load more) can take up to 30% of the total progress (35% to 65%)
            // Use a more logarithmic-like scale so early progress is more visible
            const progressRatio = Math.pow(currentAttempt / maxAttempts, 0.7); // Adjusted exponent for better visual feedback
            percentage = baseScrapingPercentage + 25 + Math.floor(progressRatio * 30);
        } else {
            percentage = baseScrapingPercentage + 30; // Generic for "checking for more comments" (40%)
        }
    } else if (message.includes("comments collected") && message.includes("clicked 'load more'")) {
        // Try to extract the number of comments and show progress based on volume
        const commentsMatch = message.match(/(\d+)\s+comments collected/);
        if (commentsMatch) {
            const commentCount = parseInt(commentsMatch[1]);
            // More comments generally means more progress (up to a point)
            percentage = baseScrapingPercentage + 25 + Math.min(Math.floor(Math.log10(commentCount + 1) * 5), 25);
        } else {
            const currentProgress = percentage !== -1 ? percentage : (baseScrapingPercentage + 35); // Use current or a mid-value
            percentage = Math.min(currentProgress + 1, baseScrapingPercentage + 55); // Increment slightly
        }
    } else if (message.includes("stability check")) {
        const stabilityMatch = message.match(/stability check (\d+)\/(\d+)/);
        const commentsMatch = message.match(/comments: (\d+)/i);
        let commentsBonus = 0;
        
        if (commentsMatch) {
            const commentCount = parseInt(commentsMatch[1]);
            commentsBonus = Math.min(Math.log10(commentCount + 1) * 2, 5); // Add a slight bonus for high comment counts
        }
        
        if (stabilityMatch) {
            const currentCheck = parseInt(stabilityMatch[1]);
            const maxChecks = parseInt(stabilityMatch[2]) || 6; // Default max if not found
            // This sub-stage (stability) can take up to 5% of total progress (65% to 70%)
            percentage = baseScrapingPercentage + 55 + Math.floor((currentCheck / maxChecks) * 5) + commentsBonus;
        } else {
            percentage = baseScrapingPercentage + 60 + commentsBonus; // Generic for stability check
        }
    } else if (message.includes("finalizing comment data")) percentage = 65; // 65%
    else if (message.includes("structuring") && message.includes("comments")) percentage = 70; // 70% 
    else if (message.includes("comment collection complete")) percentage = 70; // 70%
    // else, percentage remains -1, popup won't update bar width unless it's an error

    sendPopupStatus(request.message, percentage, false); // Not done yet
    sendResponse({status: "progress acknowledged by service worker"}); 
    return false; // Synchronous response here as we are not waiting for async operation inside this block
  }
  // Listener for notifications from content scripts (e.g., geminiPaster)
  if (request.action === 'notifyUser') {
    console.log('Service Worker: Received notifyUser request:', request.title, request.message);
    // Potentially send this to popup too if it's a general notification
    // sendPopupStatus(request.message); 
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
