// Reddit to AI - Prompt Preview page
let previewState = {
  data: null,
  settings: {},
  template: '',
  renderedData: null,
  dirty: false,
  generatedPrompt: '',
  pendingGeneratedPrompt: '',
  pendingRenderedData: null,
  pendingBuildOptions: null,
  sendInFlight: false,
  hasCustomPruning: false,
  apiStatus: null,
  apiInFlight: false,
  apiTimer: null,
  historyId: null,
  loaded: false,
  loadFailed: false,
  tokenizerPending: false,
  treeSignature: ''
};

const els = {};

// Saved presets are shared with the popup, which keeps the newest 30.
const MAX_SAVED_PRESETS = 30;
const BUTTON_FEEDBACK_MS = 1500;
const PROVIDER_NAMES = {
  gemini: 'Gemini',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  aistudio: 'AI Studio',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  custom: 'Custom'
};
const TAB_PANEL_IDS = {
  prompt: 'tabPanelPrompt',
  prune: 'tabPanelPrune',
  api: 'tabPanelApi'
};
const IS_MAC = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
const MOD_KEY_LABEL = IS_MAC ? '⌘' : 'Ctrl';

// Per-button feedback ("Copied ✓", "Sent ✓", …) timers and resting labels.
const buttonFeedbackTimers = new Map();
const buttonIdleLabels = new Map();

// Localized string with an English fallback. `t` comes from i18n.js and may be
// absent (tests) or return '' for keys that are not in the active locale yet.
function tr(key, fallback, substitutions) {
  if (typeof t === 'function') {
    const message = t(key, substitutions || []);
    if (message) return message;
  }
  if (!substitutions || !substitutions.length) return fallback;
  return substitutions.reduce(
    (text, sub, index) => text.replace(new RegExp(`\\$${index + 1}`, 'g'), String(sub)),
    fallback
  );
}

function toggleClass(element, className, on) {
  if (!element?.classList) return;
  if (on) element.classList.add(className);
  else element.classList.remove(className);
}

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.connect === 'function') {
    chrome.runtime.connect({ name: 'keep-alive' });
  }
  if (typeof initI18n === 'function') {
    await initI18n();
    localizeHtmlPage();
  }

  bindElements();
  bindEvents();
  applyShortcutHints();
  loadPreviewData();
  loadDirectApiStatus();

  // The preview page is where exact token counts matter, so it triggers the lazy
  // tokenizer load and refreshes the displayed count once the rank table is ready.
  // Until then the budget card shows a skeleton instead of a rough number.
  if (typeof globalThis.R2ATiktokenEnsure === 'function') {
    previewState.tokenizerPending = true;
    setBudgetComputing(true);
    Promise.resolve()
      .then(() => globalThis.R2ATiktokenEnsure())
      .catch(() => { /* fall back to the heuristic estimate */ })
      .then(() => {
        previewState.tokenizerPending = false;
        if (els.promptTextarea && (previewState.renderedData || previewState.data)) {
          updateBudget(els.promptTextarea.value, previewState.renderedData || previewState.data);
        } else if (!previewState.loaded) {
          // Still waiting for data (or the load failed): leave the skeleton to loadPreviewData.
          setBudgetComputing(!previewState.loadFailed);
        }
      });
  }
});

function bindElements() {
  els.tabBtns = document.querySelectorAll('.tab-btn');
  els.tabPanels = document.querySelectorAll('.tab-panel');
  els.pruneBadge = document.getElementById('pruneBadge');
  els.exportDropdown = document.getElementById('exportDropdown');
  els.exportDropdownBtn = document.getElementById('exportDropdownBtn');
  els.exportDropdownMenu = document.getElementById('exportDropdownMenu');
  els.threadMeta = document.getElementById('threadMeta');
  els.warningLabel = document.getElementById('warningLabel');
  els.warningMessage = document.getElementById('warningMessage');
  els.charCount = document.getElementById('charCount');
  els.tokenCount = document.getElementById('tokenCount');
  els.commentCount = document.getElementById('commentCount');
  els.imageCount = document.getElementById('imageCount');
  els.meterTrack = document.getElementById('meterTrack');
  els.meterFill = document.getElementById('meterFill');
  els.budgetCard = document.getElementById('budgetCard');
  els.contextPresetSelect = document.getElementById('contextPresetSelect');
  els.trimStrategySelect = document.getElementById('trimStrategySelect');
  els.mediaModeSelect = document.getElementById('mediaModeSelect');
  els.providerSelect = document.getElementById('providerSelect');
  els.outputFormatSelect = document.getElementById('outputFormatSelect');
  els.promptTextarea = document.getElementById('promptTextarea');
  els.copyBtn = document.getElementById('copyBtn');
  els.exportChips = document.querySelectorAll('.export-chip');
  els.savePresetBtn = document.getElementById('savePresetBtn');
  els.presetNameRow = document.getElementById('presetNameRow');
  els.presetNameInput = document.getElementById('presetNameInput');
  els.presetNameCancelBtn = document.getElementById('presetNameCancelBtn');
  els.sendBtn = document.getElementById('sendBtn');
  els.sendBtnLabel = document.getElementById('sendBtnLabel');
  els.resumeBtn = document.getElementById('resumeBtn');
  els.missingCommentsCard = document.getElementById('missingCommentsCard');
  els.missingCommentsText = document.getElementById('missingCommentsText');
  els.statusText = document.getElementById('statusText');
  els.statusMessage = document.getElementById('statusMessage');
  els.backBtnTop = document.getElementById('backBtnTop');
  els.loadErrorPanel = document.getElementById('loadErrorPanel');
  els.loadErrorMessage = document.getElementById('loadErrorMessage');
  els.loadRetryBtn = document.getElementById('loadRetryBtn');
  els.skipPreviewToggle = document.getElementById('skipPreviewToggle');
  els.settingsSummary = document.getElementById('settingsSummary');
  els.restorePromptBtn = document.getElementById('restorePromptBtn');
  els.rebuildNotice = document.getElementById('rebuildNotice');
  els.applyRebuiltPromptBtn = document.getElementById('applyRebuiltPromptBtn');
  els.keepEditsBtn = document.getElementById('keepEditsBtn');
  els.apiProviderSelect = document.getElementById('apiProviderSelect');
  els.sendApiBtn = document.getElementById('sendApiBtn');
  els.apiNotConfigured = document.getElementById('apiNotConfigured');
  els.apiNotConfiguredText = document.getElementById('apiNotConfiguredText');
  els.apiOpenOptionsBtn = document.getElementById('apiOpenOptionsBtn');
  els.apiLoading = document.getElementById('apiLoading');
  els.apiElapsed = document.getElementById('apiElapsed');
  els.apiError = document.getElementById('apiError');
  els.apiErrorMessage = document.getElementById('apiErrorMessage');
  els.apiRetryBtn = document.getElementById('apiRetryBtn');
  els.apiResult = document.getElementById('apiResult');
  els.apiResultMeta = document.getElementById('apiResultMeta');
  els.apiResponseText = document.getElementById('apiResponseText');
  els.apiCopyBtn = document.getElementById('apiCopyBtn');
  els.commentsTreeContainer = document.getElementById('commentsTreeContainer');
  els.selectAllCommentsBtn = document.getElementById('selectAllCommentsBtn');
  els.clearAllCommentsBtn = document.getElementById('clearAllCommentsBtn');
}

function bindEvents() {
  els.tabBtns?.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    });
    btn.addEventListener('keydown', handleTabKeydown);
  });

  // Export menu: click/ArrowDown opens, arrows move, Escape/Tab/outside click close.
  els.exportDropdownBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isExportMenuOpen()) closeExportMenu(false);
    else openExportMenu('first');
  });
  els.exportDropdownBtn?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openExportMenu(e.key === 'ArrowUp' ? 'last' : 'first');
    }
  });
  els.exportDropdownMenu?.addEventListener('keydown', handleExportMenuKeydown);
  els.exportDropdown?.addEventListener('focusout', (e) => {
    if (!isExportMenuOpen()) return;
    if (e.relatedTarget && els.exportDropdown.contains(e.relatedTarget)) return;
    if (!e.relatedTarget) return; // pointer clicks are handled by the document listener
    closeExportMenu(false);
  });

  document.addEventListener('click', (e) => {
    if (isExportMenuOpen() && els.exportDropdown && !els.exportDropdown.contains(e.target)) {
      closeExportMenu(false);
    }
  });
  document.addEventListener('keydown', handleGlobalShortcuts);

  [els.contextPresetSelect, els.trimStrategySelect, els.mediaModeSelect, els.outputFormatSelect].forEach(select => {
    select?.addEventListener('change', () => {
      previewState.dirty = false;
      previewState.hasCustomPruning = false; // Reset on preset/strategy change
      chrome.storage.sync.set({
        contextPreset: els.contextPresetSelect.value,
        trimStrategy: els.trimStrategySelect.value,
        mediaMode: els.mediaModeSelect.value,
        outputFormat: els.outputFormatSelect.value
      });
      rebuildPrompt();
    });
  });

  els.providerSelect?.addEventListener('change', () => {
    chrome.storage.sync.set({ selectedLlmProvider: els.providerSelect.value });
    updateBudget(els.promptTextarea.value, previewState.renderedData || previewState.data);
    updateSettingsSummary();
    updateSendButtonLabel();
  });

  els.promptTextarea?.addEventListener('input', () => {
    previewState.dirty = true;
    if (els.restorePromptBtn) els.restorePromptBtn.disabled = els.promptTextarea.value === previewState.generatedPrompt;
    updateBudget(els.promptTextarea.value, previewState.renderedData || previewState.data);
  });

  els.copyBtn?.addEventListener('click', copyPrompt);
  els.exportChips.forEach(chip => {
    chip.addEventListener('click', () => {
      closeExportMenu(true);
      const format = chip.getAttribute('data-format');
      exportPrompt(format);
    });
  });
  els.savePresetBtn?.addEventListener('click', () => {
    if (isPresetRowOpen()) closePresetNameRow();
    else openPresetNameRow();
  });
  els.presetNameRow?.addEventListener('submit', (e) => {
    e.preventDefault();
    commitPresetName();
  });
  els.presetNameCancelBtn?.addEventListener('click', closePresetNameRow);
  els.presetNameInput?.addEventListener('input', () => {
    els.presetNameInput.removeAttribute?.('aria-invalid');
  });
  els.sendBtn?.addEventListener('click', sendPrompt);
  els.resumeBtn?.addEventListener('click', resumeMissingComments);
  els.backBtnTop?.addEventListener('click', focusRedditTab);
  els.loadRetryBtn?.addEventListener('click', loadPreviewData);
  els.restorePromptBtn?.addEventListener('click', restoreGeneratedPrompt);
  els.applyRebuiltPromptBtn?.addEventListener('click', applyRebuiltPrompt);
  els.keepEditsBtn?.addEventListener('click', keepEditedPrompt);
  els.skipPreviewToggle?.addEventListener('change', () => {
    chrome.storage.sync.set({ showPromptPreview: !els.skipPreviewToggle.checked });
    setStatus(els.skipPreviewToggle.checked
      ? tr('preview_status_skip_on', 'Next time, scrapes will go straight to the AI chat.')
      : tr('preview_status_skip_off', 'Next time, scrapes will open this preview first.'), 'success');
  });

  els.selectAllCommentsBtn?.addEventListener('click', () => {
    toggleAllCheckboxes(true);
  });
  els.clearAllCommentsBtn?.addEventListener('click', () => {
    toggleAllCheckboxes(false);
  });
  els.commentsTreeContainer?.addEventListener('change', handleCheckboxChange);

  els.apiProviderSelect?.addEventListener('change', () => {
    chrome.storage.local.set({ lastDirectApiProvider: els.apiProviderSelect.value });
    updateApiAvailability();
  });
  els.sendApiBtn?.addEventListener('click', sendPromptViaApi);
  els.apiRetryBtn?.addEventListener('click', sendPromptViaApi);
  els.apiCopyBtn?.addEventListener('click', copyApiResponse);
  els.apiOpenOptionsBtn?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

// =====================
// Status + button feedback
// =====================

// tone: 'info' | 'busy' | 'success' | 'error'
function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setStatus(message, tone = 'info') {
  const target = els.statusMessage || els.statusText;
  if (!target) return;
  const changed = target.textContent !== message;
  target.textContent = message;
  els.statusText?.setAttribute('data-tone', tone);
  // Small fade-up so a new message is noticed (Web Animations, transform/opacity only).
  if (changed && typeof target.animate === 'function' && !prefersReducedMotion()) {
    target.animate(
      [{ opacity: 0, transform: 'translateY(2px)' }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
    );
  }
}

function getButtonLabelEl(button) {
  return button?.querySelector ? button.querySelector('.btn-label') : null;
}

function getIdleLabel(button) {
  if (button === els.sendBtn) return getSendButtonLabel();
  return buttonIdleLabels.get(button) || '';
}

// Shows a state on the button itself: 'busy' (spinner, disabled by caller),
// 'success' / 'error' (temporary label), or '' to return to rest.
function setButtonFeedback(button, state, label, resetMs) {
  if (!button) return;
  const labelEl = getButtonLabelEl(button);
  if (labelEl && button !== els.sendBtn && !buttonIdleLabels.has(button)) {
    buttonIdleLabels.set(button, labelEl.textContent);
  }
  const pending = buttonFeedbackTimers.get(button);
  if (pending) {
    clearTimeout(pending);
    buttonFeedbackTimers.delete(button);
  }
  button.setAttribute('data-state', state || 'idle');
  button.setAttribute('aria-busy', state === 'busy' ? 'true' : 'false');
  if (labelEl) labelEl.textContent = label || getIdleLabel(button);
  if (resetMs) {
    buttonFeedbackTimers.set(button, setTimeout(() => {
      buttonFeedbackTimers.delete(button);
      setButtonFeedback(button, '', null);
    }, resetMs));
  }
}

function getProviderName(provider) {
  return PROVIDER_NAMES[provider] || tr('preview_provider_fallback', 'AI');
}

function getSendButtonLabel() {
  return tr('preview_send_to', 'Send to $1', [getProviderName(els.providerSelect?.value || 'gemini')]);
}

function updateSendButtonLabel() {
  if (!els.sendBtnLabel) return;
  const state = els.sendBtn?.getAttribute?.('data-state');
  if (state && state !== 'idle') return; // a feedback label is showing; it resets to this later
  els.sendBtnLabel.textContent = getSendButtonLabel();
}

function applyShortcutHints() {
  if (typeof document.querySelectorAll === 'function') {
    document.querySelectorAll('.kbd-mod').forEach(kbd => { kbd.textContent = MOD_KEY_LABEL; });
  }
  document.getElementById('tabNav')?.setAttribute('aria-label', tr('preview_tabs_label', 'Preview views'));
  applyActionTitles();
  updateSendButtonLabel();
}

function applyActionTitles() {
  if (els.sendBtn) {
    els.sendBtn.title = `${tr('preview_send_title', 'Open the AI chat with this prompt')} (${MOD_KEY_LABEL}+Enter)`;
  }
  if (els.copyBtn) {
    els.copyBtn.title = `${tr('preview_copy_title', 'Copy prompt to clipboard')} (${MOD_KEY_LABEL}+Shift+C)`;
  }
  if (els.sendApiBtn) {
    els.sendApiBtn.title = `${tr('preview_api_send', 'Send via API')} (${MOD_KEY_LABEL}+Enter)`;
  }
}

// Disabled controls explain why: used when the thread could not be loaded.
function setPromptActionsAvailable(available) {
  const reason = tr('preview_needs_thread', 'Load a thread first — there is no prompt yet.');
  [els.sendBtn, els.copyBtn, els.savePresetBtn, els.exportDropdownBtn].forEach(button => {
    if (!button) return;
    button.disabled = !available;
    if (!available) button.title = reason;
  });
  if (available) {
    applyActionTitles();
    if (els.exportDropdownBtn) els.exportDropdownBtn.title = '';
    if (els.savePresetBtn) els.savePresetBtn.title = tr('preview_save_preset_title', 'Save the current prompt and settings as a reusable preset');
  }
}

// =====================
// Keyboard
// =====================

function hasActiveTextSelection() {
  const active = document.activeElement;
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')
    && typeof active.selectionStart === 'number' && active.selectionStart !== active.selectionEnd) {
    return true;
  }
  const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
  return Boolean(selection && String(selection).length > 0);
}

function getActiveTabKey() {
  const active = Array.from(els.tabBtns || []).find(btn => btn.getAttribute('aria-selected') === 'true');
  return active?.getAttribute('data-tab') || 'prompt';
}

function handleGlobalShortcuts(e) {
  if (e.key === 'Escape') {
    if (isExportMenuOpen()) {
      e.preventDefault();
      closeExportMenu(true);
      return;
    }
    if (isPresetRowOpen()) {
      e.preventDefault();
      closePresetNameRow();
    }
    return;
  }

  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey || e.isComposing) return;

  // Ctrl/Cmd+Enter runs the primary action of the visible view.
  if (e.key === 'Enter' && !e.shiftKey) {
    if (e.target === els.presetNameInput) return;
    e.preventDefault();
    if (getActiveTabKey() === 'api') {
      if (els.sendApiBtn && !els.sendApiBtn.disabled) sendPromptViaApi();
    } else {
      sendPrompt();
    }
    return;
  }

  // Ctrl/Cmd+Shift+C copies the prompt, unless the user has text selected
  // (then the keystroke is left to the browser).
  if (e.shiftKey && (e.code === 'KeyC' || e.key === 'C' || e.key === 'c')) {
    if (hasActiveTextSelection()) return;
    e.preventDefault();
    copyPrompt();
  }
}

// =====================
// Tabs (roving tabindex)
// =====================

function switchTab(tabKey, options = {}) {
  if (!tabKey) return;
  if (els.tabBtns) {
    els.tabBtns.forEach(btn => {
      const isTarget = btn.getAttribute('data-tab') === tabKey;
      toggleClass(btn, 'active', isTarget);
      btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
      btn.setAttribute('tabindex', isTarget ? '0' : '-1');
      if (isTarget && options.focus) btn.focus();
    });
  }
  const targetPanelId = TAB_PANEL_IDS[tabKey] || `tabPanel${tabKey.charAt(0).toUpperCase() + tabKey.slice(1)}`;
  if (els.tabPanels) {
    els.tabPanels.forEach(panel => {
      const isActive = panel.id === targetPanelId;
      toggleClass(panel, 'active', isActive);
      panel.hidden = !isActive;
    });
  }
  if (isExportMenuOpen()) closeExportMenu(false);
}

function handleTabKeydown(e) {
  const tabs = Array.from(els.tabBtns || []);
  const index = tabs.indexOf(e.currentTarget);
  if (index === -1) return;
  let next;
  switch (e.key) {
    case 'ArrowRight': next = (index + 1) % tabs.length; break;
    case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break;
    case 'Home': next = 0; break;
    case 'End': next = tabs.length - 1; break;
    default: return;
  }
  e.preventDefault();
  switchTab(tabs[next].getAttribute('data-tab'), { focus: true });
}

// =====================
// Export menu
// =====================

function getExportItems() {
  return Array.from(els.exportChips || []);
}

function isExportMenuOpen() {
  return Boolean(els.exportDropdownMenu && els.exportDropdownMenu.hidden === false);
}

function openExportMenu(focusWhich = 'first') {
  if (!els.exportDropdownMenu || els.exportDropdownBtn?.disabled) return;
  els.exportDropdownMenu.hidden = false;
  toggleClass(els.exportDropdown, 'open', true);
  els.exportDropdownBtn?.setAttribute('aria-expanded', 'true');
  const items = getExportItems();
  const target = focusWhich === 'last' ? items[items.length - 1] : items[0];
  target?.focus();
}

function closeExportMenu(returnFocus) {
  if (!els.exportDropdownMenu) return;
  const wasOpen = isExportMenuOpen();
  els.exportDropdownMenu.hidden = true;
  toggleClass(els.exportDropdown, 'open', false);
  els.exportDropdownBtn?.setAttribute('aria-expanded', 'false');
  if (wasOpen && returnFocus) els.exportDropdownBtn?.focus();
}

function handleExportMenuKeydown(e) {
  const items = getExportItems();
  if (!items.length) return;
  const index = items.indexOf(document.activeElement);
  let next = null;
  switch (e.key) {
    case 'ArrowDown': next = index < 0 ? 0 : (index + 1) % items.length; break;
    case 'ArrowUp': next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length; break;
    case 'Home': next = 0; break;
    case 'End': next = items.length - 1; break;
    case 'Escape':
      e.preventDefault();
      e.stopPropagation();
      closeExportMenu(true);
      return;
    case 'Tab':
      closeExportMenu(false);
      return;
    default: return;
  }
  e.preventDefault();
  items[next]?.focus();
}

// =====================
// Data loading
// =====================

function showLoadError(message) {
  previewState.loadFailed = true;
  if (els.loadErrorMessage) els.loadErrorMessage.textContent = message;
  if (els.loadErrorPanel) els.loadErrorPanel.hidden = false;
  if (els.promptTextarea) {
    els.promptTextarea.value = '';
    els.promptTextarea.disabled = true;
  }
  if (els.threadMeta) els.threadMeta.textContent = tr('preview_no_thread', 'No thread loaded');
  setPromptActionsAvailable(false);
  setBudgetComputing(false);
  if (els.warningLabel) els.warningLabel.textContent = '—';
  if (els.warningMessage) els.warningMessage.textContent = tr('preview_budget_unavailable', 'The budget appears once a thread is loaded.');
}

function hideLoadError() {
  previewState.loadFailed = false;
  if (els.loadErrorPanel) els.loadErrorPanel.hidden = true;
  if (els.promptTextarea) els.promptTextarea.disabled = false;
}

function loadPreviewData() {
  setStatus(tr('preview_status_loading', 'Loading scraped thread…'), 'busy');
  if (els.loadRetryBtn) els.loadRetryBtn.disabled = true;
  chrome.runtime.sendMessage({ action: 'getPreviewData' }, (response) => {
    if (els.loadRetryBtn) els.loadRetryBtn.disabled = false;
    if (chrome.runtime.lastError || response?.error || !response?.data) {
      const error = response?.error || chrome.runtime.lastError?.message
        || tr('preview_load_error_none', 'No scraped thread was found for this tab. It may have expired.');
      showLoadError(error);
      setStatus(tr('preview_status_load_failed', "Couldn't load the thread."), 'error');
      return;
    }

    const wasFailed = previewState.loadFailed;
    hideLoadError();
    if (wasFailed) setPromptActionsAvailable(true);
    previewState.loaded = true;
    previewState.data = response.data;
    previewState.settings = response.settings || {};
    previewState.historyId = response.historyId || null;
    previewState.template = previewState.settings.defaultPromptTemplate || 'Please analyze the following Reddit thread.\n\n{content}';

    els.contextPresetSelect.value = previewState.settings.contextPreset || 'balanced';
    els.trimStrategySelect.value = previewState.settings.trimStrategy || response.data.filtersApplied?.trimStrategy || 'top';
    els.mediaModeSelect.value = previewState.settings.mediaMode || 'attach';
    els.providerSelect.value = previewState.settings.selectedLlmProvider || 'gemini';
    els.outputFormatSelect.value = previewState.settings.outputFormat || 'auto';
    if (els.skipPreviewToggle) els.skipPreviewToggle.checked = previewState.settings.showPromptPreview === false;
    updateSendButtonLabel();

    updateThreadMeta();
    rebuildPrompt();
    let allComments = [];
    if (previewState.data.threads) {
      previewState.data.threads.forEach(t => {
        allComments = allComments.concat(t.comments || []);
      });
    } else {
      allComments = previewState.data.comments || [];
    }
    renderCommentTree(allComments);
    updateMissingCommentsNotice();
    updateSettingsSummary();
    setStatus(tr('preview_status_ready', 'Ready. Review or edit the prompt, then send it.'), 'info');
  });
}

function updateThreadMeta() {
  if (!els.threadMeta || !previewState.data) return;
  if (Array.isArray(previewState.data.threads)) {
    els.threadMeta.textContent = tr('preview_threads_combined', '$1 Reddit threads combined for comparison.', [String(previewState.data.threads.length)]);
    return;
  }
  const post = previewState.data.post || {};
  const title = post.title || 'Untitled thread';
  const subreddit = post.subreddit ? `r/${post.subreddit}` : 'unknown subreddit';
  els.threadMeta.textContent = `${title} · ${subreddit}`;
  els.threadMeta.title = els.threadMeta.textContent;
}

function getCurrentBuildOptions() {
  return {
    contextPreset: els.contextPresetSelect?.value || 'balanced',
    trimStrategy: els.trimStrategySelect?.value || 'top',
    mediaMode: els.mediaModeSelect?.value || 'attach',
    outputFormat: els.outputFormatSelect?.value || 'auto'
  };
}

function buildPromptForOptions(options) {
  if (!previewState.data || !window.R2AIPrompt) return;
  let renderedData;
  if (previewState.hasCustomPruning) {
    renderedData = JSON.parse(JSON.stringify(previewState.data));
    const selectedIds = new Set(getSelectedCommentIds());
    if (renderedData.threads) {
      renderedData.threads = renderedData.threads.map(thread => ({
        ...thread,
        comments: R2AIPrompt.rebuildTreeFromSelected(thread.comments, selectedIds)
      }));
    } else {
      renderedData.comments = R2AIPrompt.rebuildTreeFromSelected(renderedData.comments, selectedIds);
    }
  } else {
    renderedData = R2AIPrompt.applyContextPreset(previewState.data, options.contextPreset, options);
  }
  const prompt = R2AIPrompt.buildPromptText(renderedData, previewState.template, {
    ...options,
    contextPreset: null,
    skipContextPreset: true
  });
  return { renderedData, prompt, options };
}

function setPendingRebuild(result) {
  previewState.pendingGeneratedPrompt = result?.prompt || '';
  previewState.pendingRenderedData = result?.renderedData || null;
  previewState.pendingBuildOptions = result?.options || null;
  setRebuildControlsVisible(Boolean(result));
}

function setRebuildControlsVisible(visible) {
  if (els.rebuildNotice) els.rebuildNotice.hidden = !visible;
  if (els.applyRebuiltPromptBtn) els.applyRebuiltPromptBtn.hidden = !visible;
  if (els.keepEditsBtn) els.keepEditsBtn.hidden = !visible;
}

function rebuildPrompt() {
  const result = buildPromptForOptions(getCurrentBuildOptions());
  if (!result) return;
  if (previewState.dirty) {
    setPendingRebuild(result);
    setStatus(tr('preview_rebuild_notice', 'Settings changed. Your edited prompt was kept.'), 'info');
    updateSettingsSummary();
    return;
  }
  applyGeneratedPrompt(result);
}

function applyGeneratedPrompt(result) {
  previewState.renderedData = result.renderedData;
  const prompt = result.prompt;
  previewState.generatedPrompt = prompt;
  if (els.promptTextarea) els.promptTextarea.value = prompt;
  previewState.dirty = false;
  setPendingRebuild(null);
  if (els.restorePromptBtn) els.restorePromptBtn.disabled = true;
  updateBudget(prompt, previewState.renderedData);
  updateSettingsSummary();

  if (!previewState.hasCustomPruning) {
    let allComments = [];
    if (result.renderedData.threads) {
      result.renderedData.threads.forEach(t => {
        allComments = allComments.concat(t.comments || []);
      });
    } else {
      allComments = result.renderedData.comments || [];
    }
    renderCommentTree(allComments);
  }
}

function applyRebuiltPrompt() {
  if (!previewState.pendingGeneratedPrompt || !previewState.pendingRenderedData) return;
  applyGeneratedPrompt({
    prompt: previewState.pendingGeneratedPrompt,
    renderedData: previewState.pendingRenderedData,
    options: previewState.pendingBuildOptions || getCurrentBuildOptions()
  });
  setStatus(tr('preview_status_rebuilt', 'Rebuilt prompt applied.'), 'success');
}

function keepEditedPrompt() {
  setPendingRebuild(null);
  setStatus(tr('preview_status_kept', 'Edited prompt kept.'), 'info');
}

// =====================
// Budget card
// =====================

function setBudgetComputing(on) {
  toggleClass(els.budgetCard, 'is-computing', on);
  els.budgetCard?.setAttribute('aria-busy', on ? 'true' : 'false');
}

function updateBudget(promptText, dataForStats) {
  if (!window.R2AIPrompt) return;
  const stats = R2AIPrompt.estimatePromptStats(promptText, dataForStats, els.providerSelect?.value || 'gemini');
  els.charCount.textContent = formatNumber(stats.chars);
  els.tokenCount.textContent = formatNumber(stats.tokens);
  els.commentCount.textContent = formatNumber(stats.comments);
  els.imageCount.textContent = formatNumber(stats.images);
  els.warningLabel.textContent = tr('preview_budget_level', 'Size: $1', [stats.warning.label]);
  els.warningMessage.textContent = getProviderGuidance(stats, els.providerSelect?.value || 'gemini');

  // The fill is scaled (transform), never resized, so the update stays on the compositor.
  const percent = Math.max(0, Math.min(100, Number(stats.percentOfLargeContext) || 0));
  const fillStyle = els.meterFill?.style;
  if (fillStyle && typeof fillStyle.setProperty === 'function') {
    fillStyle.setProperty('--p', String(percent / 100));
  }
  els.meterTrack?.setAttribute('aria-valuenow', String(percent));

  ['low', 'medium', 'high', 'critical'].forEach(key => toggleClass(els.budgetCard, key, key === stats.warning.key));
  setBudgetComputing(previewState.tokenizerPending);
}

function getProviderGuidance(stats, provider) {
  const providerName = PROVIDER_NAMES[provider] || 'this AI platform';
  if (stats.warning.key === 'critical') return tr('preview_guidance_critical', '$1 may reject or truncate this. Use Balanced or Small before sending.', [providerName]);
  if (stats.warning.key === 'high') return tr('preview_guidance_high', '$1 should handle this only on large-context models. Consider trimming comments.', [providerName]);
  if (stats.warning.key === 'medium') return tr('preview_guidance_medium', '$1 should usually accept this, but smaller models may shorten the answer.', [providerName]);
  return tr('preview_guidance_low', '$1 should have comfortable room for this prompt.', [providerName]);
}

function updateSettingsSummary() {
  if (!els.settingsSummary) return;
  const metadata = previewState.data?.metadata || {};
  const filters = previewState.data?.filtersApplied || {};
  const labels = [
    `Preset: ${metadata.preset || previewState.settings.selectedPreset || 'summarize'}`,
    `AI: ${els.providerSelect?.selectedOptions?.[0]?.textContent || 'Gemini'}`,
    `Budget: ${els.contextPresetSelect?.value || metadata.contextPreset || 'balanced'}`,
    `Trim strategy: ${els.trimStrategySelect?.value || filters.trimStrategy || 'top'}`,
    `Sort: ${metadata.redditSortMode || filters.redditSortMode || 'confidence'}`,
    `Depth: ${metadata.scrapeDepth || previewState.data?.maxDepth || 'unknown'}`,
    `Comments: ${metadata.finalCommentCount || metadata.commentCount || R2AIPrompt.countDataComments(previewState.renderedData || previewState.data)}`,
    `Format: ${els.outputFormatSelect?.value || 'auto'}`
  ];
  els.settingsSummary.innerHTML = '';
  labels.forEach(label => {
    const pill = document.createElement('span');
    pill.className = 'summary-pill';
    pill.textContent = label;
    els.settingsSummary.appendChild(pill);
  });
}

function restoreGeneratedPrompt() {
  if (!els.promptTextarea) return;
  els.promptTextarea.value = previewState.generatedPrompt || '';
  previewState.dirty = false;
  setPendingRebuild(null);
  if (els.restorePromptBtn) els.restorePromptBtn.disabled = true;
  updateBudget(els.promptTextarea.value, previewState.renderedData || previewState.data);
  setStatus(tr('preview_status_restored', 'Generated prompt restored.'), 'success');
}

function updateMissingCommentsNotice() {
  const failed = previewState.data?.metadata?.failedMoreIds || [];
  if (!els.missingCommentsCard) return;
  els.missingCommentsCard.hidden = failed.length === 0;
  if (failed.length > 0 && els.missingCommentsText) {
    els.missingCommentsText.textContent = tr(
      'preview_missing_count',
      '$1 replies could not be loaded. Try loading them again before sending.',
      [formatNumber(failed.length)]
    );
  }
}

// =====================
// Copy / export / presets
// =====================

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      els.promptTextarea.select();
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

async function copyPrompt() {
  if (els.copyBtn?.disabled) return;
  const text = els.promptTextarea?.value || '';
  if (!text.trim()) {
    setStatus(tr('preview_status_nothing_to_copy', 'The prompt is empty — nothing to copy.'), 'error');
    setButtonFeedback(els.copyBtn, 'error', tr('preview_empty_short', 'Empty'), BUTTON_FEEDBACK_MS);
    return;
  }
  const ok = await copyText(text);
  if (ok) {
    setStatus(tr('preview_status_copied', 'Prompt copied to clipboard.'), 'success');
    setButtonFeedback(els.copyBtn, 'success', tr('preview_copied', 'Copied ✓'), BUTTON_FEEDBACK_MS);
  } else {
    setStatus(tr('preview_status_copy_failed', "Couldn't copy. Select the text and press Ctrl+C instead."), 'error');
    setButtonFeedback(els.copyBtn, 'error', tr('preview_copy_failed', 'Copy failed'), BUTTON_FEEDBACK_MS * 2);
  }
}

function exportPrompt(format) {
  if (!format) return;

  const data = previewState.renderedData || previewState.data;
  if (!data) {
    setStatus(tr('preview_status_export_nodata', 'No data available to export.'), 'error');
    return;
  }

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
    anchor.download = `reddit-to-ai-preview-${subreddit}-${Date.now()}.${ext}`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setStatus(tr('preview_status_exported', 'Exported as $1.', [ext.toUpperCase()]), 'success');
  } catch (err) {
    console.error('Export failed:', err);
    setStatus(tr('preview_status_export_failed', 'Export failed.'), 'error');
  }
}

function isPresetRowOpen() {
  return Boolean(els.presetNameRow && els.presetNameRow.hidden === false);
}

function getDefaultPresetName() {
  const subreddit = previewState.data?.post?.subreddit;
  return subreddit
    ? tr('preview_preset_name_sub', 'r/$1 preset', [subreddit])
    : tr('preview_preset_name_default', 'Custom preview preset');
}

function openPresetNameRow() {
  if (!els.presetNameRow || !els.presetNameInput) return;
  els.presetNameInput.value = getDefaultPresetName();
  els.presetNameInput.removeAttribute?.('aria-invalid');
  els.presetNameRow.hidden = false;
  els.savePresetBtn?.setAttribute('aria-expanded', 'true');
  els.presetNameInput.focus();
  els.presetNameInput.select?.();
}

function closePresetNameRow(options = {}) {
  if (!els.presetNameRow) return;
  const wasOpen = isPresetRowOpen();
  els.presetNameRow.hidden = true;
  els.savePresetBtn?.setAttribute('aria-expanded', 'false');
  if (wasOpen && options.returnFocus !== false) els.savePresetBtn?.focus();
}

function commitPresetName() {
  const name = els.presetNameInput?.value?.trim() || '';
  if (!name) {
    els.presetNameInput?.setAttribute('aria-invalid', 'true');
    els.presetNameInput?.focus();
    setStatus(tr('preview_status_preset_name_needed', 'Give the preset a name first.'), 'error');
    return;
  }
  const template = deriveTemplateFromCurrentPrompt();
  const savedPreset = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    category: 'custom',
    createdAt: Date.now(),
    template,
    contextPreset: els.contextPresetSelect.value,
    trimStrategy: els.trimStrategySelect.value,
    mediaMode: els.mediaModeSelect.value,
    outputFormat: els.outputFormatSelect?.value || 'auto'
  };
  closePresetNameRow();
  chrome.storage.sync.get(['savedPromptPresets'], (result) => {
    const presets = Array.isArray(result.savedPromptPresets) ? result.savedPromptPresets : [];
    chrome.storage.sync.set({ savedPromptPresets: [savedPreset, ...presets].slice(0, MAX_SAVED_PRESETS) }, () => {
      if (chrome.runtime.lastError) {
        setStatus(tr('preview_status_preset_failed', "Couldn't save the preset: $1", [chrome.runtime.lastError.message]), 'error');
        setButtonFeedback(els.savePresetBtn, 'error', tr('preview_save_failed', 'Not saved'), BUTTON_FEEDBACK_MS * 2);
        return;
      }
      setStatus(tr('preview_status_preset_saved', 'Saved preset “$1”.', [name]), 'success');
      setButtonFeedback(els.savePresetBtn, 'success', tr('preview_saved', 'Saved ✓'), BUTTON_FEEDBACK_MS);
    });
  });
}

function deriveTemplateFromCurrentPrompt() {
  const editedText = els.promptTextarea?.value || '';
  if (editedText.includes('{content}')) return editedText;
  if (!previewState.dirty || !window.R2AIPrompt) return previewState.template;

  const options = getCurrentBuildOptions();
  const contentOnly = R2AIPrompt.buildPromptText(
    previewState.renderedData || previewState.data,
    '{content}',
    { ...options, contextPreset: null }
  );
  if (contentOnly && editedText.includes(contentOnly)) {
    return editedText.replace(contentOnly, '{content}');
  }
  return previewState.template;
}

// =====================
// Send to AI chat tab
// =====================

function sendPrompt() {
  if (previewState.sendInFlight) {
    setStatus(tr('preview_status_already_sending', 'Already opening AI tab.'), 'busy');
    return;
  }
  if (els.sendBtn?.disabled) return;
  const promptText = els.promptTextarea.value.trim();
  if (!promptText) {
    setStatus(tr('preview_status_empty', 'The prompt is empty — add some text before sending.'), 'error');
    setButtonFeedback(els.sendBtn, 'error', tr('preview_empty_short', 'Empty'), BUTTON_FEEDBACK_MS);
    return;
  }
  const providerName = getProviderName(els.providerSelect.value);
  setSendInFlight(true);
  setStatus(tr('preview_status_opening', 'Opening $1…', [providerName]), 'busy');
  chrome.runtime.sendMessage({
    action: 'sendPromptToAi',
    promptText,
    aiProvider: els.providerSelect.value,
    mediaMode: els.mediaModeSelect.value,
    renderedData: previewState.renderedData || previewState.data
  }, (response) => {
    setSendInFlight(false);
    if (chrome.runtime.lastError || response?.error) {
      setStatus(response?.error || chrome.runtime.lastError?.message || tr('preview_status_send_failed', 'Could not send the prompt. Try again, or copy it instead.'), 'error');
      setButtonFeedback(els.sendBtn, 'error', tr('preview_send_failed', 'Failed — try again'), BUTTON_FEEDBACK_MS * 2);
      return;
    }
    setStatus(tr('preview_status_sent', '$1 opened. If the prompt isn’t pasted automatically, use the copy button on that page.', [providerName]), 'success');
    setButtonFeedback(els.sendBtn, 'success', tr('preview_sent', 'Sent ✓'), BUTTON_FEEDBACK_MS);
  });
}

function setSendInFlight(inFlight) {
  previewState.sendInFlight = inFlight;
  if (!els.sendBtn) return;
  els.sendBtn.disabled = inFlight;
  if (inFlight) setButtonFeedback(els.sendBtn, 'busy', tr('preview_sending', 'Opening…'));
  else setButtonFeedback(els.sendBtn, '', null);
}

// =====================
// Direct API mode
// =====================
//
// The response is rendered with textContent (never innerHTML): it is model output
// built from untrusted Reddit text, so it is treated as data, not markup. CSS
// `white-space: pre-wrap` is what preserves its line breaks and indentation.

function loadDirectApiStatus() {
  if (!els.apiProviderSelect) return;
  chrome.runtime.sendMessage({ action: 'getDirectApiStatus' }, (response) => {
    if (chrome.runtime.lastError || response?.error || !response?.providers) {
      previewState.apiStatus = null;
      updateApiAvailability();
      return;
    }
    previewState.apiStatus = response.providers;
    els.apiProviderSelect.textContent = '';
    Object.values(response.providers).forEach(provider => {
      const option = document.createElement('option');
      option.value = provider.id;
      // Built with textContent so a provider label can never inject markup.
      option.textContent = provider.configured ? provider.label : tr('preview_api_no_key_option', '$1 (no key)', [provider.label]);
      els.apiProviderSelect.appendChild(option);
    });

    chrome.storage.local.get(['lastDirectApiProvider'], (stored) => {
      const preferred = stored?.lastDirectApiProvider;
      // Default to the first provider that actually has a key configured.
      const firstConfigured = Object.values(response.providers).find(p => p.configured);
      const chosen = (preferred && response.providers[preferred])
        ? preferred
        : (firstConfigured?.id || Object.keys(response.providers)[0]);
      if (chosen) els.apiProviderSelect.value = chosen;
      updateApiAvailability();
    });
  });
}

// A key added on the options page must take effect without reloading this tab:
// the "Add a key in options" link would otherwise lead back to a still-disabled
// button. An in-flight request is left alone so the refresh cannot re-enable
// controls mid-send.
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.directApiConfig) return;
    if (previewState.apiInFlight) return;
    loadDirectApiStatus();
  });
}

function getSelectedApiProvider() {
  const id = els.apiProviderSelect?.value;
  if (!id || !previewState.apiStatus) return null;
  return previewState.apiStatus[id] || null;
}

function updateApiAvailability() {
  const provider = getSelectedApiProvider();
  const configured = Boolean(provider?.configured);
  if (els.sendApiBtn) {
    els.sendApiBtn.disabled = !configured || previewState.apiInFlight;
    els.sendApiBtn.title = configured
      ? `${tr('preview_api_send', 'Send via API')} (${MOD_KEY_LABEL}+Enter)`
      : tr('preview_api_send_disabled', 'Add an API key for this provider in Options to send.');
  }
  if (els.apiNotConfigured) els.apiNotConfigured.hidden = configured;
  if (!configured && provider && els.apiNotConfiguredText) {
    els.apiNotConfiguredText.textContent =
      tr('preview_api_no_key_for', 'No API key is configured for $1.', [provider.label]);
  }
}

function setApiInFlight(inFlight) {
  previewState.apiInFlight = inFlight;
  if (els.sendApiBtn) els.sendApiBtn.disabled = inFlight || !getSelectedApiProvider()?.configured;
  if (els.apiRetryBtn) els.apiRetryBtn.disabled = inFlight;
  if (els.apiProviderSelect) els.apiProviderSelect.disabled = inFlight;
  if (els.apiLoading) els.apiLoading.hidden = !inFlight;
  if (inFlight) setButtonFeedback(els.sendApiBtn, 'busy', tr('preview_api_sending', 'Sending…'));
  else setButtonFeedback(els.sendApiBtn, '', null);

  if (previewState.apiTimer) {
    clearInterval(previewState.apiTimer);
    previewState.apiTimer = null;
  }
  if (inFlight) {
    const startedAt = Date.now();
    if (els.apiElapsed) els.apiElapsed.textContent = '0s';
    previewState.apiTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      if (els.apiElapsed) els.apiElapsed.textContent = `${seconds}s`;
    }, 1000);
  }
}

function showApiError(message, retryable) {
  if (!els.apiError) return;
  els.apiError.hidden = false;
  const suffix = retryable
    ? ` ${tr('preview_api_retryable', 'This looks temporary — try again in a moment.')}`
    : '';
  els.apiErrorMessage.textContent = `${message}${suffix}`;
}

function clearApiError() {
  if (els.apiError) els.apiError.hidden = true;
  if (els.apiErrorMessage) els.apiErrorMessage.textContent = '';
}

function sendPromptViaApi() {
  if (previewState.apiInFlight) return;
  const provider = getSelectedApiProvider();
  if (!provider?.configured) {
    updateApiAvailability();
    return;
  }
  const promptText = els.promptTextarea?.value.trim() || '';
  if (!promptText) {
    showApiError(tr('preview_api_empty_prompt', 'Prompt is empty.'), false);
    setButtonFeedback(els.sendApiBtn, 'error', tr('preview_empty_short', 'Empty'), BUTTON_FEEDBACK_MS);
    return;
  }

  clearApiError();
  if (els.apiResult) els.apiResult.hidden = true;
  setApiInFlight(true);
  setStatus(tr('preview_api_status_sending', 'Sending the prompt to the API…'), 'busy');

  chrome.runtime.sendMessage({
    action: 'sendPromptViaApi',
    apiProvider: provider.id,
    promptText,
    historyId: previewState.historyId
  }, (response) => {
    setApiInFlight(false);
    if (chrome.runtime.lastError || response?.error || !response?.response) {
      const message = response?.error
        || chrome.runtime.lastError?.message
        || tr('preview_api_failed', 'The API request failed.');
      // A dropped message channel (worker torn down mid-request) is worth retrying.
      const retryable = response?.retryable === true || Boolean(chrome.runtime.lastError);
      showApiError(message, retryable);
      setStatus(tr('preview_api_status_failed', 'API request failed.'), 'error');
      setButtonFeedback(els.sendApiBtn, 'error', tr('preview_api_failed_short', 'Failed'), BUTTON_FEEDBACK_MS * 2);
      return;
    }
    renderApiResponse(response.response);
    setButtonFeedback(els.sendApiBtn, 'success', tr('preview_api_done', 'Done ✓'), BUTTON_FEEDBACK_MS);
  });
}

function renderApiResponse(result) {
  if (!els.apiResult || !els.apiResponseText) return;
  els.apiResult.hidden = false;

  if (result.refused) {
    els.apiResponseText.textContent =
      tr('preview_api_refused', 'The provider declined to answer this request.');
  } else if (!result.text) {
    els.apiResponseText.textContent =
      tr('preview_api_empty_response', 'The provider returned an empty response.');
  } else {
    // textContent, never innerHTML.
    els.apiResponseText.textContent = result.text;
  }

  const seconds = Math.round((result.durationMs || 0) / 1000);
  const parts = [result.model, `${seconds}s`];
  if (result.truncated) {
    parts.push(tr('preview_api_truncated', 'truncated at the token limit'));
  }
  els.apiResultMeta.textContent = parts.filter(Boolean).join(' · ');
  setStatus(tr('preview_api_status_done', 'API response received.'), 'success');
}

async function copyApiResponse() {
  const text = els.apiResponseText?.textContent || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus(tr('preview_api_copied', 'API response copied to clipboard.'), 'success');
    setButtonFeedback(els.apiCopyBtn, 'success', tr('preview_copied', 'Copied ✓'), BUTTON_FEEDBACK_MS);
  } catch (error) {
    setStatus(`${tr('preview_status_copy_failed_short', 'Copy failed.')} ${error.message || ''}`.trim(), 'error');
    setButtonFeedback(els.apiCopyBtn, 'error', tr('preview_copy_failed', 'Copy failed'), BUTTON_FEEDBACK_MS * 2);
  }
}

// =====================
// Missing replies / navigation
// =====================

function resumeMissingComments() {
  els.resumeBtn.disabled = true;
  setButtonFeedback(els.resumeBtn, 'busy', tr('preview_missing_resuming', 'Loading replies…'));
  setStatus(tr('preview_status_resuming', 'Trying to load the missing replies…'), 'busy');
  chrome.runtime.sendMessage({ action: 'resumeMissingComments' }, (response) => {
    els.resumeBtn.disabled = false;
    setButtonFeedback(els.resumeBtn, '', null);
    if (chrome.runtime.lastError || response?.error) {
      setStatus(response?.error || chrome.runtime.lastError?.message || tr('preview_status_resume_failed', "Couldn't load the missing replies."), 'error');
      setButtonFeedback(els.resumeBtn, 'error', tr('preview_try_again', 'Try again'), BUTTON_FEEDBACK_MS * 2);
      return;
    }
    if (response?.data) {
      previewState.data = response.data;
      previewState.dirty = false;
      updateThreadMeta();
      rebuildPrompt();
      updateMissingCommentsNotice();
      setStatus(tr('preview_status_resumed', 'Done. Added $1 replies.', [formatNumber(response.addedCount || 0)]), 'success');
    }
  });
}

function focusRedditTab() {
  chrome.runtime.sendMessage({ action: 'focusLastRedditTab' }, (response) => {
    if (chrome.runtime.lastError || response?.error) {
      setStatus(response?.error || chrome.runtime.lastError?.message || tr('preview_status_focus_failed', "Couldn't find the Reddit tab."), 'error');
    }
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

// =====================
// Comment tree (Prune tab)
// =====================

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getSnippet(text) {
  const cleanText = text || '';
  if (cleanText.length <= 100) return escapeHtml(cleanText);
  return escapeHtml(cleanText.substring(0, 100)) + '...';
}

function buildCommentTreeHtml(comment, checkedIds, collapsedIds) {
  const hasReplies = Array.isArray(comment.replies) && comment.replies.length > 0;
  const author = escapeHtml(comment.author || '[deleted]');
  const score = typeof comment.score === 'number' ? comment.score : 0;
  const isChecked = checkedIds.has(comment.id);
  const snippet = getSnippet(comment.text);
  // comment.id is scraped from the page, so it is escaped like every other
  // interpolated value even though Reddit ids are normally plain `t1_xxxxx`.
  const commentId = escapeHtml(comment.id == null ? '' : String(comment.id));

  const checkboxHtml = `<input type="checkbox" class="comment-checkbox" data-id="${commentId}" ${isChecked ? 'checked' : ''}>`;
  const metaHtml = `<span class="comment-meta"><span class="author">u/${author}</span> <span class="score">(${score} pts)</span></span>`;
  const textHtml = `<span class="comment-text-snippet">${snippet}</span>`;

  if (hasReplies) {
    const childrenHtml = comment.replies.map(reply => buildCommentTreeHtml(reply, checkedIds, collapsedIds)).join('');
    const isOpen = !(collapsedIds && collapsedIds.has(String(comment.id)));
    return `
      <details ${isOpen ? 'open ' : ''}class="comment-node" data-comment-id="${commentId}">
        <summary class="comment-summary">
          <span class="comment-chevron" aria-hidden="true"></span>
          ${checkboxHtml}
          ${metaHtml}
          ${textHtml}
        </summary>
        ${childrenHtml}
      </details>
    `;
  } else {
    return `
      <div class="comment-leaf" data-comment-id="${commentId}">
        ${checkboxHtml}
        ${metaHtml}
        ${textHtml}
      </div>
    `;
  }
}

function updatePruneBadge() {
  if (!els.pruneBadge) return;
  const checkboxes = els.commentsTreeContainer?.querySelectorAll('.comment-checkbox');
  if (!checkboxes || !checkboxes.length) {
    els.pruneBadge.textContent = '0';
    return;
  }
  let selected = 0;
  for (const cb of checkboxes) {
    if (cb.checked && !cb.disabled) selected++;
  }
  els.pruneBadge.textContent = `${selected}/${checkboxes.length}`;
}

function getTreeSignature(comments) {
  const parts = [];
  (function walk(list, depth) {
    for (const comment of list || []) {
      parts.push(`${depth}:${comment.id}`);
      walk(comment.replies, depth + 1);
    }
  })(comments, 0);
  return parts.join('|');
}

function renderTreeEmptyState() {
  const title = escapeHtml(tr('preview_tree_empty_title', 'No comments to choose from'));
  const body = escapeHtml(tr('preview_tree_empty_body', 'This thread has no comments, or the current context preset left none in the prompt.'));
  return `
    <div class="tree-empty">
      <svg class="tree-empty-icon" viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
      <strong>${title}</strong>
      <p>${body}</p>
    </div>
  `;
}

function renderCommentTree(comments) {
  const container = els.commentsTreeContainer;
  if (!container) return;
  if (!Array.isArray(comments) || comments.length === 0) {
    container.innerHTML = renderTreeEmptyState();
    previewState.treeSignature = '';
    updatePruneBadge();
    return;
  }

  // Same comments as what is already on screen: keep the DOM (and with it the
  // scroll position and which branches are collapsed); only reset the selection.
  const signature = getTreeSignature(comments);
  if (signature === previewState.treeSignature) {
    const checkboxes = container.querySelectorAll('.comment-checkbox');
    if (checkboxes && checkboxes.length) {
      for (const cb of checkboxes) cb.checked = true;
      updateCheckboxPropagation();
      return;
    }
  }

  const checkedIds = new Set();
  function gatherIds(list) {
    for (const comment of list || []) {
      checkedIds.add(comment.id);
      gatherIds(comment.replies);
    }
  }
  gatherIds(comments);

  // Different comments: rebuild, but carry over collapsed branches and scroll.
  const collapsedIds = new Set();
  for (const node of container.querySelectorAll('details.comment-node') || []) {
    if (!node.open) collapsedIds.add(node.getAttribute('data-comment-id'));
  }
  const scrollTop = container.scrollTop || 0;

  container.innerHTML = comments.map(comment => buildCommentTreeHtml(comment, checkedIds, collapsedIds)).join('');
  if (scrollTop) container.scrollTop = scrollTop;
  previewState.treeSignature = signature;
  updateCheckboxPropagation();
  updatePruneBadge();
}

function updateCheckboxPropagation() {
  const container = els.commentsTreeContainer;
  if (!container) return;
  const roots = container.children;
  for (const root of roots) {
    propagateNode(root, true);
  }
  updatePruneBadge();
}

function propagateNode(element, parentCheckedAndEnabled) {
  const isLeaf = element.classList.contains('comment-leaf');
  const isNode = element.classList.contains('comment-node');
  if (!isLeaf && !isNode) return;

  let checkbox;
  if (isLeaf) {
    checkbox = element.querySelector(':scope > .comment-checkbox');
  } else {
    checkbox = element.querySelector(':scope > .comment-summary > .comment-checkbox');
  }

  if (!checkbox) return;

  if (!parentCheckedAndEnabled) {
    checkbox.disabled = true;
  } else {
    checkbox.disabled = false;
  }

  if (isNode) {
    const childCheckedAndEnabled = parentCheckedAndEnabled && checkbox.checked;
    const childNodes = element.querySelectorAll(':scope > .comment-node, :scope > .comment-leaf');
    for (const child of childNodes) {
      propagateNode(child, childCheckedAndEnabled);
    }
  }
}

function handleCheckboxChange(e) {
  if (!e.target.classList.contains('comment-checkbox')) return;
  previewState.hasCustomPruning = true;
  updateCheckboxPropagation();
  rebuildPrompt();
}

function toggleAllCheckboxes(checked) {
  const checkboxes = els.commentsTreeContainer?.querySelectorAll('.comment-checkbox');
  if (!checkboxes) return;
  for (const cb of checkboxes) {
    cb.checked = checked;
  }
  previewState.hasCustomPruning = true;
  updateCheckboxPropagation();
  rebuildPrompt();
}

function getSelectedCommentIds() {
  const selectedIds = [];
  if (!els.commentsTreeContainer) return selectedIds;
  const checkboxes = els.commentsTreeContainer.querySelectorAll('.comment-checkbox');
  for (const cb of checkboxes) {
    if (cb.checked && !cb.disabled) {
      selectedIds.push(cb.getAttribute('data-id'));
    }
  }
  return selectedIds;
}
