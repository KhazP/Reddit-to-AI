// Reddit to AI - Popup Script

// Localized helpers provided by i18n.js

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.connect === 'function') {
    chrome.runtime.connect({ name: 'keep-alive' });
  }
  await initI18n();
  localizeHtmlPage();

  // ── Tabs ────────────────────────────────────────────────
  const tabTriggers = Array.from(document.querySelectorAll('.tab-trigger'));

  function activateTab(btn, { focus = false } = {}) {
    tabTriggers.forEach(b => {
      const selected = b === btn;
      b.classList.toggle('active', selected);
      b.setAttribute('aria-selected', selected ? 'true' : 'false');
      // Roving tabindex: only the selected tab is a tab stop, so Tab moves past
      // the tablist rather than through every tab in it.
      b.tabIndex = selected ? 0 : -1;
    });

    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.add('hidden');
      // `hidden` alongside the class keeps the pane's children out of the tab
      // order and out of the accessibility tree.
      c.hidden = true;
    });

    const targetPane = document.getElementById(btn.getAttribute('data-tab'));
    if (targetPane) {
      targetPane.classList.remove('hidden');
      targetPane.hidden = false;
    }
    if (focus) btn.focus();
  }

  tabTriggers.forEach((btn, index) => {
    btn.tabIndex = btn.classList.contains('active') ? 0 : -1;
    btn.addEventListener('click', () => activateTab(btn));

    btn.addEventListener('keydown', (e) => {
      let nextIndex = null;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIndex = (index + 1) % tabTriggers.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIndex = (index - 1 + tabTriggers.length) % tabTriggers.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = tabTriggers.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      activateTab(tabTriggers[nextIndex], { focus: true });
    });
  });

  // ── Element references ──────────────────────────────────
  const scrapeBtn = document.getElementById('scrapeBtn');
  const stopScrapeBtn = document.getElementById('stopScrapeBtn');
  const includeHidden = document.getElementById('includeHidden');
  const optionsBtn = document.getElementById('optionsBtn');
  const feedbackBtn = document.getElementById('feedbackBtn');
  const presetCards = document.querySelectorAll('.preset-card');
  const quickPromptInput = document.getElementById('quickPrompt');
  const saveQuickPromptBtn = document.getElementById('saveQuickPromptBtn');
  const outputFormatSelect = document.getElementById('outputFormat');
  const sendModeSelect = document.getElementById('sendModeSelect');
  const popupProviderSelect = document.getElementById('popupProviderSelect');
  const dontSaveThisScrape = document.getElementById('dontSaveThisScrape');
  const scrapeEstimate = document.getElementById('scrapeEstimate');
  const expandFiltersBtn = document.getElementById('expandFiltersBtn');
  const advancedFilters = document.getElementById('advancedFilters');
  const filterHideBotsBtn = document.getElementById('filterHideBotsBtn');
  const filterOpOnlyBtn = document.getElementById('filterOpOnlyBtn');
  const filterFlairedBtn = document.getElementById('filterFlairedBtn');
  const filterTopN = document.getElementById('filterTopN');
  const depthRadios = document.querySelectorAll('input[name="scrapeDepthPopup"]');
  const contextPresetRadios = document.querySelectorAll('input[name="contextPresetPopup"]');
  const trimStrategySelect = document.getElementById('trimStrategy');
  const redditSortModeSelect = document.getElementById('redditSortMode');
  const mediaModeSelect = document.getElementById('mediaMode');
  const batchUrlsInput = document.getElementById('batchUrls');
  const batchUrlStatus = document.getElementById('batchUrlStatus');
  const toastContainer = document.getElementById('toastContainer');
  let currentBatchUrlCount = 0;

  function setExportChipsEnabled(enabled) {
    document.querySelectorAll('.popup-export-container .export-chip').forEach(chip => {
      chip.classList.toggle('disabled', !enabled);
    });
  }

  // ── Min Score select ────────────────────────────────────
  // Native <select>: the browser supplies keyboard nav, typeahead and screen
  // reader semantics that the previous button + div listbox never implemented.
  let minScoreValue = 0;

  const minScoreSelect = document.getElementById('filterMinScore');

  function setMinScore(value, { persist = true } = {}) {
    minScoreValue = value;
    if (minScoreSelect) minScoreSelect.value = String(value);
    if (persist) chrome.storage.sync.set({ filterMinScore: value });
  }

  if (minScoreSelect) {
    minScoreSelect.addEventListener('change', (e) => {
      setMinScore(parseInt(e.target.value, 10) || 0);
      updateScrapeEstimate();
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
  let cachedPreviewData = null;
  let cachedCustomPromptTemplate = '';

  function loadPreviewData(callback) {
    chrome.runtime.sendMessage({ action: 'getPreviewData' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.data) {
        cachedPreviewData = null;
      } else {
        cachedPreviewData = response.data;
      }
      setExportChipsEnabled(!!cachedPreviewData);
      if (callback) callback();
    });
  }

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
    'includeHidden',
    'contextPreset',
    'trimStrategy',
    'redditSortMode',
    'mediaMode',
    'lastBatchUrls',
    'showPromptPreview',
    'selectedLlmProvider',
    'outputFormat',
    'customPromptTemplate'
  ], (result) => {
    cachedCustomPromptTemplate = result.customPromptTemplate || DEFAULT_CUSTOM_TEMPLATE;
    selectedPreset = result.selectedPreset || 'summarize';
    updatePresetSelection(selectedPreset);

    // Restore min score
    if (result.filterMinScore) {
      const saved = parseInt(result.filterMinScore, 10);
      const hasOption = Boolean(minScoreSelect?.querySelector(`option[value="${saved}"]`));
      // Restoring is not a user edit, so it must not write back to storage.
      if (hasOption) setMinScore(saved, { persist: false });
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

    // Context preset (default: Balanced)
    const contextPreset = result.contextPreset || 'balanced';
    contextPresetRadios.forEach(r => {
      r.checked = (r.value === contextPreset);
    });

    if (trimStrategySelect) trimStrategySelect.value = result.trimStrategy || 'top';
    if (redditSortModeSelect) redditSortModeSelect.value = result.redditSortMode || 'confidence';
    if (mediaModeSelect) mediaModeSelect.value = result.mediaMode || 'attach';
    if (batchUrlsInput && result.lastBatchUrls) batchUrlsInput.value = result.lastBatchUrls;
    if (sendModeSelect) sendModeSelect.value = result.showPromptPreview === false ? 'directOnce' : 'preview';
    if (popupProviderSelect) popupProviderSelect.value = result.selectedLlmProvider || 'gemini';
    if (outputFormatSelect) outputFormatSelect.value = result.outputFormat || 'auto';

    // Advanced panel state
    if (result.advancedFiltersExpanded) {
      setAdvancedFiltersExpanded(true);
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
    updateScrapeModeUi();
    updateBatchUrlStatus();
    updateScrapeModeUi();
    updateScrapeEstimate();
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
  let budgetEstimateDebounce = null;

  function autoExpandTextarea() {
    if (!quickPromptInput) return;
    quickPromptInput.style.height = 'auto';
    quickPromptInput.style.height = (quickPromptInput.scrollHeight) + 'px';
  }

  if (quickPromptInput) {
    quickPromptInput.addEventListener('input', () => {
      autoExpandTextarea();
      const val = quickPromptInput.value.trim();
      if (saveQuickPromptBtn) saveQuickPromptBtn.disabled = !val;

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
        updateScrapeEstimate();
      } else {
        quickPromptInput.classList.remove('has-content');
        quickPromptInput.style.height = '';
        // Restore saved preset
        chrome.storage.sync.get(['selectedPreset'], (res) => {
          const preset = res.selectedPreset || 'summarize';
          selectedPreset = preset;
          updatePresetSelection(preset);
          updateScrapeEstimate();
        });
        chrome.storage.sync.remove('quickPrompt');
      }
    });
  }


  function getProviderLabel(provider) {
    return ({ gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', aistudio: 'AI Studio', deepseek: 'DeepSeek', groq: 'Groq', custom: 'Custom' }[provider]) || 'Gemini';
  }

  function getCheckedValue(name, fallback) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
  }

  function updateScrapeModeUi() {
    const previewEnabled = (sendModeSelect?.value || 'preview') === 'preview';
    const btnText = scrapeBtn?.querySelector('.btn-text');
    if (!btnText) return;
    if (currentBatchUrlCount > 0) {
      btnText.textContent = previewEnabled
        ? `Scrape ${currentBatchUrlCount} URLs & Preview`
        : `Send ${currentBatchUrlCount} URLs Once`;
      return;
    }
    btnText.textContent = previewEnabled ? 'Scrape & Preview' : 'Scrape & Send Once';
  }

  function updateBudgetTracker(tokenCount) {
    const bar = document.getElementById('budgetValueBar');
    const label = document.getElementById('budgetLabel');
    if (!bar) return;
    
    const provider = popupProviderSelect?.value || 'gemini';
    let maxTokens = 128000;
    let safeLimit = 32000;
    let moderateLimit = 96000;

    if (provider === 'groq') {
      maxTokens = 131072;
      safeLimit = 30000;
      moderateLimit = 90000;
    } else if (provider === 'chatgpt') {
      maxTokens = 272000;
      safeLimit = 60000;
      moderateLimit = 180000;
    } else if (['gemini', 'aistudio', 'claude', 'deepseek'].includes(provider)) {
      maxTokens = 1048576;
      safeLimit = 200000;
      moderateLimit = 700000;
    }

    const percentage = Math.min(100, (tokenCount / maxTokens) * 100);
    bar.style.width = `${percentage}%`;
    
    bar.className = 'budget-bar-fill';
    const formattedCount = tokenCount.toLocaleString();
    
    let budgetText = '';
    if (tokenCount === 0) {
      budgetText = typeof t === 'function' ? t('popup_budget_initial') : 'Budget: 0 tokens';
    } else if (tokenCount < safeLimit) {
      bar.classList.add('safe');
      budgetText = typeof t === 'function' ? t('popup_budget_safe', [formattedCount]) : `Budget: ${formattedCount} tokens (Safe)`;
    } else if (tokenCount < moderateLimit) {
      bar.classList.add('moderate');
      budgetText = typeof t === 'function' ? t('popup_budget_moderate', [formattedCount]) : `Budget: ${formattedCount} tokens (Moderate)`;
    } else {
      bar.classList.add('large');
      budgetText = typeof t === 'function' ? t('popup_budget_large', [formattedCount]) : `Budget: ${formattedCount} tokens (Large)`;
    }

    if (label) {
      label.innerText = budgetText;
    }

    if (scrapeEstimate) {
      const baseText = scrapeEstimate.textContent.split(' · Budget:')[0];
      if (tokenCount > 0) {
        scrapeEstimate.textContent = `${baseText} · ${budgetText}`;
      } else {
        scrapeEstimate.textContent = `${baseText} · Budget: 0 tokens`;
      }
    }
  }

  function updateScrapeEstimate() {
    if (!scrapeEstimate) return;
    const mode = (sendModeSelect?.value || 'preview') === 'preview' ? 'Preview first' : 'Send directly once';
    const context = getCheckedValue('contextPresetPopup', 'balanced');
    const depth = getCheckedValue('scrapeDepthPopup', '5');
    const provider = getProviderLabel(popupProviderSelect?.value || 'gemini');
    const filters = [];
    if (minScoreValue > 0) filters.push(`${minScoreValue}+ pts`);
    if (filterHideBotsBtn?.classList.contains('active')) filters.push('hide bots');
    if (filterOpOnlyBtn?.classList.contains('active')) filters.push('OP');
    if (filterFlairedBtn?.classList.contains('active')) filters.push('flaired');
    if (dontSaveThisScrape?.checked) filters.push("don't save");
    scrapeEstimate.textContent = `${mode} · ${context} · depth ${depth} · ${provider}${filters.length ? ` · ${filters.join(', ')}` : ''}`;

    clearTimeout(budgetEstimateDebounce);
    budgetEstimateDebounce = setTimeout(() => {
      let tokenCount = 0;
      if (cachedPreviewData) {
        const isQuickPrompt = quickPromptInput && quickPromptInput.value.trim();
        let template = '';
        if (isQuickPrompt) {
          const val = quickPromptInput.value.trim();
          template = val.includes('{content}') ? val : val + '\n\n{content}';
        } else {
          const presetKey = selectedPreset || 'summarize';
          if (presetKey === 'custom') {
            template = cachedCustomPromptTemplate || DEFAULT_CUSTOM_TEMPLATE;
          } else {
            template = getPromptPresets()[presetKey]?.template || '';
          }
        }

        const options = {
          contextPreset: getCheckedValue('contextPresetPopup', 'balanced'),
          trimStrategy: trimStrategySelect?.value || 'top',
          mediaMode: mediaModeSelect?.value || 'attach',
          outputFormat: outputFormatSelect?.value || 'auto'
        };

        try {
          const promptText = R2AIPrompt.buildPromptText(cachedPreviewData, template, options);
          tokenCount = R2AIPrompt.estimatePromptStats(promptText, cachedPreviewData).tokens;
        } catch (err) {
          console.error('Failed to estimate prompt tokens:', err);
        }
      }
      updateBudgetTracker(tokenCount);
    }, 200);
  }

  if (sendModeSelect) {
    sendModeSelect.addEventListener('change', () => {
      updateScrapeModeUi();
      updateScrapeEstimate();
    });
  }

  if (popupProviderSelect) {
    popupProviderSelect.addEventListener('change', (e) => {
      chrome.storage.sync.set({ selectedLlmProvider: e.target.value });
      updateScrapeEstimate();
      updateScrapeModeUi();
    });
  }

  if (outputFormatSelect) {
    outputFormatSelect.addEventListener('change', (e) => {
      chrome.storage.sync.set({ outputFormat: e.target.value });
      updateScrapeEstimate();
    });
  }

  if (dontSaveThisScrape) {
    dontSaveThisScrape.addEventListener('change', updateScrapeEstimate);
  }

  // ── Save quick prompt as preset ────────────────────────
  // window.prompt() is blocked inside action popups in modern Chrome, so the name
  // is collected with an inline row that opens in place instead.
  const presetNameRow = document.getElementById('presetNameRow');
  const presetNameInput = document.getElementById('presetNameInput');
  const presetNameConfirmBtn = document.getElementById('presetNameConfirmBtn');
  const presetNameCancelBtn = document.getElementById('presetNameCancelBtn');

  function closePresetNameRow() {
    if (!presetNameRow) return;
    presetNameRow.hidden = true;
    saveQuickPromptBtn?.focus();
  }

  function openPresetNameRow() {
    const raw = quickPromptInput?.value?.trim();
    if (!raw || !presetNameRow || !presetNameInput) return;
    presetNameInput.value = raw.slice(0, 42) || (t('popup_preset_name_default') || 'Quick prompt');
    presetNameRow.hidden = false;
    presetNameInput.focus();
    presetNameInput.select?.();
  }

  function commitPresetName() {
    const raw = quickPromptInput?.value?.trim();
    const name = presetNameInput?.value?.trim();
    if (!raw || !name) return;

    const template = raw.includes('{content}') ? raw : `${raw}\n\n{content}`;
    const savedPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      category: 'custom',
      createdAt: Date.now(),
      template,
      contextPreset: getCheckedValue('contextPresetPopup', 'balanced'),
      trimStrategy: trimStrategySelect?.value || 'top',
      mediaMode: mediaModeSelect?.value || 'attach',
      outputFormat: outputFormatSelect?.value || 'auto'
    };
    chrome.storage.sync.get(['savedPromptPresets'], (result) => {
      const presets = Array.isArray(result.savedPromptPresets) ? result.savedPromptPresets : [];
      chrome.storage.sync.set({ savedPromptPresets: [savedPreset, ...presets].slice(0, 30) }, () => {
        showToast('success', `Saved preset "${name}".`);
      });
    });
    closePresetNameRow();
  }

  if (saveQuickPromptBtn) {
    saveQuickPromptBtn.addEventListener('click', openPresetNameRow);
  }

  presetNameConfirmBtn?.addEventListener('click', commitPresetName);
  presetNameCancelBtn?.addEventListener('click', closePresetNameRow);

  presetNameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPresetName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePresetNameRow();
    }
  });

  // ── Filter handlers ────────────────────────────────────
  if (filterHideBotsBtn) {
      filterHideBotsBtn.addEventListener('click', () => {
      filterHideBotsBtn.classList.toggle('active');
      const active = filterHideBotsBtn.classList.contains('active');
      chrome.storage.sync.set({ filterHideBots: active });
      updateScrapeEstimate();
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
      updateScrapeEstimate();
    });
  }

  if (filterFlairedBtn) {
    filterFlairedBtn.addEventListener('click', () => {
      filterFlairedBtn.classList.toggle('active');
      updateAuthorFilters();
      updateScrapeEstimate();
    });
  }

  // ── Expand / Collapse advanced filters ─────────────────
  // The panel animates via grid-template-rows, so `hidden` (display:none) would kill
  // the transition. `inert` gives the same "not focusable, not announced" guarantee
  // while leaving the element rendered.
  function setAdvancedFiltersExpanded(expanded) {
    expandFiltersBtn?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (!advancedFilters) return;
    advancedFilters.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    advancedFilters.inert = !expanded;
  }

  if (expandFiltersBtn) {
    expandFiltersBtn.addEventListener('click', () => {
      const expanded = expandFiltersBtn.getAttribute('aria-expanded') === 'true';
      setAdvancedFiltersExpanded(!expanded);
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
      updateScrapeEstimate();
    });
  });

  contextPresetRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      chrome.storage.sync.set({ contextPreset: e.target.value });
      updateScrapeEstimate();
    });
  });

  if (trimStrategySelect) {
    trimStrategySelect.addEventListener('change', (e) => {
      chrome.storage.sync.set({ trimStrategy: e.target.value });
      updateScrapeEstimate();
    });
  }

  if (redditSortModeSelect) {
    redditSortModeSelect.addEventListener('change', (e) => {
      chrome.storage.sync.set({ redditSortMode: e.target.value });
      updateScrapeEstimate();
    });
  }

  if (mediaModeSelect) {
    mediaModeSelect.addEventListener('change', (e) => {
      chrome.storage.sync.set({ mediaMode: e.target.value });
      updateScrapeEstimate();
    });
  }

  if (batchUrlsInput) {
    batchUrlsInput.addEventListener('input', () => {
      updateBatchUrlStatus();
      updateScrapeModeUi();
      updateScrapeEstimate();
    });
    batchUrlsInput.addEventListener('change', (e) => {
      chrome.storage.sync.set({ lastBatchUrls: e.target.value.trim() });
    });
  }

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
      setExportChipsEnabled(false);

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

      // `status`/`phase` are the structured signal. The message sniffing below is a
      // last-resort fallback for state objects that predate those fields.
      const finished = state.status
        ? state.status === 'complete'
        : (state.phase === 'complete' ||
          state.message?.includes('sent') ||
          state.message?.includes('Content') ||
          state.message?.includes('complete'));

      if (state.error) {
        dismissAllToasts();
        showToast('error', state.error, { dismiss: true });
      } else if (finished) {
        dismissAllToasts();
        showToast('success', t('popup_status_sent') || 'Content ready!');
      } else {
        // Idle - clean UI, no toast
        dismissAllToasts();
      }
      checkExportAvailability();
    }
  }

  function isRedditBatchUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/i.test(url.protocol) && (
        /(^|\.)reddit\.com$/i.test(url.hostname) ||
        /(^|\.)redd\.it$/i.test(url.hostname)
      );
    } catch {
      return false;
    }
  }

  function parseBatchUrls(raw) {
    const seen = new Set();
    const valid = [];
    String(raw || '')
      .split(/[\n,]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(item => {
        if (!isRedditBatchUrl(item) || seen.has(item) || valid.length >= 10) return;
        seen.add(item);
        valid.push(item);
      });
    return valid;
  }

  function updateBatchUrlStatus() {
    const raw = batchUrlsInput?.value || '';
    const providedCount = String(raw).split(/[\n,]+/).map(item => item.trim()).filter(Boolean).length;
    const urls = parseBatchUrls(raw);
    currentBatchUrlCount = urls.length;
    if (!batchUrlStatus) return;
    if (urls.length === 0) {
      batchUrlStatus.textContent = 'No batch URLs';
    } else if (urls.length === 1) {
      batchUrlStatus.textContent = '1 batch URL ready';
    } else if (urls.length === 10 && providedCount > 10) {
      batchUrlStatus.textContent = '10 batch URLs ready. Extra URLs will be ignored.';
    } else {
      batchUrlStatus.textContent = `${urls.length} batch URLs ready`;
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

        const batchUrls = parseBatchUrls(batchUrlsInput?.value || '');

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
          ),
          contextPreset: document.querySelector('input[name="contextPresetPopup"]:checked')?.value || 'balanced',
          trimStrategy: trimStrategySelect?.value || 'top',
          redditSortMode: redditSortModeSelect?.value || 'confidence',
          mediaMode: mediaModeSelect?.value || 'attach'
          ,
          outputFormat: outputFormatSelect?.value || 'auto'
        };

        const selectedProvider = popupProviderSelect?.value || 'gemini';
        const directSendOnce = (sendModeSelect?.value || 'preview') === 'directOnce';

        chrome.storage.sync.set({
          contextPreset: filters.contextPreset,
          trimStrategy: filters.trimStrategy,
          redditSortMode: filters.redditSortMode,
          mediaMode: filters.mediaMode,
          outputFormat: filters.outputFormat,
          selectedLlmProvider: selectedProvider,
          lastBatchUrls: batchUrlsInput?.value?.trim() || ''
        });

        chrome.runtime.sendMessage({
          action: 'scrapeReddit',
          includeHidden: filters.includeHidden,
          filters,
          batchUrls,
          tabId: currentTab.id,
          directSendOnce: directSendOnce,
          showPromptPreview: !directSendOnce,
          selectedLlmProvider: selectedProvider,
          dataStorageOptionOverride: dontSaveThisScrape?.checked ? 'dontSave' : null
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

  function isRedditPostUrl(urlStr) {
    try {
      const url = new URL(urlStr);
      if (!/(^|\.)reddit\.com$/i.test(url.hostname) && !/(^|\.)redd\.it$/i.test(url.hostname)) {
        return false;
      }
      return url.pathname.includes('/comments/');
    } catch {
      return false;
    }
  }

  // ── Export options select & Initial Token Check ──────────
  function checkExportAvailability() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab && activeTab.url) {
        const activeUrl = activeTab.url;
        loadPreviewData(() => {
          // Check if cachedPreviewData belongs to the current tab
          const hasMatchingCache = cachedPreviewData && (
            cachedPreviewData.post?.permalink === new URL(activeUrl).pathname ||
            activeUrl.includes(cachedPreviewData.post?.permalink)
          );

          if (hasMatchingCache) {
            updateScrapeEstimate();
          } else {
            // No matching cache for this tab, check if it's a Reddit post
            if (isRedditPostUrl(activeUrl)) {
              // Show estimating message
              const label = document.getElementById('budgetLabel');
              if (label) label.innerText = t('popup_budget_estimating') || 'Estimating budget...';

              chrome.runtime.sendMessage({
                action: 'getQuickTokenEstimate',
                tabId: activeTab.id,
                url: activeUrl
              }, (response) => {
                if (response && response.estimatedData) {
                  cachedPreviewData = response.estimatedData;
                  updateScrapeEstimate();
                } else {
                  updateBudgetTracker(0);
                }
              });
            } else {
              updateBudgetTracker(0);
            }
          }
        });
      } else {
        loadPreviewData(() => updateScrapeEstimate());
      }
    });
  }

  document.querySelectorAll('.popup-export-container .export-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.classList.contains('disabled')) return;
      const format = chip.getAttribute('data-format');
      if (!format) return;

      chrome.runtime.sendMessage({ action: 'getPreviewData' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.data) {
          dismissAllToasts();
          showToast('error', 'No data available to export.', { dismiss: true });
          return;
        }

        const data = response.data;
        let content = '';
        let mimeType = 'text/plain';
        let ext = 'txt';

        try {
          if (format === 'markdown') {
            content = R2AIPrompt.exportToMarkdown(data);
            mimeType = 'text/markdown;charset=utf-8;';
            ext = 'md';
          } else if (format === 'json') {
            content = R2AIPrompt.exportToJSON(data);
            mimeType = 'application/json;charset=utf-8;';
            ext = 'json';
          } else if (format === 'csv') {
            content = R2AIPrompt.exportToCSV(data);
            mimeType = 'text/csv;charset=utf-8;';
            ext = 'csv';
          } else {
            return;
          }

          const blob = new Blob([content], { type: mimeType });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          const subreddit = (data.post?.subreddit || 'multi-thread').replace(/[\/\\?%*:|"<>\s]/g, '_');
          anchor.href = url;
          anchor.download = `reddit-to-ai-export-${subreddit}-${Date.now()}.${ext}`;
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          URL.revokeObjectURL(url);
          showToast('success', `Exported as ${format.toUpperCase()}!`);
        } catch (err) {
          console.error('Export failed:', err);
          showToast('error', 'Export failed.', { dismiss: true });
        }
      });
    });
  });

  checkExportAvailability();

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

  // The popup shows an approximate budget only, so it deliberately does not load
  // the 1MB tokenizer table; estimatePromptStats falls back to length / 4 here.
});
