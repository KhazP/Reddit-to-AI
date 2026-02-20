// Reddit to AI - Popup Script

// Localized helpers provided by i18n.js

document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();
  localizeHtmlPage();

  // ── Element references ──────────────────────────────────
  const scrapeBtn = document.getElementById('scrapeBtn');
  const stopScrapeBtn = document.getElementById('stopScrapeBtn');
  const includeHidden = document.getElementById('includeHidden');
  const optionsBtn = document.getElementById('optionsBtn');
  const feedbackBtn = document.getElementById('feedbackBtn');
  const presetCards = document.querySelectorAll('.preset-card');
  const quickPromptInput = document.getElementById('quickPrompt');
  const expandFiltersBtn = document.getElementById('expandFiltersBtn');
  const advancedFilters = document.getElementById('advancedFilters');
  const filterHideBotsBtn = document.getElementById('filterHideBotsBtn');
  const filterOpOnlyBtn = document.getElementById('filterOpOnlyBtn');
  const filterFlairedBtn = document.getElementById('filterFlairedBtn');
  const filterTopN = document.getElementById('filterTopN');
  const depthRadios = document.querySelectorAll('input[name="scrapeDepthPopup"]');
  const toastContainer = document.getElementById('toastContainer');

  // ── Custom Min Score dropdown ───────────────────────────
  let minScoreValue = 0;

  const minScoreBtn = document.getElementById('filterMinScoreBtn');
  const minScoreDropdown = document.getElementById('filterMinScoreDropdown');
  const minScoreLabel = document.getElementById('filterMinScoreLabel');
  const minScoreOptions = minScoreDropdown?.querySelectorAll('.custom-select-option');

  function setMinScore(value, label) {
    minScoreValue = value;
    if (minScoreLabel) minScoreLabel.textContent = label;
    minScoreOptions?.forEach(opt => {
      opt.classList.toggle('selected', parseInt(opt.dataset.value, 10) === value);
    });
    chrome.storage.sync.set({ filterMinScore: value });
  }

  function closeMinScoreDropdown() {
    minScoreBtn?.setAttribute('aria-expanded', 'false');
    minScoreDropdown?.setAttribute('aria-hidden', 'true');
  }

  if (minScoreBtn && minScoreDropdown) {
    minScoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = minScoreBtn.getAttribute('aria-expanded') === 'true';
      minScoreBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      minScoreDropdown.setAttribute('aria-hidden', expanded ? 'true' : 'false');
    });

    minScoreOptions?.forEach(opt => {
      opt.addEventListener('click', () => {
        setMinScore(parseInt(opt.dataset.value, 10), opt.textContent);
        closeMinScoreDropdown();
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!minScoreBtn.contains(e.target) && !minScoreDropdown.contains(e.target)) {
        closeMinScoreDropdown();
      }
    });
  }

  // ── Toast System ────────────────────────────────────────
  const activeToasts = new Map(); // id -> toast element

  function getToastIcon(type) {
    const icons = {
      info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
      success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>`,
      error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      progress: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
    };
    return icons[type] || icons.info;
  }

  function showToast(type, message, options = {}) {
    const { id, dismiss = true, progress = null, autoDismiss = null } = options;

    // If same id exists, update message and progress bar in place
    if (id && activeToasts.has(id)) {
      const existing = activeToasts.get(id);
      const msgEl = existing.querySelector('.toast-message');
      if (msgEl) msgEl.textContent = message;
      if (progress !== null) {
        const bar = existing.querySelector('.toast-progress-bar');
        if (bar) bar.style.width = `${progress}%`;
      }
      return existing;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Icon
    const iconEl = document.createElement('div');
    iconEl.className = 'toast-icon';
    iconEl.innerHTML = getToastIcon(type);
    toast.appendChild(iconEl);

    // Body
    const body = document.createElement('div');
    body.className = 'toast-body';
    const msgEl = document.createElement('div');
    msgEl.className = 'toast-message';
    msgEl.textContent = message;
    body.appendChild(msgEl);
    toast.appendChild(body);

    // Dismiss button
    if (dismiss) {
      const dismissBtn = document.createElement('button');
      dismissBtn.className = 'toast-dismiss';
      dismissBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      dismissBtn.addEventListener('click', () => dismissToast(toast));
      toast.appendChild(dismissBtn);
    }

    // Progress bar
    if (progress !== null) {
      const bar = document.createElement('div');
      bar.className = 'toast-progress-bar';
      bar.style.width = `${progress}%`;
      toast.appendChild(bar);
    }

    if (id) {
      toast.dataset.toastId = id;
      activeToasts.set(id, toast);
    }

    toastContainer.appendChild(toast);

    // Auto-dismiss timing
    if (autoDismiss != null) {
      setTimeout(() => dismissToast(toast), autoDismiss);
    } else if (type === 'success') {
      setTimeout(() => dismissToast(toast), 3500);
    } else if (type === 'info') {
      setTimeout(() => dismissToast(toast), 4000);
    }

    return toast;
  }

  function dismissToast(toast) {
    if (!toast || toast.classList.contains('exiting')) return;
    toast.classList.add('exiting');
    if (toast.dataset.toastId) {
      activeToasts.delete(toast.dataset.toastId);
    }
    setTimeout(() => toast.remove(), 300);
  }

  function dismissAllToasts() {
    toastContainer.querySelectorAll('.toast:not(.exiting)').forEach(t => dismissToast(t));
    activeToasts.clear();
  }

  // ── Prompt Presets ──────────────────────────────────────
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

  let selectedPreset = 'summarize';

  // ── Load saved settings ────────────────────────────────
  chrome.storage.sync.get([
    'selectedPreset',
    'filterMinScore',
    'filterHideBots',
    'filterAuthorTypes',
    'filterAuthorType',
    'filterTopN',
    'scrapeDepth',
    'quickPrompt',
    'advancedFiltersExpanded',
    'includeHidden'
  ], (result) => {
    selectedPreset = result.selectedPreset || 'summarize';
    updatePresetSelection(selectedPreset);

    // Restore min score custom dropdown
    if (result.filterMinScore) {
      const saved = parseInt(result.filterMinScore, 10);
      const matchingOpt = minScoreDropdown?.querySelector(`[data-value="${saved}"]`);
      if (matchingOpt) setMinScore(saved, matchingOpt.textContent);
    }

    // Hide Bots pill
    if (result.filterHideBots) {
      filterHideBotsBtn?.classList.add('active');
    }

    // Author types - migrate legacy string to array if needed
    let authorTypes = result.filterAuthorTypes;
    if (!Array.isArray(authorTypes)) {
      const legacy = result.filterAuthorType;
      if (legacy === 'op') authorTypes = ['op'];
      else if (legacy === 'flaired') authorTypes = ['flaired'];
      else authorTypes = [];
    }
    if (authorTypes.includes('op')) filterOpOnlyBtn?.classList.add('active');
    if (authorTypes.includes('flaired')) filterFlairedBtn?.classList.add('active');

    // Top N
    if (filterTopN && result.filterTopN) {
      filterTopN.value = String(result.filterTopN);
    }

    // Scrape depth (default: 50 = Full)
    const depth = result.scrapeDepth != null ? result.scrapeDepth : 50;
    depthRadios.forEach(r => {
      r.checked = (parseInt(r.value, 10) === depth);
    });

    // Advanced panel state
    if (result.advancedFiltersExpanded) {
      expandFiltersBtn?.setAttribute('aria-expanded', 'true');
      advancedFilters?.setAttribute('aria-hidden', 'false');
    }

    // Quick prompt - restore if saved
    if (result.quickPrompt && quickPromptInput) {
      quickPromptInput.value = result.quickPrompt;
      quickPromptInput.classList.add('has-content');
      autoExpandTextarea();
      // Quick prompt overrides preset selection display
      updatePresetSelection(null);
    }

    if (includeHidden) {
      includeHidden.checked = result.includeHidden || false;
    }
  });

  // ── Preset card handlers ────────────────────────────────
  presetCards.forEach(card => {
    card.addEventListener('click', () => {
      const presetKey = card.dataset.preset;
      selectedPreset = presetKey;
      updatePresetSelection(presetKey);

      // Clear quick prompt when a preset is selected
      if (quickPromptInput) {
        quickPromptInput.value = '';
        quickPromptInput.style.height = '';
        quickPromptInput.classList.remove('has-content');
        chrome.storage.sync.remove('quickPrompt');
      }

      chrome.storage.sync.set({ selectedPreset: presetKey });

      const presets = getPromptPresets();
      const preset = presets[presetKey];

      if (presetKey === 'custom') {
        chrome.storage.sync.get(['customPromptTemplate'], (res) => {
          const custom = res.customPromptTemplate || DEFAULT_CUSTOM_TEMPLATE;
          chrome.storage.sync.set({ defaultPromptTemplate: custom });
        });
      } else {
        chrome.storage.sync.set({ defaultPromptTemplate: preset.template });
      }

      card.style.transform = 'scale(0.95)';
      setTimeout(() => card.style.transform = '', 100);
    });
  });

  function updatePresetSelection(presetKey) {
    presetCards.forEach(card => {
      card.classList.toggle('selected', card.dataset.preset === presetKey);
    });
  }

  // ── Quick Prompt ───────────────────────────────────────
  let quickPromptDebounce = null;

  function autoExpandTextarea() {
    if (!quickPromptInput) return;
    quickPromptInput.style.height = 'auto';
    quickPromptInput.style.height = Math.min(quickPromptInput.scrollHeight, 72) + 'px';
  }

  if (quickPromptInput) {
    quickPromptInput.addEventListener('input', () => {
      autoExpandTextarea();
      const val = quickPromptInput.value.trim();

      if (val) {
        quickPromptInput.classList.add('has-content');
        // Deselect all presets when quick prompt is active
        updatePresetSelection(null);

        clearTimeout(quickPromptDebounce);
        quickPromptDebounce = setTimeout(() => {
          const template = val.includes('{content}') ? val : val + '\n\n{content}';
          chrome.storage.sync.set({
            quickPrompt: val,
            defaultPromptTemplate: template
          });
        }, 400);
      } else {
        quickPromptInput.classList.remove('has-content');
        quickPromptInput.style.height = '';
        // Restore saved preset
        chrome.storage.sync.get(['selectedPreset'], (res) => {
          const preset = res.selectedPreset || 'summarize';
          selectedPreset = preset;
          updatePresetSelection(preset);
        });
        chrome.storage.sync.remove('quickPrompt');
      }
    });
  }

  // ── Filter handlers ────────────────────────────────────
  if (filterHideBotsBtn) {
    filterHideBotsBtn.addEventListener('click', () => {
      filterHideBotsBtn.classList.toggle('active');
      const active = filterHideBotsBtn.classList.contains('active');
      chrome.storage.sync.set({ filterHideBots: active });
    });
  }

  function updateAuthorFilters() {
    const types = [];
    if (filterOpOnlyBtn?.classList.contains('active')) types.push('op');
    if (filterFlairedBtn?.classList.contains('active')) types.push('flaired');
    // Save array plus legacy string for backward compat
    const legacyType = types.length === 1 ? types[0] : (types.length === 0 ? 'all' : 'multiple');
    chrome.storage.sync.set({
      filterAuthorTypes: types,
      filterAuthorType: legacyType
    });
  }

  if (filterOpOnlyBtn) {
    filterOpOnlyBtn.addEventListener('click', () => {
      filterOpOnlyBtn.classList.toggle('active');
      updateAuthorFilters();
    });
  }

  if (filterFlairedBtn) {
    filterFlairedBtn.addEventListener('click', () => {
      filterFlairedBtn.classList.toggle('active');
      updateAuthorFilters();
    });
  }

  // ── Expand / Collapse advanced filters ─────────────────
  if (expandFiltersBtn) {
    expandFiltersBtn.addEventListener('click', () => {
      const expanded = expandFiltersBtn.getAttribute('aria-expanded') === 'true';
      expandFiltersBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      advancedFilters?.setAttribute('aria-hidden', expanded ? 'true' : 'false');
      chrome.storage.sync.set({ advancedFiltersExpanded: !expanded });
    });
  }

  // ── Advanced filter handlers ───────────────────────────
  if (filterTopN) {
    filterTopN.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10) || 0;
      chrome.storage.sync.set({ filterTopN: val });
    });
  }

  depthRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      chrome.storage.sync.set({ scrapeDepth: parseInt(e.target.value, 10) });
    });
  });

  if (includeHidden) {
    includeHidden.addEventListener('change', (e) => {
      chrome.storage.sync.set({ includeHidden: e.target.checked });
    });
  }

  // ── Render popup state via toasts ──────────────────────
  function renderPopupState(state) {
    if (!state) return;

    if (state.isActive) {
      scrapeBtn.style.display = 'none';
      stopScrapeBtn.style.display = 'flex';
      stopScrapeBtn.disabled = false;

      const pct = state.percentage || 0;
      showToast('progress', state.message || t('popup_status_scraping') || 'Scraping...', {
        id: 'scraping-progress',
        dismiss: false,
        progress: pct
      });
    } else {
      scrapeBtn.style.display = 'flex';
      scrapeBtn.disabled = false;
      stopScrapeBtn.style.display = 'none';

      if (state.error) {
        dismissAllToasts();
        showToast('error', state.error, { dismiss: true });
      } else if (
        state.message?.includes('sent') ||
        state.message?.includes('Content') ||
        state.message?.includes('complete')
      ) {
        dismissAllToasts();
        showToast('success', t('popup_status_sent') || 'Summary sent!');
      } else {
        // Idle - clean UI, no toast
        dismissAllToasts();
      }
    }
  }

  // ── Scrape button ──────────────────────────────────────
  if (scrapeBtn) {
    scrapeBtn.addEventListener('click', () => {
      dismissAllToasts();
      scrapeBtn.disabled = true;

      showToast('progress', t('popup_status_starting') || 'Starting...', {
        id: 'scraping-progress',
        dismiss: false,
        progress: 0
      });

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        if (!currentTab) {
          dismissAllToasts();
          showToast('error', (t('error') || 'Error') + ': Could not get current tab', { dismiss: true });
          scrapeBtn.disabled = false;
          return;
        }

        // Build author types from active pill buttons
        const authorTypes = [];
        if (filterOpOnlyBtn?.classList.contains('active')) authorTypes.push('op');
        if (filterFlairedBtn?.classList.contains('active')) authorTypes.push('flaired');
        const legacyAuthorType = authorTypes.length === 1 ? authorTypes[0] : 'all';

        const filters = {
          minScore: minScoreValue,
          hideBots: filterHideBotsBtn?.classList.contains('active') || false,
          includeHidden: includeHidden?.checked || false,
          authorTypes,
          authorType: legacyAuthorType,
          topN: parseInt(filterTopN?.value || '0', 10),
          scrapeDepth: parseInt(
            document.querySelector('input[name="scrapeDepthPopup"]:checked')?.value || '5',
            10
          )
        };

        chrome.runtime.sendMessage({
          action: 'scrapeReddit',
          includeHidden: filters.includeHidden,
          filters,
          tabId: currentTab.id
        }, (response) => {
          if (chrome.runtime.lastError) {
            dismissAllToasts();
            showToast('error', chrome.runtime.lastError.message, { dismiss: true });
            scrapeBtn.disabled = false;
            return;
          }
          if (response?.currentState) {
            renderPopupState(response.currentState);
          } else if (response?.error) {
            dismissAllToasts();
            showToast('error', response.error, { dismiss: true });
            scrapeBtn.disabled = false;
          }
        });
      });
    });
  }

  // ── Stop button ────────────────────────────────────────
  if (stopScrapeBtn) {
    stopScrapeBtn.addEventListener('click', () => {
      stopScrapeBtn.disabled = true;
      chrome.runtime.sendMessage({ action: 'stopScraping' }, (response) => {
        if (response?.currentState) {
          renderPopupState(response.currentState);
        }
      });
    });
  }

  // ── Listen for state updates ───────────────────────────
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'scrapingStateUpdate') {
      renderPopupState(request.data);
    }
    return true;
  });

  // ── Feedback button ────────────────────────────────────
  if (feedbackBtn) {
    feedbackBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://forms.gle/sZNsAksqgdsKGaRPA' });
    });
  }

  // ── Options button ─────────────────────────────────────
  if (optionsBtn) {
    optionsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  // ── Get initial state ──────────────────────────────────
  chrome.runtime.sendMessage({ action: 'getScrapingState' }, (stateResponse) => {
    if (chrome.runtime.lastError) {
      showToast('error', t('popup_error_extension') || 'Extension error', { dismiss: true });
      scrapeBtn.disabled = true;
      return;
    }
    // Only show toast if actively scraping; idle = clean UI
    if (stateResponse?.isActive) {
      renderPopupState(stateResponse);
    }
  });
});
