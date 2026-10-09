// Reddit to AI - Popup Script

// Localized helpers provided by i18n.js

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.connect === 'function') {
    chrome.runtime.connect({ name: 'keep-alive' });
  }
  await initI18n();
  localizeHtmlPage();

  // Saved prompt presets are shared with the preview page; keep the caps aligned.
  const SAVED_PRESET_CAP = 30;
  const SAVED_PRESETS_VISIBLE = 6;

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

    // Panels carry .r2-reveal, so toggling `hidden` cross-fades them. `hidden`
    // also keeps the inactive pane out of the tab order and accessibility tree.
    document.querySelectorAll('.tab-content').forEach(c => {
      c.hidden = true;
    });

    const targetPane = document.getElementById(btn.getAttribute('data-tab'));
    if (targetPane) {
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
  const notRedditState = document.getElementById('notRedditState');
  const settingsSummaryBtn = document.getElementById('settingsSummaryBtn');
  const settingsSummaryText = document.getElementById('settingsSummaryText');
  const scrapeSettings = document.getElementById('scrapeSettings');
  const savedPresetsRow = document.getElementById('savedPresetsRow');
  const savedPresetChips = document.getElementById('savedPresetChips');
  const filterCountBadge = document.getElementById('filterCountBadge');
  const filtersTab = document.getElementById('tabFilters');
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');
  const exportHint = document.getElementById('exportHint');
  const exportChips = document.querySelectorAll('.popup-export-container .export-chip');
  let currentBatchUrlCount = 0;

  // null = still checking the active tab; true/false once known.
  let activeTabIsThread = null;
  let extensionUnavailable = false;
  let successResetTimer = null;
  let quickPromptDebounce = null;
  let budgetEstimateDebounce = null;

  const EXPORT_DISABLED_HINT = () => t('popup_export_disabled_hint') || 'Exports unlock after your first scrape.';

  function setExportChipsEnabled(enabled) {
    exportChips.forEach(chip => {
      chip.classList.toggle('disabled', !enabled);
      chip.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      if (!chip.dataset.enabledTooltip) chip.dataset.enabledTooltip = chip.getAttribute('data-tooltip') || '';
      // The tooltip explains the disabled state instead of the export format.
      chip.setAttribute('data-tooltip', enabled ? chip.dataset.enabledTooltip : 'popup_export_disabled_hint');
    });
    if (exportHint) exportHint.hidden = enabled;
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
    if (type === 'progress') return '<span class="toast-spinner"></span>';
    const icons = {
      info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
      success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>`,
      error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    };
    return icons[type] || icons.info;
  }

  function setToastProgress(toast, progress) {
    const fill = toast.querySelector('.r2-progress-fill');
    if (fill) fill.style.setProperty('--p', String(Math.max(0, Math.min(100, progress)) / 100));
  }

  function showToast(type, message, options = {}) {
    const { id, dismiss = true, progress = null, autoDismiss = null } = options;

    // If same id exists, update message and progress bar in place
    if (id && activeToasts.has(id)) {
      const existing = activeToasts.get(id);
      const msgEl = existing.querySelector('.toast-message');
      if (msgEl) msgEl.textContent = message;
      if (progress !== null) setToastProgress(existing, progress);
      return existing;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    if (type === 'error') toast.setAttribute('role', 'alert');

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
      dismissBtn.type = 'button';
      dismissBtn.className = 'toast-dismiss';
      dismissBtn.setAttribute('aria-label', t('popup_toast_dismiss') || 'Dismiss');
      dismissBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      dismissBtn.addEventListener('click', () => dismissToast(toast));
      toast.appendChild(dismissBtn);
    }

    // Progress bar (scaleX via --p, never width)
    if (progress !== null) {
      const track = document.createElement('div');
      track.className = 'toast-progress r2-progress';
      const fill = document.createElement('div');
      fill.className = 'r2-progress-fill';
      track.appendChild(fill);
      toast.appendChild(track);
      setToastProgress(toast, progress);
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
    const remove = () => toast.remove();
    toast.addEventListener('animationend', (e) => {
      if (e.target === toast) remove();
    });
    // Fallback in case animations are disabled (reduced motion) or never fire.
    setTimeout(remove, 400);
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
  let savedPresets = [];

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

  // ── Settings disclosure ────────────────────────────────
  function setSettingsExpanded(expanded, { persist = true } = {}) {
    if (!scrapeSettings || !settingsSummaryBtn) return;
    scrapeSettings.hidden = !expanded;
    settingsSummaryBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (persist) chrome.storage.local?.set({ popupSettingsExpanded: expanded });
  }

  settingsSummaryBtn?.addEventListener('click', () => {
    setSettingsExpanded(settingsSummaryBtn.getAttribute('aria-expanded') !== 'true');
  });

  chrome.storage.local?.get(['popupSettingsExpanded'], (res) => {
    if (res?.popupSettingsExpanded) setSettingsExpanded(true, { persist: false });
  });

  function selectedOptionText(select, fallback) {
    return select?.selectedOptions?.[0]?.textContent?.trim() || fallback;
  }

  function updateSettingsSummary() {
    if (!settingsSummaryText) return;
    const parts = [
      getProviderLabel(popupProviderSelect?.value || 'gemini'),
      selectedOptionText(sendModeSelect, 'Preview first'),
      selectedOptionText(outputFormatSelect, 'Auto format')
    ];
    if (quickPromptInput?.value.trim()) parts.push(t('popup_summary_custom_prompt') || 'Custom prompt');
    if (dontSaveThisScrape?.checked) parts.push(t('popup_summary_not_saved') || 'Not saved');
    const text = parts.join(' · ');
    settingsSummaryText.textContent = text;
    settingsSummaryBtn?.setAttribute('title', text);
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
    'customPromptTemplate',
    'savedPromptPresets'
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
    setPill(filterHideBotsBtn, !!result.filterHideBots);

    // Author types - migrate legacy string to array if needed
    let authorTypes = result.filterAuthorTypes;
    if (!Array.isArray(authorTypes)) {
      const legacy = result.filterAuthorType;
      if (legacy === 'op') authorTypes = ['op'];
      else if (legacy === 'flaired') authorTypes = ['flaired'];
      else authorTypes = [];
    }
    setPill(filterOpOnlyBtn, authorTypes.includes('op'));
    setPill(filterFlairedBtn, authorTypes.includes('flaired'));

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

    // Quick prompt - restore if saved
    if (result.quickPrompt && quickPromptInput) {
      quickPromptInput.value = result.quickPrompt;
      quickPromptInput.classList.add('has-content');
      if (saveQuickPromptBtn) saveQuickPromptBtn.disabled = false;
      // Quick prompt overrides preset selection display
      updatePresetSelection(null);
    }

    if (includeHidden) {
      includeHidden.checked = result.includeHidden || false;
    }

    savedPresets = Array.isArray(result.savedPromptPresets) ? result.savedPromptPresets : [];
    renderSavedPresets();

    updateBatchUrlStatus();
    updateScrapeModeUi();
    updateScrapeEstimate();
    updateScrapeAvailability();
  });

  // ── Preset card handlers ────────────────────────────────
  // Cards are native <button>s, so Enter and Space select them for free; the
  // press feedback is CSS (:active), not inline styles.
  presetCards.forEach(card => {
    card.addEventListener('click', () => {
      const presetKey = card.dataset.preset;
      selectedPreset = presetKey;
      updatePresetSelection(presetKey);

      // Clear quick prompt when a preset is selected
      if (quickPromptInput && quickPromptInput.value) {
        quickPromptInput.value = '';
        quickPromptInput.classList.remove('has-content');
        if (saveQuickPromptBtn) saveQuickPromptBtn.disabled = true;
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

      syncSavedPresetPressed();
      updateSettingsSummary();
      updateScrapeEstimate();
    });
  });

  function updatePresetSelection(presetKey) {
    presetCards.forEach(card => {
      const selected = card.dataset.preset === presetKey;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  // ── Quick Prompt ───────────────────────────────────────
  // The textarea grows with its content via CSS `field-sizing: content`
  // (bounded by min/max-height), so typing never forces a JS reflow.

  function quickPromptTemplate() {
    const val = quickPromptInput?.value.trim() || '';
    if (!val) return '';
    return val.includes('{content}') ? val : val + '\n\n{content}';
  }

  function handleQuickPromptChange({ immediate = false } = {}) {
    if (!quickPromptInput) return;
    const val = quickPromptInput.value.trim();
    if (saveQuickPromptBtn) {
      saveQuickPromptBtn.disabled = !val;
      saveQuickPromptBtn.title = val ? '' : (t('popup_save_quick_prompt_disabled') || 'Type a custom prompt first');
    }

    clearTimeout(quickPromptDebounce);
    if (val) {
      quickPromptInput.classList.add('has-content');
      // Deselect all presets when quick prompt is active
      updatePresetSelection(null);

      const persist = () => {
        chrome.storage.sync.set({
          quickPrompt: val,
          defaultPromptTemplate: quickPromptTemplate()
        });
      };
      if (immediate) persist();
      else quickPromptDebounce = setTimeout(persist, 400);
      updateScrapeEstimate();
    } else {
      quickPromptInput.classList.remove('has-content');
      // Restore saved preset
      chrome.storage.sync.get(['selectedPreset'], (res) => {
        const preset = res.selectedPreset || 'summarize';
        selectedPreset = preset;
        updatePresetSelection(preset);
        updateScrapeEstimate();
      });
      chrome.storage.sync.remove('quickPrompt');
    }
    syncSavedPresetPressed();
    updateSettingsSummary();
  }

  if (quickPromptInput) {
    quickPromptInput.addEventListener('input', () => handleQuickPromptChange());
  }

  // ── Saved ("Your presets") ─────────────────────────────
  function savedPresetPromptText(preset) {
    const template = String(preset?.template || '');
    // Presets saved from a quick prompt get "\n\n{content}" appended; strip it so
    // the textarea shows what the user typed. Templates with {content} elsewhere
    // are shown verbatim and round-trip unchanged.
    return /\n*\{content\}\s*$/.test(template) && template.indexOf('{content}') === template.lastIndexOf('{content}')
      ? template.replace(/\s*\{content\}\s*$/, '')
      : template;
  }

  function syncSavedPresetPressed() {
    if (!savedPresetChips) return;
    const current = quickPromptTemplate();
    savedPresetChips.querySelectorAll('.saved-preset-chip[data-preset-id]').forEach(chip => {
      const preset = savedPresets.find(p => p.id === chip.dataset.presetId);
      const active = Boolean(current && preset && preset.template === current);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setRadioValue(radios, value) {
    let matched = false;
    radios.forEach(r => {
      r.checked = r.value === value;
      if (r.checked) matched = true;
    });
    return matched;
  }

  function applySavedPreset(preset) {
    if (!preset || !quickPromptInput) return;
    quickPromptInput.value = savedPresetPromptText(preset);

    const updates = {};
    if (preset.outputFormat && outputFormatSelect?.querySelector(`option[value="${preset.outputFormat}"]`)) {
      outputFormatSelect.value = preset.outputFormat;
      updates.outputFormat = preset.outputFormat;
    }
    if (preset.contextPreset && setRadioValue(contextPresetRadios, preset.contextPreset)) {
      updates.contextPreset = preset.contextPreset;
    }
    if (preset.trimStrategy && trimStrategySelect?.querySelector(`option[value="${preset.trimStrategy}"]`)) {
      trimStrategySelect.value = preset.trimStrategy;
      updates.trimStrategy = preset.trimStrategy;
    }
    if (preset.mediaMode && mediaModeSelect?.querySelector(`option[value="${preset.mediaMode}"]`)) {
      mediaModeSelect.value = preset.mediaMode;
      updates.mediaMode = preset.mediaMode;
    }
    if (Object.keys(updates).length) chrome.storage.sync.set(updates);

    handleQuickPromptChange({ immediate: true });
    const name = preset.name || (t('popup_preset_name_default') || 'Quick prompt');
    showToast('info', t('popup_saved_preset_applied', [name]) || `Using "${name}".`, { autoDismiss: 2200 });
  }

  function renderSavedPresets() {
    if (!savedPresetChips || !savedPresetsRow) return;
    savedPresetChips.replaceChildren();
    if (!savedPresets.length) {
      savedPresetsRow.hidden = true;
      return;
    }

    savedPresets.slice(0, SAVED_PRESETS_VISIBLE).forEach(preset => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'saved-preset-chip';
      chip.dataset.presetId = preset.id || '';
      chip.textContent = preset.name || (t('popup_preset_name_default') || 'Quick prompt');
      chip.title = chip.textContent;
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', () => applySavedPreset(preset));
      savedPresetChips.appendChild(chip);
    });

    const hiddenCount = savedPresets.length - SAVED_PRESETS_VISIBLE;
    if (hiddenCount > 0) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'saved-preset-chip more';
      more.textContent = t('popup_saved_presets_more', [String(hiddenCount)]) || `+${hiddenCount} more`;
      more.title = t('popup_saved_presets_more_title') || 'Manage all presets in Settings';
      more.addEventListener('click', () => chrome.runtime.openOptionsPage());
      savedPresetChips.appendChild(more);
    }

    savedPresetsRow.hidden = false;
    syncSavedPresetPressed();
  }

  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'sync' && changes.savedPromptPresets) {
      const next = changes.savedPromptPresets.newValue;
      savedPresets = Array.isArray(next) ? next : [];
      renderSavedPresets();
    }
  });

  function getProviderLabel(provider) {
    return ({ gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', aistudio: 'AI Studio', deepseek: 'DeepSeek', groq: 'Groq', custom: 'Custom AI' }[provider]) || 'Gemini';
  }

  function getCheckedValue(name, fallback) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
  }

  function getCheckedLabel(name, fallback) {
    return document.querySelector(`input[name="${name}"]:checked + span`)?.textContent?.trim() || fallback;
  }

  // ── Primary button state ───────────────────────────────
  // data-state drives the icon (play / spinner / checkmark) in CSS.
  function setScrapeBtnState(state) {
    if (!scrapeBtn) return;
    scrapeBtn.dataset.state = state;
    const btnText = scrapeBtn.querySelector('.btn-text');
    if (state === 'working') {
      if (btnText) btnText.textContent = t('popup_status_starting') || 'Starting...';
    } else if (state === 'success') {
      if (btnText) btnText.textContent = t('popup_btn_done') || 'Done';
    } else {
      updateScrapeModeUi();
    }
  }

  function updateScrapeModeUi() {
    const previewEnabled = (sendModeSelect?.value || 'preview') === 'preview';
    const btnText = scrapeBtn?.querySelector('.btn-text');
    updateSettingsSummary();
    if (!btnText || (scrapeBtn.dataset.state && scrapeBtn.dataset.state !== 'idle')) return;
    if (currentBatchUrlCount > 0) {
      btnText.textContent = previewEnabled
        ? `Scrape ${currentBatchUrlCount} URLs & Preview`
        : `Send ${currentBatchUrlCount} URLs Once`;
      return;
    }
    const provider = getProviderLabel(popupProviderSelect?.value || 'gemini');
    btnText.textContent = previewEnabled
      ? (t('popup_btn_scrape') || 'Scrape & Preview')
      : (t('popup_btn_scrape_send', [provider]) || `Scrape & Send to ${provider}`);
  }

  // Disables Scrape (and explains why) when there is nothing to scrape.
  function updateScrapeAvailability() {
    const notThread = activeTabIsThread === false;
    const canScrape = !extensionUnavailable && (!notThread || currentBatchUrlCount > 0);
    if (notRedditState) notRedditState.hidden = !notThread || currentBatchUrlCount > 0;
    if (!scrapeBtn) return;
    if (!scrapeBtn.dataset.state || scrapeBtn.dataset.state === 'idle') {
      scrapeBtn.disabled = !canScrape;
    }
    if (!canScrape && !extensionUnavailable) {
      scrapeBtn.title = t('popup_btn_disabled_not_thread') || 'Open a Reddit thread (or add batch URLs in Filters) to scrape.';
    } else {
      scrapeBtn.title = t('popup_btn_shortcut_hint') || 'Shortcut: Ctrl+Enter (Cmd+Enter on Mac)';
    }
  }

  function setScrapeRunning(running) {
    if (!scrapeBtn || !stopScrapeBtn) return;
    const hadFocus = document.activeElement === scrapeBtn || document.activeElement === stopScrapeBtn;
    scrapeBtn.hidden = running;
    stopScrapeBtn.hidden = !running;
    if (running) {
      stopScrapeBtn.disabled = false;
      if (hadFocus) stopScrapeBtn.focus();
    } else if (hadFocus) {
      scrapeBtn.focus();
    }
  }

  function showScrapeSuccess() {
    if (!scrapeBtn) return;
    if (scrapeBtn.dataset.state === 'success') return;
    clearTimeout(successResetTimer);
    scrapeBtn.disabled = true;
    setScrapeBtnState('success');
    successResetTimer = setTimeout(() => {
      setScrapeBtnState('idle');
      updateScrapeAvailability();
    }, 1600);
  }

  function resetScrapeBtn() {
    clearTimeout(successResetTimer);
    setScrapeBtnState('idle');
    updateScrapeAvailability();
  }

  // ── Budget / size estimate ─────────────────────────────
  function formatTokenCount(count) {
    try {
      return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(count);
    } catch {
      return count.toLocaleString();
    }
  }

  function updateBudgetTracker(tokenCount) {
    const bar = document.getElementById('budgetValueBar');
    const label = document.getElementById('budgetLabel');
    if (!bar) return;

    const provider = popupProviderSelect?.value || 'gemini';
    const providerLabel = getProviderLabel(provider);
    // Limits live in promptBuilder.js so popup and preview agree.
    const maxTokens = window.R2AIPrompt?.getContextLimit?.(provider) || 128000;
    const safeLimit = maxTokens * 0.1;
    const moderateLimit = maxTokens * 0.4;

    // scaleX via --p (0..1), never width.
    bar.style.setProperty('--p', String(Math.min(1, tokenCount / maxTokens)));

    let level = '';
    let budgetText = '';
    const formatted = formatTokenCount(tokenCount);
    if (tokenCount === 0) {
      budgetText = activeTabIsThread === false
        ? (t('popup_budget_none') || 'No thread to estimate yet')
        : (t('popup_budget_initial') || 'Budget: 0 tokens');
    } else if (tokenCount < safeLimit) {
      level = 'safe';
      budgetText = t('popup_budget_line_safe', [formatted, providerLabel]) || `~${formatted} tokens · fits ${providerLabel}`;
    } else if (tokenCount < moderateLimit) {
      level = 'moderate';
      budgetText = t('popup_budget_line_moderate', [formatted, providerLabel]) || `~${formatted} tokens · long for ${providerLabel}`;
    } else if (tokenCount < maxTokens) {
      level = 'large';
      budgetText = t('popup_budget_line_large', [formatted, providerLabel]) || `~${formatted} tokens · near ${providerLabel}'s limit`;
    } else {
      level = 'over';
      budgetText = t('popup_budget_line_over', [formatted, providerLabel]) || `~${formatted} tokens · too long for ${providerLabel}`;
    }

    bar.className = 'budget-bar-fill';
    if (level) bar.classList.add(level);

    if (label) {
      label.textContent = budgetText;
      label.className = `budget-text${level ? ` ${level}` : ''}`;
    }
  }

  function updateScrapeEstimate() {
    updateFilterBadge();
    if (!scrapeEstimate) return;
    const contextLabel = getCheckedLabel('contextPresetPopup', 'Balanced');
    const depthLabel = getCheckedLabel('scrapeDepthPopup', 'Full');
    const scope = t('popup_estimate_scope', [contextLabel, depthLabel]) || `${contextLabel} · ${depthLabel} depth`;
    scrapeEstimate.textContent = scope;
    scrapeEstimate.title = scope;

    clearTimeout(budgetEstimateDebounce);
    budgetEstimateDebounce = setTimeout(() => {
      let tokenCount = 0;
      if (cachedPreviewData) {
        const isQuickPrompt = quickPromptInput && quickPromptInput.value.trim();
        let template = '';
        if (isQuickPrompt) {
          template = quickPromptTemplate();
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
      updateSettingsSummary();
      updateScrapeEstimate();
    });
  }

  if (dontSaveThisScrape) {
    dontSaveThisScrape.addEventListener('change', () => {
      updateSettingsSummary();
      updateScrapeEstimate();
    });
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
      chrome.storage.sync.set({ savedPromptPresets: [savedPreset, ...presets].slice(0, SAVED_PRESET_CAP) }, () => {
        showToast('success', t('popup_saved_preset_saved', [name]) || `Saved preset "${name}".`);
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
    if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitPresetName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePresetNameRow();
    }
  });

  // ── Filter handlers ────────────────────────────────────
  function setPill(btn, active) {
    if (!btn) return;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function countActiveFilters() {
    let count = 0;
    if (minScoreValue > 0) count++;
    if (filterHideBotsBtn?.classList.contains('active')) count++;
    if (filterOpOnlyBtn?.classList.contains('active')) count++;
    if (filterFlairedBtn?.classList.contains('active')) count++;
    if ((parseInt(filterTopN?.value || '0', 10) || 0) > 0) count++;
    if (getCheckedValue('scrapeDepthPopup', '50') !== '50') count++;
    if (getCheckedValue('contextPresetPopup', 'balanced') !== 'balanced') count++;
    if ((trimStrategySelect?.value || 'top') !== 'top') count++;
    if ((redditSortModeSelect?.value || 'confidence') !== 'confidence') count++;
    if ((mediaModeSelect?.value || 'attach') !== 'attach') count++;
    if (includeHidden?.checked) count++;
    if (currentBatchUrlCount > 0) count++;
    return count;
  }

  function updateFilterBadge() {
    const count = countActiveFilters();
    if (filterCountBadge) {
      filterCountBadge.textContent = String(count);
      filterCountBadge.hidden = count === 0;
    }
    if (resetFiltersBtn) resetFiltersBtn.hidden = count === 0;
    if (filtersTab) {
      const base = t('popup_tab_filters') || 'Filters';
      if (count > 0) {
        filtersTab.setAttribute('aria-label', `${base}, ${t('popup_filters_active_count', [String(count)]) || `${count} active`}`);
      } else {
        filtersTab.removeAttribute('aria-label');
      }
    }
  }

  function resetFilters() {
    setMinScore(0, { persist: false });
    setPill(filterHideBotsBtn, false);
    setPill(filterOpOnlyBtn, false);
    setPill(filterFlairedBtn, false);
    if (filterTopN) filterTopN.value = '';
    setRadioValue(depthRadios, '50');
    setRadioValue(contextPresetRadios, 'balanced');
    if (trimStrategySelect) trimStrategySelect.value = 'top';
    if (redditSortModeSelect) redditSortModeSelect.value = 'confidence';
    if (mediaModeSelect) mediaModeSelect.value = 'attach';
    if (includeHidden) includeHidden.checked = false;
    if (batchUrlsInput) batchUrlsInput.value = '';
    chrome.storage.sync.set({
      filterMinScore: 0,
      filterHideBots: false,
      filterAuthorTypes: [],
      filterAuthorType: 'all',
      filterTopN: 0,
      scrapeDepth: 50,
      contextPreset: 'balanced',
      trimStrategy: 'top',
      redditSortMode: 'confidence',
      mediaMode: 'attach',
      includeHidden: false,
      lastBatchUrls: ''
    });
    updateBatchUrlStatus();
    updateScrapeModeUi();
    updateScrapeAvailability();
    updateScrapeEstimate();
    filtersTab?.focus();
  }

  resetFiltersBtn?.addEventListener('click', resetFilters);

  if (filterHideBotsBtn) {
    filterHideBotsBtn.addEventListener('click', () => {
      const active = !filterHideBotsBtn.classList.contains('active');
      setPill(filterHideBotsBtn, active);
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
      setPill(filterOpOnlyBtn, !filterOpOnlyBtn.classList.contains('active'));
      updateAuthorFilters();
      updateScrapeEstimate();
    });
  }

  if (filterFlairedBtn) {
    filterFlairedBtn.addEventListener('click', () => {
      setPill(filterFlairedBtn, !filterFlairedBtn.classList.contains('active'));
      updateAuthorFilters();
      updateScrapeEstimate();
    });
  }

  // ── Advanced filter handlers ───────────────────────────
  if (filterTopN) {
    filterTopN.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10) || 0;
      chrome.storage.sync.set({ filterTopN: val });
      updateFilterBadge();
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
      updateScrapeAvailability();
      updateScrapeEstimate();
    });
    batchUrlsInput.addEventListener('change', (e) => {
      chrome.storage.sync.set({ lastBatchUrls: e.target.value.trim() });
    });
  }

  if (includeHidden) {
    includeHidden.addEventListener('change', (e) => {
      chrome.storage.sync.set({ includeHidden: e.target.checked });
      updateFilterBadge();
    });
  }

  // ── Render popup state via toasts ──────────────────────
  function renderPopupState(state) {
    if (!state) return;

    if (state.isActive) {
      clearTimeout(successResetTimer);
      setScrapeBtnState('idle');
      setScrapeRunning(true);
      setExportChipsEnabled(false);

      const pct = state.percentage || 0;
      showToast('progress', state.message || t('popup_status_scraping') || 'Scraping...', {
        id: 'scraping-progress',
        dismiss: false,
        progress: pct
      });
    } else {
      setScrapeRunning(false);

      // `status`/`phase` are the structured signal. The message sniffing below is a
      // last-resort fallback for state objects that predate those fields.
      const finished = state.status
        ? state.status === 'complete'
        : (state.phase === 'complete' ||
          state.message?.includes('sent') ||
          state.message?.includes('Content') ||
          state.message?.includes('complete'));

      if (state.error) {
        resetScrapeBtn();
        dismissAllToasts();
        showToast('error', state.error, { dismiss: true });
      } else if (finished) {
        dismissAllToasts();
        // Checkmark pop on the button itself before the preview opens.
        showScrapeSuccess();
        showToast('success', t('popup_status_sent') || 'Content ready!');
      } else {
        // Idle - clean UI, no toast
        resetScrapeBtn();
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
      if (scrapeBtn.disabled) return;
      dismissAllToasts();
      scrapeBtn.disabled = true;
      setScrapeBtnState('working');

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
          resetScrapeBtn();
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
          mediaMode: mediaModeSelect?.value || 'attach',
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
            resetScrapeBtn();
            return;
          }
          if (response?.currentState) {
            renderPopupState(response.currentState);
          } else if (response?.error) {
            dismissAllToasts();
            showToast('error', response.error, { dismiss: true });
            resetScrapeBtn();
          }
        });
      });
    });
  }

  // ── Keyboard: Ctrl/Cmd+Enter starts scraping from anywhere in the popup ──
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.defaultPrevented) return;
    e.preventDefault();
    if (scrapeBtn && !scrapeBtn.hidden && !scrapeBtn.disabled) scrapeBtn.click();
  });

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

  // ── Active tab check, export availability & initial token estimate ──
  function checkExportAvailability() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs?.[0];
      // Without a readable URL (non-Reddit tab outside our host permissions)
      // there is no thread to scrape.
      activeTabIsThread = Boolean(activeTab?.url && isRedditPostUrl(activeTab.url));
      updateScrapeAvailability();

      if (activeTab && activeTab.url) {
        const activeUrl = activeTab.url;
        loadPreviewData(() => {
          // Check if cachedPreviewData belongs to the current tab
          let activePath = '';
          try { activePath = new URL(activeUrl).pathname; } catch { /* ignore */ }
          const permalink = cachedPreviewData?.post?.permalink;
          const hasMatchingCache = Boolean(permalink) && (
            permalink === activePath || activeUrl.includes(permalink)
          );

          if (hasMatchingCache) {
            updateScrapeEstimate();
          } else if (activeTabIsThread) {
            // No matching cache for this tab: ask for a quick estimate.
            const label = document.getElementById('budgetLabel');
            if (label) {
              label.textContent = t('popup_budget_estimating') || 'Estimating budget...';
              label.className = 'budget-text';
            }

            chrome.runtime.sendMessage({
              action: 'getQuickTokenEstimate',
              tabId: activeTab.id,
              url: activeUrl
            }, (response) => {
              if (chrome.runtime.lastError) {
                updateBudgetTracker(0);
                return;
              }
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
        });
      } else {
        loadPreviewData(() => updateBudgetTracker(0));
      }
    });
  }

  function flashChipDone(chip) {
    if (chip.dataset.flashing) return;
    chip.dataset.flashing = '1';
    const original = chip.innerHTML;
    chip.innerHTML = `<span class="chip-icon" aria-hidden="true">✓</span> ${t('popup_export_done') || 'Saved'}`;
    setTimeout(() => {
      chip.innerHTML = original;
      delete chip.dataset.flashing;
    }, 1500);
  }

  exportChips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.classList.contains('disabled')) {
        // Explain instead of silently ignoring the click.
        showToast('info', EXPORT_DISABLED_HINT(), { id: 'export-disabled', autoDismiss: 2500 });
        return;
      }
      const format = chip.getAttribute('data-format');
      if (!format) return;

      chrome.runtime.sendMessage({ action: 'getPreviewData' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.data) {
          dismissAllToasts();
          showToast('error', t('popup_export_nodata') || 'No data available to export.', { dismiss: true });
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
          const subreddit = (data.post?.subreddit || 'multi-thread').replace(/[/\\?%*:|"<>\s]/g, '_');
          anchor.href = url;
          anchor.download = `reddit-to-ai-export-${subreddit}-${Date.now()}.${ext}`;
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          URL.revokeObjectURL(url);
          flashChipDone(chip);
        } catch (err) {
          console.error('Export failed:', err);
          showToast('error', t('popup_export_failed') || 'Export failed.', { dismiss: true });
        }
      });
    });
  });

  setExportChipsEnabled(false);
  updateSettingsSummary();
  checkExportAvailability();

  // ── Get initial state ──────────────────────────────────
  chrome.runtime.sendMessage({ action: 'getScrapingState' }, (stateResponse) => {
    if (chrome.runtime.lastError) {
      extensionUnavailable = true;
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
