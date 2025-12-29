// Reddit to AI - Popup Script

// Localized helpers provided by i18n.js


document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();
  localizeHtmlPage();

  // Element references
  const scrapeBtn = document.getElementById('scrapeBtn');
  const stopScrapeBtn = document.getElementById('stopScrapeBtn');
  const filterMinScore = document.getElementById('filterMinScore');
  const filterHideBots = document.getElementById('filterHideBots');
  const includeHidden = document.getElementById('includeHidden');
  const moreFiltersLink = document.getElementById('moreFiltersLink');
  const statusDisplay = document.getElementById('statusDisplay');
  const statusIcon = document.getElementById('statusIcon');
  const statusArea = document.getElementById('statusArea');
  const optionsBtn = document.getElementById('optionsBtn');
  const platformCards = document.querySelectorAll('.platform-card');

  // Current selected platform
  let selectedPlatform = 'gemini';

  // Load saved settings
  chrome.storage.sync.get([
    'selectedLlmProvider',
    'filterMinScore',
    'filterHideBots',
    'includeHidden'
  ], (result) => {
    selectedPlatform = result.selectedLlmProvider || 'gemini';
    updatePlatformSelection(selectedPlatform);

    // Load filter settings
    if (filterMinScore) {
      filterMinScore.value = String(result.filterMinScore || 0);
    }
    if (filterHideBots) {
      filterHideBots.checked = result.filterHideBots || false;
    }
    if (includeHidden) {
      includeHidden.checked = result.includeHidden || false;
    }
  });

  // Platform card click handlers
  platformCards.forEach(card => {
    card.addEventListener('click', () => {
      const platform = card.dataset.platform;
      selectedPlatform = platform;
      updatePlatformSelection(platform);
      chrome.storage.sync.set({ selectedLlmProvider: platform });

      // Click feedback
      card.style.transform = 'scale(0.95)';
      setTimeout(() => card.style.transform = '', 100);
    });
  });

  function updatePlatformSelection(platform) {
    platformCards.forEach(card => {
      card.classList.toggle('selected', card.dataset.platform === platform);
    });
  }

  // Filter change handlers
  if (filterMinScore) {
    filterMinScore.addEventListener('change', (e) => {
      chrome.storage.sync.set({ filterMinScore: parseInt(e.target.value, 10) });
    });
  }

  if (filterHideBots) {
    filterHideBots.addEventListener('change', (e) => {
      chrome.storage.sync.set({ filterHideBots: e.target.checked });
    });
  }

  if (includeHidden) {
    includeHidden.addEventListener('change', (e) => {
      chrome.storage.sync.set({ includeHidden: e.target.checked });
    });
  }

  // More filters link
  if (moreFiltersLink) {
    moreFiltersLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  // Update status display
  function updateStatus(icon, text, type = 'default') {
    if (statusIcon) statusIcon.textContent = icon;
    if (statusDisplay) statusDisplay.textContent = text;
    if (statusArea) {
      statusArea.className = 'status-area';
      if (type !== 'default') statusArea.classList.add(type);
    }
  }

  // Check if on Reddit
  function checkRedditStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.url) {
        try {
          const url = new URL(tab.url);
          const isReddit = url.hostname.includes('reddit.com') || url.hostname.includes('redd.it');
          if (isReddit) {
            updateStatus('✓', t('popup_status_ready'), 'ready');
          } else {
            updateStatus('📍', t('popup_status_navigate'), 'default');
          }
        } catch {
          updateStatus('📍', t('popup_status_navigate'), 'default');
        }

      }
    });
  }

  // Render state from service worker
  function renderPopupState(state) {
    if (!state) return;

    if (state.isActive) {
      scrapeBtn.style.display = 'none';
      stopScrapeBtn.style.display = 'flex';
      stopScrapeBtn.disabled = false;
      updateStatus('⏳', state.message || t('popup_status_scraping'), 'scraping');
    } else {
      scrapeBtn.style.display = 'flex';
      scrapeBtn.disabled = false;
      stopScrapeBtn.style.display = 'none';

      if (state.error) {
        updateStatus('❌', state.error, 'error');
      } else if (state.message?.includes('sent') || state.message?.includes('Content')) {
        updateStatus('✅', t('popup_status_sent'), 'ready');
      } else {

        checkRedditStatus();
      }
    }
  }

  // Scrape button
  if (scrapeBtn) {
    scrapeBtn.addEventListener('click', () => {
      scrapeBtn.disabled = true;
      updateStatus('⏳', t('popup_status_starting'), 'scraping');

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        if (currentTab) {
          // Gather current filter settings
          const filters = {
            minScore: parseInt(filterMinScore?.value || '0', 10),
            hideBots: filterHideBots?.checked || false,
            includeHidden: includeHidden?.checked || false
          };

          chrome.runtime.sendMessage({
            action: 'scrapeReddit',
            includeHidden: filters.includeHidden,
            filters: filters,
            tabId: currentTab.id
          }, (response) => {
            if (chrome.runtime.lastError) {
              updateStatus('❌', chrome.runtime.lastError.message, 'error');
              scrapeBtn.disabled = false;
              return;
            }
            if (response?.currentState) {
              renderPopupState(response.currentState);
            } else if (response?.error) {
              updateStatus('❌', response.error, 'error');
              scrapeBtn.disabled = false;
            }
          });
        } else {
          updateStatus('❌', t('error') + ': Could not get current tab', 'error');
          scrapeBtn.disabled = false;
        }
      });
    });
  }

  // Stop button
  if (stopScrapeBtn) {
    stopScrapeBtn.addEventListener('click', () => {
      stopScrapeBtn.disabled = true;
      updateStatus('⏹', t('popup_status_stopping') || 'Stopping...', 'scraping');

      chrome.runtime.sendMessage({ action: 'stopScraping' }, (response) => {
        if (response?.currentState) {
          renderPopupState(response.currentState);
        }
      });
    });
  }

  // Listen for state updates
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'scrapingStateUpdate') {
      renderPopupState(request.data);
    }
    return true;
  });

  // Options button
  if (optionsBtn) {
    optionsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  // Get initial state
  chrome.runtime.sendMessage({ action: 'getScrapingState' }, (stateResponse) => {
    if (chrome.runtime.lastError) {
      updateStatus('❌', t('popup_error_extension') || 'Extension error', 'error');
      scrapeBtn.disabled = true;
      return;
    }
    if (stateResponse) {
      renderPopupState(stateResponse);
    } else {
      checkRedditStatus();
    }
  });

  // Initial Reddit check
  checkRedditStatus();
});
