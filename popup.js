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
  const statusIndicator = document.getElementById('statusIndicatorText');
  const statusIndicatorDot = document.getElementById('statusIndicatorDot'); // Assuming you might add a dot element

  let isStopping = false; // Flag to manage UI during stop sequence

  // Function to update status indicator text and class
  function updateStatusIndicator(text, className) {
    if (statusIndicator) {
      statusIndicator.textContent = text;
      statusIndicator.className = 'status-indicator ' + className;
    }
  }

  // Function to update status and progress bar
  function updateProgress(message, percentage = -1) {
    if (statusDisplay) {
      statusDisplay.textContent = message;
    }
    if (progressBarContainer && progressBar) {
      if (percentage >= 0 && percentage <= 100) {
        progressBarContainer.style.display = 'block';
        progressBar.style.width = percentage + '%';
        // progressBar.textContent = percentage + '%'; // Optional: show percentage text on bar
        if (percentage < 100 && percentage > 0) updateStatusIndicator('Scraping', 'scraping');
      } else if (percentage === -1 && message.toLowerCase().includes('error')) {
        // Keep progress bar visible but indicate error, or hide
        progressBar.style.width = '100%';
        progressBar.style.backgroundColor = '#dc3545'; // Red for error
        updateStatusIndicator('Error', 'error'); // Assuming you add an .error class to CSS
      } else if (percentage === -1) {
        // Hide progress bar if no specific percentage and not an error being shown on it
        // progressBarContainer.style.display = 'none'; 
        // updateStatusIndicator('Active', 'active'); // Or based on actual state
      }
    }
    console.log("Popup status:", message, "Progress:", percentage);
  }

  function resetUI() {
    scrapeBtn.disabled = false;
    scrapeBtn.style.display = 'block'; 
    stopScrapeBtn.style.display = 'none'; 
    if (progressBarContainer) progressBarContainer.style.display = 'none';
    if (statusText) statusText.textContent = 'Ready to scrape.';
    updateStatusIndicator('Active', 'active');
    isStopping = false; // Reset the stopping flag
  }

  if (scrapeBtn) {
    scrapeBtn.addEventListener('click', () => {
      updateProgress('Initiating scraping...', 0);
      updateStatusIndicator('Scraping', 'scraping'); 
      scrapeBtn.disabled = true;
      scrapeBtn.style.display = 'none'; 
      stopScrapeBtn.style.display = 'block'; 
      stopScrapeBtn.disabled = false; 
      progressBar.style.backgroundColor = '#4CAF50'; 
      isStopping = false; // Ensure isStopping is false when starting a new scrape
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        if (currentTab) {
          // Send a message to the service worker to start scraping
          chrome.runtime.sendMessage(
            { 
              action: 'scrapeReddit', 
              includeHidden: includeHiddenToggle.checked 
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error('Error sending message to service worker:', chrome.runtime.lastError.message);
                updateProgress(`Error: ${chrome.runtime.lastError.message}`, -1);
                resetUI(); // This will set status to Active
                return;
              }
              // Initial response from service worker might not be the final status
              if (response && response.status) {
                console.log('Service worker responded to initial call:', response.status);
                // Don't necessarily update progress here, wait for specific progress messages
                // updateProgress(response.status); 
              } else if (response && response.error) {
                console.error('Service worker responded to initial call with an error:', response.error);
                updateProgress(`Error: ${response.error}`, -1);
                resetUI(); // This will set status to Active
              }
              // Do not resetUI() here, wait for a 'done' message or explicit error handling above.
            }
          );
        } else {
          updateProgress('Error: Unable to retrieve the current tab.', -1);
          resetUI();
        }
      });
    });
  }

  // Event listener for the Stop Scrape button
  if (stopScrapeBtn) {
    stopScrapeBtn.addEventListener('click', () => {
      isStopping = true; // Set the stopping flag
      updateProgress('Attempting to stop scraping...', -1);
      updateStatusIndicator('Stopping', 'idle'); 
      stopScrapeBtn.disabled = true;
      chrome.runtime.sendMessage({ action: 'stopScraping' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending stopScraping message:', chrome.runtime.lastError.message);
          updateProgress(`Error stopping: ${chrome.runtime.lastError.message}`, -1);
          // UI will be reset by the service worker sending a final "updateStatus" with done=true
          // or if a timeout occurs for stop confirmation.
        } else if (response && response.status) {
          console.log('Stop scraping response from service worker:', response.status);
          updateProgress(response.status, -1); // Update based on immediate response
        }
        // The service worker should send a final "updateStatus" with done=true 
        // which will trigger resetUI after a delay. 
        // If the service worker confirms stop, it will manage the final UI state update.
      });
    });
  }

  // Listen for status updates from the service worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateStatus') {
      console.log("Popup: Received status update:", request.message, "Percentage:", request.percentage, "Done:", request.done);

      // If stopping, only update for done or critical errors, otherwise keep "Stopping..." message
      if (isStopping && !request.done && !(request.percentage === -1 && request.message.toLowerCase().includes('error'))) {
        console.log("Popup: Currently stopping, ignoring intermediate progress update:", request.message);
        // Optionally, ensure the status text remains "Attempting to stop scraping..." or similar
        if (statusText) statusText.textContent = 'Attempting to stop scraping...';
        // updateStatusIndicator might still be relevant for error states during stopping
        if (request.percentage === -1 && request.message.toLowerCase().includes('error')) {
            updateStatusIndicator('Error', 'error');
        }
        // Do not call updateProgress for non-final messages if isStopping is true
      } else {
        updateProgress(request.message, request.percentage);
      }

      if (request.done) {
        isStopping = false; // Reset flag as process is now definitively done
        // If done, reset the UI after a short delay to allow user to read final status
        setTimeout(() => {
            resetUI(); 
            // updateStatusIndicator('Active', 'active'); // resetUI now handles this
        }, 2000); 
      } else if (request.percentage === -1 && request.message.toLowerCase().includes('error')) {
        updateStatusIndicator('Error', 'error');
        // isStopping remains true if an error occurs during stopping, resetUI will handle it if done is also sent.
      } else if (isStopping) { // If still stopping and not done/error, ensure indicator shows stopping
        updateStatusIndicator('Stopping', 'idle');
      }
      // If not stopping, and not done, and not error, the indicator would have been set to 'Scraping' initially.
    }
    return true; 
  });

  // Event listener for the Options button
  if (optionsBtn) {
    optionsBtn.addEventListener('click', () => {
      // Open options.html in a new tab or use chrome.runtime.openOptionsPage()
      chrome.runtime.openOptionsPage();
    });
  }

  // Initial UI state
  resetUI(); // Set initial status to Active
  updateProgress("Ready to scrape."); // Initial message
});
