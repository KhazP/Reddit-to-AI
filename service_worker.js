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
                sendPopupStatus('Data collection finished. Applying settings and preparing for AI...', 75, false); // Updated message

                // 5. Retrieve ALL relevant settings: AI model, prompt template, data storage
                chrome.storage.sync.get([
                    // 'selectedAiModelKey', // Old setting
                    // 'selectedAiModelConfig', // Old setting
                    'defaultPromptTemplate', 
                    'dataStorageOption',
                    'selectedLlmProvider', // New setting for API provider
                    'apiKey',              // New setting for API key
                    'modelName'            // New setting for optional model name
                ], async (settingsResult) => { // Made this callback async
                  if (chrome.runtime.lastError) {
                    console.error('Service Worker: Error retrieving settings:', chrome.runtime.lastError.message);
                    sendPopupStatus('Error: Could not get settings.', 80, true);
                    showNotificationIfEnabled('Configuration Error', 'Could not retrieve extension settings.');
                    isScraping = false; scrapingTabId = null;
                    // Handle data removal if necessary, similar to other error paths
                    const dataStorageOption = settingsResult.dataStorageOption || 'persistent';
                    if (dataStorageOption === 'persistent') chrome.storage.local.remove('redditThreadData');
                    else if (dataStorageOption === 'sessionOnly') chrome.storage.session.remove('redditThreadData');
                    return;
                  }

                  // let aiConfig = settingsResult.selectedAiModelConfig; // Old
                  // let aiKey = settingsResult.selectedAiModelKey; // Old
                  const userPromptTemplate = settingsResult.defaultPromptTemplate;
                  const dataStorageOption = settingsResult.dataStorageOption || 'persistent'; 
                  // let defaultedAi = false; // Old

                  // const DEFAULT_MODEL_KEY = 'aistudio'; // Old
                  const DEFAULT_PROMPT_TEMPLATE = "Scraped Content:\n\n{content}";
                  // const localAiModels = { // Old - related to tab opening and pasting
                  //     gemini: { name: "Gemini", url: "https://gemini.google.com/app", inputSelector: "rich-textarea div[contenteditable='true']" },
                  //     chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/", inputSelector: "#prompt-textarea" },
                  //     claude: { name: "Claude", url: "https://claude.ai/new", inputSelector: "div.ProseMirror[contenteditable='true']" },
                  //     aistudio: { name: "AI Studio", url: "https://aistudio.google.com/prompts/new_chat", inputSelector: "textarea[aria-label*='Type something']" }
                  // };

                  // New API settings
                  const DEFAULT_LLM_PROVIDER = 'openai'; // Default provider
                  const provider = settingsResult.selectedLlmProvider || DEFAULT_LLM_PROVIDER;
                  const apiKey = settingsResult.apiKey;
                  const modelName = settingsResult.modelName; // User-specified model name, can be empty

                  // Ensure the most current inputSelector from localAiModels is used if different from storage
                  // if (aiKey && localAiModels[aiKey] && aiConfig && aiConfig.inputSelector !== localAiModels[aiKey].inputSelector) {
                  //   console.warn(`Service Worker: Stored inputSelector for '${aiKey}' ("${aiConfig.inputSelector}") differs from local definition ("${localAiModels[aiKey].inputSelector}"). Updating.`);
                  //   aiConfig.inputSelector = localAiModels[aiKey].inputSelector; // Update in-memory config
                  //   // Also update the configuration in storage to persist the correction
                  //   chrome.storage.sync.set({ selectedAiModelConfig: aiConfig }, () => {
                  //       console.log(`Service Worker: Corrected inputSelector for key '${aiKey}' has been saved to storage.`);
                  //   });
                  // }

                  // if (!aiConfig || !aiConfig.url || !aiConfig.inputSelector || !aiKey || !localAiModels[aiKey]) {
                  //   console.warn('Service Worker: Invalid or missing AI configuration from storage. Attempting to recover or default.', 'Retrieved Key:', aiKey, 'Retrieved Config:', aiConfig);
                    
                  //   if (aiKey && localAiModels[aiKey] && (!aiConfig || !aiConfig.url || !aiConfig.inputSelector)) {
                  //       console.log(`Service Worker: Key '${aiKey}' is valid but config object is missing/invalid. Using fresh config for '${aiKey}'.`);
                  //       aiConfig = localAiModels[aiKey];
                  //       chrome.storage.sync.set({ selectedAiModelConfig: aiConfig }, () => {
                  //           console.log(`Service Worker: Corrected AI config for key '${aiKey}' saved to storage.`);
                  //       });
                  //   } else {
                  //       console.log('Service Worker: Cannot recover from stored key. Defaulting to AI Studio.');
                  //       aiKey = DEFAULT_MODEL_KEY;
                  //       aiConfig = localAiModels[DEFAULT_MODEL_KEY];
                  //       defaultedAi = true;
                  //       sendPopupStatus(`AI Config error. Defaulted to ${aiConfig.name}. Check options.`, 80, true);
                  //       showNotificationIfEnabled('Configuration Warning', `AI settings error. Defaulted to ${aiConfig.name}. Please check options.`);
                  //       chrome.storage.sync.set({ selectedAiModelKey: aiKey, selectedAiModelConfig: aiConfig }, () => {
                  //           console.log('Service Worker: Saved default AI (AI Studio) config to storage.');
                  //       });
                  //   }
                  // }
                  
                  // --- Apply Prompt Template ---
                  // Assuming processedData contains the structured data object (not stringified yet for flexibility)
                  // For simplicity, let's assume we need a string representation for the template.
                  // This might be a good place to create a simple text representation if not already done.
                  // For now, let's assume processedData.post.title and processedData.comments exist and are strings/arrays.
                  // A more robust solution would be to have a dedicated function to format processedData to string.
                  let textForAI = `Title: ${processedData.post?.title || 'N/A'}\n\nPost Body: ${processedData.post?.selftext || 'N/A'}\n\n`;
                  if (processedData.post?.imageUrls && processedData.post.imageUrls.length > 0) {
                    textForAI += `Post Images: ${processedData.post.imageUrls.join(', ')}\n\n`;
                  }
                  if (processedData.post?.imageDataUrls && processedData.post.imageDataUrls.length > 0) {
                      textForAI += `(Post has ${processedData.post.imageDataUrls.length} image(s) attached)\n\n`;
                  }
                  textForAI += "Comments:\n";
                  let commentIndex = 1;
                  processedData.comments.forEach(comment => {
                    textForAI += `${commentIndex}. ${comment.author}: ${comment.body.replace(/\n/g, ' ')}\n`; // Basic formatting
                    commentIndex++;
                  });
                  // Limit length if necessary, though AI platforms handle large inputs
                  const MAX_LENGTH = 30000; // Example limit
                  if (textForAI.length > MAX_LENGTH) {
                    textForAI = textForAI.substring(0, MAX_LENGTH - "... (truncated)".length) + "... (truncated)";
                  }

                  let finalContentToPaste = textForAI; // This variable name is kept for now, but it's content for API
                  const templateToUse = userPromptTemplate || DEFAULT_PROMPT_TEMPLATE;

                  if (templateToUse && typeof templateToUse === 'string') {
                    if (templateToUse.includes('{content}')) {
                      finalContentToPaste = templateToUse.replace('{content}', textForAI);
                      console.log('Service Worker: Applied user-defined prompt template.');
                    } else {
                      // Fallback: if {content} is missing, prepend template to content. Or consider warning.
                      finalContentToPaste = templateToUse + "\n\n" + textForAI;
                      console.warn('Service Worker: User-defined prompt template does not contain "{content}" placeholder. Appending content to template.');
                      showNotificationIfEnabled('Prompt Template Warning', 'Your custom prompt template was used, but it was missing the {content} placeholder. The Reddit content was appended.');
                    }
                  } else {
                      // This case should ideally not happen if options.js saves a default.
                      // But as a fallback, use the basic textForAI.
                      console.log('Service Worker: No prompt template found or template is invalid. Using raw scraped content.');
                  }
                  // Now, finalContentToPaste is ready for the API.
                  
                  // --- Data Storage Logic & API Call ---
                  const processWithApi = async () => {
                    if (!apiKey) {
                        console.error('Service Worker: API key not found. Please configure it in options.');
                        sendPopupStatus('Error: API key missing. Check options.', -1, true);
                        showNotificationIfEnabled('API Key Error', 'API key is missing. Please set it in the extension options.');
                        isScraping = false; scrapingTabId = null;
                        // Handle data removal based on storage option
                        if (dataStorageOption === 'persistent') chrome.storage.local.remove('redditThreadData');
                        else if (dataStorageOption === 'sessionOnly') chrome.storage.session.remove('redditThreadData');
                        return;
                    }
                    sendPopupStatus('Preparing summary request...', 80, false);

                    let apiUrl = '';
                    let headers = {};
                    let body = {};

                    if (provider === 'openai') {
                        apiUrl = 'https://api.openai.com/v1/chat/completions';
                        headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
                        body = JSON.stringify({ model: modelName || 'gpt-3.5-turbo', messages: [{ role: 'user', content: finalContentToPaste }] });
                    } else if (provider === 'gemini') {
                        apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName || 'gemini-1.5-flash-latest'}:generateContent?key=${apiKey}`;
                        headers = { 'Content-Type': 'application/json' };
                        body = JSON.stringify({ contents: [{ parts: [{ text: finalContentToPaste }] }] });
                    } else {
                        console.error('Service Worker: Unknown LLM provider selected:', provider);
                        sendPopupStatus(`Error: Unknown LLM provider: ${provider}`, -1, true);
                        showNotificationIfEnabled('Configuration Error', `Unknown LLM provider selected: ${provider}. Check options.`);
                        isScraping = false; scrapingTabId = null;
                        if (dataStorageOption === 'persistent') chrome.storage.local.remove('redditThreadData');
                        else if (dataStorageOption === 'sessionOnly') chrome.storage.session.remove('redditThreadData');
                        return;
                    }

                    try {
                        sendPopupStatus(`Sending request to ${provider} API...`, 85, false);
                        const response = await fetch(apiUrl, { method: 'POST', headers: headers, body: body });

                        if (!response.ok) {
                            const errorBodyText = await response.text();
                            console.error(`Service Worker: API request to ${provider} failed with status ${response.status}:`, errorBodyText);
                            sendPopupStatus(`Error: API request failed (${response.status}). Check console.`, -1, true);
                            showNotificationIfEnabled('API Request Error', `Request to ${provider} failed: ${response.status}. Details in console.`);
                            throw new Error(`API request failed: ${response.status}`);
                        }

                        const data = await response.json();
                        let summaryText = '';

                        if (provider === 'openai') {
                            summaryText = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '[No summary found in OpenAI response]';
                        } else if (provider === 'gemini') {
                            summaryText = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] ? data.candidates[0].content.parts[0].text : '[No summary found in Gemini response]';
                            if (!summaryText && data.promptFeedback && data.promptFeedback.blockReason) {
                                summaryText = `[Content blocked by Gemini API due to: ${data.promptFeedback.blockReason}]`;
                                console.warn("Gemini API blocked content:", data.promptFeedback);
                            }
                        }

                        console.log(`Service Worker: Summary received from ${provider}:`, summaryText.substring(0, 200) + "...");
                        sendPopupStatus('Summary received!', 95, false);
                        showNotificationIfEnabled(
                            `${provider} Summary Ready`,
                            summaryText.length > 200 ? summaryText.substring(0, 197) + "..." : summaryText,
                            `summary-${provider}-${Date.now()}`
                        );
                        sendPopupStatus('Summarization complete!', 100, true);

                    } catch (error) {
                        console.error(`Service Worker: Error during API call to ${provider}:`, error);
                        // Avoid double notification for API key missing if already handled.
                        if (!String(error.message).toLowerCase().includes("api key missing") && !String(error.message).includes("failed to fetch")) {
                             // For "failed to fetch", it's often a CORS or network issue, or misconfigured URL.
                             // The earlier API key check should catch missing keys.
                             showNotificationIfEnabled('API Error', `Could not get summary from ${provider}. ${error.message}`);
                        }
                        sendPopupStatus(`Error: ${error.message || 'API call failed.'}`, -1, true);
                    } finally {
                        // Cleanup based on dataStorageOption (already retrieved as settingsResult.dataStorageOption)
                        if (dataStorageOption === 'persistent') {
                            chrome.storage.local.remove('redditThreadData', () => {
                                console.log('Service Worker: redditThreadData removed from local storage after API attempt (persistent mode).');
                            });
                        } else if (dataStorageOption === 'sessionOnly') {
                            chrome.storage.session.remove('redditThreadData', () => {
                                console.log('Service Worker: redditThreadData removed from session storage after API attempt (sessionOnly mode).');
                            });
                        }
                        isScraping = false;
                        scrapingTabId = null;
                        console.log('Service Worker: Scraping & summarization process complete/ended. isScraping set to false.');
                    }
                  };
                  
                  // Call processWithApi after data storage handling
                  if (dataStorageOption === 'dontSave') {
                    console.log('Service Worker: Data storage option is "dontSave". Data will not be saved to any storage.');
                    // Ensure no old persistent data is lingering if mode was switched
                    chrome.storage.local.remove('redditThreadData', () => {
                        console.log('Service Worker: Cleared any lingering redditThreadData from local storage due to "dontSave" mode.');
                        processWithApi(); // Proceed without saving to chrome.storage.local/session
                    });
                  } else if (dataStorageOption === 'sessionOnly') {
                    sendPopupStatus('Saving data to session storage...', 78, false);
                    // Ensure no old persistent data is lingering
                    chrome.storage.local.remove('redditThreadData', () => {
                        console.log('Service Worker: Cleared any lingering redditThreadData from local storage due to "sessionOnly" mode.');
                        chrome.storage.session.set({ redditThreadData: processedData }, () => { // Save original processedData
                            if (chrome.runtime.lastError) {
                                console.error('Service Worker: Error saving data to session storage:', chrome.runtime.lastError.message);
                                // sendResponse({ status: 'Error: Failed to save data to session' }); // sendResponse might not be valid here anymore
                                sendPopupStatus('Error: Failed to save data to session.', 78, true);
                                showNotificationIfEnabled('Storage Error', 'Failed to save scraped data to session storage.');
                                isScraping = false; scrapingTabId = null;
                                return;
                            }
                            console.log('Service Worker: Scraped data stored in chrome.storage.session.');
                            processWithApi();
                        });
                    });
                  } else { // 'persistent' or default
                    sendPopupStatus('Saving data to persistent local storage...', 78, false);
                    chrome.storage.local.set({ redditThreadData: processedData }, () => { // Save original processedData
                        if (chrome.runtime.lastError) {
                            console.error('Service Worker: Error saving data to local storage:', chrome.runtime.lastError.message);
                            // sendResponse({ status: 'Error: Failed to save data' });
                            sendPopupStatus('Error: Failed to save data.', 78, true);
                            showNotificationIfEnabled('Storage Error', 'Failed to save scraped data to local storage.');
                            isScraping = false; scrapingTabId = null;
                            return;
                        }
                        console.log('Service Worker: Scraped data stored in chrome.storage.local.');
                        processWithApi();
                    });
                  }
                }); // This closes chrome.storage.sync.get for settings
              }); // This closes chrome.storage.local.set for redditThreadData (or session.set)
            } else { // This 'else' is for: if (scrapeResponse && scrapeResponse.data)
              console.error('Service Worker: No data received from redditScraper.js or scrapeResponse was falsy', scrapeResponse);
              sendResponse({ status: 'Error: No data from scraper' }); // This sendResponse is for scrapeReddit message to content script
              sendPopupStatus('Error: No data received from scraper.', 70, true);
              showNotificationIfEnabled('Scraping Error', 'No data was received from the Reddit page scraper.');
              isScraping = false; scrapingTabId = null;
            }
          }); // This closes chrome.tabs.sendMessage to content script (scrapeReddit action)
        }); // This closes chrome.scripting.executeScript (injecting redditScraper.js)
      }); // This closes chrome.tabs.query (getting active tab)
    } catch (e) { // This catch is for the main try block of scrapeReddit handler
        console.error("Service Worker: Uncaught error in scrapeReddit handler", e);
        sendPopupStatus('Critical error in service worker.', -1, true);
        showNotificationIfEnabled('Critical Extension Error', 'An unexpected error occurred. Please try again or check console.');
        isScraping = false; // Fallback reset
        scrapingTabId = null;
        // Attempt to send a response if the port is still open
        try {
            sendResponse({ status: 'Error: Internal Server Worker Error' }); // This sendResponse is for the initial 'scrapeReddit' message from popup
        } catch (sendErr) {
            console.error("Service Worker: Failed to send error response after uncaught exception", sendErr);
        }
    }
    return true; // Indicates that the response will be sent asynchronously for the 'scrapeReddit' message from popup
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
