// Reddit to AI - Floating Panel Script
(async function () {
    console.log('Reddit to AI: Floating panel script loading...');

    // Initialize i18n
    if (typeof initI18n === 'function') {
        await initI18n();
    }

    // Prevent multiple injections
    if (window.__redditToAiPanelInjected) {
        console.log('Reddit to AI: Panel already injected, skipping.');
    } else {
        window.__redditToAiPanelInjected = true;

        // Create and inject the panel HTML
        const panelHTML = `
    <div id="redditSummarizerPanel" style="display: none;">
      <div class="rs-header">
        <span>${t('panel_title') || 'Reddit to AI'}</span>
        <button id="rsCloseBtn" class="rs-close-btn" title="${t('close') || 'Close'}">✕</button>
      </div>
      <div class="rs-content">
        <p id="rsStatusMessage">${t('panel_status_ready') || 'Ready'}</p>
        <div id="rsProgressBarContainer" class="rs-progress-bar-container">
          <div id="rsProgressBar" class="rs-progress-bar"></div>
        </div>
        <p id="rsUserGuidance" class="rs-user-guidance"></p>
      </div>
    </div>
  `;

        document.body.insertAdjacentHTML('beforeend', panelHTML);

        // Get element references
        const panel = document.getElementById('redditSummarizerPanel');
        const closeBtn = document.getElementById('rsCloseBtn');
        const statusMessage = document.getElementById('rsStatusMessage');
        const progressContainer = document.getElementById('rsProgressBarContainer');
        const progressBar = document.getElementById('rsProgressBar');
        const userGuidance = document.getElementById('rsUserGuidance');
        const header = panel?.querySelector('.rs-header');

        // --- Close Button ---
        if (closeBtn && panel) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                panel.style.display = 'none';
                console.log('Reddit to AI: Panel closed by user.');
            });
        }

        // --- Draggable ---
        if (header && panel) {
            let isDragging = false;
            let offsetX = 0, offsetY = 0;

            header.addEventListener('mousedown', (e) => {
                if (e.target === closeBtn) return;
                isDragging = true;
                offsetX = e.clientX - panel.offsetLeft;
                offsetY = e.clientY - panel.offsetTop;
                panel.style.userSelect = 'none';
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                panel.style.left = (e.clientX - offsetX) + 'px';
                panel.style.top = (e.clientY - offsetY) + 'px';
                panel.style.right = 'auto'; // Override CSS right positioning
            });

            document.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    panel.style.userSelect = '';
                }
            });
        }

        // --- Update UI Function ---
        function updatePanel(data) {
            if (!panel || !data) return;

            console.log('Reddit to AI: Updating panel with:', data);

            // Show panel when active or has error
            if (data.isActive || data.error) {
                panel.style.display = 'flex';
            }

            // Status message
            if (statusMessage) {
                statusMessage.textContent = data.message || t('panel_status_ready') || 'Ready';
                statusMessage.style.color = data.error ? '#ef4444' : '';
            }

            // Progress bar
            if (progressContainer && progressBar) {
                if (data.isActive && data.percentage >= 0) {
                    progressContainer.style.display = 'block';
                    progressBar.style.width = data.percentage + '%';

                    // Error state
                    if (data.error) {
                        progressBar.style.background = '#ef4444';
                    } else {
                        progressBar.style.background = '';
                    }
                } else {
                    progressContainer.style.display = 'none';
                }
            }

            // User guidance
            if (userGuidance) {
                if (data.isActive && !data.error) {
                    userGuidance.textContent = t('panel_guidance') || 'Scraping in progress. Please keep this tab open.';
                    userGuidance.style.display = 'block';
                } else {
                    userGuidance.style.display = 'none';
                }
            }

            // Auto-hide after completion (with delay)
            if (!data.isActive && !data.error && data.message?.includes('sent')) {
                setTimeout(() => {
                    if (panel.style.display !== 'none') {
                        panel.style.display = 'none';
                    }
                }, 3000);
            }
        }

        // --- Message Listener ---
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'updateFloatingPanel') {
                updatePanel(request.data);
            }
            return true;
        });

        // --- Get Initial State ---
        chrome.runtime.sendMessage({ action: 'getScrapingState' }, (state) => {
            if (chrome.runtime.lastError) {
                console.error('Reddit to AI: Error getting state:', chrome.runtime.lastError.message);
                return;
            }
            if (state) {
                updatePanel(state);
            }
        });

        console.log('Reddit to AI: Floating panel initialized.');
    }
})();
