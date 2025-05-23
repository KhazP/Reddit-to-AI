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
        return; // Early exit if panel is null, as nothing else will work
    }

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
        console.log('RedditSummarizerPanel: updatePanelUI called with data:', JSON.stringify(data));
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
        
        // console.log('RedditSummarizerPanel: Processing summary. Raw summary:', data.summary); // Original log, will be replaced
        if (data.summary) {
            // Step 1: Direct HTML Test (using innerHTML) - REMAINS UNCHANGED
            const directTestHTML = '<p style="color: green;"><strong>Direct HTML Test:</strong> This should be green and bold.</p><ul><li>Item 1</li><li>Item 2</li></ul>';
            summaryTextEl.innerHTML = directTestHTML;
            console.log('RedditSummarizerPanel: Rendered direct test HTML via innerHTML. Check panel visually.');

            // Step 2: Decode and Parse
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
                        
                        // Clear previous content (the directTestHTML)
                        while (summaryTextEl.firstChild) {
                            summaryTextEl.removeChild(summaryTextEl.firstChild);
                        }
                        
                        // Append nodes from the parsed document's body
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
                        // Fallback: If DOMParser fails, clear directTestHTML and show an error or decoded summary
                        while (summaryTextEl.firstChild) {
                            summaryTextEl.removeChild(summaryTextEl.firstChild);
                        }
                        summaryTextEl.textContent = `DOMParser Error. Raw summary (decoded attempt): ${decodedSummary}`; 
                    }
                } else {
                    // If htmlOutput from decoded summary is empty, clear the directTestHTML and show an empty message
                    while (summaryTextEl.firstChild) { 
                         summaryTextEl.removeChild(summaryTextEl.firstChild);
                    }
                    summaryTextEl.innerHTML = '<p style="color: orange;"><em>Actual summary from marked.js (after decoding) was empty.</em></p>';
                    console.log('RedditSummarizerPanel: Actual parsed summary (from decoded input) was empty.');
                }
            } else {
                console.warn('RedditSummarizerPanel: markedGlobal.parse is NOT available. markedGlobal:', markedGlobal, 'Displaying decoded summary as plain text.');
                // Clear directTestHTML and show decoded summary as text
                const directTestHTMLCheck = '<p style="color: green;"><strong>Direct HTML Test:</strong> This should be green and bold.</p><ul><li>Item 1</li><li>Item 2</li></ul>';
                if (summaryTextEl.innerHTML === directTestHTMLCheck) { // Only clear if it's still the direct test
                    while (summaryTextEl.firstChild) {
                        summaryTextEl.removeChild(summaryTextEl.firstChild);
                    }
                }
                summaryTextEl.textContent = decodedSummary; // Use decoded summary
            }
            summaryAreaEl.style.display = 'block';
        } else {
            summaryAreaEl.style.display = 'none';
            summaryTextEl.innerHTML = ''; // Clear previous summary
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
            // Ensure marked is loaded before updating UI
            loadMarkedScript((err) => {
                if (err) {
                    console.error("RedditSummarizerPanel: Failed to load marked.js for panel update.");
                    // UI will fallback to textContent if markedGlobal is not available
                }
                updatePanelUI(request.data);
            });
            // Optional: sendResponse({status: "Panel updated"}); 
        }
        return true; // Keep channel open for other listeners if any, or for async sendResponse.
    });

    // --- Initial State Request ---
    console.log("RedditSummarizerPanel: Requesting initial state from service worker...");
    // Ensure marked is loaded before processing initial state
    loadMarkedScript((err) => {
        if (err) {
            console.error("RedditSummarizerPanel: Failed to load marked.js on initialization.");
            // Attempt to update UI anyway, it will fallback or show error for summary.
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
                // If scraping is not active and there's no error or summary, the panel might start hidden or show a ready message.
                // The updatePanelUI logic handles visibility based on isActive.
                if (panel) { // Ensure panel exists before trying to access its style
                 // The following logic seems to be a duplicate of what's inside updatePanelUI or general panel visibility management.
                 // Commenting out the duplicated section as per cleanup requirement.
                 /*
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
    // Optionally, if the panel was hidden by the user, this re-injection attempt could show it again
    // or re-request state if that's desired behavior. For now, it does nothing.
    // Example: document.getElementById('redditSummarizerPanel').style.display = 'flex';
}
// Removed duplicated block:
//            // If state.isActive is false and panel was hidden by user, this won't show it, which is good.
//            // If it's the first time and state.isActive is false, it will show "Ready to scrape."
//            if (!state.isActive && panel.style.display !== 'none') { // if panel is visible but process isn't active
//                // Only display if there is no error or summary to show
//                if (!state.error && !state.summary) {
//                     panel.style.display = 'flex'; // Ensure it's visible to show "Ready" or last state
//                } else if (state.error || state.summary) {
//                     panel.style.display = 'flex'; // Show if there is an error or summary
//                }
//            } else if (state.isActive) {
//                panel.style.display = 'flex'; // Ensure visible if scraping is active
//            }

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
