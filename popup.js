// Placeholder for popup.js
// This script will handle user interactions in popup.html

document.addEventListener('DOMContentLoaded', () => {
  const scrapeBtn = document.getElementById('scrapeBtn');
  const includeHiddenToggle = document.getElementById('includeHiddenToggle');

  if (scrapeBtn) {
    scrapeBtn.addEventListener('click', () => {
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
            // Optionally, display an error to the user in the popup
            return;
          }
          if (response && response.status) {
            console.log('Service worker responded:', response.status);
            // Optionally, update popup UI based on response (e.g., show a success message)
          } else {
            console.log('Service worker did not send a response or response was unexpected.');
          }
        }
      );
    });
  }

  // The "Options" button is disabled in MVP, so no event listener for it yet.
});
