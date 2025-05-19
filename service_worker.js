// Placeholder for service_worker.js
// This script will manage the extension's background tasks.

let isScraping = false; // Flag to prevent concurrent scraping
let scrapingTabId = null; // To store the ID of the tab being scraped
let stopRequested = false; // Flag to indicate if a stop has been requested

// Helper function to show notifications if enabled
function showNotificationIfEnabled(title, message, notificationIdBase = 'redditAI') {
  chrome.storage.sync.get(['showNotifications'], (result) => {
    // Default to true if not set, aligning with options.js default
    const shouldShow = typeof result.showNotifications === 'boolean' ? result.showNotifications : true;
    if (shouldShow) {
      const notificationId = `${notificationIdBase}-${Date.now()}`;
      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'images/icon128.png', // Using a larger icon for notifications
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
      showNotificationIfEnabled('Scraping Busy', 'A scraping process is already in progress.');
      return false; 
    }
    isScraping = true;
    stopRequested = false; // Reset stop request flag at the start of new scraping
    scrapingTabId = null; // Reset scraping tab ID
    sendPopupStatus('Starting scraping process...', 0, false);
    console.log('Service Worker: Received scrapeReddit message from popup. Starting scrape.');
    console.log('Service Worker: Include hidden comments:', request.includeHidden);
    showNotificationIfEnabled('Reddit AI Tool', 'Scraping process initiated.');

    // Wrap the core logic in a try...finally to ensure isScraping is reset
    try {
      sendPopupStatus('Querying active tab...', 5, false);
      // 1. Get current active tab (should be a Reddit tab)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (stopRequested) { 
          console.log("Service Worker: Stop requested before tab query completed.");
          sendPopupStatus('Scraping stopped by user.', -1, true);
          showNotificationIfEnabled('Scraping Halted', 'Scraping stopped by user request.');
          isScraping = false; scrapingTabId = null; // Corrected syntax
          sendResponse({ status: 'Scraping stopped' });
          return;
        }
        if (tabs.length === 0) {
          console.error('Service Worker: No active tab found.');
          sendResponse({ status: 'Error: No active tab' });
          sendPopupStatus('Error: No active tab found.', 5, true);
          showNotificationIfEnabled('Scraping Error', 'No active tab found. Please open a Reddit page.');
          isScraping = false;
          return;
        }
        const activeTab = tabs[0];
        scrapingTabId = activeTab.id; // Store the tab ID
        sendPopupStatus('Checking if active tab is Reddit...', 10, false);

        if (stopRequested) { 
          console.log("Service Worker: Stop requested before Reddit page check.");
          sendPopupStatus('Scraping stopped by user.', -1, true);
          showNotificationIfEnabled('Scraping Halted', 'Scraping stopped by user request.');
          isScraping = false; scrapingTabId = null; // Corrected syntax
          sendResponse({ status: 'Scraping stopped' });
          return;
        }

        if (!activeTab.url || !activeTab.url.includes('reddit.com')) {
          console.error('Service Worker: Active tab is not a Reddit page.');
          sendPopupStatus('Error: Active tab is not a Reddit page.', 10, true);
          // This existing notification will now be conditional based on settings
          showNotificationIfEnabled('Reddit AI Tool Error', 'Please navigate to a Reddit thread page to use this extension.');
          sendResponse({ status: 'Error: Not a Reddit page' });
          isScraping = false; scrapingTabId = null;
          return;
        }

        if (stopRequested) { 
          console.log("Service Worker: Stop requested before script injection.");
          sendPopupStatus('Scraping stopped by user.', -1, true);
          showNotificationIfEnabled('Scraping Halted', 'Scraping stopped by user request.');
          isScraping = false; scrapingTabId = null; // Corrected syntax
          sendResponse({ status: 'Scraping stopped' });
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
            showNotificationIfEnabled('Scraping Error', 'Failed to inject the Reddit scraper script.');
            isScraping = false; scrapingTabId = null;
            return;
          }

          if (stopRequested) { 
            console.log("Service Worker: Stop requested after script injection, before sending scrape command.");
            if (scrapingTabId) {
                chrome.tabs.sendMessage(scrapingTabId, { action: 'cancelScraping' }).catch(e => console.warn("Error sending cancel to content script (might be normal if not fully loaded):", e.message));
            }
            sendPopupStatus('Scraping stopped by user.', -1, true);
            showNotificationIfEnabled('Scraping Halted', 'Scraping stopped by user request.');
            isScraping = false; scrapingTabId = null; // Corrected syntax
            sendResponse({ status: 'Scraping stopped' });
            return;
          }

          console.log('Service Worker: redditScraper.js injected. Now sending scrape command.');
          sendPopupStatus('Scraper injected. Collecting data from page...', 20, false);
          // 3. Send a message to the injected script to start scraping, passing options
          chrome.tabs.sendMessage(activeTab.id, {
            action: 'scrapeReddit',
            includeHidden: request.includeHidden
            // No need to pass stopRequested here, content script will have its own listener
          }, async (scrapeResponse) => { // Make the callback async
            if (chrome.runtime.lastError) {
              // Check if error is due to stopRequested and tab being closed or script unloaded
              if (stopRequested) {
                console.log('Service Worker: Error receiving data from redditScraper, likely due to stop request and script unload/tab closure.', chrome.runtime.lastError.message);
                sendPopupStatus('Scraping stopped by user (communication error).', -1, true);
                showNotificationIfEnabled('Scraping Halted', 'Scraping stopped by user (communication error).');
              } else {
                console.error('Service Worker: Error receiving data from redditScraper:', chrome.runtime.lastError.message);
                sendPopupStatus('Error: Scraping failed on page.', 70, true);
                showNotificationIfEnabled('Scraping Error', 'Scraping failed on the Reddit page.');
              }
              sendResponse({ status: 'Error: Scraping failed or stopped' });
              isScraping = false; scrapingTabId = null;
              return;
            }

            if (stopRequested && (!scrapeResponse || scrapeResponse.status !== 'cancelled')) {
                console.log("Service Worker: Stop was requested during scraping. ScrapeResponse:", scrapeResponse);
                sendPopupStatus('Scraping stopped by user.', -1, true);
                showNotificationIfEnabled('Scraping Halted', 'Scraping stopped by user during data collection.');
                isScraping = false; scrapingTabId = null;
                chrome.storage.local.remove('redditThreadData', () => {
                    console.log('Service Worker: redditThreadData removed due to stop request during scraping.');
                });
                sendResponse({ status: 'Scraping stopped' });
                return;
            }

            if (scrapeResponse && scrapeResponse.status === 'cancelled') {
                console.log('Service Worker: Scraping was cancelled by content script.');
                sendPopupStatus('Scraping cancelled by user.', -1, true);
                showNotificationIfEnabled('Scraping Cancelled', 'Scraping was cancelled on the page.');
                isScraping = false; scrapingTabId = null;
                chrome.storage.local.remove('redditThreadData', () => {
                    console.log('Service Worker: redditThreadData removed as scraping was cancelled.');
                });
                sendResponse({ status: 'Scraping cancelled' });
                return;
            }

            if (scrapeResponse && scrapeResponse.data) {
              console.log('Service Worker: Received scraped data from redditScraper.js');
              
              let processedData = scrapeResponse.data;
              // --- BEGIN IMAGE FETCHING AND CONVERSION (FOR MULTIPLE IMAGES) ---
              if (processedData.post && processedData.post.imageUrls && Array.isArray(processedData.post.imageUrls) && processedData.post.imageUrls.length > 0) {
                sendPopupStatus('Processing post image(s)...', 72, false);
                const imageDataUrlsArray = [];
                let imageCount = processedData.post.imageUrls.length;
                let imagesProcessed = 0;

                for (const imageUrl of processedData.post.imageUrls) {
                  try {
                    // Ensure the URL is absolute
                    const absoluteImageUrl = new URL(imageUrl, activeTab.url).href;
                    console.log('Service Worker: Fetching image data for:', absoluteImageUrl);
                    const response = await fetch(absoluteImageUrl);
                    if (!response.ok) {
                      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText} for ${absoluteImageUrl}`);
                    }
                    const blob = await response.blob();
                    if (blob.type.startsWith('image/')) {
                      const reader = new FileReader();
                      const dataUrlPromise = new Promise((resolve, reject) => {
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = (error) => reject(new Error(`FileReader error for ${absoluteImageUrl}: ${error}`));
                        reader.readAsDataURL(blob);
                      });
                      imageDataUrlsArray.push(await dataUrlPromise);
                      console.log('Service Worker: Image converted to dataURL:', absoluteImageUrl);
                    } else {
                      console.warn('Service Worker: Fetched resource is not a processable image type:', blob.type, absoluteImageUrl);
                    }
                  } catch (error) {
                    console.error('Service Worker: Error fetching or processing an image:', error.message);
                    // Optionally add a placeholder or skip this image
                  }
                  imagesProcessed++;
                  sendPopupStatus(`Processing image ${imagesProcessed}/${imageCount}...`, 72 + Math.floor((imagesProcessed / imageCount) * 3), false); // Small progress update per image
                }

                if (imageDataUrlsArray.length > 0) {
                  processedData.post.imageDataUrls = imageDataUrlsArray; // Pluralized
                  console.log(`Service Worker: ${imageDataUrlsArray.length} image(s) converted to dataURLs.`);
                } else {
                  processedData.post.imageDataUrls = []; // Ensure it's an empty array if no images were processed
                  console.log('Service Worker: No images were successfully converted to dataURLs.');
                }
              } else {
                processedData.post.imageDataUrls = []; // Ensure it's an empty array if no imageUrls initially
              }
              // --- END IMAGE FETCHING AND CONVERSION ---
              
              sendPopupStatus('Data collection finished. Storing data...', 75, false);
              // 4. Store data in chrome.storage.local
              chrome.storage.local.set({ redditThreadData: processedData }, () => { // Use processedData
                if (chrome.runtime.lastError) {
                  console.error('Service Worker: Error saving data to storage:', chrome.runtime.lastError.message);
                  sendResponse({ status: 'Error: Failed to save data' });
                  sendPopupStatus('Error: Failed to save data.', 75, true);
                  showNotificationIfEnabled('Storage Error', 'Failed to save scraped data.');
                  isScraping = false; scrapingTabId = null;
                  return;
                }
                if (stopRequested) { // Check again before opening AI tab
                    console.log("Service Worker: Stop requested before opening AI tab.");
                    sendPopupStatus('Scraping stopped by user before AI interaction.', -1, true);
                    showNotificationIfEnabled('Scraping Halted', 'Scraping stopped before AI platform interaction.');
                    isScraping = false; scrapingTabId = null;
                    chrome.storage.local.remove('redditThreadData', () => {
                        console.log('Service Worker: redditThreadData removed due to stop request.');
                    });
                    sendResponse({ status: 'Scraping stopped' });
                    return;
                }
                console.log('Service Worker: Scraped data stored in chrome.storage.local.');
                sendPopupStatus('Data stored. Opening AI Platform...', 80, false);

                // 5. Retrieve selected AI model and open in a new tab
                chrome.storage.sync.get(['selectedAiModelKey', 'selectedAiModelConfig'], (settingsResult) => {
                  if (chrome.runtime.lastError) {
                    console.error('Service Worker: Error retrieving AI model settings:', chrome.runtime.lastError.message);
                    sendPopupStatus('Error: Could not get AI settings.', 80, true);
                    showNotificationIfEnabled('Configuration Error', 'Could not retrieve AI model settings.');
                    isScraping = false; scrapingTabId = null;
                    return;
                  }

                  let aiConfig = settingsResult.selectedAiModelConfig;
                  let aiKey = settingsResult.selectedAiModelKey;
                  let defaulted = false;

                  const DEFAULT_MODEL_KEY = 'aistudio'; // Changed default to AI Studio
                  const localAiModels = {
                      gemini: { name: "Gemini", url: "https://gemini.google.com/app", inputSelector: "rich-textarea div[contenteditable='true']" },
                      chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/", inputSelector: "#prompt-textarea" },
                      claude: { name: "Claude", url: "https://claude.ai/new", inputSelector: "div.ProseMirror[contenteditable='true']" },
                      aistudio: { name: "AI Studio", url: "https://aistudio.google.com/prompts/new_chat", inputSelector: "textarea[aria-label='Type something or pick one from prompt gallery']" }
                  };

                  // Ensure the most current inputSelector from localAiModels is used if different from storage
                  if (aiKey && localAiModels[aiKey] && aiConfig && aiConfig.inputSelector !== localAiModels[aiKey].inputSelector) {
                    console.warn(`Service Worker: Stored inputSelector for '${aiKey}' ("${aiConfig.inputSelector}") differs from local definition ("${localAiModels[aiKey].inputSelector}"). Updating.`);
                    aiConfig.inputSelector = localAiModels[aiKey].inputSelector; // Update in-memory config
                    // Also update the configuration in storage to persist the correction
                    chrome.storage.sync.set({ selectedAiModelConfig: aiConfig }, () => {
                        console.log(`Service Worker: Corrected inputSelector for key '${aiKey}' has been saved to storage.`);
                    });
                  }

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
                        console.log('Service Worker: Cannot recover from stored key. Defaulting to AI Studio.'); // Updated log
                        aiKey = DEFAULT_MODEL_KEY;
                        aiConfig = localAiModels[DEFAULT_MODEL_KEY];
                        defaulted = true;
                        sendPopupStatus(`AI Config error. Defaulted to ${aiConfig.name}. Check options.`, 80, true);
                        showNotificationIfEnabled('Configuration Warning', `AI settings error. Defaulted to ${aiConfig.name}. Please check options.`);
                        chrome.storage.sync.set({ selectedAiModelKey: aiKey, selectedAiModelConfig: aiConfig }, () => {
                            console.log('Service Worker: Saved default AI (AI Studio) config to storage.'); // Updated log
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
                      showNotificationIfEnabled('AI Platform Error', `Failed to open ${aiConfig.name} tab.`);
                      isScraping = false; scrapingTabId = null;
                      return;
                    }
                    console.log(`Service Worker: ${aiConfig.name} tab opened with ID:`, aiTab.id);
                    sendPopupStatus(`${aiConfig.name} opened. Waiting for page to load...`, 85, false);
                    showNotificationIfEnabled('AI Platform', `${aiConfig.name} tab opened successfully.`);
                    
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
                              // This existing notification will now be conditional
                              showNotificationIfEnabled('Reddit AI Tool', `Could not paste into ${aiConfig.name}. The site might have updated. Data is in storage.`);
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
                                    showNotificationIfEnabled('AI Platform Warning', `Pasting to ${aiConfig.name} may have failed. Please check the tab.`);
                                  } else if (pasteResponse && pasteResponse.status) {
                                    console.log('Service Worker: Paste script responded:', pasteResponse.status);
                                    sendPopupStatus(pasteResponse.status, 100, true); // Final status from paster
                                    showNotificationIfEnabled('AI Platform Update', `${aiConfig.name}: ${pasteResponse.status}`);
                                  } else {
                                    sendPopupStatus('Pasting complete.', 100, true);
                                    showNotificationIfEnabled('AI Platform Update', `Content pasting to ${aiConfig.name} initiated.`);
                                  }
                                } finally { // Ensure storage cleanup and scraping flag reset after paste attempt
                                  chrome.storage.local.remove('redditThreadData', () => {
                                    console.log('Service Worker: redditThreadData removed from storage.');
                                  });
                                  isScraping = false; 
                                  scrapingTabId = null;
                                  console.log('Service Worker: Scraping process complete. isScraping set to false.');
                                  showNotificationIfEnabled('Reddit AI Tool', 'Scraping and AI interaction process complete!');
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
                             scrapingTabId = null;
                             sendPopupStatus('Process ended due to paste script injection failure.', 90, true);
                             showNotificationIfEnabled('AI Platform Error', `Failed to inject pasting script into ${aiConfig.name}.`);
                             // Corrected log message to refer to aiPaster.js
                             console.log('Service Worker: Scraping process ended (aiPaster.js injection failed). isScraping set to false.');
                            }
                          }
                        });
                      }
                    };
                    chrome.tabs.onUpdated.addListener(listener);
                    sendResponse({ status: 'Scraping initiated, AI tab opened.' }); // Generic message
                    // sendPopupStatus('Gemini tab opening...', 85); // Already covered
                    // Note: isScraping is reset inside the paste logic or its error handlers
                  });
                });
              });
            } else {
              console.error('Service Worker: No data received from redditScraper.js or scrapeResponse was falsy', scrapeResponse);
              sendResponse({ status: 'Error: No data from scraper' });
              sendPopupStatus('Error: No data received from scraper.', 70, true); // Assume data collection failed
              showNotificationIfEnabled('Scraping Error', 'No data was received from the Reddit page scraper.');
              isScraping = false; scrapingTabId = null;
            }
          });
        });
      });
    } catch (e) {
        console.error("Service Worker: Uncaught error in scrapeReddit handler", e);
        sendPopupStatus('Critical error in service worker.', -1, true);
        showNotificationIfEnabled('Critical Extension Error', 'An unexpected error occurred. Please try again or check console.');
        isScraping = false; // Fallback reset
        scrapingTabId = null;
        // Attempt to send a response if the port is still open
        try {
            sendResponse({ status: 'Error: Internal Server Worker Error' });
        } catch (sendErr) {
            console.error("Service Worker: Failed to send error response after uncaught exception", sendErr);
        }
    }
    return true; // Indicates that the response will be sent asynchronously
  } else if (request.action === "stopScraping") {
    console.log("Service Worker: Received stopScraping message.");
    if (!isScraping && !stopRequested) { 
      sendResponse({ status: "Not actively scraping or stop already in progress." });
      sendPopupStatus("Not scraping or stop pending.", -1, true);
      // showNotificationIfEnabled('Info', 'No active scraping process to stop.'); // Optional, could be noisy
      return false;
    }
    stopRequested = true;
    sendPopupStatus("Stop request received. Attempting to halt scraping...", -1, false);

    if (scrapingTabId) {
      chrome.tabs.sendMessage(scrapingTabId, { action: 'cancelScraping' }, (cancelResponse) => {
        if (chrome.runtime.lastError) {
          console.warn('Service Worker: Error sending cancelScraping to content script (might have already finished, been removed, or tab closed):', chrome.runtime.lastError.message);
        }
        if (cancelResponse && cancelResponse.status) {
          console.log("Service Worker: Content script responded to cancelScraping:", cancelResponse.status);
        }
        isScraping = false; 
        // scrapingTabId = null; // Let the main flow or a later check nullify this if needed.
        sendPopupStatus("Scraping process halting.", -1, true); 
        showNotificationIfEnabled('Scraping Halted', 'Scraping process is halting due to user request.');
        sendResponse({ status: "Stop signal sent. Scraping should halt." });
        chrome.storage.local.remove('redditThreadData', () => {
            console.log('Service Worker: redditThreadData removed due to stopScraping command.');
        });
      });
    } else {
      isScraping = false;
      scrapingTabId = null; 
      sendPopupStatus("Scraping stopped (no active scrape tab identified).", -1, true);
      showNotificationIfEnabled('Scraping Halted', 'Scraping stopped (no active scrape tab was identified).');
      sendResponse({ status: "Scraping stopped (no active scrape tab)." });
      chrome.storage.local.remove('redditThreadData', () => {
            console.log('Service Worker: redditThreadData removed (no active scrape tab during stop).'); // Corrected syntax
        });
    }
    return true; // Async response
  } else if (request.action === "progressUpdate") {
    if (stopRequested && !(request.message && request.message.toLowerCase().includes("cancel"))) {
        console.log("Service Worker: ProgressUpdate received after stopRequested. Message:", request.message);
        // If a stop is requested, we might only want to show messages related to cancellation itself.
        // Or, we can let them through but the popup should ideally show a generic "Stopping..." message.
        // For now, let most through, but the popup should be primarily guided by the stopRequested state.
    }
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
    // Use the helper function to respect user settings
    showNotificationIfEnabled(request.title || 'Reddit AI Tool Notification', request.message || 'You have a new notification.');
    sendResponse({ status: 'Notification request processed by service worker' });
    return false; // Synchronous response
  }
  return true; // Keep true for other async message handlers if any are added later, or if default is async.
});

console.log('Service Worker: Loaded and listening for messages. isScraping initially:', isScraping);
