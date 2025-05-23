console.log('RedditSummarizerPanel: Script execution start.');

// Flag to ensure marked.min.js is loaded only once
let markedScriptLoaded = false;
let markedLoadingInProgress = false; // To prevent multiple load attempts
let markedGlobal = null; // To store the loaded marked library

// Helper function for HTML decoding
function htmlDecode(input) {
    if (typeof input !== 'string') {
        console.warn('RedditSummarizerPanel: htmlDecode received non-string input:', input);
        return input; // Return as is or handle error
    }
    try {
        const tempDoc = new DOMParser().parseFromString(input, "text/html");
        return tempDoc.documentElement.textContent;
    } catch (e) {
        console.error('RedditSummarizerPanel: Error in htmlDecode:', e);
        return input; // Fallback to original input on error
    }
}

function loadMarkedScript(callback) {
  console.log('RedditSummarizerPanel: loadMarkedScript called.');
  if (markedScriptLoaded && typeof markedGlobal !== 'undefined' && markedGlobal) { // Check markedGlobal directly
    if (callback) callback();
    return;
  }
  if (markedLoadingInProgress) {
    // Poll until markedGlobal is available or give up after a timeout
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (typeof window.marked !== 'undefined') { // Check window.marked for actual load
        clearInterval(interval);
        markedScriptLoaded = true;
        markedLoadingInProgress = false; // Should have been set by onload, but ensure
        markedGlobal = window.marked; 
        console.log('RedditSummarizerPanel: marked.min.js loaded (polled). markedGlobal:', markedGlobal);
        if (callback) callback();
      } else if (attempts > 50) { // Timeout after ~5 seconds
        clearInterval(interval);
        markedLoadingInProgress = false;
        console.error("RedditSummarizerPanel: Timeout loading marked.js via poll.");
        if (callback) callback(new Error("Timeout loading marked.js via poll"));
      }
    }, 100);
    return;
  }

  markedLoadingInProgress = true;
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('marked.min.js');
  script.onload = () => {
    console.log('RedditSummarizerPanel: marked.min.js script object loaded. window.marked:', window.marked);
    markedScriptLoaded = true;
    markedLoadingInProgress = false;
    markedGlobal = window.marked; // Access marked from window scope
    console.log('RedditSummarizerPanel: markedGlobal after assignment:', markedGlobal);
    if (callback) callback();
  };
  script.onerror = (e) => {
    console.error('RedditSummarizerPanel: marked.min.js script.onerror triggered.');
    console.error('RedditSummarizerPanel: Error loading marked.min.js:', e);
    markedLoadingInProgress = false;
    if (callback) callback(new Error('Error loading marked.min.js'));
  };
  (document.head || document.documentElement).appendChild(script);
}

console.log('RedditSummarizerPanel: Checking window.isRedditSummarizerPanelInjected. Current value:', window.isRedditSummarizerPanelInjected);
if (!window.isRedditSummarizerPanelInjected) {
    window.isRedditSummarizerPanelInjected = true;
    console.log("RedditSummarizerPanel: Injecting script.");

    // Initial attempt to load marked.js
    loadMarkedScript();

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
                    <div id="rsSummaryText"></div>
                </div>
                <p id="rsUserGuidance" class="rs-user-guidance"></p>
            </div>
            <!-- <div class="rs-resize-handle"></div> -->
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', panelHTML);
    const panelElementForCheck = document.getElementById('redditSummarizerPanel');
    console.log('RedditSummarizerPanel: panelHTML inserted. Element found by getElementById immediately after insertion:', panelElementForCheck ? 'Found' : 'NOT Found');

    const panel = document.getElementById('redditSummarizerPanel');
    console.log('RedditSummarizerPanel: "panel" variable assigned. Value:', panel ? 'Assigned' : 'NULL');
    if (!panel) {
        console.error('RedditSummarizerPanel: CRITICAL - panel element is null after getElementById. Panel will not work.');
        // The illegal 'return;' statement that was here has been removed.
    }

    const closeBtn = document.getElementById('rsCloseBtn');
    const statusMessageEl = document.getElementById('rsStatusMessage');
    const progressBarContainerEl = document.getElementById('rsProgressBarContainer');
    const progressBarEl = document.getElementById('rsProgressBar');
    const summaryAreaEl = document.getElementById('rsSummaryArea');
    const summaryTextEl = document.getElementById('rsSummaryText');
    const userGuidanceEl = document.getElementById('rsUserGuidance');
    const header = panel ? panel.querySelector('.rs-header') : null; // Check if panel exists before querySelector

    // --- Close Button Logic ---
    if (closeBtn && panel) { // Ensure panel exists
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
        });
    } else {
        if (!panel) console.error("RedditSummarizerPanel: Panel not found for Close button logic.");
        if (!closeBtn) console.error("RedditSummarizerPanel: Close button not found.");
    }

    // --- Draggable Logic ---
    if (header && panel) { // Ensure panel and header exist
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
        if (!panel) console.error("RedditSummarizerPanel: Panel not found for Draggable logic.");
        else if (!header) console.error("RedditSummarizerPanel: Header not found for Draggable logic.");
    }
    
    // --- Update Panel UI Function ---
    function updatePanelUI(data) {
        console.log('RedditSummarizerPanel: updatePanelUI called with data:', JSON.stringify(data));
        // Check if panel is null before proceeding, as other elements depend on it
        if (!panel) {
            console.error("RedditSummarizerPanel: updatePanelUI - panel element is null. Cannot update UI elements.");
            return;
        }
        if (!statusMessageEl || !progressBarContainerEl || !progressBarEl || !summaryAreaEl || !summaryTextEl || !userGuidanceEl) {
            console.error("RedditSummarizerPanel: One or more panel child elements are missing. Cannot update UI fully.");
            // Allow partial update if some elements are still found, e.g. statusMessageEl might still exist
        }

        // Make panel visible if it's receiving updates and not explicitly hidden by user
        if (panel.style.display === 'none' && data.isActive) { 
             panel.style.display = 'flex';
        } else if (!data.isActive && !data.summary && !data.error) { 
             // panel.style.display = 'none'; 
        }

        if (statusMessageEl) statusMessageEl.textContent = data.message || 'Status unknown.';
        else console.warn("RedditSummarizerPanel: statusMessageEl is null in updatePanelUI.");


        if (progressBarContainerEl && progressBarEl) {
            if (data.percentage !== undefined && data.percentage >= 0) {
                progressBarContainerEl.style.display = 'block';
                progressBarEl.style.width = data.percentage + '%';
                progressBarEl.textContent = data.percentage + '%';
                progressBarEl.style.backgroundColor = '#4CAF50'; 
            } else {
                progressBarContainerEl.style.display = 'none';
            }
        } else {
            console.warn("RedditSummarizerPanel: Progress bar elements are null in updatePanelUI.");
        }


        if (statusMessageEl) { // statusMessageEl might have been set above
            if (data.error) {
                statusMessageEl.textContent = `Error: ${data.error || data.message}`;
                statusMessageEl.style.color = 'red';
                if (progressBarContainerEl && progressBarEl && progressBarContainerEl.style.display === 'block') { 
                    progressBarEl.style.width = '100%';
                    progressBarEl.style.backgroundColor = '#dc3545'; 
                    progressBarEl.textContent = "Error";
                }
            } else {
                statusMessageEl.style.color = ''; 
            }
        }
        
        if (summaryTextEl && summaryAreaEl) { // Check both exist
            if (data.summary) {
                const directTestHTML = '<p style="color: green;"><strong>Direct HTML Test:</strong> This should be green and bold.</p><ul><li>Item 1</li><li>Item 2</li></ul>';
                summaryTextEl.innerHTML = directTestHTML;
                console.log('RedditSummarizerPanel: Rendered direct test HTML via innerHTML. Check panel visually.');

                console.log('RedditSummarizerPanel: Original data.summary:', data.summary);
                const decodedSummary = htmlDecode(data.summary);
                console.log('RedditSummarizerPanel: Decoded data.summary:', decodedSummary);

                let htmlOutput = '';
                if (markedGlobal && typeof markedGlobal.parse === 'function') {
                    console.log('RedditSummarizerPanel: markedGlobal is available. Parsing decoded summary.');
                    htmlOutput = markedGlobal.parse(decodedSummary);
                    console.log('RedditSummarizerPanel: HTML output from marked.parse(decodedSummary):', htmlOutput);
                    
                    if (htmlOutput && htmlOutput.trim() !== "") {
                        try {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(htmlOutput, "text/html");
                            
                            while (summaryTextEl.firstChild) {
                                summaryTextEl.removeChild(summaryTextEl.firstChild);
                            }
                            
                            if (doc.body.childNodes.length > 0) {
                                Array.from(doc.body.childNodes).forEach(node => {
                                    summaryTextEl.appendChild(document.importNode(node, true));
                                });
                                console.log('RedditSummarizerPanel: Appended actual summary HTML (from decoded input) using DOMParser.');
                            } else {
                                console.warn('RedditSummarizerPanel: DOMParser produced a document with no childNodes in body from decoded summary. HTML was:', htmlOutput);
                                summaryTextEl.innerHTML = '<p style="color: red;"><em>DOMParser (decoded) resulted in empty content. Check console.</em></p>';
                            }
                        } catch (e) {
                            console.error('RedditSummarizerPanel: Error using DOMParser for decoded summary:', e);
                            while (summaryTextEl.firstChild) {
                                summaryTextEl.removeChild(summaryTextEl.firstChild);
                            }
                            summaryTextEl.textContent = `DOMParser Error. Raw summary (decoded attempt): ${decodedSummary}`; 
                        }
                    } else {
                        while (summaryTextEl.firstChild) { 
                             summaryTextEl.removeChild(summaryTextEl.firstChild);
                        }
                        summaryTextEl.innerHTML = '<p style="color: orange;"><em>Actual summary from marked.js (after decoding) was empty.</em></p>';
                        console.log('RedditSummarizerPanel: Actual parsed summary (from decoded input) was empty.');
                    }
                } else {
                    console.warn('RedditSummarizerPanel: markedGlobal.parse is NOT available. markedGlobal:', markedGlobal, 'Displaying decoded summary as plain text.');
                    const directTestHTMLCheck = '<p style="color: green;"><strong>Direct HTML Test:</strong> This should be green and bold.</p><ul><li>Item 1</li><li>Item 2</li></ul>';
                    if (summaryTextEl.innerHTML === directTestHTMLCheck) { 
                        while (summaryTextEl.firstChild) {
                            summaryTextEl.removeChild(summaryTextEl.firstChild);
                        }
                    }
                    summaryTextEl.textContent = decodedSummary; 
                }
                summaryAreaEl.style.display = 'block';
            } else {
                summaryAreaEl.style.display = 'none';
                summaryTextEl.innerHTML = ''; 
            }
        } else {
            console.warn("RedditSummarizerPanel: summaryTextEl or summaryAreaEl is null in updatePanelUI.");
        }

        if (userGuidanceEl) { // Check exists
            if (data.isActive) {
                userGuidanceEl.textContent = "Scraping in progress. Please do not close this Reddit tab or navigate away to ensure accurate data collection. You can close this panel; scraping will continue.";
                userGuidanceEl.style.display = 'block';
            } else {
                userGuidanceEl.style.display = 'none';
                if (statusMessageEl && !data.error && !data.summary && data.message && data.message.toLowerCase().includes('complete')) {
                    // statusMessageEl.textContent = data.message; 
                } else if (statusMessageEl && !data.error && !data.summary && data.percentage === 100) {
                    statusMessageEl.textContent = "Process finished. No summary available.";
                }
            }
        } else {
            console.warn("RedditSummarizerPanel: userGuidanceEl is null in updatePanelUI.");
        }
    }


    // --- Message Listener ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updateFloatingPanel') {
            console.log("RedditSummarizerPanel: Received updateFloatingPanel", request.data);
            loadMarkedScript((err) => {
                if (err) {
                    console.error("RedditSummarizerPanel: Failed to load marked.js for panel update.");
                }
                updatePanelUI(request.data);
            });
        }
        return true; 
    });

    // --- Initial State Request ---
    console.log("RedditSummarizerPanel: Requesting initial state from service worker...");
    loadMarkedScript((err) => {
        if (err) {
            console.error("RedditSummarizerPanel: Failed to load marked.js on initialization.");
        }
        chrome.runtime.sendMessage({ action: 'getScrapingState' }, (state) => {
            if (chrome.runtime.lastError) {
                console.error("RedditSummarizerPanel: Error getting initial state:", chrome.runtime.lastError.message);
                if (statusMessageEl) statusMessageEl.textContent = "Could not connect to extension background. Please try refreshing.";
                if (userGuidanceEl) userGuidanceEl.style.display = 'none';
                return;
            }
            if (state) {
                console.log('RedditSummarizerPanel: Initial getScrapingState callback. Received state:', JSON.stringify(state));
                updatePanelUI(state);
                if (panel) { 
                 /*
                    if (!state.isActive && panel.style.display !== 'none') { 
                        if (!state.error && !state.summary) {
                             panel.style.display = 'flex'; 
                        } else if (state.error || state.summary) {
                             panel.style.display = 'flex'; 
                        }
                    } else if (state.isActive) {
                        panel.style.display = 'flex'; 
                    }
                */
                }

            } else {
                console.warn("RedditSummarizerPanel: No initial state received from service worker.");
                if (statusMessageEl) statusMessageEl.textContent = "No initial state from service worker. Popup might need to be opened once.";
                if (userGuidanceEl) userGuidanceEl.style.display = 'none';
            }
        });
    });

    console.log("RedditSummarizerPanel: Script fully initialized and listeners active.");

} else {
    console.log("RedditSummarizerPanel: Script already injected. Skipping re-injection.");
}
// Removed duplicated block:
// ... (The duplicated block was already removed in previous turns) ...
        } else { // This else corresponds to the 'if (state)' from getScrapingState callback
            // This case means 'state' was null or undefined from getScrapingState
            // This was the location of the previously removed duplicated block
            // No specific logic needed here if statusMessageEl etc. are checked inside updatePanelUI
            // or if the initial console.warn covers it.
        }
    }); // This is the end of the chrome.runtime.sendMessage({ action: 'getScrapingState' } callback

    console.log("RedditSummarizerPanel: Script fully initialized and listeners active."); // This log might be reached if panel is null and the if(!panel) block doesn't stop further execution.

} else { // This else corresponds to if (!window.isRedditSummarizerPanelInjected)
    console.log("RedditSummarizerPanel: Script already injected. Skipping re-injection.");
}
