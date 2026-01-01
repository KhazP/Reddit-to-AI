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
  const presetCards = document.querySelectorAll('.preset-card');

  // Copy of presets logic from options.js to ensure consistent templates
  function getPromptPresets() {
    return {
      summarize: {
        template: t('template_summarize') || `Provide a concise TL;DR summary of this Reddit thread.
Focus on: the main topic, key points made, and overall conclusion.
Keep it brief but comprehensive.

{content}`
      },
      debate: {
        template: t('template_debate') || `Analyze this Reddit thread as a debate.
Map out:
1. The different sides/perspectives presented
2. Key arguments for each position
3. Points of agreement and disagreement
4. Which arguments are strongest and why

{content}`
      },
      sentiment: {
        template: t('template_sentiment') || `Perform a sentiment analysis on this Reddit thread.
Analyze:
1. Overall sentiment (positive/negative/neutral)
2. Breakdown by comment - what % are positive, negative, neutral
3. Most emotionally charged comments
4. Tone shifts throughout the discussion

{content}`
      },
      takeaways: {
        template: t('template_takeaways') || `Extract the key takeaways from this Reddit thread.
Provide:
- Main insights as bullet points
- Actionable advice mentioned
- Important facts or statistics shared
- Common recommendations from multiple users

{content}`
      },
      eli5: {
        template: t('template_eli5') || `Explain this Reddit thread like I'm 5 years old.
Use simple language, analogies, and examples.
Avoid jargon and technical terms.
Make it easy to understand for someone new to this topic.

{content}`
      },
      custom: {
        template: null
      }
    };
  }

  const DEFAULT_CUSTOM_TEMPLATE = `Please analyze the following Reddit thread.

1. Summarize the post content.
2. Point out what people are saying about it (main opinions, arguments, consensus).
3. Provide a detailed comment analysis, highlighting key contributors or unique perspectives.

Data:

{content}`;

  // Current selected preset
  let selectedPreset = 'summarize';

  // Load saved settings
  chrome.storage.sync.get([
    'selectedPreset',
    'filterMinScore',
    'filterHideBots',
    'includeHidden'
  ], (result) => {
    selectedPreset = result.selectedPreset || 'summarize';
    updatePresetSelection(selectedPreset);

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

  // Preset card click handlers
  presetCards.forEach(card => {
    card.addEventListener('click', () => {
      const presetKey = card.dataset.preset;
      selectedPreset = presetKey;
      updatePresetSelection(presetKey);

      // Save selection
      chrome.storage.sync.set({ selectedPreset: presetKey });

      // Update the effective prompt template for scraping
      const presets = getPromptPresets();
      const preset = presets[presetKey];

      if (presetKey === 'custom') {
        // For custom, we rely on the customPromptTemplate saved in options
        // But here we need to make sure defaultPromptTemplate is set to it
        chrome.storage.sync.get(['customPromptTemplate'], (res) => {
          const custom = res.customPromptTemplate || DEFAULT_CUSTOM_TEMPLATE;
          chrome.storage.sync.set({ defaultPromptTemplate: custom });
        });
      } else {
        chrome.storage.sync.set({ defaultPromptTemplate: preset.template });
      }

      // Click feedback
      card.style.transform = 'scale(0.95)';
      setTimeout(() => card.style.transform = '', 100);
    });
  });

  function updatePresetSelection(presetKey) {
    presetCards.forEach(card => {
      card.classList.toggle('selected', card.dataset.preset === presetKey);
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
