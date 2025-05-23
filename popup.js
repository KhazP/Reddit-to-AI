// Placeholder for popup.js
// This script will handle user interactions in popup.html

document.addEventListener('DOMContentLoaded', () => {
  const scrapeBtn = document.getElementById('scrapeBtn');
  const stopScrapeBtn = document.getElementById('stopScrapeBtn'); // New button
  const includeHiddenToggle = document.getElementById('includeHiddenToggle');
  const statusDisplay = document.getElementById('statusDisplay');
  const progressBarContainer = document.getElementById('progressBarContainer');
  const progressBar = document.getElementById('progressBar');
  const optionsBtn = document.getElementById('optionsBtn');
  // Assuming statusIndicator is the text part of your status indicator
  const statusIndicatorText = document.getElementById('statusIndicator'); 

  // New element references
  const summaryDisplayPopup = document.getElementById('summaryDisplayPopup');
  const summaryTextPopup = document.getElementById('summaryTextPopup');
  const errorDisplayPopup = document.getElementById('errorDisplayPopup');
  const errorTextPopup = document.getElementById('errorTextPopup');

  // let isStopping = false; // This flag might become part of the service worker's state

  // Function to update status indicator text and class (can be integrated or kept)
  function updateStatusIndicator(text, className) {
    if (statusIndicatorText) { // Use the specific text element
      statusIndicatorText.textContent = text;
      // Assuming className is just 'active', 'scraping', 'error', 'idle'
      // The base class 'status-indicator' should be on the HTML element.
      // statusIndicatorText.className = 'status-indicator ' + className;
      // For simplicity, let's assume the CSS handles the visual state based on text or a data-attribute if needed
      // For now, just updating text. Visual class might be managed by renderPopupState directly on the container.
    }
  }

  function renderPopupState(state) {
    if (!state) {
        console.warn("renderPopupState called with undefined state.");
        statusDisplay.textContent = "State unavailable.";
        return;
    }
    console.log("Popup: Rendering state:", state);

    // Status Message & Progress Bar
    statusDisplay.textContent = state.message || "Awaiting status...";

    if (state.percentage !== undefined && state.percentage >= 0 && state.isActive) {
        progressBarContainer.style.display = 'block';
        progressBar.style.width = state.percentage + '%';
        progressBar.textContent = state.percentage + '%';
        progressBar.style.backgroundColor = '#4CAF50'; // Green
    } else if (state.error && state.isActive) { // Error during active scraping
        progressBarContainer.style.display = 'block';
        progressBar.style.width = '100%';
        progressBar.textContent = 'Error';
        progressBar.style.backgroundColor = '#dc3545'; // Red
    } else {
        progressBarContainer.style.display = 'none';
    }
    
    // Button States & Status Indicator Text
    if (state.isActive) {
        scrapeBtn.disabled = true;
        scrapeBtn.style.display = 'none';
        stopScrapeBtn.disabled = false;
        stopScrapeBtn.style.display = 'block';
        updateStatusIndicator('Scraping', 'scraping'); // Or use state.message for indicator text too
        if (statusIndicatorText) statusIndicatorText.textContent = 'Scraping';
    } else {
        scrapeBtn.disabled = false;
        scrapeBtn.style.display = 'block';
        stopScrapeBtn.disabled = true;
        stopScrapeBtn.style.display = 'none';
        if (state.error) {
            if (statusIndicatorText) statusIndicatorText.textContent = 'Error';
            // updateStatusIndicator('Error', 'error');
        } else if (state.summary) {
            if (statusIndicatorText) statusIndicatorText.textContent = 'Done';
            // updateStatusIndicator('Done', 'active'); 
        } else {
            if (statusIndicatorText) statusIndicatorText.textContent = 'Active';
            // updateStatusIndicator('Active', 'active');
        }
    }

    // Summary/Error Display
    summaryDisplayPopup.style.display = 'none';
    errorDisplayPopup.style.display = 'none';

    if (state.error) {
        errorTextPopup.textContent = state.error;
        errorDisplayPopup.style.display = 'block';
    } else if (state.summary && !state.isActive) { // Show summary only if not active
        summaryTextPopup.textContent = state.summary;
        summaryDisplayPopup.style.display = 'block';
    }

    // If not active and no error/summary, ensure progress bar is hidden (covered by above logic)
    if (!state.isActive && !state.error && !state.summary) {
        progressBarContainer.style.display = 'none';
        // statusDisplay.textContent = "Ready to scrape."; // Or use state.message which should be "Ready to scrape"
        if (statusIndicatorText) statusIndicatorText.textContent = 'Active';
    }
}


  if (scrapeBtn) {
    scrapeBtn.addEventListener('click', () => {
      // Update UI immediately for responsiveness, then let state updates take over
      renderPopupState({ isActive: true, message: 'Initiating scraping...', percentage: 0, error: null, summary: null });
      
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        if (currentTab) {
          chrome.runtime.sendMessage(
            { 
              action: 'scrapeReddit', 
              includeHidden: includeHiddenToggle.checked 
            },
            (response) => { // This initial response might not be needed if we rely on broadcasted state
              if (chrome.runtime.lastError) {
                console.error('Error sending scrapeReddit message:', chrome.runtime.lastError.message);
                renderPopupState({ 
                    isActive: false, 
                    message: `Error: ${chrome.runtime.lastError.message}`, 
                    percentage: -1, 
                    error: chrome.runtime.lastError.message, 
                    summary: null 
                });
                return;
              }
              if (response && response.currentState) {
                console.log('Service worker responded to initial scrapeReddit call with state:', response.currentState);
                renderPopupState(response.currentState);
              } else if (response && response.error) {
                 console.error('Service worker responded to initial scrapeReddit call with an error:', response.error);
                 renderPopupState({ isActive: false, message: `Error: ${response.error}`, percentage: -1, error: response.error, summary: null });
              }
            }
          );
        } else {
          renderPopupState({ isActive: false, message: 'Error: Unable to retrieve current tab.', percentage: -1, error: 'Could not get current tab.', summary: null });
        }
      });
    });
  }

  if (stopScrapeBtn) {
    stopScrapeBtn.addEventListener('click', () => {
      // Update UI immediately
      renderPopupState({ isActive: true, message: 'Attempting to stop scraping...', percentage: progressBar.style.width.replace('%',''), error: null, summary: null }); // Keep current progress visually
      stopScrapeBtn.disabled = true; // Disable immediately

      chrome.runtime.sendMessage({ action: 'stopScraping' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending stopScraping message:', chrome.runtime.lastError.message);
           renderPopupState({ 
               isActive: false, // Assume it stopped if error sending message, or rely on next state update
               message: `Error stopping: ${chrome.runtime.lastError.message}`, 
               percentage: -1, 
               error: chrome.runtime.lastError.message, 
               summary: null 
            });
        } else if (response && response.currentState) {
          console.log('Stop scraping response from service worker with state:', response.currentState);
          renderPopupState(response.currentState);
        }
        // Further UI updates will be handled by scrapingStateUpdate messages
      });
    });
  }

  // Listen for state updates from the service worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrapingStateUpdate') {
      console.log("Popup: Received scrapingStateUpdate:", request.data);
      renderPopupState(request.data);
    }
    // Removed old 'updateStatus' handler
    return true; 
  });

  if (optionsBtn) {
    optionsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  // Initial UI state from Service Worker
  chrome.runtime.sendMessage({ action: 'getScrapingState' }, (stateResponse) => {
    if (chrome.runtime.lastError) {
        console.error("Error getting initial state:", chrome.runtime.lastError.message);
        statusDisplay.textContent = "Could not connect to service worker. Ensure extension is enabled.";
        // Disable buttons or show minimal UI
        scrapeBtn.disabled = true;
        stopScrapeBtn.disabled = true;
        optionsBtn.disabled = true;
        return;
    }
    if (stateResponse) {
        console.log("Popup: Initial state received:", stateResponse);
        renderPopupState(stateResponse);
    } else {
        // Handle case where service worker might not be ready or state is undefined
        statusDisplay.textContent = "Service worker not responding or state unavailable.";
        // Fallback to a very basic "ready" state if no state received
        renderPopupState({ isActive: false, message: "Ready to scrape.", percentage: 0, error: null, summary: null });
    }
  });
});
