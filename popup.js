// Placeholder for popup.js
// This script will handle user interactions in popup.html

document.addEventListener('DOMContentLoaded', () => {
  const scrapeBtn = document.getElementById('scrapeBtn');
  const includeHiddenToggle = document.getElementById('includeHiddenToggle');
  const statusDisplay = document.getElementById('statusDisplay');
  const progressBarContainer = document.getElementById('progressBarContainer');
  const progressBar = document.getElementById('progressBar');
  const optionsBtn = document.getElementById('optionsBtn'); // Get the options button
  const mainView = document.getElementById('mainView');
  const optionsView = document.getElementById('optionsView');

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
      } else if (percentage === -1 && message.toLowerCase().includes('error')) {
        // Keep progress bar visible but indicate error, or hide
        progressBar.style.width = '100%';
        progressBar.style.backgroundColor = '#dc3545'; // Red for error
      } else if (percentage === -1) {
        // Hide progress bar if no specific percentage and not an error being shown on it
        // progressBarContainer.style.display = 'none'; 
      }
    }
    console.log("Popup status:", message, "Progress:", percentage);
  }

  function resetUI() {
    scrapeBtn.disabled = false;
    if (progressBarContainer) progressBarContainer.style.display = 'none';
    if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.style.backgroundColor = '#4CAF50'; // Reset to green
    }
    // updateProgress("Ready."); // Optionally reset status text
  }

  if (scrapeBtn) {
    scrapeBtn.addEventListener('click', () => {
      updateProgress('Initiating scraping...', 0);
      scrapeBtn.disabled = true;
      progressBar.style.backgroundColor = '#4CAF50'; // Ensure it's green at start
      progressBarContainer.style.display = 'block';
      const includeHidden = includeHiddenToggle.checked;
      // Send a message to the service worker to start scraping
      chrome.runtime.sendMessage(
        { 
          action: 'scrapeReddit', 
          includeHidden: includeHidden 
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error sending message to service worker:', chrome.runtime.lastError.message);
            updateProgress(`Error: ${chrome.runtime.lastError.message}`, -1);
            resetUI();
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
            resetUI();
          }
          // Do not resetUI() here, wait for a 'done' message or explicit error handling above.
        }
      );
    });
  }

  // Listen for status updates from the service worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateStatus") { // This will now carry percentage too
      updateProgress(request.message, request.percentage);
      if (request.done) {
        if (request.message.toLowerCase().includes('error')) {
            progressBar.style.backgroundColor = '#dc3545'; // Red for error
            progressBar.style.width = '100%';
        } else {
            progressBar.style.backgroundColor = '#4CAF50'; // Green for success
            progressBar.style.width = '100%'; // Ensure it shows 100% on completion
            // updateProgress(request.message, 100); // Explicitly set 100%
        }
        // Delay reset to allow user to see final status/progress
        setTimeout(() => {
            resetUI();
            if (!request.message.toLowerCase().includes('error')) {
                 updateProgress("Process completed!", -1); // Final friendly message
                 progressBarContainer.style.display = 'none';
            }
        }, 2000); // Keep final state for 2 seconds
      }
    }
    return false; 
  });

  // Event listener for the Options button
  if (optionsBtn) {
    optionsBtn.addEventListener('click', async () => {
      // Fix for first-time display when the style hasn't been set yet
      const optionsCurrentlyHidden = optionsView.style.display === 'none' || 
                                     optionsView.style.display === '';
      
      if (optionsCurrentlyHidden) {
        // Load options.html content into optionsView
        console.log("Loading options view");
        try {
          const response = await fetch(chrome.runtime.getURL('options.html'));
          const text = await response.text();
          optionsView.innerHTML = text;
          mainView.style.display = 'none';
          optionsView.style.display = 'block';
          optionsBtn.textContent = 'Back to Main';

          // Remove existing script if it was added before to prevent multiple executions
          const existingScript = optionsView.querySelector('script[src="'+chrome.runtime.getURL('options.js')+'"]');
          if (existingScript) {
            existingScript.remove();
          }

          const script = document.createElement('script');
          script.src = chrome.runtime.getURL('options.js');
          
          // Add the options script directly to document head for better reliability
          console.log("Adding options.js script to the document head");
          document.head.appendChild(script);
          
          script.onload = () => {
            console.log("Options script loaded in head, initializeOptions available:", !!window.initializeOptions);
            
            if (window.initializeOptions) {
              window.calledFromPopup = true; 

              // Add slight delay to ensure DOM is fully rendered
              setTimeout(() => {
                console.log("Calling initializeOptions with delay");
                try {
                  window.initializeOptions();
                } catch (err) {
                  console.error("Error in delayed options initialization:", err);
                }
              }, 50);
              
              try {
                window.initializeOptions();
                console.log("Options initialized successfully");
              } catch (error) {
                console.error("Error initializing options:", error);
              }
            }
          };

        } catch (error) {
          console.error('Error loading options.html:', error);
          updateProgress('Error loading options.', -1);
        }
      } else {
        mainView.style.display = 'block';
        optionsView.style.display = 'none';
        optionsView.innerHTML = ''; // Clear options content
        optionsBtn.textContent = 'Options';
      }
    });
  }
});
