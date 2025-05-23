if (!window.isRedditSummarizerPanelInjected) {
    window.isRedditSummarizerPanelInjected = true;
    console.log("RedditSummarizerPanel: Injecting script.");

    const panelHTML = `
        <div id="redditSummarizerPanel" class="rs-panel">
            <div class="rs-header">
                <span>Reddit Summarizer</span>
                <button id="rsCloseBtn" class="rs-close-btn" title="Close Panel">X</button>
            </div>
            <div class="rs-content">
                <p id="rsStatusMessage">Initializing...</p>
                <div id="rsProgressBarContainer" class="rs-progress-bar-container">
                    <div id="rsProgressBar" class="rs-progress-bar">0%</div>
                </div>
                <div id="rsSummaryArea" class="rs-summary-area">
                    <h4>Summary:</h4>
                    <pre id="rsSummaryText"></pre>
                </div>
                <p id="rsUserGuidance" class="rs-user-guidance"></p>
            </div>
            <!-- <div class="rs-resize-handle"></div> -->
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', panelHTML);

    const panel = document.getElementById('redditSummarizerPanel');
    const closeBtn = document.getElementById('rsCloseBtn');
    const statusMessageEl = document.getElementById('rsStatusMessage');
    const progressBarContainerEl = document.getElementById('rsProgressBarContainer');
    const progressBarEl = document.getElementById('rsProgressBar');
    const summaryAreaEl = document.getElementById('rsSummaryArea');
    const summaryTextEl = document.getElementById('rsSummaryText');
    const userGuidanceEl = document.getElementById('rsUserGuidance');
    const header = panel.querySelector('.rs-header');

    // --- Close Button Logic ---
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
        });
    } else {
        console.error("RedditSummarizerPanel: Close button not found.");
    }

    // --- Draggable Logic ---
    if (header && panel) {
        let isDragging = false;
        let offsetX, offsetY;

        header.addEventListener('mousedown', (e) => {
            // Prevent dragging if the click is on the close button itself
            if (e.target === closeBtn) {
                return;
            }
            isDragging = true;
            offsetX = e.clientX - panel.offsetLeft;
            offsetY = e.clientY - panel.offsetTop;
            panel.style.userSelect = 'none'; 
            e.preventDefault(); // Prevent text selection on header
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            panel.style.left = (e.clientX - offsetX) + 'px';
            panel.style.top = (e.clientY - offsetY) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                panel.style.userSelect = 'auto';
            }
        });
    } else {
        console.error("RedditSummarizerPanel: Panel or header element not found for draggable logic.");
    }
    
    // --- Update Panel UI Function ---
    function updatePanelUI(data) {
        if (!panel || !statusMessageEl || !progressBarContainerEl || !progressBarEl || !summaryAreaEl || !summaryTextEl || !userGuidanceEl) {
            console.error("RedditSummarizerPanel: One or more panel elements are missing. Cannot update UI.");
            return;
        }

        // Make panel visible if it's receiving updates and not explicitly hidden by user
        if (panel.style.display === 'none' && data.isActive) { // Only show if an operation is active
             panel.style.display = 'flex';
        } else if (!data.isActive && !data.summary && !data.error) { // If not active and no summary/error to show, keep it hidden or hide.
             // panel.style.display = 'none'; // Or let user control visibility
        }


        statusMessageEl.textContent = data.message || 'Status unknown.';

        if (data.percentage !== undefined && data.percentage >= 0) {
            progressBarContainerEl.style.display = 'block';
            progressBarEl.style.width = data.percentage + '%';
            progressBarEl.textContent = data.percentage + '%';
            progressBarEl.style.backgroundColor = '#4CAF50'; // Default green
        } else {
            progressBarContainerEl.style.display = 'none';
        }

        if (data.error) {
            statusMessageEl.textContent = `Error: ${data.error || data.message}`;
            statusMessageEl.style.color = 'red';
            if (progressBarContainerEl.style.display === 'block') { // If progress bar was visible
                progressBarEl.style.width = '100%';
                progressBarEl.style.backgroundColor = '#dc3545'; // Red for error
                progressBarEl.textContent = "Error";
            }
        } else {
            statusMessageEl.style.color = ''; // Reset color
        }
        
        if (data.summary) {
            summaryTextEl.textContent = data.summary;
            summaryAreaEl.style.display = 'block';
        } else {
            summaryAreaEl.style.display = 'none';
            summaryTextEl.textContent = ''; // Clear previous summary
        }

        if (data.isActive) {
            userGuidanceEl.textContent = "Scraping in progress. Please do not close this Reddit tab or navigate away to ensure accurate data collection. You can close this panel; scraping will continue.";
            userGuidanceEl.style.display = 'block';
        } else {
            userGuidanceEl.style.display = 'none';
            // If process is done, and there was no error, but also no summary, maybe a generic completion message
            if (!data.error && !data.summary && data.message.toLowerCase().includes('complete')) {
                 // statusMessageEl.textContent = data.message; // Already set
            } else if (!data.error && !data.summary && data.percentage === 100) {
                statusMessageEl.textContent = "Process finished. No summary available.";
            }
        }
    }


    // --- Message Listener ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updateFloatingPanel') {
            console.log("RedditSummarizerPanel: Received updateFloatingPanel", request.data);
            updatePanelUI(request.data);
            // Optional: sendResponse({status: "Panel updated"}); 
        }
        return true; // Keep channel open for other listeners if any, or for async sendResponse.
    });

    // --- Initial State Request ---
    console.log("RedditSummarizerPanel: Requesting initial state from service worker...");
    chrome.runtime.sendMessage({ action: 'getScrapingState' }, (state) => {
        if (chrome.runtime.lastError) {
            console.error("RedditSummarizerPanel: Error getting initial state:", chrome.runtime.lastError.message);
            statusMessageEl.textContent = "Could not connect to extension background. Please try refreshing.";
            userGuidanceEl.style.display = 'none';
            return;
        }
        if (state) {
            console.log("RedditSummarizerPanel: Received initial state:", state);
            updatePanelUI(state);
            // If scraping is not active and there's no error or summary, the panel might start hidden or show a ready message.
            // The updatePanelUI logic handles visibility based on isActive.
            // If state.isActive is false and panel was hidden by user, this won't show it, which is good.
            // If it's the first time and state.isActive is false, it will show "Ready to scrape."
            if (!state.isActive && panel.style.display !== 'none') { // if panel is visible but process isn't active
                // Only display if there is no error or summary to show
                if (!state.error && !state.summary) {
                     panel.style.display = 'flex'; // Ensure it's visible to show "Ready" or last state
                } else if (state.error || state.summary) {
                     panel.style.display = 'flex'; // Show if there is an error or summary
                }
            } else if (state.isActive) {
                panel.style.display = 'flex'; // Ensure visible if scraping is active
            }

        } else {
            console.warn("RedditSummarizerPanel: No initial state received from service worker.");
            statusMessageEl.textContent = "No initial state from service worker. Popup might need to be opened once.";
            userGuidanceEl.style.display = 'none';
        }
    });

    console.log("RedditSummarizerPanel: Script fully initialized and listeners active.");

} else {
    console.log("RedditSummarizerPanel: Script already injected. Skipping re-injection.");
    // Optionally, if the panel was hidden by the user, this re-injection attempt could show it again
    // or re-request state if that's desired behavior. For now, it does nothing.
    // Example: document.getElementById('redditSummarizerPanel').style.display = 'flex';
}
