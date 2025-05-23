// service_worker.js

// --- Global State Variables ---
let scrapingState = {
    isActive: false,
    message: 'Ready to scrape.',
    percentage: 0,
    summary: null,
    error: null,
    lastScrapedTabId: null // Will store the ID of the tab where scraping is active
};

// Old flags - to be phased out or synced with scrapingState
let isScraping = false; 
let scrapingTabId = null; 
let stopRequested = false;

// --- Helper Functions ---

function broadcastScrapingState() {
    console.log("Service Worker: Broadcasting state:", scrapingState);

    // Update Popup
    chrome.runtime.sendMessage({
        action: "scrapingStateUpdate",
        data: scrapingState
    }, (response) => {
        if (chrome.runtime.lastError) {
            // console.log('Popup status update error (normal if popup is closed):', chrome.runtime.lastError.message);
        }
    });

    // Update Floating Panel (if active and tab ID is known)
    if (scrapingState.lastScrapedTabId) {
        chrome.tabs.sendMessage(scrapingState.lastScrapedTabId, {
            action: "updateFloatingPanel",
            data: scrapingState
        }, (response) => {
            if (chrome.runtime.lastError) {
                // console.warn('Floating panel update error (normal if panel not ready/tab closed):', scrapingState.lastScrapedTabId, chrome.runtime.lastError.message);
            }
        }).catch(e => { /* console.warn('Catch: Floating panel update error:', e.message) */ });
    }
}


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

// Helper function to send status updates to the popup (REFACTORED/REPLACED by broadcastScrapingState)
// function sendPopupStatus(message, percentage, done = false) { 
//   const numericPercentage = (typeof percentage === 'number' && !isNaN(percentage)) ? percentage : -1;
//   chrome.runtime.sendMessage({ action: "updateStatus", message: message, percentage: numericPercentage, done: done }, (response) => {
//     if (chrome.runtime.lastError) {
//       // console.log('Popup status update error:', chrome.runtime.lastError.message);
//     }
//   });
// }

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeReddit') {
    if (scrapingState.isActive) { // Check new state flag
      console.log('Service Worker: Scraping already in progress. Ignoring new request.');
      sendResponse({ status: 'Error: Scraping already in progress', currentState: scrapingState });
      // broadcastScrapingState(); // Optionally broadcast current state again
      showNotificationIfEnabled('Scraping Busy', 'A scraping process is already in progress.');
      return false; 
    }
    
    // isScraping = true; // Old flag
    // stopRequested = false; // Old flag
    // scrapingTabId = null; // Old flag
    
    console.log('Service Worker: Received scrapeReddit message from popup. Starting scrape.');
    console.log('Service Worker: Include hidden comments:', request.includeHidden);
    showNotificationIfEnabled('Reddit AI Tool', 'Scraping process initiated.');

    // Wrap the core logic in a try...finally to ensure scrapingState.isActive is reset
    try {
      scrapingState.isActive = true; // Set early in the process
      scrapingState.message = 'Querying active tab...';
      scrapingState.percentage = 5;
      scrapingState.summary = null;
      scrapingState.error = null;
      // lastScrapedTabId will be set after tab query
      broadcastScrapingState();

      // 1. Get current active tab (should be a Reddit tab)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        // Sync old flags for compatibility if needed, or remove them entirely later
        isScraping = scrapingState.isActive; 
        stopRequested = false; // Reset this conceptual flag

        if (stopRequested) { // Check conceptual flag, or transition to checking scrapingState.userRequestedStop
          console.log("Service Worker: Stop requested before tab query completed.");
          scrapingState.isActive = false;
          scrapingState.message = 'Scraping stopped by user.';
          scrapingState.percentage = -1;
          scrapingState.error = 'User initiated stop before tab query.';
          broadcastScrapingState();
          showNotificationIfEnabled('Scraping Halted', 'Scraping stopped by user request.');
          sendResponse({ status: 'Scraping stopped', currentState: scrapingState });
          return;
        }
        if (tabs.length === 0) {
          console.error('Service Worker: No active tab found.');
          scrapingState.isActive = false;
          scrapingState.message = 'Error: No active tab found.';
          scrapingState.percentage = -1;
          scrapingState.error = 'No active tab found.';
          broadcastScrapingState();
          showNotificationIfEnabled('Scraping Error', 'No active tab found. Please open a Reddit page.');
          sendResponse({ status: 'Error: No active tab', currentState: scrapingState });
          return;
        }
        const activeTab = tabs[0];
        scrapingState.lastScrapedTabId = activeTab.id; // Set the tab ID
        // scrapingTabId = activeTab.id; // Sync old flag

        scrapingState.message = 'Checking if active tab is Reddit...';
        scrapingState.percentage = 10;
        broadcastScrapingState();

        if (stopRequested) { 
          console.log("Service Worker: Stop requested before Reddit page check.");
          scrapingState.isActive = false;
          scrapingState.message = 'Scraping stopped by user.';
          scrapingState.percentage = -1;
          scrapingState.error = 'User initiated stop before page check.';
          broadcastScrapingState();
          showNotificationIfEnabled('Scraping Halted', 'Scraping stopped by user request.');
          sendResponse({ status: 'Scraping stopped', currentState: scrapingState });
          return;
        }

        if (!activeTab.url || !activeTab.url.includes('reddit.com')) {
          console.error('Service Worker: Active tab is not a Reddit page.');
          scrapingState.isActive = false;
          scrapingState.message = 'Error: Active tab is not a Reddit page.';
          scrapingState.percentage = -1;
          scrapingState.error = 'Active tab is not a Reddit page.';
          broadcastScrapingState();
          showNotificationIfEnabled('Reddit AI Tool Error', 'Please navigate to a Reddit thread page to use this extension.');
          sendResponse({ status: 'Error: Not a Reddit page', currentState: scrapingState });
          return;
        }

        if (stopRequested) { 
          console.log("Service Worker: Stop requested before script injection.");
          scrapingState.isActive = false;
          scrapingState.message = 'Scraping stopped by user.';
          scrapingState.percentage = -1;
          scrapingState.error = 'User initiated stop before script injection.';
          broadcastScrapingState();
          showNotificationIfEnabled('Scraping Halted', 'Scraping stopped by user request.');
          sendResponse({ status: 'Scraping stopped', currentState: scrapingState });
          return;
        }

        console.log('Service Worker: Active tab is:', activeTab.url);
        
        // Inject Floating Panel CSS & JS first
        (async () => {
            try {
                console.log("Service Worker: Attempting to inject floatingPanel.css");
                await chrome.scripting.insertCSS({
                    target: { tabId: activeTab.id },
                    files: ['floatingPanel.css']
                });
                console.log("Service Worker: floatingPanel.css injected successfully.");
            } catch (err) {
                console.error("Service Worker: Failed to insert floatingPanel.css. This might happen on special pages.", err);
            }

            try {
                console.log("Service Worker: Attempting to execute floatingPanel.js");
                await chrome.scripting.executeScript({
                    target: { tabId: activeTab.id },
                    files: ['floatingPanel.js']
                });
                console.log("Service Worker: floatingPanel.js executed successfully.");
            } catch (err) {
                console.error("Service Worker: Failed to execute floatingPanel.js. This might happen on special pages.", err);
            }

            // Now update state and proceed with scraper injection
            scrapingState.message = 'Injecting scraper into Reddit page...';
            scrapingState.percentage = 15;
            broadcastScrapingState(); // Broadcast after panel is potentially ready

            // 2. Inject redditScraper.js into the active Reddit tab
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ['redditScraper.js']
            }, (injectionResults) => {
              if (chrome.runtime.lastError || !injectionResults || injectionResults.length === 0) {
                console.error('Service Worker: Failed to inject redditScraper.js', chrome.runtime.lastError?.message);
            scrapingState.isActive = false;
            scrapingState.message = 'Error: Failed to inject scraper.';
            scrapingState.percentage = -1;
            scrapingState.error = 'Failed to inject scraper: ' + (chrome.runtime.lastError?.message || 'Unknown error');
            broadcastScrapingState();
            showNotificationIfEnabled('Scraping Error', 'Failed to inject the Reddit scraper script.');
            sendResponse({ status: 'Error: Failed to inject scraper', currentState: scrapingState });
            return;
          }

          if (stopRequested) { 
            console.log("Service Worker: Stop requested after script injection, before sending scrape command.");
            if (scrapingState.lastScrapedTabId) { // Use new state variable
                chrome.tabs.sendMessage(scrapingState.lastScrapedTabId, { action: 'cancelScraping' }).catch(e => console.warn("Error sending cancel to content script (might be normal if not fully loaded):", e.message));
            }
            scrapingState.isActive = false;
            scrapingState.message = 'Scraping stopped by user.';
            scrapingState.percentage = -1;
            scrapingState.error = 'User initiated stop after script injection.';
            broadcastScrapingState();
            showNotificationIfEnabled('Scraping Halted', 'Scraping stopped by user request.');
            sendResponse({ status: 'Scraping stopped', currentState: scrapingState });
            return;
          }

          console.log('Service Worker: redditScraper.js injected. Now sending scrape command.');
          scrapingState.message = 'Scraper injected. Collecting data from page...';
          scrapingState.percentage = 20;
          broadcastScrapingState();
          
          // 3. Send a message to the injected script to start scraping, passing options
          chrome.tabs.sendMessage(activeTab.id, {
            action: 'scrapeReddit',
            includeHidden: request.includeHidden
          }, async (scrapeResponse) => { // Make the callback async
            if (chrome.runtime.lastError) {
              if (stopRequested) {
                console.log('Service Worker: Error receiving data from redditScraper, likely due to stop request and script unload/tab closure.', chrome.runtime.lastError.message);
                scrapingState.message = 'Scraping stopped by user (communication error).';
                scrapingState.error = 'User stop led to communication error with content script.';
              } else {
                console.error('Service Worker: Error receiving data from redditScraper:', chrome.runtime.lastError.message);
                scrapingState.message = 'Error: Scraping failed on page.';
                scrapingState.error = 'Scraping failed on page: ' + chrome.runtime.lastError.message;
              }
              scrapingState.isActive = false;
              scrapingState.percentage = -1;
              broadcastScrapingState();
              showNotificationIfEnabled('Scraping Halted', scrapingState.message);
              sendResponse({ status: 'Error: Scraping failed or stopped', currentState: scrapingState });
              return;
            }

            if (stopRequested && (!scrapeResponse || scrapeResponse.status !== 'cancelled')) {
                console.log("Service Worker: Stop was requested during scraping. ScrapeResponse:", scrapeResponse);
                scrapingState.isActive = false;
                scrapingState.message = 'Scraping stopped by user during data collection.';
                scrapingState.percentage = -1;
                scrapingState.error = 'User initiated stop during data collection.';
                broadcastScrapingState();
                showNotificationIfEnabled('Scraping Halted', 'Scraping stopped by user during data collection.');
                chrome.storage.local.remove('redditThreadData', () => {
                    console.log('Service Worker: redditThreadData removed due to stop request during scraping.');
                });
                sendResponse({ status: 'Scraping stopped', currentState: scrapingState });
                return;
            }

            if (scrapeResponse && scrapeResponse.status === 'cancelled') {
                console.log('Service Worker: Scraping was cancelled by content script.');
                scrapingState.isActive = false;
                scrapingState.message = 'Scraping cancelled by user on page.';
                scrapingState.percentage = -1;
                scrapingState.error = 'Scraping cancelled on page by user.';
                broadcastScrapingState();
                showNotificationIfEnabled('Scraping Cancelled', 'Scraping was cancelled on the page.');
                chrome.storage.local.remove('redditThreadData', () => {
                    console.log('Service Worker: redditThreadData removed as scraping was cancelled.');
                });
                sendResponse({ status: 'Scraping cancelled', currentState: scrapingState });
                return;
            }

            if (scrapeResponse && scrapeResponse.data) {
              console.log('Service Worker: Received scraped data from redditScraper.js');
              
              let processedData = scrapeResponse.data;
              // --- BEGIN IMAGE FETCHING AND CONVERSION (FOR MULTIPLE IMAGES) ---
              if (processedData.post && processedData.post.imageUrls && Array.isArray(processedData.post.imageUrls) && processedData.post.imageUrls.length > 0) {
                scrapingState.message = 'Processing post image(s)...';
                scrapingState.percentage = 72;
                broadcastScrapingState();
                
                const imageDataUrlsArray = [];
                let imageCount = processedData.post.imageUrls.length;
                let imagesProcessed = 0;

                for (const imageUrl of processedData.post.imageUrls) {
                  try {
                    const absoluteImageUrl = new URL(imageUrl, activeTab.url).href;
                    console.log('Service Worker: Fetching image data for:', absoluteImageUrl);
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
                      console.log('Service Worker: Image converted to dataURL:', absoluteImageUrl);
                    } else {
                      console.warn('Service Worker: Fetched resource is not a processable image type:', blob.type, absoluteImageUrl);
                    }
                  } catch (error) {
                    console.error('Service Worker: Error fetching or processing an image:', error.message);
                  }
                  imagesProcessed++;
                  scrapingState.message = `Processing image ${imagesProcessed}/${imageCount}...`;
                  scrapingState.percentage = 72 + Math.floor((imagesProcessed / imageCount) * 3);
                  broadcastScrapingState();
                }

                if (imageDataUrlsArray.length > 0) {
                  processedData.post.imageDataUrls = imageDataUrlsArray;
                  console.log(`Service Worker: ${imageDataUrlsArray.length} image(s) converted to dataURLs.`);
                } else {
                  processedData.post.imageDataUrls = [];
                  console.log('Service Worker: No images were successfully converted to dataURLs.');
                }
              } else {
                processedData.post.imageDataUrls = [];
              }
              // --- END IMAGE FETCHING AND CONVERSION ---
              
              scrapingState.message = 'Data collection finished. Storing data...';
              scrapingState.percentage = 75;
              broadcastScrapingState();

              // 4. Store data in chrome.storage.local
              chrome.storage.local.set({ redditThreadData: processedData }, () => {
                if (chrome.runtime.lastError) {
                  console.error('Service Worker: Error saving data to storage:', chrome.runtime.lastError.message);
                  scrapingState.isActive = false;
                  scrapingState.message = 'Error: Failed to save data.';
                  scrapingState.percentage = -1;
                  scrapingState.error = 'Failed to save scraped data: ' + chrome.runtime.lastError.message;
                  broadcastScrapingState();
                  showNotificationIfEnabled('Storage Error', 'Failed to save scraped data.');
                  sendResponse({ status: 'Error: Failed to save data', currentState: scrapingState });
                  return;
                }
                if (stopRequested) { 
                    console.log("Service Worker: Stop requested before initiating API call.");
                    scrapingState.isActive = false;
                    scrapingState.message = 'Scraping stopped by user before AI interaction.';
                    scrapingState.percentage = -1;
                    scrapingState.error = 'User stop before API call.';
                    broadcastScrapingState();
                    showNotificationIfEnabled('Scraping Halted', 'Scraping stopped before AI platform interaction.');
                    chrome.storage.local.remove('redditThreadData', () => {
                        console.log('Service Worker: redditThreadData removed due to stop request.');
                    });
                    sendResponse({ status: 'Scraping stopped', currentState: scrapingState });
                    return;
                }
                console.log('Service Worker: Scraped data stored in chrome.storage.local.');
                scrapingState.message = 'Data collection finished. Preparing for API call...';
                // scrapingState.percentage = 75; // Already at 75
                broadcastScrapingState();

                // 5. Retrieve ALL relevant settings
                chrome.storage.sync.get([
                    'defaultPromptTemplate', 
                    'dataStorageOption',
                    'selectedLlmProvider',
                    'apiKey',
                    'modelName'
                ], async (settingsResult) => {
                  if (chrome.runtime.lastError) {
                    console.error('Service Worker: Error retrieving settings:', chrome.runtime.lastError.message);
                    scrapingState.isActive = false;
                    scrapingState.message = 'Error: Could not get settings.';
                    scrapingState.percentage = -1;
                    scrapingState.error = 'Could not retrieve settings: ' + chrome.runtime.lastError.message;
                    broadcastScrapingState();
                    showNotificationIfEnabled('Configuration Error', 'Could not retrieve extension settings.');
                    const dataStorageOption = settingsResult.dataStorageOption || 'persistent';
                    if (dataStorageOption === 'persistent') chrome.storage.local.remove('redditThreadData');
                    else if (dataStorageOption === 'sessionOnly') chrome.storage.session.remove('redditThreadData');
                    return;
                  }

                  const userPromptTemplate = settingsResult.defaultPromptTemplate;
                  const dataStorageOption = settingsResult.dataStorageOption || 'persistent'; 
                  const DEFAULT_PROMPT_TEMPLATE = "Scraped Content:\n\n{content}";
                  const DEFAULT_LLM_PROVIDER = 'openai';
                  const provider = settingsResult.selectedLlmProvider || DEFAULT_LLM_PROVIDER;
                  const apiKey = settingsResult.apiKey;
                  const modelName = settingsResult.modelName;
                  
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
                    if (comment && comment.text && typeof comment.text === 'string') {
                        const author = (comment.author && typeof comment.author === 'string') ? comment.author : '[unknown author]';
                        textForAI += `${commentIndex}. ${author}: ${comment.text.replace(/\n/g, ' ')}\n`;
                    } else if (comment) {
                        const author = (comment.author && typeof comment.author === 'string') ? comment.author : '[unknown author]';
                        textForAI += `${commentIndex}. ${author}: [Comment text not available or in unexpected format]\n`;
                        console.warn('Encountered a comment with missing or non-string text property:', comment);
                    } else {
                        textForAI += `${commentIndex}. [Invalid comment object found]\n`;
                        console.warn('Encountered a null or undefined comment object in processedData.comments array at index:', commentIndex -1);
                    }
                    commentIndex++;
                  });
                  const MAX_LENGTH = 30000;
                  if (textForAI.length > MAX_LENGTH) {
                    textForAI = textForAI.substring(0, MAX_LENGTH - "... (truncated)".length) + "... (truncated)";
                  }

                  let finalContentToPaste = textForAI;
                  const templateToUse = userPromptTemplate || DEFAULT_PROMPT_TEMPLATE;

                  if (templateToUse && typeof templateToUse === 'string') {
                    if (templateToUse.includes('{content}')) {
                      finalContentToPaste = templateToUse.replace('{content}', textForAI);
                      console.log('Service Worker: Applied user-defined prompt template.');
                    } else {
                      finalContentToPaste = templateToUse + "\n\n" + textForAI;
                      console.warn('Service Worker: User-defined prompt template does not contain "{content}" placeholder. Appending content to template.');
                      showNotificationIfEnabled('Prompt Template Warning', 'Your custom prompt template was used, but it was missing the {content} placeholder. The Reddit content was appended.');
                    }
                  } else {
                      console.log('Service Worker: No prompt template found or template is invalid. Using raw scraped content.');
                  }
                  
                  const processWithApi = async () => {
                    if (!apiKey) {
                        console.error('Service Worker: API key not found. Please configure it in options.');
                        scrapingState.isActive = false;
                        scrapingState.message = 'Error: API key missing. Check options.';
                        scrapingState.percentage = -1;
                        scrapingState.error = 'API key missing.';
                        broadcastScrapingState();
                        showNotificationIfEnabled('API Key Error', 'API key is missing. Please set it in the extension options.');
                        if (dataStorageOption === 'persistent') chrome.storage.local.remove('redditThreadData');
                        else if (dataStorageOption === 'sessionOnly') chrome.storage.session.remove('redditThreadData');
                        return;
                    }
                    scrapingState.message = 'Preparing summary request...';
                    scrapingState.percentage = 80;
                    broadcastScrapingState();

                    let apiUrl = '';
                    let headers = {};
                    let body = {};
                    let effectiveModelName = modelName;

                    if (provider === 'openai') {
                        const defaultOpenAiModel = 'gpt-3.5-turbo';
                        if (!effectiveModelName) effectiveModelName = defaultOpenAiModel;
                        apiUrl = 'https://api.openai.com/v1/chat/completions';
                        headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
                        body = JSON.stringify({ model: effectiveModelName, messages: [{ role: 'user', content: finalContentToPaste }] });
                    } else if (provider === 'gemini') {
                        const defaultGeminiModel = 'gemini-1.5-flash-latest';
                        if (!effectiveModelName) effectiveModelName = defaultGeminiModel;
                        if (!effectiveModelName.startsWith('models/')) effectiveModelName = 'models/' + effectiveModelName;
                        apiUrl = `https://generativelanguage.googleapis.com/v1beta/${effectiveModelName}:generateContent?key=${apiKey}`;
                        headers = { 'Content-Type': 'application/json' };
                        body = JSON.stringify({ contents: [{ parts: [{ text: finalContentToPaste }] }] });
                    } else {
                        console.error('Service Worker: Unknown LLM provider selected:', provider);
                        scrapingState.isActive = false;
                        scrapingState.message = `Error: Unknown LLM provider: ${provider}`;
                        scrapingState.percentage = -1;
                        scrapingState.error = `Unknown LLM provider: ${provider}`;
                        broadcastScrapingState();
                        showNotificationIfEnabled('Configuration Error', `Unknown LLM provider selected: ${provider}. Check options.`);
                        if (dataStorageOption === 'persistent') chrome.storage.local.remove('redditThreadData');
                        else if (dataStorageOption === 'sessionOnly') chrome.storage.session.remove('redditThreadData');
                        return;
                    }
                    console.log(`Service Worker: Using effective model name: ${effectiveModelName} for provider: ${provider}`);

                    try {
                        scrapingState.message = `Sending request to ${provider} API...`;
                        scrapingState.percentage = 85;
                        broadcastScrapingState();
                        
                        const response = await fetch(apiUrl, { method: 'POST', headers: headers, body: body });

                        if (!response.ok) {
                            const errorBodyText = await response.text();
                            console.error(`Service Worker: API request to ${provider} failed with status ${response.status}:`, errorBodyText);
                            scrapingState.error = `API request failed (${response.status}): ${errorBodyText}`;
                            throw new Error(scrapingState.error);
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
                        scrapingState.summary = summaryText;
                        scrapingState.message = 'Summarization complete!';
                        scrapingState.percentage = 100;
                        scrapingState.isActive = false; // Process finished
                        broadcastScrapingState();
                        showNotificationIfEnabled(
                            `${provider} Summary Ready`,
                            summaryText.length > 200 ? summaryText.substring(0, 197) + "..." : summaryText,
                            `summary-${provider}-${Date.now()}`
                        );

                    } catch (error) {
                        console.error(`Service Worker: Error during API call to ${provider}:`, error);
                        scrapingState.isActive = false;
                        scrapingState.message = `Error: ${error.message || 'API call failed.'}`;
                        scrapingState.percentage = -1;
                        if (!scrapingState.error) scrapingState.error = error.message || 'API call failed.'; // Set error if not already set by response.ok check
                        broadcastScrapingState();
                        if (!String(error.message).toLowerCase().includes("api key missing") && !String(error.message).includes("failed to fetch")) {
                             showNotificationIfEnabled('API Error', `Could not get summary from ${provider}. ${error.message}`);
                        }
                    } finally {
                        // Ensure isActive is false and other cleanup if needed
                        if (scrapingState.isActive) { // If an unexpected exit happened before setting isActive to false
                           scrapingState.isActive = false;
                           broadcastScrapingState(); // Broadcast final state
                        }
                        isScraping = false; // Sync old flag
                        scrapingTabId = null; // Sync old flag
                        scrapingState.lastScrapedTabId = null; // Clear after process completion or failure
                        console.log('Service Worker: Scraping & summarization process complete/ended.');
                        if (dataStorageOption === 'persistent') {
                            chrome.storage.local.remove('redditThreadData', () => {
                                console.log('Service Worker: redditThreadData removed from local storage after API attempt (persistent mode).');
                            });
                        } else if (dataStorageOption === 'sessionOnly') {
                            chrome.storage.session.remove('redditThreadData', () => {
                                console.log('Service Worker: redditThreadData removed from session storage after API attempt (sessionOnly mode).');
                            });
                        }
                    }
                  };
                  
                  // Determine data storage and proceed with API call
                  if (dataStorageOption === 'dontSave') {
                    console.log('Service Worker: Data storage option is "dontSave". Data will not be saved to any storage.');
                    chrome.storage.local.remove('redditThreadData', () => { // Ensure no lingering local data
                        chrome.storage.session.remove('redditThreadData', () => { // Ensure no lingering session data
                             console.log('Service Worker: Cleared any lingering redditThreadData from local/session storage due to "dontSave" mode.');
                             processWithApi();
                        });
                    });
                  } else if (dataStorageOption === 'sessionOnly') {
                    scrapingState.message = 'Saving data to session storage...';
                    broadcastScrapingState();
                    chrome.storage.local.remove('redditThreadData', () => { // Remove from local if exists
                        console.log('Service Worker: Cleared any lingering redditThreadData from local storage due to "sessionOnly" mode.');
                        chrome.storage.session.set({ redditThreadData: processedData }, () => {
                            if (chrome.runtime.lastError) {
                                console.error('Service Worker: Error saving data to session storage:', chrome.runtime.lastError.message);
                                scrapingState.isActive = false;
                                scrapingState.message = 'Error: Failed to save data to session.';
                                scrapingState.percentage = -1;
                                scrapingState.error = 'Failed to save data to session storage: ' + chrome.runtime.lastError.message;
                                broadcastScrapingState();
                                showNotificationIfEnabled('Storage Error', 'Failed to save scraped data to session storage.');
                                return;
                            }
                            console.log('Service Worker: Scraped data stored in chrome.storage.session.');
                            processWithApi();
                        });
                    });
                  } else { // 'persistent' or default
                    scrapingState.message = 'Saving data to persistent local storage...';
                    broadcastScrapingState();
                     chrome.storage.session.remove('redditThreadData', () => { // Remove from session if exists
                        console.log('Service Worker: Cleared any lingering redditThreadData from session storage due to "persistent" mode.');
                        chrome.storage.local.set({ redditThreadData: processedData }, () => {
                            if (chrome.runtime.lastError) {
                                console.error('Service Worker: Error saving data to local storage:', chrome.runtime.lastError.message);
                                scrapingState.isActive = false;
                                scrapingState.message = 'Error: Failed to save data.';
                                scrapingState.percentage = -1;
                                scrapingState.error = 'Failed to save data to local storage: ' + chrome.runtime.lastError.message;
                                broadcastScrapingState();
                                showNotificationIfEnabled('Storage Error', 'Failed to save scraped data to local storage.');
                                return;
                            }
                            console.log('Service Worker: Scraped data stored in chrome.storage.local.');
                            processWithApi();
                        });
                    });
                  }
                }); 
              }); 
            } else { 
              console.error('Service Worker: No data received from redditScraper.js or scrapeResponse was falsy', scrapeResponse);
              scrapingState.isActive = false;
              scrapingState.message = 'Error: No data received from scraper.';
              scrapingState.percentage = -1;
              scrapingState.error = 'No data from scraper or scrapeResponse was falsy.';
              broadcastScrapingState();
              showNotificationIfEnabled('Scraping Error', 'No data was received from the Reddit page scraper.');
              sendResponse({ status: 'Error: No data from scraper', currentState: scrapingState });
            }
          }); 
        }); 
      }); 
    } catch (e) { 
        console.error("Service Worker: Uncaught error in scrapeReddit handler", e);
        scrapingState.isActive = false;
        scrapingState.message = 'Critical error in service worker.';
        scrapingState.percentage = -1;
        scrapingState.error = 'Uncaught error in service worker: ' + e.message;
        broadcastScrapingState();
        showNotificationIfEnabled('Critical Extension Error', 'An unexpected error occurred. Please try again or check console.');
        isScraping = false; // sync old flag
        scrapingTabId = null; // sync old flag
        try {
            sendResponse({ status: 'Error: Internal Server Worker Error', currentState: scrapingState });
        } catch (sendErr) {
            console.error("Service Worker: Failed to send error response after uncaught exception", sendErr);
        }
    }
    return true; 
  } else if (request.action === "stopScraping") {
    console.log("Service Worker: Received stopScraping message.");
    // if (!isScraping && !stopRequested) { // Old flags
    if (!scrapingState.isActive && !stopRequested) { // Use new state, stopRequested might still be relevant for immediate cut-off
      sendResponse({ status: "Not actively scraping or stop already in progress.", currentState: scrapingState });
      // broadcastScrapingState(); // State already reflects not active
      return false;
    }
    stopRequested = true; // Set conceptual flag for immediate effect in ongoing loops

    scrapingState.isActive = false;
    scrapingState.message = 'Scraping process halting due to user request...';
    scrapingState.error = 'User initiated stop.'; // Can be considered an error/reason for stopping
    // scrapingState.percentage = -1; // Or keep current percentage
    broadcastScrapingState();
    showNotificationIfEnabled('Scraping Halted', 'Scraping process is halting due to user request.');

    if (scrapingState.lastScrapedTabId) { // Use new state variable
      chrome.tabs.sendMessage(scrapingState.lastScrapedTabId, { action: 'cancelScraping' }, (cancelResponse) => {
        if (chrome.runtime.lastError) {
          console.warn('Service Worker: Error sending cancelScraping to content script (might have already finished, been removed, or tab closed):', chrome.runtime.lastError.message);
        }
        if (cancelResponse && cancelResponse.status) {
          console.log("Service Worker: Content script responded to cancelScraping:", cancelResponse.status);
        }
        // Final state update already broadcasted
        sendResponse({ status: "Stop signal sent. Scraping should halt.", currentState: scrapingState });
        chrome.storage.local.remove('redditThreadData', () => {
            console.log('Service Worker: redditThreadData removed due to stopScraping command.');
        });
         chrome.storage.session.remove('redditThreadData', () => {
            console.log('Service Worker: redditThreadData removed from session due to stopScraping command.');
        });
      });
    } else {
      // State already updated, just send response
      sendResponse({ status: "Scraping stopped (no active scrape tab identified).", currentState: scrapingState });
      chrome.storage.local.remove('redditThreadData');
      chrome.storage.session.remove('redditThreadData');
    }
    isScraping = false; // sync old flag
    scrapingTabId = null; // sync old flag
    return true; 
  } else if (request.action === "progressUpdate") {
    // This handler is now the primary way content script updates SW about its progress
    if (stopRequested && !(request.message && request.message.toLowerCase().includes("cancel"))) {
        console.log("Service Worker: ProgressUpdate received after stopRequested. Message:", request.message);
    }
    scrapingState.message = request.message;
    if (request.percentage !== undefined && !isNaN(request.percentage)) {
        scrapingState.percentage = request.percentage;
    }
    // Do not set isActive or error here, this is just for progress messages from content script
    broadcastScrapingState();
    sendResponse({status: "progress acknowledged by service worker"}); 
    return false; 
  } else if (request.action === 'getScrapingState') {
      sendResponse(scrapingState);
      return false; // Synchronous response
  } else if (request.action === 'notifyUser') {
    console.log('Service Worker: Received notifyUser request:', request.title, request.message);
    showNotificationIfEnabled(request.title || 'Reddit AI Tool Notification', request.message || 'You have a new notification.');
    sendResponse({ status: 'Notification request processed by service worker' });
    return false; 
  }
  return true; 
});

console.log('Service Worker: Loaded and listening for messages. Initial scrapingState:', scrapingState);
